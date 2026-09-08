import {test,expect} from "@playwright/test";
import {mockTerminalLiveApis,waitForTerminalLive} from "./terminal-live-fixtures.mjs";
import {EVM_CHAIN_PROFILES} from "../../lib/customer_trade/evm_chain_profiles.mjs";
test.afterEach(async ({page}) => { await page.unrouteAll({behavior:"wait"}); });
const WALLET="0x3333333333333333333333333333333333333333", TOKEN="0x1111111111111111111111111111111111111111", POOL="0x2222222222222222222222222222222222222222";
async function setup(page,baseURL,chain,{needsApproval=false,native=false,holdNetwork=false}={}) {
  const profile=EVM_CHAIN_PROFILES[chain];const prepared=[],reported=[];
  await page.route("https://app.ravenos.xyz/**",async route=>{const url=new URL(route.request().url());await route.fulfill({response:await page.request.fetch(`${baseURL}${url.pathname}${url.search}`)});});
  await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:[chain,"solana"]});
  await page.route("**/api/dexscreener/pair**",route=>route.fulfill({json:{ok:true,results:[{chainId:chain,dexId:"uniswap",pairAddress:POOL,tokenAddress:TOKEN,quoteTokenAddress:profile.wrapped_native_token_address,symbol:"TKN",quoteSymbol:"WETH",name:"Token",priceUsd:1,liquidityUsd:1000000,volume24h:300000,lastUpdated:new Date().toISOString()}]}}));
  await page.route("**/api/v1/auth/session",route=>route.fulfill({json:{ok:true,authenticated:true,csrf_token:"fixturecsrf"}}));
  await page.route("**/api/trade/live/session",route=>route.fulfill({json:{ok:true,gate:{configured:true,chains:{[chain]:{available_to_principal:true}}}}}));
  await page.route("**/api/v1/wallets/privy",route=>route.fulfill({json:{ok:true,available:false}}));
  await page.addInitScript(({wallet,chainHex,native,holdNetwork})=>{
    window.tradeCalls={sign:0,approve:0,network:0};
    if(native)localStorage.setItem("ravenos.universal_shadow_ticket_preferences.v1",JSON.stringify({funding_preference:"native"}));
    window.ethereum={isMetaMask:true,on:()=>{},request:async({method})=>{if(["eth_accounts","eth_requestAccounts"].includes(method))return [wallet];if(method==="eth_chainId")return chainHex;throw Error(method);}};
    window.RavenOSWalletExecution={
      ensureEvmWalletNetwork:async({assertCurrent})=>{assertCurrent();window.tradeCalls.network++;if(holdNetwork)await new Promise(resolve=>{window.finishNetwork=resolve;});assertCurrent();},
      approveEvmTradeToken:async({approval,expectedAmount,assertCurrent})=>{assertCurrent();if(approval.amount_base_units!==expectedAmount)throw Error("test_amount_mismatch");window.tradeCalls.approve++;return {state:"confirmed"};},
      executeEvmZeroXTicket:async({ticket,assertCurrent})=>{assertCurrent();window.tradeCalls.sign++;return {ticket_id:ticket.ticket_id,transaction_hash:`0x${"a".repeat(64)}`};},
    };
  },{wallet:WALLET,chainHex:profile.wallet_chain_id_hex,native,holdNetwork});
  await page.route(`**/api/trade/live/${chain}/prepare`,async route=>{
    const input=route.request().postDataJSON();prepared.push(input);const expires=new Date(Date.now()+30000).toISOString();
    const sellToken=input.funding_preference==="native"?profile.native_token_address:profile.accounting_asset.address;
    const amount=(BigInt(input.display_amount.replace(".",""))*10n**BigInt((input.funding_preference==="native"?18:profile.accounting_asset.decimals)-(input.display_amount.split(".")[1]?.length||0))).toString();
    if(needsApproval&&await page.evaluate(()=>window.tradeCalls.approve===0))return route.fulfill({status:409,json:{ok:false,error:"allowance_required",details:{blockers:["allowance_required"],approval:{schema_version:"ravenos.exact_token_approval.v1",profile_id:profile.profile_id,chain_id:profile.chain_id,wallet_address:WALLET,spender:profile.allowance_holder,token_address:sellToken,amount_base_units:amount,output_token:TOKEN,expected_output_base_units:"50000000",minimum_output_base_units:"49000000",output_decimals:6,input_decimals:profile.accounting_asset.decimals,instrument_id:input.instrument_id,pool_address:input.pool_address,side:"buy",expires_at:expires,unlimited:false}}}});
    return route.fulfill({json:{ok:true,schema_version:chain==="robinhood"?"ravenos.robinhood_live_prepare_response.v1":"ravenos.evm_live_prepare_response.v1",ticket:{schema_version:chain==="robinhood"?"ravenos.robinhood_live_ticket.v1":"ravenos.evm_live_ticket.v1",ticket_id:`ticket-${prepared.length}`,profile_id:profile.profile_id,chain_namespace:chain,chain_id:profile.chain_id,wallet_address:WALLET,expires_at:expires,exact_market:{instrument_id:input.instrument_id,pool_address:input.pool_address},reviewed_order:{side:"buy",sell_token:sellToken,buy_token:TOKEN,expected_buy_amount_base_units:"50000000",minimum_buy_amount_base_units:"49000000"},exit_proof:{verified:true},fee:{fee_bps:100},accounting:{notional_base_units:"25000000",decimals:6}},provider_quote:{provider_quote_id:"fixturequote",observed_at:new Date().toISOString(),route:{fills:[{source:"Uniswap"}]}},review:{expected_output:{display:"50",base_units:"50000000",symbol:"TKN"},minimum_output:{display:"49",base_units:"49000000",symbol:"TKN"},executable_exit:{display:"24"}}}});
  });
  await page.route(`**/api/trade/live/${chain}/report`,route=>{reported.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,reconciliation:{state:"provider_confirmed"}}});});
  await page.goto(`https://app.ravenos.xyz/terminal/?chain=${chain}&market=spot&lane=spot&instrument_type=exact_pool&instrument_id=${chain}%3Apool%3A${POOL}&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${profile.wrapped_native_token_address}&panel=trade`);
  await waitForTerminalLive(page,{lane:"spot",instrument:"TKN/WETH",timeframe:"1h"});
  await page.locator("#terminalWalletConnect").click();await page.locator("#terminalWalletChooser").getByRole("button",{name:/MetaMask/}).click();
  return {prepared,reported};
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
