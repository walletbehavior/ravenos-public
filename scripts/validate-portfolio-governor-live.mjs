#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { analyzeSolanaPortfolioPreview } from "../lib/portfolio_governor/preview.mjs";

const MAXIMUM_VALIDATION_CASES = 8;

function boundedText(value, maximum = 100) {
  return String(value ?? "").trim().slice(0, maximum);
}

function bps(numerator, denominator) {
  const top = BigInt(numerator || "0");
  const bottom = BigInt(denominator || "0");
  return bottom > 0n ? Number((top * 10_000n + bottom / 2n) / bottom) : null;
}

function countKinds(rows = [], predicate = () => true) {
  const counts = {};
  for (const row of rows.filter(predicate)) {
    const kind = boundedText(row.position_kind || "unknown", 60) || "unknown";
    counts[kind] = Number(counts[kind] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function countValues(values = []) {
  const counts = {};
  for (const value of values) {
    const key = boundedText(value || "unknown", 80) || "unknown";
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function safeFailure(error) {
  const reason = boundedText(error?.message, 160);
  const allowed = new Set([
    "portfolio_wallet_observation_unavailable",
    "portfolio_conservation_invariant_failed",
    "portfolio_measurement_failed",
    "portfolio_preview_wallet_address_leak",
    "portfolio_rpc_url_invalid",
  ]);
  return allowed.has(reason) ? reason : "portfolio_live_validation_failed";
}

export function sanitizedPortfolioValidationCase(result, caseIndex) {
  const dto = result.dto;
  const snapshot = result.analysis.snapshot;
  const measurement = result.analysis.measurement;
  const positions = snapshot.positions || [];
  const assets = positions.filter((row) => row.position_side !== "liability" && row.counted_in_nav);
  const markedAssets = assets.filter((row) => row.marked_value_minor !== null);
  const resolvedMarkedValue = markedAssets
    .filter((row) => row.economic_resolution_state !== "unresolved")
    .reduce((sum, row) => sum + BigInt(row.marked_value_minor), 0n);
  const totalMarked = BigInt(measurement.total_marked_asset_value_minor || "0");
  const liabilities = positions.filter((row) => row.position_side === "liability");
  const unrouteable = positions.filter((row) => row.routeability === "not_routeable");
  const stale = positions.filter((row) => ["stale", "delayed"].includes(row.marked_value_state));
  const unresolvedReasons = (result.analysis.economic_exposures || [])
    .filter((row) => row.dimension_type === "unresolved")
    .map((row) => row.resolution_source);
  const deferredReasons = (result.analysis.valuation_plan?.deferred || []).map((row) => row.reason);
  const riskFlags = positions.flatMap((row) => row.risk_flags || []).filter((flag) => !String(flag).includes(":"));
  return Object.freeze({
    case_id: `case_${String(caseIndex + 1).padStart(2, "0")}`,
    state: dto.state,
    positions: {
      observed: positions.length,
      resolved: dto.diagnostics.resolved_position_count,
      unresolved: dto.diagnostics.unresolved_position_count,
      resolution_coverage_bps: bps(dto.diagnostics.resolved_position_count, positions.length),
      marked: markedAssets.length,
      unvalued: assets.length - markedAssets.length,
      marked_position_coverage_bps: bps(markedAssets.length, assets.length),
      resolved_marked_value_share_bps: totalMarked > 0n ? bps(resolvedMarkedValue, totalMarked) : null,
      unresolved_structure_kinds: countKinds(positions, (row) => row.economic_resolution_state === "unresolved"),
      unresolved_reason_counts: countValues(unresolvedReasons),
      valuation_deferred_reason_counts: countValues(deferredReasons),
      risk_flag_counts: countValues(riskFlags),
      unsupported_capabilities: snapshot.normalization_diagnostics?.unsupported_capabilities || [],
    },
    exposure: {
      executable_coverage_bps: measurement.executable_coverage_bps,
      unresolved_value_present: BigInt(measurement.unresolved_value_minor || "0") > 0n,
      unresolved_unknown_value_count: measurement.unresolved_unknown_value_count,
      unrouteable_position_count: unrouteable.length,
      stale_position_count: stale.length,
      liabilities_detected: liabilities.length,
      unavailable_liability_valuations: measurement.unavailable_liability_valuations,
      net_equity_available: measurement.net_equity_minor !== null,
    },
    providers: {
      calls: dto.diagnostics.provider_call_counts,
      call_cap: dto.diagnostics.provider_call_cap,
      failures: dto.diagnostics.provider_failures,
      latency_ms: dto.diagnostics.latency_ms,
      price_mints: dto.diagnostics.price_mints,
      executable_quote_groups: dto.diagnostics.executable_quote_groups,
    },
    invariants: {
      conservation_passed: result.analysis.conservation.ok,
      refusal_triggered: dto.diagnostics.invariant_refusal_triggered,
    },
    policy: {
      state: dto.policy.state,
      targets_inferred: dto.policy.targets_inferred,
      correction_calculated: dto.policy.correction_calculated === true,
    },
    boundaries: {
      read_only: dto.boundaries.read_only,
      execution_quote_created: dto.boundaries.execution_quote_created,
      transaction_material_created: dto.boundaries.transaction_material_created,
      signing_requested: dto.boundaries.signing_requested,
      portfolio_history_persisted: dto.diagnostics.portfolio_history_persisted,
      raw_wallet_identity_output: false,
    },
  });
}

function validationCasesFromEnvironment(env) {
  if (env.RAVENOS_PORTFOLIO_VALIDATION_ACK !== "authorized_read_only") {
    throw new Error("portfolio_validation_authorization_ack_required");
  }
  let rows;
  try {
    rows = JSON.parse(boundedText(env.RAVENOS_PORTFOLIO_VALIDATION_WALLETS, 64 * 1024));
  } catch {
    throw new Error("portfolio_validation_wallets_invalid");
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > MAXIMUM_VALIDATION_CASES) {
    throw new Error("portfolio_validation_wallets_invalid");
  }
  return rows.map((row, index) => ({
    address: boundedText(row?.address, 64),
    wallet_reference: `wpr_live_validation_case_${String(index + 1).padStart(2, "0")}`,
    label: `Authorized validation case ${index + 1}`,
    chain: "solana",
    network: "mainnet",
    authorization_basis: "operator_authorized_live_validation",
    persisted_portfolio_history: false,
  }));
}

export async function runAuthorizedLiveValidation({
  env = process.env,
  analyze = analyzeSolanaPortfolioPreview,
  now = () => Date.now(),
} = {}) {
  const wallets = validationCasesFromEnvironment(env);
  if (!boundedText(env.RAVENOS_SOLANA_RPC_URL, 1_000) || !boundedText(env.JUPITER_API_KEY, 500)) {
    throw new Error("portfolio_validation_provider_configuration_required");
  }
  const cases = [];
  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    try {
      const result = await analyze({
        user_id: `usr_live_validation_${String(index + 1).padStart(2, "0")}`,
        wallet,
        rpc_url: env.RAVENOS_SOLANA_RPC_URL,
        jupiter_api_key: env.JUPITER_API_KEY,
        policy_version: null,
        now,
      });
      cases.push(sanitizedPortfolioValidationCase(result, index));
    } catch (error) {
      cases.push({
        case_id: `case_${String(index + 1).padStart(2, "0")}`,
        state: "refused",
        reason: safeFailure(error),
        provider_calls: error?.preview_diagnostics?.provider_calls || {},
        invariant_refusal_triggered: boundedText(error?.message, 160).includes("conservation_invariant"),
        raw_wallet_identity_output: false,
      });
    }
  }
  const report = {
    schema_version: "ravenos.portfolio_governor_live_validation.v1",
    generated_at: new Date(now()).toISOString(),
    mode: "authorized_read_only_no_persistence",
    cases,
  };
  const serialized = JSON.stringify(report);
  if (wallets.some((wallet) => serialized.includes(wallet.address))) throw new Error("portfolio_validation_wallet_identity_leak");
  return Object.freeze(report);
}

async function main() {
  try {
    const report = await runAuthorizedLiveValidation();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.cases.some((row) => row.state === "refused" || row.invariants?.conservation_passed !== true)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${safeFailure(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
