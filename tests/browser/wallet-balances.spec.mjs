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
 await widget.screenshot({path:process.env.RAVENOS_VISUAL_ARTIFACT_DIR+`/wallet-buying-power-${label}.png`});
 await page.getByRole('button',{name:'Refresh balances'}).click();await expect.poll(count).toBe(2);
 await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({status:503,json:{ok:false}}));await page.getByRole('button',{name:'Refresh balances'}).click();await expect(widget).toContainText('does not mean your wallet is empty');await expect(widget).not.toContainText('0.150197288');
});
test('signed-out balance surface offers sign-in and never manufactures a zero',async({page})=>{await page.route('**/api/v1/wallets/balances?**',r=>r.fulfill({status:401,json:{ok:false}}));await page.goto('/portfolio/');const widget=page.getByRole('region',{name:'Raven Wallet buying power'});await expect(widget).toContainText('Sign in');await expect(widget.locator('.raven-wallet-balance-grid')).toBeEmpty();});
test('spot ticket shows own SOL and USDC before quote without signing or creating a wallet',async({page})=>{
 await mockTerminalLiveApis(page,{spotQuotePreview:true});await balances(page);const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade');
 await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});await expect(page.locator('#terminalWalletFunds')).toContainText('0.150197288');await expect(page.locator('#terminalWalletFunds')).toContainText('Connect this wallet');expect(posts.filter(url=>/sign|send|execute|wallets\/privy/.test(url))).toEqual([]);
});
