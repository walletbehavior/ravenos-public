import { reportedSpotLifecycle, spotMarketFactFreshness, spotMarketSnapshotUsable, spotDiscoveryQuality } from '../ravenos-discover-intelligence.js';

export function cachedDiscoverCandidates(rows = [], chains = [], nowMs = Date.now()) {
  return rows.filter(row => chains.includes(row.chain_id))
    .map(row => ({ ...row, discovery_source: 'cached_participation_universe' }))
    .filter(row => spotMarketSnapshotUsable(row, nowMs))
    .map(row => ({ ...row,
      context_state: nowMs - Date.parse(row.observed_at) <= 120_000 ? 'current' : 'delayed',
      age_seconds: Math.floor((nowMs - Date.parse(row.observed_at)) / 1000),
      registry: { ...row.registry, retained_after_trending: true },
    }));
}

export function qualifyDiscoverCandidates(rows, { nowMs = Date.now() } = {}) {
  const tokenKey = row => {
    const chain = String(row.chain_id || row.chain).toLowerCase(), address = String(row.token_address || '');
    return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
  };
  const holderFacts = new Map();
  for (const row of rows) {
    const value = row.market?.holder_count, time = Date.parse(row.observed_at);
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
      || !Number.isFinite(time) || time > nowMs || nowMs - time > 120_000) continue;
    const key = tokenKey(row), prior = holderFacts.get(key);
    if (!prior || time > prior.time) holderFacts.set(key, { value: Number(value), time });
  }
  return rows.map(row => {
    const known = holderFacts.get(tokenKey(row));
    return known ? { ...row, market: { ...row.market, holder_count: known.value } } : row;
  }).filter(row => spotDiscoveryQuality(row, { nowMs }).eligible);
}

// A bounded all-chain response must not spend a chain's entire allowance on
// established trending tokens. Reserve part of each allowance for the other
// browse lanes, then preserve the existing ranking for the remaining places.
// Selection is not a trading signal, and missing evidence never creates a lane.
export function preserveDiscoverCandidateLanes(rows, {
  capacity,
  nowMs = Date.now(),
  isRevivalCandidate = () => false,
} = {}) {
  const quota = Math.min(12, Math.floor(capacity / 8));
  if (!Number.isFinite(quota) || quota < 1 || rows.length <= capacity) return rows;
  const facts = new Map(rows.map(row => {
    const rawAge = row.market?.token_age_seconds ?? row.market?.first_pool_age_seconds ?? row.market?.market_age_seconds;
    const age = rawAge === null || rawAge === undefined || rawAge === '' ? NaN : Number(rawAge);
    return [row, {
      lifecycle: reportedSpotLifecycle(row, nowMs)?.state,
      fresh: spotMarketFactFreshness(row, nowMs).current,
      newToken: Number.isFinite(age) && age >= 0 && age <= 86_400,
    }];
  }));
  const lanes = [
    row => facts.get(row).fresh && facts.get(row).lifecycle === 'BONDING',
    row => facts.get(row).fresh && facts.get(row).lifecycle === 'GRADUATED',
    row => facts.get(row).fresh && facts.get(row).newToken,
    row => facts.get(row).fresh && isRevivalCandidate(row),
  ];
  const selected = new Set();
  for (const matches of lanes) {
    let count = 0;
    for (const row of rows) {
      if (!selected.has(row) && matches(row)) {
        selected.add(row);
        if (++count >= quota) break;
      }
    }
  }
  return [...selected, ...rows.filter(row => !selected.has(row))];
}
