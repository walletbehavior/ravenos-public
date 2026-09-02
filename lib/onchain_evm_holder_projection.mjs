import { runProviderOperation } from "./customer_trade/terminal_runtime.mjs";
import { ONCHAIN_HOLDER_SCHEMA } from "./onchain_holder_projection.mjs";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// A provider's exact EVM market identity can be either a pool contract
// address or, for protocols such as Uniswap v4, a bytes32 pool id. Token and
// holder identities remain strict 20-byte EVM addresses.
const EVM_POOL_ID_RE = /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const BLOCKSCOUT_API_ORIGIN = "https://api.blockscout.com";
const MAX_PUBLIC_HOLDER_ROWS = 50;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const CACHE_TTL_MS = 180_000;
const MAX_CACHE_MARKETS = 24;

const CHAIN_CONFIG = Object.freeze({
  robinhood: Object.freeze({
    chain_id: "4663",
    label: "Robinhood Chain",
    explorer_account: "https://robinhoodchain.blockscout.com/address/",
  }),
  base: Object.freeze({
    chain_id: "8453",
    label: "Base",
    explorer_account: "https://basescan.org/address/",
  }),
  bsc: Object.freeze({
    chain_id: "56",
    label: "BNB Chain",
    explorer_account: "https://bscscan.com/address/",
  }),
  ethereum: Object.freeze({
    chain_id: "1",
    label: "Ethereum",
    explorer_account: "https://etherscan.io/address/",
  }),
});

const holderCache = new Map();

function clean(value, max = 180) {
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

function integerString(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : null;
}

function safeInteger(value) {
  const text = integerString(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function tokenDecimals(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
}

function decimalAmount(amount, decimals) {
  const raw = integerString(amount);
  if (raw === null || decimals === null) return null;
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function supplySharePct(amount, supply) {
  const numerator = BigInt(amount);
  const denominator = BigInt(supply);
  if (numerator < 0n || denominator <= 0n) return null;
  const scaled = (numerator * 100_000_000n) / denominator;
  return Number(scaled) / 1_000_000;
}

function exactIdentity(identity = {}) {
  const chain = clean(identity.chain, 20).toLowerCase();
  const config = CHAIN_CONFIG[chain];
  // Validate the full supplied value. Truncating before applying an identity
  // regex could turn a malformed overlong value into a valid-looking address.
  const poolAddress = clean(identity.pool_address, 180).toLowerCase();
  const tokenAddress = clean(identity.token_address, 180).toLowerCase();
  const quoteAddress = clean(identity.quote_token_address, 180).toLowerCase();
  if (!config) fail("holder_chain_unsupported", 400);
  if (!EVM_POOL_ID_RE.test(poolAddress) || !EVM_ADDRESS_RE.test(tokenAddress)) fail("holder_identity_invalid", 400);
  if (quoteAddress && !EVM_ADDRESS_RE.test(quoteAddress)) fail("holder_identity_invalid", 400);
  if (quoteAddress && quoteAddress === tokenAddress) fail("holder_identity_invalid", 400);
  return Object.freeze({
    chain,
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_token_address: quoteAddress || null,
  });
}

export function resolvePublicEvmHolderRuntime(env = {}, chain = "") {
  const config = CHAIN_CONFIG[clean(chain, 20).toLowerCase()] || null;
  const enabled = String(env.RAVENOS_PUBLIC_EVM_HOLDERS_ENABLED || "") === "1";
  const apiKey = clean(env.BLOCKSCOUT_API_KEY, 256);
  return Object.freeze({
    enabled: Boolean(config && enabled && apiKey),
    state: !config ? "unsupported" : !enabled ? "disabled" : apiKey ? "configured" : "misconfigured",
    chain: config ? clean(chain, 20).toLowerCase() : null,
    chain_id: config?.chain_id || null,
    network_label: config?.label || null,
    explorer_account: config?.explorer_account || null,
    api_key: apiKey || null,
    source_label: "Blockscout indexed holders",
  });
}

function providerUrl(runtime, pathname) {
  const url = new URL(`/${runtime.chain_id}/api/v2/${pathname.replace(/^\/+/, "")}`, BLOCKSCOUT_API_ORIGIN);
  url.searchParams.set("apikey", runtime.api_key);
  return url;
}

async function boundedProviderFetch(url, { fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("holder_provider_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) fail("holder_provider_response_too_large");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PROVIDER_RESPONSE_BYTES) fail("holder_provider_response_too_large");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("holder_provider_response_invalid");
    }
    if (!response.ok) fail(response.status === 404 ? "holder_token_unavailable" : "holder_provider_unavailable", response.status === 404 ? 404 : 502);
    return payload;
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError" || error?.message === "holder_provider_timeout") fail("holder_provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function tokenFacts(payload, identity) {
  const address = clean(payload?.address_hash || payload?.address, 180).toLowerCase();
  const standard = clean(payload?.type, 24).toUpperCase();
  const decimals = tokenDecimals(payload?.decimals);
  const supply = integerString(payload?.total_supply);
  const holderCount = safeInteger(payload?.holders_count ?? payload?.holders);
  if (address !== identity.token_address) fail("holder_provider_identity_mismatch", 409);
  if (standard !== "ERC-20") fail("holder_token_standard_unsupported", 409);
  if (decimals === null || supply === null || BigInt(supply) <= 0n) fail("holder_supply_unavailable");
  return Object.freeze({ standard, decimals, supply, holder_count: holderCount });
}

function holderAddress(row) {
  return clean(row?.address?.hash || row?.address_hash?.hash || row?.address_hash || row?.address, 180).toLowerCase();
}

function providerHolderRows(payload, facts, identity, runtime) {
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items || items.length > MAX_PUBLIC_HOLDER_ROWS) fail("holder_provider_response_invalid");
  const rows = items.map((row) => {
    const address = holderAddress(row);
    const amount = integerString(row?.value);
    if (!EVM_ADDRESS_RE.test(address) || amount === null) fail("holder_provider_identity_incomplete", 409);
    const exactPool = address === identity.pool_address;
    return {
      holder_address: address,
      token_account_address: address,
      token_account_count: 1,
      balance: decimalAmount(amount, facts.decimals),
      supply_share_pct: supplySharePct(amount, facts.supply),
      classification: exactPool ? "exact_pool_account" : row?.address?.is_contract === true || row?.address_hash?.is_contract === true ? "contract" : "owner",
      excluded_from_wallet_concentration: exactPool,
      explorer_url: `${runtime.explorer_account}${address}`,
      _amount: BigInt(amount),
    };
  }).filter((row) => row._amount > 0n);
  rows.sort((left, right) => left._amount === right._amount
    ? left.holder_address.localeCompare(right.holder_address)
    : left._amount > right._amount ? -1 : 1);
  return Object.freeze(rows.map((row, index) => Object.freeze({ ...row, rank: index + 1 })));
}

function concentrationPct(rows, count, supply, { excludePool = false } = {}) {
  const amount = rows
    .filter((row) => !excludePool || !row.excluded_from_wallet_concentration)
    .slice(0, count)
    .reduce((sum, row) => sum + row._amount, 0n);
  return supplySharePct(amount.toString(), supply);
}

function publicRows(rows) {
  return Object.freeze(rows.map(({ _amount, ...row }) => Object.freeze(row)));
}

async function buildHolderSnapshot({ runtime, identity, fetchImpl, observedAt }) {
  const [tokenPayload, holderPayload] = await Promise.all([
    boundedProviderFetch(providerUrl(runtime, `tokens/${identity.token_address}`), { fetchImpl }),
    boundedProviderFetch(providerUrl(runtime, `tokens/${identity.token_address}/holders`), { fetchImpl }),
  ]);
  const facts = tokenFacts(tokenPayload, identity);
  const internalRows = providerHolderRows(holderPayload, facts, identity, runtime);
  if (!internalRows.length) fail("holder_list_empty");
  const holders = publicRows(internalRows);
  const totalOwners = facts.holder_count !== null && facts.holder_count >= holders.length ? facts.holder_count : null;
  const poolAccountExclusionVerified = EVM_ADDRESS_RE.test(identity.pool_address);
  return Object.freeze({
    ok: true,
    safe_public: true,
    schema_version: ONCHAIN_HOLDER_SCHEMA,
    state: "available",
    identity,
    observed_at: observedAt,
    slot: null,
    coverage: Object.freeze({
      scope: "provider_ranked_top_holders",
      scan_state: "indexed_partial",
      maximum_source_accounts: MAX_PUBLIC_HOLDER_ROWS,
      scanned_source_accounts: internalRows.length,
      returned_owner_rows: holders.length,
      total_owner_rows: totalOwners,
      complete_holder_census: false,
      owners_aggregated_across_all_accounts: true,
      pool_account_exclusion_state: poolAccountExclusionVerified ? "exact_address" : "unresolved_pool_id",
    }),
    summary: Object.freeze({
      holder_count: totalOwners,
      token_account_count: null,
      top_10_supply_pct: concentrationPct(internalRows, 10, facts.supply),
      top_20_supply_pct: concentrationPct(internalRows, 20, facts.supply),
      top_50_supply_pct: concentrationPct(internalRows, 50, facts.supply),
      top_100_supply_pct: null,
      largest_non_pool_wallet_supply_pct: poolAccountExclusionVerified ? concentrationPct(internalRows, 1, facts.supply, { excludePool: true }) : null,
      top_3_wallet_supply_pct: poolAccountExclusionVerified ? concentrationPct(internalRows, 3, facts.supply, { excludePool: true }) : null,
      top_10_wallet_supply_pct: poolAccountExclusionVerified ? concentrationPct(internalRows, 10, facts.supply, { excludePool: true }) : null,
    }),
    token_controls: Object.freeze({
      source: "blockscout_token_index",
      state: "unavailable",
      token_standard: facts.standard,
      mint_authority: "unknown",
      freeze_authority: "unknown",
    }),
    holders,
    source: Object.freeze({
      label: runtime.source_label,
      network: runtime.network_label,
      chain_id: runtime.chain_id,
      method: "indexed_top_holders",
      raw_provider_included: false,
    }),
    limitations: Object.freeze([
      "Current indexed top holders; not a complete holder census.",
      "Wallet ownership and relationships are not inferred.",
      "Only the exact selected contract and pool identity are accepted.",
      ...(poolAccountExclusionVerified ? [] : ["The v4 pool id does not identify its custody account, so wallet concentration excluding the pool is unresolved."]),
    ]),
  });
}

export async function buildPublicEvmHolderProjection({
  env = {},
  identity: suppliedIdentity = {},
  fetch_impl: fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const identity = exactIdentity(suppliedIdentity);
  const runtime = resolvePublicEvmHolderRuntime(env, identity.chain);
  if (!runtime.enabled) fail(runtime.state === "misconfigured" ? "holder_source_misconfigured" : "holder_source_disabled", 503);
  const cacheKey = `${identity.chain}:${identity.pool_address}:${identity.token_address}`;
  const hit = holderCache.get(cacheKey);
  if (hit && hit.expires_at > Date.now()) return Object.freeze({ ...hit.payload, cache: "hit" });
  const projection = await runProviderOperation({
    component: "public_evm_holders",
    operation_key: cacheKey,
    fn: () => buildHolderSnapshot({ runtime, identity, fetchImpl, observedAt: now().toISOString() }),
  });
  holderCache.set(cacheKey, { expires_at: Date.now() + CACHE_TTL_MS, payload: projection });
  while (holderCache.size > MAX_CACHE_MARKETS) holderCache.delete(holderCache.keys().next().value);
  return Object.freeze({ ...projection, cache: "miss" });
}

export const OnchainEvmHolderProjectionContract = Object.freeze({
  schema_version: ONCHAIN_HOLDER_SCHEMA,
  supported_chains: Object.freeze(Object.keys(CHAIN_CONFIG)),
  provider: "blockscout",
  maximum_holder_rows: MAX_PUBLIC_HOLDER_ROWS,
  complete_holder_census_available: false,
  exact_pool_and_token_identity_required: true,
  provider_activation_required: true,
  public_by_default: true,
  wallet_labels_inferred: false,
  raw_provider_included: false,
});
