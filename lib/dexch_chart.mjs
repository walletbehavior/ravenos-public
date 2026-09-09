import { auditCandleContinuity, validateExactCandleIdentity } from './chart_continuity.mjs';
import { normalizeChartInstrument, timeframeSeconds } from '../ravenos-chart-data-plane.js';

const equal = (chain, a, b) => Boolean(a && b && (chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase()));
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function buildDexchChart({ token, pair, envelope, chain, pairAddress, tokenAddress, quoteAddress, asset, timeframe, limit = 240, now = Date.now() }) {
  if (!['1m','5m','15m','1h','4h','1d'].includes(timeframe)) fail('dexch_chart_interval_unavailable');
  if (!token || token.chain !== chain || !equal(chain, token.address, tokenAddress)
    || !equal(chain, token.venue?.pool_address, pairAddress) || !equal(chain, token.venue?.quote_token_address, quoteAddress)
    || pair?.chainId !== chain || !equal(chain, pair.pairAddress, pairAddress)
    || !equal(chain, pair.baseToken?.address, tokenAddress) || !equal(chain, pair.quoteToken?.address, quoteAddress)
    || envelope?.chain !== chain || !equal(chain, envelope.token_address, tokenAddress) || envelope.timeframe !== timeframe) fail('dexch_chart_identity_mismatch');
  const pairCreated = Number(pair.pairCreatedAt);
  const migrated = Date.parse(token.lifecycle?.migrated_at || '');
  // Token-scoped history may include a bonding curve. Only retain intervals
  // fully after the selected pool's known creation/migration boundary.
  const boundary = Math.max(Number.isFinite(pairCreated) ? pairCreated : 0, Number.isFinite(migrated) ? migrated : 0);
  if (!boundary || boundary > now) fail('dexch_chart_pool_history_boundary_unavailable');
  const intervalSeconds = timeframeSeconds(timeframe);
  if (envelope.quality?.invalid_rows > 0 || envelope.rows.some(row => row.volume === null || row.volume === undefined)) fail('dexch_chart_continuity_rejected');
  const rows = envelope.rows.filter(row => row.time * 1000 >= boundary && row.time * 1000 <= now);
  const audit = auditCandleContinuity(rows, { interval: timeframe, nowSeconds: Math.floor(now / 1000), volumeSemantics: 'provider_reported_additive_volume' });
  if (audit.state === 'rejected') fail('dexch_chart_continuity_rejected');
  const candles = audit.candles.slice(-Math.max(1,Math.min(1000,Number(limit)||240)));
  if (!candles.length) fail('dexch_chart_history_unavailable');
  const pool = chain === 'solana' ? pairAddress : pairAddress.toLowerCase();
  const identity = { chain, pool_address: pool, selected_token_address: token.address, quote_token_address: token.venue.quote_token_address,
    orientation: 'selected_token_usd', selected_token_decimals: token.canonical_identity.decimals, quote_token_decimals: token.venue.quote_decimals };
  const continuity = validateExactCandleIdentity({ expected: identity, actual: identity });
  const last = candles.at(-1), age = Math.max(0,Math.floor(now/1000)-last.time);
  const delayed = age > Math.max(intervalSeconds*2,120);
  const observedAt = envelope.provenance.retrieved_at;
  const symbol = String(asset || '').replace(/\s+Spot$/i, '').toUpperCase();
  const instrument = normalizeChartInstrument({ instrumentType: 'spot_pool', marketType: 'spot',
    symbol, baseAsset: symbol, quoteAsset: 'USD', chain, venue: 'onchain_pool',
    pairAddress: pool, tokenAddress: token.address, marketStatus: 'active', ravenCoverageState: 'provider_backed',
    providerRouting: { history: 'dexch', live: 'bounded_provider_poll', providerAsset: token.address, providerNetwork: chain } });
  const publicAudit = { ...audit }; delete publicAudit.candles;
  const derivation = { state: 'direct', source_interval: timeframe, target_interval: timeframe, source_bar_count: candles.length, missing_buckets_filled: 0, interpolation_used: false };
  return {
    ok: true, asset, provider_asset: token.address, market_identity: `${chain}:${pool}`, chain, pair_address: pool, token_address: token.address, quote_address: quoteAddress,
    source: 'Dexch', source_type: 'provider', source_label: 'Dexch market prices', coverage: delayed ? 'Delayed' : 'Live', stale: delayed,
    freshness_state: delayed ? 'delayed' : 'live', timeframe, updated_at: observedAt, observed_at: observedAt, age_seconds: Math.max(0, Math.floor((now - Date.parse(observedAt)) / 1000)),
    last_candle_at: new Date(last.time*1000).toISOString(), last_candle_age_seconds: age, instrument,
    capabilities: { historical_bars: true, older_bar_backfill: false, live_bars: true, live_trades: false, live_poll_interval_ms: 30_000,
      liquidity: true, order_book: false, funding: false, open_interest: false, raven_overlays: true },
    history_window: { before: null, returned: candles.length, oldest: candles[0].time, newest: last.time },
    market_state: { last: last.close, liquidity_usd: Number(pair.liquidity?.usd)||null, volume: last.volume, observed_at: observedAt },
    attribution: { required: true, label: 'Market data: Dexch', url: 'https://dexch.art/' },
    continuity: { schema_version: 'ravenos.chart_continuity.v1', state: audit.state === 'verified' ? 'verified' : audit.state,
      identity: continuity, candles: publicAudit, exact_pool_fingerprint: `${chain}:${pool}:${token.address}:${quoteAddress}`,
      selected_token_decimals: identity.selected_token_decimals, quote_token_decimals: identity.quote_token_decimals, token_orientation: 'selected_token_usd' },
    derivation,
    provider_usage: { schema_version: 'ravenos.provider_usage.v1', provider: 'dexch', pool: `${chain}:${pool}`, interval: timeframe, source_interval: timeframe,
      cache_hit: false, candle_mode: 'direct', provider_request_count: null, maximum_uncached_provider_requests: 3, fallback_event: true, projected_cost_state: 'existing_public_provider', projected_provider_requests_per_active_refresh: 3 },
    lineage: { provider: 'Dexch', provider_tier: 'public', provider_plan: 'public', commercial_state: 'operator_acknowledged',
      empty_interval_policy: 'provider_reported_sparse', network: chain, pool_address: pool, token_address: token.address, quote_address: quoteAddress,
      price_currency: 'usd', token_orientation: 'selected_token_usd', last_candle_at: new Date(last.time*1000).toISOString(),
      identity_basis: 'dexch_current_pool_cross_checked_with_dexscreener', token_scoped_history: true, pool_history_starts_at: new Date(boundary).toISOString() },
    candles,
  };
}
