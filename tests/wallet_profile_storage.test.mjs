import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';

const NOW = 1788836000;
const identity = normalizeSourceWalletChainIdentity({ chain:'solana', network:'mainnet', address:'FU9JQmt6iCaysAnPeK2Zfsdj66mzzHD1xJ83q1CYkBjL' });
async function fixture() {
  const db = sqliteStore(), store = createD1CustomerWalletCopyStore(db);
  await store.upsertSourceWallet({ ...identity, now:NOW });
  const profile = {
    schema_version:'ravenos.solana_wallet_profile.v1', profile_version:6,
    source_wallet:identity, generated_at:new Date(NOW*1000).toISOString(),
    coverage:{ first_observed_at:null, last_observed_at:null, normalized_events:170, known_cost_basis_pct:80 },
    behavior:{ trade_count:101, active_days:10, tokens_traded:28, buy_count:60, sell_count:41 },
    source_performance:{ state:'partial', realized_pnl_sol:'22.231212268', closed_lots:12 },
    discovery_metrics:{ warning_tokens_pct:null }, trading_record:{ tokens:[] },
  };
  return { db, store, profile };
}
function large(profile) {
  // Retained per-token evidence plus metadata is enough to exceed the legacy
  // bound even with only hundreds of events; retain every record exactly.
  profile.trading_record.tokens = Array.from({ length:100 }, (_,i) => ({ token:`mint_${i}`, evidence:'observed '.repeat(100) }));
  profile.holdings_snapshot = { tokens:[{ mint:'fixture', amount:'9007199254740993000000' }] };
  return profile;
}

test('large immutable wallet profiles round-trip without truncating evidence or breaking screener metrics', async () => {
  const { db, store, profile } = await fixture(); large(profile);
  profile.discovery_metrics.warning_tokens_pct = 12;
  profile.wallet_reconstruction = {version:1,opening_balances:{fixture:'9007199254740993000000'}};
  assert(JSON.stringify(profile).length > 65536);
  const id = await store.recordProfile(identity.source_wallet_id, profile, NOW);
  assert.deepEqual(await store.latestProfile(identity.source_wallet_id), profile);
  const inline = JSON.parse(db.raw.prepare('SELECT profile_json FROM ravenos_source_wallet_profiles').get().profile_json);
  assert.equal(inline.discovery_metrics.warning_tokens_pct,12);
  assert.deepEqual(inline.behavior,profile.behavior);
  assert.deepEqual(inline.wallet_reconstruction,{version:1});
  assert(JSON.stringify(inline).length < 65536);
  assert.equal(db.raw.prepare('SELECT profile_snapshot_id FROM ravenos_source_wallet_current_profiles').get().profile_snapshot_id,id);
  await store.recordProfile(identity.source_wallet_id, profile, NOW);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_profile_details').get().n,1);
  assert.throws(() => db.raw.exec("UPDATE ravenos_source_wallet_profile_details SET profile_json='{}'"),/append_only/);
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
  db.raw.close();
});

test('inline historical snapshots remain readable without an auxiliary row', async () => {
  const { db, store, profile } = await fixture();
  await store.recordProfile(identity.source_wallet_id, profile, NOW);
  assert.deepEqual(await store.latestProfile(identity.source_wallet_id),profile);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_profile_details').get().n,0);
  db.raw.close();
});

test('failed detail persistence cannot publish an incomplete profile or replace the last good snapshot', async () => {
  const { db, store, profile } = await fixture();
  await store.recordProfile(identity.source_wallet_id, profile, NOW);
  const previous = structuredClone(profile);
  db.raw.exec("CREATE TRIGGER fail_details BEFORE INSERT ON ravenos_source_wallet_profile_details BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END;");
  await assert.rejects(store.recordProfile(identity.source_wallet_id,large(profile),NOW+1),/test_storage_failure/);
  assert.deepEqual(await store.latestProfile(identity.source_wallet_id),previous);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_profiles').get().n,1);
  db.raw.close();
});

test('profile storage remains bounded in bytes before writing any snapshot', async () => {
  const { db, store, profile } = await fixture();
  profile.token_metadata = { name:'界'.repeat(400000) };
  await assert.rejects(store.recordProfile(identity.source_wallet_id,profile,NOW),/wallet_profile_size_limit/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_profiles').get().n,0);
  db.raw.close();
});
