import bs58 from "bs58";

import { canonicalContractHash } from "../customer_trade/contracts.mjs";
import { runProviderOperation } from "../customer_trade/terminal_runtime.mjs";
import {
  createSolanaExecutableExitObservation,
  createSolanaMarkObservation,
  SOLANA_JITOSOL_MINT,
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_USDC_MINT,
  SOLANA_USDT_MINT,
  SOLANA_WRAPPED_SOL_MINT,
} from "./solana_exposure.mjs";

const JUPITER_PRICE_ENDPOINT = "https://api.jup.ag/price/v3";
const JUPITER_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";
const USDC_ASSET_ID = "solana:USDC";

export const PortfolioPreviewProviderLimits = Object.freeze({
  rpc_components: 3,
  maximum_price_mints: 50,
  maximum_executable_quote_groups: 4,
  maximum_balance_response_bytes: 64 * 1024,
  maximum_token_accounts_response_bytes: 4 * 1024 * 1024,
  maximum_price_response_bytes: 512 * 1024,
  maximum_executable_quote_response_bytes: 256 * 1024,
  rpc_timeout_ms: 3_500,
  price_timeout_ms: 3_500,
  executable_quote_timeout_ms: 4_000,
  executable_quote_ttl_ms: 15_000,
});

function text(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validPublicKey(value) {
  const key = text(value, 64);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) return false;
  try {
    return bs58.decode(key).length === 32;
  } catch {
    return false;
  }
}

function integerString(value) {
  const raw = text(value, 80);
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  return raw;
}

function safeDecimals(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 30 ? parsed : null;
}

function providerFailure(error) {
  const reason = text(error?.code || error?.message || error, 160).toLowerCase();
  if (reason.includes("abort") || reason.includes("timeout")) return "provider_timeout";
  if (reason.includes("429") || reason.includes("backpressure") || reason.includes("rate")) return "provider_rate_limited";
  if (reason.includes("invalid") || reason.includes("malformed") || reason.includes("transaction_material") || reason.includes("too_large")) return "provider_response_invalid";
  return "provider_unavailable";
}

async function boundedResponseText(response, maximumBytes) {
  const maximum = Number(maximumBytes);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("provider_response_limit_invalid");
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximum) throw new Error("provider_response_too_large");
  if (!response.body?.getReader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximum) throw new Error("provider_response_too_large");
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > maximum) {
        await reader.cancel("provider_response_too_large").catch(() => {});
        throw new Error("provider_response_too_large");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

async function fetchJson(url, {
  fetch_impl: fetchImpl,
  timeout_ms: timeoutMs,
  headers = {},
  method = "GET",
  body = null,
  maximum_response_bytes: maximumResponseBytes = PortfolioPreviewProviderLimits.maximum_price_response_bytes,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { accept: "application/json", ...headers },
      body,
      signal: controller.signal,
    });
    const responseText = await boundedResponseText(response, maximumResponseBytes);
    const payload = await Promise.resolve().then(() => JSON.parse(responseText)).catch(() => {
      throw new Error("provider_response_invalid");
    });
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function validatedRpcUrl(value) {
  try {
    const url = new URL(text(value, 1_000));
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createPortfolioSolanaRpcRequest({
  rpc_url: rpcUrl,
  wallet_reference: walletReference,
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = PortfolioPreviewProviderLimits.rpc_timeout_ms,
  on_provider_call: onProviderCall = () => {},
} = {}) {
  const endpoint = validatedRpcUrl(rpcUrl);
  const walletRef = text(walletReference, 100);
  if (!endpoint) throw new Error("portfolio_rpc_url_invalid");
  if (!walletRef) throw new Error("portfolio_wallet_reference_required");
  return async (method, params) => {
    const normalizedMethod = text(method, 80);
    if (!new Set(["getBalance", "getTokenAccountsByOwner"]).has(normalizedMethod)) throw new Error("portfolio_rpc_method_not_allowed");
    const programId = normalizedMethod === "getTokenAccountsByOwner" ? text(params?.[1]?.programId, 64) : "native";
    const requestFingerprint = canonicalContractHash({ method: normalizedMethod, params });
    const operationKey = canonicalContractHash({ wallet_reference: walletRef, method: normalizedMethod, program_id: programId, request_fingerprint: requestFingerprint });
    return runProviderOperation({
      component: "portfolio_solana_rpc",
      operation_key: operationKey,
      fn: async () => {
        onProviderCall("solana_rpc");
        const { response, payload } = await fetchJson(endpoint, {
          fetch_impl: fetchImpl,
          timeout_ms: timeoutMs,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: normalizedMethod, params }),
          maximum_response_bytes: normalizedMethod === "getBalance"
            ? PortfolioPreviewProviderLimits.maximum_balance_response_bytes
            : PortfolioPreviewProviderLimits.maximum_token_accounts_response_bytes,
        });
        if (!response.ok || !payload || payload.error || !("result" in payload)) throw new Error(`rpc_${normalizedMethod}_failed`);
        return payload.result;
      },
    });
  };
}

function tokenAccountFacts(row = {}) {
  const info = row?.account?.data?.parsed?.info || row?.parsed?.info || row?.info || {};
  const tokenAmount = info.tokenAmount || row?.tokenAmount || {};
  return {
    mint: text(info.mint || row?.mint, 64),
    amount: integerString(tokenAmount.amount ?? row?.amount_base_units),
    decimals: safeDecimals(tokenAmount.decimals ?? row?.decimals),
    state: text(info.state || row?.state || "initialized", 40).toLowerCase(),
  };
}

function candidatePriority(mint) {
  if (mint === SOLANA_WRAPPED_SOL_MINT) return 5;
  if (mint === SOLANA_USDC_MINT) return 4;
  if (mint === SOLANA_USDT_MINT) return 3;
  if (mint === SOLANA_JITOSOL_MINT) return 2;
  return 0;
}

function amountMagnitude(amount, decimals) {
  return String(amount).replace(/^0+/, "").length - Number(decimals || 0);
}

export function collectPortfolioPriceCandidates(observations = [], {
  maximum_mints: maximumMints = PortfolioPreviewProviderLimits.maximum_price_mints,
} = {}) {
  const maximum = Number(maximumMints);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50) throw new Error("portfolio_price_mint_limit_invalid");
  const candidates = new Map();
  const add = (mint, amount, decimals, source) => {
    if (!validPublicKey(mint) || !amount || BigInt(amount) <= 0n || decimals === null) return;
    const previous = candidates.get(mint);
    if (previous && previous.decimals !== decimals) {
      candidates.set(mint, { ...previous, decimals_conflict: true });
      return;
    }
    candidates.set(mint, {
      mint,
      decimals,
      amount_base_units: ((previous ? BigInt(previous.amount_base_units) : 0n) + BigInt(amount)).toString(),
      sources: [...new Set([...(previous?.sources || []), source])],
      decimals_conflict: previous?.decimals_conflict === true,
    });
  };
  for (const observation of observations) {
    const facts = observation?.facts || {};
    if (facts.observation_kind === "solana_native_balance") {
      add(SOLANA_WRAPPED_SOL_MINT, integerString(facts.amount_base_units), 9, "native");
    }
    if (facts.observation_kind === "solana_token_accounts") {
      for (const row of Array.isArray(facts.accounts) ? facts.accounts : []) {
        const token = tokenAccountFacts(row);
        if (["closed", "uninitialized"].includes(token.state)) continue;
        add(token.mint, token.amount, token.decimals, "token_account");
      }
    }
  }
  const eligible = [...candidates.values()].filter((row) => !row.decimals_conflict);
  eligible.sort((left, right) => (
    candidatePriority(right.mint) - candidatePriority(left.mint)
    || amountMagnitude(right.amount_base_units, right.decimals) - amountMagnitude(left.amount_base_units, left.decimals)
    || left.mint.localeCompare(right.mint)
  ));
  return Object.freeze({
    selected: Object.freeze(eligible.slice(0, maximum)),
    omitted_mint_count: Math.max(0, eligible.length - maximum),
    decimals_conflict_count: [...candidates.values()].filter((row) => row.decimals_conflict).length,
    observed_unique_mint_count: candidates.size,
  });
}

function decimalCoefficient(value) {
  const source = text(value, 80).toLowerCase();
  const match = source.match(/^([+]?(?:\d+)(?:\.\d+)?)(?:e([+-]?\d+))?$/);
  if (!match) return null;
  const base = match[1].replace(/^\+/, "");
  const [whole, fraction = ""] = base.split(".");
  const exponent = Number(match[2] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = fraction.length - exponent;
  return { coefficient: BigInt(digits), scale };
}

export function priceToMarkRatio(usdPrice, tokenDecimals) {
  const decimals = safeDecimals(tokenDecimals);
  const parsed = decimalCoefficient(usdPrice);
  if (decimals === null || !parsed || parsed.coefficient <= 0n) return null;
  let numerator = parsed.coefficient;
  let denominator = 10n ** BigInt(decimals);
  const minorScale = 6 - parsed.scale;
  if (minorScale >= 0) numerator *= 10n ** BigInt(minorScale);
  else denominator *= 10n ** BigInt(-minorScale);
  return {
    price_numerator_minor: numerator.toString(),
    price_denominator_base_units: denominator.toString(),
  };
}

function knownAssetId(mint) {
  if (mint === SOLANA_WRAPPED_SOL_MINT) return "solana:WSOL";
  if (mint === SOLANA_USDC_MINT) return USDC_ASSET_ID;
  if (mint === SOLANA_USDT_MINT) return "solana:USDT";
  if (mint === SOLANA_JITOSOL_MINT) return "solana:JitoSOL";
  return `solana:mint:${mint}`;
}

export async function fetchPortfolioPriceObservations({
  candidates = [],
  api_key: apiKey,
  observed_at: observedAt,
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = PortfolioPreviewProviderLimits.price_timeout_ms,
  on_provider_call: onProviderCall = () => {},
} = {}) {
  const rows = (Array.isArray(candidates) ? candidates : []).slice(0, 50);
  if (!rows.length) return { observations: [], diagnostics: { state: "not_needed", requested_mints: 0, priced_mints: 0, omitted_mints: 0, rejected_mints: 0 } };
  const key = text(apiKey, 500);
  if (!key) return { observations: [], diagnostics: { state: "unavailable", failure: "provider_not_configured", requested_mints: rows.length, priced_mints: 0, omitted_mints: rows.length, rejected_mints: 0 } };
  const ids = rows.map((row) => row.mint);
  const url = new URL(JUPITER_PRICE_ENDPOINT);
  url.searchParams.set("ids", ids.join(","));
  try {
    const payload = await runProviderOperation({
      component: "portfolio_jupiter_price",
      operation_key: canonicalContractHash({ ids: [...ids].sort() }),
      fn: async () => {
        onProviderCall("jupiter_price");
        const out = await fetchJson(url, {
          fetch_impl: fetchImpl,
          timeout_ms: timeoutMs,
          headers: { "x-api-key": key },
          maximum_response_bytes: PortfolioPreviewProviderLimits.maximum_price_response_bytes,
        });
        if (out.response.status === 429) throw new Error("provider_rate_limited");
        if (!out.response.ok || !out.payload || Array.isArray(out.payload) || typeof out.payload !== "object") throw new Error("provider_response_invalid");
        return out.payload;
      },
    });
    const observations = [];
    let rejected = 0;
    for (const candidate of rows) {
      const price = payload[candidate.mint];
      if (!price || typeof price !== "object") continue;
      const providerDecimals = safeDecimals(price.decimals);
      const usdPrice = Number(price.usdPrice);
      if (providerDecimals !== candidate.decimals || !Number.isFinite(usdPrice) || usdPrice <= 0) {
        rejected += 1;
        continue;
      }
      const ratio = priceToMarkRatio(String(price.usdPrice), providerDecimals);
      if (!ratio) {
        rejected += 1;
        continue;
      }
      const input = {
        asset_id: knownAssetId(candidate.mint),
        mint: candidate.mint,
        ...ratio,
        observed_at: observedAt,
        freshness_state: "current",
        methodology: "jupiter_price_v3_filtered_last_swap",
        source_reference: "jupiter_price_v3",
      };
      observations.push(createSolanaMarkObservation(input));
      if (candidate.mint === SOLANA_WRAPPED_SOL_MINT) {
        observations.push(createSolanaMarkObservation({
          ...input,
          asset_id: SOLANA_NATIVE_ASSET_ID,
          mint: null,
        }));
      }
    }
    const pricedMints = new Set(observations.map((row) => row.facts.mint).filter(Boolean)).size;
    return {
      observations,
      diagnostics: {
        state: pricedMints === rows.length && rejected === 0 ? "complete" : "partial",
        requested_mints: rows.length,
        priced_mints: pricedMints,
        omitted_mints: Math.max(0, rows.length - pricedMints - rejected),
        rejected_mints: rejected,
      },
    };
  } catch (error) {
    return {
      observations: [],
      diagnostics: {
        state: "unavailable",
        failure: providerFailure(error),
        requested_mints: rows.length,
        priced_mints: 0,
        omitted_mints: rows.length,
        rejected_mints: 0,
      },
    };
  }
}

function quoteMint(position) {
  if (position.asset_id === SOLANA_NATIVE_ASSET_ID || position.asset_id === "solana:WSOL") return SOLANA_WRAPPED_SOL_MINT;
  if (position.asset_id === "solana:USDT") return SOLANA_USDT_MINT;
  if (position.asset_id === "solana:JitoSOL") return SOLANA_JITOSOL_MINT;
  if (position.asset_id.startsWith("solana:mint:")) return position.asset_id.slice("solana:mint:".length);
  return null;
}

export function groupPortfolioExecutableCandidates({
  positions = [],
  selected_position_ids: selectedPositionIds = [],
  maximum_groups: maximumGroups = PortfolioPreviewProviderLimits.maximum_executable_quote_groups,
} = {}) {
  const maximum = Number(maximumGroups);
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 8) throw new Error("portfolio_quote_group_limit_invalid");
  const selected = new Set(selectedPositionIds);
  const groups = new Map();
  for (const position of positions) {
    if (!selected.has(position.position_id)) continue;
    const mint = quoteMint(position);
    const amount = integerString(position.quantity_base_units);
    if (!mint || !validPublicKey(mint) || !amount || BigInt(amount) <= 0n || mint === SOLANA_USDC_MINT) continue;
    const current = groups.get(mint) || { input_mint: mint, input_amount_base_units: 0n, marked_value_minor: 0n, positions: [] };
    current.input_amount_base_units += BigInt(amount);
    current.marked_value_minor += BigInt(position.marked_value_minor || "0");
    current.positions.push(position);
    groups.set(mint, current);
  }
  const ordered = [...groups.values()].sort((left, right) => (
    right.marked_value_minor === left.marked_value_minor
      ? left.input_mint.localeCompare(right.input_mint)
      : right.marked_value_minor > left.marked_value_minor ? 1 : -1
  ));
  return {
    selected: ordered.slice(0, maximum).map((row) => ({
      input_mint: row.input_mint,
      input_amount_base_units: row.input_amount_base_units.toString(),
      marked_value_minor: row.marked_value_minor.toString(),
      positions: row.positions,
    })),
    deferred_group_count: Math.max(0, ordered.length - maximum),
    duplicate_position_quotes_avoided: ordered.reduce((sum, row) => sum + Math.max(0, row.positions.length - 1), 0),
  };
}

function allocateOutput(total, positions) {
  const value = BigInt(total);
  const weights = positions.map((row) => BigInt(row.quantity_base_units));
  const weightTotal = weights.reduce((sum, row) => sum + row, 0n);
  let assigned = 0n;
  return weights.map((weight, index) => {
    const allocation = index === weights.length - 1 ? value - assigned : (value * weight) / weightTotal;
    assigned += allocation;
    return allocation;
  });
}

function explicitlyNoRoute(response, payload) {
  if (response.ok) return false;
  const value = text(payload?.errorCode || payload?.error || payload?.message, 240).toLowerCase();
  return value.includes("no_route") || value.includes("no route") || value.includes("route not found") || value.includes("could not find any route");
}

async function fetchExecutableGroup(group, {
  apiKey,
  fetchImpl,
  nowMs,
  timeoutMs,
  quoteTtlMs,
  onProviderCall,
}) {
  const url = new URL(JUPITER_ORDER_ENDPOINT);
  url.searchParams.set("inputMint", group.input_mint);
  url.searchParams.set("outputMint", SOLANA_USDC_MINT);
  url.searchParams.set("amount", group.input_amount_base_units);
  const { response, payload } = await runProviderOperation({
    component: "portfolio_jupiter_exit_value",
    operation_key: canonicalContractHash({ mint: group.input_mint, amount: group.input_amount_base_units, output: SOLANA_USDC_MINT }),
    fn: async () => {
      onProviderCall("jupiter_executable_quote");
      return fetchJson(url, {
        fetch_impl: fetchImpl,
        timeout_ms: timeoutMs,
        headers: { "x-api-key": apiKey },
        maximum_response_bytes: PortfolioPreviewProviderLimits.maximum_executable_quote_response_bytes,
      });
    },
  });
  if (response.status === 429) throw new Error("provider_rate_limited");
  if (explicitlyNoRoute(response, payload)) return { state: "not_routeable", payload: null };
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("provider_response_invalid");
  if (payload.transaction) throw new Error("transaction_material_returned");
  if (text(payload.inputMint, 64) && payload.inputMint !== group.input_mint) throw new Error("provider_response_invalid");
  if (text(payload.outputMint, 64) && payload.outputMint !== SOLANA_USDC_MINT) throw new Error("provider_response_invalid");
  const inAmount = integerString(payload.inAmount);
  const expected = integerString(payload.outAmount);
  const minimum = integerString(payload.otherAmountThreshold);
  if (inAmount !== group.input_amount_base_units || !expected || !minimum || BigInt(minimum) <= 0n || BigInt(expected) < BigInt(minimum)) {
    throw new Error("provider_response_invalid");
  }
  const providerExpiry = Date.parse(text(payload.expireAt || payload.expiresAt, 80));
  const expiresAtMs = Number.isFinite(providerExpiry) && providerExpiry > nowMs
    ? Math.min(providerExpiry, nowMs + quoteTtlMs)
    : nowMs + quoteTtlMs;
  return {
    state: "routeable",
    expected,
    minimum,
    observed_at: new Date(nowMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

export async function fetchPortfolioExecutableObservations({
  groups = [],
  api_key: apiKey,
  fetch_impl: fetchImpl = globalThis.fetch,
  now_ms: nowMs = Date.now(),
  timeout_ms: timeoutMs = PortfolioPreviewProviderLimits.executable_quote_timeout_ms,
  quote_ttl_ms: quoteTtlMs = PortfolioPreviewProviderLimits.executable_quote_ttl_ms,
  on_provider_call: onProviderCall = () => {},
} = {}) {
  const selected = (Array.isArray(groups) ? groups : []).slice(0, PortfolioPreviewProviderLimits.maximum_executable_quote_groups);
  const key = text(apiKey, 500);
  if (!selected.length) return { observations: [], diagnostics: { state: "not_needed", requested_groups: 0, routeable_groups: 0, unrouteable_groups: 0, failed_groups: 0 } };
  if (!key) return { observations: [], diagnostics: { state: "unavailable", failure: "provider_not_configured", requested_groups: selected.length, routeable_groups: 0, unrouteable_groups: 0, failed_groups: selected.length } };
  const settled = await Promise.all(selected.map(async (group) => {
    try {
      return { group, result: await fetchExecutableGroup(group, { apiKey: key, fetchImpl, nowMs, timeoutMs, quoteTtlMs, onProviderCall }) };
    } catch (error) {
      return { group, error: providerFailure(error) };
    }
  }));
  const observations = [];
  const failures = [];
  let routeable = 0;
  let unrouteable = 0;
  for (const row of settled) {
    if (row.error) {
      failures.push(row.error);
      continue;
    }
    if (row.result.state === "not_routeable") {
      unrouteable += 1;
      for (const position of row.group.positions) {
        observations.push(createSolanaExecutableExitObservation({
          position_id: position.position_id,
          input_asset_id: position.asset_id,
          input_mint: row.group.input_mint,
          input_amount_base_units: position.quantity_base_units,
          routeability: "not_routeable",
          observed_at: new Date(nowMs).toISOString(),
          source_reference: "jupiter_swap_v2_order_quote_only",
        }));
      }
      continue;
    }
    routeable += 1;
    const expectedAllocations = allocateOutput(row.result.expected, row.group.positions);
    const minimumAllocations = allocateOutput(row.result.minimum, row.group.positions);
    row.group.positions.forEach((position, index) => {
      if (minimumAllocations[index] <= 0n || expectedAllocations[index] < minimumAllocations[index]) return;
      observations.push(createSolanaExecutableExitObservation({
        position_id: position.position_id,
        input_asset_id: position.asset_id,
        input_mint: row.group.input_mint,
        input_amount_base_units: position.quantity_base_units,
        expected_output_minor: expectedAllocations[index].toString(),
        minimum_output_minor: minimumAllocations[index].toString(),
        routeability: "routeable",
        observed_at: row.result.observed_at,
        expires_at: row.result.expires_at,
        source_reference: "jupiter_swap_v2_order_quote_only",
      }));
    });
  }
  return {
    observations,
    diagnostics: {
      state: failures.length ? (routeable || unrouteable ? "partial" : "unavailable") : "complete",
      requested_groups: selected.length,
      routeable_groups: routeable,
      unrouteable_groups: unrouteable,
      failed_groups: failures.length,
      failure_reasons: [...new Set(failures)].sort(),
      transaction_material_received: false,
    },
  };
}
