import { normalizeAtomic, decimalToAtomic, multiplyRatioAtomic, basisPointsAmount } from "../agentic_trading/decimal.mjs";
import { agenticContractHash } from "../agentic_trading/hashing.mjs";

// This module cannot construct, sign, submit, or authorize a transaction.
export const SHIELDED_SCHEMA = "ravenos.shielded_reserve.research.v1";
export const SHIELDED_FLAGS = Object.freeze([
  "ZCASH_ENABLED", "SHIELDED_RESERVE_ENABLED", "SHIELDED_ROUTE_QUOTES_ENABLED",
  "SHIELDED_DEPLOY_ENABLED", "SHIELDED_RETURN_ENABLED", "SHIELDED_SEND_ENABLED",
]);
export const SHIELDED_FEE_SCENARIOS_BPS = Object.freeze([0, 10, 25, 50, 100]);
export const SHIELDED_BOUNDARY = Object.freeze({
  mode: "shadow_only", live_execution_enabled: false, wallet_creation_enabled: false,
  signing_enabled: false, submission_enabled: false, custody_enabled: false,
  viewing_key_ingestion_enabled: false, public_profile_export_enabled: false,
  native_execution_fee_applies: false, cashback_eligible: false,
});

export function shieldedCapabilities(env = {}) {
  const flags = Object.fromEntries(SHIELDED_FLAGS.map(key => [key, env[key] === "1"]));
  return Object.freeze({ ...flags, enabled: flags.ZCASH_ENABLED && flags.SHIELDED_RESERVE_ENABLED,
    LIVE_SHIELDED_EXECUTION_ENABLED: false, boundary: SHIELDED_BOUNDARY });
}

export function assertShadowAccess(env, action) {
  const flags = shieldedCapabilities(env);
  if (!flags.enabled || !flags.SHIELDED_ROUTE_QUOTES_ENABLED) throw new Error("shielded_disabled");
  const key = { SHIELDED_DEPLOY: "SHIELDED_DEPLOY_ENABLED", SHIELDED_RETURN: "SHIELDED_RETURN_ENABLED", SHIELDED_SEND: "SHIELDED_SEND_ENABLED", STANDARD_COMPARE: "SHIELDED_ROUTE_QUOTES_ENABLED" }[action];
  if (!key || !flags[key]) throw new Error("shielded_action_disabled");
}

// No key material is accepted anywhere in the research API, including nested metadata.
export function assertNoShieldedSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (child !== false && child !== null && /(view(?:ing)?.?key|spend(?:ing)?.?key|private.?key|mnemonic|seed|recovery|secret)/i.test(key)) throw new Error("sensitive_wallet_material_rejected");
    if (typeof child === "string" && /(?:uview1|uivk1|secret-extended-key|secret-spending-key)/i.test(child)) throw new Error("sensitive_wallet_material_rejected");
    assertNoShieldedSecrets(child);
  }
}

export function decimalMicrosFloor(value) {
  const source = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(source)) throw new Error("decimal_value_invalid");
  const [whole, fraction = ""] = source.split(".");
  return decimalToAtomic(`${whole}.${fraction.slice(0, 6).padEnd(6, "0")}`, 6);
}

export function valueZec(zatoshis, priceUsdMicros) {
  return multiplyRatioAtomic(zatoshis, priceUsdMicros, "100000000");
}

export function usdToUsdcEquivalent(usdMicros, usdcPriceUsdMicros) {
  return multiplyRatioAtomic(usdMicros, "1000000", usdcPriceUsdMicros);
}

export function createShieldedIntent(input, { now = Date.now() } = {}) {
  assertNoShieldedSecrets(input);
  if (!new Set(["SHIELDED_DEPLOY", "SHIELDED_RETURN", "SHIELDED_SEND", "STANDARD_COMPARE"]).has(input.action)) throw new Error("shielded_action_invalid");
  const expires = Date.parse(input.expires_at);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 3_600_000) throw new Error("intent_expiry_invalid");
  const asset = key => {
    if (typeof input[key] !== "string" || !/^[a-z0-9_]+$/.test(input[key])) throw new Error("asset_key_invalid");
    return input[key];
  };
  const source = asset("source"), destination = asset("destination");
  if ((input.action === "SHIELDED_RETURN" && (destination !== "zec" || source === "zec")) ||
      (["SHIELDED_DEPLOY", "SHIELDED_SEND"].includes(input.action) && (source !== "zec" || destination === "zec")) ||
      (input.action === "STANDARD_COMPARE" && (source === "zec" || destination === "zec")) || source === destination) throw new Error("intent_direction_invalid");
  const delay = input.maximum_delay_seconds ?? 3600;
  const friction = input.maximum_friction_bps ?? 1000;
  if (!Number.isSafeInteger(delay) || delay < 1 || delay > 86400 || !Number.isSafeInteger(friction) || friction < 0 || friction > 10000) throw new Error("intent_limits_invalid");
  const core = {
    schema_version: SHIELDED_SCHEMA, action: input.action, source, destination,
    amount_atomic: normalizeAtomic(input.amount_atomic, "intent_amount", { allowZero: false }),
    amount_mode: input.action === "SHIELDED_SEND" ? "EXACT_OUTPUT" : "EXACT_INPUT",
    minimum_receive_atomic: normalizeAtomic(input.minimum_receive_atomic ?? "0"),
    maximum_delay_seconds: delay, maximum_friction_bps: friction,
    provider_policy: "allowlisted_read_only", privacy_policy: "disclose_unknowns",
    // Wallet destinations are deliberately absent: research uses published test vectors only.
    destination_policy: "public_research_fixture_only", expires_at: new Date(expires).toISOString(),
    boundary: SHIELDED_BOUNDARY,
  };
  return Object.freeze({ ...core, intent_hash: agenticContractHash(core) });
}

export function verifyShieldedIntent(intent, now = Date.now()) {
  if (!intent || intent.schema_version !== SHIELDED_SCHEMA) throw new Error("intent_invalid");
  const { intent_hash, ...core } = intent;
  if (agenticContractHash(core) !== intent_hash) throw new Error("intent_integrity_invalid");
  if (Date.parse(intent.expires_at) <= now) throw new Error("intent_expired");
}

export function shieldedPrivacyEvidence(action, { provider = "unknown", privateUaAccepted = false } = {}) {
  const deploy = action === "SHIELDED_DEPLOY" || action === "SHIELDED_SEND";
  const standard = action === "STANDARD_COMPARE";
  return Object.freeze({
    classification: standard ? "PUBLIC" : "UNKNOWN",
    quote_capability: privateUaAccepted && !standard ? (deploy ? "SHIELDED_SOURCE_CONDITIONAL" : "SHIELDED_DESTINATION_QUOTE_SUPPORTED") : "UNKNOWN",
    source_zcash_shielded: deploy ? "unknown_until_external_wallet_evidence" : false,
    source_public_address_exposed: deploy ? "shielded_sender_hidden_if_verified; transparent_deposit_public" : true,
    amount_exposed_on_source: true,
    provider_sees_amount: provider === "near_1click" ? true : "unknown",
    provider_sees_destination: provider === "near_1click" ? true : "unknown",
    solver_sees_amount: provider === "near_1click" ? true : "unknown",
    solver_sees_destination: "unknown",
    destination_public: deploy || standard ? true : "shielded_receiver_quote_supported; settlement_unverified",
    intermediate_address_used: provider === "near_1click" ? true : "unknown",
    public_bridge_event: provider === "near_1click" ? true : "unknown",
    final_tx_public: deploy || standard ? true : "transaction_metadata_public; shielded_note_contents_hidden_if_verified",
    relayer_used: "unknown", source_shield_proven: false, destination_shield_proven: false,
    timing_correlation_risk: "high", amount_correlation_risk: "high",
    anonymity_set: "unmeasured", unique_amount_risk: "unmeasured",
    network_metadata_risk: "provider_observes_request_IP_and_time; wallet_broadcast_metadata_not_measured",
    viewing_key_exposure: "none_accepted", end_to_end_unlinkability_proven: false,
    notes: ["A dry quote is not a shielded spend or settlement proof.", "Cross-chain amounts and timing can correlate public legs.", "Delaying a route does not establish a larger anonymity set."],
  });
}

export function feeScenarios(inputUsdMicros, outputUsdMicros) {
  return SHIELDED_FEE_SCENARIOS_BPS.map(bps => {
    const fee = basisPointsAmount(inputUsdMicros, bps);
    return { raven_fee_bps: bps, hypothetical_raven_fee_usd_micros: fee,
      hypothetical_remaining_output_usd_micros: (BigInt(outputUsdMicros) > BigInt(fee) ? BigInt(outputUsdMicros) - BigInt(fee) : 0n).toString(),
      production_policy_selected: false, reroute_required: true };
  });
}

export function simulatePrivacyDelay(seconds) {
  if (![0, 30, 120, 300].includes(seconds)) throw new Error("privacy_delay_invalid");
  return { simulated_delay_seconds: seconds, timing_correlation_risk: "unmeasured", amount_correlation_risk: "unchanged", privacy_improvement_proven: false, scheduling_enabled: false };
}

export function shadowExcessReturn(availableAtomic, workingTargetAtomic) {
  const excess = BigInt(normalizeAtomic(availableAtomic)) - BigInt(normalizeAtomic(workingTargetAtomic));
  return { excess_atomic: (excess > 0n ? excess : 0n).toString(), action: "SHADOW_RETURN_EXCESS", auto_execute: false };
}

export function publicShieldedProjection() {
  return Object.freeze({ total_capital: "private", shielded_balance: "private", performance_verification: "not_implemented" });
}
