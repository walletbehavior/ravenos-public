import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipationMap, buildPerpParticipationMap, matchesParticipationCell, matchesPerpParticipationCell, layoutParticipationTiles, rankParticipationMarkets } from '../ravenos-participation-map.js';
const now = Date.parse('2026-09-09T15:00:00Z');
function spot(i, patch = {}) {
  return { instrument_id: `robinhood:pool:pool${i}`, market_type: 'spot', chain_id: 'robinhood', token_address: `token${i}`, pool_address: `pool${i}`, identity_scope: 'exact_pool', observed_at: new Date(now - 10_000).toISOString(), context_state: 'current',
    market: { market_cap_usd: 800_000, market_age_seconds: 50_000, liquidity_usd: 50_000, price_change_6h_pct: 12, volume_usd_6h: 10_000, ...patch } };
}
test('six-hour breadth uses real fields, not 24-hour change, FDV or text', () => {
  const rows = [spot(1, { price_change_6h_pct: null, price_change_24h_pct: 90 }), spot(2, { market_cap_usd: null, fdv_usd: 800_000 })];
  const map = buildParticipationMap(rows, { now });
  assert.equal(map.cells.length, 1); assert.equal(map.cells[0].sample, 0); assert.equal(map.cells[0].state, 'developing');
});
test('colors and click filters share half-open capitalization boundaries', () => {
  const rows = Array.from({ length: 6 }, (_, i) => spot(i)); rows.push(spot(9, { market_cap_usd: 2_000_000 }));
  const cell = buildParticipationMap(rows, { now }).cells.find(cell => cell.filter.band === '500k_2m');
  assert.equal(cell.state, 'rewarding'); assert.equal(cell.medianReturnPct, 12); assert.equal(cell.observedVolumeUsd, 60_000);
  assert.equal(rows.filter(row => matchesParticipationCell(row, cell.filter, now)).length, 6);
});
test('falling groups are red and split groups orange, a thin group remains neutral', () => {
  for (const [changes, expected] of [[[-2, -4, -3, -2, -1], 'punishing'], [[12, -11, -30, 5, 6], 'fragile'], [[15, 23], 'developing']]) {
    assert.equal(buildParticipationMap(changes.map((move, i) => spot(i, { price_change_6h_pct: move })), { now }).cells[0].state, expected);
  }
});
test('stale snapshots cannot acquire a fresh color just because the board refreshed', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...spot(i), observed_at: new Date(now - 121_000).toISOString() }));
  const cell = buildParticipationMap(rows, { now }).cells[0];
  assert.equal(cell.state, 'stale'); assert.equal(cell.medianReturnPct, null); assert.equal(cell.observedVolumeUsd, null);
});
test('tokens with several pools have one vote and one observed-pool volume', () => {
  const row = spot(1), duplicate = { ...row, pool_address: 'other', instrument_id: 'robinhood:pool:other' };
  const map = buildParticipationMap([row, duplicate], { now }); assert.equal(map.tracked, 1); assert.equal(map.cells[0].observedVolumeUsd, 10_000);
});
test('new pairs use actual pool age; sub-six-hour pairs do not claim a full six-hour return', () => {
  const rows = [spot(1, { market_age_seconds: 300 }), spot(2, { market_age_seconds: 30_000 }), spot(3, { market_age_seconds: 90_000 })];
  const cell = buildParticipationMap(rows, { now, family: 'new_pairs' }).cells[0];
  assert.equal(cell.tracked, 2); assert.equal(cell.sample, 1); assert.equal(rows.filter(row => matchesParticipationCell(row, cell.filter, now)).length, 2);
});
test('missing volume never receives invented area; tiny volumes retain readable buttons', () => {
  const cells = [{ id: 'a', observedVolumeUsd: 100 }, { id: 'b', observedVolumeUsd: 200 }, { id: 'tiny', observedVolumeUsd: 0.0001 }, { id: 'missing', observedVolumeUsd: null }];
  const layout = layoutParticipationTiles(cells, 900, 420);
  const a = layout.tiles.find(tile => tile.cell.id === 'a'), b = layout.tiles.find(tile => tile.cell.id === 'b');
  assert.ok(Math.abs(b.width * b.height / (a.width * a.height) - 2) < 0.000001);
  assert.deepEqual(new Set(layout.overflow.map(cell => cell.id)), new Set(['tiny', 'missing']));
});
test('perps use actual venue return and volume windows and filter exact contracts by OI', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ instrument_id: `hyperliquid:perp:P${i}`, day_change_pct: -3, day_notional_volume_usd: 1000, open_interest_usd: 30_000_000, funding_rate: 0.001 }));
  rows.push(spot(9));
  const map = buildPerpParticipationMap(rows, { now, observedAt: new Date(now).toISOString() });
  assert.equal(map.returnWindow, '24h'); assert.equal(map.volumeWindow, '24h'); assert.equal(map.cells[0].state, 'punishing'); assert.equal(map.cells[0].tracked, 6);
  assert.equal(matchesPerpParticipationCell(spot(9), map.cells[0].filter), false);
  assert.equal(buildParticipationMap(rows, { now }).tracked, 1);
});
test('perp funding groups do not infer trader PnL or fabricate missing timestamps', () => {
  const rows = [{ instrument_id: 'hyperliquid:perp:BTC', funding_rate: -0.01, day_change_pct: 8, day_notional_volume_usd: 5000 }];
  const map = buildPerpParticipationMap(rows, { now, family: 'funding' });
  assert.equal(map.cells[0].state, 'stale'); assert.equal(map.cells[0].filter.band, 'negative'); assert.equal(map.cells[0].sample, 0);
});

test('heatmap drilldown ranks six-hour movers ahead of quiet high-volume tokens and preserves coin identity', () => {
  const filter = { chain: 'robinhood', kind: 'capitalization', band: '500k_2m' };
  const quiet = spot(1, { price_change_6h_pct: 1, price_change_5m_pct: 40, volume_usd_6h: 90000000 });
  const winner = { ...spot(2, { price_change_6h_pct: 85, price_change_5m_pct: 0.2 }), symbol: 'TREE', name: 'Tree', quote_symbol: 'AAPLx' };
  const loser = spot(3, { price_change_6h_pct: -30 });
  const unknown = spot(4, { price_change_6h_pct: null, price_change_24h_pct: 1000 });
  const stock = { ...spot(5, { price_change_6h_pct: 200 }), name: 'Apple xStock' };
  const rows = [quiet, winner, loser, unknown, stock];
  const ranked = rankParticipationMarkets(rows, { filter, now });
  assert.deepEqual(ranked.map(row => row.token_address), ['token2', 'token1', 'token3', 'token4']);
  assert.equal(ranked[0].symbol, 'TREE'); assert.equal(ranked[0].quote_symbol, 'AAPLx');
  assert.equal(rankParticipationMarkets(rows, { filter, now, order: 'decliners' })[0].token_address, 'token3');
  assert.equal(buildParticipationMap(rows, { now }).tracked, 4);
});

test('ZEC cannot inflate memecoin participation or lead its drilldown, while ZEC perps remain', () => {
  const coins = Array.from({ length: 6 }, (_, i) => spot(i));
  const zec = { ...spot(7, { price_change_6h_pct: 900, volume_usd_6h: 900000000 }), symbol: 'ZEC', name: 'Zcash' };
  const map = buildParticipationMap([...coins, zec], { now });
  assert.equal(map.tracked, 6); assert.equal(map.cells[0].medianReturnPct, 12); assert.equal(map.cells[0].observedVolumeUsd, 60000);
  assert.equal(rankParticipationMarkets([...coins, zec], { filter: map.cells[0].filter, now }).length, 6);
  const zecPerp = { instrument_id: 'hyperliquid:perp:ZEC', symbol: 'ZEC', day_change_pct: 20, day_notional_volume_usd: 1000, open_interest_usd: 30000000 };
  assert.equal(buildPerpParticipationMap([zecPerp], { now, observedAt: new Date(now).toISOString() }).tracked, 1);
});
