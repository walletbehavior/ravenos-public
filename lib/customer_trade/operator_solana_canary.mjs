import { createHash } from "node:crypto";

import bs58 from "bs58";

import {
  decodeAddressLookupTableAccount,
  decodeSolanaTransaction,
  resolveSolanaTransactionAccounts,
} from "./solana_transaction_decoder.mjs";
import { SOLANA_PROGRAM_IDS } from "./solana_program_registry.mjs";

export const SOLANA_CANARY_SCHEMA = "ravenos.operator_solana_canary_preflight.v2";
export const SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA = "ravenos.customer_solana_live_preflight.v1";
export const SOLANA_WRAPPED_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const SOLANA_SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SOLANA_COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const SOLANA_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOLANA_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SOLANA_ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SOLANA_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
const SOLANA_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const JUPITER_V6_PROGRAM = SOLANA_PROGRAM_IDS.jupiter_v6;
const RAYDIUM_AMM_V4_PROGRAM = SOLANA_PROGRAM_IDS.raydium_amm_v4;
const ORCA_WHIRLPOOL_PROGRAM = SOLANA_PROGRAM_IDS.orca_whirlpool;
const RAYDIUM_CLMM_PROGRAM = SOLANA_PROGRAM_IDS.raydium_clmm;
const METEORA_DLMM_PROGRAM = SOLANA_PROGRAM_IDS.meteora_dlmm;

const JUPITER_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";
const RAVENOS_EXACT_PAIR_ENDPOINT = "https://ravenos.xyz/api/dexscreener/pair";
const MAX_PROVIDER_RESPONSE_BYTES = 96 * 1024;
const MAX_RAVENOS_RESPONSE_BYTES = 64 * 1024;
const MAX_RPC_RESPONSE_BYTES = 768 * 1024;
const MAX_BUY_LAMPORTS = 50_000_000n;
const MIN_BUY_LAMPORTS = 1_000_000n;
const MAX_SELL_OUTPUT_LAMPORTS = 50_000_000n;
const MAX_CANARY_WALLET_LAMPORTS = 100_000_000n;
const MAX_SLIPPAGE_BPS = 300;
const MAX_PRICE_IMPACT_BPS = 500;
const MAX_FEE_BPS = 100;
const MAX_SIGNATURE_FEE_LAMPORTS = 20_000n;
const MAX_PRIORITY_FEE_LAMPORTS = 50_000n;
const MAX_RENT_FEE_LAMPORTS = 5_000_000n;
const MAX_TOTAL_FEE_LAMPORTS = 5_100_000n;
const MAX_NETWORK_FEE_LAMPORTS = 70_000n;
const MAX_TOTAL_NATIVE_DEBIT_LAMPORTS = 56_000_000n;
const MAX_CUSTOMER_NATIVE_INPUT_LAMPORTS = 5_000_000_000n;
const MAX_CUSTOMER_USDC_INPUT_BASE_UNITS = 500_000_000n;
const MIN_BLOCKS_REMAINING = 20n;
const MAX_ROUTE_LEGS = 8;
const MAX_RESOLVED_WRITABLE_ACCOUNTS = 48;
const MAX_COMPUTE_UNITS = 1_400_000;
const MAX_SIMULATION_LOGS = 220;
const MAX_SIMULATION_LOG_LENGTH = 300;
const SPL_TOKEN_ACCOUNT_BYTES = 165;
const SPL_TOKEN_ACCOUNT_STATE_OFFSET = 108;
const DEFAULT_EXCLUDED_DEXES = Object.freeze(["Hadron", "ZeroFi"]);

const REVIEWED_PROGRAM_LABELS = Object.freeze({
  [SOLANA_SYSTEM_PROGRAM]: "Solana System Program",
  [SOLANA_COMPUTE_BUDGET_PROGRAM]: "Solana Compute Budget Program",
  [SOLANA_TOKEN_PROGRAM]: "SPL Token Program",
  [SOLANA_ASSOCIATED_TOKEN_PROGRAM]: "Associated Token Account Program",
  [JUPITER_V6_PROGRAM]: "Jupiter Aggregator v6",
  [SOLANA_MEMO_PROGRAM]: "SPL Memo Program",
  [RAYDIUM_AMM_V4_PROGRAM]: "Raydium AMM v4",
  [ORCA_WHIRLPOOL_PROGRAM]: "Orca Whirlpool",
  [RAYDIUM_CLMM_PROGRAM]: "Raydium CLMM",
  [METEORA_DLMM_PROGRAM]: "Meteora DLMM",
});

// Program admission is exact and intentionally narrow. Hadron/AlphaQ and
// ZeroFi remain excluded because the current preflight does not have reviewed,
// verifiable instruction semantics for them. Any other program fails closed.
export const SOLANA_CANARY_REVIEWED_PROGRAMS = Object.freeze(Object.keys(REVIEWED_PROGRAM_LABELS));

// Preflight cannot sign or submit. A later source change, current evidence,
// and explicit action-time owner authorization are all required before either
// boundary can be introduced.
export const OperatorCanaryExecutionAuthorization = Object.freeze({
  signing_for_simulation: false,
  submission: false,
});

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hash(value) {
  const material = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(material).digest("hex");
}

function text(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function integer(value, field) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`${field}_invalid`);
  return BigInt(raw);
}

function safeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${field}_invalid`);
  return parsed;
}

function finite(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function publicKey(value, field) {
  const address = text(value, 64);
  try {
    if (bs58.decode(address).length !== 32) fail(`${field}_invalid`);
  } catch {
    fail(`${field}_invalid`);
  }
  return address;
}

function apiCredential(value) {
  const credential = String(value ?? "").trim();
  if (!credential || credential.length > 512 || !/^[\x21-\x7e]+$/.test(credential)) {
    fail("jupiter_api_key_required");
  }
  return credential;
}

function contextSlot(result, field) {
  return safeInteger(result?.context?.slot, field);
}

export function parseExactSolanaTerminalContext(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    fail("terminal_url_invalid");
  }
  if (url.origin !== "https://ravenos.xyz" || url.username || url.password || url.hash) fail("terminal_origin_invalid");
  if (url.pathname !== "/terminal/") fail("terminal_path_invalid");
  const chain = text(url.searchParams.get("chain"), 40).toLowerCase();
  const market = text(url.searchParams.get("market"), 40).toLowerCase();
  const identityScope = text(url.searchParams.get("instrument_scope") || url.searchParams.get("instrument_type"), 40).toLowerCase();
  if (chain !== "solana" || !["spot", "crypto_spot"].includes(market)) fail("terminal_market_not_solana_spot");
  if (!["exact_pool", "spot_pool"].includes(identityScope)) fail("terminal_identity_not_exact_pool");
  const poolAddress = publicKey(url.searchParams.get("pair_address"), "pool_address");
  const tokenAddress = publicKey(url.searchParams.get("token_address"), "token_address");
  const quoteAddress = publicKey(url.searchParams.get("quote_address"), "quote_address");
  if (tokenAddress === quoteAddress) fail("terminal_token_quote_mismatch");
  const instrumentId = text(url.searchParams.get("instrument_id"), 220);
  if (instrumentId !== `solana:pool:${poolAddress}`) fail("terminal_instrument_pool_mismatch");
  return Object.freeze({
    terminal_origin: url.origin,
    terminal_path: url.pathname,
    instrument_id: instrumentId,
    identity_scope: "exact_pool",
    chain: "solana",
    market: "spot",
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_address: quoteAddress,
    asset_label: text(url.searchParams.get("asset"), 80) || null,
  });
}

function safeEndpoint(value, field, { host = null, pathname = null } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    fail(`${field}_invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail(`${field}_invalid`);
  if (host && url.hostname !== host) fail(`${field}_invalid`);
  if (host && url.port && url.port !== "443") fail(`${field}_invalid`);
  if (pathname && url.pathname !== pathname) fail(`${field}_invalid`);
  return url;
}

async function boundedJson(response, maximumBytes, field) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) fail(`${field}_too_large`);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maximumBytes) fail(`${field}_too_large`);
  try {
    return JSON.parse(body);
  } catch {
    fail(`${field}_invalid_json`);
  }
}

async function rpcCall(rpcUrl, method, params, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const payload = await boundedJson(response, MAX_RPC_RESPONSE_BYTES, `rpc_${method}`);
    if (!response.ok || payload?.error || !Object.hasOwn(payload || {}, "result")) {
      fail(`rpc_${method}_failed`, payload?.error ? { code: payload.error.code ?? null } : null);
    }
    return payload.result;
  } catch (error) {
    if (error?.name === "AbortError" || error?.message === "timeout") fail(`rpc_${method}_timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyMainnet(rpcUrl, options) {
  const genesisHash = await rpcCall(rpcUrl, "getGenesisHash", [], options);
  if (genesisHash !== SOLANA_MAINNET_GENESIS_HASH) fail("solana_rpc_not_mainnet");
  return Object.freeze({ network: "mainnet-beta", genesis_hash: genesisHash });
}

async function resolveMint(rpcUrl, mint, options) {
  const result = await rpcCall(rpcUrl, "getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }], options);
  const observedContextSlot = contextSlot(result, "selected_mint_context_slot");
  const value = result?.value;
  const parsed = value?.data?.parsed;
  const owner = String(value?.owner || "");
  if (!value || ![SOLANA_TOKEN_PROGRAM, SOLANA_TOKEN_2022_PROGRAM].includes(owner)) fail("selected_mint_owner_invalid");
  if (owner === SOLANA_TOKEN_2022_PROGRAM) fail("selected_mint_token_2022_not_reviewed");
  if (parsed?.type !== "mint") fail("selected_mint_account_invalid");
  const decimals = Number(parsed?.info?.decimals);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) fail("selected_mint_decimals_invalid");
  const supply = integer(parsed?.info?.supply, "selected_mint_supply");
  return Object.freeze({
    mint,
    context_slot: observedContextSlot,
    decimals,
    supply_base_units: supply.toString(),
    token_program: owner,
    token_2022_extensions_reviewed: false,
    mint_authority_present: Boolean(parsed?.info?.mintAuthority),
    freeze_authority_present: Boolean(parsed?.info?.freezeAuthority),
  });
}

async function resolveExactPool(terminal, { endpoint, fetchImpl, timeoutMs }) {
  const url = safeEndpoint(endpoint, "ravenos_exact_pair_endpoint", {
    host: "ravenos.xyz",
    pathname: "/api/dexscreener/pair",
  });
  url.search = "";
  url.searchParams.set("chainId", "solana");
  url.searchParams.set("pairAddress", terminal.pool_address);
  url.searchParams.set("tokenAddress", terminal.token_address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "RavenOS-Operator-Canary/2.0" },
      signal: controller.signal,
    });
    const payload = await boundedJson(response, MAX_RAVENOS_RESPONSE_BYTES, "ravenos_exact_pair_response");
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.results)) fail("ravenos_exact_pair_unavailable");
    const matches = payload.results.filter((row) => String(row?.chainId || "").toLowerCase() === "solana"
      && String(row?.pairAddress || "") === terminal.pool_address
      && String(row?.tokenAddress || "") === terminal.token_address
      && String(row?.quoteTokenAddress || "") === terminal.quote_address);
    if (matches.length !== 1) fail("ravenos_exact_pair_identity_unverified");
    const row = matches[0];
    return Object.freeze({
      state: "verified_exact_pool",
      source: "ravenos_exact_pair_projection",
      chain: "solana",
      pool_address: terminal.pool_address,
      token_address: terminal.token_address,
      quote_address: terminal.quote_address,
      venue: text(row.dexId, 64) || null,
      symbol: text(row.symbol, 32) || null,
      quote_symbol: text(row.quoteSymbol, 32) || null,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizePreflightRequest(input = {}, { customer = false } = {}) {
  const terminal = parseExactSolanaTerminalContext(input.terminal_url);
  const walletAddress = publicKey(input.wallet_address, "wallet_address");
  const walletRole = text(input.wallet_role || (customer ? "customer" : "reference_probe"), 32).toLowerCase();
  if (!(customer ? walletRole === "customer" : ["reference_probe", "canary"].includes(walletRole))) fail("wallet_role_invalid");
  if (walletRole === "canary" && input.separate_low_balance_wallet_confirmed !== true) fail("separate_canary_wallet_confirmation_required");
  const side = text(input.side, 16).toLowerCase();
  if (!new Set(["buy", "sell"]).has(side)) fail("canary_side_invalid");
  const amount = integer(input.amount_base_units, "canary_amount");
  if (amount <= 0n) fail("canary_amount_invalid");
  const fundingKind = customer ? text(input.funding_kind || "canonical_usdc", 32).toLowerCase() : "native_sol";
  const settlementKind = customer ? text(input.settlement_kind || "canonical_usdc", 32).toLowerCase() : "native_sol";
  if (!new Set(["native_sol", "canonical_usdc"]).has(fundingKind)) fail("funding_kind_invalid");
  if (!new Set(["native_sol", "canonical_usdc"]).has(settlementKind)) fail("settlement_kind_invalid");
  if (side === "buy") {
    const minimum = fundingKind === "native_sol" ? MIN_BUY_LAMPORTS : 1_000_000n;
    const maximum = customer
      ? fundingKind === "native_sol" ? MAX_CUSTOMER_NATIVE_INPUT_LAMPORTS : MAX_CUSTOMER_USDC_INPUT_BASE_UNITS
      : MAX_BUY_LAMPORTS;
    if (amount < minimum || amount > maximum) fail("canary_buy_amount_out_of_bounds");
  }
  if (side === "sell" && customer && amount > 18_446_744_073_709_551_615n) fail("customer_sell_amount_out_of_bounds");
  const slippageBps = Number(input.slippage_bps ?? 50);
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 5 || slippageBps > MAX_SLIPPAGE_BPS) fail("canary_slippage_out_of_bounds");
  const priorityFeeLamports = customer ? Number(input.priority_fee_lamports ?? MAX_PRIORITY_FEE_LAMPORTS) : Number(MAX_PRIORITY_FEE_LAMPORTS);
  if (!Number.isSafeInteger(priorityFeeLamports) || priorityFeeLamports < 0 || priorityFeeLamports > Number(MAX_PRIORITY_FEE_LAMPORTS)) {
    fail("priority_fee_lamports_out_of_bounds");
  }
  const inputMint = side === "buy"
    ? fundingKind === "native_sol" ? SOLANA_WRAPPED_MINT : SOLANA_USDC_MINT
    : terminal.token_address;
  const outputMint = side === "buy"
    ? terminal.token_address
    : settlementKind === "native_sol" ? SOLANA_WRAPPED_MINT : SOLANA_USDC_MINT;
  if ([SOLANA_WRAPPED_MINT, SOLANA_USDC_MINT].includes(terminal.token_address)) fail("canary_selected_token_invalid");
  return Object.freeze({
    terminal,
    wallet_address: walletAddress,
    wallet_role: walletRole,
    side,
    customer,
    funding_kind: fundingKind,
    settlement_kind: settlementKind,
    amount_base_units: amount.toString(),
    slippage_bps: slippageBps,
    priority_fee_lamports: String(priorityFeeLamports),
    input_mint: inputMint,
    output_mint: outputMint,
  });
}

async function fetchJupiterOrder(request, { apiKey, fetchImpl, timeoutMs, endpoint, excludedDexes }) {
  const url = safeEndpoint(endpoint, "jupiter_order_endpoint", {
    host: "api.jup.ag",
    pathname: "/swap/v2/order",
  });
  url.search = "";
  url.searchParams.set("inputMint", request.input_mint);
  url.searchParams.set("outputMint", request.output_mint);
  url.searchParams.set("amount", request.amount_base_units);
  url.searchParams.set("taker", request.wallet_address);
  url.searchParams.set("swapMode", "ExactIn");
  url.searchParams.set("slippageBps", String(request.slippage_bps));
  url.searchParams.set("priorityFeeLamports", request.priority_fee_lamports);
  url.searchParams.set("broadcastFeeType", "maxCap");
  url.searchParams.set("excludeRouters", "jupiterz,dflow,okx");
  if (excludedDexes.length) url.searchParams.set("excludeDexes", excludedDexes.join(","));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "RavenOS-Operator-Canary/2.0",
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });
    const payload = await boundedJson(response, MAX_PROVIDER_RESPONSE_BYTES, "jupiter_order_response");
    if (!response.ok) fail(`jupiter_order_http_${response.status}`, { error_code: payload?.errorCode ?? null });
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function feePayer(order, amount, field, expectedWallet) {
  const payer = text(order[field], 64);
  if (amount > 0n && !payer) fail(`jupiter_${field}_missing`);
  if (payer && publicKey(payer, `jupiter_${field}`) !== expectedWallet) fail(`jupiter_${field}_mismatch`);
  return payer || null;
}

function normalizeRoutePlan(order, request) {
  if (!Array.isArray(order.routePlan) || !order.routePlan.length || order.routePlan.length > MAX_ROUTE_LEGS) fail("jupiter_route_plan_invalid");
  const route = order.routePlan.map((leg, index) => {
    const info = leg?.swapInfo;
    if (!info || typeof info !== "object") fail("jupiter_route_leg_invalid");
    const inputMint = publicKey(info.inputMint, `jupiter_route_${index}_input_mint`);
    const outputMint = publicKey(info.outputMint, `jupiter_route_${index}_output_mint`);
    const inAmount = integer(info.inAmount, `jupiter_route_${index}_input_amount`);
    const outAmount = integer(info.outAmount, `jupiter_route_${index}_output_amount`);
    const bps = safeInteger(leg.bps, `jupiter_route_${index}_bps`);
    if (inAmount <= 0n || outAmount <= 0n) fail("jupiter_route_amount_invalid");
    if (bps < 1 || bps > 10_000) fail("jupiter_route_bps_invalid");
    return Object.freeze({
      leg_index: index,
      venue: text(info.label, 80) || "unavailable",
      amm_key: publicKey(info.ammKey, `jupiter_route_${index}_amm_key`),
      input_mint: inputMint,
      output_mint: outputMint,
      input_amount_base_units: inAmount.toString(),
      expected_output_amount_base_units: outAmount.toString(),
      bps,
    });
  });
  const reachableFromInput = new Set([request.input_mint]);
  const reachesOutput = new Set([request.output_mint]);
  for (let pass = 0; pass < route.length; pass += 1) {
    for (const leg of route) if (reachableFromInput.has(leg.input_mint)) reachableFromInput.add(leg.output_mint);
    for (const leg of route) if (reachesOutput.has(leg.output_mint)) reachesOutput.add(leg.input_mint);
  }
  if (!reachableFromInput.has(request.output_mint)
    || route.some((leg) => !reachableFromInput.has(leg.input_mint) || !reachesOutput.has(leg.output_mint))) {
    fail("jupiter_route_mint_continuity_invalid");
  }
  return Object.freeze(route);
}

function validateOrder(order, request, nowMs, currentBlockHeight) {
  if (!order || typeof order !== "object" || typeof order.transaction !== "string" || !order.transaction) {
    fail("jupiter_transaction_unavailable", { error_code: order?.errorCode ?? null });
  }
  if (order.inputMint !== request.input_mint) fail("jupiter_input_mint_mismatch");
  if (order.outputMint !== request.output_mint) fail("jupiter_output_mint_mismatch");
  if (String(order.inAmount || "") !== request.amount_base_units) fail("jupiter_input_amount_mismatch");
  if (publicKey(order.taker, "jupiter_taker") !== request.wallet_address) fail("jupiter_taker_mismatch");
  if (order.receiver || order.referralAccount || order.maker || order.quoteId) fail("jupiter_unrequested_authority_present");
  if (text(order.router, 40).toLowerCase() !== "metis") fail("jupiter_router_not_canary_reviewed");
  if (text(order.mode, 40).toLowerCase() !== "manual") fail("jupiter_order_mode_unexpected");
  if (text(order.swapMode, 40).toLowerCase() !== "exactin") fail("jupiter_swap_mode_unexpected");
  if (safeInteger(order.slippageBps, "jupiter_slippage_bps") !== request.slippage_bps) fail("jupiter_slippage_mismatch");
  if (order.gasless !== false) fail("jupiter_gasless_route_rejected");

  const outAmount = integer(order.outAmount, "jupiter_output_amount");
  if (outAmount <= 0n) fail("jupiter_output_amount_invalid");
  const minimumOutput = integer(order.otherAmountThreshold, "jupiter_minimum_output_amount");
  if (minimumOutput <= 0n || minimumOutput > outAmount) fail("jupiter_minimum_output_amount_invalid");
  const feeBps = safeInteger(order.feeBps ?? 0, "jupiter_fee_bps");
  if (feeBps > MAX_FEE_BPS) fail("jupiter_fee_out_of_bounds");
  const platformFeeBps = safeInteger(order.platformFee?.feeBps ?? 0, "jupiter_platform_fee_bps");
  if (platformFeeBps > feeBps) fail("jupiter_platform_fee_invalid");
  const feeMint = order.feeMint ? publicKey(order.feeMint, "jupiter_fee_mint") : null;
  if (feeMint && ![request.input_mint, request.output_mint].includes(feeMint)) fail("jupiter_fee_mint_invalid");

  const impactPoints = order.priceImpact !== null && order.priceImpact !== undefined
    ? finite(order.priceImpact, "jupiter_price_impact")
    : finite(order.priceImpactPct, "jupiter_price_impact_pct") * 100;
  const impactBps = Math.ceil(Math.max(0, impactPoints) * 100);
  if (impactBps > MAX_PRICE_IMPACT_BPS) fail("jupiter_price_impact_out_of_bounds");

  const signatureFee = integer(order.signatureFeeLamports, "jupiter_signature_fee");
  const priorityFee = integer(order.prioritizationFeeLamports, "jupiter_priority_fee");
  const rentFee = integer(order.rentFeeLamports, "jupiter_rent_fee");
  if (signatureFee > MAX_SIGNATURE_FEE_LAMPORTS) fail("jupiter_signature_fee_out_of_bounds");
  if (priorityFee > MAX_PRIORITY_FEE_LAMPORTS) fail("jupiter_priority_fee_out_of_bounds");
  if (rentFee > MAX_RENT_FEE_LAMPORTS) fail("jupiter_rent_fee_out_of_bounds");
  const networkFee = signatureFee + priorityFee;
  if (networkFee > MAX_NETWORK_FEE_LAMPORTS) fail("jupiter_network_fee_out_of_bounds");
  const totalFee = signatureFee + priorityFee + rentFee;
  if (totalFee > MAX_TOTAL_FEE_LAMPORTS) fail("jupiter_total_fee_out_of_bounds");
  const signatureFeePayer = feePayer(order, signatureFee, "signatureFeePayer", request.wallet_address);
  const priorityFeePayer = feePayer(order, priorityFee, "prioritizationFeePayer", request.wallet_address);
  const rentFeePayer = feePayer(order, rentFee, "rentFeePayer", request.wallet_address);

  const lastValidBlockHeight = integer(order.lastValidBlockHeight, "jupiter_last_valid_block_height");
  const currentHeight = BigInt(currentBlockHeight);
  if (lastValidBlockHeight <= currentHeight || lastValidBlockHeight - currentHeight < MIN_BLOCKS_REMAINING) fail("jupiter_order_block_height_expiring");
  const expireAt = order.expireAt ? Date.parse(String(order.expireAt)) : null;
  if (expireAt !== null && (!Number.isFinite(expireAt) || expireAt <= nowMs)) fail("jupiter_order_expired");
  if (!request.customer && request.side === "sell" && outAmount > MAX_SELL_OUTPUT_LAMPORTS) fail("canary_sell_output_out_of_bounds");
  const nativeInput = request.side === "buy" && request.input_mint === SOLANA_WRAPPED_MINT;
  const maximumNativeDebit = nativeInput ? BigInt(request.amount_base_units) + totalFee : totalFee;
  const nativeDebitCap = request.customer && nativeInput
    ? MAX_CUSTOMER_NATIVE_INPUT_LAMPORTS + MAX_TOTAL_FEE_LAMPORTS
    : MAX_TOTAL_NATIVE_DEBIT_LAMPORTS;
  if (maximumNativeDebit > nativeDebitCap) fail("canary_total_native_debit_out_of_bounds");
  const routePlan = normalizeRoutePlan(order, request);
  const requestId = text(order.requestId, 160);
  if (!requestId) fail("jupiter_request_id_missing");

  return Object.freeze({
    request_id: requestId,
    router: "metis",
    mode: "manual",
    swap_mode: "ExactIn",
    input_mint: request.input_mint,
    output_mint: request.output_mint,
    input_amount_base_units: request.amount_base_units,
    expected_output_amount_base_units: outAmount.toString(),
    minimum_output_amount_base_units: minimumOutput.toString(),
    slippage_bps: request.slippage_bps,
    price_impact_bps: impactBps,
    fee_bps: feeBps,
    platform_fee_bps: platformFeeBps,
    fee_mint: feeMint,
    signature_fee_lamports: signatureFee.toString(),
    prioritization_fee_lamports: priorityFee.toString(),
    network_fee_lamports: networkFee.toString(),
    rent_fee_lamports: rentFee.toString(),
    total_estimated_fee_lamports: totalFee.toString(),
    maximum_native_debit_lamports: maximumNativeDebit.toString(),
    fee_payers: Object.freeze({
      signature: signatureFeePayer,
      priority: priorityFeePayer,
      rent: rentFeePayer,
    }),
    route_plan: routePlan,
    current_block_height: currentHeight.toString(),
    last_valid_block_height: lastValidBlockHeight.toString(),
    blocks_remaining: (lastValidBlockHeight - currentHeight).toString(),
    expires_at: Number.isFinite(expireAt) ? new Date(expireAt).toISOString() : null,
  });
}

function accountData(row, field) {
  const encoded = row?.data?.[0];
  if (row?.data?.[1] !== "base64" || typeof encoded !== "string") fail(`${field}_encoding_invalid`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail(`${field}_encoding_invalid`);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) fail(`${field}_encoding_invalid`);
  return decoded;
}

function normalizeAccountState(row, address, field) {
  if (row === null) return Object.freeze({ address, exists: false });
  if (!row || typeof row !== "object") fail(`${field}_invalid`);
  const lamports = Number(row.lamports);
  return Object.freeze({
    address,
    exists: true,
    owner: publicKey(row.owner, `${field}_owner`),
    executable: row.executable === true,
    lamports: Number.isSafeInteger(lamports) && lamports >= 0 ? BigInt(lamports) : null,
    data: accountData(row, field),
  });
}

async function loadWritableAccountStates(rpcUrl, addresses, minimumContextSlot, options) {
  if (!Array.isArray(addresses) || !addresses.length) fail("writable_account_set_missing");
  if (addresses.length > MAX_RESOLVED_WRITABLE_ACCOUNTS) fail("writable_account_count_out_of_bounds");
  const result = await rpcCall(rpcUrl, "getMultipleAccounts", [addresses, {
    encoding: "base64",
    commitment: "confirmed",
    minContextSlot: minimumContextSlot,
  }], options);
  if (!Array.isArray(result?.value) || result.value.length !== addresses.length) fail("writable_account_response_invalid");
  const observedContextSlot = contextSlot(result, "writable_account_context_slot");
  if (observedContextSlot < minimumContextSlot) fail("writable_account_context_stale");
  return Object.freeze({
    context_slot: observedContextSlot,
    accounts: Object.freeze(result.value.map((row, index) => normalizeAccountState(row, addresses[index], `writable_account_${index}`))),
  });
}

async function validateRecentBlockhash(rpcUrl, recentBlockhash, minimumContextSlot, options) {
  const result = await rpcCall(rpcUrl, "isBlockhashValid", [recentBlockhash, {
    commitment: "confirmed",
    minContextSlot: minimumContextSlot,
  }], options);
  const observedContextSlot = contextSlot(result, "blockhash_context_slot");
  if (observedContextSlot < minimumContextSlot) fail("transaction_blockhash_context_stale");
  if (result?.value !== true) fail("transaction_blockhash_invalid");
  return Object.freeze({
    recent_blockhash: recentBlockhash,
    valid: true,
    context_slot: observedContextSlot,
    commitment: "confirmed",
  });
}

function walletAccountState(accounts, walletAddress, field) {
  const state = accounts.find((account) => account.address === walletAddress);
  if (!state?.exists || state.owner !== SOLANA_SYSTEM_PROGRAM || state.executable || state.data.length !== 0 || state.lamports === null) {
    fail(`${field}_invalid`);
  }
  return state;
}

function walletTokenBalance(accounts, selectedMint, walletAddress) {
  let amount = 0n;
  let accountLamports = 0n;
  let accountCount = 0;
  for (const account of accounts) {
    if (!account.exists || account.owner !== SOLANA_TOKEN_PROGRAM || account.executable || account.data.length !== SPL_TOKEN_ACCOUNT_BYTES) continue;
    const state = account.data[SPL_TOKEN_ACCOUNT_STATE_OFFSET];
    if (![1, 2].includes(state)) continue;
    const mint = bs58.encode(account.data.subarray(0, 32));
    const owner = bs58.encode(account.data.subarray(32, 64));
    if (mint !== selectedMint || owner !== walletAddress) continue;
    if (account.lamports === null) fail("wallet_token_account_lamports_invalid");
    const tokenAmount = account.data.readBigUInt64LE(64);
    if (selectedMint === SOLANA_WRAPPED_MINT) {
      const nativeOption = account.data.readUInt32LE(109);
      const rentReserve = account.data.readBigUInt64LE(113);
      if (nativeOption !== 1 || account.lamports !== tokenAmount + rentReserve) {
        fail("wrapped_sol_account_state_invalid");
      }
    }
    amount += tokenAmount;
    accountLamports += account.lamports;
    accountCount += 1;
  }
  return Object.freeze({ amount, account_lamports: accountLamports, account_count: accountCount });
}

function selectedTokenDeltaEvidence(preAccounts, postAccounts, request, quote) {
  const selectedMint = request.terminal.token_address;
  const pre = walletTokenBalance(preAccounts, selectedMint, request.wallet_address);
  const post = walletTokenBalance(postAccounts, selectedMint, request.wallet_address);
  if (request.side === "buy") {
    if (post.amount < pre.amount) fail("simulation_selected_token_direction_invalid");
    const credit = post.amount - pre.amount;
    if (credit < BigInt(quote.minimum_output_amount_base_units)) fail("simulation_selected_token_credit_below_minimum");
    return Object.freeze({
      mint: selectedMint,
      direction: "credit",
      pre_amount_base_units: pre.amount.toString(),
      post_amount_base_units: post.amount.toString(),
      delta_amount_base_units: credit.toString(),
      required_minimum_delta_base_units: quote.minimum_output_amount_base_units,
      pre_account_count: pre.account_count,
      post_account_count: post.account_count,
      exact_mint_verified: true,
    });
  }
  if (pre.amount < post.amount) fail("simulation_selected_token_direction_invalid");
  const debit = pre.amount - post.amount;
  if (debit !== BigInt(request.amount_base_units)) fail("simulation_selected_token_debit_mismatch");
  return Object.freeze({
    mint: selectedMint,
    direction: "debit",
    pre_amount_base_units: pre.amount.toString(),
    post_amount_base_units: post.amount.toString(),
    delta_amount_base_units: debit.toString(),
    required_exact_delta_base_units: request.amount_base_units,
    pre_account_count: pre.account_count,
    post_account_count: post.account_count,
    exact_mint_verified: true,
  });
}

function nativeDeltaEvidence(preWallet, postWallet, preAccounts, postAccounts, request, quote) {
  const nativeInput = request.side === "buy" && request.input_mint === SOLANA_WRAPPED_MINT;
  const nativeOutput = request.side === "sell" && request.output_mint === SOLANA_WRAPPED_MINT;
  const maximumDebit = nativeInput && request.customer
    ? BigInt(request.amount_base_units) + BigInt(quote.total_estimated_fee_lamports)
    : MAX_TOTAL_NATIVE_DEBIT_LAMPORTS;
  const preWrapped = walletTokenBalance(preAccounts, SOLANA_WRAPPED_MINT, request.wallet_address);
  const postWrapped = walletTokenBalance(postAccounts, SOLANA_WRAPPED_MINT, request.wallet_address);
  const preSettlementValue = preWallet.lamports + preWrapped.account_lamports;
  const postSettlementValue = postWallet.lamports + postWrapped.account_lamports;
  const systemDebit = preWallet.lamports > postWallet.lamports ? preWallet.lamports - postWallet.lamports : 0n;
  const systemCredit = postWallet.lamports > preWallet.lamports ? postWallet.lamports - preWallet.lamports : 0n;
  const settlementDebit = preSettlementValue > postSettlementValue ? preSettlementValue - postSettlementValue : 0n;
  const settlementCredit = postSettlementValue > preSettlementValue ? postSettlementValue - preSettlementValue : 0n;
  const maximumObservedDebit = systemDebit > settlementDebit ? systemDebit : settlementDebit;
  if (maximumObservedDebit > maximumDebit) fail("simulated_native_debit_out_of_bounds");
  if (nativeInput) {
    const minimumDebit = BigInt(request.amount_base_units);
    const quoteMaximum = minimumDebit + BigInt(quote.total_estimated_fee_lamports);
    if (settlementDebit < minimumDebit || settlementCredit > 0n) fail("simulation_native_debit_below_input");
    if (systemDebit > quoteMaximum || settlementDebit > quoteMaximum) fail("simulated_native_debit_out_of_bounds");
    return Object.freeze({
      direction: "economic_debit",
      pre_lamports: preWallet.lamports.toString(),
      post_lamports: postWallet.lamports.toString(),
      system_wallet_debit_lamports: systemDebit.toString(),
      system_wallet_credit_lamports: systemCredit.toString(),
      pre_wrapped_sol_account_lamports: preWrapped.account_lamports.toString(),
      post_wrapped_sol_account_lamports: postWrapped.account_lamports.toString(),
      pre_wrapped_sol_amount_lamports: preWrapped.amount.toString(),
      post_wrapped_sol_amount_lamports: postWrapped.amount.toString(),
      debit_lamports: maximumObservedDebit.toString(),
      economic_debit_lamports: settlementDebit.toString(),
      credit_lamports: settlementCredit.toString(),
      minimum_expected_debit_lamports: minimumDebit.toString(),
      maximum_allowed_debit_lamports: maximumDebit.toString(),
    });
  }
  if (!nativeOutput) {
    const allowedFeeDebit = BigInt(quote.total_estimated_fee_lamports);
    if (maximumObservedDebit > allowedFeeDebit) fail("simulation_native_fee_debit_out_of_bounds");
    return Object.freeze({
      direction: "network_fee_only",
      pre_lamports: preWallet.lamports.toString(),
      post_lamports: postWallet.lamports.toString(),
      system_wallet_debit_lamports: systemDebit.toString(),
      system_wallet_credit_lamports: systemCredit.toString(),
      debit_lamports: maximumObservedDebit.toString(),
      economic_debit_lamports: settlementDebit.toString(),
      credit_lamports: settlementCredit.toString(),
      maximum_allowed_debit_lamports: allowedFeeDebit.toString(),
    });
  }
  const minimumOutput = BigInt(quote.minimum_output_amount_base_units);
  const estimatedFees = BigInt(quote.total_estimated_fee_lamports);
  const minimumNetCredit = minimumOutput > estimatedFees ? minimumOutput - estimatedFees : 0n;
  if (settlementCredit < minimumNetCredit) fail("simulation_native_sell_proceeds_below_minimum");
  return Object.freeze({
    direction: "economic_credit",
    pre_lamports: preWallet.lamports.toString(),
    post_lamports: postWallet.lamports.toString(),
    system_wallet_debit_lamports: systemDebit.toString(),
    system_wallet_credit_lamports: systemCredit.toString(),
    pre_wrapped_sol_account_lamports: preWrapped.account_lamports.toString(),
    post_wrapped_sol_account_lamports: postWrapped.account_lamports.toString(),
    pre_wrapped_sol_amount_lamports: preWrapped.amount.toString(),
    post_wrapped_sol_amount_lamports: postWrapped.amount.toString(),
    debit_lamports: maximumObservedDebit.toString(),
    economic_debit_lamports: settlementDebit.toString(),
    credit_lamports: settlementCredit.toString(),
    minimum_expected_credit_lamports: minimumNetCredit.toString(),
    maximum_allowed_debit_lamports: maximumDebit.toString(),
  });
}

function canonicalUsdcDeltaEvidence(preAccounts, postAccounts, request, quote) {
  const usesUsdc = request.input_mint === SOLANA_USDC_MINT || request.output_mint === SOLANA_USDC_MINT;
  if (!usesUsdc) return null;
  const pre = walletTokenBalance(preAccounts, SOLANA_USDC_MINT, request.wallet_address);
  const post = walletTokenBalance(postAccounts, SOLANA_USDC_MINT, request.wallet_address);
  if (request.side === "buy") {
    if (pre.amount < post.amount) fail("simulation_usdc_direction_invalid");
    const debit = pre.amount - post.amount;
    if (debit !== BigInt(request.amount_base_units)) fail("simulation_usdc_debit_mismatch");
    return Object.freeze({
      mint: SOLANA_USDC_MINT,
      direction: "debit",
      pre_amount_base_units: pre.amount.toString(),
      post_amount_base_units: post.amount.toString(),
      delta_amount_base_units: debit.toString(),
      required_exact_delta_base_units: request.amount_base_units,
      exact_mint_verified: true,
    });
  }
  if (post.amount < pre.amount) fail("simulation_usdc_direction_invalid");
  const credit = post.amount - pre.amount;
  if (credit < BigInt(quote.minimum_output_amount_base_units)) fail("simulation_usdc_credit_below_minimum");
  return Object.freeze({
    mint: SOLANA_USDC_MINT,
    direction: "credit",
    pre_amount_base_units: pre.amount.toString(),
    post_amount_base_units: post.amount.toString(),
    delta_amount_base_units: credit.toString(),
    required_minimum_delta_base_units: quote.minimum_output_amount_base_units,
    exact_mint_verified: true,
  });
}

async function resolveLookupTables(rpcUrl, decoded, minimumContextSlot, options) {
  const addresses = decoded.address_table_lookups.map((lookup) => lookup.table_address);
  if (!addresses.length) return Object.freeze({ tables: new Map(), context_slot: null });
  const result = await rpcCall(rpcUrl, "getMultipleAccounts", [addresses, {
    encoding: "base64",
    commitment: "confirmed",
    minContextSlot: minimumContextSlot,
  }], options);
  if (!Array.isArray(result?.value) || result.value.length !== addresses.length) fail("lookup_table_response_invalid");
  const observedContextSlot = contextSlot(result, "lookup_table_context_slot");
  if (observedContextSlot < minimumContextSlot) fail("lookup_table_context_stale");
  const tables = new Map();
  addresses.forEach((address, index) => {
    const row = result.value[index];
    if (!row || row.owner !== SOLANA_LOOKUP_TABLE_PROGRAM || row.executable === true) fail("lookup_table_owner_invalid");
    const table = decodeAddressLookupTableAccount(accountData(row, "lookup_table"));
    if (!table.active) fail("lookup_table_not_active");
    if (BigInt(table.last_extended_slot) >= BigInt(observedContextSlot)) fail("lookup_table_not_warmed_up");
    tables.set(address, table);
  });
  return Object.freeze({ tables, context_slot: observedContextSlot });
}

function invokedPrograms(logs = []) {
  const programs = new Set();
  for (const line of Array.isArray(logs) ? logs : []) {
    const match = String(line || "").match(/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke /);
    if (match) programs.add(match[1]);
  }
  return [...programs];
}

async function simulateUnsigned(rpcUrl, transactionBase64, writableAddresses, minimumContextSlot, { fetchImpl, timeoutMs }) {
  const result = await rpcCall(rpcUrl, "simulateTransaction", [transactionBase64, {
    encoding: "base64",
    commitment: "confirmed",
    sigVerify: false,
    replaceRecentBlockhash: false,
    innerInstructions: true,
    minContextSlot: minimumContextSlot,
    accounts: { encoding: "base64", addresses: writableAddresses },
  }], { fetchImpl, timeoutMs });
  const value = result?.value;
  if (!value || typeof value !== "object") fail("simulation_response_invalid");
  if (value.replacementBlockhash) fail("simulation_replaced_blockhash");
  const observedContextSlot = contextSlot(result, "simulation_context_slot");
  if (observedContextSlot < minimumContextSlot) fail("simulation_context_stale");
  const unitsConsumed = safeInteger(value.unitsConsumed, "simulation_compute_units");
  if (unitsConsumed > MAX_COMPUTE_UNITS) fail("simulation_compute_units_out_of_bounds");
  const simulationFee = integer(value.fee, "simulation_fee");
  if (simulationFee > MAX_NETWORK_FEE_LAMPORTS) fail("simulation_fee_out_of_bounds");
  const rawLogs = Array.isArray(value.logs) ? value.logs.map((line) => String(line || "")) : [];
  const logs = rawLogs.slice(-MAX_SIMULATION_LOGS).map((line) => text(line, MAX_SIMULATION_LOG_LENGTH));
  if (!Array.isArray(value.accounts) || value.accounts.length !== writableAddresses.length) fail("simulation_account_state_missing");
  const postAccounts = value.accounts.map((row, index) => normalizeAccountState(row, writableAddresses[index], `simulation_account_${index}`));
  const state = value.err === null && !rawLogs.some((line) => /^Program .* failed:/.test(line)) ? "passed" : "failed";
  return Object.freeze({
    post_accounts: Object.freeze(postAccounts),
    summary: Object.freeze({
      state,
      error: value.err ?? null,
      context_slot: observedContextSlot,
      units_consumed: unitsConsumed,
      maximum_compute_units: MAX_COMPUTE_UNITS,
      simulation_fee_lamports: simulationFee.toString(),
      maximum_network_fee_lamports: MAX_NETWORK_FEE_LAMPORTS.toString(),
      logs: Object.freeze(logs),
      invoked_programs: Object.freeze(invokedPrograms(rawLogs)),
      return_data_present: Boolean(value.returnData),
      inner_instruction_groups: Array.isArray(value.innerInstructions) ? value.innerInstructions.length : 0,
      signature_verified: false,
      blockhash_replaced: false,
    }),
  });
}

function instructionReview(programs) {
  return Object.freeze(programs.instructions.map((instruction) => Object.freeze({
    instruction_index: instruction.instruction_index,
    program_id: instruction.program_id,
    program_label: REVIEWED_PROGRAM_LABELS[instruction.program_id] || "Review required",
    account_count: instruction.accounts.length,
    signer_account_count: instruction.accounts.filter((account) => account.signer).length,
    writable_account_count: instruction.accounts.filter((account) => account.writable).length,
    data_length: instruction.data_length,
    data_hash: instruction.data_hash,
    data_prefix_hex: instruction.data_prefix_hex,
  })));
}

function programReview(programs, simulation) {
  const reviewed = new Set(SOLANA_CANARY_REVIEWED_PROGRAMS);
  const unknownTopLevel = programs.program_ids.filter((program) => !reviewed.has(program));
  const unknownInvoked = simulation.invoked_programs.filter((program) => !reviewed.has(program));
  return Object.freeze({
    unknown_top_level: Object.freeze(unknownTopLevel),
    unknown_invoked: Object.freeze(unknownInvoked),
  });
}

function safetyBlockingReasons({ review, simulation, nativeDebit, maximumNativeDebit = MAX_TOTAL_NATIVE_DEBIT_LAMPORTS }) {
  return Object.freeze([
    ...(simulation.state !== "passed" ? ["simulation_failed"] : []),
    ...(review.unknown_top_level.length ? ["top_level_program_review_required"] : []),
    ...(review.unknown_invoked.length ? ["invoked_program_review_required"] : []),
    ...(nativeDebit > maximumNativeDebit ? ["simulated_native_debit_out_of_bounds"] : []),
  ]);
}

async function runSolanaPreflight(input = {}, {
  rpc_url: rpcUrlInput,
  jupiter_api_key: apiKey = "",
  secret_key: secretKey = null,
  fetch_impl: fetchImpl = globalThis.fetch,
  now: nowFn = () => Date.now(),
  timeout_ms: timeoutMs = 8_000,
  jupiter_order_endpoint: orderEndpoint = JUPITER_ORDER_ENDPOINT,
  ravenos_exact_pair_endpoint: exactPairEndpoint = RAVENOS_EXACT_PAIR_ENDPOINT,
  excluded_dexes: excludedDexesInput = DEFAULT_EXCLUDED_DEXES,
} = {}, { customer = false } = {}) {
  if (secretKey) fail("signing_material_not_accepted_by_preflight");
  const request = normalizePreflightRequest(input, { customer });
  const jupiterApiKey = apiCredential(apiKey);
  const rpcUrl = safeEndpoint(rpcUrlInput, "solana_rpc_url").toString();
  const nowMs = nowFn();
  const rpcOptions = { fetchImpl, timeoutMs };
  const excludedDexes = Array.isArray(excludedDexesInput)
    ? excludedDexesInput.map((value) => text(value, 64)).filter(Boolean).slice(0, 16)
    : fail("excluded_dexes_invalid");

  const [network, exactPool, mint, walletBalanceResult] = await Promise.all([
    verifyMainnet(rpcUrl, rpcOptions),
    resolveExactPool(request.terminal, { endpoint: exactPairEndpoint, fetchImpl, timeoutMs }),
    resolveMint(rpcUrl, request.terminal.token_address, rpcOptions),
    rpcCall(rpcUrl, "getBalance", [request.wallet_address, { commitment: "confirmed" }], rpcOptions),
  ]);
  const walletBalance = integer(walletBalanceResult?.value, "canary_wallet_balance");
  const walletBalanceContextSlot = contextSlot(walletBalanceResult, "canary_wallet_balance_context_slot");
  if (request.wallet_role === "canary" && walletBalance > MAX_CANARY_WALLET_LAMPORTS) fail("canary_wallet_balance_above_low_balance_cap");

  const order = await fetchJupiterOrder(request, {
    apiKey: jupiterApiKey,
    fetchImpl,
    timeoutMs,
    endpoint: orderEndpoint,
    excludedDexes,
  });
  const currentBlockHeight = safeInteger(
    await rpcCall(rpcUrl, "getBlockHeight", [{ commitment: "confirmed" }], rpcOptions),
    "current_block_height",
  );
  const quote = validateOrder(order, request, nowMs, currentBlockHeight);
  const requiredBalance = request.side === "buy" && request.input_mint === SOLANA_WRAPPED_MINT
    ? BigInt(request.amount_base_units) + BigInt(quote.total_estimated_fee_lamports)
    : BigInt(quote.total_estimated_fee_lamports);

  const decoded = decodeSolanaTransaction(order.transaction);
  if (decoded.signatures.some((signature) => signature.populated)) fail("jupiter_transaction_unexpected_signature");
  const identityContextSlot = Math.max(walletBalanceContextSlot, mint.context_slot);
  const lookupResolution = await resolveLookupTables(rpcUrl, decoded, identityContextSlot, rpcOptions);
  const programs = resolveSolanaTransactionAccounts(decoded, lookupResolution.tables);
  if (programs.account_keys[0]?.address !== request.wallet_address) fail("transaction_fee_payer_mismatch");
  if (programs.signer_addresses.length !== 1 || programs.signer_addresses[0] !== request.wallet_address) fail("transaction_signer_set_mismatch");
  if (programs.writable_addresses.length > MAX_RESOLVED_WRITABLE_ACCOUNTS) fail("writable_account_count_out_of_bounds");

  const accountContextFloor = Math.max(identityContextSlot, lookupResolution.context_slot || 0);
  const [blockhash, preState] = await Promise.all([
    validateRecentBlockhash(rpcUrl, decoded.recent_blockhash, accountContextFloor, rpcOptions),
    loadWritableAccountStates(rpcUrl, programs.writable_addresses, accountContextFloor, rpcOptions),
  ]);
  const preWallet = walletAccountState(preState.accounts, request.wallet_address, "preflight_wallet_state");
  if (preWallet.lamports < requiredBalance) fail("canary_wallet_balance_insufficient");
  if (request.wallet_role === "canary" && preWallet.lamports > MAX_CANARY_WALLET_LAMPORTS) {
    fail("canary_wallet_balance_above_low_balance_cap");
  }
  const simulationRun = await simulateUnsigned(
    rpcUrl,
    decoded.raw_base64,
    programs.writable_addresses,
    Math.max(blockhash.context_slot, preState.context_slot),
    {
    fetchImpl,
    timeoutMs,
    },
  );
  const simulation = simulationRun.summary;
  const postWallet = walletAccountState(simulationRun.post_accounts, request.wallet_address, "simulation_wallet_state");
  const nativeEvidence = nativeDeltaEvidence(
    preWallet,
    postWallet,
    preState.accounts,
    simulationRun.post_accounts,
    request,
    quote,
  );
  const tokenEvidence = selectedTokenDeltaEvidence(preState.accounts, simulationRun.post_accounts, request, quote);
  const usdcEvidence = canonicalUsdcDeltaEvidence(preState.accounts, simulationRun.post_accounts, request, quote);
  if (request.side === "buy" && request.input_mint === SOLANA_USDC_MINT) {
    const balance = walletTokenBalance(preState.accounts, SOLANA_USDC_MINT, request.wallet_address);
    if (balance.amount < BigInt(request.amount_base_units)) fail("customer_usdc_balance_insufficient");
  }
  const nativeDebit = BigInt(nativeEvidence.debit_lamports);
  const review = programReview(programs, simulation);
  const safetyBlocking = safetyBlockingReasons({
    review,
    simulation,
    nativeDebit,
    maximumNativeDebit: BigInt(nativeEvidence.maximum_allowed_debit_lamports),
  });
  const preflightPassed = safetyBlocking.length === 0;

  const intent = Object.freeze({
    schema_version: customer ? "ravenos.customer_solana_live_intent.v1" : "ravenos.operator_solana_canary_intent.v2",
    terminal_instrument_id: request.terminal.instrument_id,
    terminal_pool_address: request.terminal.pool_address,
    selected_token_mint: request.terminal.token_address,
    verified_quote_mint: request.terminal.quote_address,
    wallet_address: request.wallet_address,
    wallet_role: request.wallet_role,
    side: request.side,
    funding_kind: request.funding_kind,
    settlement_kind: request.settlement_kind,
    input_mint: request.input_mint,
    output_mint: request.output_mint,
    input_amount_base_units: request.amount_base_units,
    expected_output_amount_base_units: quote.expected_output_amount_base_units,
    minimum_output_amount_base_units: quote.minimum_output_amount_base_units,
    slippage_bps: request.slippage_bps,
    provider_request_id: quote.request_id,
    router: quote.router,
    message_hash: decoded.message_hash,
    recent_blockhash: decoded.recent_blockhash,
    program_ids: programs.program_ids,
    lookup_tables: programs.lookup_tables,
    writable_account_count: programs.writable_addresses.length,
    selected_token_delta: tokenEvidence.delta_amount_base_units,
    current_block_height: quote.current_block_height,
    last_valid_block_height: quote.last_valid_block_height,
  });
  const boundaryBlocking = Object.freeze(customer ? [] : [
    ...(request.wallet_role === "reference_probe" ? ["reference_wallet_not_funding_eligible"] : []),
    "signing_source_disabled",
    "operator_submission_source_disabled",
  ]);

  return Object.freeze({
    ok: preflightPassed,
    schema_version: customer ? SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA : SOLANA_CANARY_SCHEMA,
    state: preflightPassed
      ? customer ? "customer_unsigned_transaction_reviewed" : "unsigned_mainnet_preflight_passed"
      : "blocked",
    generated_at: new Date(nowMs).toISOString(),
    network,
    exact_market: request.terminal,
    exact_pool_verification: exactPool,
    selected_mint: mint,
    wallet: Object.freeze({
      address: request.wallet_address,
      role: request.wallet_role,
      balance_lamports: preWallet.lamports.toString(),
      initial_balance_lamports: walletBalance.toString(),
      balance_changed_during_preflight: preWallet.lamports !== walletBalance,
      low_balance_cap_lamports: customer ? null : MAX_CANARY_WALLET_LAMPORTS.toString(),
      low_balance_cap_satisfied: customer ? null : preWallet.lamports <= MAX_CANARY_WALLET_LAMPORTS,
      secret_material_accepted: false,
      secret_material_returned: false,
    }),
    quote,
    transaction_review: Object.freeze({
      version: decoded.version,
      serialized_bytes: decoded.raw_bytes.length,
      message_hash: decoded.message_hash,
      transaction_hash: decoded.transaction_hash,
      unsigned_transaction: true,
      fee_payer: programs.account_keys[0]?.address || null,
      signer_addresses: programs.signer_addresses,
      instruction_count: programs.instructions.length,
      instruction_review: instructionReview(programs),
      writable_account_count: programs.writable_addresses.length,
      maximum_writable_account_count: MAX_RESOLVED_WRITABLE_ACCOUNTS,
      program_ids: programs.program_ids,
      unknown_top_level_programs: review.unknown_top_level,
      recent_blockhash: blockhash.recent_blockhash,
      blockhash_valid: blockhash.valid,
      blockhash_context_slot: blockhash.context_slot,
      lookup_context_slot: lookupResolution.context_slot,
      lookup_tables: programs.lookup_tables,
      raw_transaction_returned: customer,
    }),
    simulation: Object.freeze({
      ...simulation,
      pre_account_context_slot: preState.context_slot,
      requested_writable_account_count: programs.writable_addresses.length,
      native_balance_evidence: nativeEvidence,
      selected_token_balance_evidence: tokenEvidence,
      canonical_usdc_balance_evidence: usdcEvidence,
      pre_wallet_lamports: preWallet.lamports.toString(),
      post_wallet_lamports: postWallet.lamports.toString(),
      simulated_native_debit_lamports: nativeDebit.toString(),
      maximum_native_debit_lamports: nativeEvidence.maximum_allowed_debit_lamports,
      unknown_invoked_programs: review.unknown_invoked,
      logs: simulation.logs.slice(-40),
    }),
    intent,
    intent_hash: hash(intent),
    safety_blocking_reasons: safetyBlocking,
    boundary_blocking_reasons: boundaryBlocking,
    blocking_reasons: Object.freeze([...safetyBlocking, ...boundaryBlocking]),
    canary_readiness: Object.freeze({
      route_preflight_passed: preflightPassed,
      separate_low_balance_wallet_verified: customer ? null : request.wallet_role === "canary"
        && walletBalance <= MAX_CANARY_WALLET_LAMPORTS
        && preWallet.lamports <= MAX_CANARY_WALLET_LAMPORTS,
      funding_authorized: customer && preflightPassed,
      signed_simulation_completed: false,
      submission_authorized: customer && preflightPassed,
    }),
    execution_boundary: Object.freeze({
      operator_preflight_only: !customer,
      unsigned_mainnet_simulation: true,
      signing_available: customer,
      browser_signing_available: customer,
      customer_submission_available: customer,
      operator_submission_available: OperatorCanaryExecutionAuthorization.submission,
      transaction_material_returned: customer,
    }),
    ...(customer ? { unsigned_transaction_base64: decoded.raw_base64 } : {}),
  });
}

export async function runOperatorSolanaCanaryPreflight(input = {}, options = {}) {
  return runSolanaPreflight(input, options, { customer: false });
}

export async function runCustomerSolanaLivePreflight(input = {}, options = {}) {
  return runSolanaPreflight(input, options, { customer: true });
}

// Compatibility name retained for operator tooling. It is strictly an
// unsigned preflight and rejects all signing material.
export const runOperatorSolanaCanaryDryRun = runOperatorSolanaCanaryPreflight;

export const OperatorSolanaCanaryLimits = Object.freeze({
  minimum_buy_lamports: MIN_BUY_LAMPORTS.toString(),
  maximum_buy_lamports: MAX_BUY_LAMPORTS.toString(),
  maximum_sell_output_lamports: MAX_SELL_OUTPUT_LAMPORTS.toString(),
  maximum_canary_wallet_lamports: MAX_CANARY_WALLET_LAMPORTS.toString(),
  maximum_slippage_bps: MAX_SLIPPAGE_BPS,
  maximum_price_impact_bps: MAX_PRICE_IMPACT_BPS,
  maximum_fee_bps: MAX_FEE_BPS,
  maximum_signature_fee_lamports: MAX_SIGNATURE_FEE_LAMPORTS.toString(),
  maximum_priority_fee_lamports: MAX_PRIORITY_FEE_LAMPORTS.toString(),
  maximum_network_fee_lamports: MAX_NETWORK_FEE_LAMPORTS.toString(),
  maximum_rent_fee_lamports: MAX_RENT_FEE_LAMPORTS.toString(),
  maximum_total_fee_lamports: MAX_TOTAL_FEE_LAMPORTS.toString(),
  maximum_total_native_debit_lamports: MAX_TOTAL_NATIVE_DEBIT_LAMPORTS.toString(),
  maximum_route_legs: MAX_ROUTE_LEGS,
  maximum_resolved_writable_accounts: MAX_RESOLVED_WRITABLE_ACCOUNTS,
  maximum_compute_units: MAX_COMPUTE_UNITS,
});
