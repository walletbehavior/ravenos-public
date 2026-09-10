import { test, expect } from '@playwright/test';
import { mockTerminalLiveApis } from './terminal-live-fixtures.mjs';
import { buildDiscoverRadarProjection } from '../../lib/discover_radar.mjs';

test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'wait' }));
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
