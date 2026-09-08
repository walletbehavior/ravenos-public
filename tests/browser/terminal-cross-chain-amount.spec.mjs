import {test,expect} from '@playwright/test';
import {mockTerminalLiveApis,openExactSpotSearch,waitForTerminalLive} from './terminal-live-fixtures.mjs';
import {EVM_CHAIN_PROFILES} from '../../lib/customer_trade/evm_chain_profiles.mjs';
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'wait'});});
const solanaUrl='/terminal/?market_scope=memecoins&instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=trade';

for(const destination of [{query:'RUNNER',chain:'robinhood',symbol:'ETH',instrument:'RUNNER/WETH'},{query:'MEMESTOCK',chain:'bsc',symbol:'BNB',instrument:'MEMESTOCK/GMEB'}]) {
  test(`Solana to ${destination.chain} clears the prior native balance and amount`,async({page})=>{
    await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:['solana','robinhood','bsc'],spotQuoteBalance:{available:true,amount:{display:'0.123456',symbol:'SOL'},source:'current_exact_mint_balance',persisted:false}});
    await page.goto(solanaUrl);
    await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});
    await page.locator('[data-spot-asset-preference="native"]').click();
    await page.locator('#terminalSpotAmount').fill('0.15');
    await expect(page.locator('#terminalSpotBalance')).toHaveText('0.123456');
    await expect(page.locator('#terminalSpotBuyPresets')).toContainText('SOL');
    await openExactSpotSearch(page,destination.query);
    await waitForTerminalLive(page,{lane:'spot',instrument:destination.instrument,timeframe:'1h'});
    await page.locator('[data-terminal-pane-button="trade"]').click();
    await expect(page.locator('#terminalSpotAmount')).toHaveValue('');
    await expect(page.locator('#terminalSpotBalance')).not.toHaveText('0.123456');
    await expect(page.locator('#terminalSpotBalanceUnit')).toHaveText(destination.symbol);
    await expect(page.locator('#terminalSpotBuyPresets')).not.toContainText('SOL');
    await expect(page.locator('#terminalSpotBuyPresets')).toContainText(destination.symbol);
  });
  for(const native of [true,false])test(`saved market switch to ${destination.chain} ${native?'resets native sizes':'preserves dollar sizes'}`,async({page})=>{
    await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:['solana','robinhood','bsc'],spotQuoteBalance:input=>String(input.instrument_id).startsWith('solana:')?{available:true,amount:{display:'0.123456',symbol:input.funding_preference==='native'?'SOL':'USDC'}}:{available:false}});
    await page.goto(solanaUrl);
    await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});
    await openExactSpotSearch(page,destination.query);
    await waitForTerminalLive(page,{lane:'spot',instrument:destination.instrument,timeframe:'1h'});
    await page.goto(solanaUrl);
    await waitForTerminalLive(page,{lane:'spot',instrument:'JUP/USDC',timeframe:'1h'});
    await page.locator(`[data-spot-asset-preference="${native?'native':'canonical_usdc'}"]`).click();
    await page.locator('#terminalSpotAmount').fill(native?'0.15':'35');
    await expect(page.locator('#terminalSpotBalance')).toHaveText('0.123456');
    await page.locator('.desk-market-open').filter({hasText:destination.instrument}).click();
    await waitForTerminalLive(page,{lane:'spot',instrument:destination.instrument,timeframe:'1h'});
    await expect(page.locator('#terminalSpotAmount')).toHaveValue(native?'':'35');
    await expect(page.locator('#terminalSpotBalance')).not.toHaveText('0.123456');
    await expect(page.locator('#terminalSpotBalanceUnit')).toHaveText(native?destination.symbol:EVM_CHAIN_PROFILES[destination.chain].accounting_asset.symbol);
    await expect(page.locator('#terminalSpotBuyPresets')).not.toContainText('SOL');
    await expect(page.locator('#terminalSpotBuyPresets')).toContainText(native?destination.symbol:'$');
  });
}
