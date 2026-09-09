const ORIGIN = 'https://api.dexscreener.com';
const CHAINS = new Set(['solana', 'base', 'ethereum', 'bsc', 'robinhood']);
const valid = (chain, address) => CHAINS.has(chain) && (chain === 'solana'
  ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(address || '');

// Official public endpoints only. Meta membership and profile promotion seed
// identities; neither supplies a Raven signal or bypasses market qualification.
export async function collectDexScreenerDiscoverySeeds(read, { nowMs = Date.now() } = {}) {
  let requests = 0;
  const request = async path => { requests += 1; return read(`${ORIGIN}${path}`, { ttlMs: 300_000 }); };
  const paths = ['/token-profiles/latest/v1', '/token-profiles/recent-updates/v1', '/community-takeovers/latest/v1', '/metas/trending/v1'];
  const results = await Promise.allSettled(paths.map(request));
  const tokens = new Map(), failed = [];
  const add = (chain, address) => {
    if (valid(chain, address)) tokens.set(`${chain}:${chain === 'solana' ? address : address.toLowerCase()}`, { chain, token_address: address });
  };
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') { failed.push(paths[i]); return; }
    if (i < 3) for (const row of (Array.isArray(result.value) ? result.value : []).slice(0, 100)) add(row.chainId, row.tokenAddress);
  });
  const metas = results[3].status === 'fulfilled' && Array.isArray(results[3].value) ? results[3].value : [];
  const slugs = [...new Set(metas.map(meta => meta.slug).filter(slug => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)))].slice(0, 100);
  // Rotate bounded pages through all categories; previously seen tokens remain
  // in Raven's shared snapshot. Avoid another visitor-dependent provider fanout.
  const offset = slugs.length ? Math.floor(nowMs / 300_000) * 12 % slugs.length : 0;
  const chosen = [...slugs.slice(offset), ...slugs.slice(0, offset)].slice(0, 12);
  for (let i = 0; i < chosen.length; i += 4) {
    const pages = await Promise.allSettled(chosen.slice(i, i + 4).map(slug => request(`/metas/meta/v1/${slug}`)));
    pages.forEach((page, j) => {
      if (page.status !== 'fulfilled') { failed.push(`meta:${chosen[i + j]}`); return; }
      for (const pair of (page.value?.pairs || []).slice(0, 300)) add(pair.chainId, pair.baseToken?.address);
    });
  }
  return { rows: [...tokens.values()], request_count: requests, failed_lanes: failed,
    categories_sampled: chosen.length, complete_chain_census: false };
}
