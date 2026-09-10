import {test,expect} from "@playwright/test";
import {mockTerminalLiveApis,waitForTerminalLive} from "./terminal-live-fixtures.mjs";
import {evmEconomicPreview} from "../../lib/customer_trade/evm_economic_preview.mjs";
import {EVM_CHAIN_PROFILES} from "../../lib/customer_trade/evm_chain_profiles.mjs";
test.afterEach(async ({page}) => { await page.unrouteAll({behavior:"wait"}); });
const WALLET="0x3333333333333333333333333333333333333333", TOKEN="0x1111111111111111111111111111111111111111", POOL="0x2222222222222222222222222222222222222222";
async function setup(page,baseURL,chain,{needsApproval=false,native=false,holdNetwork=false,embedded=false,impactBps=null,fundingError=null,previewMismatch=false,economicMinimum="49000000",authFailures=0,holdAuth=false}={}) {
  const profile=EVM_CHAIN_PROFILES[chain];const prepared=[],reported=[];const controls={fundingError,previewMismatch,authFailures,authCalls:0,releaseAuth:null,holdAuth};
  await page.route("https://app.ravenos.xyz/**",async route=>{const url=new URL(route.request().url());await route.fulfill({response:await page.request.fetch(`${baseURL}${url.pathname}${url.search}`)});});
  await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:[chain,"solana"]});
  await page.route("**/api/dexscreener/pair**",route=>route.fulfill({json:{ok:true,results:[{chainId:chain,dexId:"uniswap",pairAddress:POOL,tokenAddress:TOKEN,quoteTokenAddress:profile.wrapped_native_token_address,symbol:"TKN",quoteSymbol:"WETH",name:"Token",priceUsd:1,liquidityUsd:1000000,volume24h:300000,lastUpdated:new Date().toISOString()}]}}));
  await page.route("**/api/v1/auth/session",async route=>{
    if(++controls.authCalls<=controls.authFailures)return route.fulfill({status:503,headers:{"retry-after":"1"},json:{ok:false,authenticated:false,error:"account_service_unavailable"}});
    if(controls.holdAuth)await new Promise(resolve=>{const timeout=setTimeout(resolve,6000);controls.releaseAuth=()=>{clearTimeout(timeout);resolve();};});
    return route.fulfill({json:{ok:true,authenticated:true,csrf_token:"fixturecsrf"}});
  });
  await page.route("**/api/trade/live/session",route=>route.fulfill({json:{ok:true,gate:{configured:true,chains:{[chain]:{available_to_principal:true}}}}}));
  await page.route("**/api/v1/wallets/privy",route=>route.fulfill({json:embedded?{ok:true,available:true,app_id:"fixture",capabilities:{evm:true,manual_signing:true},wallets:[{ecosystem:"evm",address:WALLET}]}:{ok:true,available:false}}));
  await page.route("**/api/v1/wallets/privy/session",route=>route.fulfill({json:{ok:true,token:"fixture-auth"}}));
  await page.addInitScript(({wallet,chainHex,native,holdNetwork,embedded})=>{
    window.tradeCalls={sign:0,approve:0,network:0};
    if(native)localStorage.setItem("ravenos.universal_shadow_ticket_preferences.v1",JSON.stringify({funding_preference:"native"}));
    window.ethereum={isMetaMask:true,on:()=>{},request:async({method})=>{if(["eth_accounts","eth_requestAccounts"].includes(method))return [wallet];if(method==="eth_chainId")return chainHex;throw Error(method);}};
    if(embedded)window.__RAVENOS_PRIVY_WALLET_FACTORY__={create:()=>({sync:async()=>({evm:{ecosystem:"evm",address:wallet}}),provision:async()=>{throw Error("no_provision_on_restore");},providers:async()=>({evm:window.ethereum})})};
    window.RavenOSWalletExecution={
      ensureEvmWalletNetwork:async({assertCurrent})=>{assertCurrent();window.tradeCalls.network++;if(holdNetwork)await new Promise(resolve=>{window.finishNetwork=resolve;});assertCurrent();},
      approveEvmTradeToken:async({approval,expectedAmount,assertCurrent})=>{assertCurrent();if(approval.amount_base_units!==expectedAmount)throw Error("test_amount_mismatch");window.tradeCalls.approve++;return {state:"confirmed"};},
      executeEvmZeroXTicket:async({ticket,assertCurrent})=>{assertCurrent();window.tradeCalls.sign++;return {ticket_id:ticket.ticket_id,transaction_hash:`0x${"a".repeat(64)}`};},
    };
  },{wallet:WALLET,chainHex:profile.wallet_chain_id_hex,native,holdNetwork,embedded});
  await page.route(`**/api/trade/live/${chain}/prepare`,async route=>{
    const input=route.request().postDataJSON();prepared.push(input);const expires=new Date(Date.now()+30000).toISOString();
    const sellToken=input.funding_preference==="native"?profile.native_token_address:profile.accounting_asset.address;
    const amount=(BigInt(input.display_amount.replace(".",""))*10n**BigInt((input.funding_preference==="native"?18:profile.accounting_asset.decimals)-(input.display_amount.split(".")[1]?.length||0))).toString();
    if(controls.fundingError) {
      let economic_preview=evmEconomicPreview({ok:true,chain_id:profile.chain_id,
        exact_binding:{taker:WALLET,recipient:WALLET,sell_token:sellToken,buy_token:TOKEN,sell_amount_base_units:amount,buy_amount_base_units:"70000000",minimum_buy_amount_base_units:economicMinimum},
        fee:{enabled:true,fee_bps:100,amount:"250000",token:sellToken},
        blockers:controls.fundingError==="insufficient_balance"?["insufficient_balance"]:[],
        observed_at:new Date().toISOString(),expires_at:expires,total_network_fee_native_base_units:"10000000000000",route:{fills:[{source:"Uniswap"}]}},
        {profile,token:{token_address:TOKEN,decimals:6},side:"buy",instrument_id:input.instrument_id,pool_address:input.pool_address,slippage_bps:input.slippage_bps});
      if(controls.previewMismatch)economic_preview && (economic_preview = {...economic_preview, wallet_address:TOKEN});
      return route.fulfill({status:409,json:{ok:false,error:controls.fundingError,details:{blockers:[controls.fundingError],economic_preview}}});
    }
    if(needsApproval&&await page.evaluate(()=>window.tradeCalls.approve===0))return route.fulfill({status:409,json:{ok:false,error:"allowance_required",details:{blockers:["allowance_required"],approval:{schema_version:"ravenos.exact_token_approval.v1",profile_id:profile.profile_id,chain_id:profile.chain_id,wallet_address:WALLET,spender:profile.allowance_holder,token_address:sellToken,amount_base_units:amount,output_token:TOKEN,expected_output_base_units:"50000000",minimum_output_base_units:"49000000",output_decimals:6,input_decimals:profile.accounting_asset.decimals,instrument_id:input.instrument_id,pool_address:input.pool_address,side:"buy",expires_at:expires,unlimited:false}}}});
    return route.fulfill({json:{ok:true,schema_version:chain==="robinhood"?"ravenos.robinhood_live_prepare_response.v1":"ravenos.evm_live_prepare_response.v1",ticket:{schema_version:chain==="robinhood"?"ravenos.robinhood_live_ticket.v1":"ravenos.evm_live_ticket.v1",ticket_id:`ticket-${prepared.length}`,profile_id:profile.profile_id,chain_namespace:chain,chain_id:profile.chain_id,wallet_address:WALLET,expires_at:expires,exact_market:{instrument_id:input.instrument_id,pool_address:input.pool_address},reviewed_order:{side:"buy",sell_token:sellToken,buy_token:TOKEN,expected_buy_amount_base_units:"50000000",minimum_buy_amount_base_units:"49000000"},exit_proof:{verified:true},fee:{fee_bps:100},accounting:{notional_base_units:"25000000",decimals:6}},provider_quote:{provider_quote_id:"fixturequote",observed_at:new Date().toISOString(),route:{fills:[{source:"Uniswap"}]}},review:{price_impact:impactBps === null ? null : {bps:impactBps,estimated:true,includes_fees_and_spread:true},expected_output:{display:"50",base_units:"50000000",symbol:"TKN"},minimum_output:{display:"49",base_units:"49000000",symbol:"TKN"},executable_exit:{display:"24"}}}});
  });
  await page.route(`**/api/trade/live/${chain}/report`,route=>{reported.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,reconciliation:{state:"provider_confirmed"}}});});
  await page.goto(`https://app.ravenos.xyz/terminal/?chain=${chain}&market=spot&lane=spot&instrument_type=exact_pool&instrument_id=${chain}%3Apool%3A${POOL}&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${profile.wrapped_native_token_address}&panel=trade`);
  await waitForTerminalLive(page,{lane:"spot",instrument:"TKN/WETH",timeframe:"1h"});
  if(!embedded){await page.locator("#terminalWalletConnect").click();await page.locator("#terminalWalletChooser").getByRole("button",{name:/MetaMask/}).click();}
  return {prepared,reported,controls};
}
for(const chain of Object.keys(EVM_CHAIN_PROFILES))for(const needsApproval of [false,true])test(`${chain} one Buy ${needsApproval?"includes exact token approval":"uses an existing allowance"}`,async({page,baseURL})=>{
  const h=await setup(page,baseURL,chain,{needsApproval});
  await page.locator("#terminalSpotAmount").fill("25");
  await expect(page.locator("#terminalSpotEstimateOutput")).toContainText("50 TKN");
  expect(await page.evaluate(()=>window.tradeCalls.sign+window.tradeCalls.approve)).toBe(0);
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(1);expect(await page.evaluate(()=>window.tradeCalls.approve)).toBe(needsApproval?1:0);expect(h.reported).toHaveLength(1);
});
test("native ETH buy never asks for an ERC20 approval",async({page,baseURL})=>{const h=await setup(page,baseURL,"base",{native:true});await expect(page.locator("#terminalSpotAmount")).toHaveValue("");await page.locator("#terminalSpotAmount").fill("0.01");await page.locator("#terminalSpotQuoteAction").click();await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");expect(await page.evaluate(()=>window.tradeCalls.approve)).toBe(0);expect(h.reported).toHaveLength(1);expect(h.prepared.at(-1).funding_preference).toBe("native");});

test("EVM one Buy selects the network before obtaining its final ticket",async({page,baseURL})=>{
  const h=await setup(page,baseURL,"robinhood",{holdNetwork:true});
  await expect(page.locator("#terminalSpotEstimateOutput")).toContainText("50 TKN");
  const previewCount=h.prepared.length;
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotQuoteAction")).toHaveText("Selecting network…");
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(0);
  expect(h.prepared).toHaveLength(previewCount);
  await page.evaluate(()=>window.finishNetwork());
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Trade confirmed");
  expect(await page.evaluate(()=>window.tradeCalls.network)).toBe(1);
  expect(h.reported).toHaveLength(1);
});
test("editing an EVM order while network selection is pending cannot send the old trade",async({page,baseURL})=>{
  const h=await setup(page,baseURL,"base",{holdNetwork:true});
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotQuoteAction")).toHaveText("Selecting network…");
  await page.locator("#terminalSpotAmount").fill("26");
  await page.evaluate(()=>window.finishNetwork());
  await expect(page.locator("#terminalSpotQuoteAction")).not.toHaveText("Selecting network…");
  expect(await page.evaluate(()=>window.tradeCalls.sign+window.tradeCalls.approve)).toBe(0);
  expect(h.reported).toHaveLength(0);
});

for(const chain of Object.keys(EVM_CHAIN_PROFILES))test(`${chain} Raven wallet restores and one Buy works without Connect`,async({page,baseURL})=>{
  const h=await setup(page,baseURL,chain,{embedded:true,impactBps:640});
  await page.locator('#terminalSpotAmount').fill('25');
  await expect(page.locator('#terminalSpotPriceWarning')).toContainText('6.40%');
  expect(h.prepared.at(-1).slippage_bps).toBe(300);
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(0);
  await page.locator('#terminalSpotQuoteAction').click();
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Trade confirmed');
  expect(h.reported).toHaveLength(1);
  await expect(page.locator('#terminalWalletChooser')).toHaveCount(0);
});

for(const chain of Object.keys(EVM_CHAIN_PROFILES))for(const native of [false,true])test(`${chain} ${native?"native":"stable"} unfunded wallet sees prices without signing`,async({page,baseURL})=>{
  await page.setViewportSize({width:native?390:1440,height:native?844:1000});
  const h=await setup(page,baseURL,chain,{embedded:true,native,fundingError:"insufficient_balance"});
  await page.locator("#terminalSpotAmount").fill(native?"0.002":"25");
  await expect(page.locator("#terminalSpotEstimateOutput")).toHaveText("70 TKN");
  await expect(page.locator("#terminalSpotEstimateMinimum")).toContainText("1.00% Raven fee included");
  await expect(page.locator("#terminalSpotEstimateMinimum")).toContainText("network ≈0.00001");
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Insufficient funds");
  await expect(page.locator("#terminalSpotExitCompact")).toHaveText("Not checked");
  expect(await page.evaluate(()=>window.tradeCalls.sign+window.tradeCalls.approve)).toBe(0);
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Insufficient funds");
  expect(h.reported).toHaveLength(0);
  expect(await page.evaluate(()=>window.tradeCalls.sign+window.tradeCalls.approve)).toBe(0);
});
test("gas readiness keeps the quote visible and a wrong-wallet estimate is rejected",async({page,baseURL})=>{
  const h=await setup(page,baseURL,"base",{embedded:true,fundingError:"insufficient_native_gas_balance"});
  await page.locator("#terminalSpotAmount").fill("25");
  await expect(page.locator("#terminalSpotEstimateOutput")).toHaveText("70 TKN");
  await expect(page.locator("#terminalSpotLiveState")).toHaveText("Gas required");
  h.controls.previewMismatch=true;
  await page.locator("#terminalSpotAmount").fill("26");
  await expect(page.locator("#terminalSpotEstimateOutput")).toHaveText("Estimate unavailable");
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(0);
});
test("funding recovery still respects the minimum shown in the previous estimate",async({page,baseURL})=>{
  const h=await setup(page,baseURL,"base",{embedded:true,fundingError:"insufficient_balance",economicMinimum:"58000000"});
  await page.locator("#terminalSpotAmount").fill("25");
  await expect(page.locator("#terminalSpotEstimateMinimum")).toContainText("Minimum 58 TKN");
  h.controls.fundingError=null;
  await page.locator("#terminalSpotQuoteAction").click();
  await expect(page.locator("#terminalSpotLiveMessage")).toContainText("price moved beyond your displayed minimum");
  expect(h.reported).toHaveLength(0);
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(0);
});

for(const chain of Object.keys(EVM_CHAIN_PROFILES))test(`${chain} account outage recovers into one Buy without signing in or connecting again`,async({page,baseURL})=>{
  await page.setViewportSize({width:390,height:844});
  const h=await setup(page,baseURL,chain,{embedded:true,authFailures:1,holdAuth:true});
  await expect.poll(()=>Boolean(h.controls.releaseAuth)).toBe(true);
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Checking account');
  await expect(page.locator('#terminalSpotLiveLink')).toBeHidden();expect(h.prepared).toHaveLength(0);
  h.controls.holdAuth=false;h.controls.releaseAuth();
  await expect(page.locator('#terminalSpotQuoteAction')).toHaveText('Buy TKN');
  await page.locator('#terminalSpotAmount').fill('25');await expect(page.locator('#terminalSpotEstimateOutput')).toContainText('50 TKN');
  expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(0);
  await page.locator('#terminalSpotQuoteAction').click();await expect(page.locator('#terminalSpotLiveState')).toHaveText('Trade confirmed');
  expect(h.controls.authCalls).toBe(2);expect(h.reported).toHaveLength(1);await expect(page.locator('#terminalWalletChooser')).toHaveCount(0);
  // Returning to the tab during a later outage must retain the submitted result.
  h.controls.authFailures=99;await page.clock.setFixedTime(new Date(Date.now()+61000));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(()=>h.controls.authCalls).toBe(3);
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Trade confirmed');
  await expect.poll(()=>h.controls.authCalls).toBe(4);
  await expect(page.locator('#terminalSpotLiveState')).toHaveText('Trade confirmed');
  expect(h.reported).toHaveLength(1);expect(await page.evaluate(()=>window.tradeCalls.sign)).toBe(1);
});
