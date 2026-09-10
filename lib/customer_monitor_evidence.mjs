import { canonicalizeSavedMarket } from './customer_research_state.mjs';

export const ONCHAIN_MONITOR_POLICY = Object.freeze({
  maximum_instruments: 100,
  maximum_rows: 10_000,
  maximum_age_seconds: 120,
  flow_window: '1h',
  minimum_transactions: 10,
  buy_share_threshold: 0.6,
  sell_share_threshold: 0.4,
  classification_version: 'onchain_pool_flow_v1',
});
const chains = new Set(['solana', 'base', 'ethereum', 'bsc', 'robinhood']);

function exactPool(value) {
  try {
    const market = canonicalizeSavedMarket({ instrument_id: value });
    return market.instrument_type === 'exact_pool' && chains.has(market.chain_id) ? market : null;
  } catch { return null; }
}

export function onchainMonitorInstrumentIds(input = []) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.slice(0, 1000).flatMap(value => {
    const market = typeof value === 'string' && value.length <= 220 ? exactPool(value) : null;
    return market ? [market.instrument_id] : [];
  }))].slice(0, ONCHAIN_MONITOR_POLICY.maximum_instruments);
}

function tokenIdentity(chain, value) {
  if (typeof value !== 'string') return null;
  return exactPool(`${chain}:pool:${value}`)?.instrument_id || null;
}

function flow(market) {
  const buys = market.buys_1h, sells = market.sells_1h;
  if (!Number.isSafeInteger(buys) || buys < 0 || !Number.isSafeInteger(sells) || sells < 0) return null;
  const total = buys + sells;
  if (!Number.isSafeInteger(total) || total < ONCHAIN_MONITOR_POLICY.minimum_transactions) return null;
  const share = buys / total;
  return share >= ONCHAIN_MONITOR_POLICY.buy_share_threshold ? '1h buy-led'
    : share <= ONCHAIN_MONITOR_POLICY.sell_share_threshold ? '1h sell-led' : '1h balanced';
}

// Consume only the already-collected public pool snapshot. Missing or older
// rows never prove delisting, and discovery ranks are not alert evidence.
export function buildOnchainMonitorEvidence(snapshot, instrumentIds, { now = Math.floor(Date.now() / 1000) } = {}) {
  const output = {};
  if (!Number.isSafeInteger(now) || now < 0 || snapshot?.schema_version !== 'ravenos.participation_universe.v1'
    || snapshot.ok !== true || snapshot.safe_public !== true || !Array.isArray(snapshot.rows)
    || snapshot.rows.length > ONCHAIN_MONITOR_POLICY.maximum_rows) return output;
  const requested = new Set(onchainMonitorInstrumentIds(instrumentIds)), candidates = new Map(), conflicts = new Set();
  for (const row of snapshot.rows) {
    const identity = exactPool(row?.instrument_id);
    if (!identity || !requested.has(identity.instrument_id) || row.identity_scope !== 'exact_pool'
      || row.chain_id !== identity.chain_id || tokenIdentity(identity.chain_id, row.pool_address) !== identity.instrument_id
      || row.discovery_source !== 'dexscreener_pool_activity' || row.provenance?.provider !== 'dexscreener') continue;
    const token = tokenIdentity(identity.chain_id, row.token_address), quote = tokenIdentity(identity.chain_id, row.quote_token_address);
    if (!token || !quote || token === quote) continue;
    const timestamp = Math.floor(Date.parse(row.observed_at) / 1000), market = row.market;
    if (!Number.isSafeInteger(timestamp) || timestamp > now || now - timestamp > ONCHAIN_MONITOR_POLICY.maximum_age_seconds
      || typeof market?.price_usd !== 'number' || !Number.isFinite(market.price_usd) || market.price_usd <= 0
      || typeof market.liquidity_usd !== 'number' || !Number.isFinite(market.liquidity_usd) || market.liquidity_usd <= 0) continue;
    const classifications = { availability_state: 'available' }, pressure = flow(market);
    if (pressure) classifications.pressure_regime = pressure;
    const previous = candidates.get(identity.instrument_id);
    if (previous && (previous.token !== token || previous.quote !== quote
      || (previous.timestamp === timestamp && JSON.stringify(previous.classifications) !== JSON.stringify(classifications)))) {
      conflicts.add(identity.instrument_id);
    }
    if (!previous || timestamp > previous.timestamp) candidates.set(identity.instrument_id, { token, quote, timestamp, classifications });
  }
  for (const [instrumentId, candidate] of candidates) {
    if (conflicts.has(instrumentId)) continue;
    output[instrumentId] = {
      schema_version: 'ravenos.monitor_evidence.v1', instrument_id: instrumentId,
      source_timestamp: candidate.timestamp, source_state: 'qualified',
      source_kind: 'raven_onchain_pool_flow', evidence_role: 'raven_measurement',
      classification_version: ONCHAIN_MONITOR_POLICY.classification_version,
      maximum_age_seconds: ONCHAIN_MONITOR_POLICY.maximum_age_seconds,
      classifications: candidate.classifications,
      limitations: [
        'Flow compares reported buy and sell transaction counts over one hour, with at least ten transactions. It is not wallet profit or net dollar flow.',
        'A current pool snapshot does not prove execution readiness. Missing snapshots do not prove that a market has closed.',
      ],
    };
  }
  return output;
}
