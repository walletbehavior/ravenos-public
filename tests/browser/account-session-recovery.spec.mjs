import { test, expect } from '@playwright/test';
import { mockTerminalLiveApis, waitForTerminalLive } from './terminal-live-fixtures.mjs';
for(const recovers of [true,false])test(`Perps chart loads during account backoff and ${recovers?'access recovers':'failure is not sign-out'}`,async({page,baseURL})=>{
  let calls=0,release;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://app.ravenos.xyz/**',async route=>{
    const url=new URL(route.request().url());await route.fulfill({response:await page.request.fetch(`${baseURL}${url.pathname}${url.search}`)});
  });
  await mockTerminalLiveApis(page);
  await page.route('**/api/v1/auth/config',r=>r.fulfill({json:{ok:true,available:true,on_authenticated_origin:true}}));
  await page.route('**/api/v1/auth/session',async r=>{
    if(++calls===1)return r.fulfill({status:503,headers:{'retry-after':'1'},json:{ok:false,error:'account_service_unavailable'}});
    await new Promise(resolve=>{const timer=setTimeout(resolve,6000);release=()=>{clearTimeout(timer);resolve();};});
    return r.fulfill(recovers?{json:{ok:true,authenticated:true,csrf_token:'csrf_perps_fixture'}}:{status:503,json:{ok:false,error:'account_service_unavailable'}});
  });
  await page.route('**/api/trade/live/session',r=>r.fulfill({json:{ok:true,gate:{configured:true,chains:{hyperliquid:{available_to_principal:true}}}}}));
  await page.route('**/api/v1/wallets/privy',r=>r.fulfill({json:{ok:true,available:false}}));
  const mutations=[];await page.route('**/api/trade/live/hyperliquid/**',r=>{mutations.push(r.request().url());return r.fulfill({status:503,json:{ok:false}});});
  await page.setViewportSize({width:390,height:844});await page.goto('https://app.ravenos.xyz/terminal/?market_scope=perps');
  await waitForTerminalLive(page,{lane:'perps',instrument:'SOL-PERP'});
  await expect(page.locator('#terminalLiveExecutionState')).toHaveText('Checking account');
  await expect(page.locator('#terminalLiveExecutionLink')).toBeHidden();await expect.poll(()=>Boolean(release)).toBe(true);release();
  await expect(page.locator('#terminalLiveExecutionState')).toHaveText(recovers?'Connect wallet':'Account check unavailable');
  await expect(page.locator('#terminalLiveExecutionLink')).toBeHidden();expect(mutations).toEqual([]);expect(calls).toBe(2);expect(errors).toEqual([]);
});
