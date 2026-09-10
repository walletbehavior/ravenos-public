import {test,expect} from '@playwright/test';
const reference='wpr_account_wallet_fixture_123';
function result() {
  const at=new Date().toISOString();
  return {ok:true,state:'complete',wallet:{wallet_reference:reference},buying_power:{chain:'solana',state:'available',observed_at:at,assets:[{symbol:'SOL',asset_id:'native',decimals:9,amount:'1.234567890',spendable_before_network_fees:'1.234567890'},{symbol:'USDC',canonical_usdc:true,decimals:6,amount:'28.000001',spendable_before_network_fees:'25.000001'}]},summary:{state:'available',marked_value_state:'current',marked_portfolio_value_minor:'100000000',executable_value_minor:'97000000',unresolved_unknown_value_count:0},economic_exposure:{assets:[{identity:'solana:SOL',marked_value_minor:'72000000'},{identity:'solana:USDC',marked_value_minor:'28000000'}]},holdings:{observed_position_count:2,rows:[{instrument:{label:'Solana'},amount_base_units:'1234567890',decimals:9,marked_value_minor:'72000000',executable_value_minor:'69000000'},{instrument:{label:'USD Coin'},amount_base_units:'28000001',decimals:6,marked_value_minor:'28000000',executable_value_minor:'28000000'}]},diagnostics:{observation_state:'complete',observed_position_count:2,resolved_position_count:2},boundaries:{read_only:true,customer_assets_can_move:false,transaction_material_created:false}};
}
async function fixture(page,{authenticated=true}={}) {
  const state={authenticated,mode:'current',calls:[],release:null};
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{ok:false}}));
  await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{ok:true,authenticated:state.authenticated,csrf_token:state.authenticated?'csrf_capital_fixture':null}}));
  await page.route('**/api/v1/portfolio/preview',async r=>{
    if(r.request().method()==='GET')return r.fulfill({json:{ok:true,wallets:[{wallet_reference:reference,label:'Raven Solana wallet'}]}});
    state.calls.push(r.request().postDataJSON());expect(r.request().headers()['x-ravenos-csrf']).toBe('csrf_capital_fixture');
    if(state.mode==='delayed')await new Promise(resolve=>{state.release=resolve;});
    if(state.mode==='failed')return r.fulfill({status:503,json:{ok:false}});
    const body=result();if(state.mode==='wrong_wallet')body.wallet.wallet_reference='wpr_other_wallet_999';
    if(state.mode==='expired')body.buying_power.observed_at=new Date(Date.now()-121000).toISOString();
    await r.fulfill({json:body}).catch(()=>{});
  });
  return state;
}
for(const width of [390,1440])test(`Portfolio opens the account wallet and calculates local targets at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/portfolio/?wallet=0x1111111111111111111111111111111111111111');
  await expect(page.locator('#capitalResults')).toBeVisible();await expect(page.locator('#capitalBalanceSOL')).toHaveText('1.234567890');await expect(page.locator('#capitalBalanceUSDC')).toHaveText('25.000001');await expect(page.locator('#capitalTotalUSDC')).toContainText('28.000001');
  expect(state.calls).toEqual([{wallet_reference:reference}]);
  await page.getByLabel('Working USDC target',{exact:true}).fill('20');await page.getByLabel('SOL buffer',{exact:true}).fill('0.01');await page.getByLabel('Maximum asset share (%)',{exact:true}).fill('50');
  await expect(page.locator('#capitalPlan')).toContainText('5.000001 USDC above your target');await expect(page.locator('#capitalPlan')).toContainText('1.22456789 SOL above your target');await expect(page.locator('#capitalPlan')).toContainText('72%');expect(state.calls).toHaveLength(1);
  await page.getByText('Holdings, exit estimates & coverage',{exact:true}).click();await expect(page.locator('#capitalHoldings tr')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);expect(errors).toEqual([]);
  if(width===390)await page.locator('#capital-helper').screenshot({path:'/tmp/raven-capital-helper-mobile.png'});
});
test('failed refresh retains the same wallet and observation without manufacturing fresh values',async({page})=>{
 const state=await fixture(page);await page.goto('/portfolio/');await expect(page.locator('#capitalResults')).toBeVisible();const at=await page.locator('#capitalObserved').innerText();
 state.mode='failed';await page.getByRole('button',{name:'Refresh wallet',exact:true}).click();await expect(page.locator('#capitalStatus')).toContainText('Update delayed');await expect(page.locator('#capitalBalanceSOL')).toHaveText('1.234567890');await expect(page.locator('#capitalObserved')).toHaveText(at);await expect(page.locator('#capitalMarkedState')).toHaveText('Retained marks');
});
test('expired observations prevent a current working-capital recommendation',async({page})=>{
 const state=await fixture(page);state.mode='expired';await page.goto('/portfolio/');await expect(page.locator('#capitalPlan')).toContainText('Refresh your wallet');await expect(page.locator('#capitalMarkedState')).toHaveText('Refresh needed');await page.getByLabel('Working USDC target',{exact:true}).fill('20');await expect(page.locator('#capitalPlan')).not.toContainText('above your target');
});
test('returning to an older open tab immediately removes current proposals',async({page})=>{
 await fixture(page);await page.goto('/portfolio/');await expect(page.locator('#capitalResults')).toBeVisible();
 await page.getByLabel('Working USDC target',{exact:true}).fill('20');await expect(page.locator('#capitalPlan')).toContainText('above your target');
 await page.clock.setFixedTime(new Date(Date.now()+121000));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#capitalPlan')).toContainText('Refresh your wallet');await expect(page.locator('#capitalMarkedState')).toHaveText('Refresh needed');
});
test('wrong-wallet responses are rejected before displaying balances',async({page})=>{
 const state=await fixture(page);state.mode='wrong_wallet';await page.goto('/portfolio/');await expect(page.locator('#capitalStatus')).toContainText('could not finish');await expect(page.locator('#capitalResults')).toBeHidden();await expect(page.locator('#capitalBalanceSOL')).toBeEmpty();
});
test('sign-out clears private values and defeats a pending analysis response',async({page})=>{
 const state=await fixture(page);await page.goto('/portfolio/');await expect(page.locator('#capitalResults')).toBeVisible();state.mode='delayed';await page.getByRole('button',{name:'Refresh wallet',exact:true}).click();await expect.poll(()=>Boolean(state.release)).toBe(true);
 state.authenticated=false;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:false}})));await expect(page.locator('#capitalStatus')).toContainText('Sign in');state.release();await expect(page.locator('#capitalResults')).toBeHidden();await expect(page.locator('#capitalBalanceSOL')).toBeEmpty();
});
test('signed-out Portfolio does not start wallet analysis',async({page})=>{
 const state=await fixture(page,{authenticated:false});await page.goto('/portfolio/');await expect(page.locator('#capitalStatus')).toContainText('Sign in');expect(state.calls).toEqual([]);
});
