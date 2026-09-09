import { normalizeSourceWalletChainIdentity } from './customer_trade/source_wallet_chain_identity.mjs';

export const MarketProviderPolicy = Object.freeze({
  cache_entries: 300, request_timeout_ms: 5000, maximum_response_bytes: 1024 * 1024,
  discovery_cache_ms: 300_000, pair_cache_ms: 30_000, provider_retry_ms: 60_000,
  quota_retry_ms: 3_600_000, seed_pools_per_chain: 90, wallet_candidates_per_market: 100,
});
const allowedHosts = new Set(['api.dexscreener.com', 'api.dexpaprika.com', 'api.dexch.art', 'pro-api.coingecko.com', 'api.coingecko.com']);
const chains = new Set(['solana', 'base', 'bsc', 'ethereum', 'robinhood']);
const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const text = (value, length = 80) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, length);
const address = (chain, value, pool = false) => {
  const clean = String(value || '').trim();
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean) ? clean : null;
  return (pool ? /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/ : /^0x[a-fA-F0-9]{40}$/).test(clean) ? clean.toLowerCase() : null;
};
const failure = code => Object.assign(new Error(code), { code });

async function boundedBody(response, maximumBytes) {
  if (Number(response.headers.get('content-length')) > maximumBytes) throw failure('market_provider_response_too_large');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0, body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw failure('market_provider_response_too_large');
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

// Public market GETs only. Cache keys never contain credentials. Results are
// still normalized by each adapter; a cached response is not verified evidence.
export class MarketProviderReader {
  constructor({ fetchFn = (...args) => globalThis.fetch(...args), now = () => Date.now(), cache = () => globalThis.caches?.default } = {}) {
    this.fetchFn = fetchFn; this.now = now; this.cache = cache;
    this.memory = new Map(); this.inflight = new Map(); this.backoff = new Map();
  }
  async read(input, options = {}) { return (await this.snapshot(input, options)).value; }
  async snapshot(input, { ttlMs = 30_000, headers = {}, maxBytes = MarketProviderPolicy.maximum_response_bytes, timeoutMs = MarketProviderPolicy.request_timeout_ms } = {}) {
    const url = new URL(input);
    if (url.origin !== `https://${url.hostname}` || !allowedHosts.has(url.hostname) || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => /^(api[-_]?key|access_token|authorization)$/i.test(key))) throw failure('market_provider_origin_invalid');
    headers = Object.fromEntries(new Headers(headers));
    // Credentialed reads share only within this Worker, never a public edge key.
    const credentialed = Object.keys(headers).some(key => /authorization|api.key/i.test(key));
    const scope = credentialed ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(headers))))].map(byte => byte.toString(16).padStart(2, '0')).join('') : '';
    const key = url.toString() + scope;
    const hit = this.memory.get(key);
    if (hit?.expires > this.now() && hit.expires - hit.stored_at <= ttlMs) return this.result(hit, true);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.load(url, key, { ttlMs, headers, maxBytes, timeoutMs, credentialed });
    this.inflight.set(key, job);
    try { return await job; } finally { this.inflight.delete(key); }
  }
  async load(url, key, { ttlMs, headers, maxBytes, timeoutMs, credentialed }) {
    const cacheKey = new Request(`https://market-provider-cache.ravenos.invalid/v1/${encodeURIComponent(url.toString())}`);
    const cache = credentialed ? null : this.cache();
    try {
      const response = await cache?.match(cacheKey);
      if (response?.ok) {
        const stored = await response.json();
        if (stored.expires > this.now() && stored.stored_at <= this.now() && stored.expires - stored.stored_at <= ttlMs) {
          this.remember(key, stored); return this.result(stored, true);
        }
      }
    } catch { /* Cache availability cannot enable a provider request in backoff. */ }
    if ((this.backoff.get(url.origin) || 0) > this.now()) throw failure('market_provider_backoff');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchFn(url.toString(), { headers: { accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        if ([402, 429, 503].includes(response.status)) {
          let quota = response.status === 402;
          if (response.status === 429 && /coingecko\.com$/.test(url.hostname)) {
            const errorText = await boundedBody(response, 4096).catch(() => '');
            quota = /10006/.test(errorText); // Do not retain or expose provider error bodies.
          }
          const delay = quota ? MarketProviderPolicy.quota_retry_ms : MarketProviderPolicy.provider_retry_ms;
          this.backoff.set(url.origin, this.now() + delay);
        }
        throw failure(`market_provider_http_${response.status}`);
      }
      const body = await boundedBody(response, maxBytes);
      const value = JSON.parse(body);
      if (!value || typeof value !== 'object') throw failure('market_provider_response_invalid');
      const stored = { stored_at: this.now(), expires: this.now() + ttlMs, value };
      this.remember(key, stored);
      if (cache?.put && ttlMs > 0) await cache.put(cacheKey, new Response(JSON.stringify(stored), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.ceil(ttlMs / 1000)}` } })).catch(() => {});
      return this.result(stored, false);
    } catch (error) { if (controller.signal.aborted) throw failure('market_provider_timeout'); throw error; }
    finally { clearTimeout(timer); }
  }
  result(stored, cacheHit) { return { value: stored.value, observed_at: new Date(stored.stored_at).toISOString(), cache_hit: cacheHit }; }
  remember(key, stored) {
    this.memory.set(key, stored);
    while (this.memory.size > MarketProviderPolicy.cache_entries) this.memory.delete(this.memory.keys().next().value);
  }
}

export function normalizeDexScreenerActivity(pair, { chain, duration = '5m', observedAt = new Date().toISOString(), nowMs = Date.now() } = {}) {
  if (!chains.has(chain) || pair?.chainId !== chain) return null;
  const pool = address(chain, pair.pairAddress, true), token = address(chain, pair.baseToken?.address), quote = address(chain, pair.quoteToken?.address);
  const price = number(pair.priceUsd), liquidity = number(pair.liquidity?.usd);
  if (!pool || !token || !quote || token === quote || !(price > 0) || !(liquidity > 0)) return null;
  const symbol = text(pair.baseToken?.symbol, 24), quoteSymbol = text(pair.quoteToken?.symbol, 24);
  const stables = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'USDG', 'USDE', 'FDUSD']);
  if (stables.has(symbol.toUpperCase()) && stables.has(quoteSymbol.toUpperCase())) return null;
  const metrics = {};
  for (const [window, key] of Object.entries({ '5m': 'm5', '1h': 'h1', '6h': 'h6', '24h': 'h24' })) {
    metrics[`price_change_${window}_pct`] = number(pair.priceChange?.[key]);
    metrics[`volume_usd_${window}`] = number(pair.volume?.[key]);
    metrics[`buys_${window}`] = number(pair.txns?.[key]?.buys);
    metrics[`sells_${window}`] = number(pair.txns?.[key]?.sells);
  }
  const created = number(pair.pairCreatedAt), now = Date.parse(observedAt), change = metrics[`price_change_${duration}_pct`];
  if (!Number.isFinite(now) || now > nowMs + 60_000) return null;
  const age = Math.max(0, Math.floor((nowMs - now) / 1000));
  return {
    public_attention_id: `market:${chain}:${pool}`, instrument_id: `${chain}:pool:${pool}`, source_type: 'market_activity',
    discovery_source: 'dexscreener_pool_activity', market_type: 'spot', chain, chain_id: chain, venue: text(pair.dexId), identity_scope: 'exact_pool',
    symbol, name: text(pair.baseToken?.name || symbol), token_address: token, quote_token_address: quote, quote_symbol: quoteSymbol, pool_address: pool,
    observed_at: observedAt, age_seconds: age, context_state: age > 120 ? 'delayed' : 'current', movement_state: change === null ? 'Active pool' : change > 0 ? 'Rising activity' : 'Falling activity',
    what_changed: change === null ? 'Current pool activity.' : `${change.toFixed(2)}% over ${duration}.`,
    risk: 'Provider market data; inspect the pool and route before trading.', ranking_duration: duration,
    market: { price_usd: price, liquidity_usd: liquidity, market_cap_usd: number(pair.marketCap), fdv_usd: number(pair.fdv),
      market_age_seconds: created && created <= now ? Math.floor((now - created) / 1000) : null,
      pool_created_at: created && created <= now ? new Date(created).toISOString() : null, ...metrics },
    provenance: { provider: 'dexscreener', sampling: 'candidate_pool_snapshot', provider_ranking_is_raven_signal: false },
    inspection: { state: 'exact_pool_ready', silent_pool_selection: false }, research_only: true, actionable: false, execution_available: false,
  };
}

export function dexchWalletCandidates(envelope, identity, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!chains.has(identity?.chain) || !envelope?.ok || !Array.isArray(envelope.rows) || envelope.chain !== identity.chain
    || !address(identity.chain, identity.token_address) || address(identity.chain, envelope.token_address) !== address(identity.chain, identity.token_address)) return [];
  const holders = envelope.schema_version === 'ravenos.provider_holders.dexch.v1';
  const trades = envelope.schema_version === 'ravenos.provider_trades.dexch.v1';
  if (!holders && !trades) return [];
  const seen = new Map(), excluded = new Set([identity.pool_address, identity.token_address, identity.quote_token_address].map(value => address(identity.chain, value)));
  for (const row of envelope.rows.slice(0, MarketProviderPolicy.wallet_candidates_per_market)) {
    const candidate = address(identity.chain, holders ? row.address : row.trader_address);
    const observed = Math.floor(Date.parse(holders ? envelope.provenance.retrieved_at : row.observed_at) / 1000);
    if (!candidate || excluded.has(candidate) || !Number.isFinite(observed) || observed > now + 60 || now - observed > 86400) continue;
    try {
      const source = normalizeSourceWalletChainIdentity({ chain: identity.chain, network: 'mainnet', address: candidate });
      seen.set(source.source_wallet_id, { ...source, observed_at: observed, provider_scope: 'dexch_reported_candidate',
        ...(holders ? { discovery_source: { source_kind: 'top_holder', provider: 'dexch', source_rank: row.rank,
          source_reference: `https://api.dexch.art/api/v1/tokens/${identity.chain}/${identity.token_address}/holders` } } : {}) });
    } catch { /* Invalid account identity is never queued as a wallet. */ }
  }
  return [...seen.values()];
}
