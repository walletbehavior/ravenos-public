import {test,expect} from '@playwright/test';

const accountA='sespub_trade_history_account_a',accountB='sespub_trade_history_account_b';
const token='0x'+'2'.repeat(40),hash='0x'+'4'.repeat(64);
function trade(index,{symbol='MEME',state='finalized'}={}) {
  const verified=['confirmed','finalized'].includes(state);
  return {execution_id:'lex_'+String(index).padStart(24,'0'),chain:'base',instrument_id:'base:pool:'+token,symbol,side:index%2?'buy':'sell',state,
    created_at:'2026-09-10T10:30:00.000Z',observed_at:'2026-09-10T10:30:12.000Z',transaction_reference:hash,
    receipt:{economic_result_verified:verified,finalized:state==='finalized',trading_fee:verified?{amount_base_units:'190000',decimals:6,symbol:'USDC'}:null,
      network_fee:verified?{amount_base_units:'120000000000000',decimals:18,symbol:'ETH'}:null,
      movements:verified?[{amount_base_units:'-19000000',decimals:6,symbol:'USDC'},{amount_base_units:'123456789012345678901',decimals:null,address:token}]:[]}};
}
async function fixture(page,{authenticated=true,empty=false}={}) {
  const state={authenticated,sessionId:accountA,authFailures:0,authCalls:0,historyCalls:[],mode:'normal',release:null,empty};
  await page.route('**/api/**',r=>r.fulfill({status:503,json:{ok:false}}));
  await page.route('**/api/v1/auth/config',r=>r.fulfill({json:{ok:true,available:true,on_authenticated_origin:true}}));
  await page.route('**/api/v1/auth/session',r=>{
    state.authCalls++;
    if(state.authFailures>0){state.authFailures--;return r.fulfill({status:503,headers:{'retry-after':'1'},json:{ok:false,error:'account_service_unavailable'}});}
    return r.fulfill({json:{ok:true,authenticated:state.authenticated,csrf_token:state.authenticated?'csrf_history_fixture':null,
      session:{session_public_id:state.sessionId},account:{username:'fixture'}}});
  });
  await page.route('**/api/v1/portfolio/preview',r=>r.fulfill({json:{ok:true,wallets:[]}}));
  await page.route('**/api/v1/portfolio/trades*',async r=>{
    expect(r.request().method()).toBe('GET');
    const cursor=new URL(r.request().url()).searchParams.get('cursor');state.historyCalls.push(cursor);
    const id=state.sessionId,mode=state.mode;
    if(mode==='delayed')await new Promise(resolve=>{state.release=resolve;});
    if(mode==='failed')return r.fulfill({status:503,json:{ok:false,error:'trade_history_unavailable'}});
    if(mode==='expired')return r.fulfill({status:401,json:{ok:false,error:'authentication_required'}});
    const items=state.empty?[]:id===accountB?[trade(99,{symbol:'OTHER'})]:cursor?[trade(25),trade(26)]:Array.from({length:25},(_,i)=>trade(i+1,{state:['pending_receipt','confirmed','finalized','failed'][i%4]}));
    if(mode==='malicious')items[0]={...trade(1,{symbol:'<img src=x onerror=alert(1)>'}),transaction_reference:'javascript:alert(1)',explorer_url:'https://elsewhere.test/private'};
    await r.fulfill({json:{ok:true,schema_version:'ravenos.trade_journal.v1',account_session_id:mode==='mismatch'?accountB:id,items,next_cursor:state.empty||cursor||id===accountB?null:'page_two'}}).catch(()=>{});
  });
  return state;
}
const entries=page=>page.locator('#journalRows > tr[data-execution-id]');

for(const width of [360,390,1440])test(`trade history has readable rows and reachable receipt details at ${width}px`,async({page,browserName})=>{
  await page.setViewportSize({width,height:900});const state=await fixture(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/portfolio/#trade-history');await expect(entries(page)).toHaveCount(25);
  await expect(page.locator('#journalStatus')).toContainText('25 Raven trades');
  await expect(entries(page).nth(0)).toContainText('Checking receipt');await expect(entries(page).nth(1)).toContainText('Confirmed');
  await expect(entries(page).nth(2)).toContainText('Finalized');await expect(entries(page).nth(3)).toContainText('Failed');
  await expect(entries(page).nth(0)).toContainText('Unavailable');await expect(entries(page).nth(1)).toContainText('0.19 USDC');
  expect(state.historyCalls).toEqual([null]);expect(state.authCalls).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
  if(width<700)expect(await page.locator('#journalTable').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  const details=entries(page).nth(1).getByRole('button',{name:'Receipt details for MEME'});await details.click();
  await expect(details).toHaveAttribute('aria-expanded','true');
  const opened=page.locator('#journalRows .journal-detail-row:not([hidden])');await expect(opened).toContainText('−19 USDC');
  await expect(opened).toContainText('123,456,789,012,345,678,901 base units');await expect(opened).toContainText('0.00012 ETH');
  expect(await page.locator('#journalTable').evaluate(el=>el.scrollLeft)).toBe(0);
  expect(errors).toEqual([]);
  if(width===390)await page.locator('#trade-history').screenshot({path:`/tmp/raven-trade-history-${browserName}-390.png`});
});
test('pagination deduplicates executions and refresh returns to the newest page',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(entries(page)).toHaveCount(26);await expect(page.locator('#journalMore')).toBeHidden();
  expect(state.historyCalls).toEqual([null,'page_two']);
  await page.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(entries(page)).toHaveCount(25);await expect(page.locator('#journalMore')).toBeVisible();
});
test('a history outage preserves already loaded receipts for the same account',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.mode='failed';await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('previously loaded');await expect(entries(page)).toHaveCount(25);
  state.mode='normal';await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('25 Raven trades');
});
test('an empty ledger is distinct from a failed request',async({page})=>{
  const state=await fixture(page,{empty:true});await page.goto('/portfolio/');await expect(page.locator('#journalStatus')).toContainText('No Raven trades yet');await expect(page.locator('#journalTable')).toBeHidden();
  state.mode='failed';await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('could not load');await expect(page.locator('#journalStatus')).not.toContainText('No Raven trades');
});
test('signed-out users do not request private history',async({page})=>{
  const state=await fixture(page,{authenticated:false});await page.goto('/portfolio/');await expect(page.locator('#journalStatus')).toContainText('Sign in');expect(state.historyCalls).toEqual([]);
});
test('a delayed prior-account response cannot reappear after sign-out',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.mode='delayed';await page.locator('#journalRefresh').click();await expect.poll(()=>Boolean(state.release)).toBe(true);
  state.authenticated=false;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:false}})));
  await expect(entries(page)).toHaveCount(0);state.release();await expect(page.locator('#journalStatus')).toContainText('Sign in');await expect(page.locator('#journalTable')).toBeHidden();
});
test('account changes clear old rows and restart pagination for the new account',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.sessionId=accountB;await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(entries(page)).toHaveCount(1);await expect(entries(page)).toContainText('OTHER');
  expect(state.historyCalls).toEqual([null,null]);await expect(page.locator('#journalMore')).toBeHidden();
});
test('account-response mismatch clears private data before rendering',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.mode='mismatch';await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('account changed');await expect(entries(page)).toHaveCount(0);
});
test('failed account checks clear history without claiming sign-out',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.authFailures=2;await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('Account check is temporarily unavailable');await expect(entries(page)).toHaveCount(0);expect(state.historyCalls).toHaveLength(1);
  await page.locator('#journalRefresh').click();await expect(entries(page)).toHaveCount(25);
});
test('receipt authentication expiry clears the view',async({page})=>{
  const state=await fixture(page);await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  state.mode='expired';await page.locator('#journalRefresh').click();await expect(page.locator('#journalStatus')).toContainText('Sign in');await expect(entries(page)).toHaveCount(0);
});
test('provider text cannot create markup or arbitrary receipt links',async({page})=>{
  const state=await fixture(page);state.mode='malicious';await page.goto('/portfolio/');await expect(entries(page)).toHaveCount(25);
  await expect(entries(page).first()).toContainText('<img src=x onerror=alert(1)>');await expect(entries(page).first().locator('img,a')).toHaveCount(0);
});
