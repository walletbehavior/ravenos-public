import { matchesMarketScope } from './ravenos-market-scope.js';
import { bestExactSpotMarketPerToken, spotMarketCapitalization, spotMarketFactFreshness } from './ravenos-discover-intelligence.js';

// This is a rolling market-price sample, not realized trader P&L or a census.
// Bands are explicit, half-open intervals shared by measurement and filtering.
export const PARTICIPATION_POLICY = Object.freeze({ minimumSample: 5, minimumCoverage: 0.6, directionalMovePct: 1, directionalBreadth: 0.6, downsideTailPct: -10, maximumDownsideShare: 0.4, freshPairSeconds: 86_400 });
export const PARTICIPATION_BANDS = Object.freeze([
  { id: 'under_100k', label: '<$100K', min: 0, max: 100_000 },
  { id: '100k_500k', label: '$100K–$500K', min: 100_000, max: 500_000 },
  { id: '500k_2m', label: '$500K–$2M', min: 500_000, max: 2_000_000 },
  { id: '2m_10m', label: '$2M–$10M', min: 2_000_000, max: 10_000_000 },
  { id: '10m_plus', label: '$10M+', min: 10_000_000, max: null },
].map(Object.freeze));
const CHAINS = Object.freeze({ solana: 'SOL', robinhood: 'RH', bsc: 'BNB', base: 'BASE', ethereum: 'ETH', arbitrum: 'ARB', avalanche: 'AVAX' });
const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const chainOf = row => ({ bnb: 'bsc', eth: 'ethereum', rh: 'robinhood', avax: 'avalanche' })[row.chain_id || row.chain] || row.chain_id || row.chain;
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null; };

export function participationPairAge(row, now = Date.now()) {
  const observed = Date.parse(row.discovery?.facts?.observed_at || row.observed_at || '');
  const created = Date.parse(row.market?.pool_created_at || '');
  if (Number.isFinite(created) && created <= now) return (now - created) / 1_000;
  const age = finite(row.market?.pool_age_seconds ?? row.market?.market_age_seconds);
  return age !== null && age >= 0 && Number.isFinite(observed) ? age + Math.max(0, now - observed) / 1_000 : null;
}

export function matchesParticipationCell(row, filter, now = Date.now()) {
  if (!filter || chainOf(row) !== filter.chain || !matchesMarketScope(row, 'memecoins')) return false;
  if (filter.kind === 'new_pairs') {
    const age = participationPairAge(row, now);
    return age !== null && age >= 0 && age < PARTICIPATION_POLICY.freshPairSeconds;
  }
  const band = PARTICIPATION_BANDS.find(item => item.id === filter.band);
  const cap = spotMarketCapitalization(row.market);
  return Boolean(band && cap !== null && cap >= band.min && (band.max === null || cap < band.max));
}

export function buildParticipationMap(rows = [], { now = Date.now(), family = 'capitalization' } = {}) {
  const eligible = rows.filter(row => matchesMarketScope(row, 'memecoins') && CHAINS[chainOf(row)] && row.token_address && row.pool_address);
  // A token with several pools receives one vote; volume covers that pool only.
  const unique = bestExactSpotMarketPerToken(eligible, { nowMs: now }).map(entry => entry.row || entry);
  const cells = [];
  for (const [chain, short] of Object.entries(CHAINS)) {
    for (const band of family === 'new_pairs' ? [{ id: 'new_pairs', label: 'New pairs' }] : PARTICIPATION_BANDS) {
      const filter = Object.freeze({ chain, kind: family === 'new_pairs' ? 'new_pairs' : 'capitalization', band: band.id });
      const members = unique.filter(row => matchesParticipationCell(row, filter, now));
      if (!members.length) continue;
      const current = members.filter(row => spotMarketFactFreshness(row, now).current);
      const measured = current.filter(row => {
        const change = finite(row.market?.price_change_6h_pct), age = participationPairAge(row, now);
        return change !== null && change >= -100 && age !== null && age >= 21_600;
      });
      const changes = measured.map(row => Number(row.market.price_change_6h_pct));
      const move = median(changes), positiveShare = changes.length ? changes.filter(value => value > 0).length / changes.length : null;
      const downsideShare = changes.length ? changes.filter(value => value <= PARTICIPATION_POLICY.downsideTailPct).length / changes.length : null;
      const coverage = measured.length / members.length;
      let state = current.length ? 'developing' : 'stale';
      if (measured.length >= PARTICIPATION_POLICY.minimumSample && coverage >= PARTICIPATION_POLICY.minimumCoverage) {
        state = move >= PARTICIPATION_POLICY.directionalMovePct && positiveShare >= PARTICIPATION_POLICY.directionalBreadth && downsideShare < PARTICIPATION_POLICY.maximumDownsideShare
          ? 'rewarding' : move <= -PARTICIPATION_POLICY.directionalMovePct && positiveShare <= 1 - PARTICIPATION_POLICY.directionalBreadth ? 'punishing' : 'fragile';
      }
      const volumeRows = current.filter(row => finite(row.market?.volume_usd_6h) !== null && Number(row.market.volume_usd_6h) >= 0);
      const volume = volumeRows.length ? volumeRows.reduce((sum, row) => sum + Number(row.market.volume_usd_6h), 0) : null;
      const observed = current.map(row => row.discovery?.facts?.observed_at || row.observed_at).sort();
      cells.push({ id: `${chain}:${band.id}`, label: `${short} ${band.label}`, filter, state, medianReturnPct: move, positiveShare, downsideShare,
        sample: measured.length, tracked: members.length, current: current.length, observedVolumeUsd: Number.isFinite(volume) ? volume : null,
        volumeSample: volumeRows.length, observedAt: observed[0] || null, coverage });
    }
  }
  cells.sort((a, b) => (b.observedVolumeUsd ?? -1) - (a.observedVolumeUsd ?? -1) || a.id.localeCompare(b.id));
  return { family, cells, scope: 'memecoins', returnWindow: '6h', tracked: unique.length, measured: cells.reduce((sum, cell) => sum + cell.sample, 0),
    measurement: 'Median 6h token-price change · one observed pool per token', volumeWindow: '6h', generatedAt: new Date(now).toISOString() };
}

export const PERP_PARTICIPATION_BANDS = Object.freeze([
  { id: 'oi_under_10m', label: 'OI <$10M', min: 0, max: 10_000_000 },
  { id: 'oi_10m_100m', label: 'OI $10M–$100M', min: 10_000_000, max: 100_000_000 },
  { id: 'oi_100m_plus', label: 'OI $100M+', min: 100_000_000, max: null },
].map(Object.freeze));
export function matchesPerpParticipationCell(row, filter) {
  if (!matchesMarketScope(row, 'perps') || !filter || row.is_synthetic === true) return false;
  if (filter.kind === 'funding') {
    const funding = finite(row.funding_rate);
    return funding !== null && (filter.band === 'positive' ? funding > 0 : filter.band === 'negative' ? funding < 0 : funding === 0);
  }
  const band = PERP_PARTICIPATION_BANDS.find(item => item.id === filter.band), oi = finite(row.open_interest_usd);
  return Boolean(band && oi !== null && oi >= band.min && (band.max === null || oi < band.max));
}
export function buildPerpParticipationMap(rows = [], { now = Date.now(), observedAt = null, family = 'open_interest' } = {}) {
  const unique = [...new Map(rows.filter(row => matchesMarketScope(row, 'perps') && row.is_synthetic !== true).map(row => [row.instrument_id, row])).values()];
  const current = row => { const age = now - Date.parse(row.observed_at || observedAt || ''); return Number.isFinite(age) && age >= 0 && age <= 120_000; };
  // The venue's shared metadata endpoint reports 24h return/volume. Never turn
  // those into a six-hour estimate. A 6h view needs separately measured inputs.
  const groups = family === 'funding' ? [{ id: 'positive', label: 'Positive funding' }, { id: 'negative', label: 'Negative funding' }, { id: 'flat', label: 'Flat funding' }] : PERP_PARTICIPATION_BANDS;
  const cells = groups.map(band => {
    const filter = Object.freeze({ scope: 'perps', kind: family, band: band.id });
    const members = unique.filter(row => matchesPerpParticipationCell(row, filter));
    if (!members.length) return null;
    const active = members.filter(current), measured = active.filter(row => finite(row.day_change_pct) !== null && Number(row.day_change_pct) >= -100);
    const values = measured.map(row => Number(row.day_change_pct)), move = median(values), breadth = measured.length ? values.filter(value => value > 0).length / measured.length : null;
    const downsideShare = measured.length ? values.filter(value => value <= PARTICIPATION_POLICY.downsideTailPct).length / measured.length : null;
    let state = active.length ? 'developing' : 'stale';
    if (measured.length >= PARTICIPATION_POLICY.minimumSample && measured.length / members.length >= PARTICIPATION_POLICY.minimumCoverage) {
      state = move >= PARTICIPATION_POLICY.directionalMovePct && breadth >= PARTICIPATION_POLICY.directionalBreadth && downsideShare < PARTICIPATION_POLICY.maximumDownsideShare ? 'rewarding' : move <= -PARTICIPATION_POLICY.directionalMovePct && breadth <= 1 - PARTICIPATION_POLICY.directionalBreadth ? 'punishing' : 'fragile';
    }
    const volumes = active.map(row => finite(row.day_notional_volume_usd)).filter(value => value !== null && value >= 0);
    return { id: `perps:${band.id}`, label: band.label, filter, state, medianReturnPct: move, returnWindow: '24h', sample: measured.length, tracked: members.length, current: active.length,
      observedVolumeUsd: volumes.length ? volumes.reduce((a, b) => a + b, 0) : null, volumeSample: volumes.length, observedAt: active.map(row => row.observed_at || observedAt).sort()[0] || null, positiveShare: breadth, downsideShare };
  }).filter(Boolean).sort((a, b) => (b.observedVolumeUsd ?? -1) - (a.observedVolumeUsd ?? -1));
  return { cells, scope: 'perps', family, returnWindow: '24h', volumeWindow: '24h', tracked: unique.length, measured: cells.reduce((sum, cell) => sum + cell.sample, 0),
    measurement: 'Median 24h contract-price change · Hyperliquid', generatedAt: new Date(now).toISOString() };
}

// Exact area is proportional to reported volume. Tiny tiles stay readable as
// buttons below the map instead of inventing a minimum volume/area for them.
export function layoutParticipationTiles(cells, width, height, { minWidth = 168, minHeight = 100 } = {}) {
  const eligible = cells.filter(cell => cell.observedVolumeUsd > 0), overflow = cells.filter(cell => !(cell.observedVolumeUsd > 0));
  function partition(items, x, y, w, h) {
    if (!items.length) return [];
    if (items.length === 1) return [{ cell: items[0], x, y, width: w, height: h }];
    const total = items.reduce((sum, cell) => sum + cell.observedVolumeUsd, 0);
    let index = 1, sum = items[0].observedVolumeUsd;
    while (index < items.length - 1 && Math.abs(total / 2 - sum - items[index].observedVolumeUsd) < Math.abs(total / 2 - sum)) sum += items[index++].observedVolumeUsd;
    const share = sum / total;
    return w >= h
      ? [...partition(items.slice(0, index), x, y, w * share, h), ...partition(items.slice(index), x + w * share, y, w * (1 - share), h)]
      : [...partition(items.slice(0, index), x, y, w, h * share), ...partition(items.slice(index), x, y + h * share, w, h * (1 - share))];
  }
  let tiles = [], remaining = [...eligible];
  while (remaining.length) {
    tiles = partition(remaining, 0, 0, width, height);
    const small = tiles.filter(tile => tile.width < minWidth || tile.height < minHeight).map(tile => tile.cell);
    if (!small.length) break;
    overflow.push(...small); remaining = remaining.filter(cell => !small.includes(cell)); tiles = [];
  }
  return { tiles, overflow };
}
