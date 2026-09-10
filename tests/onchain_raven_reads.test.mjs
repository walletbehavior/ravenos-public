import test from 'node:test';
import assert from 'node:assert/strict';
import { retainOnchainReadObservations, deriveOnchainRavenEvidence, buildOnchainRavenReads } from '../lib/onchain_raven_reads.mjs';
import worker from '../worker.mjs';
const addr = n => '0x' + n.toString(16).padStart(40, '0');
const NOW = Date.now();
function row(chain = 'base', at = NOW, price = 1.03) {
  const pool = chain === 'solana' ? '9xQeWvG816bUx9EPfPqpQfdgj7QdQL6MH5z3ExvMNYBp' : chain === 'robinhood' ? '0x' + 'ab'.repeat(32) : addr(1);
  return { instrument_id: `${chain}:pool:${pool}`, pool_address: pool, chain_id: chain, chain,
    token_address: chain === 'solana' ? 'So11111111111111111111111111111111111111112' : addr(2),
    quote_token_address: chain === 'solana' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : addr(3),
    quote_symbol: 'USDC', symbol: 'MEMENT', name: 'Mement', venue: 'pool', source_type: 'market_activity', market_type: 'spot',
    identity_scope: 'exact_pool', observed_at: new Date(at).toISOString(), research_only: true, actionable: false, execution_available: false,
    market: { price_usd: price, market_cap_usd: 2000000, liquidity_usd: 100000, holder_count: 150, market_age_seconds: 172800,
      ...Object.fromEntries(['5m','1h','24h'].flatMap(w => [[`buys_${w}`,80],[`sells_${w}`,20],[`volume_usd_${w}`,15000],[`price_change_${w}_pct`,3]])) } };
}
function observed(chain = 'base') { return retainOnchainReadObservations(row(chain), retainOnchainReadObservations(row(chain, NOW - 60000, 1))); }

test('each supported chain produces a repeatable exact-pool read from measured observations, not provider rank', () => {
  for (const chain of ['solana','base','ethereum','bsc','robinhood']) {
    const current = observed(chain), read = deriveOnchainRavenEvidence(current, { nowMs: NOW, timeframe: '1h' });
    assert(read); assert.equal(read.instrument_id,current.instrument_id); assert.equal(read.timing_lead_seconds,null);
    assert.match(read.why_raven_noticed,/rising price/);assert.match(read.behavioral_evidence[1],/60s apart/);
    assert.deepEqual(deriveOnchainRavenEvidence({...current,provider_rank:9999},{nowMs:NOW,timeframe:'1h'}),read);
    const projection=buildOnchainRavenReads({rows:[current],generated_at:new Date(NOW).toISOString()},{nowMs:NOW,timeframe:'1h'});
    assert.equal(projection.discovery_radar.rows.length,1);assert.equal(projection.discovery_radar.rows[0].discovery.raven_evidence_state.qualified,true);
    assert.equal(projection.discovery_radar.rows[0].raven_observations,undefined);
  }
});

test('one observation, repeated cached observation, stale and future evidence cannot become a current read',()=>{
  const initial=retainOnchainReadObservations(row());
  assert.equal(deriveOnchainRavenEvidence(initial,{nowMs:NOW}),null);
  const repeated=retainOnchainReadObservations(row(),initial);
  assert.equal(repeated.raven_observations.samples.length,1);
  assert.equal(deriveOnchainRavenEvidence(repeated,{nowMs:NOW}),null);
  assert.equal(deriveOnchainRavenEvidence(observed(),{nowMs:NOW+120001}),null);
  assert.equal(deriveOnchainRavenEvidence(observed(),{nowMs:NOW-1}),null);
});

test('a changed token, quote, chain, pool or malformed snapshot never inherits prior observations',()=>{
  const prior=observed();
  for(const key of ['token_address','quote_token_address','pool_address','chain_id']) {
    const next={...row(),[key]:key==='chain_id'?'ethereum':addr(88)};
    assert.equal(deriveOnchainRavenEvidence(retainOnchainReadObservations(next,prior),{nowMs:NOW}),null);
  }
  const bad=observed();bad.raven_observations.samples[0].windows=[[80,20,15000,3]];
  assert.equal(deriveOnchainRavenEvidence(bad,{nowMs:NOW}),null);
});

test('thin pools, one holder, quiet windows and opposite observation directions cannot qualify',()=>{
  for(const change of [{liquidity_usd:1},{holder_count:1},{buys_5m:1,sells_5m:0},{volume_usd_5m:1},{price_change_5m_pct:null}]) {
    const value=observed();Object.assign(value.market,change);assert.equal(deriveOnchainRavenEvidence(value,{nowMs:NOW}),null);
  }
  const value=observed();value.raven_observations.samples[0].windows[0]=[20,80,15000,3];
  assert.equal(deriveOnchainRavenEvidence(value,{nowMs:NOW}),null);
});

test('rolling windows are not summed and separate timeframe reads have distinct lineage',()=>{
  const value=observed(), five=deriveOnchainRavenEvidence(value,{nowMs:NOW,timeframe:'5m'}), hour=deriveOnchainRavenEvidence(value,{nowMs:NOW,timeframe:'1h'});
  assert.notEqual(five.lineage.public_artifact_id,hour.lineage.public_artifact_id);
  assert.match(five.behavioral_evidence[0],/^80 buys \/ 20 sells/);assert.match(five.behavioral_evidence[3],/not added together/);
});

test('Reads endpoint reuses one stored snapshot, preserves requested identity and never fetches a provider',async()=>{
  const snapshot={ok:true,rows:[observed()],generated_at:new Date(NOW).toISOString()};let reads=0;const priorFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('Unexpected network call');};
  const env = { RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '1', RAVENOS_CUSTOMER_DB: {
    prepare(sql) { assert.match(sql, /^SELECT body_json/); return { bind() { return {
      async first() { reads++; return { body_json: JSON.stringify(snapshot) }; }
    }; } }; }
  } };
  try {
    const response=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/reads?duration=1h&instrument_id='+encodeURIComponent(snapshot.rows[0].instrument_id)),env);
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.coverage.qualified_reads,1);assert.equal(body.selected_discovery_market.instrument_id,snapshot.rows[0].instrument_id);assert.equal(reads,1);
    const missing=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/reads?instrument_id='+encodeURIComponent('ethereum:pool:'+addr(1))),env);
    assert.equal((await missing.json()).selected_discovery_market,null);
  }finally{globalThis.fetch=priorFetch;}
});
