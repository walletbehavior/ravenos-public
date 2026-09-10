import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCapitalPlan,decimalUnits,unitsLabel} from '../ravenos-capital-plan.js';
const now=Date.parse('2026-09-10T05:00:00Z');
const snapshot=()=>({diagnostics:{observation_state:'complete'},buying_power:{state:'available',observed_at:new Date(now).toISOString(),assets:[{symbol:'SOL',asset_id:'native',decimals:9,spendable_before_network_fees:'0.150197288'},{symbol:'USDC',canonical_usdc:true,decimals:6,amount:'1000.000001',spendable_before_network_fees:'25.000001'}]},summary:{state:'available',marked_value_state:'current',marked_portfolio_value_minor:'100000000',unresolved_unknown_value_count:0},economic_exposure:{assets:[{identity:'solana:SOL',marked_value_minor:'70000000'},{identity:'solana:USDC',marked_value_minor:'30000000'}]}});
test('draft planning uses spendable units, preserves precision, and never treats targets as automatic orders',()=>{
 const source=snapshot(),before=JSON.stringify(source);
 const plan=calculateCapitalPlan(source,{usdc:'20',sol:'0.01',concentration:'50'},now);
 assert.equal(plan.state,'draft');assert.match(plan.rows[0].title,/5\.000001 USDC above/);assert.match(plan.rows[1].title,/0\.140197288 SOL above/);assert.match(plan.rows[2].detail,/70%.*50%/);
 assert.equal(JSON.stringify(source),before);assert.equal(plan.transaction,undefined);
});
test('unavailable and expired balances cannot become a zero or a current proposal',()=>{
 const p=snapshot();p.buying_power.assets[1].spendable_before_network_fees=null;
 assert.match(calculateCapitalPlan(p,{usdc:'20'},now).rows[0].detail,/unavailable/);
 assert.equal(calculateCapitalPlan(p,{usdc:'20'},now+120001).state,'refresh_required');
 p.buying_power.observed_at=null;assert.equal(calculateCapitalPlan(p,{},now).state,'refresh_required');
});
test('partial or truncated exposure never produces a false within-limit result',()=>{
 for(const kind of ['partial','missing','truncated','missing_observation','stale_mark']){
  const p=snapshot();if(kind==='partial')p.summary.marked_value_state='partial';if(kind==='missing')p.economic_exposure.assets.pop();if(kind==='truncated')p.diagnostics.exposure_rows={asset:{truncated:true}};if(kind==='missing_observation')p.diagnostics.observation_state='partial';if(kind==='stale_mark')p.summary.stale_value_minor='1';
  const result=calculateCapitalPlan(p,{concentration:'90'},now);assert.match(result.rows[0].title,/needs complete/);
 }
});
test('draft inputs reject ambiguous numbers and keep very large integer balances exact',()=>{
 for(const value of ['-1','1e3','NaN','0.0000001','01','Infinity'])assert.equal(decimalUnits(value,6),null);
 assert.equal(decimalUnits('999999999999999999.123456',6),999999999999999999123456n);
 assert.equal(unitsLabel(123n,0),'123');assert.equal(calculateCapitalPlan(snapshot(),{},now).rows[0].title,'Set your own targets');
 assert.match(calculateCapitalPlan(snapshot(),{concentration:'101'},now).rows[0].title,/Check/);
});
