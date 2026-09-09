import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveDiscoverCandidateLanes } from '../lib/discover_candidate_lanes.mjs';

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
