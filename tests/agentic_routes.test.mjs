import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createD1AgenticTradingStore,
  resolveAgenticTradingFlags,
  routeAgenticTrading,
} from "../lib/agentic_trading/routes.mjs";
import { canonicalContractHash } from "../lib/customer_trade/contracts.mjs";
import { PAPER_AGENT_DRAFT_REQUEST_SCHEMA } from "../lib/agentic_trading/agent_drafts.mjs";

const enabledEnv = {
  RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
  RAVENOS_AGENTIC_PAPER_ENABLED: "1",
};

function authorizationRecorder() {
  const calls = [];
  const authorize = async (_request, _env, _input, options) => {
    calls.push(options);
    return { principal: { user_id: "usr_test_owner" }, now: 1788292800, response_headers: {} };
  };
  return { authorize, calls };
}

function draftRequest(overrides = {}) {
  return {
    schema_version: PAPER_AGENT_DRAFT_REQUEST_SCHEMA,
    idempotency_key: "route-draft-request-0001",
    name: "SOL Basis Guard",
    template: "solana_hyperliquid_sol_hedge",
    notional_usdc: "100",
    solana_capital_usdc: "500",
    hyperliquid_capital_usdc: "500",
    cadence_minutes: 5,
    basis_entry_bps: 30,
    basis_exit_bps: 10,
    max_slippage_bps: 75,
    max_price_impact_bps: 100,
    adopt_policy: true,
    ...overrides,
  };
}

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0025_agentic_trading.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0026_agentic_paper_control.sql", "utf8"));
  sqlite.prepare(`
    INSERT INTO ravenos_users (user_id, state, primary_email, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, 1, 1, 1)
  `).run("usr_test_owner", "owner@example.test");
  return {
    sqlite,
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            async first() { return statement.get(...values) || null; },
            async all() { return { results: statement.all(...values) }; },
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

test("all live agent, venue, bridge and compensation flags remain hard-disabled", () => {
  const flags = resolveAgenticTradingFlags({
    ...enabledEnv,
    RAVENOS_LIVE_AGENT_EXECUTION_ENABLED: "1",
    RAVENOS_SOLANA_AGENT_EXECUTION_ENABLED: "1",
    RAVENOS_HYPERLIQUID_AGENT_EXECUTION_ENABLED: "1",
    RAVENOS_AUTONOMOUS_BRIDGING_ENABLED: "1",
    RAVENOS_AUTOMATED_COMPENSATION_ENABLED: "1",
  });
  assert.equal(flags.paper_execution, true);
  assert.equal(flags.global_live_agent_execution, false);
  assert.equal(flags.solana_agent_execution, false);
  assert.equal(flags.hyperliquid_agent_execution, false);
  assert.equal(flags.autonomous_bridging, false);
  assert.equal(flags.automated_compensation_trades, false);
  assert.equal(flags.ignored_live_enable_requests.length, 5);
});

test("workspace is authenticated, Pro-gated, paper-only and never fixture-backed", async () => {
  const auth = authorizationRecorder();
  let workspaceOptions = null;
  const response = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/workspace", {
    headers: { "sec-fetch-site": "same-origin", referer: "https://app.ravenos.xyz/agents/" },
  }), enabledEnv, {
    authorize: auth.authorize,
    resolve_access: () => ({ available: true, state: "active" }),
    store: {
      workspace: async (_userId, options) => {
        workspaceOptions = options;
        return { agents: [], radar: { freshness_state: "Radar disabled", entries: [] } };
      },
    },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.environment, "paper");
  assert.equal(payload.demonstration_data, false);
  assert.equal(payload.live_execution_enabled, false);
  assert.deepEqual(payload.agents, []);
  assert.equal(workspaceOptions.include_radar, false);
  assert.equal(auth.calls[0].require_csrf, false);
});

test("Agent Radar is queried only behind its independent activation flag", async () => {
  const auth = authorizationRecorder();
  let workspaceOptions = null;
  const response = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/workspace"), {
    ...enabledEnv,
    RAVENOS_AGENT_RADAR_ENABLED: "1",
  }, {
    authorize: auth.authorize,
    resolve_access: () => ({ available: true, state: "active" }),
    store: {
      workspace: async (_userId, options) => {
        workspaceOptions = options;
        return { agents: [], radar: { freshness_state: "No indexed evidence", entries: [] } };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(workspaceOptions.include_radar, true);
  assert.equal((await response.json()).feature_flags.agent_radar, true);
});

test("D1 workspace does not touch Radar storage while its independent flag is off", async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      const query = sql.replace(/\s+/g, " ").trim();
      queries.push(query);
      return {
        bind() {
          return { all: async () => ({ results: [] }) };
        },
      };
    },
  };
  const workspace = await createD1AgenticTradingStore(db).workspace("usr_test_owner", {
    now_seconds: 1788292800,
    include_radar: false,
  });
  assert.equal(workspace.radar.freshness_state, "Radar disabled");
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /ravenos_agent_radar_projections/);
});

test("server-disabled workspace fails closed without querying its store", async () => {
  const auth = authorizationRecorder();
  let queried = false;
  const response = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/workspace"), {
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
  }, {
    authorize: auth.authorize,
    resolve_access: () => ({ available: false, state: "server_disabled" }),
    store: { workspace: async () => { queried = true; } },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).state, "server_disabled");
  assert.equal(queried, false);
});

test("pause and kill transitions require CSRF and never trigger execution", async () => {
  const auth = authorizationRecorder();
  const transitions = [];
  const response = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/agt_abcdefghijklmnop/pause", {
    method: "POST",
  }), enabledEnv, {
    authorize: auth.authorize,
    resolve_access: () => ({ available: true, state: "active" }),
    store: {
      transitionAgent: async (input) => {
        transitions.push(input);
        return { ok: true, agent_id: input.agent_id, previous_state: "paper", state: "paper_paused", live_execution_triggered: false };
      },
    },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(auth.calls[0].require_csrf, true);
  assert.equal(transitions[0].action, "pause");
  assert.equal(payload.state, "paper_paused");
  assert.equal(payload.live_execution_triggered, false);
  assert.equal(payload.live_execution_enabled, false);
});

test("draft creation accepts only a CSRF-protected bounded typed request", async () => {
  const auth = authorizationRecorder();
  const created = [];
  const request = new Request("https://app.ravenos.xyz/api/v1/agents/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draftRequest()),
  });
  const response = await routeAgenticTrading(request, enabledEnv, {
    authorize: auth.authorize,
    resolve_access: () => ({ available: true, state: "active" }),
    store: {
      createDraft: async (input) => {
        created.push(input);
        return { ok: true, agent_id: "agt_abcdefghijklmnop", state: "draft", live_execution_enabled: false };
      },
    },
  });
  assert.equal(response.status, 201);
  assert.equal(auth.calls[0].require_csrf, true);
  assert.equal(created[0].user_id, "usr_test_owner");
  assert.equal(created[0].draft.adopt_policy, true);
  assert.equal((await response.json()).live_execution_enabled, false);
});

test("agent routes reject parameters and request bodies before owner state access", async () => {
  const auth = authorizationRecorder();
  const parameterized = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/workspace?fixture=1"), enabledEnv, { authorize: auth.authorize });
  assert.equal(parameterized.status, 400);
  const withBody = await routeAgenticTrading(new Request("https://app.ravenos.xyz/api/v1/agents/agt_abcdefghijklmnop/pause", {
    method: "POST",
    body: "{}",
  }), enabledEnv, { authorize: auth.authorize });
  assert.equal(withBody.status, 400);
  assert.equal(auth.calls.length, 0);
});

test("public-host agent API is not exposed", async () => {
  const response = await routeAgenticTrading(new Request("https://ravenos.xyz/api/v1/agents/workspace"), enabledEnv);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });
});

test("D1 draft lifecycle is immutable, owner-scoped and activates only a paper schedule", async () => {
  const db = sqliteD1();
  const store = createD1AgenticTradingStore(db);
  const created = await store.createDraft({ user_id: "usr_test_owner", draft: draftRequest(), now_seconds: 1_788_292_800 });
  assert.equal(created.ok, true);
  assert.equal(created.state, "draft");
  assert.equal(created.live_execution_enabled, false);
  const replay = await store.createDraft({ user_id: "usr_test_owner", draft: draftRequest(), now_seconds: 1_788_292_800 });
  assert.equal(replay.idempotent_replay, true);
  const conflict = await store.createDraft({ user_id: "usr_test_owner", draft: draftRequest({ name: "Changed" }), now_seconds: 1_788_292_800 });
  assert.equal(conflict.status, 409);

  const validated = await store.transitionAgent({ user_id: "usr_test_owner", agent_id: created.agent_id, action: "validate", now_seconds: 1_788_292_801 });
  assert.equal(validated.state, "validated");
  const started = await store.transitionAgent({ user_id: "usr_test_owner", agent_id: created.agent_id, action: "start-paper", now_seconds: 1_788_292_802 });
  assert.equal(started.state, "paper");
  const schedule = db.sqlite.prepare("SELECT state, next_run_at FROM ravenos_agent_paper_schedules WHERE agent_id = ?").get(created.agent_id);
  assert.equal(schedule.state, "active");
  assert.equal(schedule.next_run_at, 1_788_292_802);
  const paused = await store.transitionAgent({ user_id: "usr_test_owner", agent_id: created.agent_id, action: "pause", now_seconds: 1_788_292_803 });
  assert.equal(paused.state, "paper_paused");
  assert.equal(paused.live_execution_triggered, false);

  const events = db.sqlite.prepare("SELECT sequence, previous_event_hash, event_hash, event_json FROM ravenos_agent_audit_events WHERE agent_id = ? ORDER BY sequence").all(created.agent_id);
  assert.equal(events.length, 4);
  assert.equal(events[0].previous_event_hash, "0".repeat(64));
  for (let index = 1; index < events.length; index += 1) assert.equal(events[index].previous_event_hash, events[index - 1].event_hash);
  for (const row of events) {
    const event = JSON.parse(row.event_json);
    const { event_hash: eventHash, ...eventCore } = event;
    assert.equal(eventHash, canonicalContractHash(eventCore));
    assert.equal(event.payload.execution_triggered ?? false, false);
  }

  const workspace = await store.workspace("usr_test_owner", { include_radar: false, now_seconds: 1_788_292_804 });
  assert.equal(workspace.agents.length, 1);
  assert.equal(workspace.agents[0].state, "paper_paused");
  assert.equal(workspace.agents[0].configuration.user_policy_adopted, true);
  assert.deepEqual(workspace.agents[0].configuration.instruments.map((row) => row.display_symbol), ["SOL/USDC", "SOL-PERP"]);
  assert.equal(workspace.agents[0].capital.length, 2);
});
