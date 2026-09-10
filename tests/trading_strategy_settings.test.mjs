import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { sha256 } from '../lib/customer_identity.mjs';
import { routeCustomerTradingSettings, createTradingSettingsStore } from '../lib/customer_trading_settings.mjs';
import { defaultTradingSettings, normalizeTradingSettings, normalizeExitStrategy, exitStrategyLevels, evaluateExitStrategy } from '../ravenos-trading-strategy.js';
import { createRavenCopyPolicy } from '../lib/customer_trade/wallet_copy.mjs';
const APP='https://app.ravenos.xyz', NOW=1788800000;
const strategy = () => ({id:'scale_out',name:'Scale out',version:1,rules:[
  {id:'tp1',kind:'take_profit',trigger_pct:80,sell_pct:50},
  {id:'tp2',kind:'take_profit',trigger_pct:150,sell_pct:25},
  {id:'tp3',kind:'take_profit',trigger_pct:300,sell_pct:25},
  {id:'sl1',kind:'stop_loss',trigger_pct:50,sell_pct:100},
]});
test('multi-leg price levels use entry and cap exits by remaining inventory after partial profit',()=>{
  const plan=exitStrategyLevels(strategy(),2);
  assert.deepEqual(plan.rules.filter(r=>r.kind==='take_profit').map(r=>[r.price,r.allocation_bps]),[[3.6,5000],[5,2500],[8,2500]]);
  const first=evaluateExitStrategy(strategy(),{entry_price:2,current_price:3.7,initial_quantity:'101',remaining_quantity:'101'});
  assert.deepEqual(first.rules.map(r=>r.quantity_base_units),['50']);
  const stop=evaluateExitStrategy(strategy(),{entry_price:2,current_price:1,initial_quantity:'101',remaining_quantity:'51',completed_rule_ids:['tp1']});
  assert.deepEqual(stop.rules.map(r=>r.quantity_base_units),['51']);
  assert.equal(stop.authorizes_transaction,false);
});
test('price jumps preserve leg allocation, remove integer dust, and never propose completed or pending legs twice',()=>{
  const whole=evaluateExitStrategy(strategy(),{entry_price:2,current_price:9,initial_quantity:'101',remaining_quantity:'101'});
  assert.deepEqual(whole.rules.map(r=>r.quantity_base_units),['50','25','26']);
  assert.equal(whole.rules.reduce((n,r)=>n+BigInt(r.quantity_base_units),0n),101n);
  assert.deepEqual(evaluateExitStrategy(strategy(),{entry_price:2,current_price:9,initial_quantity:'101',remaining_quantity:'26',completed_rule_ids:['tp1','tp2']}).rules.map(r=>r.rule_id),['tp3']);
  assert.equal(evaluateExitStrategy(strategy(),{entry_price:2,current_price:9,initial_quantity:'101',remaining_quantity:'101',pending_rule_ids:['tp1']}).state,'waiting_for_pending_exit');
  assert.throws(()=>evaluateExitStrategy(strategy(),{entry_price:2,current_price:9,initial_quantity:'100',remaining_quantity:'101'}),/quantity_invalid/);
});
test('strategy validation rejects over-allocation, duplicate triggers, unsafe names and unknown execution authority',()=>{
  const over=strategy();over.rules[1].sell_pct=51;assert.throws(()=>normalizeExitStrategy(over),/total_exceeds_100/);
  const duplicate=strategy();duplicate.rules[1].trigger_pct=80;assert.throws(()=>normalizeExitStrategy(duplicate),/duplicate_trigger/);
  assert.throws(()=>normalizeExitStrategy({...strategy(),name:'<script>'}),/name_invalid/);
  assert.throws(()=>normalizeExitStrategy({...strategy(),auto_execute:true}),/strategy_invalid/);
  assert.throws(()=>exitStrategyLevels(strategy(),null),/entry_price_required/);
  assert.throws(()=>exitStrategyLevels(strategy(),2,{direction:'short'}),/trigger_price_invalid/);
});
test('ticket amounts and named strategy choices validate per chain and never share a mutable policy version',()=>{
  const settings=defaultTradingSettings();settings.strategies=[strategy()];settings.selected_strategy_id='scale_out';
  const saved=normalizeTradingSettings(settings); const policy=createRavenCopyPolicy({exit_strategy:saved.strategies[0]});
  saved.strategies[0].rules.find(r=>r.id==='tp1').trigger_pct=100;
  assert.equal(policy.exit_strategy.rules.find(r=>r.id==='tp1').trigger_pct,80);
  assert.equal(policy.execution_boundary.live_copy_available,false);
  assert.notEqual(policy.policy_hash,createRavenCopyPolicy({exit_strategy:saved.strategies[0]}).policy_hash);
  assert.ok(!Object.hasOwn(createRavenCopyPolicy({}),'exit_strategy'));
  assert.throws(()=>normalizeTradingSettings({...settings,quick_sell_pct:[10,50,50,100]}),/quick_sell/);
  assert.throws(()=>normalizeTradingSettings({...settings,slippage_bps:24}),/slippage/);
  assert.throws(()=>normalizeTradingSettings({...settings,selected_strategy_id:'missing'}),/selection_invalid/);
});
async function fixture(){
 const db=sqliteStore(), sessions=new Map();
 for(const char of ['a','b']){
  const user=`usr_${char.repeat(32)}`;
  db.raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active',?,?,?,?)").run(user,`${char}@example.test`,NOW-1000,NOW-1000,NOW-60);
  sessions.set(await sha256(`ses_${char.repeat(48)}`),{user_id:user,user_state:'active',session_public_id:`session_${char}`,csrf_verifier:await sha256(`csrf_${char.repeat(48)}`),authenticated_at:NOW-60,created_at:NOW-60,last_seen_at:NOW-30,idle_expires_at:NOW+1800,absolute_expires_at:NOW+3600,revoked_at:null});
 }
 const authStore={findSession:async hash=>sessions.get(hash),touchSession:async()=>{},recordEvent:async()=>{},rateLimit:async()=>({allowed:true})};
 const env={RAVENOS_CUSTOMER_ACCOUNTS_ENABLE:'1',RAVENOS_AUTH_ORIGIN:APP,RAVENOS_AUTH_REDIRECT_URI:`${APP}/api/v1/auth/callback`,WORKOS_CLIENT_ID:'client_fixture',WORKOS_API_KEY:'sk_test_not_real',RAVENOS_AUTH_HASH_PEPPER:'fixture_pepper',RAVENOS_CUSTOMER_DB:db};
 const request=(method='GET',body,options={})=>{
  const char=options.user||'a',csrf=`csrf_${char.repeat(48)}`;
  return new Request(`${APP}/api/v1/trading-settings${options.query||''}`,{method,headers:{'content-type':'application/json','origin':options.origin||APP,'sec-fetch-site':'same-origin',cookie:`__Host-ravenos_session=ses_${char.repeat(48)}; __Host-ravenos_csrf=${csrf}`, ...(!options.noCsrf?{'x-ravenos-csrf':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 };
 const call=(method,body,opts)=>routeCustomerTradingSettings(request(method,body,opts),env,{store:authStore,nowMs:NOW*1000});
 return {db,call,store:createTradingSettingsStore(db)};
}
test('account settings persist across devices, isolate owners, enforce CSRF and compare-and-swap revisions',async()=>{
 const f=await fixture();try{
  const initial=await f.call('GET');assert.equal(initial.status,200);assert.equal((await initial.json()).revision,0);
  assert.match(initial.headers.get('cache-control'),/private.*no-store/);
  const settings=defaultTradingSettings();settings.strategies=[strategy()];settings.selected_strategy_id='scale_out';settings.quick_sell_pct=[10,25,50,100];
  assert.equal((await f.call('PUT',{settings,expected_revision:0},{noCsrf:true})).status,403);
  assert.equal((await f.call('PUT',{settings,expected_revision:0},{origin:'https://other.test'})).status,403);
  assert.equal((await f.call('GET',undefined,{query:'?user=b'})).status,403);
  const response=await f.call('PUT',{settings,expected_revision:0});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
  const next=await (await f.call('GET')).json();assert.deepEqual(next.settings.quick_sell_pct,[10,25,50,100]);assert.equal(next.order_activation,false);
  assert.equal((await (await f.call('GET',undefined,{user:'b'})).json()).revision,0);
  const attempts=await Promise.all([f.call('PUT',{settings,expected_revision:1}),f.call('PUT',{settings,expected_revision:1})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.store.get(`usr_${'a'.repeat(32)}`)).revision,2);
 } finally{f.db.raw.close();}
});
test('library edits create server versions without rewriting already-applied Copy policies',async()=>{
 const f=await fixture();try{
  const settings=defaultTradingSettings();settings.strategies=[strategy()];
  let r=await (await f.call('PUT',{settings,expected_revision:0})).json();
  const policy=createRavenCopyPolicy({exit_strategy:r.settings.strategies[0]});
  settings.strategies[0].name='Updated';settings.strategies[0].version=999;
  r=await (await f.call('PUT',{settings,expected_revision:1})).json();
  assert.equal(r.settings.strategies[0].version,2);assert.equal(policy.exit_strategy.version,1);assert.equal(policy.exit_strategy.name,'Scale out');
  const unchanged=await (await f.call('PUT',{settings:r.settings,expected_revision:2})).json();assert.equal(unchanged.settings.strategies[0].version,2);
 }finally{f.db.raw.close();}
});

test('a corrupt stored settings document reports service failure and never becomes a blank replacement',async()=>{
 const f=await fixture();try{
  await f.call('PUT',{settings:defaultTradingSettings(),expected_revision:0});
  f.db.raw.prepare("UPDATE ravenos_customer_trading_settings SET settings_json='{}'").run();
  const response=await f.call('GET');assert.equal(response.status,503);assert.equal((await response.json()).error,'trading_settings_unavailable');
  assert.equal((await f.store.get(`usr_${'a'.repeat(32)}`)).settings_json,'{}');
 }finally{f.db.raw.close();}
});
