import bs58 from "bs58";

import { canonicalContractHash } from "../customer_trade/contracts.mjs";
import {
  createEconomicExposure,
  createObservation,
  createPortfolioMeasurement,
  createPortfolioSnapshot,
  verifyGovernorRecord,
} from "./domain.mjs";

export const SOLANA_NATIVE_ASSET_ID = "solana:SOL";
export const SOLANA_WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const SOLANA_JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

export const SOLANA_TOKEN_PROGRAMS = Object.freeze([
  Object.freeze({
    program_id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    label: "spl_token",
  }),
  Object.freeze({
    program_id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    label: "token_2022",
  }),
]);

const BUILTIN_ASSET_DEFINITIONS = Object.freeze([
  Object.freeze({
    definition_id: "solana_native_sol_v1",
    asset_id: SOLANA_NATIVE_ASSET_ID,
    mint: null,
    symbol: "SOL",
    decimals: 9,
    instrument_kind: "native",
    underlying_mode: "self",
    underlying_asset_id: SOLANA_NATIVE_ASSET_ID,
    protocol_id: null,
    stablecoin_issuer_id: null,
    stablecoin_dependency_id: null,
    classification: "recognized",
  }),
  Object.freeze({
    definition_id: "solana_wrapped_sol_v1",
    asset_id: "solana:WSOL",
    mint: SOLANA_WRAPPED_SOL_MINT,
    symbol: "WSOL",
    decimals: 9,
    instrument_kind: "wrapped_native",
    underlying_mode: "exact",
    underlying_asset_id: SOLANA_NATIVE_ASSET_ID,
    conversion_numerator: "1",
    conversion_denominator: "1",
    protocol_id: "solana:spl_token",
    stablecoin_issuer_id: null,
    stablecoin_dependency_id: null,
    classification: "recognized",
  }),
  Object.freeze({
    definition_id: "solana_usdc_native_v1",
    asset_id: "solana:USDC",
    mint: SOLANA_USDC_MINT,
    symbol: "USDC",
    decimals: 6,
    instrument_kind: "stablecoin",
    underlying_mode: "self",
    underlying_asset_id: "solana:USDC",
    protocol_id: null,
    stablecoin_issuer_id: "circle",
    stablecoin_dependency_id: "circle:usd_reserve",
    classification: "recognized",
  }),
  Object.freeze({
    definition_id: "solana_usdt_native_v1",
    asset_id: "solana:USDT",
    mint: SOLANA_USDT_MINT,
    symbol: "USDT",
    decimals: 6,
    instrument_kind: "stablecoin",
    underlying_mode: "self",
    underlying_asset_id: "solana:USDT",
    protocol_id: null,
    stablecoin_issuer_id: "tether",
    stablecoin_dependency_id: "tether:usd_reserve",
    classification: "recognized",
  }),
  Object.freeze({
    definition_id: "solana_jitosol_v1",
    asset_id: "solana:JitoSOL",
    mint: SOLANA_JITOSOL_MINT,
    symbol: "JitoSOL",
    decimals: 9,
    instrument_kind: "liquid_staking_token",
    underlying_mode: "observed_conversion",
    underlying_asset_id: SOLANA_NATIVE_ASSET_ID,
    protocol_id: "jito",
    stablecoin_issuer_id: null,
    stablecoin_dependency_id: null,
    classification: "recognized",
  }),
]);

const OBSERVATION_KINDS = new Set([
  "solana_native_balance",
  "solana_token_accounts",
  "solana_asset_definition",
  "solana_conversion_state",
  "solana_mark_price",
  "solana_executable_exit",
  "solana_protocol_position",
]);

function text(value) {
  return String(value ?? "").trim();
}

function integerString(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`${field}_invalid`);
  const normalized = text(value);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function timestamp(value, field) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function validPublicKey(value) {
  try {
    return bs58.decode(text(value)).length === 32;
  } catch {
    return false;
  }
}

function observationId(kind, facts, observedAt) {
  return `obs_sol_${canonicalContractHash({ kind, facts, observed_at: observedAt }).slice(0, 24)}`;
}

function exposureId(positionId, dimensionType, scopeId, side) {
  return `exp_sol_${canonicalContractHash({ position_id: positionId, dimension_type: dimensionType, scope_id: scopeId, side }).slice(0, 24)}`;
}

function freshnessRank(value) {
  return ({ fresh: 5, current: 5, delayed: 3, stale: 2, unknown: 1, unavailable: 0 })[text(value).toLowerCase()] ?? 1;
}

function weakestFreshness(values) {
  const normalized = values.map((value) => text(value || "unknown").toLowerCase());
  return normalized.sort((left, right) => freshnessRank(left) - freshnessRank(right))[0] || "unknown";
}

function checkedObservation(record) {
  if (record?.record_type !== "Observation" || !verifyGovernorRecord(record).ok) throw new Error("solana_observation_invalid");
  const kind = text(record.facts?.observation_kind).toLowerCase();
  if (!OBSERVATION_KINDS.has(kind)) throw new Error("solana_observation_kind_invalid");
  return record;
}

function createSolanaObservation({ observedAt, sourceCategory, sourceReference, freshnessState = "fresh", observedBy = "external_source", facts }) {
  const kind = text(facts?.observation_kind).toLowerCase();
  if (!OBSERVATION_KINDS.has(kind)) throw new Error("solana_observation_kind_invalid");
  const at = timestamp(observedAt, "observed_at");
  return createObservation({
    observation_id: observationId(kind, facts, at),
    observed_at: at,
    observed_by: observedBy,
    source_category: sourceCategory,
    source_reference: sourceReference,
    freshness_state: freshnessState,
    facts,
  });
}

export function createSolanaAssetDefinitionObservation(definition = {}, observedAt) {
  const mint = text(definition.mint) || null;
  if (mint && !validPublicKey(mint)) throw new Error("asset_definition_mint_invalid");
  const facts = {
    observation_kind: "solana_asset_definition",
    definition_id: text(definition.definition_id) || `asset_def_${canonicalContractHash(definition).slice(0, 20)}`,
    asset_id: text(definition.asset_id) || (mint ? `solana:mint:${mint}` : ""),
    mint,
    symbol: text(definition.symbol) || null,
    decimals: definition.decimals === null || definition.decimals === undefined ? null : Number(definition.decimals),
    instrument_kind: text(definition.instrument_kind || "token").toLowerCase(),
    underlying_mode: text(definition.underlying_mode || "unresolved").toLowerCase(),
    underlying_asset_id: text(definition.underlying_asset_id) || null,
    conversion_numerator: integerString(definition.conversion_numerator, "conversion_numerator", { nullable: true }),
    conversion_denominator: integerString(definition.conversion_denominator, "conversion_denominator", { nullable: true }),
    protocol_id: text(definition.protocol_id) || null,
    stablecoin_issuer_id: text(definition.stablecoin_issuer_id) || null,
    stablecoin_dependency_id: text(definition.stablecoin_dependency_id) || null,
    classification: text(definition.classification || "recognized").toLowerCase(),
  };
  if (!facts.asset_id) throw new Error("asset_definition_asset_id_required");
  if (!["self", "exact", "observed_conversion", "unresolved"].includes(facts.underlying_mode)) {
    throw new Error("asset_definition_underlying_mode_invalid");
  }
  if (facts.decimals !== null && (!Number.isSafeInteger(facts.decimals) || facts.decimals < 0 || facts.decimals > 30)) {
    throw new Error("asset_definition_decimals_invalid");
  }
  if (["self", "exact", "observed_conversion"].includes(facts.underlying_mode) && !facts.underlying_asset_id) {
    throw new Error("asset_definition_underlying_asset_required");
  }
  if (facts.underlying_mode === "exact" && (
    facts.conversion_numerator === null
    || facts.conversion_denominator === null
    || BigInt(facts.conversion_denominator) === 0n
  )) throw new Error("asset_definition_exact_conversion_required");
  return createSolanaObservation({
    observedAt,
    observedBy: "raven",
    sourceCategory: "protocol_definition",
    sourceReference: "ravenos_asset_registry:solana:v1",
    freshnessState: "current",
    facts,
  });
}

export function createSolanaConversionObservation(input = {}) {
  const facts = {
    observation_kind: "solana_conversion_state",
    instrument_asset_id: text(input.instrument_asset_id),
    instrument_mint: text(input.instrument_mint) || null,
    underlying_asset_id: text(input.underlying_asset_id),
    input_amount_base_units: integerString(input.input_amount_base_units, "input_amount_base_units"),
    output_amount_base_units: integerString(input.output_amount_base_units, "output_amount_base_units"),
    evidence_method: text(input.evidence_method || "protocol_state"),
  };
  if (!facts.instrument_asset_id || !facts.underlying_asset_id) throw new Error("conversion_identity_required");
  if (BigInt(facts.input_amount_base_units) <= 0n || BigInt(facts.output_amount_base_units) <= 0n) {
    throw new Error("conversion_amount_must_be_positive");
  }
  return createSolanaObservation({
    observedAt: input.observed_at,
    sourceCategory: "protocol_state",
    sourceReference: text(input.source_reference || "protocol_state"),
    freshnessState: text(input.freshness_state || "fresh"),
    facts,
  });
}

export function createSolanaMarkObservation(input = {}) {
  const facts = {
    observation_kind: "solana_mark_price",
    asset_id: text(input.asset_id),
    mint: text(input.mint) || null,
    numeraire: text(input.numeraire || "USDC").toUpperCase(),
    price_numerator_minor: integerString(input.price_numerator_minor, "price_numerator_minor"),
    price_denominator_base_units: integerString(input.price_denominator_base_units, "price_denominator_base_units"),
    methodology: text(input.methodology || "observed_mark"),
  };
  if (!facts.asset_id && !facts.mint) throw new Error("mark_identity_required");
  if (BigInt(facts.price_denominator_base_units) <= 0n) throw new Error("mark_denominator_must_be_positive");
  return createSolanaObservation({
    observedAt: input.observed_at,
    sourceCategory: "market_price",
    sourceReference: text(input.source_reference || "existing_market_data_adapter"),
    freshnessState: text(input.freshness_state || "fresh"),
    facts,
  });
}

export function createSolanaExecutableExitObservation(input = {}) {
  const routeability = text(input.routeability || "routeable").toLowerCase();
  if (!["routeable", "not_routeable", "unknown"].includes(routeability)) throw new Error("exit_routeability_invalid");
  const facts = {
    observation_kind: "solana_executable_exit",
    position_id: text(input.position_id) || null,
    economic_lot_id: text(input.economic_lot_id) || null,
    input_asset_id: text(input.input_asset_id) || null,
    input_mint: text(input.input_mint) || null,
    input_amount_base_units: integerString(input.input_amount_base_units, "input_amount_base_units"),
    output_asset_id: text(input.output_asset_id || "solana:USDC"),
    expected_output_minor: integerString(input.expected_output_minor, "expected_output_minor", { nullable: true }),
    minimum_output_minor: integerString(input.minimum_output_minor, "minimum_output_minor", { nullable: true }),
    routeability,
    expires_at: input.expires_at ? timestamp(input.expires_at, "expires_at") : null,
    provider: text(input.provider || "Jupiter"),
    transaction_material_available: false,
  };
  if (!facts.position_id && !facts.economic_lot_id && !facts.input_mint && !facts.input_asset_id) {
    throw new Error("exit_quote_identity_required");
  }
  if (BigInt(facts.input_amount_base_units) <= 0n) throw new Error("exit_quote_input_must_be_positive");
  if (routeability === "routeable" && (!facts.expected_output_minor || !facts.minimum_output_minor)) {
    throw new Error("routeable_exit_value_required");
  }
  if (routeability === "routeable" && (
    BigInt(facts.minimum_output_minor) <= 0n
    || BigInt(facts.expected_output_minor) < BigInt(facts.minimum_output_minor)
  )) throw new Error("routeable_exit_value_invalid");
  return createSolanaObservation({
    observedAt: input.observed_at,
    sourceCategory: "executable_valuation",
    sourceReference: text(input.source_reference || "jupiter_quote_only"),
    freshnessState: text(input.freshness_state || "fresh"),
    facts,
  });
}

export function createSolanaProtocolPositionObservation(input = {}) {
  const components = (Array.isArray(input.components) ? input.components : []).map((row, index) => {
    const decimals = row.decimals === null || row.decimals === undefined ? null : Number(row.decimals);
    const exposureSide = text(row.exposure_side || input.exposure_side || "asset").toLowerCase();
    if (decimals !== null && (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30)) {
      throw new Error(`components[${index}].decimals_invalid`);
    }
    if (!["asset", "liability"].includes(exposureSide)) throw new Error(`components[${index}].exposure_side_invalid`);
    return {
      asset_id: text(row.asset_id) || null,
      mint: text(row.mint) || null,
      amount_base_units: integerString(row.amount_base_units, `components[${index}].amount_base_units`),
      decimals,
      exposure_side: exposureSide,
    };
  });
  const facts = {
    observation_kind: "solana_protocol_position",
    position_id: text(input.position_id),
    economic_lot_id: text(input.economic_lot_id || input.position_id),
    instrument_asset_id: text(input.instrument_asset_id),
    instrument_mint: text(input.instrument_mint) || null,
    position_kind: text(input.position_kind).toLowerCase(),
    exposure_side: text(input.exposure_side || "asset").toLowerCase(),
    protocol_id: text(input.protocol_id),
    protocol_position_id: text(input.protocol_position_id || input.position_id),
    pool_id: text(input.pool_id) || null,
    amount_base_units: integerString(input.amount_base_units, "amount_base_units", { nullable: true }),
    decimals: input.decimals === null || input.decimals === undefined ? null : Number(input.decimals),
    components,
    underlying_state: text(input.underlying_state || (components.length ? "observed" : "unavailable")).toLowerCase(),
    withdrawal_state: text(input.withdrawal_state || "unknown").toLowerCase(),
    representation_token_account_ids: [...new Set((input.representation_token_account_ids || []).map(text).filter(Boolean))].sort(),
    position_state: text(input.position_state || "open").toLowerCase(),
  };
  if (!facts.position_id || !facts.instrument_asset_id || !facts.protocol_id || !facts.position_kind) {
    throw new Error("protocol_position_identity_required");
  }
  return createSolanaObservation({
    observedAt: input.observed_at,
    sourceCategory: "protocol_position",
    sourceReference: text(input.source_reference || `${facts.protocol_id}:read_only_position`),
    freshnessState: text(input.freshness_state || "fresh"),
    facts,
  });
}

async function rpcFetch(rpcUrl, method, params, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) throw new Error(`rpc_${method}_failed`);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function observeSolanaWallet({
  wallet_address: walletAddress,
  wallet_reference: walletReference,
  rpc_url: rpcUrl,
  rpc_request: rpcRequest,
  provider = "solana_rpc",
  observed_at: observedAt,
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = 5_000,
} = {}) {
  if (!validPublicKey(walletAddress)) throw new Error("solana_wallet_address_invalid");
  const accountRef = text(walletReference);
  if (!accountRef) throw new Error("wallet_reference_required");
  if (accountRef === text(walletAddress)) throw new Error("wallet_reference_must_be_opaque");
  if (!rpcRequest && !text(rpcUrl)) throw new Error("solana_rpc_required");
  const at = timestamp(observedAt || new Date().toISOString(), "observed_at");
  const call = rpcRequest || ((method, params) => rpcFetch(rpcUrl, method, params, { fetchImpl, timeoutMs }));
  const operations = [
    { kind: "native", method: "getBalance", params: [walletAddress, { commitment: "confirmed" }] },
    ...SOLANA_TOKEN_PROGRAMS.map((program) => ({
      kind: program.label,
      program,
      method: "getTokenAccountsByOwner",
      params: [walletAddress, { programId: program.program_id }, { encoding: "jsonParsed", commitment: "confirmed" }],
    })),
  ];
  const settled = await Promise.allSettled(operations.map((operation) => call(operation.method, operation.params)));
  const observations = [];
  const failures = [];
  const successfulComponents = [];
  settled.forEach((result, index) => {
    const operation = operations[index];
    if (result.status === "rejected") {
      const reasonText = text(result.reason?.message || result.reason).toLowerCase();
      failures.push({ component: operation.kind, reason: reasonText.includes("timeout") ? "provider_timeout" : "provider_unavailable" });
      return;
    }
    try {
      const value = result.value;
      if (operation.kind === "native") {
        observations.push(createSolanaObservation({
          observedAt: at,
          sourceCategory: "wallet_balance",
          sourceReference: `${provider}:getBalance`,
          facts: {
            observation_kind: "solana_native_balance",
            wallet_reference: accountRef,
            amount_base_units: integerString(value?.value ?? value, "native_balance"),
            decimals: 9,
            context_slot: Number(value?.context?.slot || 0) || null,
          },
        }));
        successfulComponents.push(operation.kind);
        return;
      }
      if (!Array.isArray(value?.value)) throw new Error("token_accounts_response_invalid");
      observations.push(createSolanaObservation({
        observedAt: at,
        sourceCategory: "wallet_token_accounts",
        sourceReference: `${provider}:getTokenAccountsByOwner:${operation.kind}`,
        facts: {
          observation_kind: "solana_token_accounts",
          wallet_reference: accountRef,
          token_program: operation.program.program_id,
          token_program_label: operation.program.label,
          context_slot: Number(value?.context?.slot || 0) || null,
          accounts: value.value,
        },
      }));
      successfulComponents.push(operation.kind);
    } catch {
      failures.push({ component: operation.kind, reason: "provider_response_invalid" });
    }
  });
  return Object.freeze({
    observations: Object.freeze(observations),
    diagnostics: Object.freeze({
      requested_components: operations.map((row) => row.kind),
      successful_components: successfulComponents,
      failures,
      provider,
      wallet_address_persisted: false,
      execution_objects_created: false,
    }),
  });
}

function builtinDefinitionObservations(observedAt) {
  return BUILTIN_ASSET_DEFINITIONS.map((row) => createSolanaAssetDefinitionObservation(row, observedAt));
}

function definitionKey(facts) {
  return text(facts.mint) || text(facts.asset_id);
}

function mapDefinitions(observations) {
  const definitions = new Map();
  for (const observation of observations.filter((row) => row.facts.observation_kind === "solana_asset_definition")) {
    const key = definitionKey(observation.facts);
    const definition = { ...observation.facts, observation };
    for (const identity of [key, observation.facts.asset_id].filter(Boolean)) {
      const previous = definitions.get(identity);
      if (previous && previous.definition_id !== definition.definition_id) throw new Error(`asset_definition_conflict:${identity}`);
      definitions.set(identity, definition);
    }
  }
  return definitions;
}

function mapLatest(observations, kind, keyFn) {
  const result = new Map();
  for (const observation of observations.filter((row) => row.facts.observation_kind === kind)) {
    const key = keyFn(observation.facts);
    if (!key) continue;
    const previous = result.get(key);
    const previousAt = previous ? Date.parse(previous.observed_at) : -1;
    const nextAt = Date.parse(observation.observed_at);
    if (!previous || nextAt > previousAt || (nextAt === previousAt && observation.record_hash > previous.record_hash)) result.set(key, observation);
  }
  return result;
}

function parseTokenAccount(row, observation, index, diagnostics, representationAccounts) {
  const info = row?.account?.data?.parsed?.info || row?.parsed?.info || row?.info || {};
  const tokenAmount = info.tokenAmount || row?.tokenAmount || {};
  const accountId = text(row?.pubkey || row?.account_id || row?.address);
  const mint = text(info.mint || row?.mint);
  const rawAmountValue = tokenAmount.amount ?? row?.amount_base_units;
  const rawAmount = text(rawAmountValue);
  const decimalsRaw = tokenAmount.decimals ?? row?.decimals;
  const state = text(info.state || row?.state || "unknown").toLowerCase();
  if (
    !accountId
    || !mint
    || !validPublicKey(mint)
    || (typeof rawAmountValue === "number" && !Number.isSafeInteger(rawAmountValue))
    || !/^(?:0|[1-9]\d*)$/.test(rawAmount)
  ) {
    diagnostics.rejected_observations.push({ observation_id: observation.observation_id, row_index: index, reason: "malformed_token_account" });
    return null;
  }
  if (state === "closed" || rawAmount === "0") {
    diagnostics.closed_or_zero_positions.push({ observation_id: observation.observation_id, token_account_id: accountId });
    return null;
  }
  const decimals = Number(decimalsRaw);
  const metadataState = Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 30 ? "available" : "malformed";
  return {
    position_id: `pos_sol_${canonicalContractHash({ account: accountId }).slice(0, 24)}`,
    economic_lot_id: `solana:token_account:${accountId}`,
    account_ref: text(observation.facts.wallet_reference),
    token_account_id: accountId,
    mint,
    quantity_base_units: rawAmount,
    asset_decimals: metadataState === "available" ? decimals : null,
    position_state: state === "frozen" ? "frozen" : "open",
    metadata_state: metadataState,
    source_observations: [observation],
    representation_only: representationAccounts.has(accountId),
    raw_kind: "token_account",
  };
}

function normalizedCandidates(observations, diagnostics) {
  const candidates = [];
  const protocolObservations = observations.filter((row) => row.facts.observation_kind === "solana_protocol_position");
  const representationAccounts = new Set(protocolObservations.flatMap((row) => row.facts.representation_token_account_ids || []));
  for (const observation of observations) {
    const facts = observation.facts;
    if (facts.observation_kind === "solana_native_balance") {
      const amount = text(facts.amount_base_units);
      if (!/^(?:0|[1-9]\d*)$/.test(amount)) {
        diagnostics.rejected_observations.push({ observation_id: observation.observation_id, reason: "malformed_native_balance" });
      } else if (amount !== "0") {
        candidates.push({
          position_id: `pos_sol_${canonicalContractHash({ account: facts.wallet_reference, asset: SOLANA_NATIVE_ASSET_ID }).slice(0, 24)}`,
          economic_lot_id: `solana:native:${facts.wallet_reference}`,
          account_ref: text(facts.wallet_reference),
          mint: null,
          asset_id: SOLANA_NATIVE_ASSET_ID,
          quantity_base_units: amount,
          asset_decimals: 9,
          position_state: "open",
          metadata_state: "available",
          source_observations: [observation],
          representation_only: false,
          raw_kind: "native",
        });
      }
    }
    if (facts.observation_kind === "solana_token_accounts") {
      (Array.isArray(facts.accounts) ? facts.accounts : []).forEach((row, index) => {
        const parsed = parseTokenAccount(row, observation, index, diagnostics, representationAccounts);
        if (parsed) candidates.push(parsed);
      });
    }
    if (facts.observation_kind === "solana_protocol_position" && facts.position_state !== "closed") {
      candidates.push({
        position_id: facts.position_id,
        economic_lot_id: facts.economic_lot_id,
        account_ref: null,
        token_account_id: null,
        mint: facts.instrument_mint,
        asset_id: facts.instrument_asset_id,
        quantity_base_units: facts.amount_base_units,
        asset_decimals: facts.decimals,
        position_state: "open",
        metadata_state: facts.instrument_asset_id ? "available" : "malformed",
        source_observations: [observation],
        representation_only: false,
        raw_kind: "protocol_position",
        position_kind: facts.position_kind,
        position_side: facts.exposure_side === "liability" ? "liability" : "asset",
        protocol_id: facts.protocol_id,
        protocol_position_id: facts.protocol_position_id,
        pool_id: facts.pool_id,
        components: facts.components,
        underlying_state: facts.underlying_state,
        withdrawal_state: facts.withdrawal_state,
      });
    }
  }
  const deduped = new Map();
  for (const candidate of candidates) {
    const previous = deduped.get(candidate.economic_lot_id);
    if (!previous) {
      deduped.set(candidate.economic_lot_id, candidate);
      continue;
    }
    const previousAt = Math.max(...previous.source_observations.map((row) => Date.parse(row.observed_at)));
    const candidateAt = Math.max(...candidate.source_observations.map((row) => Date.parse(row.observed_at)));
    const keep = candidateAt > previousAt
      || (candidateAt === previousAt && candidate.position_id > previous.position_id)
      ? candidate
      : previous;
    deduped.set(candidate.economic_lot_id, keep);
    diagnostics.duplicate_economic_lots.push({ economic_lot_id: candidate.economic_lot_id, kept_position_id: keep.position_id });
  }
  return [...deduped.values()].sort((left, right) => left.position_id.localeCompare(right.position_id));
}

function markFor(markMap, assetId, mint) {
  return markMap.get(assetId) || (mint ? markMap.get(mint) : null) || null;
}

function definitionFor(definitions, assetId, mint) {
  return definitions.get(mint) || definitions.get(assetId) || null;
}

function multiplyRatio(amount, numerator, denominator) {
  const den = BigInt(integerString(denominator, "ratio_denominator"));
  if (den <= 0n) throw new Error("ratio_denominator_zero");
  return ((BigInt(integerString(amount, "ratio_amount")) * BigInt(integerString(numerator, "ratio_numerator"))) / den).toString();
}

function calculateMarkedValue(quantity, markObservation) {
  if (!markObservation || quantity === null) return null;
  const facts = markObservation.facts;
  return multiplyRatio(quantity, facts.price_numerator_minor, facts.price_denominator_base_units);
}

function quoteFor(quoteMap, candidate) {
  return quoteMap.get(`position:${candidate.position_id}`)
    || quoteMap.get(`lot:${candidate.economic_lot_id}`)
    || (candidate.mint ? quoteMap.get(`mint:${candidate.mint}`) : null)
    || quoteMap.get(`asset:${candidate.asset_id}`)
    || null;
}

function quoteState(candidate, quoteObservation, calculatedAt, isNumeraireIdentity) {
  if (isNumeraireIdentity) {
    return {
      routeability: "routeable",
      executable_value_minor: candidate.quantity_base_units,
      expected_executable_value_minor: candidate.quantity_base_units,
      executable_value_state: "current",
      quote_observation_id: null,
    };
  }
  if (!quoteObservation) {
    return {
      routeability: candidate.position_state === "frozen" ? "not_routeable" : "unknown",
      executable_value_minor: null,
      expected_executable_value_minor: null,
      executable_value_state: candidate.position_state === "frozen" ? "unrouteable" : "unavailable",
      quote_observation_id: null,
    };
  }
  const facts = quoteObservation.facts;
  if (facts.input_amount_base_units !== candidate.quantity_base_units) {
    return {
      routeability: "unknown",
      executable_value_minor: null,
      expected_executable_value_minor: null,
      executable_value_state: "unavailable",
      quote_observation_id: quoteObservation.observation_id,
      refusal_reason: "quote_quantity_mismatch",
    };
  }
  const expired = facts.expires_at && Date.parse(facts.expires_at) <= Date.parse(calculatedAt);
  const stale = expired || ["stale", "unavailable"].includes(text(quoteObservation.freshness_state).toLowerCase());
  if (stale) {
    return {
      routeability: "unknown",
      executable_value_minor: null,
      expected_executable_value_minor: facts.expected_output_minor,
      executable_value_state: "stale",
      quote_observation_id: quoteObservation.observation_id,
    };
  }
  if (facts.routeability !== "routeable") {
    return {
      routeability: facts.routeability,
      executable_value_minor: null,
      expected_executable_value_minor: null,
      executable_value_state: facts.routeability === "not_routeable" ? "unrouteable" : "unavailable",
      quote_observation_id: quoteObservation.observation_id,
    };
  }
  return {
    routeability: "routeable",
    executable_value_minor: facts.minimum_output_minor,
    expected_executable_value_minor: facts.expected_output_minor,
    executable_value_state: "fresh",
    quote_observation_id: quoteObservation.observation_id,
  };
}

function conversionFor(conversionMap, definition) {
  return conversionMap.get(definition.asset_id) || (definition.mint ? conversionMap.get(definition.mint) : null) || null;
}

function componentResolution(candidate, definitions, conversionMap) {
  if (candidate.raw_kind === "protocol_position") {
    if (!Array.isArray(candidate.components) || !candidate.components.length || candidate.underlying_state === "unavailable") {
      return { state: "unresolved", source: "protocol_underlying_unavailable", components: [] };
    }
    return {
      state: candidate.underlying_state === "estimated" ? "estimated" : "observed",
      source: "current_protocol_state",
      components: candidate.components.map((row) => ({ ...row, exposure_side: row.exposure_side || candidate.position_side })),
    };
  }
  const definition = definitionFor(definitions, candidate.asset_id, candidate.mint);
  if (!definition || candidate.metadata_state !== "available") return { state: "unresolved", source: "unresolved_asset_identity", components: [] };
  if (definition.underlying_mode === "self") {
    return {
      state: "exact",
      source: "protocol_definition",
      components: [{
        asset_id: definition.underlying_asset_id || definition.asset_id,
        mint: definition.mint,
        amount_base_units: candidate.quantity_base_units,
        decimals: candidate.asset_decimals ?? definition.decimals,
        exposure_side: candidate.position_side,
        definition,
      }],
      definition,
    };
  }
  if (definition.underlying_mode === "exact") {
    return {
      state: "exact",
      source: "protocol_definition",
      components: [{
        asset_id: definition.underlying_asset_id,
        mint: null,
        amount_base_units: multiplyRatio(candidate.quantity_base_units, definition.conversion_numerator, definition.conversion_denominator),
        decimals: candidate.asset_decimals ?? definition.decimals,
        exposure_side: candidate.position_side,
        definition,
      }],
      definition,
    };
  }
  if (definition.underlying_mode === "observed_conversion") {
    const conversion = conversionFor(conversionMap, definition);
    if (!conversion) return { state: "unresolved", source: "current_conversion_unavailable", components: [], definition };
    return {
      state: ["stale", "unavailable"].includes(conversion.freshness_state) ? "stale" : "derived",
      source: "current_protocol_conversion",
      components: [{
        asset_id: definition.underlying_asset_id,
        mint: null,
        amount_base_units: multiplyRatio(
          candidate.quantity_base_units,
          conversion.facts.output_amount_base_units,
          conversion.facts.input_amount_base_units,
        ),
        decimals: candidate.asset_decimals ?? definition.decimals,
        exposure_side: candidate.position_side,
        definition,
        conversion,
      }],
      definition,
      conversion,
    };
  }
  return { state: "unresolved", source: "underlying_definition_unresolved", components: [], definition };
}

function valuedComponents(resolution, definitions, marks, context) {
  return resolution.components.map((component) => {
    const definition = component.definition || definitionFor(definitions, component.asset_id, component.mint);
    const assetId = component.asset_id || definition?.asset_id || (component.mint ? `solana:mint:${component.mint}` : null);
    const mark = markFor(marks, assetId, component.mint);
    const numeraireIdentity = assetId === "solana:USDC"
      && context.economic_numeraire === "USDC"
      && Number(component.decimals ?? definition?.decimals) === context.numeraire_decimals;
    return {
      ...component,
      asset_id: assetId,
      definition,
      mark_observation: mark,
      marked_value_minor: numeraireIdentity ? component.amount_base_units : calculateMarkedValue(component.amount_base_units, mark),
      freshness_state: weakestFreshness([
        numeraireIdentity ? "current" : mark?.freshness_state || "unavailable",
        component.conversion?.freshness_state || "fresh",
      ]),
    };
  });
}

function distributeValue(totalValue, components) {
  if (totalValue === null || !components.length || components.some((row) => row.marked_value_minor === null)) return components.map(() => null);
  const total = BigInt(totalValue);
  const weights = components.map((row) => BigInt(row.marked_value_minor));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  if (weightTotal <= 0n) return components.map(() => null);
  let assigned = 0n;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1 ? total - assigned : (total * weight) / weightTotal;
    assigned += value;
    return value.toString();
  });
}

function exposureRowsForPosition({ candidate, position, resolution, components, quote, definitions, calculatedAt }) {
  const rows = [];
  const observationSet = [...new Set([
    ...candidate.source_observations,
    ...(resolution.definition?.observation ? [resolution.definition.observation] : []),
    ...(resolution.conversion ? [resolution.conversion] : []),
    ...components.flatMap((row) => [row.mark_observation, row.definition?.observation].filter(Boolean)),
    ...(quote ? [quote] : []),
  ].map((row) => row.observation_id))]
    .map((id) => [
      ...candidate.source_observations,
      resolution.definition?.observation,
      resolution.conversion,
      ...components.flatMap((row) => [row.mark_observation, row.definition?.observation]),
      quote,
    ].find((row) => row?.observation_id === id));
  const rawPrimaryComponents = resolution.state === "unresolved" || !components.length
    ? [{
        dimension_type: "unresolved",
        scope_id: "unresolved",
        exposure_side: position.position_side === "liability" ? "liability" : "asset",
        quantity_base_units: position.quantity_base_units,
        asset_decimals: position.asset_decimals,
        marked_value_minor: position.position_side === "liability" ? position.liability_value_minor : position.marked_value_minor,
        executable_value_minor: position.executable_value_minor,
        freshness_state: position.marked_value_state,
        resolution_state: "unresolved",
        resolution_source: resolution.source,
      }]
    : components.map((component) => ({
        dimension_type: component.exposure_side === "liability" ? "liability" : "asset",
        scope_id: component.asset_id,
        exposure_side: component.exposure_side === "liability" ? "liability" : "asset",
        quantity_base_units: component.amount_base_units,
        asset_decimals: component.decimals,
        marked_value_minor: component.marked_value_minor,
        executable_value_minor: null,
        freshness_state: component.freshness_state,
        resolution_state: resolution.state === "stale" ? "stale" : resolution.state,
        resolution_source: resolution.source,
        definition: component.definition,
      }));
  const primaryGroups = new Map();
  for (const row of rawPrimaryComponents) {
    const key = `${row.dimension_type}:${row.scope_id}:${row.exposure_side}`;
    const previous = primaryGroups.get(key);
    if (previous && previous.asset_decimals !== row.asset_decimals) throw new Error("economic_component_decimals_conflict");
    const current = previous || { ...row, quantity_base_units: "0", marked_value_minor: row.marked_value_minor === null ? null : "0" };
    if (row.quantity_base_units !== null) current.quantity_base_units = (BigInt(current.quantity_base_units || "0") + BigInt(row.quantity_base_units)).toString();
    else current.quantity_base_units = null;
    if (row.marked_value_minor !== null && current.marked_value_minor !== null) {
      current.marked_value_minor = (BigInt(current.marked_value_minor) + BigInt(row.marked_value_minor)).toString();
    } else current.marked_value_minor = null;
    current.freshness_state = weakestFreshness([current.freshness_state, row.freshness_state]);
    primaryGroups.set(key, current);
  }
  const primaryComponents = [...primaryGroups.values()];
  const distributedExecutable = distributeValue(position.executable_value_minor, primaryComponents);
  const componentDistributedExecutable = distributeValue(position.executable_value_minor, components);
  primaryComponents.forEach((row, index) => {
    if (row.dimension_type !== "unresolved") row.executable_value_minor = distributedExecutable[index];
  });

  const add = (row) => rows.push(createEconomicExposure({
    economic_exposure_id: exposureId(position.position_id, row.dimension_type, row.scope_id, row.exposure_side),
    portfolio_id: position.portfolio_id,
    user_id: position.user_id,
    calculated_at: calculatedAt,
    economic_lot_id: position.economic_lot_id,
    position_id: position.position_id,
    source_instrument_asset_id: position.instrument_asset_id,
    dimension_type: row.dimension_type,
    scope_id: row.scope_id,
    exposure_side: row.exposure_side,
    quantity_base_units: row.quantity_base_units,
    asset_decimals: row.asset_decimals,
    marked_value_minor: row.marked_value_minor,
    executable_value_minor: row.executable_value_minor,
    resolution_state: row.resolution_state,
    resolution_source: row.resolution_source,
    resolution_basis: row.resolution_basis,
    freshness_state: row.freshness_state,
    routeability: position.routeability,
    observations: observationSet,
  }));
  primaryComponents.forEach(add);
  const overlayValue = position.position_side === "liability" ? position.liability_value_minor : position.marked_value_minor;
  const overlayExecutable = position.position_side === "liability" ? null : position.executable_value_minor;
  const overlayBase = {
    exposure_side: "overlay",
    quantity_base_units: position.quantity_base_units,
    asset_decimals: position.asset_decimals,
    marked_value_minor: overlayValue,
    executable_value_minor: overlayExecutable,
    resolution_state: "derived",
    resolution_source: "normalized_position_identity",
    freshness_state: position.marked_value_state,
  };
  add({ ...overlayBase, dimension_type: "instrument", scope_id: position.instrument_asset_id });
  add({ ...overlayBase, dimension_type: "chain", scope_id: "solana" });
  if (position.protocol_id) add({ ...overlayBase, dimension_type: "protocol", scope_id: position.protocol_id });
  const stableGroups = new Map();
  for (const component of components) {
    const definition = component.definition || definitionFor(definitions, component.asset_id, component.mint);
    for (const [dimensionType, scopeId] of [
      ["stablecoin_issuer", definition?.stablecoin_issuer_id],
      ["stablecoin_dependency", definition?.stablecoin_dependency_id],
    ]) {
      if (!scopeId || component.marked_value_minor === null) continue;
      const key = `${dimensionType}:${scopeId}`;
      const current = stableGroups.get(key) || { dimension_type: dimensionType, scope_id: scopeId, marked: 0n, executable: 0n };
      current.marked += BigInt(component.marked_value_minor);
      const index = components.indexOf(component);
      if (componentDistributedExecutable[index] !== null) current.executable += BigInt(componentDistributedExecutable[index]);
      stableGroups.set(key, current);
    }
  }
  for (const group of stableGroups.values()) {
    add({
      ...overlayBase,
      dimension_type: group.dimension_type,
      scope_id: group.scope_id,
      marked_value_minor: group.marked.toString(),
      executable_value_minor: group.executable > 0n ? group.executable.toString() : null,
      resolution_source: "asset_definition_dependency",
    });
  }
  return rows;
}

function makePosition(candidate, definitions, conversions, marks, quotes, context) {
  const definition = definitionFor(definitions, candidate.asset_id, candidate.mint);
  const instrumentAssetId = candidate.asset_id || definition?.asset_id || (candidate.mint ? `solana:mint:${candidate.mint}` : "solana:unresolved");
  candidate.asset_id = instrumentAssetId;
  const resolution = componentResolution(candidate, definitions, conversions);
  const components = valuedComponents(resolution, definitions, marks, context);
  const componentMarksAvailable = components.length > 0 && components.every((row) => row.marked_value_minor !== null);
  let markedValue = componentMarksAvailable
    ? components.reduce((sum, row) => sum + BigInt(row.marked_value_minor), 0n).toString()
    : null;
  let markFreshness = componentMarksAvailable ? weakestFreshness(components.map((row) => row.freshness_state)) : "unavailable";
  if (resolution.state === "unresolved") {
    const directMark = markFor(marks, instrumentAssetId, candidate.mint);
    markedValue = calculateMarkedValue(candidate.quantity_base_units, directMark);
    markFreshness = directMark?.freshness_state || "unavailable";
  }
  const isNumeraireIdentity = instrumentAssetId === "solana:USDC"
    && context.economic_numeraire === "USDC"
    && candidate.metadata_state === "available"
    && Number(candidate.asset_decimals ?? definition?.decimals) === context.numeraire_decimals;
  const quoteObservation = quoteFor(quotes, candidate);
  const executable = quoteState(candidate, quoteObservation, context.calculated_at, isNumeraireIdentity);
  const classification = definition?.classification || "unresolved";
  const suspectedSpam = classification === "suspected_spam";
  const countedInNav = !candidate.representation_only && (!suspectedSpam || executable.executable_value_minor !== null);
  if (suspectedSpam && !countedInNav) context.diagnostics.excluded_suspect_positions.push(candidate.position_id);
  const liabilityValue = candidate.position_side === "liability"
    ? markedValue
    : "0";
  const position = {
    position_id: candidate.position_id,
    economic_lot_id: candidate.economic_lot_id,
    portfolio_id: context.portfolio_id,
    user_id: context.user_id,
    asset_id: instrumentAssetId,
    instrument_asset_id: instrumentAssetId,
    chain_id: "solana",
    account_ref: candidate.account_ref,
    position_kind: candidate.position_kind || definition?.instrument_kind || "token",
    position_side: candidate.position_side || "asset",
    position_state: candidate.position_state,
    quantity_base_units: candidate.quantity_base_units,
    asset_decimals: candidate.asset_decimals ?? definition?.decimals ?? null,
    protocol_id: candidate.protocol_id || definition?.protocol_id || null,
    stablecoin_issuer_id: definition?.stablecoin_issuer_id || null,
    marked_value_minor: candidate.position_side === "liability" ? null : markedValue,
    marked_value_state: markFreshness,
    marked_value_source: componentMarksAvailable ? "resolved_component_marks" : markedValue !== null ? "instrument_mark" : null,
    marked_at: components.find((row) => row.mark_observation)?.mark_observation?.observed_at || markFor(marks, instrumentAssetId, candidate.mint)?.observed_at || null,
    expected_executable_value_minor: candidate.position_side === "liability" ? null : executable.expected_executable_value_minor,
    executable_value_minor: candidate.position_side === "liability" ? null : executable.executable_value_minor,
    executable_value_state: candidate.position_side === "liability" ? "not_applicable" : executable.executable_value_state,
    executable_quote_observation_id: executable.quote_observation_id,
    liability_value_minor: liabilityValue,
    liability_value_state: candidate.position_side === "liability" ? markFreshness : "not_applicable",
    routeability: candidate.position_side === "liability" ? "unknown" : executable.routeability,
    valuation_confidence: markedValue === null
      ? "unavailable"
      : resolution.state === "unresolved" || ["stale", "delayed"].includes(markFreshness)
        ? "low"
        : resolution.state === "estimated"
          ? "medium"
          : "high",
    valuation_source: componentMarksAvailable ? "economic_look_through" : markedValue !== null ? "direct_mark" : null,
    observed_at: candidate.source_observations[0]?.observed_at || context.calculated_at,
    metadata_state: candidate.metadata_state,
    economic_resolution_state: resolution.state,
    counted_in_nav: countedInNav,
    representation_only: candidate.representation_only,
    source_observation_ids: candidate.source_observations.map((row) => row.observation_id),
    risk_flags: [
      ...(suspectedSpam ? ["suspected_spam"] : []),
      ...(candidate.position_state === "frozen" ? ["frozen_account"] : []),
      ...(executable.refusal_reason ? [executable.refusal_reason] : []),
      ...(candidate.pool_id ? [`pool:${candidate.pool_id}`] : []),
      ...(candidate.protocol_position_id ? [`protocol_position:${candidate.protocol_position_id}`] : []),
    ],
  };
  const exposures = candidate.representation_only
    ? []
    : exposureRowsForPosition({ candidate, position, resolution, components, quote: quoteObservation, definitions, calculatedAt: context.calculated_at });
  return { position, exposures };
}

export function selectSolanaExecutableValuationCandidates({
  positions = [],
  minimum_material_value_minor: minimumMaterialValueMinor = "1000000",
  minimum_portfolio_weight_bps: minimumPortfolioWeightBps = 50,
  maximum_auto_quotes: maximumAutoQuotes = 8,
} = {}) {
  const minimum = BigInt(integerString(minimumMaterialValueMinor, "minimum_material_value_minor"));
  const weightBps = Number(minimumPortfolioWeightBps);
  const maximum = Number(maximumAutoQuotes);
  if (!Number.isSafeInteger(weightBps) || weightBps < 0 || weightBps > 10_000) throw new Error("minimum_portfolio_weight_bps_invalid");
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 32) throw new Error("maximum_auto_quotes_invalid");
  const markedTotal = positions
    .filter((row) => row.counted_in_nav && row.position_side !== "liability" && row.marked_value_minor !== null)
    .reduce((sum, row) => sum + BigInt(row.marked_value_minor), 0n);
  const proportional = (markedTotal * BigInt(weightBps)) / 10_000n;
  const threshold = proportional > minimum ? proportional : minimum;
  const eligible = [];
  const deferred = [];
  for (const position of positions) {
    let reason = null;
    if (!position.counted_in_nav || position.representation_only || position.position_state === "closed") reason = "not_counted_position";
    else if (position.position_side === "liability") reason = "liability_not_exit_quoted";
    else if (position.asset_id === "solana:USDC") reason = "numeraire_identity";
    else if (position.executable_value_minor !== null) reason = "fresh_executable_value_present";
    else if (position.marked_value_minor === null) reason = "marked_value_unavailable_quote_on_demand";
    else if (BigInt(position.marked_value_minor) < threshold) reason = "below_materiality_threshold";
    else if (position.risk_flags.includes("suspected_spam")) reason = "suspected_spam_quote_on_demand";
    if (reason) {
      deferred.push({ position_id: position.position_id, reason });
    } else {
      eligible.push(position);
    }
  }
  eligible.sort((left, right) => {
    const delta = BigInt(right.marked_value_minor) - BigInt(left.marked_value_minor);
    return delta === 0n ? left.position_id.localeCompare(right.position_id) : delta > 0n ? 1 : -1;
  });
  const selected = eligible.slice(0, maximum).map((position) => ({
    probe_kind: "read_only_executable_valuation",
    position_id: position.position_id,
    economic_lot_id: position.economic_lot_id,
    input_asset_id: position.asset_id,
    input_amount_base_units: position.quantity_base_units,
    preferred_output_asset_id: "solana:USDC",
    transaction_material_allowed: false,
    signing_allowed: false,
    submission_allowed: false,
  }));
  deferred.push(...eligible.slice(maximum).map((position) => ({ position_id: position.position_id, reason: "bounded_quote_budget" })));
  return Object.freeze({
    materiality_threshold_minor: threshold.toString(),
    maximum_auto_quotes: maximum,
    selected: Object.freeze(selected),
    deferred: Object.freeze(deferred.sort((left, right) => left.position_id.localeCompare(right.position_id))),
    creates_execution_quote: false,
  });
}

export function verifySolanaExposureConservation({ positions = [], economic_exposures: economicExposures = [], measurement } = {}) {
  const failures = [];
  for (const position of positions.filter((row) => row.counted_in_nav && !row.representation_only && row.position_state !== "closed")) {
    const primary = economicExposures.filter((row) => row.position_id === position.position_id && row.capital_treatment !== "analytical_overlay");
    const marked = primary.filter((row) => row.marked_value_minor !== null).reduce((sum, row) => sum + BigInt(row.marked_value_minor), 0n);
    const expectedMarked = BigInt((position.position_side === "liability" ? position.liability_value_minor : position.marked_value_minor) || "0");
    const markComplete = position.position_side === "liability"
      ? position.liability_value_minor !== null
      : position.marked_value_minor !== null;
    if (markComplete && marked !== expectedMarked) failures.push({ position_id: position.position_id, invariant: "marked_value_conservation", expected: expectedMarked.toString(), actual: marked.toString() });
    if (position.executable_value_minor !== null) {
      const executableRows = primary.filter((row) => row.exposure_side === "asset" && row.executable_value_minor !== null);
      const executable = executableRows.reduce((sum, row) => sum + BigInt(row.executable_value_minor), 0n);
      if (executable !== BigInt(position.executable_value_minor)) failures.push({ position_id: position.position_id, invariant: "executable_value_conservation", expected: position.executable_value_minor, actual: executable.toString() });
    }
  }
  if (measurement) {
    const countedAssets = positions
      .filter((row) => row.counted_in_nav && !row.representation_only && row.position_side !== "liability" && row.position_state !== "closed" && row.marked_value_minor !== null)
      .reduce((sum, row) => sum + BigInt(row.marked_value_minor), 0n);
    const countedLiabilities = positions
      .filter((row) => row.counted_in_nav && !row.representation_only && row.position_state !== "closed" && row.liability_value_minor !== null)
      .reduce((sum, row) => sum + BigInt(row.liability_value_minor), 0n);
    const unavailableLiabilities = positions
      .filter((row) => row.counted_in_nav && !row.representation_only && row.position_state !== "closed" && row.position_side === "liability" && row.liability_value_minor === null)
      .length;
    const unavailableAssets = positions
      .filter((row) => row.counted_in_nav && !row.representation_only && row.position_state !== "closed" && row.position_side !== "liability" && row.marked_value_minor === null)
      .length;
    if (countedAssets.toString() !== measurement.total_marked_asset_value_minor) failures.push({ invariant: "portfolio_asset_conservation" });
    if (countedLiabilities.toString() !== measurement.total_liability_value_minor) failures.push({ invariant: "portfolio_liability_conservation" });
    if (unavailableAssets !== Number(measurement.unavailable_asset_valuations || 0)) failures.push({ invariant: "portfolio_unavailable_asset_conservation" });
    if (unavailableLiabilities !== Number(measurement.unavailable_liability_valuations || 0)) failures.push({ invariant: "portfolio_unavailable_liability_conservation" });
    if (measurement.net_equity_minor !== null && (countedAssets - countedLiabilities).toString() !== measurement.net_equity_minor) failures.push({ invariant: "portfolio_net_equity_conservation" });
  }
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

export function buildSolanaExposurePortfolio(input = {}) {
  const observedAt = timestamp(input.observed_at, "observed_at");
  const calculatedAt = timestamp(input.calculated_at || observedAt, "calculated_at");
  const portfolioId = text(input.portfolio_id);
  const userId = text(input.user_id);
  if (!portfolioId || !userId) throw new Error("portfolio_owner_required");
  const supplied = (Array.isArray(input.observations) ? input.observations : []).map(checkedObservation);
  const definitions = [
    ...builtinDefinitionObservations(observedAt),
    ...(Array.isArray(input.asset_definition_observations) ? input.asset_definition_observations.map(checkedObservation) : []),
  ];
  const observationsById = new Map([...supplied, ...definitions].map((row) => [row.observation_id, row]));
  const observations = [...observationsById.values()];
  const definitionMap = mapDefinitions(observations);
  const conversionMap = mapLatest(observations, "solana_conversion_state", (facts) => facts.instrument_mint || facts.instrument_asset_id);
  const markMap = mapLatest(observations, "solana_mark_price", (facts) => facts.mint || facts.asset_id);
  const quoteMap = new Map();
  for (const observation of observations.filter((row) => row.facts.observation_kind === "solana_executable_exit")) {
    const facts = observation.facts;
    for (const [prefix, value] of [
      ["position", facts.position_id],
      ["lot", facts.economic_lot_id],
      ["mint", facts.input_mint],
      ["asset", facts.input_asset_id],
    ]) {
      if (value) {
        const key = `${prefix}:${value}`;
        const previous = quoteMap.get(key);
        const previousAt = previous ? Date.parse(previous.observed_at) : -1;
        const nextAt = Date.parse(observation.observed_at);
        if (!previous || nextAt > previousAt || (nextAt === previousAt && observation.record_hash > previous.record_hash)) quoteMap.set(key, observation);
      }
    }
  }
  const diagnostics = {
    rejected_observations: [],
    closed_or_zero_positions: [],
    duplicate_economic_lots: [],
    excluded_suspect_positions: [],
    unsupported_capabilities: [
      "no_qualified_live_lp_position_provider",
      "no_qualified_live_lending_position_provider",
      "no_qualified_solana_perpetual_position_provider",
    ],
  };
  const candidates = normalizedCandidates(observations, diagnostics);
  const context = {
    portfolio_id: portfolioId,
    user_id: userId,
    calculated_at: calculatedAt,
    economic_numeraire: text(input.economic_numeraire || "USDC").toUpperCase(),
    numeraire_decimals: Number(input.numeraire_decimals ?? 6),
    diagnostics,
  };
  const resolved = candidates.map((candidate) => makePosition(candidate, definitionMap, conversionMap, markMap, quoteMap, context));
  let positions = resolved.map((row) => row.position);
  const economicExposures = resolved.flatMap((row) => row.exposures);
  const valuationPlan = selectSolanaExecutableValuationCandidates({
    positions,
    minimum_material_value_minor: input.minimum_material_value_minor,
    minimum_portfolio_weight_bps: input.minimum_portfolio_weight_bps,
    maximum_auto_quotes: input.maximum_auto_quotes,
  });
  const deferredReasons = new Map(valuationPlan.deferred.map((row) => [row.position_id, row.reason]));
  positions = positions.map((position) => deferredReasons.get(position.position_id) === "below_materiality_threshold"
    ? { ...position, executable_value_state: "not_material" }
    : position);
  const snapshot = createPortfolioSnapshot({
    snapshot_id: text(input.snapshot_id) || `snap_sol_${canonicalContractHash({ portfolio_id: portfolioId, observed_at: observedAt, positions }).slice(0, 24)}`,
    portfolio_id: portfolioId,
    user_id: userId,
    observed_at: observedAt,
    economic_numeraire: context.economic_numeraire,
    positions,
    economic_exposures: economicExposures,
    accounting_model_version: "economic_exposure.v1",
    normalization_diagnostics: diagnostics,
    source_observation_ids: supplied.map((row) => row.observation_id),
  });
  const measurement = createPortfolioMeasurement({
    measurement_id: text(input.measurement_id) || `measure_sol_${canonicalContractHash({ snapshot: snapshot.record_hash, calculated_at: calculatedAt }).slice(0, 24)}`,
    snapshot,
    economic_exposures: economicExposures,
    calculated_at: calculatedAt,
    methodology_version: "solana_economic_exposure.v1",
  });
  const conservation = verifySolanaExposureConservation({ positions: snapshot.positions, economic_exposures: economicExposures, measurement });
  if (!conservation.ok) throw new Error(`economic_exposure_conservation_failed:${conservation.failures.map((row) => row.invariant).join(",")}`);
  return Object.freeze({
    observations: Object.freeze(observations),
    normalized_positions: snapshot.positions,
    economic_exposures: Object.freeze(economicExposures),
    snapshot,
    measurement,
    valuation_plan: valuationPlan,
    conservation,
    boundary: Object.freeze({
      authority: "measurement_only",
      policy_evaluated: false,
      portfolio_targets_inferred: false,
      market_posture_effect: "none",
      execution_objects_created: false,
      transaction_material_created: false,
    }),
  });
}
