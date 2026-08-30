#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOLANA_CANONICAL_USDC_MINT,
  SOLANA_WRAPPED_NATIVE_MINT,
  buildSolanaWalletProfile,
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
  walletEventDisplayAmount,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  RavenCopyFeeScenariosBps,
  createRavenCopyDecision,
  createRavenCopyPolicy,
} from "../lib/customer_trade/wallet_copy.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MAX_RESPONSE_BYTES = 768 * 1024;
const DEFAULT_HISTORY_LIMIT = 24;

function clean(value, maximum = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) throw new Error("wallet_copy_validation_argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("wallet_copy_validation_argument_missing");
    output[entry.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return output;
}

function selectedEnvironment(base = process.env) {
  const output = { ...base };
  const path = clean(base.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env"), 1_000);
  if (!path || !existsSync(path)) return output;
  const allowed = new Set(["RAVENOS_SOLANA_RPC_URL", "SOLANA_ALCHEMY_RPC_URL", "JUPITER_API_KEY"]);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const boundary = trimmed.indexOf("=");
    const key = trimmed.slice(0, boundary).trim().replace(/^export\s+/, "");
    if (!allowed.has(key) || clean(output[key], 2_000)) continue;
    let value = trimmed.slice(boundary + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

async function boundedJson(url, init = {}, { timeoutMs = 6_000, maximumBytes = MAX_RESPONSE_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider_timeout")), timeoutMs);
  try {
    const response = await fetch(url, { redirect: "error", ...init, signal: controller.signal });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maximumBytes) throw new Error("provider_response_too_large");
    const body = await response.arrayBuffer();
    if (body.byteLength > maximumBytes) throw new Error("provider_response_too_large");
    const payload = JSON.parse(new TextDecoder().decode(body));
    if (!response.ok) throw new Error(response.status === 429 ? "provider_rate_limited" : "provider_unavailable");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(rpcUrl, method, params, providerCalls) {
  providerCalls.solana_rpc += 1;
  const payload = await boundedJson(rpcUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: providerCalls.solana_rpc, method, params }),
  });
  if (payload?.error || !("result" in (payload || {}))) throw new Error("solana_rpc_response_invalid");
  return payload.result;
}

async function jupiterQuote({ apiKey, inputMint, outputMint, amount, slippageBps = 50, providerCalls }) {
  const url = new URL("https://api.jup.ag/swap/v2/order");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("slippageBps", String(slippageBps));
  url.searchParams.set("swapMode", "ExactIn");
  const requestedAt = new Date().toISOString();
  providerCalls.jupiter += 1;
  const payload = await boundedJson(url, { headers: { accept: "application/json", "x-api-key": apiKey } }, { timeoutMs: 5_000, maximumBytes: 128 * 1024 });
  const receivedAt = new Date().toISOString();
  if (payload?.transaction || payload?.swapTransaction || payload?.transactions) throw new Error("transaction_material_returned");
  if (payload.inputMint && payload.inputMint !== inputMint) throw new Error("jupiter_input_identity_mismatch");
  if (payload.outputMint && payload.outputMint !== outputMint) throw new Error("jupiter_output_identity_mismatch");
  const input = String(payload.inAmount || amount);
  const output = String(payload.outAmount || "");
  const minimum = String(payload.otherAmountThreshold || "");
  if (input !== String(amount) || !/^\d+$/.test(output) || !/^\d+$/.test(minimum) || BigInt(output) <= 0n || BigInt(minimum) <= 0n || BigInt(minimum) > BigInt(output)) {
    throw new Error("jupiter_quote_invalid");
  }
  const routes = (Array.isArray(payload.routePlan) ? payload.routePlan : []).map((row) => row?.swapInfo || row).filter(Boolean).slice(0, 8);
  if (routes.length && (!routes.some((row) => row.inputMint === inputMint) || !routes.some((row) => row.outputMint === outputMint))) {
    throw new Error("jupiter_route_identity_mismatch");
  }
  return { payload, routes, requestedAt, receivedAt };
}

function display(baseUnits, decimals) {
  const amount = BigInt(String(baseUnits));
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(`${whole}${fraction ? `.${fraction}` : ""}`);
}

function usdcBaseUnits(amount) {
  const normalized = Number(amount).toFixed(6);
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "") || "0";
}

function routeEvidence(quote, decimals) {
  const impact = Number(quote.payload.priceImpactPct);
  const quotedAt = clean(quote.payload.quoteTimestamp, 80) || quote.receivedAt;
  return {
    state: "available",
    quote_id: clean(quote.payload.quoteId || quote.payload.requestId, 150) || `live_${digest(`${quote.requestedAt}:${quote.payload.outAmount}`)}`,
    provider: "jupiter",
    requested_at: quote.requestedAt,
    quoted_at: quotedAt,
    received_at: quote.receivedAt,
    expires_at: new Date(Math.min(Date.parse(quotedAt) + 20_000, Date.parse(quote.receivedAt) + 20_000)).toISOString(),
    expected_output: display(quote.payload.outAmount, decimals),
    minimum_output: display(quote.payload.otherAmountThreshold, decimals),
    price_impact_bps: Number.isFinite(impact) ? Math.max(0, Math.min(10_000, Math.round(impact * 100))) : null,
    latency_ms: Math.max(0, Date.parse(quote.receivedAt) - Date.parse(quote.requestedAt)),
    venues: [...new Set(quote.routes.map((row) => clean(row.label, 60)).filter(Boolean))],
    exact_asset_identity: true,
  };
}

function finality(value) {
  return new Set(["processed", "confirmed", "finalized"]).has(value) ? value : "confirmed";
}

async function loadWalletHistory({ rpcUrl, wallet, limit, sourceSignature, providerCalls }) {
  const signatures = await rpc(rpcUrl, "getSignaturesForAddress", [wallet, { limit, commitment: "confirmed" }], providerCalls);
  const rows = (Array.isArray(signatures) ? signatures : []).filter((row) => clean(row?.signature, 100).length >= 64).slice(0, limit);
  if (!rows.length) throw new Error("wallet_history_unavailable");
  const receivedAt = new Date().toISOString();
  const events = [];
  for (let offset = 0; offset < rows.length; offset += 4) {
    const batch = rows.slice(offset, offset + 4);
    const settled = await Promise.allSettled(batch.map(async (row) => {
      const startedAt = new Date().toISOString();
      const transaction = await rpc(rpcUrl, "getTransaction", [row.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], providerCalls);
      const completedAt = new Date().toISOString();
      if (!transaction) throw new Error("wallet_transaction_unavailable");
      return normalizeSolanaWalletTransaction({
        wallet_address: wallet,
        signature_record: row,
        transaction,
        provider: "configured_solana_rpc",
        finality: finality(row.confirmationStatus),
        observation_mode: row.signature === sourceSignature ? "prospective" : "historical_backfill",
        provider_observed_at: receivedAt,
        received_at: receivedAt,
        decode_started_at: startedAt,
        decoded_at: completedAt,
        observed_at: completedAt,
      });
    }));
    for (const row of settled) if (row.status === "fulfilled") events.push(row.value);
  }
  if (!events.length) throw new Error("wallet_history_decode_unavailable");
  return events;
}

async function liquidityForToken(mint, providerCalls) {
  providerCalls.dexscreener += 1;
  try {
    const rows = await boundedJson(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { headers: { accept: "application/json" } }, { timeoutMs: 5_000, maximumBytes: 512 * 1024 });
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.chainId === "solana" && (row?.baseToken?.address === mint || row?.quoteToken?.address === mint))
      .map((row) => Number(row?.liquidity?.usd))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0] ?? null;
  } catch {
    return null;
  }
}

export async function runWalletCopyLiveValidation(input = {}, { env = process.env } = {}) {
  const selected = selectedEnvironment(env);
  const rpcUrl = clean(selected.RAVENOS_SOLANA_RPC_URL || selected.SOLANA_ALCHEMY_RPC_URL, 2_000);
  const apiKey = clean(selected.JUPITER_API_KEY, 1_000);
  if (!rpcUrl || !apiKey) throw new Error("wallet_copy_validation_provider_configuration_required");
  const wallet = normalizeSolanaWalletAddress(input.wallet);
  const sourceSignature = clean(input.source_signature, 100);
  if (sourceSignature.length < 64) throw new Error("wallet_copy_validation_source_signature_required");
  const amountUsdc = Number(input.amount_usdc ?? 100);
  if (!Number.isFinite(amountUsdc) || amountUsdc < 1 || amountUsdc > 10_000) throw new Error("wallet_copy_validation_amount_invalid");
  const feeBps = Number(input.fee_bps ?? 10);
  if (!RavenCopyFeeScenariosBps.includes(feeBps)) throw new Error("wallet_copy_validation_fee_invalid");
  const limit = Math.max(1, Math.min(DEFAULT_HISTORY_LIMIT, Number(input.limit) || DEFAULT_HISTORY_LIMIT));
  const providerCalls = { solana_rpc: 0, jupiter: 0, dexscreener: 0 };
  const startedAt = Date.now();
  const events = await loadWalletHistory({ rpcUrl, wallet, limit, sourceSignature, providerCalls });
  const selectedEvent = events.find((row) => row.chain_evidence.signature === sourceSignature);
  if (!selectedEvent) throw new Error("wallet_copy_validation_source_event_unavailable");
  if (!selectedEvent.copy_signal?.eligible_buy_signal) throw new Error("wallet_copy_validation_source_event_not_copy_buy");
  const token = selectedEvent.economic.destination_asset;
  const [supply, mintAccount] = await Promise.all([
    rpc(rpcUrl, "getTokenSupply", [token.mint, { commitment: "confirmed" }], providerCalls),
    rpc(rpcUrl, "getAccountInfo", [token.mint, { encoding: "jsonParsed", commitment: "confirmed" }], providerCalls),
  ]);
  const decimals = Number(supply?.value?.decimals);
  if (!Number.isInteger(decimals) || decimals !== Number(token.decimals)) throw new Error("wallet_copy_validation_token_decimals_unresolved");
  const tokenProgram = clean(mintAccount?.value?.owner, 60);
  const tokenStandard = tokenProgram === TOKEN_PROGRAM ? "spl" : tokenProgram === TOKEN_2022_PROGRAM ? "spl_token_2022" : null;
  if (!tokenStandard) throw new Error("wallet_copy_validation_token_standard_unresolved");
  const parsedMint = mintAccount?.value?.data?.parsed?.info || {};
  const extensions = Array.isArray(parsedMint.extensions) ? parsedMint.extensions : [];
  const entryRaw = await jupiterQuote({ apiKey, inputMint: SOLANA_CANONICAL_USDC_MINT, outputMint: token.mint, amount: usdcBaseUnits(amountUsdc), providerCalls });
  const exitRaw = await jupiterQuote({ apiKey, inputMint: token.mint, outputMint: SOLANA_CANONICAL_USDC_MINT, amount: entryRaw.payload.outAmount, providerCalls });
  let sourceNotionalUsdc = null;
  let sourceNotionalBasis = "unavailable";
  const source = selectedEvent.economic.source_asset;
  if (source?.mint === SOLANA_CANONICAL_USDC_MINT && Number(source.decimals) === 6) {
    sourceNotionalUsdc = walletEventDisplayAmount(source);
    sourceNotionalBasis = "source_wallet_canonical_usdc_delta";
  } else if (new Set(["native_sol", SOLANA_WRAPPED_NATIVE_MINT]).has(source?.mint) && Number(source.decimals) === 9) {
    const conversion = await jupiterQuote({ apiKey, inputMint: SOLANA_WRAPPED_NATIVE_MINT, outputMint: SOLANA_CANONICAL_USDC_MINT, amount: source.amount_base_units, providerCalls }).catch(() => null);
    if (conversion) {
      sourceNotionalUsdc = display(conversion.payload.outAmount, 6);
      sourceNotionalBasis = "source_sol_converted_to_usdc_at_raven_detection";
    }
  }
  const liquidityUsd = await liquidityForToken(token.mint, providerCalls);
  const policy = createRavenCopyPolicy({
    sizing: { kind: "FIXED_USDC", fixed_usdc: amountUsdc },
    execution_quality: {
      maximum_detection_delay_ms: 600_000,
      maximum_quote_age_ms: 60_000,
      maximum_entry_degradation_bps: 10_000,
      maximum_price_impact_bps: 10_000,
      maximum_round_trip_friction_pct: 100,
      minimum_executable_exit_usdc: 0,
      minimum_liquidity_usd: 0,
      require_executable_exit: true,
      allowed_chains: ["solana"],
    },
    hypothetical_raven_fee_bps: feeBps,
  });
  const decision = createRavenCopyDecision({
    watch_id: `wcw_live_validation_${digest(wallet)}`,
    source_event: selectedEvent,
    policy,
    source_notional_usdc: sourceNotionalUsdc,
    source_notional_basis: sourceNotionalBasis,
    liquidity_usd: liquidityUsd,
    asset_evidence: {
      identity_resolved: true,
      token_standard: tokenStandard,
      token_standard_resolved: true,
      sell_simulation_state: "not_requested",
      reverse_sell_quote_state: "available",
      freeze_authority_present: Object.hasOwn(parsedMint, "freezeAuthority") ? parsedMint.freezeAuthority !== null : null,
      mint_authority_present: Object.hasOwn(parsedMint, "mintAuthority") ? parsedMint.mintAuthority !== null : null,
      transfer_fee_detected: tokenStandard === "spl_token_2022" ? extensions.some((row) => /transferfee/i.test(clean(row?.extension || row?.type, 80))) : false,
    },
    entry: routeEvidence(entryRaw, decimals),
    exit: routeEvidence(exitRaw, 6),
  });
  const profile = buildSolanaWalletProfile(events);
  const eventBytes = events.map(jsonBytes).sort((left, right) => left - right);
  const medianEventBytes = eventBytes.length % 2
    ? eventBytes[Math.floor(eventBytes.length / 2)]
    : Math.round((eventBytes[(eventBytes.length / 2) - 1] + eventBytes[eventBytes.length / 2]) / 2);
  const report = {
    schema_version: "ravenos.wallet_copy_live_validation.v1",
    generated_at: new Date().toISOString(),
    mode: "authorized_read_only_manual_probe",
    persistence: false,
    source_wallet_reference: `public_wallet_${digest(wallet)}`,
    history: {
      transactions_requested: limit,
      normalized_events: events.length,
      classifications: profile.behavior.classifications,
      known_cost_basis_pct: profile.coverage.known_cost_basis_pct,
      source_performance_state: profile.source_performance.state,
      source_realized_pnl_usdc: profile.source_performance.realized_pnl_usdc,
      source_realized_pnl_sol: profile.source_performance.realized_pnl_sol,
      source_roi_pct: profile.source_performance.roi_pct,
      source_win_rate_pct: profile.source_performance.win_rate_pct,
      source_closed_lots: profile.source_performance.closed_lots,
      bounded_storage_estimate: {
        normalized_event_json_bytes_total: eventBytes.reduce((sum, value) => sum + value, 0),
        median_event_json_bytes: medianEventBytes,
        profile_json_bytes: jsonBytes(profile),
      },
    },
    source_event: {
      evidence_reference: `solana_signature_${digest(sourceSignature)}`,
      classification: selectedEvent.classification.kind,
      classification_confidence: selectedEvent.classification.confidence,
      exact_destination_asset: { chain: "solana", network: "mainnet", mint: token.mint, token_standard: tokenStandard },
      source_notional_usdc: sourceNotionalUsdc,
      source_notional_basis: sourceNotionalBasis,
    },
    follower_reality: decision.follower_reality,
    decision: decision.decision,
    timing: decision.timing,
    route_evidence: {
      entry: { state: decision.entry.state, latency_ms: decision.entry.latency_ms, price_impact_bps: decision.entry.price_impact_bps, venues: decision.entry.venues, expires_at: decision.entry.expires_at },
      reverse_exit: { state: decision.reverse_exit.state, latency_ms: decision.reverse_exit.latency_ms, price_impact_bps: decision.reverse_exit.price_impact_bps, venues: decision.reverse_exit.venues, expires_at: decision.reverse_exit.expires_at },
    },
    hypothetical_raven_fee: {
      scenario_bps: decision.hypothetical_raven_fee.scenario_bps,
      entry_fee_usdc: decision.hypothetical_raven_fee.entry_fee_usdc,
      exit_fee_usdc: decision.hypothetical_raven_fee.exit_fee_usdc,
      collected: false,
    },
    provider_calls: providerCalls,
    total_probe_ms: Date.now() - startedAt,
    execution_boundary: {
      mode: decision.execution_boundary.mode,
      signing_available: false,
      submission_available: false,
      broadcasting_available: false,
      transaction_material_available: false,
      fee_collection_available: false,
    },
  };
  const serialized = JSON.stringify(report);
  for (const secret of [rpcUrl, apiKey, wallet, sourceSignature]) {
    if (secret && serialized.includes(secret)) throw new Error("wallet_copy_validation_sensitive_output");
  }
  if (serialized.includes('"transaction_hash"') || serialized.includes('"transaction"')) throw new Error("wallet_copy_validation_transaction_output");
  return Object.freeze(report);
}

function usage() {
  return [
    "RavenOS Wallet Copy live validation (read-only; no persistence)",
    "",
    "Required:",
    "  --wallet <public Solana source wallet>",
    "  --source-signature <observed source-wallet buy signature>",
    "",
    "Optional:",
    "  --amount-usdc <1-10000> (default 100)",
    "  --fee-bps <0|5|10|20|25|50> (default 10; hypothetical)",
    "  --limit <1-24> (default 24)",
    "",
    "This command fetches public-chain history and quote-only Jupiter evidence.",
    "It cannot persist a watch, construct a transaction, sign, broadcast, or collect a fee.",
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  try {
    const input = parseArgs(process.argv.slice(2));
    const report = await runWalletCopyLiveValidation(input);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const allowed = new Set([
      "wallet_copy_validation_provider_configuration_required",
      "wallet_copy_validation_source_signature_required",
      "wallet_copy_validation_source_event_unavailable",
      "wallet_copy_validation_source_event_not_copy_buy",
      "wallet_copy_validation_token_decimals_unresolved",
      "wallet_copy_validation_token_standard_unresolved",
      "wallet_copy_validation_amount_invalid",
      "wallet_copy_validation_fee_invalid",
      "wallet_history_unavailable",
      "wallet_history_decode_unavailable",
      "provider_timeout",
      "provider_rate_limited",
      "provider_unavailable",
      "solana_rpc_response_invalid",
      "jupiter_quote_invalid",
      "transaction_material_returned",
    ]);
    const reason = clean(error?.message, 120);
    process.stderr.write(`${allowed.has(reason) ? reason : "wallet_copy_live_validation_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
