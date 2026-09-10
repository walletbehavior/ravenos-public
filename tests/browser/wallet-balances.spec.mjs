import {test,expect} from '@playwright/test';
import {mockTerminalLiveApis,waitForTerminalLive} from './terminal-live-fixtures.mjs';
const address='ARmQK8SeGU6knUE1GAFb3N8nhKsw62CTwWmFNLvDM7Gw';
const payload={ok:true,snapshot:{chain:'solana',address,observed_at:'2026-09-08T10:29:04.045Z',state:'available',network_fee_asset:'SOL',assets:[{symbol:'SOL',amount:'0.150197288',spendable_before_network_fees:'0.150197288'},{symbol:'USDC',amount:'0.000000',spendable_before_network_fees:'0.000000'}]}};
async function balances(page){let calls=0;await page.route('**/api/v1/wallets/balances?**',route=>{calls++;return route.fulfill({json:payload});});return()=>calls;}
for(const [label,size]of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]])test(`funded wallet is visible in Portfolio on ${label}`,async({page})=>{
 await page.setViewportSize(size);const count=await balances(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/portfolio/');const widget=page.getByRole('region',{name:'Raven Wallet buying power'});
 await expect(widget).toContainText('0.150197288');await expect(widget.locator('code')).toHaveText(address);await expect(widget).toContainText('USDC');await expect(widget).toContainText('Funds stay on the selected network');
 expect(count()).toBe(1);expect(await widget.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
 await widget.screenshot({path:(process.env.RAVENOS_VISUAL_ARTIFACT_DIR || '/tmp')+`/wallet-buying-power-${label}.png`});
 await page.getByRole('button',{name:'Refresh balances'}).click();await expect.poll(count).toBe(2);
 await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({status:503,json:{ok:false}}));await page.getByRole('button',{name:'Refresh balances'}).click();await expect(widget).toContainText('does not mean your wallet is empty');await expect(widget).not.toContainText('0.150197288');
});
test('signed-out balance surface offers sign-in and never manufactures a zero',async({page})=>{await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({status:401,json:{ok:false}}));await page.goto('/portfolio/');const widget=page.getByRole('region',{name:'Raven Wallet buying power'});await expect(widget).toContainText('Sign in');await expect(widget.locator('.raven-wallet-balance-grid')).toBeEmpty();});
test('spot ticket shows own SOL and USDC before quote without signing or creating a wallet',async({page})=>{
 await mockTerminalLiveApis(page,{spotQuotePreview:true});await balances(page);const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade');
 await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});await expect(page.locator('#terminalWalletFunds')).toContainText('0.150197288');await expect(page.locator('#terminalWalletFunds')).toContainText('readiness and spendable funds automatically');expect(posts.filter(url=>/sign|send|execute|wallets\/privy/.test(url))).toEqual([]);
});

test('balance network survives reload but never overrides the exact trading network',async({page})=>{
 await page.route('**/api/v1/wallets/balances?**',r=>{const chain=new URL(r.request().url()).searchParams.get('chain');return r.fulfill({json:{...payload,snapshot:{...payload.snapshot,chain,address:chain==='solana'?address:'0x1111111111111111111111111111111111111111'}}});});
 await page.goto('/portfolio/');const selector=page.getByRole('combobox',{name:'Balance network'});
 await selector.selectOption('base');await page.reload();await expect(selector).toHaveValue('base');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ravenos:display-preferences:v1')));
 expect(saved.values.balanceNetwork).toBe('base');expect(JSON.stringify(saved)).not.toContain('0x111');expect(JSON.stringify(saved)).not.toContain('0.150');
 await mockTerminalLiveApis(page,{spotQuotePreview:true});
 await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade');
 await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});
 await expect(page.locator('#terminalWalletFunds select')).toHaveValue('solana');await expect(page.locator('#terminalWalletFunds select')).toBeDisabled();
});

test('refresh keeps the last same-chain balance visible and does not duplicate in-flight requests',async({page})=>{
 let calls=0,release;
 await page.route('**/api/v1/wallets/balances?**',async route=>{
   calls++;
   if(calls>1)await new Promise(resolve=>{release=resolve;});
   await route.fulfill({json:payload}).catch(()=>{});
 });
 await page.goto('/portfolio/');
 const widget=page.getByRole('region',{name:'Raven Wallet buying power'});
 await expect(widget).toContainText('0.150197288');
 await page.getByRole('button',{name:'Refresh balances'}).click();
 await expect(widget).toContainText('Refreshing Solana balances');
 await expect(widget).toContainText('0.150197288');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 expect(calls).toBe(2);
 release();
 await expect(widget.getByRole('button',{name:'Refresh balances'})).toBeEnabled();
 await expect(widget.locator('.raven-wallet-balance-grid > div')).toHaveCount(2);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:false}})));
 await expect(widget.locator('.raven-wallet-balance-grid')).toBeEmpty();
});

test('recent balances retain the original observation after a failed update and clear on sign-out',async({page})=>{
 const at=new Date().toISOString();
 await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({json:{...payload,snapshot:{...payload.snapshot,observed_at:at}}}));
 await page.goto('/portfolio/');const widget=page.getByRole('region',{name:'Raven Wallet buying power'});
 await expect(widget).toContainText('0.150197288');
 await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({status:503,json:{ok:false}}));
 await widget.getByRole('button',{name:'Refresh balances'}).click();
 await expect(widget).toContainText('Update delayed');await expect(widget).toContainText('0.150197288');
 await expect(widget).toContainText(new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:false}})));
 await expect(widget.locator('.raven-wallet-balance-grid')).toBeEmpty();await expect(widget.locator('code')).toBeEmpty();
});

test('account changes invalidate pending balances before another account can receive them',async({page})=>{
 let calls=0,release;
 await page.route('**/api/v1/wallets/balances?**',async r=>{
  calls++;
  if(calls===2){await new Promise(resolve=>{release=resolve;});return r.fulfill({json:payload}).catch(()=>{});}
  return r.fulfill({json:calls>2?{ok:true,snapshot:null}:payload});
 });
 await page.goto('/portfolio/');const widget=page.getByRole('region',{name:'Raven Wallet buying power'});
 await expect(widget).toContainText('0.150197288');await widget.getByRole('button',{name:'Refresh balances'}).click();
 await expect.poll(()=>Boolean(release)).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:true}})));
 await expect(widget).toContainText('No Raven Wallet linked');expect(calls).toBe(3);release();
 await expect(widget.locator('.raven-wallet-balance-grid')).toBeEmpty();await expect(widget.locator('code')).toBeEmpty();
});
