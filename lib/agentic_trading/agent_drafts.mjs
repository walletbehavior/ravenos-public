import { createAgenticUserPolicy } from "./policy.mjs";
import { createAgentSpec } from "./records.mjs";
import {
  normalizeAssetIdentity,
  normalizeInstrumentIdentity,
} from "./identity.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const PAPER_AGENT_DRAFT_REQUEST_SCHEMA = "ravenos.agentic.paper_agent_draft_request.v1";
export const PAPER_AGENT_CAPITAL_SCHEMA = "ravenos.agentic.paper_capital_allocation.v1";
export const PAPER_AGENT_SCHEDULE_SCHEMA = "ravenos.agentic.paper_schedule.v1";
export const PAPER_AGENT_TEMPLATE = "solana_hyperliquid_sol_hedge";

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const ALLOWED_FIELDS = new Set([
  "schema_version",
  "idempotency_key",
  "name",
  "template",
  "notional_usdc",
  "solana_capital_usdc",
  "hyperliquid_capital_usdc",
  "cadence_minutes",
  "basis_entry_bps",
  "basis_exit_bps",
  "max_slippage_bps",
  "max_price_impact_bps",
  "adopt_policy",
]);
const CADENCE_MINUTES = new Set([1, 5, 15, 60]);

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function clean(value, field, maximum = 120) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${field}_invalid`);
  return normalized;
}

function integer(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${field}_invalid`);
  return parsed;
}

function decimalMicros(value, field, minimumMicros, maximumMicros) {
  const raw = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(raw)) throw new Error(`${field}_invalid`);
  const [whole, fraction = ""] = raw.split(".");
  const micros = (BigInt(whole) * 1_000_000n) + BigInt(fraction.padEnd(6, "0"));
  if (micros < BigInt(minimumMicros) || micros > BigInt(maximumMicros)) throw new Error(`${field}_out_of_bounds`);
  return micros;
}

function decimalFromMicros(micros) {
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function exactIdentities() {
  const solanaUsdc = normalizeAssetIdentity({
    chain_id: "solana",
    kind: "stablecoin",
    standard: "spl",
    reference: SOLANA_USDC_MINT,
    symbol: "USDC",
    decimals: 6,
    issuer_id: "circle",
    representation: "canonical",
    verification_state: "verified",
  });
  const solanaNativeSol = normalizeAssetIdentity({
    chain_id: "solana",
    kind: "native",
    standard: "native",
    reference: "SOL",
    symbol: "SOL",
    decimals: 9,
    representation: "native",
    verification_state: "verified",
  });
  const solanaWrappedSol = normalizeAssetIdentity({
    chain_id: "solana",
    kind: "wrapped_native",
    standard: "spl",
    reference: SOLANA_WRAPPED_SOL_MINT,
    symbol: "SOL",
    decimals: 9,
    representation: "wrapped",
    underlying_asset_id: solanaNativeSol.asset_id,
    verification_state: "verified",
  });
  const solanaSpot = normalizeInstrumentIdentity({
    kind: "spot",
    venue: "jupiter",
    base_asset: solanaWrappedSol,
    quote_asset: solanaUsdc,
    settlement_asset: solanaUsdc,
    market_reference: `${SOLANA_WRAPPED_SOL_MINT}:${SOLANA_USDC_MINT}`,
    display_symbol: "SOL/USDC",
  });
  const hyperliquidUsdc = normalizeAssetIdentity({
    chain_id: "hyperliquid",
    kind: "stablecoin",
    standard: "venue-asset",
    reference: "USDC",
    symbol: "USDC",
    decimals: 6,
    issuer_id: "circle",
    representation: "canonical",
    verification_state: "verified",
  });
  const hyperliquidSol = normalizeAssetIdentity({
    chain_id: "hyperliquid",
    kind: "fungible_token",
    standard: "venue-asset",
    reference: "SOL",
    symbol: "SOL",
    decimals: 9,
    representation: "native",
    verification_state: "verified",
  });
  const hyperliquidPerp = normalizeInstrumentIdentity({
    kind: "perpetual",
    venue: "hyperliquid",
    base_asset: hyperliquidSol,
    quote_asset: hyperliquidUsdc,
    settlement_asset: hyperliquidUsdc,
    market_reference: "SOL",
    display_symbol: "SOL-PERP",
  });
  return { solanaUsdc, solanaNativeSol, solanaSpot, hyperliquidUsdc, hyperliquidPerp };
}

function sealCapitalAllocation({ agentId, ownerTenantId, solanaCapitalMicros, hyperliquidCapitalMicros, identities, createdAt }) {
  const core = {
    schema_version: PAPER_AGENT_CAPITAL_SCHEMA,
    capital_version_id: `${agentId}:capital:v1`,
    agent_id: agentId,
    owner_tenant_id: ownerTenantId,
    version: 1,
    environment: "paper",
    allocations: [
      {
        chain_id: "solana:mainnet-beta",
        venue_id: "jupiter@solana:mainnet-beta#mainnet",
        asset_id: identities.solanaUsdc.asset_id,
        amount_atomic: solanaCapitalMicros.toString(),
        decimals: 6,
        display_amount: `${decimalFromMicros(solanaCapitalMicros)} USDC`,
        role: "trading_capital",
      },
      {
        chain_id: "solana:mainnet-beta",
        venue_id: "jupiter@solana:mainnet-beta#mainnet",
        asset_id: identities.solanaNativeSol.asset_id,
        amount_atomic: "50000000",
        decimals: 9,
        display_amount: "0.05 SOL",
        role: "paper_gas_reserve",
      },
      {
        chain_id: "hyperliquid:mainnet",
        venue_id: "hyperliquid@hyperliquid:mainnet#mainnet",
        asset_id: identities.hyperliquidUsdc.asset_id,
        amount_atomic: hyperliquidCapitalMicros.toString(),
        decimals: 6,
        display_amount: `${decimalFromMicros(hyperliquidCapitalMicros)} USDC`,
        role: "trading_capital",
      },
    ],
    created_at: createdAt,
    live_execution_enabled: false,
  };
  return freeze({ ...core, record_hash: agenticContractHash(core) });
}

function scheduleRecord({ agentId, cadenceMinutes, createdAt }) {
  const core = {
    schema_version: PAPER_AGENT_SCHEDULE_SCHEMA,
    schedule_id: `${agentId}:schedule`,
    agent_id: agentId,
    trigger_kind: "interval",
    interval_seconds: cadenceMinutes * 60,
    state: "draft",
    next_run_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    live_execution_enabled: false,
  };
  return freeze({ ...core, schedule_hash: agenticContractHash(core) });
}

export function verifyPaperCapitalAllocation(record) {
  if (!record || record.schema_version !== PAPER_AGENT_CAPITAL_SCHEMA || record.environment !== "paper" || record.live_execution_enabled !== false) return false;
  const { record_hash: supplied, ...core } = record;
  return Boolean(supplied && agenticContractHash(core) === supplied);
}

export function compilePaperAgentDraft(input = {}, {
  owner_tenant_id: ownerTenantId,
  now = Date.now(),
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("agent_draft_request_invalid");
  const unknown = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new Error(`agent_draft_field_forbidden:${unknown.sort()[0]}`);
  if (input.schema_version && input.schema_version !== PAPER_AGENT_DRAFT_REQUEST_SCHEMA) throw new Error("agent_draft_schema_invalid");
  if (input.adopt_policy !== true) throw new Error("agent_policy_explicit_adoption_required");
  const tenantId = clean(ownerTenantId, "owner_tenant_id", 120);
  const idempotencyKey = clean(input.idempotency_key, "agent_draft_idempotency_key", 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(idempotencyKey)) throw new Error("agent_draft_idempotency_key_invalid");
  const name = clean(input.name, "agent_name", 80);
  const template = String(input.template || PAPER_AGENT_TEMPLATE).trim().toLowerCase();
  if (template !== PAPER_AGENT_TEMPLATE) throw new Error("agent_template_unsupported");
  const notionalMicros = decimalMicros(input.notional_usdc, "notional_usdc", 10_000_000n, 10_000_000_000n);
  const solanaCapitalMicros = decimalMicros(input.solana_capital_usdc, "solana_capital_usdc", 10_000_000n, 100_000_000_000n);
  const hyperliquidCapitalMicros = decimalMicros(input.hyperliquid_capital_usdc, "hyperliquid_capital_usdc", 10_000_000n, 100_000_000_000n);
  if (solanaCapitalMicros < notionalMicros || hyperliquidCapitalMicros < notionalMicros) throw new Error("venue_local_capital_below_leg_notional");
  const cadenceMinutes = integer(input.cadence_minutes ?? 5, "cadence_minutes", 1, 60);
  if (!CADENCE_MINUTES.has(cadenceMinutes)) throw new Error("cadence_minutes_unsupported");
  const basisEntryBps = integer(input.basis_entry_bps ?? 30, "basis_entry_bps", 1, 2_000);
  const basisExitBps = integer(input.basis_exit_bps ?? 10, "basis_exit_bps", 0, basisEntryBps);
  if (basisExitBps >= basisEntryBps) throw new Error("basis_exit_must_be_below_entry");
  const maxSlippageBps = integer(input.max_slippage_bps ?? 75, "max_slippage_bps", 1, 300);
  const maxPriceImpactBps = integer(input.max_price_impact_bps ?? 100, "max_price_impact_bps", 1, 500);
  const createdAt = new Date(now).toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("agent_created_at_invalid");
  const requestFingerprint = agenticContractHash({
    schema_version: PAPER_AGENT_DRAFT_REQUEST_SCHEMA,
    owner_tenant_id: tenantId,
    idempotency_key: idempotencyKey,
    name,
    template,
    notional_usdc_micros: notionalMicros.toString(),
    solana_capital_usdc_micros: solanaCapitalMicros.toString(),
    hyperliquid_capital_usdc_micros: hyperliquidCapitalMicros.toString(),
    cadence_minutes: cadenceMinutes,
    basis_entry_bps: basisEntryBps,
    basis_exit_bps: basisExitBps,
    max_slippage_bps: maxSlippageBps,
    max_price_impact_bps: maxPriceImpactBps,
  });
  const agentId = `agt_${agenticContractHash({ owner_tenant_id: tenantId, idempotency_key: idempotencyKey }).slice(0, 28)}`;
  const policyId = `aup_${agenticContractHash({ agent_id: agentId, version: 1 }).slice(0, 28)}`;
  const identities = exactIdentities();
  const planNotionalMicros = notionalMicros * 2n;
  const totalCapitalMicros = solanaCapitalMicros + hyperliquidCapitalMicros;
  const policy = createAgenticUserPolicy({
    policy_id: policyId,
    version: 1,
    owner_tenant_id: tenantId,
    authority: "user",
    adoption_state: "active",
    created_at: createdAt,
    allowed_chain_ids: ["solana:mainnet-beta", "hyperliquid:mainnet"],
    allowed_venue_ids: ["jupiter@solana:mainnet-beta#mainnet", "hyperliquid@hyperliquid:mainnet#mainnet"],
    allowed_instrument_ids: [identities.solanaSpot.instrument_id, identities.hyperliquidPerp.instrument_id],
    allowed_actions: ["buy", "open_short", "reduce", "close"],
    limits: {
      max_leg_notional_usdc_micros: notionalMicros.toString(),
      max_plan_notional_usdc_micros: planNotionalMicros.toString(),
      max_agent_capital_usdc_micros: totalCapitalMicros.toString(),
      max_partial_plan_exposure_usdc_micros: notionalMicros.toString(),
      max_unhedged_duration_ms: 5_000,
      max_price_impact_bps: maxPriceImpactBps,
      max_slippage_bps: maxSlippageBps,
      max_total_cost_usdc_micros: ((planNotionalMicros * 500n) / 10_000n).toString(),
      manual_approval_above_usdc_micros: null,
    },
    minimum_native_gas_by_location: [{
      chain_id: "solana:mainnet-beta",
      venue_id: "jupiter@solana:mainnet-beta#mainnet",
      asset_id: identities.solanaNativeSol.asset_id,
      minimum_atomic: "10000000",
    }],
    evidence_requirements: {
      maximum_age_ms: 5_000,
      minimum_finality: "confirmed",
      require_verified_identity: true,
      require_provider_healthy: true,
      contradictions_block: true,
    },
    decision_ttl_ms: 5_000,
  });
  const notional = decimalFromMicros(notionalMicros);
  const spec = createAgentSpec({
    agent_id: agentId,
    version: 1,
    owner_tenant_id: tenantId,
    name,
    description: "Paper SOL spot exposure with a policy-required Hyperliquid perpetual hedge.",
    strategy_type: "cross_venue",
    allowed_chains: ["solana", "hyperliquid"],
    allowed_venues: ["jupiter", "hyperliquid"],
    allowed_instruments: [identities.solanaSpot, identities.hyperliquidPerp],
    evidence_requirements: [
      { requirement_id: "solana_market", evidence_type: "executable_market", material: true, maximum_age_ms: 5_000, minimum_finality: "confirmed", allowed_providers: ["jupiter"] },
      { requirement_id: "hyperliquid_market", evidence_type: "executable_market", material: true, maximum_age_ms: 5_000, minimum_finality: "provider_confirmed", allowed_providers: ["hyperliquid"] },
      { requirement_id: "portfolio", evidence_type: "unified_portfolio", material: true, maximum_age_ms: 5_000, minimum_finality: "provider_confirmed", allowed_providers: ["raven"] },
    ],
    entry_rules: { signal: "solana_hyperliquid_basis", enter_at_absolute_basis_bps: basisEntryBps },
    exit_rules: { exit_at_absolute_basis_bps: basisExitBps, maximum_hold_seconds: 3_600 },
    position_sizing: { mode: "fixed_notional", value: notional, asset_id: identities.solanaUsdc.asset_id, maximum_per_leg: notional, maximum_total: decimalFromMicros(planNotionalMicros) },
    multi_leg_dependency_rules: { atomicity_assumed: false, execution_order: ["solana_spot", "hyperliquid_hedge"], maximum_unhedged_ms: 5_000 },
    hedge_requirements: { required: true, hedge_instrument_id: identities.hyperliquidPerp.instrument_id, target_delta: "0" },
    rebalancing_rules: { automatic_compensation: false },
    triggers: { type: "interval", cadence_seconds: cadenceMinutes * 60, schedule: `Every ${cadenceMinutes}m` },
    autonomy_level: "paper",
    risk_policy_ref: policy,
    approval_requirements: { paper: false, live: true },
    starts_at: createdAt,
    expires_at: null,
    planner_model_version: "none:deterministic-template",
    compiler_version: "ravenos-paper-agent-compiler-v1",
  });
  const capital = sealCapitalAllocation({ agentId, ownerTenantId: tenantId, solanaCapitalMicros, hyperliquidCapitalMicros, identities, createdAt });
  const schedule = scheduleRecord({ agentId, cadenceMinutes, createdAt });
  return freeze({
    schema_version: "ravenos.agentic.paper_agent_draft_package.v1",
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint,
    agent: { agent_id: agentId, display_name: name, lifecycle_state: "draft", environment: "paper", live_execution_enabled: false },
    spec,
    policy,
    capital,
    schedule,
  });
}
