import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis, waitForTerminalLive, openExactSpotSearch } from "./terminal-live-fixtures.mjs";
const spot = "/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade";
for (const [error, blockers, title, label] of [
  ["allowance_required", ["allowance_required","insufficient_balance"], "Insufficient funds", "Not checked"],
  ["allowance_required", ["allowance_required"], "Approval required", "Not checked"],
  ["quote_provider_timeout", [], "Review incomplete", "Check incomplete"],
  ["evm_exit_quote_unresolved", [], "Review incomplete", "Unverified"],
]) test(`review distinguishes ${error} ${blockers.join("+")} from exit liquidity`, async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await mockTerminalLiveApis(page,{spotQuotePreview:true});
  await page.route("**/api/trade/spot-quote-preview",route=>route.fulfill({status:409,json:{ok:false,error,details:{blockers}}}));
  await page.goto(spot);
  await waitForTerminalLive(page,{lane:"spot",instrument:"JUP/USDC",timeframe:"1h"});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotQuoteState")).toHaveText(title);
  await expect(page.locator("#terminalSpotExitCompact")).toHaveText(label);
  await expect(page.locator("#terminalSpotQuoteResult")).toBeHidden();
  await expect(page.locator("#terminalSpotExecutionRail [data-terminal-step=sign]")).not.toHaveAttribute("data-state","current");
  if (blockers.length) await expect(page.locator("#terminalSpotQuoteMessage")).toContainText("does not mean there is no sell route");
  await page.locator('[data-spot-buy-amount="100"]').click();
  await expect(page.locator("#terminalSpotExitCompact")).toHaveText("Not reviewed");
});
test("desktop selected price survives watchlist fetch failure and dock controls never overlap", async ({page},testInfo)=>{
  await page.setViewportSize({width:1600,height:1000});
  await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:["solana","robinhood"]});
  await page.route("**/api/terminal/chart?**", route => new URL(route.request().url()).searchParams.get("limit")==="25" ? route.fulfill({status:503,json:{ok:false}}) : route.fallback());
  await page.goto("/terminal/?market_scope=perps");
  await waitForTerminalLive(page,{instrument:"SOL-PERP"});
  await openExactSpotSearch(page,"RUNNER");
  await waitForTerminalLive(page,{lane:"spot",instrument:"RUNNER/WETH"});
  await expect(page.locator('.desk-market-row[data-active="true"] .desk-market-quote strong')).toBeVisible();
  await expect(page.locator('.desk-market-row[data-active="true"]')).not.toContainText("Awaiting quote");
  await expect(page.locator(".desk-research-brief")).toBeHidden();
  await expect(page.locator('.desk-dock-nav')).toBeVisible();
  expect(await page.locator('#terminalSpotQuoteAction').evaluate(n=>getComputedStyle(n).position)).toBe("static");
  await page.locator('.desk-dock-nav [data-desk-tab="raven"]').click();
  await expect(page.locator('#terminalSpotTicketSection')).toBeHidden();
  await expect(page.locator('.desk-brief-disclosure')).not.toHaveAttribute("open","");
  await page.locator('.desk-brief-disclosure > summary').click();
  await expect(page.locator('.desk-research-brief dl')).toBeVisible();
  await page.locator('.desk-dock-nav [data-desk-tab="trade"]').click();
  await expect(page.locator('#terminalSpotTicketSection')).toBeVisible();
  await expect(page.locator('.desk-research-brief')).toBeHidden();
  await page.locator('.terminal-intelligence').evaluate(n=>n.scrollTop=200);
  const button=await page.locator('#terminalSpotQuoteAction').boundingBox();
  const input=await page.locator('#terminalSpotAmount').boundingBox();
  expect(button.y >= input.y+input.height || button.y+button.height <= input.y).toBe(true);
  await page.screenshot({path:testInfo.outputPath('desktop-trading-dock.png'),fullPage:true});
});

test("unfunded EVM wallet review and retry keep funding separate from exit evidence", async ({page,baseURL})=>{
  await page.route("https://app.ravenos.xyz/**",async route=>{
    const u=new URL(route.request().url());
    const response=await page.request.fetch(`${baseURL}${u.pathname}${u.search}`);
    await route.fulfill({response});
  });
  await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:["solana","robinhood"]});
  await page.addInitScript(()=>{globalThis.ethereum={isMetaMask:true,on:()=>{},request:async({method})=>{
    if(["eth_requestAccounts","eth_accounts"].includes(method)) return ["0x1111111111111111111111111111111111111111"];
    if(method==="eth_chainId")return "0x1237";
    throw Error(`Unexpected wallet method: ${method}`);
  }};});
  await page.route("**/api/v1/auth/session",route=>route.fulfill({json:{ok:true,authenticated:true,csrf_token:"fixturecsrf"}}));
  await page.route("**/api/trade/live/session",route=>route.fulfill({json:{ok:true,gate:{configured:true,chains:{robinhood:{available_to_principal:true}}}}}));
  let calls=0;
  await page.route("**/api/trade/live/robinhood/prepare",route=>{calls++;return route.fulfill({status:409,json:{ok:false,error:"allowance_required",details:{blockers:["allowance_required","insufficient_balance"]}}});});
  await page.goto("https://app.ravenos.xyz/terminal/?market_scope=perps");
  await waitForTerminalLive(page,{instrument:"SOL-PERP"});
  await openExactSpotSearch(page,"RUNNER");
  await waitForTerminalLive(page,{lane:"spot",instrument:"RUNNER/WETH"});
  await page.locator('.desk-dock-nav [data-desk-tab="trade"]').click();
  await page.locator('#terminalWalletConnect').click();
  await page.locator('#terminalWalletChooser').getByRole('button',{name:/MetaMask/}).click();
  await page.locator('#terminalSpotQuoteAction').click();
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Insufficient funds');
  await expect(page.locator('#terminalSpotLiveMessage')).toContainText('exit check has not completed');
  await expect(page.locator('#terminalSpotExitCompact')).toHaveText('Not checked');
  await page.locator('#terminalSpotLiveAction').click();
  await expect.poll(()=>calls).toBe(2);
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Insufficient funds');
  await expect(page.locator('#terminalSpotLiveAction')).not.toHaveAttribute('data-live-action','execute');
});
