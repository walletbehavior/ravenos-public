import { test, expect } from '@playwright/test';
import { mockTerminalLiveApis } from './terminal-live-fixtures.mjs';
import { buildDiscoverRadarProjection } from '../../lib/discover_radar.mjs';

test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'wait' }));

function broadPulse(chain = 'base', count = 151) {
  const now = Date.now(), observed = new Date(now).toISOString();
  const rows = Array.from({ length: count }, (_, index) => ({
    instrument_id: `${chain}:pool:${chain}${index}`, market_type: 'spot', source_type: 'market_activity', chain_id: chain, chain,
    research_only: true, actionable: false, execution_available: false,
    pool_address: `${chain}${index}`, token_address: `${chain}-coin${index}`, quote_token_address: 'quote', quote_symbol: 'ETH',
    symbol: `${chain.toUpperCase()}${index}`, name: `Meme ${index}`, identity_scope: 'exact_pool', venue: 'Fixture', observed_at: observed, context_state: 'current',
    market: { price_usd: .1, market_cap_usd: 500000, liquidity_usd: 100000, holder_count: 100,
      market_age_seconds: 864000, price_change_5m_pct: index + 1, volume_usd_5m: 10000, buys_5m: 40, sells_5m: 20 },
  }));
  const radar = buildDiscoverRadarProjection(rows, { nowMs: now, generatedAt: observed, maxRows: 4000 });
  return { ok: true, safe_public: true, schema_version: 'ravenos.onchain_market_pulse.v1', state: 'current', generated_at: observed,
    freshness: { state: 'current' }, rows: radar.rows, discovery_radar: radar, universe: { sampled_tokens: count },
    provenance: { role: 'exact_pool_market_activity', raven_signal: false },
    execution_boundary: { research_only: true, signing_available: false, submission_available: false } };
}

test('onchain results render before unrelated stalled feeds and their deadlines release Refresh', async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.clock.install({ time: new Date() });
  const stalled = [];
  for (const path of ['opportunity', 'atlas', 'atlas/featured?limit=40', 'hyperliquid/perps', 'brief']) {
    await page.route(`**/api/${path}`, route => { stalled.push(route); });
  }
  await page.route('**/api/onchain/trending?**', route => route.fulfill({ json: broadPulse() }));
  try {
    await page.goto('/discover/?market_scope=memecoins');
    await expect(page.locator('#discoverTokenTapeList .discover-token-row')).toHaveCount(100, { timeout: 2000 });
    await expect(page.locator('#discoverSpotResultState')).toContainText('of 151 qualifying');
    await expect(page.locator('#discoverRefresh')).toHaveText('Refreshing…');
    await page.clock.fastForward(12_100);
    await expect(page.locator('#discoverRefresh')).toHaveText('Refresh now');
    await expect(page.locator('#discoverSpotResultState')).toContainText('of 151 qualifying');
  } finally { await Promise.all(stalled.map(route => route.abort().catch(() => {}))); }
});

test('a failed market refresh retains the broad sample and page while observations age normally', async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.clock.install({ time: new Date() });
  let outage = false;
  await page.route('**/api/onchain/trending?**', route => route.fulfill(outage
    ? { status: 503, json: { ok: false } } : { json: broadPulse() }));
  await page.goto('/discover/?market_scope=memecoins');
  await expect(page.locator('#discoverSpotResultState')).toContainText('of 151 qualifying');
  await page.locator('#discoverSpotNext').click();
  const rows = page.locator('#discoverTokenTapeList .discover-token-row');
  await expect(rows).toHaveCount(51);
  const identities = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.tokenAddress));
  outage = true;
  await page.locator('#discoverRefresh').click();
  await expect(page.locator('#discoverRefresh')).toHaveText('Refresh now');
  await expect(page.locator('#discoverSpotResultState')).toContainText('101–151 of 151');
  expect(await rows.evaluateAll(nodes => nodes.map(node => node.dataset.tokenAddress))).toEqual(identities);
  await page.clock.fastForward(180000);
  await expect(rows).toHaveCount(51);
  await expect(rows.first()).toHaveAttribute('data-freshness', 'stale');
  await expect(rows.first().locator('.discover-token-move > strong')).not.toHaveClass(/positive|negative/);
  await page.clock.fastForward(421000);
  await expect(rows).toHaveCount(0);
});

test('changing chain cancels an older request without waiting for it or showing its late rows', async ({ page }) => {
  await mockTerminalLiveApis(page);
  const pendingBase = [], requested = [];
  await page.route('**/api/onchain/trending?**', route => {
    const chain = new URL(route.request().url()).searchParams.get('chains'); requested.push(chain);
    if (chain === 'base') { pendingBase.push(route); return; }
    return route.fulfill({ json: broadPulse(chain === 'ethereum' ? 'ethereum' : 'base', chain === 'ethereum' ? 70 : 151) });
  });
  try {
    await page.goto('/discover/?market_scope=memecoins');
    await expect(page.locator('#discoverSpotResultState')).toContainText('of 151 qualifying');
    await page.locator('[data-spot-chain="base"]').click();
    await expect.poll(() => pendingBase.length).toBe(1);
    await page.locator('[data-spot-chain="ethereum"]').click();
    const rows = page.locator('#discoverTokenTapeList .discover-token-row');
    await expect(rows).toHaveCount(70, { timeout: 2000 });
    await Promise.all(pendingBase.splice(0).map(route => route.fulfill({ json: broadPulse('base', 175) }).catch(() => {})));
    await expect(rows).toHaveCount(70);
    await expect(page.locator('#discoverSpotResultState')).toContainText('1–70 of 70');
    expect(await rows.evaluateAll(nodes => nodes.every(node => node.dataset.tokenAddress.startsWith('ethereum-')))).toBe(true);
    expect(requested).toContain('base'); expect(requested).toContain('ethereum');
  } finally { await Promise.all(pendingBase.map(route => route.abort().catch(() => {}))); }
});

for (const width of [390, 1440]) test(`${width}px: broad Discovery paginates qualified tokens and filters the complete loaded universe`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mockTerminalLiveApis(page);
  const now = Date.now(), observed = new Date(now).toISOString();
  const rows = Array.from({ length: 321 }, (_, i) => {
    const chain = i < 251 ? 'base' : 'ethereum';
    return { instrument_id: `${chain}:pool:pool${i}`, market_type: 'spot', source_type: 'market_activity', chain_id: chain, chain,
      research_only: true, actionable: false, execution_available: false,
      pool_address: `pool${i}`, token_address: `coin${i}`, quote_token_address: 'quote-address', quote_symbol: 'ETH',
      symbol: `MEME${i}`, name: `Meme ${i}`, identity_scope: 'exact_pool', venue: 'Fixture', observed_at: observed, context_state: 'current',
      market: { price_usd: .1, market_cap_usd: 1000000, liquidity_usd: 100000, holder_count: 100,
        market_age_seconds: 864000, price_change_5m_pct: i + 1, volume_usd_5m: 10000, buys_5m: 40, sells_5m: 20 } };
  });
  rows.push({ ...rows[0], instrument_id: 'base:pool:oneholder', pool_address: 'oneholder', token_address: 'bad-holder', symbol: 'ONEHOLDER', market: { ...rows[0].market, holder_count: 1 } });
  rows.push({ ...rows[0], instrument_id: 'base:pool:dust', pool_address: 'dust', token_address: 'dust', symbol: 'DUST', market: { ...rows[0].market, liquidity_usd: 1 } });
  const radar = buildDiscoverRadarProjection(rows, { nowMs: now, generatedAt: observed, maxRows: 4000 });
  const requestedChains = [];
  await page.route('**/api/onchain/trending?**', route => {
    const chain = new URL(route.request().url()).searchParams.get('chains'); requestedChains.push(chain);
    const selected = chain === 'base' || chain === 'ethereum' ? radar.rows.filter(row => row.chain_id === chain) : radar.rows.slice(0, 150);
    return route.fulfill({ json: {
    ok: true, safe_public: true, schema_version: 'ravenos.onchain_market_pulse.v1', state: 'current', freshness: { state: 'current' },
    rows: selected, discovery_radar: { ...radar, rows: selected, row_count: selected.length }, universe: { sampled_tokens: 1900 }, provenance: { role: 'exact_pool_market_activity', raven_signal: false },
    execution_boundary: { research_only: true, signing_available: false, submission_available: false },
  } }); });
  await page.goto('/discover/?market_scope=memecoins');
  await page.locator('[data-spot-chain="base"]').click();
  const coins = page.locator('#discoverTokenTapeList .discover-token-row');
  await expect(coins).toHaveCount(100);
  await expect(page.locator('#discoverSpotResultState')).toContainText('1–100 of 251 qualifying');
  await expect(page.locator('#discoverSpotResultState')).toContainText('1,900 in shared market sample');
  await expect(page.locator('#discoverSpotPrevious')).toBeDisabled();
  const firstPage = await coins.evaluateAll(nodes => nodes.map(node => node.dataset.tokenAddress));
  await page.locator('#discoverSpotNext').click();
  await expect(page.locator('#discoverSpotResultState')).toContainText('101–200 of 251');
  const secondPage = await coins.evaluateAll(nodes => nodes.map(node => node.dataset.tokenAddress));
  expect(secondPage.some(address => firstPage.includes(address))).toBe(false);
  await page.locator('#discoverSpotNext').click();
  await expect(coins).toHaveCount(51);
  await expect(page.locator('#discoverSpotNext')).toBeDisabled();
  await expect(page.locator('#discoverSpotResultState')).toContainText('201–251 of 251');
  await page.locator('[data-spot-chain="ethereum"]').click();
  await expect(coins).toHaveCount(70);
  await expect(page.locator('#discoverSpotResultState')).toContainText('1–70 of 70');
  expect(requestedChains).toContain('base');
  expect(requestedChains).toContain('ethereum');
  await expect(page.locator('#discoverSpotPagination')).toBeHidden();
  await expect(page.locator('[data-token-address="bad-holder"], [data-token-address="dust"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test('cached quotes remain usable snapshots through a short outage without becoming live signals', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  const now = Date.now(), observed = new Date(now).toISOString();
  await page.clock.install({ time: new Date(now) });
  const row = { instrument_id: 'base:pool:cached', market_type: 'spot', chain_id: 'base', chain: 'base',
    research_only: true, actionable: false, execution_available: false,
    pool_address: 'cached', token_address: 'snapshot-coin', quote_token_address: 'quote', quote_symbol: 'ETH',
    symbol: 'SNAPCOIN', name: 'Snapshot coin', identity_scope: 'exact_pool', source_type: 'market_activity',
    discovery_source: 'cached_participation_universe', observed_at: observed, context_state: 'current',
    registry: { retained_after_trending: true },
    market: { price_usd: .5, market_cap_usd: 500000, liquidity_usd: 100000, holder_count: 300,
      price_change_5m_pct: 12, volume_usd_5m: 12000, buys_5m: 50, sells_5m: 20 } };
  const radar = buildDiscoverRadarProjection([row], { nowMs: now, generatedAt: observed });
  await page.route('**/api/onchain/trending?**', route => route.fulfill({ json: {
    ok: true, safe_public: true, schema_version: 'ravenos.onchain_market_pulse.v1', state: 'current',
    freshness: { state: 'current' }, rows: radar.rows, discovery_radar: radar,
    provenance: { role: 'exact_pool_market_activity', raven_signal: false },
    execution_boundary: { research_only: true, signing_available: false, submission_available: false },
  } }));
  await page.goto('/discover/?market_scope=memecoins');
  const coin = page.locator('[data-token-address="snapshot-coin"].discover-token-row');
  await expect(coin).toBeVisible();
  await page.clock.fastForward(180000);
  await expect(coin).toBeVisible();
  await expect(coin).toHaveAttribute('data-freshness', 'stale');
  await expect(coin).toContainText('Recent market snapshot');
  await expect(coin.locator('.discover-token-move')).toContainText('$0.5');
  await expect(coin.locator('.discover-token-move-context')).toContainText('snapshot');
  await expect(coin.locator('.discover-token-anatomy')).toContainText('$100K');
  await expect(coin.locator('.discover-token-move > strong')).not.toHaveClass(/positive|negative/);
  await expect(coin).toHaveAttribute('data-route-current', 'false');
  await page.clock.fastForward(421000);
  await expect(coin).toHaveCount(0);
});
