import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { priceFraction } from './solana_token_metadata.mjs';
import { atomicToDecimal } from '../agentic_trading/decimal.mjs';
import { MarketProviderReader, sharedMarketProviderReader } from '../market_provider_fallbacks.mjs';

// Public token references only. These marks never establish a fill, exit quote,
// fee or reward. The edge cache is shared within a Cloudflare location; retained
// wallet profiles remain the durable, cache-first browsing layer.
export const WalletMarkPolicy = Object.freeze({
  version: 1, ttl_seconds: 300, retry_seconds: 60, maximum_tokens: 60,
  batch_size: 30, minimum_liquidity_usd: 10000, maximum_pool_disagreement_bps: 1500,
  maximum_cache_rows: 2048,
});
const memory = new Map(), inFlight = new Map();
const chains = new Set(['solana','base','ethereum','robinhood','bsc']);
const key = (chain, contract) => `${chain}:${contract}`;
const request = (chain, contract) => new Request(`https://app.ravenos.xyz/__wallet-marks/v1/${chain}/${contract}`);
function identity(chain, value) {
  if (!chains.has(chain)) return null;
  try { return normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:value}).address; } catch { return null; }
}
const fixed = value => { const p=priceFraction(value);return p ? atomicToDecimal(p.units,p.scale) : null; };
const micros = value => { const p=priceFraction(value);return p ? p.units*1000000n/(10n**BigInt(p.scale)) : null; };
function valid(row, chain, contract, now) {
  return row?.version===WalletMarkPolicy.version && row.chain===chain && row.contract===contract
    && Number.isSafeInteger(row.sampled_at) && row.sampled_at<=now && row.expires_at>now
    && row.expires_at<=row.sampled_at+WalletMarkPolicy.ttl_seconds
    && ['available','thin_liquidity','inactive_market','conflicting_pools','no_qualified_market','provider_unavailable'].includes(row.state)
    && (row.state!=='available' || (fixed(row.price) && row.provider==='dexscreener_pool_reference'
      && identity(chain,row.pool_address) && row.liquidity_usd>=WalletMarkPolicy.minimum_liquidity_usd));
}
function remember(row, priceCache=memory) {
  while(priceCache.size>=WalletMarkPolicy.maximum_cache_rows)priceCache.delete(priceCache.keys().next().value);
  priceCache.set(key(row.chain,row.contract),row);
}

export function selectWalletTokenMark(chain, contract, pairs, now=Math.floor(Date.now()/1000)) {
  const id=identity(chain,contract); if (!id) return null;
  const rows=[], reasons=[];
  for(const pair of pairs) {
    if(pair?.chainId!==chain || identity(chain,pair.baseToken?.address)!==id)continue;
    const pool=identity(chain,pair.pairAddress),quote=identity(chain,pair.quoteToken?.address),price=fixed(pair.priceUsd);
    if(!pool||!quote||quote===id||!price||!Number.isFinite(pair.liquidity?.usd)||pair.liquidity.usd>1e12)continue;
    if(pair.liquidity.usd<WalletMarkPolicy.minimum_liquidity_usd){reasons.push('thin_liquidity');continue;}
    const buys=pair.txns?.h1?.buys,sells=pair.txns?.h1?.sells;
    if(!Number.isSafeInteger(buys)||!Number.isSafeInteger(sells)||buys<0||sells<0||buys+sells===0){reasons.push('inactive_market');continue;}
    rows.push({price,pool_address:pool,quote_contract:quote,liquidity_usd:pair.liquidity.usd});
  }
  rows.sort((a,b)=>b.liquidity_usd-a.liquidity_usd||a.pool_address.localeCompare(b.pool_address));
  const selected=rows[0];let state=selected?'available':reasons.includes('thin_liquidity')?'thin_liquidity':reasons[0]||'no_qualified_market';
  // A second substantial pool disagreeing by >15% makes the reference unknown.
  if(selected) for(const other of rows.slice(1).filter(r=>r.liquidity_usd>=selected.liquidity_usd/4)) {
    const a=priceFraction(selected.price),b=priceFraction(other.price),scale=Math.max(a.scale,b.scale);
    const x=a.units*10n**BigInt(scale-a.scale),y=b.units*10n**BigInt(scale-b.scale),diff=x>y?x-y:y-x;
    if(diff*10000n>x*BigInt(WalletMarkPolicy.maximum_pool_disagreement_bps)){state='conflicting_pools';break;}
  }
  return {version:1,chain,contract:id,state,...(state==='available'?selected:{price:null}),
    provider:'dexscreener_pool_reference',sampled_at:now,observed_at:new Date(now*1000).toISOString(),
    expires_at:now+(state==='available'?WalletMarkPolicy.ttl_seconds:WalletMarkPolicy.retry_seconds),
    price_timestamp_available:false,scope:'active_pool_indicative_reference',executable_valuation_available:false};
}

// Seed from responses Raven already fetched for Discover/Terminal. A cache hit
// does not reset observation time. No additional provider request is made here.
export function rememberSeenWalletTokenMarks(pairs,{now=Math.floor(Date.now()/1000),priceCache=memory}={}) {
  if(!Array.isArray(pairs)||pairs.length>1000)return;
  const subjects=new Map();
  for(const pair of pairs){const id=identity(pair?.chainId,pair?.baseToken?.address);if(id)subjects.set(key(pair.chainId,id),[pair.chainId,id]);}
  for(const [chain,contract] of [...subjects.values()].slice(0,60))remember(selectWalletTokenMark(chain,contract,pairs,now),priceCache);
}

export async function readRetainedWalletTokenMarks({chain,contracts,now=Math.floor(Date.now()/1000),cache,priceCache=memory}) {
  const ids=[...new Set(contracts.map(id=>identity(chain,id)).filter(Boolean))].slice(0,WalletMarkPolicy.maximum_tokens);
  const rows=await Promise.all(ids.map(async contract=>{
    let row=priceCache.get(key(chain,contract));
    if(valid(row,chain,contract,now))return row;
    priceCache.delete(key(chain,contract));
    try { const hit=cache&&await cache.match(request(chain,contract));if(hit){const text=await hit.text();if(text.length<=2048)row=JSON.parse(text);if(valid(row,chain,contract,now)){remember(row,priceCache);return row;}} } catch { /* cache failure is not a provider mark */ }
    return null;
  }));
  return {rows:rows.filter(r=>r?.state==='available'),observations:rows.filter(Boolean),requested_tokens:ids.length};
}

export async function loadWalletTokenMarks({chain,contracts,now=Math.floor(Date.now()/1000),cache,priceCache=memory,fetchImpl,providerReader}) {
  const ids=[...new Set(contracts.map(id=>identity(chain,id)).filter(Boolean))].slice(0,WalletMarkPolicy.maximum_tokens);
  const retained=await readRetainedWalletTokenMarks({chain,contracts:ids,now,cache,priceCache});
  const missing=ids.filter(id=>!retained.observations.some(row=>row.contract===id));let requests=0;
  const reader=providerReader || (fetchImpl ? new MarketProviderReader({fetchFn:fetchImpl,now:()=>now*1000,cache:()=>cache}) : sharedMarketProviderReader);
  for(let offset=0;offset<missing.length;offset+=WalletMarkPolicy.batch_size){
    const batch=missing.slice(offset,offset+WalletMarkPolicy.batch_size).sort(),flight=chain+':'+batch.join(',');
    let running=inFlight.get(flight);
    if(!running){
      running=(async()=>{
        let observations,readCounted=false;
        try {
          const snapshot=await reader.snapshot(`https://api.dexscreener.com/tokens/v1/${chain}/${batch.join(',')}`,{ttlMs:30000,maxBytes:512*1024,timeoutMs:3500});
          requests+=snapshot.cache_hit?0:1;readCounted=true;
          const pairs=snapshot.value,observed=Math.floor(Date.parse(snapshot.observed_at)/1000);
          if(!Array.isArray(pairs)||pairs.length>1000||!Number.isSafeInteger(observed)||observed>now+10||now-observed>30)throw Error('invalid');
          observations=batch.map(id=>selectWalletTokenMark(chain,id,pairs,Math.min(now,observed)));
        } catch(error) {
          if(!readCounted&&error?.code!=='market_provider_backoff')requests++;
          observations=batch.map(contract=>({version:1,chain,contract,state:'provider_unavailable',price:null,sampled_at:now,expires_at:now+WalletMarkPolicy.retry_seconds}));
        }
        await Promise.all(observations.map(async row=>{
          remember(row,priceCache);
          try {if(cache)await cache.put(request(chain,row.contract),new Response(JSON.stringify(row),{headers:{'content-type':'application/json','cache-control':`public, max-age=${row.expires_at-now}`}}));}catch{/* cache failure does not block the profile */}
        }));
        return observations;
      })().finally(()=>inFlight.delete(flight));
      inFlight.set(flight,running);
    }
    retained.observations.push(...await running);
  }
  return {...retained,rows:retained.observations.filter(row=>row.state==='available'),request_count:requests,
    cached_tokens:ids.length-missing.length,unavailable:retained.observations.filter(row=>row.state!=='available').map(row=>({contract:row.contract,reason:row.state}))};
}

export function applyWalletTokenMark(token, mark) {
  const contract=token.contract||token.mint,units=token.balance_raw||token.balance_base_units;
  if(mark?.state!=='available'||mark.contract!==contract||!/^\d{1,78}$/.test(units||'')||!Number.isInteger(token.decimals)||token.decimals<0||token.decimals>30)return token;
  const price=priceFraction(mark.price);if(!price)return token;
  const value=atomicToDecimal(BigInt(units)*price.units*1000000n/(10n**BigInt(token.decimals+price.scale)),6);
  return {...token,provider_mark_price_usd:mark.price,provider_mark_value_usd:value,price_authority:mark.provider,
    mark_source:mark.provider,mark_observed_at:mark.observed_at,mark_evidence:{pool_address:mark.pool_address,liquidity_usd:mark.liquidity_usd,
      price_timestamp_available:false,position_exceeds_ten_percent_of_pool:micros(value)>micros(mark.liquidity_usd)/10n},executable_valuation_available:false};
}

export function walletTokenMarkSummary(tokens=[]) {
  const marked=tokens.flatMap(token=>{
    const text=String(token.provider_mark_value_usd??'');if(!/^\d{1,60}(?:\.\d{1,6})?$/.test(text))return [];
    const [whole,fraction='']=text.split('.');return [{token,value:BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))}];
  });
  const total=marked.reduce((sum,row)=>sum+row.value,0n),largest=marked.reduce((a,b)=>!a||b.value>a.value?b:a,null);
  return {visible_provider_mark_value_usd:marked.length?atomicToDecimal(total,6):null,visible_priced_rows:marked.length,
    visible_unpriced_rows:tokens.length-marked.length,largest_visible_provider_mark_weight_pct:total?Number(largest.value*10000n/total)/100:null,
    largest_visible_provider_mark_symbol:largest?.token.symbol||null,scope:'priced_tokens_only_excludes_native_balance',executable_valuation_available:false};
}
