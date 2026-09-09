import { test, expect } from '@playwright/test';
import { normalizeChartInstrument, dexscreenerChartSurface } from '../../ravenos-chart-data-plane.js';
import { mockTerminalLiveApis, ROBINHOOD_CONTRACT, ROBINHOOD_POOL, ROBINHOOD_QUOTE } from './terminal-live-fixtures.mjs';

// Model the provider's own controls as well as the plot. An iframe can be visible
// while its toolbar, legend, timeline and attribution consume all candle space.
const providerFixture = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; } html,body { height:100%; margin:0; }
body { display:flex; flex-direction:column; background:#0b1016; color:#cbd5e1; font:12px sans-serif; }
header { flex:0 0 40px; padding:12px; border-bottom:1px solid #334155; }
.legend { flex:0 0 28px; padding:6px 12px; }
[data-testid=provider-plot] { flex:1 1 0; min-height:0; background:repeating-linear-gradient(#0b1016 0 39px,#243142 40px); overflow:hidden; }
svg { display:block; width:100%; height:100%; } .timeline { flex:0 0 32px; padding:9px; }
footer { flex:0 0 42px; padding:14px; text-align:center; background:#06090c; }
</style></head><body><header>1m　5m　15m　1h　4h　D</header><div class=legend>ETH/USDC · Chart fixture</div>
<div data-testid=provider-plot><svg viewBox="0 0 360 240" preserveAspectRatio="none"><path d="M30 190V130 M65 175V110 M100 160V125 M135 180V95 M170 135V80 M205 145V65 M240 100V50 M275 120V40 M310 100V25" stroke="#54cba0" stroke-width="3"/><path d="M30 172V150 M65 145V128 M100 150V133 M135 165V110 M170 120V94 M205 127V76 M240 85V65 M275 103V55 M310 80V40" stroke="#54cba0" stroke-width="12"/></svg></div>
<div class=timeline>10:00　　　　10:30　　　　11:00</div><footer>Provider attribution</footer></body></html>`;

for (const [width,height] of [[375,650],[390,664],[430,740],[1440,1100]]) test(`provider chart preserves readable candles, trade ticket and overlays at ${width}px`, async ({page},testInfo) => {
 await page.setViewportSize({width,height});
 await mockTerminalLiveApis(page,{spotQuotePreview:true,spotQuoteChains:['robinhood']});
 await page.route('https://dexscreener.com/**', route => route.fulfill({contentType:'text/html',body:providerFixture}));
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
 await page.screenshot({path:testInfo.outputPath(`provider-chart-first-open-${width}.png`)});
 const plot = page.frameLocator('#terminalChart iframe.rpw-provider-frame').getByTestId('provider-plot');
 await expect(plot).toBeVisible();
 const plotBox = await plot.boundingBox();
 expect(plotBox.height, 'provider controls must leave at least 200px for candles').toBeGreaterThanOrEqual(200);
 if(width<821) {
  const nav = await page.locator('.ros-mobile-nav').boundingBox();
  const visibleHeight = Math.min(plotBox.y+plotBox.height,nav?.y??height)-Math.max(0,plotBox.y);
  expect(visibleHeight, 'candles must be readable on first open, above mobile navigation').toBeGreaterThanOrEqual(200);
 }
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
