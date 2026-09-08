import test from 'node:test';
import assert from 'node:assert/strict';
import { compareShieldedRoutes } from '../lib/customer_trade/shielded_route_comparison.mjs';
import { SHIELDED_FLAGS, SHIELDED_BOUNDARY } from '../lib/customer_trade/shielded_reserve.mjs';
import { SHIELDED_ASSETS } from '../lib/customer_trade/shielded_route_providers.mjs';
import { routeCustomerShielded, createShieldedQuoteCache } from '../lib/customer_shielded_routes.mjs';
const now = Date.now(), env = Object.fromEntries(SHIELDED_FLAGS.map(k => [k, '1']));
const input = { source: 'base_usdc', destination: 'solana_usdc', usd_micros: '500000000' };
function fixture() {
  const calls = [];
  const catalog = Object.values(SHIELDED_ASSETS).map(a => ({ assetId: a.id, blockchain: a.chain, decimals: a.decimals, symbol: a.symbol, contractAddress: a.contract, price: a.symbol === 'ZEC' ? '100' : '1', priceUpdatedAt: new Date(now).toISOString() }));
  const provider = { id: 'near_1click', tokens: async () => catalog, quote: async i => {
    calls.push(i); const returning = i.action === 'SHIELDED_RETURN', direct = i.action === 'STANDARD_COMPARE';
    return { available: true, source: i.source, destination: i.destination, amount_in_atomic: i.amount_atomic, amount_out_atomic: returning ? '498765432' : direct ? '499000000' : '497000000', input_usd_micros: '500000000', output_usd_micros: returning ? '498765432' : direct ? '499000000' : '497000000', destination_amount: returning ? '4.98765432' : direct ? '499' : '497', estimated_settlement_seconds: returning ? 150 : direct ? 32 : 452, research_expires_at: new Date(now + 30000).toISOString(), trust: { provider_signature_verified: true }, boundary: SHIELDED_BOUNDARY };
  } };
  return { calls, catalog, provider, env, now: () => now };
}
test('comparison uses identical source amounts, then exact expected ZEC output without USD rerounding', async () => {
  const f = fixture(), r = await compareShieldedRoutes(input, f);
  assert.equal(r.available, true); assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(i => i.action), ['STANDARD_COMPARE', 'SHIELDED_RETURN', 'SHIELDED_DEPLOY']);
  assert.equal(f.calls[0].amount_atomic, f.calls[1].amount_atomic);
  assert.equal(f.calls[2].amount_atomic, '498765432');
  assert.equal(r.reserve.all_in_marked_friction_ppm, '6000');
  assert.equal(r.destination_output_difference_atomic, '-2000000');
  assert.equal(r.reserve.provider_time_sum_seconds, 602);
  assert.equal(r.reserve.total_settlement_seconds, null);
  assert.equal(r.combined_minimum_output_atomic, null);
  assert.equal(r.privacy_classification, 'UNKNOWN'); assert.equal(r.atomic_route, false);
  assert.equal(r.boundary.live_execution_enabled, false); assert.ok(r.comparison_hash);
});
test('off-peg source USDC uses provider valuation and equal atomic input on both paths', async () => {
  const f = fixture(); f.catalog.find(a => a.assetId === SHIELDED_ASSETS.base_usdc.id).price = '0.8';
  const r = await compareShieldedRoutes(input, f); assert.equal(r.source_amount_atomic, '625000000');
  assert.equal(f.calls[0].amount_atomic, f.calls[1].amount_atomic);
});
test('unsupported/same/venue chains and disabled action flags never request quotes', async () => {
  for (const patch of [{ source: 'base_eth' }, { source: 'hyperliquid_usdc' }, { destination: 'robinhood_usdc' }, { destination: 'base_usdc' }]) {
    const f = fixture(); await assert.rejects(compareShieldedRoutes({ ...input, ...patch }, f)); assert.equal(f.calls.length, 0);
  }
  for (const key of ['SHIELDED_DEPLOY_ENABLED', 'SHIELDED_RETURN_ENABLED', 'ZCASH_ENABLED']) {
    const f = fixture(); await assert.rejects(compareShieldedRoutes(input, { ...f, env: { ...env, [key]: '0' } })); assert.equal(f.calls.length, 0);
  }
});
test('missing canonical asset and stale reference fail closed before quote I/O', async () => {
  const f = fixture(); f.catalog = f.catalog.filter(t => t.assetId !== SHIELDED_ASSETS.zec.id);
  assert.equal((await compareShieldedRoutes(input, f)).reason, 'unsupported_chain_or_asset'); assert.equal(f.calls.length, 0);
  const stale = fixture(); stale.now = () => now + 700000;
  assert.equal((await compareShieldedRoutes(input, stale)).reason, 'price_stale_or_unavailable'); assert.equal(stale.calls.length, 0);
});
test('any failed leg stops the sequence and does not become a successful comparison', async () => {
  for (const [index, leg] of ['direct', 'return', 'deploy'].entries()) {
    const f = fixture(), original = f.provider.quote; let count = 0;
    f.provider.quote = async i => count++ === index ? { available: false, reason: 'provider_quote_rejected' } : original(i);
    const r = await compareShieldedRoutes(input, f); assert.equal(r.available, false); assert.equal(r.failed_leg, leg); assert.equal(count, index + 1);
  }
});
test('first quote expiry is respected after later legs finish', async () => {
  const f = fixture(), original = f.provider.quote; let time = now;
  f.now = () => time; f.provider.quote = async i => { const r = await original(i); time += 11000; return r; };
  assert.equal((await compareShieldedRoutes(input, f)).reason, 'comparison_expired');
});
test('unverified signatures or unequal funding cannot produce a comparison', async () => {
  for (const patch of [{ trust: { provider_signature_verified: false } }, { amount_in_atomic: '1' }]) {
    const f = fixture(), original = f.provider.quote;
    f.provider.quote = async i => ({ ...await original(i), ...(i.action === 'SHIELDED_DEPLOY' ? patch : {}) });
    assert.equal((await compareShieldedRoutes(input, f)).reason, 'comparison_evidence_mismatch');
  }
});
const req = (body = { source: 'base_usdc', destination: 'solana_usdc', amount_usd: '500' }) => new Request('https://app.ravenos.xyz/api/v1/portfolio/shielded/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function apiFixture() {
  const f = fixture(), policies = [], limits = [];
  return { f, policies, limits, deps: { ...f, nowMs: now, cache: createShieldedQuoteCache(), authorizeRequest: async (r,e,d,p) => { policies.push(p); return { principal: { user_id: 'pro' }, now: now/1000, store: {} }; }, readAccess: async () => ({ pro: true }), rateLimit: async p => { limits.push(p); return { allowed: true }; } } };
}
test('authenticated comparison enforces CSRF, Pro, separate cost limit and cached single flight', async () => {
  const { f, deps, policies, limits } = apiFixture();
  const responses = await Promise.all([routeCustomerShielded(req(), env, deps), routeCustomerShielded(req(), env, deps)]);
  assert.equal((await responses[0].json()).comparison.available, true); assert.equal((await responses[1].json()).cached, true);
  assert.equal(f.calls.length, 3); assert.equal(policies.every(p => p.require_csrf), true);
  assert.equal(limits.filter(p => p.action === 'shielded_comparison' && p.limit === 2).length, 2);
  const denied = await routeCustomerShielded(req(), env, { ...deps, readAccess: async () => ({ pro: false }) }); assert.equal(denied.status, 403);
});
test('comparison cannot accept destinations, secrets or arbitrary fee settings', async () => {
  for (const patch of [{ destination_wallet: 'private' }, { viewing_key: 'uview1sensitive' }, { dry: false }, { raven_fee: 100 }, { amount_usd: '50000.01' }]) {
    const { f, deps } = apiFixture(); const r = await routeCustomerShielded(req({ source: 'base_usdc', destination: 'solana_usdc', amount_usd: '500', ...patch }), env, deps);
    assert.equal(r.status, 400); assert.equal(f.calls.length, 0);
  }
});
test('comparison rate cap and provider exceptions fail closed with controlled errors', async () => {
  const { f, deps } = apiFixture(); deps.rateLimit = async p => ({ allowed: p.action !== 'shielded_comparison' });
  assert.equal((await routeCustomerShielded(req(), env, deps)).status, 429); assert.equal(f.calls.length, 0);
  const b = apiFixture(); b.f.provider.quote = async () => { throw Error('private provider payload'); };
  const r = await routeCustomerShielded(req(), env, b.deps); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /private provider payload/);
});
