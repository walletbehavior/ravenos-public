import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { PUBLIC_WALLET_SNAPSHOT_SCHEMA, validatePublicWalletSnapshot, publicWalletGroupPage, normalizeWalletGroupQuery } from '../lib/customer_trade/wallet_public_cards.mjs';
import { loadPublicWalletCards } from '../lib/ravenos_public_origin.mjs';
const NOW = Date.parse('2026-09-10T15:00:00Z');
const copy = value=>JSON.parse(JSON.stringify(value));
const card = (i,chain='solana',status='recent')=>({ schema_version:2,expires_at:new Date(NOW+3600000).toISOString(),profile_id:`wallet_${i}`,chain,
  address:chain==='solana'?bs58.encode(Buffer.alloc(32,i+1)):`0x${String(i+1).padStart(40,'0')}`,
  display_name:`Wallet ${i}`,categories:['Patient top holders'],summary:'Private wording must not be forwarded.',data_status:status,actions:['view_profile','open_copy_setup'] });
function fixture() {
  const cards=[...Array.from({length:12},(_,i)=>card(i)),...Array.from({length:10},(_,i)=>card(i+12,'base')),card(22,'solana','historical')];
  return {schema_version:PUBLIC_WALLET_SNAPSHOT_SCHEMA,generated_at:new Date(NOW).toISOString(),cards,
    groups:[{group_id:'group_patient_sol',title:'Patient top holders',chain:'solana',profile_ids:cards.filter(c=>c.chain==='solana').map(c=>c.profile_id)},
      {group_id:'group_patient_base',title:'Patient top holders',chain:'base',profile_ids:cards.filter(c=>c.chain==='base').map(c=>c.profile_id)},
      {group_id:'group_patient_all',title:'Patient top holders',chain:'all',profile_ids:cards.map(c=>c.profile_id)}]};
}
test('strict wallet snapshot accepts all supported identities without leaking free-form summaries',()=>{
  const result=validatePublicWalletSnapshot(fixture(),{now:NOW});
  assert.equal(result.cards[0].summary,'Tends to remain among a token’s larger holders and hold positions for longer.');
  assert.ok(!JSON.stringify(result).includes('Private wording'));
  assert.equal(result.groups[0].profile_ids.length,13);
});
test('wallet snapshot rejects extra fields at every boundary and invalid group membership',()=>{
  for(const mutate of [
    p=>{p.receipts={private:true};},p=>{p.cards[0].lineage=['private'];},p=>{p.groups[0].funders=['private'];},
    p=>{p.groups[0].profile_ids.push('wallet_missing');},p=>{p.groups[0].profile_ids.push('wallet_12');},
    p=>{p.groups[0].profile_ids.push('wallet_0');},p=>{p.cards.push(copy(p.cards[0]));},
    p=>{p.cards[1].address=p.cards[0].address;},p=>{p.groups.push(copy(p.groups[0]));},
    p=>{p.generated_at='2026-09-10T16:00:00Z';},p=>{p.generated_at='2026-09-10T14:00:00';},
    p=>{p.cards[0].chain='Solana';},p=>{delete p.cards[0].expires_at;},p=>{p.cards[0].expires_at='2026-09-11T00:00:00';},p=>{p.cards[0].expires_at='2026-02-30T00:00:00Z';},p=>{p.cards[0].schema_version=1;},p=>{p.groups[0].title='<script>private</script>';},
  ]) {const value=fixture();mutate(value);assert.throws(()=>validatePublicWalletSnapshot(value,{now:NOW}));}
});
test('a new snapshot keeps old classifications old and an old snapshot cannot retain current labels',()=>{
  const fresh=validatePublicWalletSnapshot(fixture(),{now:NOW});assert.equal(fresh.cards[22].data_status,'historical');
  const older=fixture();older.cards[0].data_status='current';older.generated_at=new Date(NOW-8*86400000).toISOString();
  const result=validatePublicWalletSnapshot(older,{now:NOW});assert.equal(result.cards[0].data_status,'historical');
  assert.equal(result.cards[1].data_status,'historical');
});
test('paging returns only selected group members, derives counts, preserves chain and limits Copy navigation',()=>{
  const query=normalizeWalletGroupQuery(new URLSearchParams('chain=solana&page_size=1&page=2'));
  const result=publicWalletGroupPage(fixture(),query,{now:NOW,copySetup:true});
  assert.deepEqual(result.cards.map(x=>x.profile_id),['wallet_1']);assert.equal(result.groups.length,1);
  assert.equal(result.groups[0].count,12);assert.equal(result.pagination.total,12);
  assert.equal(result.pagination.has_next,true);assert.ok(result.cards[0].actions.includes('open_copy_setup'));
  const base=publicWalletGroupPage(fixture(),normalizeWalletGroupQuery(new URLSearchParams('chain=base')),{now:NOW,copySetup:true});
  assert.deepEqual(base.cards[0].actions,['view_profile']);assert.equal(base.groups[0].count,10);
  const historical=publicWalletGroupPage(fixture(),normalizeWalletGroupQuery(new URLSearchParams('chain=solana&history=all&page_size=24')),{now:NOW});
  assert.equal(historical.pagination.total,13);assert.equal(historical.cards[12].data_status,'historical');
  assert.deepEqual(historical.cards[0].actions,['view_profile']);
});
test('unsupported or empty categories never become fabricated list tabs',()=>{
  const p=fixture();p.cards=p.cards.filter(x=>x.data_status==='historical');p.groups=[{...p.groups[0],profile_ids:['wallet_22']}];
  const result=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams()),{now:NOW});
  assert.equal(result.state,'empty');assert.deepEqual(result.groups,[]);assert.deepEqual(result.cards,[]);
});
test('query parser rejects unbounded, duplicate and private selectors',()=>{
  for(const query of ['chain=base&chain=solana','chain=avalanche','page=-1','page=1.5','page_size=25','group_id=private_id','lineage=abc','history=private'])
    assert.throws(()=>normalizeWalletGroupQuery(new URLSearchParams(query)));
});
test('daily groups require ten qualified members and cap the producer order at fifty',()=>{
  const p=fixture();p.cards=Array.from({length:64},(_,i)=>card(i));
  p.groups=[{group_id:'group_patient_all',title:'Patient top holders',chain:'all',profile_ids:p.cards.map(c=>c.profile_id).reverse()}];
  const page=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams('page=5')),{now:NOW});
  assert.equal(page.groups[0].count,50);assert.equal(page.pagination.total,50);
  assert.deepEqual(page.cards.map(c=>c.profile_id),['wallet_15','wallet_14']);
  p.groups[0].profile_ids=p.groups[0].profile_ids.slice(0,9);
  const building=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams()),{now:NOW});
  assert.equal(building.state,'building');assert.deepEqual(building.groups,[]);assert.deepEqual(building.cards,[]);
  p.groups[0].profile_ids.push('wallet_1');
  assert.equal(publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams()),{now:NOW}).pagination.total,10);
});
test('overall groups reach the target without inventing a per-chain ranking or membership',()=>{
  const p=fixture();p.groups[0].profile_ids=p.groups[0].profile_ids.slice(0,9);
  const overall=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams()),{now:NOW});
  assert.equal(overall.groups.length,1);assert.equal(overall.groups[0].chain,'all');assert.equal(overall.pagination.total,22);
  const chain=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams('chain=solana')),{now:NOW});
  assert.equal(chain.state,'building');assert.deepEqual(chain.cards,[]);
});
test('expiry removes members from a cached snapshot and never silently changes a selected category',()=>{
  const p=fixture();p.groups[0].profile_ids=p.groups[0].profile_ids.slice(0,10);p.cards[0].expires_at=new Date(NOW+1000).toISOString();
  const query=normalizeWalletGroupQuery(new URLSearchParams('chain=solana&group_id=group_patient_sol'));
  const before=publicWalletGroupPage(p,query,{now:NOW});assert.equal(before.pagination.total,10);assert.equal(before.valid_until,p.cards[0].expires_at);
  const expired=publicWalletGroupPage(p,query,{now:NOW+1000});
  assert.equal(expired.state,'building');assert.equal(expired.selected_group_id,'group_patient_sol');assert.deepEqual(expired.cards,[]);
  const archive=publicWalletGroupPage(p,{...query,history:'all'},{now:NOW+1000});
  assert.equal(archive.cards[0].data_status,'historical');assert.equal(archive.cards[0].expires_at,p.cards[0].expires_at);
  const removed=publicWalletGroupPage(p,{...query,chain:'all',group_id:'group_missing'},{now:NOW});
  assert.equal(removed.selected_group_id,'group_missing');assert.equal(removed.selected_group,null);assert.deepEqual(removed.cards,[]);
});
test('publication age closes daily lists without renewing the original wallet validity deadline',()=>{
  const p=fixture(),query=normalizeWalletGroupQuery(new URLSearchParams());
  const before=publicWalletGroupPage(p,query,{now:NOW+299999});assert.equal(before.state,'available');
  const stale=publicWalletGroupPage(p,query,{now:NOW+300000});assert.equal(stale.state,'stale');assert.deepEqual(stale.cards,[]);
  p.cards[0].expires_at=new Date(NOW+1000).toISOString();p.generated_at=new Date(NOW+2000).toISOString();
  const published=publicWalletGroupPage(p,query,{now:NOW+2000});assert.equal(published.pagination.total,21);
  assert.ok(!published.cards.some(c=>c.profile_id==='wallet_0'));
});
const env={RAVENOS_PUBLIC_ORIGIN_URL:'https://origin.example/public/ravenos',RAVENOS_PUBLIC_ORIGIN_TOKEN:'server-only-test-token'};
const response=payload=>new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
test('wallet origin uses a bounded shared read, keeps the token server-side and invalidates on rotation',async()=>{
  const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return response(fixture());};
  const results=await Promise.all([loadPublicWalletCards({env,fetchImpl,nowMs:NOW}),loadPublicWalletCards({env,fetchImpl,nowMs:NOW})]);
  assert.equal(calls.length,1);assert.equal(results[0].available,true);assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.headers['x-ravenos-public-token'],env.RAVENOS_PUBLIC_ORIGIN_TOKEN);
  assert.match(calls[0].url,/\/wallet_cards\.json\?projection=2$/);
  assert.ok(!JSON.stringify(results).includes('server-only-test-token'));
  await loadPublicWalletCards({env:{...env,RAVENOS_PUBLIC_ORIGIN_TOKEN:'rotated'},fetchImpl,nowMs:NOW});assert.equal(calls.length,2);
  await loadPublicWalletCards({env,fetchImpl,nowMs:NOW+60_001});assert.equal(calls.length,3);
});
test('invalid, oversized and redirected wallet documents fail without exposing their contents',async()=>{
  for(const fetchImpl of [async()=>new Response('private',{status:302,headers:{location:'https://elsewhere.example'}}),
    async()=>response({...fixture(),private_record:'do-not-expose'}),
    async()=>new Response('private',{headers:{'content-type':'application/json','content-length':String(9*1024*1024)}})]) {
    const result=await loadPublicWalletCards({env,fetchImpl,nowMs:NOW});
    assert.deepEqual(result,{available:false,payload:null,reason:'wallet_groups_unavailable'});
  }
  let calls=0;const result=await loadPublicWalletCards({env:{},fetchImpl:async()=>{calls++;},nowMs:NOW});
  assert.equal(result.available,false);assert.equal(calls,0);
});
