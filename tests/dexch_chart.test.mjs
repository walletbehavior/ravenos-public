import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDexchChart } from '../lib/dexch_chart.mjs';
const NOW = Date.parse('2026-09-09T12:00:30Z');
const address = n => '0x' + n.toString(16).padStart(40, '0');
function fixture() {
  const time = Math.floor(NOW/60000)*60;
  return {chain:'bsc',pairAddress:address(1),tokenAddress:address(2),quoteAddress:address(3),asset:'TOKEN',timeframe:'1m',now:NOW,
    token:{chain:'bsc',address:address(2),canonical_identity:{decimals:18},venue:{pool_address:address(1),quote_token_address:address(3),quote_decimals:18,dex_id:'pancakeswap'},lifecycle:{migrated_at:new Date((time-120)*1000).toISOString()}},
    pair:{chainId:'bsc',pairAddress:address(1),baseToken:{address:address(2)},quoteToken:{address:address(3)},pairCreatedAt:(time-180)*1000,liquidity:{usd:10000}},
    envelope:{chain:'bsc',token_address:address(2),timeframe:'1m',provenance:{retrieved_at:new Date(NOW).toISOString()},rows:[-180,-120,-60,0].map(offset=>({time:time+offset,open:1,high:3,low:1,close:2,volume:100}))}};
}

test('Dexch charts keep only post-migration candles with explicit provider lineage and no invented backfill',()=>{
  const result=buildDexchChart(fixture());
  assert.equal(result.candles.length,3);assert.equal(result.continuity.identity.state,'verified');
  assert.equal(result.lineage.token_scoped_history,true);assert.equal(result.derivation.interpolation_used,false);
  assert.equal(result.capabilities.older_bar_backfill,false);assert.equal(result.instrument.identity_scope,'exact_pool');
  assert.equal(result.lineage.provider,'Dexch');assert.equal(result.last_candle_age_seconds,30);
  assert.equal(result.provider_usage.provider_request_count,null);
});

test('unknown pools, quote assets, chain, token or interval cannot be relabeled to the selected market',()=>{
  for(const mutate of [f=>{f.pair.pairAddress=address(9)},f=>{f.pair.quoteToken.address=address(9)},f=>{f.token.venue.pool_address=address(9)},f=>{f.envelope.chain='base'},f=>{f.envelope.token_address=address(9)},f=>{f.envelope.timeframe='5m'},f=>{f.pair=undefined}]) {
    const f=fixture();mutate(f);assert.throws(()=>buildDexchChart(f),/identity_mismatch/);
  }
});

test('malformed or misaligned candles fail while valid sparse bars retain honest gaps',()=>{
  for(const mutate of [f=>{f.envelope.rows[2].high=0.5},f=>{f.envelope.rows[2].time++},f=>{f.envelope.rows.push({...f.envelope.rows[2],close:3})}]) {
    const f=fixture();mutate(f);assert.throws(()=>buildDexchChart(f),/continuity_rejected/);
  }
  const f=fixture();f.envelope.rows.splice(2,1);const result=buildDexchChart(f);
  assert.equal(result.candles.length,2);assert.equal(result.continuity.candles.missing_source_buckets,1);assert.equal(result.derivation.missing_buckets_filled,0);
});

test('unknown pool history boundary fails and stale bars are displayed as delayed',()=>{
  const unknown=fixture();delete unknown.pair.pairCreatedAt;delete unknown.token.lifecycle.migrated_at;
  assert.throws(()=>buildDexchChart(unknown),/boundary_unavailable/);
  const f=fixture();f.now=NOW+300000;
  const result=buildDexchChart(f);assert.equal(result.freshness_state,'delayed');assert.equal(result.age_seconds,300);
});
