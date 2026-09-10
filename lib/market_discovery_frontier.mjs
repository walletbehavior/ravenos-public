// Public token identities and refresh progress, never customer/wallet data.
export const MARKET_FRONTIER_POLICY = Object.freeze({
  tokens_per_chain: 10_000, retention_ms: 7 * 86_400_000,
  maximum_pair_batches: 140, tokens_per_request: 30,
  hot_tokens_per_chain: 240, maximum_tokens_per_chain: 1_800,
  discovery_pages_per_chain: 4, failure_retry_ms: 60_000, empty_retry_ms: 30 * 60_000,
});
export const MARKET_FRONTIER_CHAINS = Object.freeze(['solana', 'robinhood', 'bsc', 'base', 'ethereum']);
const p = MARKET_FRONTIER_POLICY;
export function marketTokenKey(chain, address) {
  if (!MARKET_FRONTIER_CHAINS.includes(chain) || !(chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(address || '')) return null;
  return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
}
const value = n => n !== null && n !== '' && Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : null;

export function openMarketFrontier(saved = {}, nowMs = Date.now()) {
  const tokens = new Map(), cursors = {};
  for (const chain of MARKET_FRONTIER_CHAINS) {
    const data = saved[chain] || {};
    for (const a of (Array.isArray(data.tokens) ? data.tokens : []).slice(0, p.tokens_per_chain)) {
      const id = marketTokenKey(chain, a[0]);
      if (!id || !Number.isFinite(a[1]) || nowMs - a[1] > p.retention_ms || a[1] > nowMs) continue;
      tokens.set(id, { chain, address: id.slice(chain.length + 1), seen_at: a[1], attempted_at: value(a[2]) || 0,
        retry_at: value(a[3]) || 0, volume: value(a[4]) || 0, holders: value(a[5]), holders_at: value(a[6]) || 0 });
    }
    if (typeof data.cursor === 'string' && /^[A-Za-z0-9_=+\/-]{1,512}$/.test(data.cursor)) cursors[chain] = data.cursor;
  }
  return { tokens, cursors };
}

export function rememberFrontierTokens(frontier, rows = [], nowMs = Date.now()) {
  for (const row of rows) {
    const chain = row.chain_id || row.chain, id = marketTokenKey(chain, row.token_address || row.address);
    if (!id) continue;
    const prior = frontier.tokens.get(id), market = row.market || {};
    const observed = Date.parse(row.observed_at || row.provenance?.retrieved_at || '');
    const seen = Number.isFinite(observed) && observed <= nowMs ? observed : nowMs;
    const volume = value(market.volume_usd_24h ?? row.volume24h ?? row.stats24h?.buyVolume);
    const holders = value(market.holder_count ?? row.holderCount);
    frontier.tokens.set(id, { chain, address: id.slice(chain.length + 1), seen_at: Math.max(seen, prior?.seen_at || 0),
      attempted_at: prior?.attempted_at || 0, retry_at: prior?.retry_at || 0,
      volume: volume ?? prior?.volume ?? 0, holders: holders ?? prior?.holders ?? null,
      holders_at: holders === null ? prior?.holders_at || 0 : seen });
  }
}

// Fair batches across chains, with a hot set plus an oldest-attempted rotation.
// No viewer causes extra requests, and a large chain cannot starve a small one.
export function planFrontierRefresh(frontier, nowMs = Date.now()) {
  const lanes = new Map();
  for (const chain of MARKET_FRONTIER_CHAINS) {
    const all = [...frontier.tokens.values()].filter(t => t.chain === chain && t.retry_at <= nowMs
      && !(t.holders !== null && t.holders < 10 && nowMs - t.holders_at < 300_000));
    const hot = [...all].sort((a, b) => b.volume - a.volume || a.attempted_at - b.attempted_at || a.address.localeCompare(b.address)).slice(0, p.hot_tokens_per_chain);
    const ids = new Set(hot.map(t => t.address));
    const rotation = all.filter(t => !ids.has(t.address)).sort((a, b) => a.attempted_at - b.attempted_at || b.seen_at - a.seen_at || a.address.localeCompare(b.address));
    const ordered = [...hot, ...rotation].slice(0, p.maximum_tokens_per_chain), batches = [];
    for (let i = 0; i < ordered.length; i += p.tokens_per_request) batches.push({ chain, addresses: ordered.slice(i, i + p.tokens_per_request).map(t => t.address) });
    lanes.set(chain, batches);
  }
  const jobs = [];
  while (jobs.length < p.maximum_pair_batches && [...lanes.values()].some(a => a.length)) {
    for (const chain of MARKET_FRONTIER_CHAINS) {
      const job = lanes.get(chain).shift();
      if (job) jobs.push(job);
      if (jobs.length === p.maximum_pair_batches) break;
    }
  }
  return jobs;
}

export function recordFrontierAttempt(frontier, chain, addresses, { succeeded, observed = [], nowMs = Date.now() }) {
  const found = new Set(observed.map(row => marketTokenKey(row.chain_id || row.chain, row.token_address)));
  for (const address of addresses) {
    const id = marketTokenKey(chain, address), token = frontier.tokens.get(id);
    if (!token) continue;
    token.attempted_at = nowMs;
    token.retry_at = succeeded ? found.has(id) ? 0 : nowMs + p.empty_retry_ms : nowMs + p.failure_retry_ms;
  }
}

export function packMarketFrontier(frontier) {
  return Object.fromEntries(MARKET_FRONTIER_CHAINS.map(chain => {
    const tokens = [...frontier.tokens.values()].filter(t => t.chain === chain)
      .sort((a, b) => b.seen_at - a.seen_at || b.volume - a.volume || a.address.localeCompare(b.address)).slice(0, p.tokens_per_chain);
    return [chain, { version: 1, cursor: frontier.cursors[chain] || null,
      tokens: tokens.map(t => [t.address, t.seen_at, t.attempted_at, t.retry_at, t.volume, t.holders, t.holders_at]) }];
  }));
}
