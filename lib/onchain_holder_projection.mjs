import bs58 from "bs58";

import { runProviderOperation } from "./customer_trade/terminal_runtime.mjs";

export const ONCHAIN_HOLDER_SCHEMA = "ravenos.onchain_holder_list.v2";
export const PUBLIC_SOLANA_HOLDER_ROUTE = "/api/onchain/holders";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
const MAX_PUBLIC_HOLDER_ROWS = 100;
const MAX_CENSUS_SOURCE_ACCOUNTS = 25_000;
const MAX_CENSUS_PAGES = 25;
const MAX_RPC_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 180_000;
const MAX_CACHE_MARKETS = 8;
const holderCache = new Map();
const ownerHoldingCache = new Map();

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

function decodeBase64(value) {
  const encoded = clean(Array.isArray(value) ? value[0] : value, MAX_RPC_RESPONSE_BYTES);
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(encoded, "base64"));
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function uint64LittleEndian(bytes, offset) {
  if (!(bytes instanceof Uint8Array) || bytes.length < offset + 8) return null;
  let value = 0n;
  for (let index = offset + 7; index >= offset; index -= 1) value = (value << 8n) + BigInt(bytes[index]);
  return value;
}

function uint32LittleEndian(bytes, offset) {
  if (!(bytes instanceof Uint8Array) || bytes.length < offset + 4) return null;
  return bytes[offset]
    + bytes[offset + 1] * 256
    + bytes[offset + 2] * 65_536
    + bytes[offset + 3] * 16_777_216;
}

function mintControlFacts(mintAccount) {
  const program = clean(mintAccount?.value?.owner, 64);
  const bytes = decodeBase64(mintAccount?.value?.data);
  if (!TOKEN_PROGRAMS.has(program) || !bytes || bytes.length < 82) {
    return Object.freeze({
      source: "solana_mint_account",
      state: "unavailable",
      mint_authority: "unknown",
      freeze_authority: "unknown",
    });
  }
  const mintAuthorityOption = uint32LittleEndian(bytes, 0);
  const freezeAuthorityOption = uint32LittleEndian(bytes, 46);
  const authorityState = (value) => value === 0 ? "disabled" : value === 1 ? "enabled" : "unknown";
  return Object.freeze({
    source: "solana_mint_account",
    state: mintAuthorityOption === null || freezeAuthorityOption === null ? "unavailable" : "available",
    mint_authority: authorityState(mintAuthorityOption),
    freeze_authority: authorityState(freezeAuthorityOption),
  });
}

function parsedProgramTokenAccount(row, expectedMintBytes, tokenProgram) {
  const tokenAccountAddress = clean(row?.pubkey, 64);
  if (!SOLANA_ADDRESS_RE.test(tokenAccountAddress) || clean(row?.account?.owner, 64) !== tokenProgram) return null;
  const bytes = decodeBase64(row?.account?.data);
  if (!bytes || bytes.length < 72 || !equalBytes(bytes.slice(0, 32), expectedMintBytes)) return null;
  const holderAddress = bs58.encode(bytes.slice(32, 64));
  const amount = uint64LittleEndian(bytes, 64);
  if (!SOLANA_ADDRESS_RE.test(holderAddress) || amount === null) return null;
  return Object.freeze({
    holder_address: holderAddress,
    token_account_address: tokenAccountAddress,
    amount: amount.toString(),
    owner_resolved: true,
  });
}

function supplyFacts(supply) {
  const amount = integerString(supply?.value?.amount);
  const tokenDecimals = decimals(supply?.value?.decimals);
  if (amount === null || tokenDecimals === null || BigInt(amount) <= 0n) fail("holder_supply_unavailable");
  return Object.freeze({ amount, decimals: tokenDecimals });
}

function publicOwnerRows({ accounts, supply, identity }) {
  const aggregated = new Map();
  for (const account of accounts) {
    if (!account || BigInt(account.amount) <= 0n) continue;
    const existing = aggregated.get(account.holder_address) || {
      holder_address: account.holder_address,
      token_account_addresses: [],
      amount: 0n,
      owner_resolved: account.owner_resolved,
    };
    existing.amount += BigInt(account.amount);
    existing.token_account_addresses.push(account.token_account_address);
    existing.owner_resolved = existing.owner_resolved && account.owner_resolved;
    aggregated.set(account.holder_address, existing);
  }

  const sorted = [...aggregated.values()].sort((left, right) => (
    left.amount === right.amount
      ? left.holder_address.localeCompare(right.holder_address)
      : left.amount > right.amount ? -1 : 1
  ));
  return Object.freeze(sorted.map((row, index) => {
    const exactPoolAccount = row.holder_address === identity.pool_address || row.token_account_addresses.includes(identity.pool_address);
    return Object.freeze({
      rank: index + 1,
      holder_address: row.holder_address,
      token_account_address: row.token_account_addresses[0],
      token_account_count: row.token_account_addresses.length,
      balance: decimalAmount(row.amount.toString(), supply.decimals),
      supply_share_pct: supplySharePct(row.amount.toString(), supply.amount),
      classification: exactPoolAccount ? "exact_pool_account" : row.owner_resolved ? "owner" : "token_account",
      excluded_from_wallet_concentration: exactPoolAccount,
      explorer_url: `https://solscan.io/account/${row.holder_address}`,
      _amount: row.amount,
    });
  }));
}

function concentrationPct(rows, count, supply, { excludePool = false } = {}) {
  const sum = rows
    .filter((row) => !excludePool || !row.excluded_from_wallet_concentration)
    .slice(0, count)
    .reduce((total, row) => total + row._amount, 0n);
  return supplySharePct(sum.toString(), supply.amount);
}

function publicRows(rows, maximum = MAX_PUBLIC_HOLDER_ROWS) {
  return Object.freeze(rows.slice(0, maximum).map(({ _amount, ...row }) => Object.freeze(row)));
}

function largestAccountRows({ largest, accounts, expectedMint }) {
  const rows = Array.isArray(largest?.value) ? largest.value.slice(0, 20) : [];
  const accountRows = Array.isArray(accounts?.value) ? accounts.value : [];
  if (!rows.length || accountRows.length !== rows.length) fail("holder_rpc_identity_incomplete");
  return Object.freeze(rows.map((row, index) => {
    const tokenAccountAddress = clean(row?.address, 64);
    if (!SOLANA_ADDRESS_RE.test(tokenAccountAddress)) fail("holder_token_account_invalid");
    const parsed = parsedTokenAccount(accountRows[index], expectedMint, tokenAccountAddress);
    if (!parsed) fail("holder_rpc_identity_mismatch", 409);
    return parsed;
  }));
}

async function readCompleteProgramAccountCensus({ rpc, identity, mintAccount, supply }) {
  const tokenProgram = clean(mintAccount?.value?.owner, 64);
  if (!TOKEN_PROGRAMS.has(tokenProgram)) fail("holder_token_program_unsupported");
  let expectedMintBytes;
  try {
    expectedMintBytes = new Uint8Array(bs58.decode(identity.token_address));
  } catch {
    fail("holder_identity_invalid", 400);
  }
  if (expectedMintBytes.length !== 32) fail("holder_identity_invalid", 400);

  const accountsByAddress = new Map();
  const pageKeys = new Set();
  const slots = [];
  let pageKey = null;
  let complete = false;
  let pageCount = 0;

  while (pageCount < MAX_CENSUS_PAGES && accountsByAddress.size < MAX_CENSUS_SOURCE_ACCOUNTS) {
    const configuration = {
      encoding: "base64",
      commitment: "confirmed",
      withContext: true,
      order: "asc",
      filters: [{ memcmp: { offset: 0, bytes: identity.token_address } }],
      dataSlice: { offset: 0, length: 72 },
    };
    if (pageKey) configuration.pageKey = pageKey;
    const result = await rpc("getProgramAccounts", [tokenProgram, configuration]);
    const values = Array.isArray(result?.value) ? result.value : Array.isArray(result) ? result : null;
    if (!values) fail("holder_rpc_response_invalid");
    const slot = Number(result?.context?.slot);
    if (Number.isSafeInteger(slot) && slot > 0) slots.push(slot);
    for (const row of values) {
      if (accountsByAddress.size >= MAX_CENSUS_SOURCE_ACCOUNTS) break;
      const parsed = parsedProgramTokenAccount(row, expectedMintBytes, tokenProgram);
      if (!parsed) fail("holder_rpc_identity_mismatch", 409);
      if (BigInt(parsed.amount) > 0n) accountsByAddress.set(parsed.token_account_address, parsed);
    }
    pageCount += 1;
    const nextPageKey = clean(result?.pageKey, 512) || null;
    if (!nextPageKey) {
      complete = true;
      break;
    }
    if (pageKeys.has(nextPageKey)) fail("holder_rpc_pagination_invalid");
    pageKeys.add(nextPageKey);
    pageKey = nextPageKey;
  }

  return Object.freeze({
    complete,
    accounts: Object.freeze([...accountsByAddress.values()]),
    page_count: pageCount,
    token_program: tokenProgram,
    slot_min: slots.length ? Math.min(...slots) : null,
    slot_max: slots.length ? Math.max(...slots) : null,
    supply,
  });
}

async function buildLargestAccountFallback({
  rpc,
  identity,
  supplyResult,
  observedAt,
  sourceLabel,
  indexedState = "unavailable",
  tokenControls = null,
}) {
  const [largest, supplied] = await Promise.all([
    rpc("getTokenLargestAccounts", [identity.token_address, { commitment: "confirmed" }]),
    supplyResult ? Promise.resolve(supplyResult) : rpc("getTokenSupply", [identity.token_address, { commitment: "confirmed" }]),
  ]);
  const addresses = (Array.isArray(largest?.value) ? largest.value : []).slice(0, 20).map((row) => clean(row?.address, 64));
  if (!addresses.length || addresses.some((address) => !SOLANA_ADDRESS_RE.test(address))) fail("holder_largest_accounts_unavailable");
  const accountsResult = await rpc("getMultipleAccounts", [addresses, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const supply = supplyFacts(supplied);
  const accounts = largestAccountRows({ largest, accounts: accountsResult, expectedMint: identity.token_address });
  if (accounts.some((account) => account.decimals !== supply.decimals)) fail("holder_rpc_identity_mismatch", 409);
  const ownerRows = publicOwnerRows({ accounts, supply, identity });
  const holders = publicRows(ownerRows, 20);
  const slot = Math.max(Number(largest?.context?.slot) || 0, Number(accountsResult?.context?.slot) || 0, Number(supplied?.context?.slot) || 0) || null;
  return Object.freeze({
    ok: true,
    safe_public: true,
    schema_version: ONCHAIN_HOLDER_SCHEMA,
    state: "available",
    identity,
    observed_at: observedAt,
    slot,
    coverage: Object.freeze({
      scope: "largest_20_token_accounts",
      scan_state: indexedState,
      maximum_source_accounts: 20,
      scanned_source_accounts: accounts.length,
      returned_owner_rows: holders.length,
      total_owner_rows: null,
      complete_holder_census: false,
      owners_aggregated_across_all_accounts: false,
    }),
    summary: Object.freeze({
      holder_count: null,
      token_account_count: null,
      top_10_supply_pct: concentrationPct(ownerRows, 10, supply),
      top_20_supply_pct: concentrationPct(ownerRows, 20, supply),
      top_50_supply_pct: null,
      top_100_supply_pct: null,
      largest_non_pool_wallet_supply_pct: concentrationPct(ownerRows, 1, supply, { excludePool: true }),
      top_3_wallet_supply_pct: concentrationPct(ownerRows, 3, supply, { excludePool: true }),
      top_10_wallet_supply_pct: concentrationPct(ownerRows, 10, supply, { excludePool: true }),
    }),
    token_controls: tokenControls || Object.freeze({
      source: "solana_mint_account",
      state: "unavailable",
      mint_authority: "unknown",
      freeze_authority: "unknown",
    }),
    holders,
    source: Object.freeze({ label: sourceLabel, network: "mainnet-beta", method: "largest_accounts_fallback", raw_rpc_included: false }),
    limitations: Object.freeze([
      "This is the largest-account fallback, not a complete holder census.",
      "Program, exchange, custody, bundle, and insider ownership are not inferred.",
      "Only the exact selected token mint and pool identity are accepted.",
    ]),
  });
}

async function buildHolderSnapshot({ runtime, identity, fetchImpl, observedAt }) {
  const rpc = (method, params) => boundedRpcFetch(runtime.rpc_url, method, params, { fetchImpl });
  let supplyResult = null;
  let tokenControls = null;
  try {
    const [mintAccount, supplied] = await Promise.all([
      rpc("getAccountInfo", [identity.token_address, { encoding: "base64", commitment: "confirmed" }]),
      rpc("getTokenSupply", [identity.token_address, { commitment: "confirmed" }]),
    ]);
    supplyResult = supplied;
    const supply = supplyFacts(supplied);
    tokenControls = mintControlFacts(mintAccount);
    const census = await readCompleteProgramAccountCensus({ rpc, identity, mintAccount, supply });
    if (!census.complete) {
      return buildLargestAccountFallback({
        rpc,
        identity,
        supplyResult,
        observedAt,
        sourceLabel: runtime.source_label,
        indexedState: "bounded_before_completion",
        tokenControls,
      });
    }
    const ownerRows = publicOwnerRows({ accounts: census.accounts, supply, identity });
    if (!ownerRows.length) fail("holder_census_empty");
    const holders = publicRows(ownerRows);
    return Object.freeze({
      ok: true,
      safe_public: true,
      schema_version: ONCHAIN_HOLDER_SCHEMA,
      state: "available",
      identity,
      observed_at: observedAt,
      slot: census.slot_max,
      coverage: Object.freeze({
        scope: "all_nonzero_token_accounts",
        scan_state: "complete",
        maximum_source_accounts: MAX_CENSUS_SOURCE_ACCOUNTS,
        scanned_source_accounts: census.accounts.length,
        returned_owner_rows: holders.length,
        total_owner_rows: ownerRows.length,
        complete_holder_census: true,
        owners_aggregated_across_all_accounts: true,
        page_count: census.page_count,
        slot_min: census.slot_min,
        slot_max: census.slot_max,
      }),
      summary: Object.freeze({
        holder_count: ownerRows.length,
        token_account_count: census.accounts.length,
        top_10_supply_pct: concentrationPct(ownerRows, 10, supply),
        top_20_supply_pct: concentrationPct(ownerRows, 20, supply),
        top_50_supply_pct: concentrationPct(ownerRows, 50, supply),
        top_100_supply_pct: concentrationPct(ownerRows, 100, supply),
        largest_non_pool_wallet_supply_pct: concentrationPct(ownerRows, 1, supply, { excludePool: true }),
        top_3_wallet_supply_pct: concentrationPct(ownerRows, 3, supply, { excludePool: true }),
        top_10_wallet_supply_pct: concentrationPct(ownerRows, 10, supply, { excludePool: true }),
      }),
      token_controls: tokenControls,
      holders,
      source: Object.freeze({ label: runtime.source_label, network: "mainnet-beta", method: "indexed_program_account_scan", raw_rpc_included: false }),
      limitations: Object.freeze([
        "The current census aggregates every nonzero token account returned for the exact mint into its on-chain owner.",
        "Program, exchange, custody, bundle, and insider ownership are not inferred.",
        "Pool-controlled vaults are excluded only when their exact address is independently established.",
      ]),
    });
  } catch (error) {
    if (error?.status === 400 || error?.status === 409) throw error;
    return buildLargestAccountFallback({
      rpc,
      identity,
      supplyResult,
      observedAt,
      sourceLabel: runtime.source_label,
      indexedState: "unavailable",
      tokenControls,
    });
  }
}

export async function measurePublicSolanaOwnerHolding({
  env = {},
  identity: suppliedIdentity = {},
  owner_address: suppliedOwnerAddress = "",
  fetch_impl: fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const runtime = resolvePublicSolanaHolderRuntime(env);
  if (!runtime.enabled) fail(runtime.state === "misconfigured" ? "holder_source_misconfigured" : "holder_source_disabled", 503);
  const identity = exactIdentity(suppliedIdentity);
  const ownerAddress = clean(suppliedOwnerAddress, 64);
  if (!SOLANA_ADDRESS_RE.test(ownerAddress)) fail("holder_owner_identity_invalid", 400);
  const cacheKey = `${identity.token_address}:${ownerAddress}`;
  const hit = ownerHoldingCache.get(cacheKey);
  if (hit && hit.expires_at > Date.now()) return Object.freeze({ ...hit.payload, cache: "hit" });

  const rpc = (method, params) => boundedRpcFetch(runtime.rpc_url, method, params, { fetchImpl });
  const [supplyResult, accountsResult] = await Promise.all([
    rpc("getTokenSupply", [identity.token_address, { commitment: "confirmed" }]),
    rpc("getTokenAccountsByOwner", [
      ownerAddress,
      { mint: identity.token_address },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
  ]);
  const supply = supplyFacts(supplyResult);
  const accountRows = Array.isArray(accountsResult?.value) ? accountsResult.value : [];
  if (accountRows.length > 1_000) fail("holder_owner_accounts_too_many");
  let amount = 0n;
  let accountCount = 0;
  for (const row of accountRows) {
    const address = clean(row?.pubkey, 64);
    if (!SOLANA_ADDRESS_RE.test(address)) fail("holder_owner_accounts_invalid");
    const parsed = parsedTokenAccount(row?.account, identity.token_address, address);
    if (!parsed || parsed.holder_address !== ownerAddress) fail("holder_owner_accounts_identity_mismatch", 409);
    amount += BigInt(parsed.amount);
    accountCount += 1;
  }
  const observedAt = now().toISOString();
  const result = Object.freeze({
    schema_version: "ravenos.solana_owner_holding.v1",
    state: "available",
    identity,
    owner_address: ownerAddress,
    observed_at: observedAt,
    token_account_count: accountCount,
    balance: decimalAmount(amount.toString(), supply.decimals),
    supply_share_pct: supplySharePct(amount.toString(), supply.amount),
    source: Object.freeze({
      label: runtime.source_label,
      network: "mainnet-beta",
      method: "exact_owner_token_accounts",
      raw_rpc_included: false,
    }),
  });
  ownerHoldingCache.set(cacheKey, { expires_at: Date.now() + CACHE_TTL_MS, payload: result });
  while (ownerHoldingCache.size > MAX_CACHE_MARKETS * 3) ownerHoldingCache.delete(ownerHoldingCache.keys().next().value);
  return Object.freeze({ ...result, cache: "miss" });
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
    fn: () => buildHolderSnapshot({ runtime, identity, fetchImpl, observedAt: now().toISOString() }),
  });
  holderCache.set(cacheKey, { expires_at: Date.now() + CACHE_TTL_MS, payload: projection });
  while (holderCache.size > MAX_CACHE_MARKETS) holderCache.delete(holderCache.keys().next().value);
  return Object.freeze({ ...projection, cache: "miss" });
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
  maximum_holder_rows: MAX_PUBLIC_HOLDER_ROWS,
  maximum_census_source_accounts: MAX_CENSUS_SOURCE_ACCOUNTS,
  complete_holder_census_available: true,
  public_by_default: true,
  provider_activation_required: true,
  private_rpc_fallback_allowed: false,
  wallet_labels_inferred: false,
  raw_rpc_included: false,
});
