import {test,expect} from "@playwright/test";
import {mockTerminalLiveApis,waitForTerminalLive} from "./terminal-live-fixtures.mjs";
test.afterEach(async({page})=>{await page.unrouteAll({behavior:"wait"});});
test('Terminal mode changes and intelligence overlays preserve the original spot draft', async ({ page, baseURL }) => {
  await setup(page, baseURL, { panel: 'chart' });
  await page.locator('#terminalSpotAmount').fill('37');
  const url = page.url();
  await page.locator('[data-terminal-pane-button="holders"]').click();
  await expect(page.locator('.ros-intelligence-layer')).toBeVisible();
  await expect(page).toHaveURL(url);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ros-intelligence-layer')).toHaveCount(0);
  await expect(page.locator('#terminalSpotAmount')).toHaveValue('37');
  await page.locator('[data-market-section="perps"]').click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__.getState().lane)).toBe('perps');
  await page.locator('[data-market-section="memecoins"]').click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__.getState().lane)).toBe('spot');
  await expect(page.locator('#terminalSpotAmount')).toHaveValue('37');
  expect((await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState())).instrument).toBe('JUP/USDC');
});
const WALLET="11111111111111111111111111111111";
const USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL="So11111111111111111111111111111111111111112";
const URL="https://app.ravenos.xyz/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade";
async function setup(page,baseURL,{delay=0,reject=false,pending=false,statusResult=null,minimum="8323920000",embedded=false,stalledWallet=false,panel="trade"}={}) {
  await page.route("https://app.ravenos.xyz/**", async route=>{
    const u=new globalThis.URL(route.request().url());
    await route.fulfill({response:await page.request.fetch(`${baseURL}${u.pathname}${u.search}`)});
  });
  const fixtures=await mockTerminalLiveApis(page,{spotQuotePreview:true});
  await page.route("**/api/v1/auth/session",route=>route.fulfill({json:{ok:true,authenticated:true,csrf_token:"fixturecsrf"}}));
  await page.route("**/api/v1/wallets/balances?**",route=>route.fulfill({status:401,json:{ok:false}}));
  await page.route("**/api/trade/live/session",route=>route.fulfill({json:{ok:true,gate:{configured:true,chains:{solana:{available_to_principal:true}}}}}));
  await page.route("**/api/v1/wallets/privy",route=>route.fulfill({json:embedded ? {ok:true,available:true,app_id:"cmfixtureabcdefghijkl",client_id:"fixture",capabilities:{solana:true,evm:false,manual_signing:true},wallets:[{ecosystem:"solana",address:WALLET}]} : {ok:true,available:false}}));
  await page.route("**/api/v1/wallets/privy/session",route=>route.fulfill({json:{ok:true,token:"fixture.auth.token"}}));
  await page.route("**/api/v1/wallets/privy/link",route=>route.fulfill({json:{ok:true,linked:true,wallets:[{ecosystem:"solana",address:WALLET}]}}));
  await page.addInitScript(({wallet,reject,stalledWallet})=>{
    window.buyCalls={sign:0,provider:0,sync:0,provision:0,open:0};
    const provider={publicKey:wallet,connect:async()=>({publicKey:wallet}),disconnect:async()=>{},signTransaction:async()=>{window.buyCalls.provider++;}};
    window.phantom={solana:provider};
    window.__RAVENOS_PRIVY_WALLET_FACTORY__={create:()=>({sync:async()=>{window.buyCalls.sync++;return {solana:{ecosystem:"solana",address:wallet}};},provision:async()=>{window.buyCalls.provision++;return {solana:{ecosystem:"solana",address:wallet}};},identityToken:async()=>"fixture-id",providers:async()=>{window.buyCalls.open++;if(stalledWallet)return new Promise(()=>{});return {solana:provider};}})};
    window.RavenOSWalletExecution={signSolanaTicket:async({ticket,assertCurrent})=>{
      assertCurrent();window.buyCalls.sign++;
      if(reject)throw Error("user_rejected_request");
      return {ticket_id:ticket.ticket_id,signed_transaction_base64:"fixture-signed-only"};
    }};
  },{wallet:WALLET,reject,stalledWallet});
  const prepare=[],execute=[],statuses=[];
  await page.route("**/api/trade/live/solana/prepare",async route=>{
    const input=route.request().postDataJSON();prepare.push(input);
    if(delay)await new Promise(r=>setTimeout(r,delay));
    await route.fulfill({json:{ok:true,ticket:{schema_version:"ravenos.solana_live_ticket.v1",ticket_id:`fixture-${prepare.length}`,wallet_address:WALLET,expires_at:new Date(Date.now()+8000).toISOString(),exact_market:{instrument_id:input.instrument_id,pool_address:input.pool_address},reviewed_order:{side:input.side,input_mint:input.side==="sell"?input.token_address:input.funding_preference==="native"?SOL:USDC,output_mint:input.side==="buy"?input.token_address:input.settlement_preference==="native"?SOL:USDC,minimum_output_amount_base_units:minimum},fee:{fee_bps:100}},unsigned_transaction_base64:"fixture-unsigned"}});
  });
  await page.route("**/api/trade/live/solana/execute",route=>{execute.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,reconciliation:{state:pending?"indeterminate":"provider_confirmed",signature:"fixture-signature"}}});});
  await page.route("**/api/trade/live/status",route=>{
    const input=route.request().postDataJSON();statuses.push(input);
    return route.fulfill({status:statusResult==="provider_rejected"?409:200,json:{ok:statusResult!=="provider_rejected",ticket_id:input.ticket_id,reconciliation:{state:statusResult||"indeterminate"}}});
  });
  await page.goto(URL.replace("&panel=trade", panel === "chart" ? "" : `&panel=${panel}`));
  await waitForTerminalLive(page,{lane:"spot",instrument:"JUP/USDC",timeframe:"1h"});
  if(!embedded){await page.locator("#terminalWalletConnect").click();await page.locator("#terminalWalletChooser").getByRole("button",{name:/Phantom/}).click();}
  return {fixtures,prepare,execute,statuses};
}

for (const viewport of [{width:390,height:844},{width:375,height:740},{width:430,height:932}]) test(`mobile chart opens with amount, balance and one Buy at ${viewport.width}px`,async({page,baseURL},testInfo)=>{
  await page.setViewportSize(viewport);
  const h=await setup(page,baseURL,{embedded:true,panel:"chart"});
  await expect(page.locator("#terminalSpotAmount")).toBeVisible();
  await expect(page.locator("#terminalSpotBalance")).toBeVisible();
  await page.locator("#terminalSpotAmount").fill("25");
  await expect(page.locator("#terminalSpotEstimateOutput")).toContainText("8365.7475");
  await expect(page.locator("#terminalSpotQuoteAction")).toHaveText("Buy JUP");
  expect(h.prepare).toHaveLength(0);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:testInfo.outputPath("mobile-chart-buy.png"),fullPage:true});
  const chart=await page.locator(".terminal-chart-panel").boundingBox();
  const ticket=await page.locator("#terminalSpotTicketSection").boundingBox();
  expect(ticket.y).toBeGreaterThanOrEqual(chart.y+chart.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#terminalSpotQuoteAction").scrollIntoViewIfNeeded();
  const buy=await page.locator("#terminalSpotQuoteAction").boundingBox();
  const navigation=await page.locator(".ros-mobile-nav").boundingBox();
  expect(buy.y+buy.height).toBeLessThanOrEqual(navigation.y+2);
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  await expect(page.locator("#terminalSpotLiveExecution")).toBeVisible();
  expect(h.prepare).toHaveLength(1);expect(h.execute).toHaveLength(1);
});

test("typing updates tokens, slippage and impact without preparing or signing",async({page,baseURL})=>{
  const h=await setup(page,baseURL);
  await page.locator("#terminalSpotAmount").fill("75");
  await expect(page.locator("#terminalSpotEstimateOutput")).toContainText("8365.7475");
  await expect(page.locator("#terminalSpotEstimateSlippage")).toContainText("0.50%");
  await expect(page.locator("#terminalSpotEstimateImpact")).toContainText("0.18%");
  expect(h.prepare).toHaveLength(0);expect(h.execute).toHaveLength(0);
  expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(0);
  await expect(page.locator("#terminalSpotLiveAction")).toHaveCount(0);
  await expect(page.locator("#terminalSpotExecutionRail")).toBeHidden();
  await expect(page.locator("#terminalSpotRouteDetails")).not.toHaveAttribute("open","");
});

for(const mobile of [false,true])test(`one Buy completes all native trade stages (${mobile?"mobile":"desktop"})`,async({page,baseURL})=>{
  if(mobile)await page.setViewportSize({width:390,height:844});
  const h=await setup(page,baseURL,{embedded:mobile});
  await page.locator("#terminalSpotAmount").fill("25");
  await expect(page.locator("#terminalSpotQuoteAction")).toHaveText("Buy JUP");
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  expect(h.prepare).toHaveLength(1);expect(h.execute).toHaveLength(1);
  expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0); // no extra trade-confirmation dialog
  await expect(page.locator("#terminalWalletChooser")).not.toBeVisible();
});

test("Raven Wallet opens automatically on Buy without a separate connect action",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{embedded:true});
  await page.locator("#terminalSpotAmount").fill("25");
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  expect(h.prepare).toHaveLength(1);expect(h.execute).toHaveLength(1);
  await expect(page.locator("#terminalWalletChooser")).toHaveCount(0);
});

test("double tap and Enter while routing cannot duplicate a buy",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{delay:600});
  await page.locator("#terminalSpotQuoteAction").evaluate(n=>{n.click();n.click();});
  await page.locator("#terminalSpotAmount").press("Enter");
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  expect(h.prepare).toHaveLength(1);expect(h.execute).toHaveLength(1);
});

test("changing amount during preparation cancels the old intent before wallet signing",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{delay:800});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect.poll(()=>h.prepare.length).toBe(1);
  await page.locator("#terminalSpotAmount").fill("100");
  await expect(page.locator("#terminalSpotLiveMessage")).toContainText("changed");
  expect(h.execute).toHaveLength(0);expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(0);
});

test("new preparation worse than the displayed minimum never signs",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{minimum:"6000000000"});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveMessage")).toContainText("price moved");
  expect(h.execute).toHaveLength(0);expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(0);
});

test("wallet rejection does not send and permits a deliberate retry",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{reject:true});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveMessage")).toContainText("Canceled in your wallet");
  expect(h.execute).toHaveLength(0);await expect(page.locator("#terminalSpotQuoteAction")).toBeEnabled();
});

test("indeterminate submission stays locked even when amount is edited",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{pending:true});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Confirmation pending");
  await page.locator("#terminalSpotAmount").fill("100");
  await expect(page.locator("#terminalSpotQuoteAction")).toBeDisabled();
  await page.locator("#terminalSpotAmount").press("Enter");
  expect(h.execute).toHaveLength(1);
});

for(const statusResult of ["provider_confirmed","provider_rejected"])test(`pending trade updates to ${statusResult} automatically without resubmission`,async({page,baseURL})=>{
  const h=await setup(page,baseURL,{pending:true,statusResult});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Confirmation pending");
  await expect(page.locator("#terminalSpotLiveState")).toHaveText(statusResult==="provider_confirmed"?"Trade confirmed":"Trade failed",{timeout:10000});
  await expect(page.locator("#terminalSpotQuoteAction")).toBeEnabled();
  expect(h.statuses).toHaveLength(1);
  expect(h.execute).toHaveLength(1);
  expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(1);
});


test("an already opened Raven Wallet is reused for a second explicit Buy",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{embedded:true});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  await page.locator("#terminalSpotAmount").fill("20");
  await page.locator("#terminalSpotQuoteAction").click();
  await expect.poll(()=>h.execute.length).toBe(2);
  expect(await page.evaluate(()=>({sync:window.buyCalls.sync,open:window.buyCalls.open,provision:window.buyCalls.provision}))).toEqual({sync:1,open:1,provision:0});
});

test("a stalled wallet open ends without signing or preparing and restores Buy",async({page,baseURL})=>{
  const h=await setup(page,baseURL,{embedded:true,stalledWallet:true});
  await page.clock.install();
  await page.locator("#terminalSpotQuoteAction").click();
  await expect.poll(()=>page.evaluate(()=>window.buyCalls.open)).toBe(1);
  await page.clock.runFor(26000);
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Not sent");
  await expect(page.locator("#terminalSpotLiveMessage")).toContainText("did not open in time");
  await expect(page.locator("#terminalSpotQuoteAction")).toBeEnabled();
  expect(h.prepare).toHaveLength(0);expect(h.execute).toHaveLength(0);
  expect(await page.evaluate(()=>window.buyCalls.sign)).toBe(0);
});
