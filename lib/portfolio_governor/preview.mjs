import bs58 from "bs58";

import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
} from "../customer_identity.mjs";
import { canonicalContractHash } from "../customer_trade/contracts.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
  routeBudget,
  withOperationBudget,
} from "../customer_trade/terminal_runtime.mjs";
import { evaluatePortfolioPolicy, verifyGovernorRecord } from "./domain.mjs";
import {
  buildSolanaExposurePortfolio,
  observeSolanaWallet,
  SOLANA_JITOSOL_MINT,
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_USDC_MINT,
  SOLANA_USDT_MINT,
  SOLANA_WRAPPED_SOL_MINT,
} from "./solana_exposure.mjs";
import {
  collectPortfolioPriceCandidates,
  createPortfolioSolanaRpcRequest,
  fetchPortfolioExecutableObservations,
  fetchPortfolioPriceObservations,
  groupPortfolioExecutableCandidates,
  PortfolioPreviewProviderLimits,
} from "./solana_preview_provider.mjs";

export const PORTFOLIO_GOVERNOR_PREVIEW_ROUTE = "/api/v1/portfolio/preview";
export const PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA = "ravenos.portfolio_governor_preview.v1";

export const PortfolioGovernorPreviewLimits = Object.freeze({
  maximum_request_bytes: 4 * 1024,
  maximum_response_bytes: 128 * 1024,
  maximum_authorized_wallets_per_user: 8,
  maximum_returned_holdings: 100,
  maximum_returned_exposures_per_dimension: 100,
  minimum_material_marked_value_minor: "5000000",
  minimum_material_weight_bps: 100,
  maximum_quote_candidate_positions: 32,
  maximum_executable_quote_groups: PortfolioPreviewProviderLimits.maximum_executable_quote_groups,
  account_requests_per_15_minutes: 8,
  wallet_requests_per_5_minutes: 4,
  network_requests_per_15_minutes: 20,
});

const ALLOWED_REQUEST_FIELDS = new Set(["wallet_reference"]);
const KNOWN_ASSETS = Object.freeze({
  [SOLANA_NATIVE_ASSET_ID]: Object.freeze({ symbol: "SOL", mint: null, label: "Solana" }),
  "solana:WSOL": Object.freeze({ symbol: "WSOL", mint: SOLANA_WRAPPED_SOL_MINT, label: "Wrapped SOL" }),
  "solana:USDC": Object.freeze({ symbol: "USDC", mint: SOLANA_USDC_MINT, label: "USD Coin" }),
  "solana:USDT": Object.freeze({ symbol: "USDT", mint: SOLANA_USDT_MINT, label: "Tether USD" }),
  "solana:JitoSOL": Object.freeze({ symbol: "JitoSOL", mint: SOLANA_JITOSOL_MINT, label: "Jito Staked SOL" }),
});

function text(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validWalletReference(value) {
  return /^wpr_[A-Za-z0-9_-]{8,80}$/.test(text(value, 100));
}

function validSolanaAddress(value) {
  const address = text(value, 64);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

function normalizeAuthorizedWalletRows(rows, userId) {
  if (!Array.isArray(rows)) throw new Error("portfolio_preview_wallet_registry_invalid");
  if (rows.length > PortfolioGovernorPreviewLimits.maximum_authorized_wallets_per_user) throw new Error("portfolio_preview_wallet_registry_too_large");
  const references = new Set();
  const addresses = new Set();
  return rows.map((row, index) => {
    const walletReference = text(row?.wallet_reference, 100);
    const address = text(row?.address, 64);
    const label = text(row?.label || `Solana preview wallet ${index + 1}`, 80);
    if (!validWalletReference(walletReference) || !validSolanaAddress(address) || !label) throw new Error("portfolio_preview_wallet_registry_invalid");
    if (references.has(walletReference) || addresses.has(address)) throw new Error("portfolio_preview_wallet_registry_duplicate");
    references.add(walletReference);
    addresses.add(address);
    return Object.freeze({
      wallet_reference: walletReference,
      address,
      label,
      user_id: userId,
      chain: "solana",
      network: "mainnet",
      authorization_basis: "operator_authorized_beta",
      persisted_portfolio_history: false,
    });
  });
}

export function authorizedPortfolioPreviewWallets(env = {}, userId = "") {
  if (env.RAVENOS_PORTFOLIO_PREVIEW_ENABLE !== "1") return [];
  const raw = text(env.RAVENOS_PORTFOLIO_PREVIEW_WALLETS, 64 * 1024);
  if (!raw) return [];
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    throw new Error("portfolio_preview_wallet_registry_invalid");
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("portfolio_preview_wallet_registry_invalid");
  return normalizeAuthorizedWalletRows(registry[userId] || [], userId);
}

function publicWalletSelection(wallet) {
  return {
    wallet_reference: wallet.wallet_reference,
    label: wallet.label,
    chain: wallet.chain,
    network: wallet.network,
    authorization_basis: wallet.authorization_basis,
    address_returned: false,
  };
}

function portfolioIdentity(userId, walletReference) {
  return `prt_preview_${canonicalContractHash({
    schema_version: "ravenos.portfolio_governor_preview_identity.v1",
    user_id: userId,
    wallet_reference: walletReference,
  }).slice(0, 24)}`;
}

function stageTimer(clock) {
  const started = clock();
  return () => Math.max(0, clock() - started);
}

function mintForAsset(assetId) {
  if (KNOWN_ASSETS[assetId]) return KNOWN_ASSETS[assetId].mint;
  if (String(assetId).startsWith("solana:mint:")) {
    const mint = String(assetId).slice("solana:mint:".length);
    return validSolanaAddress(mint) ? mint : null;
  }
  return null;
}

function publicInstrument(position) {
  const known = KNOWN_ASSETS[position.instrument_asset_id] || KNOWN_ASSETS[position.asset_id] || null;
  const mint = mintForAsset(position.instrument_asset_id) || mintForAsset(position.asset_id);
  const mintHint = mint ? `${mint.slice(0, 5)}…${mint.slice(-4)}` : null;
  return {
    asset_id: text(position.instrument_asset_id || position.asset_id, 160),
    symbol: known?.symbol || null,
    label: known?.label || (mintHint ? `Token ${mintHint}` : "Unresolved Solana instrument"),
    mint,
  };
}

function safeHoldingKey(snapshotHash, positionId) {
  return `hld_${canonicalContractHash({ snapshot_hash: snapshotHash, position_id: positionId }).slice(0, 20)}`;
}

function safeRiskFlags(flags = []) {
  const permitted = new Set([
    "suspected_spam",
    "frozen_account",
    "quote_quantity_mismatch",
    "position_not_routeable",
  ]);
  return [...new Set((Array.isArray(flags) ? flags : []).map((value) => text(value, 80)).filter((value) => permitted.has(value)))].sort();
}

function holdingStateReasons(position) {
  const reasons = [];
  if (position.metadata_state !== "available") reasons.push("metadata_unavailable");
  if (position.economic_resolution_state === "unresolved") reasons.push("underlying_unresolved");
  if (position.marked_value_minor === null) reasons.push("marked_value_unavailable");
  if (["stale", "delayed"].includes(position.marked_value_state)) reasons.push("marked_value_stale");
  if (position.routeability === "not_routeable") reasons.push("position_unrouteable");
  if (position.routeability === "unknown") reasons.push("routeability_unknown");
  if (position.position_side === "liability" && position.liability_value_minor === null) reasons.push("liability_value_unavailable");
  return [...new Set(reasons)].sort();
}

function holdingView(position, snapshotHash) {
  return {
    holding_key: safeHoldingKey(snapshotHash, position.position_id),
    instrument: publicInstrument(position),
    position_kind: position.position_kind,
    side: position.position_side,
    amount_base_units: position.quantity_base_units,
    decimals: position.asset_decimals,
    marked_value_minor: position.marked_value_minor,
    marked_value_state: position.marked_value_state,
    marked_at: position.marked_at,
    executable_value_minor: position.executable_value_minor,
    executable_value_state: position.executable_value_state,
    liability_value_minor: position.liability_value_minor,
    liability_value_state: position.liability_value_state,
    routeability: position.routeability,
    protocol: position.protocol_id,
    resolution_state: position.economic_resolution_state,
    valuation_confidence: position.valuation_confidence,
    representation_only: position.representation_only,
    counted_in_nav: position.counted_in_nav,
    evidence_state: holdingStateReasons(position),
    risk_flags: safeRiskFlags(position.risk_flags),
    observed_at: position.observed_at,
  };
}

function bigintOrZero(value) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function materialHoldings(snapshot) {
  const rows = snapshot.positions.filter((position) => {
    if (position.position_side === "liability") return true;
    if (position.marked_value_minor === null) return true;
    if (position.economic_resolution_state === "unresolved") return true;
    if (position.routeability === "not_routeable") return true;
    return bigintOrZero(position.marked_value_minor) >= 1_000_000n;
  });
  rows.sort((left, right) => {
    const leftPriority = left.position_side === "liability" ? 3 : left.economic_resolution_state === "unresolved" ? 2 : left.marked_value_minor === null ? 1 : 0;
    const rightPriority = right.position_side === "liability" ? 3 : right.economic_resolution_state === "unresolved" ? 2 : right.marked_value_minor === null ? 1 : 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const delta = bigintOrZero(right.marked_value_minor || right.liability_value_minor) - bigintOrZero(left.marked_value_minor || left.liability_value_minor);
    return delta === 0n ? left.position_id.localeCompare(right.position_id) : delta > 0n ? 1 : -1;
  });
  return {
    rows: rows.slice(0, PortfolioGovernorPreviewLimits.maximum_returned_holdings),
    truncated: rows.length > PortfolioGovernorPreviewLimits.maximum_returned_holdings,
    material_count: rows.length,
  };
}

function contributingInstruments(exposure, positions, snapshotHash) {
  const byId = new Map(positions.map((row) => [row.position_id, row]));
  return [...new Set((exposure.position_ids || []).map((positionId) => byId.get(positionId)).filter(Boolean).map((position) => {
    const instrument = publicInstrument(position);
    return JSON.stringify({
      holding_key: safeHoldingKey(snapshotHash, position.position_id),
      asset_id: instrument.asset_id,
      symbol: instrument.symbol,
      label: instrument.label,
    });
  }))].map((value) => JSON.parse(value));
}

function exposureView(exposure, positions, snapshotHash) {
  return {
    identity: text(exposure.scope_id, 180),
    side: exposure.exposure_side,
    marked_value_minor: exposure.value_minor,
    executable_value_minor: exposure.executable_value_minor,
    allocation_bps: exposure.allocation_bps,
    possible_minimum_bps: exposure.lower_bound_bps,
    possible_maximum_bps: exposure.upper_bound_bps,
    unresolved_relevant_value_minor: exposure.unresolved_relevant_value_minor,
    stale_value_minor: exposure.stale_value_minor,
    unrouteable_value_minor: exposure.unrouteable_value_minor,
    resolution_states: exposure.resolution_states,
    contributing_instruments: contributingInstruments(exposure, positions, snapshotHash),
  };
}

function safePolicyEvidence(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  const permitted = [
    "metric",
    "value_minor",
    "unresolved_value_minor",
    "unresolved_candidate_scope",
    "unrouteable_value_minor",
    "unknown_routeability_value_minor",
    "executable_value_minor",
    "potentially_executable_value_minor",
    "gross_economic_exposure_minor",
    "total_liability_value_minor",
    "interpretation",
  ];
  return Object.fromEntries(permitted.filter((key) => evidence[key] !== undefined).map((key) => [key, evidence[key]]));
}

function policyView(policyVersion, policyEvaluation) {
  if (!policyVersion || !policyEvaluation) {
    return {
      state: "not_configured",
      message: "No portfolio policy configured.",
      findings: [],
      portfolio_compliant: null,
      targets_inferred: false,
    };
  }
  return {
    state: policyEvaluation.evaluation.state,
    policy_version_id: policyVersion.policy_version_id,
    evaluation_id: policyEvaluation.evaluation.evaluation_id,
    evaluated_at: policyEvaluation.evaluation.calculated_at,
    configured_rule_count: policyEvaluation.evaluation.configured_rule_count,
    findings: policyEvaluation.evaluation.rule_results.map((row) => ({
      rule_id: row.rule_id,
      rule_kind: row.rule_kind,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      configured_minimum_bps: row.configured_minimum_bps,
      configured_maximum_bps: row.configured_maximum_bps,
      possible_minimum_bps: row.possible_minimum_bps,
      possible_maximum_bps: row.possible_maximum_bps,
      state: row.state,
      reason_codes: row.reason_codes,
      evidence: safePolicyEvidence(row.evidence),
    })),
    portfolio_compliant: policyEvaluation.evaluation.state === "confirmed_compliant"
      ? true
      : policyEvaluation.evaluation.state === "confirmed_violation" ? false : null,
    targets_inferred: false,
    correction_calculated: false,
    rebalance_created: false,
  };
}

function latestTimestamp(values = []) {
  return values.map((value) => text(value, 80)).filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
}

function earliestTimestamp(values = []) {
  return values.map((value) => text(value, 80)).filter((value) => Number.isFinite(Date.parse(value))).sort().at(0) || null;
}

function previewDto({
  wallet,
  analysis,
  observationDiagnostics,
  priceDiagnostics,
  quoteDiagnostics,
  priceCandidates,
  quoteGroups,
  providerCalls,
  stageLatency,
  policyVersion,
  policyEvaluation,
}) {
  const { snapshot, measurement, economic_exposures: economicExposures } = analysis;
  const material = materialHoldings(snapshot);
  const holdings = material.rows.map((row) => holdingView(row, snapshot.record_hash));
  const unresolved = holdings.filter((row) => row.resolution_state === "unresolved" || row.evidence_state.length > 0);
  const liabilities = holdings.filter((row) => row.side === "liability");
  const exposures = measurement.exposures || [];
  const exposureDimensions = {};
  const byDimension = (dimension) => {
    const rows = exposures
      .filter((row) => row.scope_type === dimension)
      .map((row) => exposureView(row, snapshot.positions, snapshot.record_hash))
      .sort((left, right) => {
      const delta = bigintOrZero(right.marked_value_minor) - bigintOrZero(left.marked_value_minor);
      return delta === 0n ? left.identity.localeCompare(right.identity) : delta > 0n ? 1 : -1;
    });
    const returned = rows.slice(0, PortfolioGovernorPreviewLimits.maximum_returned_exposures_per_dimension);
    exposureDimensions[dimension] = {
      total_count: rows.length,
      returned_count: returned.length,
      truncated: rows.length > returned.length,
    };
    return returned;
  };
  const assetExposure = byDimension("asset");
  const instrumentExposure = byDimension("instrument");
  const unresolvedExposure = byDimension("unresolved");
  const protocolExposure = byDimension("protocol");
  const stablecoinIssuerExposure = byDimension("stablecoin_issuer");
  const stablecoinDependencyExposure = byDimension("stablecoin_dependency");
  const markTimes = snapshot.positions.map((row) => row.marked_at).filter(Boolean);
  const quoteObservations = analysis.observations.filter((row) => row.facts?.observation_kind === "solana_executable_exit");
  const quoteTimes = quoteObservations.map((row) => row.observed_at);
  const quoteExpiries = quoteObservations.map((row) => row.facts?.expires_at).filter(Boolean);
  const observationComplete = observationDiagnostics.successful_components?.length === observationDiagnostics.requested_components?.length;
  const analysisState = observationDiagnostics.successful_components?.length === 0
    ? "unavailable"
    : observationComplete && measurement.state === "available" ? "complete" : "partial";
  return {
    ok: true,
    schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
    state: analysisState,
    mode: "authenticated_read_only_beta_validation",
    wallet: publicWalletSelection(wallet),
    summary: {
      state: measurement.state,
      economic_numeraire: measurement.economic_numeraire,
      marked_portfolio_value_minor: measurement.total_marked_asset_value_minor,
      marked_value_state: measurement.unavailable_asset_valuations > 0 ? "partial" : "current",
      executable_value_minor: measurement.total_executable_asset_value_minor,
      executable_value_state: measurement.unavailable_executable_valuations > 0 ? "partial" : "current",
      net_equity_minor: measurement.net_equity_minor,
      net_equity_state: measurement.net_equity_minor === null ? "unavailable" : "current",
      gross_exposure_minor: measurement.gross_economic_exposure_minor,
      liabilities_minor: measurement.total_liability_value_minor,
      liability_value_state: measurement.total_liability_value_state,
      unresolved_value_minor: measurement.unresolved_value_minor,
      unresolved_unknown_value_count: measurement.unresolved_unknown_value_count,
      unrouteable_value_minor: measurement.unrouteable_value_minor,
      unknown_routeability_value_minor: measurement.unknown_routeability_value_minor,
      stale_value_minor: measurement.stale_value_minor,
      executable_coverage_bps: measurement.executable_coverage_bps,
      state_reasons: measurement.state_reasons,
    },
    holdings: {
      observed_position_count: snapshot.positions.length,
      material_position_count: material.material_count,
      returned_position_count: holdings.length,
      truncated: material.truncated,
      rows: holdings,
    },
    economic_exposure: {
      assets: assetExposure,
      instruments: instrumentExposure,
      unresolved: unresolvedExposure,
    },
    protocol_exposure: protocolExposure,
    stablecoin_exposure: {
      issuers: stablecoinIssuerExposure,
      dependencies: stablecoinDependencyExposure,
    },
    liabilities,
    unresolved_and_unsupported: {
      positions: unresolved,
      unsupported_capabilities: snapshot.normalization_diagnostics?.unsupported_capabilities || [],
      unavailable_asset_valuations: measurement.unavailable_asset_valuations,
      unavailable_liability_valuations: measurement.unavailable_liability_valuations,
    },
    policy: policyView(policyVersion, policyEvaluation),
    freshness: {
      observed_at: snapshot.observed_at,
      priced_at: latestTimestamp(markTimes),
      quoted_at: latestTimestamp(quoteTimes),
      executable_quotes_expire_at: earliestTimestamp(quoteExpiries),
      stale_value_present: bigintOrZero(measurement.stale_value_minor) > 0n,
    },
    provenance: {
      snapshot: { record_id: snapshot.snapshot_id, record_hash: snapshot.record_hash, observed_at: snapshot.observed_at },
      measurement: { record_id: measurement.measurement_id, record_hash: measurement.record_hash, calculated_at: measurement.calculated_at },
      policy_version: policyVersion ? { record_id: policyVersion.policy_version_id, record_hash: policyVersion.record_hash } : null,
      raw_wallet_address_in_records: false,
      persisted: false,
    },
    diagnostics: {
      observation_state: observationComplete ? "complete" : observationDiagnostics.successful_components?.length ? "partial" : "unavailable",
      observed_position_count: snapshot.positions.length,
      resolved_position_count: snapshot.positions.filter((row) => row.economic_resolution_state !== "unresolved").length,
      unresolved_position_count: snapshot.positions.filter((row) => row.economic_resolution_state === "unresolved").length,
      unsupported_protocol_count: snapshot.positions.filter((row) => row.position_kind === "protocol_position" && row.economic_resolution_state === "unresolved").length,
      marked_position_count: snapshot.positions.filter((row) => row.marked_value_minor !== null || row.liability_value_minor !== null).length,
      executable_position_count: snapshot.positions.filter((row) => row.executable_value_minor !== null).length,
      provider_failures: [
        ...(observationDiagnostics.failures || []).map((row) => ({ stage: "wallet_observation", component: row.component, reason: row.reason })),
        ...(priceDiagnostics.failure ? [{ stage: "marked_value", reason: priceDiagnostics.failure }] : []),
        ...(quoteDiagnostics.failure_reasons || []).map((reason) => ({ stage: "executable_value", reason })),
      ],
      provider_call_counts: providerCalls,
      provider_call_cap: PortfolioPreviewProviderLimits.rpc_components + 1 + PortfolioGovernorPreviewLimits.maximum_executable_quote_groups,
      price_mints: {
        observed: priceCandidates.observed_unique_mint_count,
        requested: priceDiagnostics.requested_mints,
        priced: priceDiagnostics.priced_mints,
        capacity_omitted: priceCandidates.omitted_mint_count,
        decimals_conflicts: priceCandidates.decimals_conflict_count,
      },
      executable_quote_groups: {
        requested: quoteDiagnostics.requested_groups,
        routeable: quoteDiagnostics.routeable_groups,
        unrouteable: quoteDiagnostics.unrouteable_groups,
        failed: quoteDiagnostics.failed_groups,
        bounded_deferred: quoteGroups.deferred_group_count,
        duplicate_position_quotes_avoided: quoteGroups.duplicate_position_quotes_avoided,
      },
      exposure_rows: exposureDimensions,
      latency_ms: stageLatency,
      conservation: {
        passed: analysis.conservation.ok,
        visible_nav_not_doubled: analysis.conservation.ok,
        analytical_overlays_add_nav: false,
      },
      invariant_refusal_triggered: false,
      wallet_identity_logged: false,
      portfolio_history_persisted: false,
    },
    boundaries: {
      read_only: true,
      customer_assets_can_move: false,
      policy_targets_inferred: false,
      market_posture_effect: "none",
      correction_calculated: false,
      rebalance_created: false,
      execution_quote_created: false,
      transaction_material_created: false,
      signing_requested: false,
      submission_available: false,
      custody: false,
    },
  };
}

export async function analyzeSolanaPortfolioPreview({
  user_id: userId,
  wallet,
  rpc_url: rpcUrl,
  jupiter_api_key: jupiterApiKey,
  policy_version: policyVersion = null,
  fetch_impl: fetchImpl = globalThis.fetch,
  rpc_request: injectedRpcRequest = null,
  price_fetcher: priceFetcher = fetchPortfolioPriceObservations,
  executable_fetcher: executableFetcher = fetchPortfolioExecutableObservations,
  now = () => Date.now(),
} = {}) {
  const overallTimer = stageTimer(now);
  const providerCalls = { solana_rpc: 0, jupiter_price: 0, jupiter_executable_quote: 0, total: 0 };
  const onProviderCall = (component) => {
    if (component in providerCalls) providerCalls[component] += 1;
    providerCalls.total += 1;
  };
  const portfolioId = portfolioIdentity(userId, wallet.wallet_reference);
  const observedAt = new Date(now()).toISOString();
  const stageLatency = {};

  const observationTimer = stageTimer(now);
  const rpcRequest = injectedRpcRequest
    ? async (method, params) => {
        onProviderCall("solana_rpc");
        return injectedRpcRequest(method, params);
      }
    : createPortfolioSolanaRpcRequest({
        rpc_url: rpcUrl,
        wallet_reference: wallet.wallet_reference,
        fetch_impl: fetchImpl,
        on_provider_call: onProviderCall,
      });
  const observed = await observeSolanaWallet({
    wallet_address: wallet.address,
    wallet_reference: wallet.wallet_reference,
    rpc_request: rpcRequest,
    provider: "existing_solana_rpc",
    observed_at: observedAt,
  });
  stageLatency.wallet_observation = observationTimer();
  if (!observed.observations.length || !observed.diagnostics.successful_components.length) {
    const error = new Error("portfolio_wallet_observation_unavailable");
    error.preview_diagnostics = { provider_calls: providerCalls, observation: observed.diagnostics, latency_ms: { ...stageLatency, total: overallTimer() } };
    throw error;
  }

  const priceCandidates = collectPortfolioPriceCandidates(observed.observations);
  const priceTimer = stageTimer(now);
  const priced = await priceFetcher({
    candidates: priceCandidates.selected,
    api_key: jupiterApiKey,
    observed_at: new Date(now()).toISOString(),
    fetch_impl: fetchImpl,
    on_provider_call: onProviderCall,
  });
  stageLatency.marked_value = priceTimer();
  const firstCalculatedAt = new Date(now()).toISOString();
  const first = buildSolanaExposurePortfolio({
    portfolio_id: portfolioId,
    user_id: userId,
    observed_at: observedAt,
    calculated_at: firstCalculatedAt,
    observations: [...observed.observations, ...(priced.observations || [])],
    minimum_material_value_minor: PortfolioGovernorPreviewLimits.minimum_material_marked_value_minor,
    minimum_portfolio_weight_bps: PortfolioGovernorPreviewLimits.minimum_material_weight_bps,
    maximum_auto_quotes: PortfolioGovernorPreviewLimits.maximum_quote_candidate_positions,
  });

  const quoteGroups = groupPortfolioExecutableCandidates({
    positions: first.snapshot.positions,
    selected_position_ids: first.valuation_plan.selected.map((row) => row.position_id),
    maximum_groups: PortfolioGovernorPreviewLimits.maximum_executable_quote_groups,
  });
  const quoteTimer = stageTimer(now);
  const quoted = await executableFetcher({
    groups: quoteGroups.selected,
    api_key: jupiterApiKey,
    fetch_impl: fetchImpl,
    now_ms: now(),
    on_provider_call: onProviderCall,
  });
  stageLatency.executable_value = quoteTimer();

  const calculationTimer = stageTimer(now);
  const finalCalculatedAt = new Date(now()).toISOString();
  let analysis;
  try {
    analysis = buildSolanaExposurePortfolio({
      portfolio_id: portfolioId,
      user_id: userId,
      observed_at: observedAt,
      calculated_at: finalCalculatedAt,
      observations: [
        ...observed.observations,
        ...(priced.observations || []),
        ...(quoted.observations || []),
      ],
      minimum_material_value_minor: PortfolioGovernorPreviewLimits.minimum_material_marked_value_minor,
      minimum_portfolio_weight_bps: PortfolioGovernorPreviewLimits.minimum_material_weight_bps,
      maximum_auto_quotes: 0,
    });
  } catch (cause) {
    const error = new Error(String(cause?.message || "").includes("conservation")
      ? "portfolio_conservation_invariant_failed"
      : "portfolio_measurement_failed");
    error.preview_diagnostics = { provider_calls: providerCalls, latency_ms: { ...stageLatency, total: overallTimer() } };
    throw error;
  }
  if (!analysis.conservation.ok) {
    const error = new Error("portfolio_conservation_invariant_failed");
    error.preview_diagnostics = { provider_calls: providerCalls, latency_ms: { ...stageLatency, total: overallTimer() } };
    throw error;
  }
  stageLatency.calculation = calculationTimer();

  let policyEvaluation = null;
  if (policyVersion) {
    if (!verifyGovernorRecord(policyVersion).ok || policyVersion.record_type !== "UserPolicyVersion") throw new Error("portfolio_policy_record_invalid");
    policyEvaluation = evaluatePortfolioPolicy({
      policy_version: policyVersion,
      snapshot: analysis.snapshot,
      measurement: analysis.measurement,
      calculated_at: finalCalculatedAt,
      evaluation_id: `eval_preview_${canonicalContractHash({
        policy: policyVersion.record_hash,
        snapshot: analysis.snapshot.record_hash,
        measurement: analysis.measurement.record_hash,
      }).slice(0, 24)}`,
    });
  }
  stageLatency.total = overallTimer();
  const dto = previewDto({
    wallet,
    analysis,
    observationDiagnostics: observed.diagnostics,
    priceDiagnostics: priced.diagnostics || {},
    quoteDiagnostics: quoted.diagnostics || {},
    priceCandidates,
    quoteGroups,
    providerCalls,
    stageLatency,
    policyVersion,
    policyEvaluation,
  });
  if (JSON.stringify(dto).includes(wallet.address)) throw new Error("portfolio_preview_wallet_address_leak");
  return Object.freeze({ dto, analysis, policy_evaluation: policyEvaluation });
}

function responseWithAuthHeaders(response, authorization) {
  if (!authorization?.response_headers) return response;
  const headers = new Headers(response.headers);
  const setCookie = authorization.response_headers.get("set-cookie");
  if (setCookie) headers.append("set-cookie", setCookie);
  headers.set("vary", "Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function previewJson(payload, init = {}, authorization = null) {
  return responseWithAuthHeaders(boundedJsonResponse(payload, init, {
    max_bytes: PortfolioGovernorPreviewLimits.maximum_response_bytes,
    fallback_payload: {
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: "unavailable",
      error: "portfolio_preview_response_too_large",
      boundaries: { read_only: true, customer_assets_can_move: false, transaction_material_created: false },
    },
  }), authorization);
}

async function resolveWalletRows(env, principal, deps) {
  const rows = deps.resolveAuthorizedWallets
    ? await deps.resolveAuthorizedWallets({ user_id: principal.user_id, session_public_id: principal.session_public_id })
    : authorizedPortfolioPreviewWallets(env, principal.user_id);
  return normalizeAuthorizedWalletRows(rows, principal.user_id);
}

async function enforcePreviewRateLimits({ authorization, env, request, walletReference }) {
  const checks = [
    { scope: "account", subject: authorization.principal.user_id, window_seconds: 15 * 60, limit: PortfolioGovernorPreviewLimits.account_requests_per_15_minutes },
    { scope: "wallet", subject: `${authorization.principal.user_id}:${walletReference}`, window_seconds: 5 * 60, limit: PortfolioGovernorPreviewLimits.wallet_requests_per_5_minutes },
    { scope: "network", subject: "portfolio_preview_network", window_seconds: 15 * 60, limit: PortfolioGovernorPreviewLimits.network_requests_per_15_minutes, include_network: true },
  ];
  for (const check of checks) {
    const result = await consumeCustomerRateLimit({
      store: authorization.store,
      env,
      request,
      action: "portfolio_preview",
      now: authorization.now,
      ...check,
    });
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

function emitTelemetry(deps, payload) {
  const safe = {
    event: "ravenos_portfolio_preview",
    at: new Date().toISOString(),
    state: text(payload?.state || "unknown", 40),
    duration_ms: Number(payload?.diagnostics?.latency_ms?.total || 0),
    provider_call_counts: payload?.diagnostics?.provider_call_counts || {},
    observed_position_count: Number(payload?.diagnostics?.observed_position_count || 0),
    resolved_position_count: Number(payload?.diagnostics?.resolved_position_count || 0),
    unresolved_position_count: Number(payload?.diagnostics?.unresolved_position_count || 0),
    invariant_passed: payload?.diagnostics?.conservation?.passed === true,
    wallet_identity_logged: false,
  };
  if (typeof deps.telemetry === "function") deps.telemetry(safe);
  else console.log(JSON.stringify(safe));
}

export async function routePortfolioGovernorPreview(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname !== PORTFOLIO_GOVERNOR_PREVIEW_ROUTE) return null;
  if (!new Set(["GET", "POST"]).has(request.method)) {
    return previewJson({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "GET, POST" } });
  }
  const authorization = await authorizeCustomerApiRequest(request, env, deps, { require_csrf: request.method === "POST" });
  if (authorization.response) return authorization.response;
  if (env.RAVENOS_PORTFOLIO_PREVIEW_ENABLE !== "1" && !deps.resolveAuthorizedWallets) {
    return previewJson({
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: "not_configured",
      error: "portfolio_preview_not_configured",
      boundaries: { read_only: true, customer_assets_can_move: false, transaction_material_created: false },
    }, { status: 503 }, authorization);
  }

  let wallets;
  try {
    wallets = await resolveWalletRows(env, authorization.principal, deps);
  } catch {
    return previewJson({
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: "unavailable",
      error: "portfolio_preview_wallet_authorization_unavailable",
    }, { status: 503 }, authorization);
  }

  if (request.method === "GET") {
    return previewJson({
      ok: true,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: wallets.length ? "available" : "no_authorized_wallet",
      mode: "authenticated_read_only_beta_validation",
      wallets: wallets.map(publicWalletSelection),
      wallet_link_registry_active: false,
      authorization_boundary: "account_bound_operator_authorized_beta",
      arbitrary_address_input_allowed: false,
      policy_storage: "not_available",
      portfolio_history_persisted: false,
      execution_boundary: { rebalance: false, transaction_material: false, signing: false, submission: false, custody: false },
    }, {}, authorization);
  }

  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: PortfolioGovernorPreviewLimits.maximum_request_bytes });
  } catch (error) {
    return previewJson({
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      error: error?.code === "request_too_large" ? "portfolio_preview_request_too_large" : "portfolio_preview_request_invalid",
    }, { status: error?.code === "request_too_large" ? 413 : 400 }, authorization);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !ALLOWED_REQUEST_FIELDS.has(key))) {
    return previewJson({ ok: false, schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA, error: "portfolio_preview_request_invalid" }, { status: 400 }, authorization);
  }
  const walletReference = text(body.wallet_reference, 100);
  const wallet = wallets.find((row) => row.wallet_reference === walletReference);
  if (!wallet) {
    return previewJson({ ok: false, schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA, error: "portfolio_preview_wallet_not_found" }, { status: 404 }, authorization);
  }

  let limited;
  try {
    limited = await enforcePreviewRateLimits({ authorization, env, request, walletReference });
  } catch {
    return previewJson({ ok: false, schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA, error: "portfolio_preview_rate_limit_unavailable" }, { status: 503 }, authorization);
  }
  if (!limited.allowed) {
    return previewJson({
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: "rate_limited",
      error: "portfolio_preview_rate_limited",
    }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
  }

  let policyVersion = null;
  if (typeof deps.resolvePolicyVersion === "function") {
    try {
      policyVersion = await deps.resolvePolicyVersion({
        user_id: authorization.principal.user_id,
        portfolio_id: portfolioIdentity(authorization.principal.user_id, wallet.wallet_reference),
        wallet_reference: wallet.wallet_reference,
      });
    } catch {
      return previewJson({
        ok: false,
        schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
        state: "unavailable",
        error: "portfolio_policy_unavailable",
        provider_calls_started: false,
        boundaries: { read_only: true, customer_assets_can_move: false, transaction_material_created: false },
      }, { status: 503 }, authorization);
    }
  }
  const analyze = deps.analyze || analyzeSolanaPortfolioPreview;
  const operation = () => analyze({
    user_id: authorization.principal.user_id,
    wallet,
    rpc_url: env.RAVENOS_SOLANA_RPC_URL,
    jupiter_api_key: env.JUPITER_API_KEY,
    policy_version: policyVersion,
    fetch_impl: deps.fetchImpl || globalThis.fetch,
    rpc_request: deps.rpcRequest || null,
    price_fetcher: deps.priceFetcher || fetchPortfolioPriceObservations,
    executable_fetcher: deps.executableFetcher || fetchPortfolioExecutableObservations,
    now: deps.now || (() => Date.now()),
  });
  try {
    const result = await withOperationBudget(operation, {
      timeout_ms: routeBudget("portfolio_governor_preview").timeout_ms,
      on_timeout: () => null,
    });
    if (!result) {
      return previewJson({
        ok: false,
        schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
        state: "partial",
        error: "portfolio_preview_timeout",
        partial_results_available: false,
        boundaries: { read_only: true, customer_assets_can_move: false, transaction_material_created: false },
      }, { status: 504 }, authorization);
    }
    emitTelemetry(deps, result.dto);
    return previewJson(result.dto, {}, authorization);
  } catch (error) {
    const invariantFailed = text(error?.message, 160).includes("conservation_invariant");
    if (typeof deps.telemetry === "function") deps.telemetry({
      event: "ravenos_portfolio_preview_refused",
      state: invariantFailed ? "invariant_failed" : "unavailable",
      invariant_passed: false,
      wallet_identity_logged: false,
      provider_call_counts: error?.preview_diagnostics?.provider_calls || {},
    });
    return previewJson({
      ok: false,
      schema_version: PORTFOLIO_GOVERNOR_PREVIEW_SCHEMA,
      state: invariantFailed ? "invariant_failed" : "unavailable",
      error: invariantFailed ? "portfolio_accounting_invariant_failed" : "portfolio_preview_unavailable",
      normal_portfolio_response_served: false,
      diagnostics: {
        invariant_refusal_triggered: invariantFailed,
        provider_call_counts: error?.preview_diagnostics?.provider_calls || {},
        wallet_identity_logged: false,
        portfolio_history_persisted: false,
      },
      boundaries: {
        read_only: true,
        customer_assets_can_move: false,
        rebalance_created: false,
        execution_quote_created: false,
        transaction_material_created: false,
        signing_requested: false,
        submission_available: false,
      },
    }, { status: 503 }, authorization);
  }
}
