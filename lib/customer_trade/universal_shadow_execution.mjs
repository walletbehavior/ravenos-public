export const UNIVERSAL_QUOTE_REQUEST_SCHEMA = "ravenos.universal_quote_request.v1";
export const UNIVERSAL_ROUTE_CANDIDATE_SCHEMA = "ravenos.universal_route_candidate.v1";
export const UNIVERSAL_SHADOW_EXECUTION_SCHEMA = "ravenos.universal_shadow_execution.v1";
export const UNIVERSAL_USDC_BUYING_POWER_SCHEMA = "ravenos.universal_usdc_buying_power.v1";

export const UniversalRouteStates = Object.freeze({
  DISCOVERABLE: "discoverable",
  MARKED: "marked",
  BUY_QUOTEABLE: "buy_quoteable",
  SELL_QUOTEABLE: "sell_quoteable",
  EXIT_VERIFIED: "exit_verified",
  EXECUTABLE: "executable",
  STALE: "stale",
  UNROUTEABLE: "unrouteable",
  RESTRICTED: "restricted",
  UNSAFE: "unsafe",
  UNAVAILABLE: "unavailable",
});

export const UniversalExecutionLifecycle = Object.freeze([
  "quoted",
  "authorized",
  "source_submitted",
  "source_confirmed",
  "destination_pending",
  "destination_filled",
  "settled",
  "quote_expired",
  "source_failed",
  "destination_failed",
  "refund_pending",
  "refunded",
  "failed",
  "indeterminate",
]);

export const CanonicalUsdcRegistry = Object.freeze({
  solana: Object.freeze({ chain: "solana", network: "mainnet", standard: "spl", decimals: 6, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", issuer: "circle", representation: "native_usdc" }),
  ethereum: Object.freeze({ chain: "ethereum", network: "mainnet", standard: "erc20", decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", issuer: "circle", representation: "native_usdc" }),
  base: Object.freeze({ chain: "base", network: "mainnet", standard: "erc20", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", issuer: "circle", representation: "native_usdc" }),
  arbitrum: Object.freeze({ chain: "arbitrum", network: "mainnet", standard: "erc20", decimals: 6, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", issuer: "circle", representation: "native_usdc" }),
  avalanche: Object.freeze({ chain: "avalanche", network: "mainnet", standard: "erc20", decimals: 6, address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", issuer: "circle", representation: "native_usdc" }),
  optimism: Object.freeze({ chain: "optimism", network: "mainnet", standard: "erc20", decimals: 6, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", issuer: "circle", representation: "native_usdc" }),
  polygon: Object.freeze({ chain: "polygon", network: "mainnet", standard: "erc20", decimals: 6, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", issuer: "circle", representation: "native_usdc" }),
  sui: Object.freeze({ chain: "sui", network: "mainnet", standard: "move", decimals: 6, address: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", issuer: "circle", representation: "native_usdc" }),
});

const POLICIES = new Set(["friction_complete_outcome", "maximum_minimum_output", "lowest_total_usdc_cost", "fastest_settlement", "minimum_trust_dependencies", "minimum_transaction_count"]);
const ROUTE_STATES = new Set(["route_available", "entry_only", "stale", "unrouteable", "restricted", "unsafe", "unavailable"]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, field, maximum = 160, { optional = false, lower = false } = {}) {
  const clean = String(value ?? "").trim();
  if ((!optional && !clean) || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) fail(`${field}_invalid`);
  return lower ? clean.toLowerCase() : clean;
}

function number(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function iso(value, field) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) fail(`${field}_invalid`);
  return new Date(ms).toISOString();
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function addressEqual(chain, left, right) {
  return new Set(["ethereum", "base", "arbitrum", "avalanche", "optimism", "polygon"]).has(chain)
    ? String(left).toLowerCase() === String(right).toLowerCase()
    : String(left) === String(right);
}

export function canonicalUsdcForChain(chain) {
  return CanonicalUsdcRegistry[String(chain || "").trim().toLowerCase()] || null;
}

export function classifyUsdcAsset(asset = {}) {
  const chain = text(asset.chain, "asset_chain", 32, { lower: true });
  const address = text(asset.address, "asset_address", 160);
  const canonical = canonicalUsdcForChain(chain);
  if (!canonical) return freeze({ state: "unavailable", chain, address, canonical: false, reason: "chain_not_in_canonical_usdc_registry" });
  if (!addressEqual(chain, address, canonical.address)) {
    return freeze({ state: "unrecognized_usdc_representation", chain, address, canonical: false, reason: "address_does_not_match_circle_native_usdc" });
  }
  return freeze({ state: "canonical_native_usdc", ...canonical, canonical: true });
}

export function createUniversalQuoteRequest(input = {}) {
  const amount = number(input.source_amount_usdc, "source_amount_usdc", { minimum: 0.01, maximum: 1_000_000 });
  const destination = input.destination_asset && typeof input.destination_asset === "object" ? input.destination_asset : {};
  const policy = text(input.policy || "friction_complete_outcome", "policy", 48, { lower: true });
  if (!POLICIES.has(policy)) fail("policy_invalid");
  const chain = text(destination.chain, "destination_chain", 32, { lower: true });
  const address = text(destination.address, "destination_address", 180);
  const sourceOverride = input.source_chain_override == null || input.source_chain_override === ""
    ? null
    : text(input.source_chain_override, "source_chain_override", 32, { lower: true });
  return freeze({
    schema_version: UNIVERSAL_QUOTE_REQUEST_SCHEMA,
    request_id: text(input.request_id, "request_id", 120),
    requested_at: iso(input.requested_at, "requested_at"),
    source_economic_asset: "canonical_usdc",
    source_amount_usdc: amount,
    source_chain_override: sourceOverride,
    funding_selection: sourceOverride ? "user_chain_override" : "aggregate_routable_usdc",
    destination_asset: {
      chain,
      network: text(destination.network || "mainnet", "destination_network", 32, { lower: true }),
      address,
      standard: text(destination.standard, "destination_standard", 32, { lower: true }),
      exact_market_id: text(destination.exact_market_id, "destination_exact_market_id", 180),
      symbol: text(destination.symbol, "destination_symbol", 40, { optional: true }) || null,
    },
    maximum_slippage_bps: Math.trunc(number(input.maximum_slippage_bps ?? 50, "maximum_slippage_bps", { minimum: 1, maximum: 3_000 })),
    policy,
    signing_requested: false,
    submission_requested: false,
  });
}

export function normalizeUniversalRouteCandidate(input = {}) {
  const state = text(input.state, "route_state", 32, { lower: true });
  if (!ROUTE_STATES.has(state)) fail("route_state_invalid");
  const createdAt = iso(input.created_at, "route_created_at");
  const expiresAt = iso(input.expires_at, "route_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail("route_expiry_invalid");
  const fees = input.costs_usdc && typeof input.costs_usdc === "object" ? input.costs_usdc : {};
  const result = {
    schema_version: UNIVERSAL_ROUTE_CANDIDATE_SCHEMA,
    candidate_id: text(input.candidate_id, "candidate_id", 160),
    provider: text(input.provider, "provider", 80),
    state,
    source_chain: text(input.source_chain, "source_chain", 32, { lower: true }),
    destination_chain: text(input.destination_chain, "destination_chain", 32, { lower: true }),
    source_asset_id: text(input.source_asset_id, "source_asset_id", 220),
    destination_asset_id: text(input.destination_asset_id, "destination_asset_id", 220),
    expected_output: number(input.expected_output, "expected_output", { minimum: 0, optional: state !== "route_available" }),
    minimum_output: number(input.minimum_output, "minimum_output", { minimum: 0, optional: state !== "route_available" }),
    costs_usdc: {
      network: number(fees.network, "cost_network", { minimum: 0, optional: true }),
      bridge: number(fees.bridge, "cost_bridge", { minimum: 0, optional: true }),
      provider: number(fees.provider, "cost_provider", { minimum: 0, optional: true }),
      raven: number(fees.raven, "cost_raven", { minimum: 0, optional: true }),
    },
    price_impact_bps: number(input.price_impact_bps, "price_impact_bps", { minimum: 0, maximum: 100_000, optional: true }),
    estimated_settlement_ms: number(input.estimated_settlement_ms, "estimated_settlement_ms", { minimum: 0, optional: true }),
    transaction_count: Math.trunc(number(input.transaction_count, "transaction_count", { minimum: 0, maximum: 32 })),
    trust_dependencies: [...new Set((Array.isArray(input.trust_dependencies) ? input.trust_dependencies : []).slice(0, 16).map((row, index) => text(row, `trust_dependency_${index}`, 80)))],
    venues: [...new Set((Array.isArray(input.venues) ? input.venues : []).slice(0, 16).map((row, index) => text(row, `venue_${index}`, 80)))],
    intermediate_asset_ids: [...new Set((Array.isArray(input.intermediate_asset_ids) ? input.intermediate_asset_ids : []).slice(0, 16).map((row, index) => text(row, `intermediate_asset_${index}`, 220)))],
    created_at: createdAt,
    expires_at: expiresAt,
    refusal_reasons: (Array.isArray(input.refusal_reasons) ? input.refusal_reasons : []).slice(0, 16).map((row, index) => text(row, `refusal_reason_${index}`, 120)),
    raw_provider_payload_included: false,
    transaction_material_included: false,
  };
  if (state === "route_available" && result.minimum_output > result.expected_output) fail("route_minimum_output_invalid");
  return freeze(result);
}

function totalKnownCosts(candidate) {
  const rows = Object.values(candidate.costs_usdc);
  return rows.some((value) => value === null) ? null : rows.reduce((sum, value) => sum + value, 0);
}

export function selectUniversalRouteCandidate(candidates = [], policy = "friction_complete_outcome") {
  if (!POLICIES.has(policy)) fail("policy_invalid");
  const available = candidates.filter((row) => row?.schema_version === UNIVERSAL_ROUTE_CANDIDATE_SCHEMA && row.state === "route_available");
  if (!available.length) return freeze({ state: "unavailable", selected_candidate_id: null, reason: "no_route_available", evaluated_candidate_count: candidates.length });
  const sortable = available.filter((row) => policy !== "friction_complete_outcome" || totalKnownCosts(row) !== null);
  if (!sortable.length && available.length === 1) return freeze({
    state: "selected_for_shadow_review",
    selected_candidate_id: available[0].candidate_id,
    policy,
    comparison_complete: false,
    reason: "only_available_candidate_friction_incomplete",
    evaluated_candidate_count: candidates.length,
    eligible_candidate_count: 1,
    deterministic_tie_breaker: "not_required",
  });
  if (!sortable.length) return freeze({ state: "unavailable", selected_candidate_id: null, reason: "friction_incomplete", evaluated_candidate_count: candidates.length });
  const ordered = [...sortable].sort((left, right) => {
    const comparisons = policy === "maximum_minimum_output"
      ? [right.minimum_output - left.minimum_output]
      : policy === "fastest_settlement"
        ? [(left.estimated_settlement_ms ?? Infinity) - (right.estimated_settlement_ms ?? Infinity)]
        : policy === "minimum_trust_dependencies"
          ? [left.trust_dependencies.length - right.trust_dependencies.length]
          : policy === "minimum_transaction_count"
            ? [left.transaction_count - right.transaction_count]
            : policy === "lowest_total_usdc_cost"
              ? [(totalKnownCosts(left) ?? Infinity) - (totalKnownCosts(right) ?? Infinity)]
              : [right.minimum_output - totalKnownCosts(right) - (left.minimum_output - totalKnownCosts(left))];
    return comparisons.find((value) => value !== 0) || left.candidate_id.localeCompare(right.candidate_id);
  });
  return freeze({ state: "selected", selected_candidate_id: ordered[0].candidate_id, policy, evaluated_candidate_count: candidates.length, eligible_candidate_count: sortable.length, deterministic_tie_breaker: "candidate_id_ascending" });
}

export function createRoundTripProof({ spend_usdc, entry, exit, observed_at } = {}) {
  const spend = number(spend_usdc, "spend_usdc", { minimum: 0.01, maximum: 1_000_000 });
  if (!entry || entry.state !== "route_available") return freeze({ state: "entry_unavailable", exit_verified: false, trade_available: false });
  if (!exit || exit.state !== "route_available") return freeze({ state: "exit_unresolved", exit_verified: false, trade_available: false, entry_quote_available: true });
  if (entry.destination_asset_id !== exit.source_asset_id || entry.source_asset_id !== exit.destination_asset_id) fail("round_trip_asset_mismatch");
  const entryCosts = totalKnownCosts(entry);
  const exitCosts = totalKnownCosts(exit);
  if (entryCosts === null || exitCosts === null) return freeze({
    state: "friction_incomplete",
    observed_at: iso(observed_at, "round_trip_observed_at"),
    exit_verified: true,
    trade_available: false,
    entry_quote_available: true,
    exit_quote_available: true,
    spend_usdc: spend,
    expected_destination_quantity: entry.expected_output,
    minimum_destination_quantity: entry.minimum_output,
    current_executable_liquidation_usdc: exit.expected_output,
    minimum_executable_liquidation_usdc: exit.minimum_output,
    round_trip_friction_pct: null,
    minimum_round_trip_friction_pct: null,
    unavailable_cost_components: [
      ...(entryCosts === null ? ["entry_network_or_route_cost"] : []),
      ...(exitCosts === null ? ["exit_network_or_route_cost"] : []),
    ],
    marked_value_used_as_liquidation_value: false,
  });
  const expectedExit = Math.max(0, exit.expected_output - exitCosts);
  const minimumExit = Math.max(0, exit.minimum_output - exitCosts);
  const allInSpend = spend + entryCosts;
  const friction = allInSpend <= 0 ? null : ((allInSpend - expectedExit) / allInSpend) * 100;
  const minimumFriction = allInSpend <= 0 ? null : ((allInSpend - minimumExit) / allInSpend) * 100;
  return freeze({
    state: "exit_verified",
    observed_at: iso(observed_at, "round_trip_observed_at"),
    entry_quote_available: true,
    exit_quote_available: true,
    exit_verified: true,
    trade_available: true,
    spend_usdc: spend,
    all_in_entry_cost_usdc: allInSpend,
    expected_destination_quantity: entry.expected_output,
    minimum_destination_quantity: entry.minimum_output,
    current_executable_liquidation_usdc: expectedExit,
    minimum_executable_liquidation_usdc: minimumExit,
    round_trip_friction_pct: friction,
    minimum_round_trip_friction_pct: minimumFriction,
    marked_value_used_as_liquidation_value: false,
  });
}

export function createUniversalShadowExecution({ request, candidates, selected, entry, exit, proof, observed_at } = {}) {
  const destination = request?.destination_asset || {};
  const refusal = proof?.exit_verified === true ? [] : [proof?.state || "route_unavailable"];
  return freeze({
    schema_version: UNIVERSAL_SHADOW_EXECUTION_SCHEMA,
    observation_id: `shadow_${text(request?.request_id, "request_id", 120)}`,
    observed_at: iso(observed_at, "shadow_observed_at"),
    mode: "shadow",
    destination_asset: destination,
    request,
    candidates,
    selection: selected,
    entry_route: entry || null,
    exit_route: exit || null,
    round_trip: proof,
    route_state: proof?.exit_verified ? UniversalRouteStates.EXIT_VERIFIED : entry?.state === "route_available" ? UniversalRouteStates.BUY_QUOTEABLE : UniversalRouteStates.UNAVAILABLE,
    refusal_reasons: refusal,
    execution: {
      allowed: false,
      shadow_only: true,
      private_keys_used: false,
      approvals_created: false,
      signing_available: false,
      submission_available: false,
      transaction_material_available: false,
    },
  });
}

export function aggregateUniversalUsdcBuyingPower(rows = [], { observed_at } = {}) {
  const normalized = rows.map((row, index) => {
    const classification = classifyUsdcAsset(row.asset);
    const amount = number(row.amount_usdc, `balance_${index}_amount_usdc`, { minimum: 0 });
    const state = text(row.state, `balance_${index}_state`, 24, { lower: true });
    if (!new Set(["available", "routable", "stale", "unavailable"]).has(state)) fail("balance_state_invalid");
    return { classification, amount_usdc: amount, state };
  });
  const sum = (predicate) => normalized.filter(predicate).reduce((total, row) => total + row.amount_usdc, 0);
  return freeze({
    schema_version: UNIVERSAL_USDC_BUYING_POWER_SCHEMA,
    observed_at: iso(observed_at, "buying_power_observed_at"),
    total_usdc: sum((row) => row.classification.canonical),
    available_usdc: sum((row) => row.classification.canonical && new Set(["available", "routable"]).has(row.state)),
    routable_usdc: sum((row) => row.classification.canonical && row.state === "routable"),
    stale_usdc: sum((row) => row.classification.canonical && row.state === "stale"),
    unavailable_usdc: sum((row) => row.classification.canonical && row.state === "unavailable"),
    unrecognized_usdc_like_usdc: sum((row) => !row.classification.canonical),
    double_counting_prevention: "one_chain_local_balance_row_per_canonical_asset; gateway_claims_not_added_to_underlying",
    balances: normalized,
  });
}
