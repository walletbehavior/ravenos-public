import { createHash } from "node:crypto";

export const ROBINHOOD_AGENT_RADAR_SCHEMA = "ravenos.agentic.agent_radar_projection.v1";

export const AgentRadarFieldCatalog = Object.freeze({
  identity: Object.freeze([
    "agent_identity", "token_contract", "framework_association", "creator_deployer",
    "initial_funder", "related_wallets", "prior_launches", "endpoint_manifest", "onchain_identity",
  ]),
  contract_control: Object.freeze([
    "source_verification", "proxy_upgradeability", "owner_admin_powers", "mint_authority",
    "pause_freeze_blacklist", "transfer_restrictions", "transfer_tax", "sell_simulation",
    "supply_changes", "ownership_changes", "suspicious_approvals", "external_call_capability",
  ]),
  ownership_launch: Object.freeze([
    "holder_concentration", "creator_linked_concentration", "sniper_bundle_evidence",
    "initial_buyer_relationships", "supply_distribution", "vesting_locks", "creator_transfers",
    "circular_funding", "wallet_clusters", "creator_history",
  ]),
  liquidity_market_quality: Object.freeze([
    "venue_pool", "liquidity", "executable_depth", "price_impact", "liquidity_lock",
    "liquidity_removability", "creator_liquidity_control", "volume_quality",
    "circular_volume_evidence", "holder_growth_quality", "buy_sell_asymmetry",
  ]),
  agent_utility: Object.freeze([
    "endpoint_availability", "manifest_capabilities", "uptime", "task_completions",
    "onchain_actions", "trading_actions", "active_clients", "fees_revenue", "repeat_usage",
    "strategy_updates", "performance", "attribution",
  ]),
});

const DIMENSIONS = new Set(Object.keys(AgentRadarFieldCatalog));
const FIELDS = new Map(Object.entries(AgentRadarFieldCatalog).flatMap(([dimension, keys]) => keys.map((key) => [key, dimension])));
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z][a-z0-9_.:-]{1,119}$/;
const SOURCE_TYPES = new Set([
  "blockchain_log", "blockchain_state", "contract_call", "provider_index",
  "source_code_registry", "endpoint_probe", "signed_manifest", "operator_review",
]);
const FINALITIES = new Set(["soft_confirmation", "posted_to_ethereum", "ethereum_finalized", "not_applicable"]);
const WARNING_CODES = new Set([
  "ADMIN_CAPABILITY_OBSERVED",
  "CREATOR_LIQUIDITY_CONTROL_OBSERVED",
  "EXTERNAL_CALL_CAPABILITY_OBSERVED",
  "LIQUIDITY_REMOVABILITY_OBSERVED",
  "MINT_AUTHORITY_OBSERVED",
  "PAUSE_FREEZE_OR_BLACKLIST_CAPABILITY_OBSERVED",
  "SELL_SIMULATION_FAILED",
  "TRANSFER_RESTRICTION_OBSERVED",
  "TRANSFER_TAX_OBSERVED",
  "UPGRADEABILITY_OBSERVED",
]);

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

function text(value, field, maximum = 500, { optional = false } = {}) {
  const output = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ((!optional && !output) || output.length > maximum) fail(`${field}_invalid`);
  return output || null;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value, field) {
  return value === null || value === undefined || value === "" ? null : timestamp(value, field);
}

function optionalBlock(value, field) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${field}_invalid`);
  return parsed;
}

function hash(value, field, { optional = false } = {}) {
  if ((value === null || value === undefined || value === "") && optional) return null;
  const normalized = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function address(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!EVM_ADDRESS_RE.test(normalized) || /^0x0{40}$/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function dimensionAndKey(input) {
  const dimension = text(input.dimension, "agent_radar_dimension", 40).toLowerCase();
  const key = text(input.key, "agent_radar_key", 80).toLowerCase();
  if (!DIMENSIONS.has(dimension) || FIELDS.get(key) !== dimension) fail("agent_radar_field_invalid");
  return { dimension, key };
}

function jsonValue(value, field, depth = 0) {
  if (depth > 5) fail(`${field}_invalid`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, field, 500, { optional: true }) || "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${field}_invalid`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) fail(`${field}_invalid`);
    return value.map((entry) => jsonValue(entry, field, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 50) fail(`${field}_invalid`);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => {
      if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) fail(`${field}_invalid`);
      return [key, jsonValue(child, field, depth + 1)];
    }));
  }
  fail(`${field}_invalid`);
}

function normalizeEvidence(input, chainId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("agent_radar_evidence_invalid");
  const sourceType = text(input.source_type, "agent_radar_evidence_source_type", 40).toLowerCase();
  if (!SOURCE_TYPES.has(sourceType)) fail("agent_radar_evidence_source_type_invalid");
  const finality = text(input.finality || "not_applicable", "agent_radar_evidence_finality", 40).toLowerCase();
  if (!FINALITIES.has(finality)) fail("agent_radar_evidence_finality_invalid");
  const observedAt = timestamp(input.observed_at, "agent_radar_evidence_observed_at");
  const retrievedAt = timestamp(input.retrieved_at, "agent_radar_evidence_retrieved_at");
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail("agent_radar_evidence_timing_invalid");
  return freeze({
    provider: text(input.provider, "agent_radar_evidence_provider", 80).toLowerCase(),
    source_type: sourceType,
    reference: text(input.reference, "agent_radar_evidence_reference", 500),
    chain_id: input.chain_id === null || input.chain_id === undefined ? null : Number(input.chain_id),
    block_number: optionalBlock(input.block_number, "agent_radar_evidence_block_number"),
    block_hash: hash(input.block_hash, "agent_radar_evidence_block_hash", { optional: true }),
    transaction_hash: hash(input.transaction_hash, "agent_radar_evidence_transaction_hash", { optional: true }),
    finality,
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    fresh_until: optionalTimestamp(input.fresh_until, "agent_radar_evidence_fresh_until"),
    verified: input.verified === true,
    raw_external_text_included: false,
    ...(input.chain_id !== null && input.chain_id !== undefined && Number(input.chain_id) !== chainId
      ? fail("agent_radar_evidence_chain_mismatch") : {}),
  });
}

function normalizeFact(input, chainId, generatedAt) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("agent_radar_fact_invalid");
  const field = dimensionAndKey(input);
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 12) fail("agent_radar_fact_evidence_invalid");
  const evidence = input.evidence.map((row) => normalizeEvidence(row, chainId));
  if (!evidence.some((row) => row.verified)) fail("agent_radar_fact_unverified");
  const contradictions = Array.isArray(input.contradictions)
    ? input.contradictions.map((row) => text(row, "agent_radar_fact_contradiction", 240)) : [];
  if (contradictions.length > 12) fail("agent_radar_fact_contradictions_invalid");
  const timeBounded = evidence.filter((row) => row.fresh_until);
  const freshnessState = timeBounded.some((row) => Date.parse(row.fresh_until) >= Date.parse(generatedAt))
    ? "current" : timeBounded.length ? "stale" : "not_time_bounded";
  return freeze({
    ...field,
    value: jsonValue(input.value, "agent_radar_fact_value"),
    state: contradictions.length ? "contradictory" : freshnessState === "stale" ? "stale" : "verified",
    freshness_state: freshnessState,
    evidence,
    contradictions,
  });
}

function normalizeClaim(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("agent_radar_claim_invalid");
  const field = dimensionAndKey(input);
  return freeze({
    ...field,
    value: jsonValue(input.value, "agent_radar_claim_value"),
    claimed_by: text(input.claimed_by, "agent_radar_claimed_by", 120),
    source_reference: text(input.source_reference, "agent_radar_claim_reference", 500),
    observed_at: timestamp(input.observed_at, "agent_radar_claim_observed_at"),
    state: "unverified_claim",
    untrusted_external_text: true,
    used_as_privileged_instruction: false,
  });
}

function normalizeUnknown(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("agent_radar_unknown_invalid");
  return freeze({
    ...dimensionAndKey(input),
    state: "unknown",
    reason: text(input.reason, "agent_radar_unknown_reason", 240),
  });
}

function warning(code, dimension, message, evidenceRefs) {
  return freeze({ code, dimension, message, evidence_references: [...new Set(evidenceRefs)].sort() });
}

function factEvidenceRefs(fact) {
  return fact.evidence.map((row) => row.reference);
}

function truthyCapability(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return !["", "none", "false", "absent", "not_observed"].includes(value.toLowerCase());
  return Boolean(value && typeof value === "object");
}

function derivedWarnings(facts) {
  const current = new Map(facts.filter((fact) => fact.state === "verified" && fact.freshness_state === "current").map((fact) => [fact.key, fact]));
  const rules = [
    ["proxy_upgradeability", "UPGRADEABILITY_OBSERVED", "contract_control", "Proxy or upgrade capability observed."],
    ["owner_admin_powers", "ADMIN_CAPABILITY_OBSERVED", "contract_control", "Owner or administrator capability observed."],
    ["mint_authority", "MINT_AUTHORITY_OBSERVED", "contract_control", "Mint authority observed."],
    ["pause_freeze_blacklist", "PAUSE_FREEZE_OR_BLACKLIST_CAPABILITY_OBSERVED", "contract_control", "Pause, freeze, or blacklist capability observed."],
    ["transfer_restrictions", "TRANSFER_RESTRICTION_OBSERVED", "contract_control", "Transfer restriction observed."],
    ["transfer_tax", "TRANSFER_TAX_OBSERVED", "contract_control", "Transfer tax observed."],
    ["external_call_capability", "EXTERNAL_CALL_CAPABILITY_OBSERVED", "contract_control", "Unrestricted or broad external-call capability observed."],
    ["liquidity_removability", "LIQUIDITY_REMOVABILITY_OBSERVED", "liquidity_market_quality", "Liquidity removability observed."],
    ["creator_liquidity_control", "CREATOR_LIQUIDITY_CONTROL_OBSERVED", "liquidity_market_quality", "Creator-linked liquidity control observed."],
  ];
  const output = [];
  for (const [key, code, dimension, message] of rules) {
    const fact = current.get(key);
    if (fact && truthyCapability(fact.value)) output.push(warning(code, dimension, message, factEvidenceRefs(fact)));
  }
  const simulation = current.get("sell_simulation");
  if (simulation && [false, "failed", "reverted", "unavailable"].includes(simulation.value)) {
    output.push(warning("SELL_SIMULATION_FAILED", "contract_control", "Sell simulation failed or reverted.", factEvidenceRefs(simulation)));
  }
  return output;
}

function normalizeExplicitWarning(input, knownEvidence) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("agent_radar_warning_invalid");
  const code = text(input.code, "agent_radar_warning_code", 80).toUpperCase();
  const dimension = text(input.dimension, "agent_radar_warning_dimension", 40).toLowerCase();
  if (!WARNING_CODES.has(code) || !DIMENSIONS.has(dimension)) fail("agent_radar_warning_invalid");
  const evidenceReferences = Array.isArray(input.evidence_references)
    ? [...new Set(input.evidence_references.map((row) => text(row, "agent_radar_warning_evidence", 500)))].sort() : [];
  if (!evidenceReferences.length || evidenceReferences.some((reference) => !knownEvidence.has(reference))) {
    fail("agent_radar_warning_evidence_invalid");
  }
  return warning(code, dimension, text(input.message, "agent_radar_warning_message", 240), evidenceReferences);
}

function positiveActivityValue(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (value && typeof value === "object" && Number(value.count) > 0) return true;
  return false;
}

function statusFor(facts, claims) {
  const verifiedFacts = facts.filter((row) => row.state === "verified");
  const currentFacts = verifiedFacts.filter((row) => row.freshness_state === "current");
  const activityKeys = new Set(["task_completions", "onchain_actions", "trading_actions", "active_clients", "repeat_usage"]);
  const activity = currentFacts.filter((row) => activityKeys.has(row.key) && positiveActivityValue(row.value));
  if (activity.length) {
    return {
      state: "VERIFIED_ACTIVITY_OBSERVED",
      reason: "Current verified evidence records agent-attributable activity.",
      evidence_references: [...new Set(activity.flatMap(factEvidenceRefs))].sort(),
    };
  }
  if (claims.some((row) => row.dimension === "agent_utility")) {
    return {
      state: "CLAIMED_ACTIVITY_NOT_VERIFIED",
      reason: "Agent utility is claimed, but current verified activity evidence is unavailable.",
      evidence_references: [],
    };
  }
  if (verifiedFacts.some((row) => row.key === "token_contract" || row.dimension === "liquidity_market_quality")) {
    return {
      state: "TOKEN_EVIDENCE_ONLY",
      reason: "Token or market evidence exists, but functioning-agent activity is unverified.",
      evidence_references: [],
    };
  }
  return {
    state: "INSUFFICIENT_EVIDENCE",
    reason: "Neither current agent activity nor sufficient token evidence is verified.",
    evidence_references: [],
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
}

function projectionHash(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function buildRobinhoodAgentRadarProjection(input = {}) {
  if (Number(input.chain_id) !== 4663 || String(input.network || "").toLowerCase() !== "mainnet") {
    fail("agent_radar_chain_unsupported");
  }
  const generatedAt = timestamp(input.generated_at || new Date().toISOString(), "agent_radar_generated_at");
  const tokenContract = address(input.token_contract, "agent_radar_token_contract");
  const facts = (Array.isArray(input.facts) ? input.facts : []).map((row) => normalizeFact(row, 4663, generatedAt));
  const claims = (Array.isArray(input.claims) ? input.claims : []).map(normalizeClaim);
  const suppliedUnknowns = (Array.isArray(input.unknowns) ? input.unknowns : []).map(normalizeUnknown);
  for (const rows of [facts, claims, suppliedUnknowns]) {
    if (new Set(rows.map((row) => `${row.dimension}:${row.key}`)).size !== rows.length) fail("agent_radar_field_duplicate");
  }
  const tokenIdentityFact = facts.find((row) => row.dimension === "identity" && row.key === "token_contract");
  if (tokenIdentityFact && String(tokenIdentityFact.value || "").toLowerCase() !== tokenContract) {
    fail("agent_radar_token_identity_mismatch");
  }
  const factKeys = new Set(facts.map((row) => `${row.dimension}:${row.key}`));
  const claimKeys = new Set(claims.map((row) => `${row.dimension}:${row.key}`));
  const unknownByKey = new Map(suppliedUnknowns.map((row) => [`${row.dimension}:${row.key}`, row]));
  for (const [dimension, keys] of Object.entries(AgentRadarFieldCatalog)) {
    for (const key of keys) {
      const combined = `${dimension}:${key}`;
      if (factKeys.has(combined) || unknownByKey.has(combined)) continue;
      unknownByKey.set(combined, freeze({
        dimension,
        key,
        state: "unknown",
        reason: claimKeys.has(combined) ? "Claim present without independent verification." : "Evidence not supplied.",
      }));
    }
  }
  const unknowns = [...unknownByKey.values()].sort((left, right) => left.dimension.localeCompare(right.dimension) || left.key.localeCompare(right.key));
  facts.sort((left, right) => left.dimension.localeCompare(right.dimension) || left.key.localeCompare(right.key));
  claims.sort((left, right) => left.dimension.localeCompare(right.dimension) || left.key.localeCompare(right.key));
  const knownEvidence = new Set(facts.flatMap((fact) => factEvidenceRefs(fact)));
  const warningRows = [
    ...derivedWarnings(facts),
    ...(Array.isArray(input.warnings) ? input.warnings.map((row) => normalizeExplicitWarning(row, knownEvidence)) : []),
  ];
  const warnings = [...new Map(warningRows.map((row) => [`${row.code}:${row.evidence_references.join("|")}`, row])).values()]
    .sort((left, right) => left.code.localeCompare(right.code));
  const status = statusFor(facts, claims);
  const dimensions = Object.fromEntries(Object.keys(AgentRadarFieldCatalog).map((dimension) => {
    const dimensionFacts = facts.filter((row) => row.dimension === dimension);
    const dimensionClaims = claims.filter((row) => row.dimension === dimension);
    const dimensionUnknowns = unknowns.filter((row) => row.dimension === dimension);
    return [dimension, freeze({
      state: dimensionFacts.some((row) => row.state === "verified")
        ? dimensionUnknowns.length ? "partial" : "verified"
        : dimensionClaims.length ? "claims_only" : "unresolved",
      facts: dimensionFacts,
      claims: dimensionClaims,
      unknowns: dimensionUnknowns,
      warnings: warnings.filter((row) => row.dimension === dimension),
    })];
  }));
  const body = {
    schema_version: ROBINHOOD_AGENT_RADAR_SCHEMA,
    projection_version: 1,
    generated_at: generatedAt,
    chain: { chain_id: 4663, network: "mainnet", vm_family: "evm" },
    asset: { asset_id: `eip155:4663/erc20:${tokenContract}`, contract: tokenContract, standard: "erc20" },
    activity_assessment: status,
    dimensions,
    warnings,
    unresolved_count: unknowns.length,
    contradictory_fact_count: facts.filter((row) => row.state === "contradictory").length,
    stale_fact_count: facts.filter((row) => row.state === "stale").length,
    safety_assessment: "not_provided",
    profitability_assessment: facts.some((row) => row.key === "performance" && row.state === "verified")
      ? "evidence_available_for_review" : "unknown",
    limitations: [
      "Token market activity is not agent activity.",
      "Token volume is not agent revenue or profitability.",
      "Claims and external text remain untrusted until independently verified.",
      "This projection does not label a contract or agent safe.",
    ],
    execution_boundary: {
      transaction_construction: false,
      signing: false,
      broadcasting: false,
      live_execution: false,
    },
  };
  return freeze({ ...body, projection_hash: projectionHash(body) });
}
