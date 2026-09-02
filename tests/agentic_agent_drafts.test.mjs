import assert from "node:assert/strict";
import test from "node:test";

import {
  PAPER_AGENT_DRAFT_REQUEST_SCHEMA,
  compilePaperAgentDraft,
  verifyPaperCapitalAllocation,
} from "../lib/agentic_trading/agent_drafts.mjs";
import { verifyAgenticRecord } from "../lib/agentic_trading/records.mjs";

const request = Object.freeze({
  schema_version: PAPER_AGENT_DRAFT_REQUEST_SCHEMA,
  idempotency_key: "draft-request-00000001",
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
});

test("paper draft compiler produces exact two-venue records with every live authority off", () => {
  const compiled = compilePaperAgentDraft(request, {
    owner_tenant_id: "usr_agent_owner",
    now: Date.parse("2026-09-02T12:00:00.000Z"),
  });
  assert.match(compiled.agent.agent_id, /^agt_[a-f0-9]{28}$/);
  assert.equal(compiled.agent.lifecycle_state, "draft");
  assert.equal(compiled.agent.live_execution_enabled, false);
  assert.equal(compiled.spec.compiler.planner_model_version, "none:deterministic-template");
  assert.deepEqual(compiled.spec.allowed_instruments.map((row) => row.display_symbol), ["SOL/USDC", "SOL-PERP"]);
  assert.deepEqual(compiled.spec.allowed_instruments.map((row) => row.chain_id), ["solana:mainnet-beta", "hyperliquid:mainnet"]);
  assert.equal(compiled.spec.allowed_instruments[0].base_asset.reference, "So11111111111111111111111111111111111111112");
  assert.equal(compiled.spec.allowed_instruments[0].quote_asset.reference, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(verifyAgenticRecord(compiled.spec, "AgentSpec").ok, true);
  assert.equal(compiled.policy.authority, "user");
  assert.equal(compiled.policy.adoption_state, "active");
  assert.equal(compiled.policy.live_execution_allowed, false);
  assert.equal(compiled.policy.autonomous_bridging_allowed, false);
  assert.equal(compiled.policy.automated_compensation_allowed, false);
  assert.equal(compiled.policy.limits.max_leg_notional_usdc_micros, "100000000");
  assert.equal(compiled.policy.limits.max_plan_notional_usdc_micros, "200000000");
  assert.equal(verifyPaperCapitalAllocation(compiled.capital), true);
  assert.deepEqual(compiled.capital.allocations.map((row) => [row.chain_id, row.amount_atomic]), [
    ["solana:mainnet-beta", "500000000"],
    ["solana:mainnet-beta", "50000000"],
    ["hyperliquid:mainnet", "500000000"],
  ]);
  assert.equal(compiled.schedule.interval_seconds, 300);
  assert.equal(compiled.schedule.state, "draft");
});

test("paper draft creation is deterministic for one owner idempotency key", () => {
  const context = { owner_tenant_id: "usr_agent_owner", now: Date.parse("2026-09-02T12:00:00.000Z") };
  const first = compilePaperAgentDraft(request, context);
  const second = compilePaperAgentDraft(request, context);
  assert.equal(first.agent.agent_id, second.agent.agent_id);
  assert.equal(first.request_fingerprint, second.request_fingerprint);
  assert.equal(first.spec.record_hash, second.spec.record_hash);
  const otherOwner = compilePaperAgentDraft(request, { ...context, owner_tenant_id: "usr_other_owner" });
  assert.notEqual(first.agent.agent_id, otherOwner.agent.agent_id);
});

test("paper draft compiler rejects authority expansion and unsafe capital", () => {
  const context = { owner_tenant_id: "usr_agent_owner", now: Date.parse("2026-09-02T12:00:00.000Z") };
  assert.throws(() => compilePaperAgentDraft({ ...request, adopt_policy: false }, context), /explicit_adoption/);
  assert.throws(() => compilePaperAgentDraft({ ...request, template: "arbitrary_strategy" }, context), /template_unsupported/);
  assert.throws(() => compilePaperAgentDraft({ ...request, solana_capital_usdc: "50" }, context), /venue_local_capital/);
  assert.throws(() => compilePaperAgentDraft({ ...request, calldata: "0x1234" }, context), /field_forbidden/);
  assert.throws(() => compilePaperAgentDraft({ ...request, basis_exit_bps: 30 }, context), /exit_must_be_below_entry/);
  assert.throws(() => compilePaperAgentDraft({ ...request, cadence_minutes: 2 }, context), /cadence_minutes_unsupported/);
});
