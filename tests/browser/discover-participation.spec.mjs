import { test, expect } from '@playwright/test';
import { mockTerminalLiveApis } from './terminal-live-fixtures.mjs';
import { buildDiscoverRadarProjection } from '../../lib/discover_radar.mjs';
import { buildParticipationMap } from '../../ravenos-participation-map.js';

test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'wait' }));
for (const chain of ['solana', 'base']) test(`${chain}: green group opens the coins with largest 6h gains, including stock-paired memes`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  const now = Date.now(), observed = new Date(now).toISOString();
  await page.clock.install({ time: new Date(now) });
  const rows = [1, 85, 44, 5, 12, 3].map((change, index) => ({
    instrument_id: `${chain}:pool:pool${index}`, market_type: 'spot', source_type: 'market_activity', chain_id: chain, chain,
    pool_address: `pool${index}`, token_address: `coin${index}`, quote_token_address: 'stock-address', quote_symbol: 'AAPLx',
    symbol: index === 1 ? 'TREE' : `COIN${index}`, name: index === 1 ? 'Tree' : `Coin ${index}`, identity_scope: 'exact_pool', venue: 'Fixture',
    observed_at: observed, context_state: 'current', market: { price_usd: 0.1, market_cap_usd: 20000000, liquidity_usd: 500000,
      market_age_seconds: 864000, price_change_6h_pct: change, price_change_5m_pct: 0.2, price_change_1h_pct: 1,
      volume_usd_6h: index === 0 ? 9999999 : 100000, volume_usd_5m: 20000, buys_6h: 150, sells_6h: 50, buys_5m: 40, sells_5m: 20 },
  }));
  rows.push({ ...rows[0], instrument_id: `${chain}:pool:stockpool`, pool_address: 'stockpool', token_address: 'stock-address', name: 'Apple xStock', symbol: 'AAPLx' });
  const radar = buildDiscoverRadarProjection(rows, { timeframe: '5m', generatedAt: observed, nowMs: now, sourceState: 'current' });
  // Older server/browser snapshots can still contain a leading ZEC row. The
  // client must apply the new market boundary even before the cache refreshes.
  const legacyRows = [{ ...radar.rows[0], instrument_id: `${chain}:pool:zecpool`, pool_address: 'zecpool', token_address: 'zec-token', symbol: 'ZEC', name: 'Zcash' }, ...radar.rows];
  await page.route('**/api/onchain/trending?**', route => route.fulfill({ json: {
    ok: true, safe_public: true, schema_version: 'ravenos.onchain_market_pulse.v1', state: 'current', freshness: { state: 'current' },
    rows: legacyRows, discovery_radar: { ...radar, rows: legacyRows }, provenance: { role: 'exact_pool_market_activity', raven_signal: false },
    execution_boundary: { research_only: true, signing_available: false, submission_available: false },
  } }));
  const groupRequests = [];
  await page.route('**/api/onchain/participation**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('chain')) { groupRequests.push(url); return route.fulfill({ json: {
      ok: true, safe_public: true, schema_version: 'ravenos.participation_group.v1', rows: legacyRows,
    } }); }
    return route.fulfill({ json: { ok: true, safe_public: true, schema_version: 'ravenos.participation_boards.v1',
      boards: { capitalization: buildParticipationMap(rows, { now }), new_pairs: buildParticipationMap(rows, { now, family: 'new_pairs' }) } } });
  });
  await page.goto('/discover/?market_scope=memecoins');
  const cell = page.locator(`[data-participation-cell="${chain}:10m_plus"]`).first();
  await expect(cell).toContainText('Rewarding');
  await cell.click();
  await expect(page.locator('#discoverSpotPulseTitle')).toHaveText('Top 6h movers');
  const coins = page.locator('#discoverTokenTapeList .discover-token-row');
  await expect(coins).toHaveCount(6);
  await expect(coins.first()).toHaveAttribute('data-token-address', 'coin1');
  await expect(coins.first().locator('.discover-token-move > strong')).toContainText('85.00%');
  await expect(coins.first().locator('.discover-token-move-context')).toContainText('6h move');
  await expect(coins.first().locator('.discover-token-anatomy')).toContainText('6h Vol');
  await expect(coins.first().locator('.discover-token-anatomy')).toContainText('$100K');
  await expect(coins.first().locator('.discover-token-anatomy')).toContainText('200');
  const href = new URL(await coins.first().getAttribute('href'), 'https://ravenos.xyz');
  expect(href.searchParams.get('token_address')).toBe('coin1');
  expect(href.searchParams.get('quote_address')).toBe('stock-address');
  expect(href.searchParams.get('asset')).toBe('TREE/AAPLx');
  expect(groupRequests[0].searchParams.get('order')).toBe('gainers');
  await expect(page.locator('#discoverTokenTapeList [data-token-address="stock-address"]')).toHaveCount(0);
  await expect(page.locator('#discoverTokenTapeList [data-token-address="zec-token"]')).toHaveCount(0);
  await page.clock.fastForward(125_000);
  await expect(coins).toHaveCount(6);
  await expect(coins.first()).toHaveAttribute('data-freshness', 'stale');
  await expect(coins.first()).toContainText('Refreshing quote');
  await expect(coins.first()).not.toContainText('+85.00%');
  await page.locator('#discoverParticipationClear').click();
  await expect(page.locator('#discoverSpotPulseTitle')).not.toHaveText('Top 6h movers');
});
