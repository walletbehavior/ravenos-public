import { expect, test } from '@playwright/test';
import { mockTerminalLiveApis, waitForTerminalLive } from './terminal-live-fixtures.mjs';
import { mockTradingSettings } from './trading-settings-fixtures.mjs';
const URL='/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=chart';
for(const width of [390,1440]) {
 test(`account quick amounts, slippage and multi-leg profiles remain on the Terminal screen at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await mockTerminalLiveApis(page,{spotQuotePreview:true});
  const saved=await mockTradingSettings(page), mutations=[];
  page.on('request',r=>{if(r.method()==='POST'&&/\/api\/trade\/live\/(prepare|execute|sign|submit)/.test(r.url())) mutations.push(r.url());});
  await page.goto(URL);await waitForTerminalLive(page,{lane:'spot'});
  await page.locator('#terminalSpotEditAmounts').click();
  const drawer=page.getByRole('dialog',{name:'Trading settings'});await expect(drawer).toBeVisible();
  const box=await drawer.boundingBox();expect(box.height).toBeLessThan(844*.7);
  for(const [i,n]of [15,40,80,160].entries())await drawer.getByRole('spinbutton',{name:`Buy · USD ${i+1}`,exact:true}).fill(String(n));
  for(const [i,n]of [.2,.4,.8,1.6].entries())await drawer.getByRole('spinbutton',{name:`Buy · SOL ${i+1}`,exact:true}).fill(String(n));
  for(const [i,n]of [10,30,60,100].entries())await drawer.getByRole('spinbutton',{name:`Sell · % of balance ${i+1}`,exact:true}).fill(String(n));
  await drawer.getByRole('button',{name:'Save settings',exact:true}).click();await expect(drawer).toContainText('Saved to your account.');
  await drawer.getByRole('button',{name:'Slippage',exact:true}).click();await drawer.getByRole('spinbutton',{name:'Slippage %',exact:true}).fill('6.25');
  await expect(drawer).toContainText('High slippage');await drawer.getByRole('button',{name:'Save settings',exact:true}).click();await expect(drawer).toContainText('Saved to your account.');
  await drawer.getByRole('button',{name:'TP/SL strategies',exact:true}).click();await drawer.getByRole('button',{name:'New strategy',exact:true}).click();
  await drawer.getByRole('textbox',{name:'Strategy name',exact:true}).fill('Scale out');
  await drawer.getByRole('spinbutton',{name:'Rule 1 trigger %',exact:true}).fill('80');await drawer.getByRole('spinbutton',{name:'Rule 2 trigger %',exact:true}).fill('150');
  await drawer.getByRole('button',{name:'Add rule',exact:true}).click();await drawer.getByRole('spinbutton',{name:'Rule 4 trigger %',exact:true}).fill('300');await drawer.getByRole('spinbutton',{name:'Rule 4 sell %',exact:true}).fill('25');
  const writeCount=saved.writes.length;
  await drawer.getByRole('button',{name:'Use this strategy',exact:true}).click();await expect(drawer).toContainText('cannot total more than 100%');expect(saved.writes.length).toBe(writeCount);
  await drawer.getByRole('spinbutton',{name:'Rule 2 sell %',exact:true}).fill('25');await drawer.getByRole('button',{name:'Use this strategy',exact:true}).click();
  await drawer.getByRole('button',{name:'Save settings',exact:true}).click();await expect(drawer).toContainText('Saved to your account.');
  await page.screenshot({path:info.outputPath(`strategy-drawer-${width}.png`)});
  await drawer.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('#terminalSpotStrategyShortcut')).toContainText('Scale out · 4 rules');
  await expect(page.locator('#terminalSpotSlippageShortcut')).toHaveText('6.25% slippage');
  await page.reload();await waitForTerminalLive(page,{lane:'spot'});
  await expect(page.locator('#terminalSpotStrategyShortcut')).toContainText('Scale out');
  await expect(page.locator('#terminalSpotBuyPresets button').first()).toHaveText('$15');
  await expect(page.locator('[data-spot-sell-pct="10"]')).toHaveText('10%');
  expect(saved.settings.strategies[0].rules).toHaveLength(4);expect(mutations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 });
}
test('settings dialog reports a revision conflict without overwriting newer account choices',async({page})=>{
 await mockTerminalLiveApis(page,{spotQuotePreview:true});const saved=await mockTradingSettings(page);
 await page.goto(URL);await waitForTerminalLive(page,{lane:'spot'});await page.locator('#terminalSpotEditAmounts').click();
 const drawer=page.getByRole('dialog',{name:'Trading settings'});await expect(drawer.getByRole('button',{name:'Save settings'})).toBeEnabled();
 saved.revision=5;saved.settings.quick_buy_usdc=[20,40,80,160];
 await drawer.getByRole('button',{name:'Save settings'}).click();await expect(drawer).toContainText('another tab');expect(saved.revision).toBe(5);
});

test('signing out closes private strategy drafts and prevents a stale save',async({page})=>{
 await mockTerminalLiveApis(page,{spotQuotePreview:true});const saved=await mockTradingSettings(page);
 await page.goto(URL);await waitForTerminalLive(page,{lane:'spot'});await page.locator('#terminalSpotEditAmounts').click();
 const drawer=page.getByRole('dialog',{name:'Trading settings'});await expect(drawer.getByRole('button',{name:'Save settings'})).toBeEnabled();
 await drawer.getByRole('button',{name:'TP/SL strategies'}).click();await drawer.getByRole('button',{name:'New strategy'}).click();
 await drawer.getByRole('textbox',{name:'Strategy name'}).fill('Private account draft');
 saved.signedIn=false;
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ravenos:accountstate',{detail:{authenticated:false}})));
 await expect(drawer).toHaveCount(0);await expect(page.getByText('Private account draft',{exact:true})).toHaveCount(0);
 expect(saved.writes).toEqual([]);
});
test('slippage rejects extra precision instead of silently changing the saved setting',async({page})=>{
 await mockTerminalLiveApis(page,{spotQuotePreview:true});const saved=await mockTradingSettings(page);
 await page.goto(URL);await waitForTerminalLive(page,{lane:'spot'});await page.locator('#terminalSpotSlippageShortcut').click();
 const drawer=page.getByRole('dialog',{name:'Trading settings'});await drawer.getByRole('spinbutton',{name:'Slippage %'}).fill('3.555');
 await drawer.getByRole('button',{name:'Save settings'}).click();await expect(drawer).toContainText('Slippage must be');expect(saved.writes).toEqual([]);
});
