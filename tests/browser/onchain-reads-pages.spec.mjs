import { test, expect } from '@playwright/test';
import { mockTerminalLiveApis, ROBINHOOD_CONTRACT, ROBINHOOD_POOL, ROBINHOOD_QUOTE } from './terminal-live-fixtures.mjs';
import { retainOnchainReadObservations, buildOnchainRavenReads } from '../../lib/onchain_raven_reads.mjs';
import { buildDiscoverRadarProjection } from '../../lib/discover_radar.mjs';
import { onchainMarketPages } from '../../lib/onchain_market_pages.mjs';
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
function market(i=1,at=Date.now(),price=1.03,chain='base') {
  const pool=chain==='robinhood'?ROBINHOOD_POOL:addr(10000+i),token=chain==='robinhood'?ROBINHOOD_CONTRACT:addr(i);
  return { instrument_id:`${chain}:pool:${pool}`,pool_address:pool,chain_id:chain,chain,
    token_address:token,quote_token_address:chain==='robinhood'?ROBINHOOD_QUOTE:addr(999999),quote_symbol:'WETH',
    symbol:chain==='robinhood'?'RUNNER':`MEME${i}`,name:`Meme ${i}`,venue:'uniswap',source_type:'market_activity',market_type:'spot',identity_scope:'exact_pool',
    observed_at:new Date(at).toISOString(),research_only:true,actionable:false,execution_available:false,
    market:{price_usd:price,market_cap_usd:2000000,liquidity_usd:100000,holder_count:150,market_age_seconds:172800,
      ...Object.fromEntries(['5m','1h','24h'].flatMap(w=>[[`buys_${w}`,80],[`sells_${w}`,20],[`volume_usd_${w}`,15000],[`price_change_${w}_pct`,3]]))} };
}
function reads(chain='base',timeframe='5m',now=Date.now()) {
  const row=retainOnchainReadObservations(market(1,now,1.03,chain),retainOnchainReadObservations(market(1,now-60000,1,chain)));
  return buildOnchainRavenReads({ok:true,rows:[row],generated_at:new Date(now).toISOString()},{nowMs:now,timeframe});
}
function pulse(count=1) {
  const now=Date.now(),generated_at=new Date(now).toISOString();
  const radar=buildDiscoverRadarProjection(Array.from({length:count},(_,i)=>market(i+1,now)),{generatedAt:generated_at,nowMs:now,maxRows:10000});
  return {ok:true,safe_public:true,schema_version:'ravenos.onchain_market_pulse.v1',state:'current',generated_at,duration:'5m',chains:['base'],
    freshness:{state:'current'},rows:radar.rows,discovery_radar:{...radar,schema_version:'ravenos.discover_radar_summary.v1',projection_schema_version:radar.schema_version,rows:undefined,rows_duplicated:false},
    universe:{sampled_tokens:count,qualified_tokens:count},provenance:{role:'exact_pool_market_activity',raven_signal:false},
    execution_boundary:{research_only:true,signing_available:false,submission_available:false}};
}
test.afterEach(async({page})=>page.unrouteAll({behavior:'wait'}));

for(const width of [390,1440]) test(`${width}px: Discovery and section Reads populate from the independent onchain reader`,async({page})=>{
  await page.setViewportSize({width,height:900});await mockTerminalLiveApis(page);
  await page.route('**/api/onchain/reads?**',route=>route.fulfill({json:reads('base',new URL(route.request().url()).searchParams.get('duration')||'5m')}));
  await page.route('**/api/onchain/trending?**',route=>route.fulfill({json:pulse()}));
  await page.goto('/discover/?market_scope=memecoins&view=reads');
  await expect(page.locator('#discoverTokenTapeList .discover-token-row')).toHaveCount(1);
  await expect(page.locator('#discoverTokenTapeList')).toContainText('Buy activity with rising price');
  await page.locator('[data-spot-timeframe="1h"]').click();
  await expect(page.locator('#discoverTokenTapeList')).toContainText('1h price');
  await page.goto('/opportunity/?market_scope=memecoins');
  await expect(page.locator('[data-read-market-scope="memecoins"]')).toHaveCount(1);
  await expect(page.locator('#routePrimaryPanel')).toContainText('Buy activity with rising price');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const width of [390,1440]) test(`${width}px: Discovery loads all 2,301 qualifying tokens through bounded pages`,async({page})=>{
  await page.setViewportSize({width,height:900});await mockTerminalLiveApis(page);
  const pages=onchainMarketPages(pulse(2301)),requests=[];
  await page.route('**/api/onchain/reads?**',route=>route.fulfill({status:503,json:{ok:false}}));
  await page.route('**/api/onchain/trending?**',route=>{
    const url=new URL(route.request().url());requests.push(url.searchParams.get('cursor'));
    const offset=Number(url.searchParams.get('cursor')?.split('.')[1]||0);
    return route.fulfill({json:pages[offset/500]});
  });
  await page.goto('/discover/?market_scope=memecoins');
  await expect(page.locator('#discoverSpotResultState')).toContainText('of 2,301 qualifying',{timeout:15000});
  await expect(page.locator('#discoverSpotPage')).toContainText('of 24');
  await expect(page.locator('#discoverTokenTapeList .discover-token-row')).toHaveCount(100);
  expect(requests.filter(Boolean)).toHaveLength(4);
  await page.locator('#discoverSpotNext').click();
  await expect(page.locator('#discoverSpotResultState')).toContainText('101–200');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('Terminal requests the same exact pool Read and displays its measured pressure evidence',async({page})=>{
  await mockTerminalLiveApis(page);
  const requested=[];
  await page.route('**/api/onchain/reads?**',route=>{
    const url=new URL(route.request().url());requested.push(url.searchParams.get('instrument_id'));
    const payload=reads('robinhood','1h');payload.selected_discovery_market=payload.discovery_radar.rows[0];
    return route.fulfill({json:payload});
  });
  await page.goto('/terminal/?'+new URLSearchParams({market_scope:'memecoins',market:'spot',chain:'robinhood',instrument_id:`robinhood:pool:${ROBINHOOD_POOL}`,pair_address:ROBINHOOD_POOL,token_address:ROBINHOOD_CONTRACT,quote_address:ROBINHOOD_QUOTE,asset:'RUNNER/WETH'}));
  await expect(page.locator('#terminalReadHeadline')).toContainText('Buy activity with rising price');
  await expect(page.locator('#terminalReadSummary')).toContainText('1h price');
  expect(requested).toContain(`robinhood:pool:${ROBINHOOD_POOL}`);
});
