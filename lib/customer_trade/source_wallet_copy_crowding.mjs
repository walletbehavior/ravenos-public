import { createHash } from "node:crypto";

import {
  RAVEN_COPY_DECISION_SCHEMA,
  RAVEN_COPY_POLICY_SCHEMA,
  RavenCopyFeeScenariosBps,
  createRavenCopyDecision,
  createRavenCopyPolicy,
} from "./wallet_copy.mjs";
import { SOLANA_WALLET_EVENT_SCHEMA } from "./solana_wallet_intelligence.mjs";

export const SOURCE_WALLET_COPY_DEMAND_SCHEMA = "ravenos.source_wallet_copy_demand.v1";
export const SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA = "ravenos.source_wallet_copy_crowding_observation.v1";
export const SOURCE_WALLET_COPY_CROWDING_SUMMARY_SCHEMA = "ravenos.source_wallet_copy_crowding_summary.v1";

export const SourceWalletCopyCrowdingLimits = Object.freeze({
  maximum_active_policies_per_source: 10_000,
  maximum_aggregate_quote_usdc: 100_000,
  minimum_public_privacy_cohort: 5,
  minimum_public_signal_samples: 20,
  maximum_public_observations: 1_000,
  retention_seconds: 365 * 24 * 60 * 60,
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function finite(value, field, { minimum = 0, maximum = 1e15 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function sourceWalletId(value) {
  const normalized = String(value || "");
  if (!/^sw_sol_[a-f0-9]{40}$/.test(normalized)) fail("wallet_copy_crowding_source_id_invalid");
  return normalized;
}

function assertEvent(sourceId, event) {
  if (
    event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA
    || event.copy_signal?.eligible_buy_signal !== true
    || event.source_wallet?.chain !== "solana"
    || event.source_wallet?.network !== "mainnet"
  ) fail("wallet_copy_crowding_buy_event_required");
  const expected = `sw_sol_${digest(["solana", "mainnet", String(event.source_wallet.address || "")])}`;
  if (expected !== sourceId) fail("wallet_copy_crowding_source_identity_mismatch");
}

function normalizedFeeBps(value) {
  const fee = integer(value ?? 10, "wallet_copy_crowding_fee_bps", { maximum: 50 });
  if (!RavenCopyFeeScenariosBps.includes(fee)) fail("wallet_copy_crowding_fee_scenario_invalid");
  return fee;
}

function policyRow(value) {
  const policy = typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return null; }
  })() : value;
  if (policy?.schema_version !== RAVEN_COPY_POLICY_SCHEMA || !/^[a-f0-9]{40}$/.test(String(policy.policy_hash || ""))) {
    fail("wallet_copy_crowding_policy_invalid");
  }
  const { policy_hash: suppliedHash, ...policyInput } = policy;
  const canonical = createRavenCopyPolicy(policyInput);
  if (canonical.policy_hash !== suppliedHash) fail("wallet_copy_crowding_policy_hash_mismatch");
  const fixed = Number(policy.sizing?.fixed_usdc);
  const supported = policy.sizing?.kind === "FIXED_USDC" && policy.sizing?.implemented === true
    && Number.isFinite(fixed) && fixed >= 1 && fixed <= 100_000;
  return freeze({
    policy_hash: policy.policy_hash,
    policy_version: integer(policy.policy_version, "wallet_copy_crowding_policy_version", { minimum: 1 }),
    supported,
    fixed_usdc: supported ? fixed : null,
  });
}

export function resolveSourceWalletCopyCrowdingActivation(env = {}) {
  const requested = String(env.RAVENOS_WALLET_COPY_CROWDING_ENABLED || "") === "1";
  const observer = String(env.RAVENOS_WALLET_OBSERVER_ENABLED || "") === "1"
    && String(env.RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED || "") === "1";
  const intelligence = String(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED || "") === "1";
  const shadow = String(env.RAVENOS_SHADOW_COPY_ENABLED || "") === "1";
  const copyability = String(env.RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED || "") === "1";
  return freeze({
    requested,
    evaluator: requested && observer && intelligence && shadow && copyability,
    shadow_only: true,
    subscriber_identity_included: false,
    public_follower_count_disclosed: false,
    public_aggregate_capital_disclosed: false,
    live_copy: false,
    signing: false,
    broadcasting: false,
    custody: false,
    fee_collection: false,
  });
}

export function createSourceWalletCopyDemand({
  source_wallet_id: sourceIdentifier,
  source_event: event,
  policies = [],
  captured_at: capturedAt = new Date().toISOString(),
} = {}) {
  const sourceId = sourceWalletId(sourceIdentifier);
  assertEvent(sourceId, event);
  if (!Array.isArray(policies) || policies.length > SourceWalletCopyCrowdingLimits.maximum_active_policies_per_source) {
    fail("wallet_copy_crowding_policy_count_invalid");
  }
  const rows = policies.map(policyRow);
  const supported = rows.filter((row) => row.supported);
  const aggregateRequestedUsdc = Number(supported.reduce((sum, row) => sum + row.fixed_usdc, 0).toFixed(6));
  const captured = timestamp(capturedAt, "wallet_copy_crowding_captured_at");
  const demandHash = digest(rows
    .map((row) => `${row.policy_hash}:${row.policy_version}:${row.fixed_usdc ?? "unsupported"}`)
    .sort());
  const activePolicyCount = rows.length;
  const supportedPolicyCount = supported.length;
  return freeze({
    schema_version: SOURCE_WALLET_COPY_DEMAND_SCHEMA,
    demand_version: 1,
    demand_id: `swcd_${digest([sourceId, event.event_id, "detection_time_demand"])}`,
    source_wallet_id: sourceId,
    source_event_id: event.event_id,
    state: !activePolicyCount
      ? "no_active_demand"
      : supportedPolicyCount === activePolicyCount
        ? "fully_resolved"
        : "policy_mix_unresolved",
    active_policy_count_internal: activePolicyCount,
    supported_policy_count_internal: supportedPolicyCount,
    unresolved_policy_count_internal: activePolicyCount - supportedPolicyCount,
    aggregate_requested_usdc_internal: aggregateRequestedUsdc,
    aggregate_quote_limit_usdc: SourceWalletCopyCrowdingLimits.maximum_aggregate_quote_usdc,
    demand_hash: demandHash,
    captured_at: captured,
    evidence_scope: "eligible_detection_time_shadow_policies",
    privacy: {
      aggregate_internal_only: true,
      public_summary_privacy_threshold: SourceWalletCopyCrowdingLimits.minimum_public_privacy_cohort,
      public_summary_eligible: activePolicyCount >= SourceWalletCopyCrowdingLimits.minimum_public_privacy_cohort,
      subscriber_identity_included: false,
      subscriber_associations_included: false,
      user_id_included: false,
      watch_id_included: false,
      policy_payloads_included: false,
      public_follower_count_disclosed: false,
      public_aggregate_capital_disclosed: false,
    },
    execution_boundary: {
      shadow_research_only: true,
      position_creation: false,
      live_copy: false,
      signing: false,
      broadcasting: false,
      custody: false,
      fee_collection: false,
      transaction_hash: null,
    },
  });
}

function aggregatePolicy(amountUsdc, feeBps) {
  return createRavenCopyPolicy({
    policy_version: 1,
    mode: "RAVEN_COPY",
    sizing: { kind: "FIXED_USDC", fixed_usdc: amountUsdc },
    allocation: {
      total_strategy_usdc: Math.max(100_000, amountUsdc),
      maximum_per_trade_usdc: amountUsdc,
      minimum_per_trade_usdc: 1,
      maximum_token_exposure_usdc: Math.max(amountUsdc, 100_000),
      maximum_daily_notional_usdc: Math.max(amountUsdc, 100_000),
    },
    execution_quality: {
      maximum_detection_delay_ms: 30_000,
      maximum_quote_age_ms: 15_000,
      maximum_entry_degradation_bps: 1_000,
      maximum_price_impact_bps: 500,
      maximum_round_trip_friction_pct: 5,
      minimum_executable_exit_usdc: 1,
      minimum_liquidity_usd: 25_000,
      require_source_price_comparison: false,
      require_executable_exit: true,
      allowed_chains: ["solana"],
      canonical_usdc_settlement_required: true,
    },
    funding_assumption: "PREPOSITIONED_SOLANA_USDC_SHADOW",
    hypothetical_raven_fee_bps: feeBps,
  });
}

function eventAssetEvidence(event) {
  const standard = String(event?.economic?.destination_asset?.standard || "").toLowerCase();
  return {
    identity_resolved: Boolean(event?.economic?.destination_asset?.mint),
    token_standard: standard || "unavailable",
    token_standard_resolved: standard === "spl" || standard === "spl_token_2022",
    reverse_sell_quote_state: "provider_unavailable",
  };
}

function crowdingState(decision) {
  if (!decision) return { state: "INDETERMINATE", reason_code: "aggregate_route_not_evaluated" };
  if (decision.decision.state === "SHADOW_EXECUTABLE") {
    return { state: "AGGREGATE_ROUTE_AVAILABLE", reason_code: "aggregate_entry_and_exit_policy_passed" };
  }
  if (new Set(["POLICY_REJECTED", "FRICTION_TOO_HIGH", "LIQUIDITY_TOO_LOW", "COPY_DELAY_TOO_HIGH"]).has(decision.decision.state)) {
    return { state: "AGGREGATE_ROUTE_CONSTRAINED", reason_code: decision.decision.reason_code };
  }
  if (new Set(["ENTRY_UNAVAILABLE", "EXIT_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "ROUTE_STALE", "SIMULATION_FAILED"]).has(decision.decision.state)) {
    return { state: "AGGREGATE_ROUTE_UNAVAILABLE", reason_code: decision.decision.reason_code };
  }
  return { state: "INDETERMINATE", reason_code: decision.decision.reason_code };
}

function researchEvaluation(decision) {
  if (!decision) return null;
  if (decision.schema_version !== RAVEN_COPY_DECISION_SCHEMA) fail("wallet_copy_crowding_decision_invalid");
  const { watch_id: _watchId, ...evidence } = decision;
  return freeze({
    ...evidence,
    decision: {
      ...evidence.decision,
      shadow_position_created: false,
      aggregate_route_stress_only: true,
    },
    execution_boundary: {
      ...evidence.execution_boundary,
      mode: "aggregate_shadow_stress",
      position_creation_available: false,
    },
  });
}

function observation({ demand, event, decision = null, state, reasonCode, feeBps, observedAt }) {
  return freeze({
    schema_version: SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA,
    observation_version: 1,
    observation_id: `swcr_${digest([demand.demand_id, String(feeBps)])}`,
    demand_id: demand.demand_id,
    source_wallet_id: demand.source_wallet_id,
    source_event_id: demand.source_event_id,
    state,
    reason_code: reasonCode,
    hypothetical_raven_fee_bps: feeBps,
    observed_at: observedAt,
    demand_evidence: {
      state: demand.state,
      active_policy_count_internal: demand.active_policy_count_internal,
      supported_policy_count_internal: demand.supported_policy_count_internal,
      unresolved_policy_count_internal: demand.unresolved_policy_count_internal,
      aggregate_requested_usdc_internal: demand.aggregate_requested_usdc_internal,
      privacy_threshold_met: demand.privacy.public_summary_eligible,
    },
    route_evaluation: researchEvaluation(decision),
    provenance: {
      mode: "prospective_aggregate_shadow_stress",
      source_chain_event_at: event.timing?.chain_event_at || null,
      demand_captured_at: demand.captured_at,
      expected_quote_not_fill: true,
      isolated_size_ladder_substituted: false,
    },
    privacy: {
      aggregate_internal_only: true,
      subscriber_identity_included: false,
      subscriber_associations_included: false,
      user_id_included: false,
      watch_id_included: false,
      public_follower_count_disclosed: false,
      public_aggregate_capital_disclosed: false,
    },
    execution_boundary: {
      shadow_research_only: true,
      position_creation: false,
      live_copy: false,
      signing: false,
      broadcasting: false,
      custody: false,
      fee_collection: false,
      transaction_hash: null,
    },
  });
}

export async function evaluateSourceWalletCopyCrowding({
  event,
  source_wallet_id: sourceIdentifier,
  store,
  provider,
  now = Math.floor(Date.now() / 1_000),
  fee_bps: feeBps = 10,
} = {}) {
  const sourceId = sourceWalletId(sourceIdentifier);
  assertEvent(sourceId, event);
  if (
    !store?.loadPoliciesForSourceEvent
    || !store?.recordDemand
    || !store?.recordObservation
    || !store?.observationForEvent
  ) fail("wallet_copy_crowding_store_unavailable");
  const existing = await store.observationForEvent(sourceId, event.event_id);
  if (existing) return freeze({
    complete: true,
    source_event_id: event.event_id,
    observation_count: 0,
    duplicate_count: 1,
    quote_variant_count: 0,
    state: existing.state,
    decision_completed_at: existing.observed_at,
  });
  const policies = await store.loadPoliciesForSourceEvent(sourceId, event, SourceWalletCopyCrowdingLimits.maximum_active_policies_per_source);
  const observedAt = new Date(Number(now) * 1_000).toISOString();
  const demand = createSourceWalletCopyDemand({
    source_wallet_id: sourceId,
    source_event: event,
    policies,
    captured_at: observedAt,
  });
  await store.recordDemand(demand, now);
  const fee = normalizedFeeBps(feeBps);
  let decision = null;
  let resolution;
  let quoteVariantCount = 0;
  if (demand.active_policy_count_internal === 0) {
    resolution = { state: "NO_ACTIVE_DEMAND", reason_code: "no_eligible_shadow_policies" };
  } else if (demand.unresolved_policy_count_internal > 0) {
    resolution = { state: "POLICY_MIX_UNRESOLVED", reason_code: "aggregate_demand_contains_unsupported_sizing" };
  } else if (demand.aggregate_requested_usdc_internal > SourceWalletCopyCrowdingLimits.maximum_aggregate_quote_usdc) {
    resolution = { state: "ABOVE_QUOTE_LIMIT", reason_code: "aggregate_demand_exceeds_shadow_quote_limit" };
  } else if (!provider?.quoteCopySignal) {
    resolution = { state: "AGGREGATE_ROUTE_UNAVAILABLE", reason_code: "aggregate_quote_provider_unavailable" };
  } else {
    const policy = aggregatePolicy(demand.aggregate_requested_usdc_internal, fee);
    let evidence;
    let providerFailureReason = null;
    try {
      quoteVariantCount = 1;
      evidence = await provider.quoteCopySignal({ event, policy, purpose: "aggregate_follower_demand_shadow" });
    } catch (error) {
      providerFailureReason = String(error?.code || "aggregate_quote_provider_unavailable").slice(0, 100);
      const partial = error?.copyability_evidence || {};
      evidence = {
        source_notional_usdc: partial.source_notional_usdc ?? null,
        source_notional_basis: partial.source_notional_basis || "unavailable",
        liquidity_usd: partial.liquidity_usd ?? null,
        asset_evidence: partial.asset_evidence || eventAssetEvidence(event),
        entry: { state: "provider_unavailable", provider: "configured_copy_quote_provider", reason: providerFailureReason, exact_asset_identity: true },
        exit: { state: "provider_unavailable", provider: "configured_copy_quote_provider", reason: "aggregate_reverse_exit_unavailable", exact_asset_identity: true },
      };
    }
    try {
      decision = createRavenCopyDecision({
        watch_id: `aggregate_shadow_${digest([sourceId, event.event_id])}`,
        source_event: event,
        policy,
        ...evidence,
      }, { now: Number(now) * 1_000 });
      resolution = providerFailureReason
        ? { state: "AGGREGATE_ROUTE_UNAVAILABLE", reason_code: providerFailureReason }
        : crowdingState(decision);
    } catch (error) {
      resolution = { state: "INDETERMINATE", reason_code: String(error?.code || "aggregate_quote_evidence_invalid").slice(0, 100) };
    }
  }
  const record = observation({
    demand,
    event,
    decision,
    state: resolution.state,
    reasonCode: resolution.reason_code,
    feeBps: fee,
    observedAt,
  });
  const inserted = await store.recordObservation(record, now);
  return freeze({
    complete: true,
    source_event_id: event.event_id,
    observation_count: inserted ? 1 : 0,
    duplicate_count: inserted ? 0 : 1,
    quote_variant_count: quoteVariantCount,
    state: record.state,
    decision_completed_at: observedAt,
  });
}

function percent(count, total) {
  return total ? Number(((count / total) * 100).toFixed(2)) : null;
}

export function buildSourceWalletCopyCrowdingPublicSummary(observations = []) {
  const retained = (Array.isArray(observations) ? observations : [])
    .filter((row) => row?.schema_version === SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA)
    .slice(0, SourceWalletCopyCrowdingLimits.maximum_public_observations);
  const eligible = retained.filter((row) => row.demand_evidence?.privacy_threshold_met === true);
  const available = eligible.filter((row) => row.state === "AGGREGATE_ROUTE_AVAILABLE");
  const constrained = eligible.filter((row) => row.state === "AGGREGATE_ROUTE_CONSTRAINED");
  const unavailable = eligible.filter((row) => row.state === "AGGREGATE_ROUTE_UNAVAILABLE");
  const reasons = new Map();
  for (const row of eligible.filter((candidate) => candidate.state !== "AGGREGATE_ROUTE_AVAILABLE")) {
    const key = String(row.reason_code || "aggregate_reason_unavailable").slice(0, 100);
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  const dominant = [...reasons.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || null;
  const latest = eligible.map((row) => Date.parse(row.observed_at)).filter(Number.isFinite).sort((left, right) => right - left)[0];
  return freeze({
    schema_version: SOURCE_WALLET_COPY_CROWDING_SUMMARY_SCHEMA,
    summary_version: 1,
    state: !retained.length
      ? "insufficient_evidence"
      : !eligible.length
        ? "withheld_for_privacy"
        : eligible.length >= SourceWalletCopyCrowdingLimits.minimum_public_signal_samples
          ? "available"
          : "forming",
    eligible_signal_sample_count: eligible.length,
    minimum_signal_sample_count: SourceWalletCopyCrowdingLimits.minimum_public_signal_samples,
    aggregate_route_available_pct: percent(available.length, eligible.length),
    aggregate_route_constrained_pct: percent(constrained.length, eligible.length),
    aggregate_route_unavailable_pct: percent(unavailable.length, eligible.length),
    dominant_constraint: dominant ? { reason_code: dominant[0], signal_count: dominant[1], pct_of_eligible_signals: percent(dominant[1], eligible.length) } : null,
    last_observed_at: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    evidence_scope: "privacy_thresholded_prospective_aggregate_route_stress",
    current_follower_count_disclosed: false,
    aggregate_follower_capital_disclosed: false,
    subscriber_identity_included: false,
    exact_allocation_promised: false,
    simultaneous_fill_promised: false,
    live_copy: false,
  });
}

export function createD1SourceWalletCopyCrowdingStore(db) {
  if (!db?.prepare) fail("wallet_copy_crowding_store_unavailable");
  return freeze({
    async loadPoliciesForSourceEvent(sourceId, event, limit = SourceWalletCopyCrowdingLimits.maximum_active_policies_per_source) {
      const bounded = Math.max(1, Math.min(SourceWalletCopyCrowdingLimits.maximum_active_policies_per_source, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT w.policy_json
        FROM ravenos_customer_wallet_copy_watches w
        WHERE w.source_wallet_id = ?
          AND w.state = 'active'
          AND w.backfill_complete = 1
          AND w.cursor_slot IS NOT NULL
          AND (
            w.cursor_slot < ?
            OR (w.cursor_slot = ? AND COALESCE(w.cursor_signature, '') != ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_customer_shadow_copy_decisions d
            WHERE d.watch_id = w.watch_id AND d.source_event_id = ?
          )
        ORDER BY w.policy_hash ASC, w.watch_id ASC
        LIMIT ?
      `).bind(
        sourceId,
        event.chain_evidence.slot,
        event.chain_evidence.slot,
        event.chain_evidence.signature,
        event.event_id,
        bounded + 1,
      ).all();
      const rows = result?.results || [];
      if (rows.length > bounded) fail("wallet_copy_crowding_policy_count_exceeded");
      return rows.map((row) => row.policy_json);
    },
    async recordDemand(demand, now) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_copy_demand_snapshots (
          demand_id, source_wallet_id, source_event_id, state,
          active_policy_count, supported_policy_count, aggregate_requested_usdc,
          demand_hash, demand_json, captured_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        demand.demand_id,
        demand.source_wallet_id,
        demand.source_event_id,
        demand.state,
        demand.active_policy_count_internal,
        demand.supported_policy_count_internal,
        demand.aggregate_requested_usdc_internal,
        demand.demand_hash,
        JSON.stringify(demand),
        Number(now),
        Number(now) + SourceWalletCopyCrowdingLimits.retention_seconds,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async recordObservation(record, now) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_copy_crowding_observations (
          observation_id, demand_id, source_wallet_id, source_event_id,
          state, reason_code, hypothetical_raven_fee_bps,
          observation_json, observed_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.observation_id,
        record.demand_id,
        record.source_wallet_id,
        record.source_event_id,
        record.state,
        record.reason_code,
        record.hypothetical_raven_fee_bps,
        JSON.stringify(record),
        Number(now),
        Number(now) + SourceWalletCopyCrowdingLimits.retention_seconds,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async observationForEvent(sourceId, sourceEventId) {
      const row = await db.prepare(`
        SELECT observation_json FROM ravenos_source_wallet_copy_crowding_observations
        WHERE source_wallet_id = ? AND source_event_id = ?
        ORDER BY observed_at DESC, observation_id DESC LIMIT 1
      `).bind(sourceId, sourceEventId).first();
      if (!row?.observation_json) return null;
      try { return JSON.parse(row.observation_json); } catch { fail("wallet_copy_crowding_stored_observation_invalid"); }
    },
  });
}

export const SourceWalletCopyCrowdingContract = Object.freeze({
  demand_schema: SOURCE_WALLET_COPY_DEMAND_SCHEMA,
  observation_schema: SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA,
  summary_schema: SOURCE_WALLET_COPY_CROWDING_SUMMARY_SCHEMA,
  activation_flag: "RAVENOS_WALLET_COPY_CROWDING_ENABLED",
  aggregate_quote_limit_usdc: SourceWalletCopyCrowdingLimits.maximum_aggregate_quote_usdc,
  privacy_cohort_minimum: SourceWalletCopyCrowdingLimits.minimum_public_privacy_cohort,
  public_follower_count_disclosed: false,
  public_aggregate_capital_disclosed: false,
  live_copy: false,
  signing: false,
  broadcasting: false,
  custody: false,
  fee_collection: false,
});
