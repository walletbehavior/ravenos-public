import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveDiscoverCandidateLanes, cachedDiscoverCandidates, qualifyDiscoverCandidates } from '../lib/discover_candidate_lanes.mjs';
import { buildDiscoverRadarProjection } from '../lib/discover_radar.mjs';
import { spotMarketFactFreshness, spotMarketSnapshotUsable } from '../ravenos-discover-intelligence.js';

const nowMs = Date.now();
function row(id, state, age = 200_000) {
  return {
    instrument_id: id, chain_id: 'solana', token_address: id,
    observed_at: new Date(nowMs).toISOString(), context_state: 'current',
    market: { token_age_seconds: age },
    lifecycle_evidence: state ? {
      schema_version: 'ravenos.token_lifecycle.v1', provider: 'jupiter',
      evidence_class: 'JUPITER_REPORTED', chain_id: 'solana:mainnet-beta',
      token_address: id, state, observed_at: new Date(nowMs).toISOString(),
      raven_verified: false, execution_authority: false, quality: { contradictions: [] },
    } : undefined,
  };
}

test('five-chain capacity retains bonding, migrated, new and revival candidates behind established trends', () => {
  const groups = [
    Array.from({ length: 60 }, (_, i) => row(`trending${i}`)),
    Array.from({ length: 42 }, (_, i) => row(`bonding${i}`, 'BONDING')),
    Array.from({ length: 14 }, (_, i) => row(`migrated${i}`, 'GRADUATED')),
    Array.from({ length: 12 }, (_, i) => row(`new${i}`, null, 300)),
    Array.from({ length: 12 }, (_, i) => row(`revival${i}`)),
  ];
  const original = groups.flat();
  const ordered = preserveDiscoverCandidateLanes(original, {
    capacity: 240 / 5, nowMs, isRevivalCandidate: r => r.instrument_id.startsWith('revival'),
  });
  const selected = ordered.slice(0, 48);
  for (const prefix of ['bonding', 'migrated', 'new', 'revival']) {
    assert.equal(selected.filter(r => r.instrument_id.startsWith(prefix)).length, 6);
  }
  assert.equal(selected.filter(r => r.instrument_id.startsWith('trending')).length, 24);
  assert.equal(new Set(ordered).size, original.length);
  assert.deepEqual(original, groups.flat(), 'does not mutate provider ranking');
});

test('stale, contradictory and unknown lifecycle evidence cannot consume reserved places', () => {
  const trends = Array.from({ length: 60 }, (_, i) => row(`t${i}`));
  const stale = row('stale', 'BONDING');
  stale.observed_at = stale.lifecycle_evidence.observed_at = new Date(nowMs - 130_000).toISOString();
  const unknown = row('unknown', 'UNKNOWN');
  const contradiction = row('contradiction', 'BONDING');
  contradiction.lifecycle_evidence.quality.contradictions.push('conflicting_state');
  const rows = [...trends, stale, unknown, contradiction];
  assert.deepEqual(preserveDiscoverCandidateLanes(rows, { capacity: 48, nowMs }).slice(0, 48), trends.slice(0, 48));
  assert.deepEqual(preserveDiscoverCandidateLanes(rows, { capacity: 240, nowMs }), rows);
});

test('recent cached markets remain browsable while their signals expire and bad pools remain excluded', () => {
  const make = (index, age) => ({ instrument_id: `base:pool:pool${index}`, chain_id: 'base', market_type: 'spot',
    identity_scope: 'exact_pool', pool_address: `pool${index}`, token_address: `token${index}`, quote_token_address: 'quote',
    symbol: `COIN${index}`, observed_at: new Date(nowMs - age).toISOString(), context_state: 'current',
    market: { price_usd: 1, liquidity_usd: 10000, holder_count: 25, volume_usd_5m: 2000, price_change_5m_pct: 10, buys_5m: 25, sells_5m: 10 } });
  const original = [make(0, 30000), make(1, 180000), make(2, 601000), make(3, -1000),
    { ...make(4, 180000), market: { ...make(4, 180000).market, liquidity_usd: 0 } },
    { ...make(5, 180000), chain_id: 'ethereum' }];
  const cached = cachedDiscoverCandidates(original, ['base'], nowMs);
  assert.equal(cached.length, 3);
  assert.equal(cached[1].observed_at, original[1].observed_at);
  assert.equal(cached[1].context_state, 'delayed');
  assert.equal(spotMarketSnapshotUsable(cached[1], nowMs), true);
  assert.equal(spotMarketFactFreshness(cached[1], nowMs).current, false);
  const qualified = qualifyDiscoverCandidates(cached, { nowMs });
  assert.equal(qualified.length, 2);
  const radar = buildDiscoverRadarProjection(qualified, { generatedAt: new Date(nowMs).toISOString(), nowMs });
  assert.equal(radar.rows.length, 2);
  const stale = radar.rows.find(row => row.token_address === 'token1');
  assert.equal(stale.discovery.facts.freshness.state, 'stale');
  assert.equal(stale.discovery.notability.default_opportunity_eligible, false);
  assert.equal(stale.discovery.raven_evidence_state.qualified, false);
  assert.equal(stale.market.price_usd, 1);
  assert.equal(spotMarketSnapshotUsable(stale, nowMs + 421000), false);
  assert.equal(original[1].registry, undefined, 'cached projection never mutates retained observations');
});
