import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ShadowRouteLedgerLimits,
  buildShadowRouteReadinessProjection,
  createD1ShadowExecutionLedgerStore,
  createShadowRouteObservation,
  runShadowRouteCheckpointEvaluator,
} from "../lib/customer_trade/shadow_execution_ledger.mjs";

const OBSERVED_AT = "2026-08-29T02:04:05.000Z";
const TOKEN = "Token111111111111111111111111111111111111";

function shadowFixture(overrides = {}) {
  return {
    instrument_id: "solana:pool:Pool1111111111111111111111111111111111111",
    chain_id: "solana",
    side: "buy",
    provider_latency_ms: 180,
    slippage_bps: 50,
    observed_at: OBSERVED_AT,
    quote: { provider: "jupiter", expected_output_amount_base_units: "18942000000" },
    shadow_execution: {
      mode: "shadow",
      route_state: "exit_verified",
      observed_at: OBSERVED_AT,
      request: {
        source_amount_usdc: 500,
        maximum_slippage_bps: 50,
        destination_asset: { address: TOKEN },
      },
      entry_route: {
        provider: "jupiter",
        state: "route_available",
        destination_asset_id: `solana:mainnet:spl:${TOKEN}`,
        expected_output: 18_942,
        minimum_output: 18_800,
        created_at: "2026-08-29T02:04:04.000Z",
        expires_at: "2026-08-29T02:04:24.000Z",
      },
      exit_route: { state: "route_available" },
      round_trip: {
        exit_verified: true,
        trade_available: false,
        current_executable_liquidation_usdc: 487.61,
        minimum_executable_liquidation_usdc: 480,
        quote_only_round_trip_loss_pct: 2.478,
        round_trip_friction_pct: null,
        unavailable_cost_components: ["entry_network_or_route_cost", "exit_network_or_route_cost"],
      },
      execution: {
        signing_available: false,
        submission_available: false,
        transaction_material_available: false,
      },
    },
    ...overrides,
  };
}

test("shadow observations preserve exact economics while excluding customer and transaction authority", () => {
  const row = createShadowRouteObservation(shadowFixture());
  assert.equal(row.source_amount_usdc, 500);
  assert.equal(row.amount_bucket, "usdc_100_1000");
  assert.equal(row.destination_amount_base_units, "18942000000");
  assert.equal(row.exit_verified, 1);
  assert.equal(row.friction_complete, 0);
  assert.equal(row.quote_only_round_trip_loss_pct, 2.478);
  assert.deepEqual(row.privacy, {
    customer_id_stored: false,
    wallet_address_stored: false,
    network_address_stored: false,
    provider_payload_stored: false,
    transaction_material_stored: false,
    plan_prices_stored: false,
  });
  assert.equal(Object.hasOwn(row, "wallet_address"), false);
  assert.equal(Object.hasOwn(row, "customer_id"), false);
  assert.equal(Object.hasOwn(row, "serialized_transaction"), false);
  assert.equal(Object.hasOwn(row, "calldata"), false);

  const repeated = createShadowRouteObservation(shadowFixture());
  assert.equal(repeated.sample_key, row.sample_key);
  assert.equal(repeated.observation_id, row.observation_id);
});

test("shadow observations reject any accidental execution authority", () => {
  const fixture = shadowFixture();
  fixture.shadow_execution.execution.transaction_material_available = true;
  assert.throws(() => createShadowRouteObservation(fixture), /shadow_execution_authority_forbidden/);
});

test("readiness projection measures route truth without calling an incomplete route executable", () => {
  const row = createShadowRouteObservation(shadowFixture());
  const projection = buildShadowRouteReadinessProjection([row], [], {
    generated_at: Date.parse(OBSERVED_AT),
    window_seconds: 86_400,
  });
  assert.equal(projection.state, "sampling");
  assert.equal(projection.observations, 1);
  assert.equal(projection.exact_markets, 1);
  assert.equal(projection.entry_quote_pct, 100);
  assert.equal(projection.exit_verified_pct, 100);
  assert.equal(projection.friction_complete_pct, 0);
  assert.equal(projection.trade_available_pct, 0);
  assert.equal(projection.median_quote_only_round_trip_loss_pct, 2.478);
  assert.equal(projection.slices[0].median_quote_only_round_trip_loss_pct, 2.478);
  assert.equal(projection.execution.signing_available, false);
  assert.equal(projection.execution.submission_available, false);
});

test("readiness derives quote-only loss from persisted spend and exit values", () => {
  const persisted = { ...createShadowRouteObservation(shadowFixture()) };
  delete persisted.quote_only_round_trip_loss_pct;
  const projection = buildShadowRouteReadinessProjection([persisted], [], {
    generated_at: Date.parse(OBSERVED_AT),
    window_seconds: 86_400,
  });
  assert.ok(Math.abs(projection.median_quote_only_round_trip_loss_pct - 2.478) < 1e-9);
  assert.ok(Math.abs(projection.slices[0].median_quote_only_round_trip_loss_pct - 2.478) < 1e-9);
});

test("checkpoint evaluator appends the first due horizon once under a bounded lease", async () => {
  const observation = createShadowRouteObservation(shadowFixture());
  const inserted = [];
  const store = {
    async acquireLease() { return true; },
    async releaseLease() {},
    async purgeExpired() { return 0; },
    async dueObservations() { return [{ ...observation, completed_horizons: [] }]; },
    async insertCheckpoint(row) { inserted.push(row); return true; },
  };
  const now = observation.observed_at + ShadowRouteLedgerLimits.checkpoint_horizons_seconds[0];
  const result = await runShadowRouteCheckpointEvaluator(store, {
    now,
    reprice: async () => ({
      route_available: true,
      state: "route_available",
      current_exit_usdc: 490,
      minimum_exit_usdc: 484,
      provider_latency_ms: 210,
    }),
  });
  assert.deepEqual(result, { state: "complete", considered: 1, checkpoints: 1, failures: 0, purged: 0 });
  assert.equal(inserted[0].horizon_seconds, 300);
  assert.equal(inserted[0].route_available, 1);
  assert.equal(inserted[0].current_exit_usdc, 490);
});

test("D1 ledger pins reads and writes to one first-primary session", async () => {
  const sessions = [];
  const session = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const store = createD1ShadowExecutionLedgerStore({
    prepare() { throw new Error("base_database_must_not_be_used"); },
    withSession(mode) {
      sessions.push(mode);
      return session;
    },
  });
  assert.deepEqual(await store.recentObservations(0, 10, 1), []);
  assert.deepEqual(sessions, ["first-primary"]);
});

test("migration is append-only, retention-bounded, and excludes prohibited identity and execution fields", () => {
  const sql = readFileSync("customer-migrations/0005_shadow_execution_ledger.sql", "utf8");
  assert.match(sql, /ravenos_shadow_route_observations/i);
  assert.match(sql, /ravenos_shadow_route_checkpoints/i);
  assert.match(sql, /BEFORE UPDATE ON ravenos_shadow_route_observations/i);
  assert.match(sql, /BEFORE UPDATE ON ravenos_shadow_route_checkpoints/i);
  assert.match(sql, /retention_expires_at/i);
  const statements = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(statements, /^\s*(?:customer_id|user_id|wallet_address|ip_address|serialized_transaction|calldata|signature)\s+/im);
});
