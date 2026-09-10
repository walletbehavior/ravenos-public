import { readFileSync } from 'node:fs';
import { normalizeWalletScreenerRequest, WalletScreenerPresets } from '../lib/customer_trade/wallet_screener.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_WALLET_CATEGORIES, publicWalletCard, publicWalletGroups, validatePublicWalletCard } from '../lib/customer_trade/wallet_public_cards.mjs';
import { publicWalletResponse } from '../lib/customer_trade/wallet_public_delivery.mjs';
const NOW=Date.parse('2026-09-10T14:00:00Z'), LAST=new Date(NOW-3600000).toISOString();
const source=(chain='base')=>({chain,network:'mainnet',address:chain==='solana'?'11111111111111111111111111111111':`0x${'a'.repeat(40)}`});
function profile(chain='base') {return {source_wallet:source(chain),generated_at:new Date(NOW).toISOString(),
  behavior:{first_trade_at:'2026-09-01T00:00:00Z',last_trade_at:LAST,trade_count:50,active_days:6,median_hold_seconds:100000},
  source_performance:{realized_pnl_usdc:'-10',realized_pnl_sol:null,closed_lots:4,roi_pct:-2},
  trading_record:{periods:{h24:{realized_pnl:{usdc:'-10'},buy_count:3}},tokens:[]},
  holdings_snapshot:{state:'available',observed_at:LAST,native:{amount_base_units:'100',amount:'0.0000001'},tokens:[{mint:'public_token',symbol:'TEST',balance_display:'42'}]}};}
const secret='PRIVATE_SENTINEL_DO_NOT_PUBLISH';
test('descriptive styles do not depend on positive PnL and support multiple public labels per chain',()=>{
 for(const chain of ['solana','base','ethereum','bsc','robinhood']){
  const card=publicWalletCard(profile(chain),{now:NOW,copySetup:true});
  assert.deepEqual(card.categories,['Regular trading','Longer holds']);
  assert.equal(card.data_status,'current');assert.equal(card.actions.includes('open_copy_setup'),chain==='solana');
 }
 assert.equal(PUBLIC_WALLET_CATEGORIES.length,19);
 const p=profile();p.sniper=true;p.alpha_score=99;p.behavior.median_hold_seconds=null;
 assert.ok(!publicWalletCard(p,{now:NOW}).categories.includes('Early launch participation'));
});
test('a fresh onchain refresh cannot freshen the historical Core classification or propagate it across EVM chains',()=>{
 const core=publicWalletCard(profile(),{now:NOW});core.data_status='historical';core.categories=['Accumulating','Ecosystem specialist','Recurring trading group'];core.summary='Historical profile: tends to build positions gradually.';
 const card=publicWalletCard(profile(),{now:NOW,coreCard:core});assert.equal(card.data_status,'historical');assert.deepEqual(card.categories,core.categories);
 assert.throws(()=>publicWalletCard(profile('ethereum'),{now:NOW,coreCard:core}),/identity_mismatch/);
 assert.throws(()=>validatePublicWalletCard({...core,private_funding_edges:[secret]}),/card_invalid/);
 assert.throws(()=>validatePublicWalletCard({...core,categories:['Insider']}),/card_invalid/);
});
test('unknown/future chronology cannot supply a style or profitable-record claim',()=>{
 for(const patch of [{first_trade_at:null},{last_trade_at:'2026-10-01T00:00:00Z'}]){
  const p=profile();Object.assign(p.behavior,patch);p.source_performance.realized_pnl_usdc='999';p.source_performance.closed_lots=50;
  assert.deepEqual(publicWalletCard(p,{now:NOW}).categories,[]);
 }
 const p=profile();p.behavior.last_trade_at='2026-08-10T00:00:00Z';p.behavior.first_trade_at='2026-08-01T00:00:00Z';
 assert.equal(publicWalletCard(p,{now:NOW}).data_status,'historical');
});
test('public grouping retains chain identity and hides source family identifiers and membership explanations',()=>{
 const a=publicWalletCard(profile('base'),{now:NOW}),b=publicWalletCard(profile('ethereum'),{now:NOW});
 const groups=publicWalletGroups([a,b,a]);assert.equal(groups.length,4);
 assert.ok(groups.every(row=>/^group_[a-f0-9]{24}$/.test(row.group_id)&&row.profile_ids.length===1));
 assert.deepEqual(Object.keys(groups[0]).sort(),['chain','group_id','profile_ids','title']);
});
test('profile delivery keeps public amounts and event times but cannot serialize private research inputs',()=>{
 const p=profile();p.lineage={secret};p.funding_lineage={secret};p.research_thesis={headline:secret};
 p.behavior.mechanical_pattern_evidence={secret};p.source_performance.internal_score=secret;p.trading_record.incoming_transfers=[{from:secret}];
 p.trading_record.periods.h24.private_rule=secret;p.holdings_snapshot.tokens[0].private_funding_source=secret;p.private_wallet_intelligence={secret};
 const output=publicWalletResponse({ok:true,profile:p,prospective_copyability:{secret},private_source_dump:{secret},activation:{shadow_copy:false}}, {now:NOW});
 assert.ok(!JSON.stringify(output).includes(secret));assert.equal(output.profile.behavior.last_trade_at,LAST);
 assert.equal(output.profile.trading_record.periods.h24.realized_pnl.usdc,'-10');assert.equal(output.profile.holdings_snapshot.tokens[0].balance_display,'42');
 assert.equal(output.profile.holdings_snapshot.native.amount_base_units,'100');
 assert.equal(output.prospective_copyability,undefined);assert.equal(output.profile.research_thesis,undefined);
});
test('screener delivery strips internal predicates, rank scores and source-list provenance, including nested added fields',()=>{
 const p=profile();const row={...p,source_wallet_id:'sw_base_'+'a'.repeat(40),profile:{generated_at:p.generated_at},research_thesis:{summary:secret},why_surfaced:[secret],follower_reality:{score:99,secret},profit_quality:{secret}};
 const output=publicWalletResponse({ok:true,schema_version:'ravenos.wallet_screener.v1',rows:[row],query:{clauses:[secret]},presets:[{id:'example',label:'Trading style',clauses:[secret]}],seen_wallets:{rows:[{source_wallet:source(),source_wallet_id:row.source_wallet_id,history_available:true,discovery_sources:[secret],market_evidence:{secret}}],total:1}},{now:NOW});
 assert.ok(!JSON.stringify(output).includes(secret));assert.equal(output.query,undefined);assert.equal(output.rows[0].follower_reality,undefined);
 assert.equal(output.seen_wallets.rows[0].source_wallet.chain,'base');assert.equal(output.seen_wallets.rows[0].history_available,true);
 assert.deepEqual(output.rows[0].public_summary.categories,['Regular trading','Longer holds']);
});
test('ordinary timestamped trade detail survives while decoder rationale and private availability clocks do not',()=>{
 const event={event_id:'public_tx',source_wallet:source('solana'),classification:{kind:'SWAP_BUY',reasons:[secret]},timing:{raven_received_at:secret},
 chain_evidence:{block_time:LAST,signature:'public_signature',provider:secret},economic:{source_asset:{mint:'USDC',amount_base_units:'1000000',decimals:6,private_hint:secret}}};
 const output=publicWalletResponse({ok:true,events:[event],copyability:[secret],relationships:[secret]});
 assert.ok(!JSON.stringify(output).includes(secret));assert.equal(output.events[0].economic.source_asset.amount_base_units,'1000000');assert.equal(output.events[0].chain_evidence.block_time,LAST);
});

test('patient top-holder classification requires a qualified private profile, never a balance-only fallback',()=>{
 const candidate={...profile(),top_holder:true,average_hold_seconds:20000};
 assert.ok(!publicWalletCard(candidate,{now:NOW}).categories.includes('Patient top holders'));
 const core=publicWalletCard(candidate,{now:NOW});core.categories=['Patient top holders'];core.summary='Tends to remain among a token’s larger holders and hold positions for longer.';core.data_status='historical';
 assert.deepEqual(publicWalletCard(candidate,{now:NOW,coreCard:core}).categories,['Patient top holders']);
 assert.equal(publicWalletCard(candidate,{now:NOW,coreCard:core}).data_status,'historical');
});

test('public wallet data preserves dated balances, history gaps, distributions and separate EVM currencies',()=>{
 const p=profile();p.balances_observed_at=null;p.durable_history={unresolved_references:3,private_input:secret};
 p.trading_record={periods:{d30:{observations:5,distribution:[{label:'0% to 100%',count:5,private:secret}],realized_pnl:{eth:'0.3',usdc:'100'}}},basis_labels:{eth:'ETH',usdc:'USDC'}};
 p.source_performance={closed_lots:5,realized_pnl_by_basis:{eth:'0.3'}};
 const projected=publicWalletResponse({ok:true,profile:p},{now:NOW});
 assert.equal(projected.profile.balances_observed_at,null);
 assert.deepEqual(projected.profile.durable_history,{unresolved_references:3});
 assert.deepEqual(projected.profile.trading_record.periods.d30.distribution,[{label:'0% to 100%',count:5}]);
 assert.deepEqual(projected.profile.trading_record.periods.d30.realized_pnl,{usdc:'100',eth:'0.3'});
 assert.ok(projected.profile.public_summary.categories.includes('Positions with recorded profits'));
 assert.ok(!JSON.stringify(projected).includes(secret));
});

test('public list names resolve only on the server and browser assets omit private research controls',()=>{
 const request=normalizeWalletScreenerRequest({preset:'recorded_profits'},{now:NOW});
 assert.equal(request.preset.id,'consistent_winners');
 const output=publicWalletResponse({schema_version:'ravenos.wallet_screener.v1',rows:[],presets:Object.values(WalletScreenerPresets),query:request});
 assert.ok(output.presets.some(row=>row.id==='recorded_profits'));
 assert.ok(!JSON.stringify(output).includes('consistent_winners'));
 for(const path of ['../account/copy/index.html','../ravenos-wallet-copy.js']){
  const text=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(text,/funding_lineage|research_thesis|reconstruction_confidence_pct|mechanical_pattern_state|median_lead_seconds|follower_capture_ratio_pct|evidence_first|consistent_winners/);
 }
});
