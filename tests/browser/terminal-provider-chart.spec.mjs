import { test, expect } from '@playwright/test';
import { normalizeChartInstrument, dexscreenerChartSurface } from '../../ravenos-chart-data-plane.js';
import { mockTerminalLiveApis, ROBINHOOD_CONTRACT, ROBINHOOD_POOL, ROBINHOOD_QUOTE } from './terminal-live-fixtures.mjs';

for (const width of [390, 1440]) test(`provider chart preserves the trade ticket and overlays at ${width}px`, async ({page},testInfo) => {
 await page.setViewportSize({width,height:width===390?844:1100});
 await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:['robinhood']});
 await page.route('https://dexscreener.com/**', route => route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;background:#0b1016;color:white">Provider chart fixture</body></html>'}));
 await page.route('**/api/terminal/chart**',async route=>{
  const u=new URL(route.request().url());if(u.searchParams.get('chain')!=='robinhood')return route.fallback();
  const args={chain:'robinhood',pairAddress:ROBINHOOD_POOL,tokenAddress:ROBINHOOD_CONTRACT,quoteAddress:ROBINHOOD_QUOTE,timeframe:u.searchParams.get('timeframe')||'1h'};
  const instrument=normalizeChartInstrument({instrumentType:'spot_pool',marketType:'spot',chain:'robinhood',venue:'onchain_pool',symbol:'ETH/USDC',pairAddress:ROBINHOOD_POOL,tokenAddress:ROBINHOOD_CONTRACT,baseAsset:'ETH/USDC',quoteAsset:'USD'});
  return route.fulfill({json:{ok:true,instrument,chart_surface:dexscreenerChartSurface(args),market_identity:`robinhood:${ROBINHOOD_POOL}`,source:'DexScreener',source_label:'DexScreener chart',timeframe:args.timeframe,candles:[],market_state:{last:1.25,observed_at:new Date().toISOString(),source:'DexScreener market snapshot'},market_health:{operator_label:'Chart unavailable',candle_recency_state:'unavailable'},capabilities:{chart_embed:true,live_bars:false,raven_candle_analytics:false},available_scopes:{exact_pool:true},lineage:{raven_observations_are_candles:false}}});
 });
 await page.goto(`/terminal/?asset=ETH%2FUSDC&chain=robinhood&instrument_id=${encodeURIComponent('robinhood:pool:'+ROBINHOOD_POOL)}&lane=spot&market=spot&instrument_type=exact_pool&token_address=${ROBINHOOD_CONTRACT}&quote_address=${ROBINHOOD_QUOTE}`);
 const frame=page.locator('#terminalChart iframe.rpw-provider-frame');
 await expect(frame).toHaveCount(1);await expect(frame).toBeVisible();
 await expect(frame).toHaveAttribute('referrerpolicy','no-referrer');
 await expect(frame).toHaveAttribute('sandbox','allow-scripts allow-same-origin allow-popups');
 await expect(page.locator('#terminalChart [data-rpw-state]')).toHaveText('Chart');
 await expect(page.locator('#terminalMarketFreshness')).toHaveText('Chart');
 await expect(page.locator('[data-terminal-pane-button="chart"]')).not.toContainText('Unavailable');
 if(width===1440) {
  await expect(page.locator('.desk-market-quote').first()).toContainText('1.25');
  await expect(page.locator('.desk-market-quote').first()).toContainText('Snapshot');
 }
 await expect(page.locator('#terminalChart .rpw-chart-tools')).toBeHidden();
 await page.locator('#terminalSpotAmount').fill('37');
 await expect(page.locator('#terminalSpotQuoteAction')).toBeVisible();
 const source=await frame.getAttribute('src');
 await frame.evaluate(el=>{el.dataset.preserved='same-frame';});
 await page.locator('[data-terminal-pane-button="holders"]').click();
 await expect(page.locator('.ros-intelligence-layer')).toBeVisible();await page.keyboard.press('Escape');
 await expect(frame).toHaveAttribute('data-preserved','same-frame');await expect(frame).toHaveAttribute('src',source);
 await expect(page.locator('#terminalSpotAmount')).toHaveValue('37');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
 await page.screenshot({path:testInfo.outputPath(`provider-chart-${width}.png`)});
 await page.locator('[data-market-section="perps"]').click();
 await expect(frame).toHaveCount(0);
 await expect(page.locator('#terminalChart canvas').first()).toBeVisible();
});
