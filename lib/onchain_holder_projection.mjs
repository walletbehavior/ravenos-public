import { runProviderOperation } from "./customer_trade/terminal_runtime.mjs";

export const ONCHAIN_HOLDER_SCHEMA = "ravenos.onchain_holder_list.v1";
export const PUBLIC_SOLANA_HOLDER_ROUTE = "/api/onchain/holders";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_HOLDER_ROWS = 20;
const MAX_RPC_RESPONSE_BYTES = 512 * 1024;
const CACHE_TTL_MS = 60_000;
const holderCache = new Map();

function clean(value, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function fail(code, status = 502) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function safeRpcUrl(value) {
  try {
    const url = new URL(clean(value, 1_000));
    const hostname = url.hostname.toLowerCase();
    const forbiddenHost = hostname === "localhost"
      || hostname.endsWith(".local")
      || hostname === "0.0.0.0"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^169\.254\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || forbiddenHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolvePublicSolanaHolderRuntime(env = {}) {
  const enabled = String(env.RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED || "") === "1";
  const rpcUrl = safeRpcUrl(env.RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL);
  return Object.freeze({
    enabled: enabled && Boolean(rpcUrl),
    state: !enabled ? "disabled" : rpcUrl ? "configured" : "misconfigured",
    rpc_url: rpcUrl,
    source_label: "Solana on-chain accounts",
  });
}

function exactIdentity(identity = {}) {
  const chain = clean(identity.chain, 20).toLowerCase();
  const poolAddress = clean(identity.pool_address, 64);
  const tokenAddress = clean(identity.token_address, 64);
  const quoteAddress = clean(identity.quote_token_address, 64);
  if (chain !== "solana") fail("holder_chain_unsupported", 400);
  if (!SOLANA_ADDRESS_RE.test(poolAddress) || !SOLANA_ADDRESS_RE.test(tokenAddress)) fail("holder_identity_invalid", 400);
  if (quoteAddress && !SOLANA_ADDRESS_RE.test(quoteAddress)) fail("holder_identity_invalid", 400);
  return Object.freeze({ chain, pool_address: poolAddress, token_address: tokenAddress, quote_token_address: quoteAddress || null });
}

function integerString(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : null;
}

function decimals(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 18 ? number : null;
}

function decimalAmount(amount, places) {
  const raw = integerString(amount);
  if (raw === null || places === null) return null;
  if (places === 0) return raw;
  const padded = raw.padStart(places + 1, "0");
  const whole = padded.slice(0, -places);
  const fraction = padded.slice(-places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function supplySharePct(amount, supply) {
  const numerator = BigInt(amount);
  const denominator = BigInt(supply);
  if (denominator <= 0n || numerator < 0n) return null;
  const scaled = (numerator * 100_000_000n) / denominator;
  return Number(scaled) / 1_000_000;
}

async function boundedRpcFetch(url, method, params, { fetchImpl = globalThis.fetch, timeoutMs = 4_500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("holder_rpc_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RPC_RESPONSE_BYTES) fail("holder_rpc_response_too_large");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RPC_RESPONSE_BYTES) fail("holder_rpc_response_too_large");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("holder_rpc_response_invalid");
    }
    if (!response.ok || payload?.error || !Object.hasOwn(payload || {}, "result")) fail("holder_rpc_unavailable");
    return payload.result;
  } catch (error) {
    if (error?.name === "AbortError" || error?.message === "holder_rpc_timeout") fail("holder_rpc_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parsedTokenAccount(row, expectedMint, fallbackAddress) {
  const info = row?.data?.parsed?.info;
  const owner = clean(info?.owner, 64);
  const mint = clean(info?.mint, 64);
  const amount = integerString(info?.tokenAmount?.amount);
  const tokenDecimals = decimals(info?.tokenAmount?.decimals);
  if (mint !== expectedMint || amount === null || tokenDecimals === null) return null;
  return Object.freeze({
    holder_address: SOLANA_ADDRESS_RE.test(owner) ? owner : fallbackAddress,
    token_account_address: fallbackAddress,
    amount,
    decimals: tokenDecimals,
    owner_resolved: SOLANA_ADDRESS_RE.test(owner),
  });
}

function normalizeHolderRows({ largest, accounts, supply, identity }) {
  const rows = Array.isArray(largest?.value) ? largest.value.slice(0, MAX_HOLDER_ROWS) : [];
  const accountRows = Array.isArray(accounts?.value) ? accounts.value : [];
  if (!rows.length || accountRows.length !== rows.length) fail("holder_rpc_identity_incomplete");
  const supplyAmount = integerString(supply?.value?.amount);
  const supplyDecimals = decimals(supply?.value?.decimals);
  if (supplyAmount === null || supplyDecimals === null || BigInt(supplyAmount) <= 0n) fail("holder_supply_unavailable");

  const aggregated = new Map();
  rows.forEach((row, index) => {
    const tokenAccountAddress = clean(row?.address, 64);
    if (!SOLANA_ADDRESS_RE.test(tokenAccountAddress)) fail("holder_token_account_invalid");
    const parsed = parsedTokenAccount(accountRows[index], identity.token_address, tokenAccountAddress);
    if (!parsed || parsed.decimals !== supplyDecimals) fail("holder_rpc_identity_mismatch", 409);
    const existing = aggregated.get(parsed.holder_address) || {
      holder_address: parsed.holder_address,
      token_account_addresses: [],
      amount: 0n,
      owner_resolved: parsed.owner_resolved,
    };
    existing.amount += BigInt(parsed.amount);
    existing.token_account_addresses.push(parsed.token_account_address);
    existing.owner_resolved = existing.owner_resolved && parsed.owner_resolved;
    aggregated.set(parsed.holder_address, existing);
  });

  return [...aggregated.values()]
    .sort((left, right) => left.amount === right.amount ? left.holder_address.localeCompare(right.holder_address) : left.amount > right.amount ? -1 : 1)
    .slice(0, MAX_HOLDER_ROWS)
    .map((row, index) => {
      const exactPoolAccount = row.holder_address === identity.pool_address || row.token_account_addresses.includes(identity.pool_address);
      return Object.freeze({
        rank: index + 1,
        holder_address: row.holder_address,
        token_account_address: row.token_account_addresses[0],
        token_account_count: row.token_account_addresses.length,
        balance: decimalAmount(row.amount.toString(), supplyDecimals),
        supply_share_pct: supplySharePct(row.amount.toString(), supplyAmount),
        classification: exactPoolAccount ? "exact_pool_account" : row.owner_resolved ? "owner" : "token_account",
        excluded_from_wallet_concentration: exactPoolAccount,
        explorer_url: `https://solscan.io/account/${row.holder_address}`,
      });
    });
}

export async function buildPublicSolanaHolderProjection({
  env = {},
  identity: suppliedIdentity = {},
  fetch_impl: fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const runtime = resolvePublicSolanaHolderRuntime(env);
  if (!runtime.enabled) fail(runtime.state === "misconfigured" ? "holder_source_misconfigured" : "holder_source_disabled", 503);
  const identity = exactIdentity(suppliedIdentity);
  const cacheKey = `${identity.pool_address}:${identity.token_address}`;
  const hit = holderCache.get(cacheKey);
  if (hit && hit.expires_at > Date.now()) return Object.freeze({ ...hit.payload, cache: "hit" });

  const projection = await runProviderOperation({
    component: "public_solana_holders",
    operation_key: cacheKey,
    fn: async () => {
      const rpc = (method, params) => boundedRpcFetch(runtime.rpc_url, method, params, { fetchImpl });
      const [largest, supply] = await Promise.all([
        rpc("getTokenLargestAccounts", [identity.token_address, { commitment: "confirmed" }]),
        rpc("getTokenSupply", [identity.token_address, { commitment: "confirmed" }]),
      ]);
      const addresses = (Array.isArray(largest?.value) ? largest.value : []).slice(0, MAX_HOLDER_ROWS).map((row) => clean(row?.address, 64));
      if (!addresses.length || addresses.some((address) => !SOLANA_ADDRESS_RE.test(address))) fail("holder_largest_accounts_unavailable");
      const accounts = await rpc("getMultipleAccounts", [addresses, { encoding: "jsonParsed", commitment: "confirmed" }]);
      const holders = normalizeHolderRows({ largest, accounts, supply, identity });
      const slot = Math.max(Number(largest?.context?.slot) || 0, Number(accounts?.context?.slot) || 0, Number(supply?.context?.slot) || 0) || null;
      return Object.freeze({
        ok: true,
        safe_public: true,
        schema_version: ONCHAIN_HOLDER_SCHEMA,
        state: "available",
        identity,
        observed_at: now().toISOString(),
        slot,
        coverage: Object.freeze({
          scope: "largest_20_token_accounts",
          maximum_source_accounts: MAX_HOLDER_ROWS,
          returned_owner_rows: holders.length,
          complete_holder_census: false,
          owners_aggregated_across_top_accounts: true,
        }),
        holders: Object.freeze(holders),
        source: Object.freeze({ label: runtime.source_label, network: "mainnet-beta", raw_rpc_included: false }),
        limitations: Object.freeze([
          "This is the largest-account view, not a complete paginated holder census.",
          "Program, exchange, and custody ownership may require additional labels that are not inferred here.",
          "Only the exact selected token mint and pool identity are accepted.",
        ]),
        cache: "miss",
      });
    },
  });
  holderCache.set(cacheKey, { expires_at: Date.now() + CACHE_TTL_MS, payload: projection });
  if (holderCache.size > 128) holderCache.delete(holderCache.keys().next().value);
  return projection;
}

export function publicHolderUnavailable(error) {
  const code = clean(error?.code || error?.message || "holder_list_unavailable", 80).toLowerCase();
  const status = Number.isInteger(error?.status) ? error.status : 502;
  return Object.freeze({
    status,
    payload: Object.freeze({
      ok: false,
      safe_public: true,
      schema_version: ONCHAIN_HOLDER_SCHEMA,
      state: "unavailable",
      error: code.startsWith("holder_") ? code : "holder_list_unavailable",
      holders: Object.freeze([]),
    }),
  });
}

export const OnchainHolderProjectionContract = Object.freeze({
  schema_version: ONCHAIN_HOLDER_SCHEMA,
  route: PUBLIC_SOLANA_HOLDER_ROUTE,
  supported_chains: Object.freeze(["solana"]),
  maximum_holder_rows: MAX_HOLDER_ROWS,
  complete_holder_census: false,
  public_by_default: true,
  provider_activation_required: true,
  private_rpc_fallback_allowed: false,
  wallet_labels_inferred: false,
  raw_rpc_included: false,
});
