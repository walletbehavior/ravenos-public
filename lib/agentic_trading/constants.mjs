export const AgenticTradingSchemas = Object.freeze({
  chain_identity: "ravenos.agentic.chain_identity.v1",
  venue_identity: "ravenos.agentic.venue_identity.v1",
  asset_identity: "ravenos.agentic.asset_identity.v1",
  instrument_identity: "ravenos.agentic.instrument_identity.v1",
  settlement_asset: "ravenos.agentic.settlement_asset.v1",
  agent_spec: "ravenos.agentic.agent_spec.v1",
  evidence_packet: "ravenos.agentic.evidence_packet.v1",
  trade_intent: "ravenos.agentic.trade_intent.v1",
  capital_transfer_intent: "ravenos.agentic.capital_transfer_intent.v1",
  trade_plan: "ravenos.agentic.trade_plan.v1",
  policy_decision: "ravenos.agentic.policy_decision.v1",
  execution_receipt: "ravenos.agentic.execution_receipt.v1",
  outcome_record: "ravenos.agentic.outcome_record.v1",
  agent_lifecycle: "ravenos.agentic.agent_lifecycle.v1",
  plan_lifecycle: "ravenos.agentic.plan_lifecycle.v1",
});

export const AgentLifecycleStates = Object.freeze([
  "draft",
  "validated",
  "paper",
  "paper_paused",
  "paper_accepted",
  "live_candidate",
  "live",
  "paused",
  "killed",
  "expired",
  "failed",
]);

export const PlanLifecycleStates = Object.freeze([
  "proposed",
  "validated",
  "policy_pending",
  "approval_required",
  "approved",
  "previewing",
  "ready",
  "executing",
  "partially_executed",
  "reconciliation_required",
  "completed",
  "compensation_required",
  "compensating",
  "compensated",
  "failed",
  "cancelled",
  "expired",
]);

export const AgenticLiveDefaults = Object.freeze({
  global_live_agent_execution: false,
  robinhood_brokerage_execution: false,
  robinhood_chain_live_execution: false,
  solana_agent_execution: false,
  hyperliquid_agent_execution: false,
  autonomous_bridging: false,
  automated_compensation_trades: false,
});

export const AgenticEnvironments = Object.freeze(["preview", "paper"]);
export const PolicyDecisionResults = Object.freeze(["allow", "block", "require_approval", "indeterminate"]);
