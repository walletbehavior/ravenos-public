import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { PUBLIC_WALLET_SNAPSHOT_SCHEMA, validatePublicWalletSnapshot, publicWalletGroupPage, normalizeWalletGroupQuery } from '../lib/customer_trade/wallet_public_cards.mjs';
import { loadPublicWalletCards } from '../lib/ravenos_public_origin.mjs';
const NOW = Date.parse('2026-09-10T15:00:00Z');
const copy = value=>JSON.parse(JSON.stringify(value));
const card = (i,chain='solana',status='recent')=>({ schema_version:1,profile_id:`wallet_${i}`,chain,
  address:chain==='solana'?bs58.encode(Buffer.alloc(32,i+1)):`0x${String(i+1).padStart(40,'0')}`,
  display_name:`Wallet ${i}`,categories:['Patient top holders'],summary:'Private wording must not be forwarded.',data_status:status,actions:['view_profile','open_copy_setup'] });
function fixture() {
  const cards=[card(0),card(1),card(2,'base'),card(3,'solana','historical')];
  return {schema_version:PUBLIC_WALLET_SNAPSHOT_SCHEMA,generated_at:new Date(NOW).toISOString(),cards,
    groups:[{group_id:'group_patient_sol',title:'Patient top holders',chain:'solana',profile_ids:['wallet_0','wallet_1','wallet_3']},
      {group_id:'group_patient_base',title:'Patient top holders',chain:'base',profile_ids:['wallet_2']}]};
}
test('strict wallet snapshot accepts all supported identities without leaking free-form summaries',()=>{
  const result=validatePublicWalletSnapshot(fixture(),{now:NOW});
  assert.equal(result.cards[0].summary,'Tends to remain among a token’s larger holders and hold positions for longer.');
  assert.ok(!JSON.stringify(result).includes('Private wording'));
  assert.deepEqual(result.groups[0].profile_ids,['wallet_0','wallet_1','wallet_3']);
});
test('wallet snapshot rejects extra fields at every boundary and invalid group membership',()=>{
  for(const mutate of [
    p=>{p.receipts={private:true};},p=>{p.cards[0].lineage=['private'];},p=>{p.groups[0].funders=['private'];},
    p=>{p.groups[0].profile_ids.push('wallet_missing');},p=>{p.groups[0].profile_ids.push('wallet_2');},
    p=>{p.groups[0].profile_ids.push('wallet_0');},p=>{p.cards.push(copy(p.cards[0]));},
    p=>{p.cards[1].address=p.cards[0].address;},p=>{p.groups.push(copy(p.groups[0]));},
    p=>{p.generated_at='2026-09-10T16:00:00Z';},p=>{p.generated_at='2026-09-10T14:00:00';},
    p=>{p.cards[0].chain='Solana';},p=>{p.groups[0].title='<script>private</script>';},
  ]) {const value=fixture();mutate(value);assert.throws(()=>validatePublicWalletSnapshot(value,{now:NOW}));}
});
test('a new snapshot keeps old classifications old and an old snapshot cannot retain current labels',()=>{
  const fresh=validatePublicWalletSnapshot(fixture(),{now:NOW});assert.equal(fresh.cards[3].data_status,'historical');
  const older=fixture();older.cards[0].data_status='current';older.generated_at=new Date(NOW-8*86400000).toISOString();
  const result=validatePublicWalletSnapshot(older,{now:NOW});assert.equal(result.cards[0].data_status,'historical');
  assert.equal(result.cards[1].data_status,'historical');
});
test('paging returns only selected group members, derives counts, preserves chain and limits Copy navigation',()=>{
  const query=normalizeWalletGroupQuery(new URLSearchParams('chain=solana&page_size=1&page=2'));
  const result=publicWalletGroupPage(fixture(),query,{now:NOW,copySetup:true});
  assert.deepEqual(result.cards.map(x=>x.profile_id),['wallet_1']);assert.equal(result.groups.length,1);
  assert.equal(result.groups[0].count,2);assert.equal(result.pagination.total,2);
  assert.equal(result.pagination.has_next,false);assert.ok(result.cards[0].actions.includes('open_copy_setup'));
  const base=publicWalletGroupPage(fixture(),normalizeWalletGroupQuery(new URLSearchParams('chain=base')),{now:NOW,copySetup:true});
  assert.deepEqual(base.cards[0].actions,['view_profile']);assert.equal(base.groups[0].count,1);
  const historical=publicWalletGroupPage(fixture(),normalizeWalletGroupQuery(new URLSearchParams('chain=solana&history=all')),{now:NOW});
  assert.equal(historical.pagination.total,3);assert.equal(historical.cards[2].data_status,'historical');
  assert.deepEqual(historical.cards[0].actions,['view_profile']);
});
test('unsupported or empty categories never become fabricated list tabs',()=>{
  const p=fixture();p.cards=p.cards.filter(x=>x.data_status==='historical');p.groups=[{...p.groups[0],profile_ids:['wallet_3']}];
  const result=publicWalletGroupPage(p,normalizeWalletGroupQuery(new URLSearchParams()),{now:NOW});
  assert.equal(result.state,'empty');assert.deepEqual(result.groups,[]);assert.deepEqual(result.cards,[]);
});
test('query parser rejects unbounded, duplicate and private selectors',()=>{
  for(const query of ['chain=base&chain=solana','chain=avalanche','page=-1','page=1.5','page_size=25','group_id=private_id','lineage=abc','history=private'])
    assert.throws(()=>normalizeWalletGroupQuery(new URLSearchParams(query)));
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
