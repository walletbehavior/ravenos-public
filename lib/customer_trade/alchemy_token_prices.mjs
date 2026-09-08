import { atomicToDecimal } from '../agentic_trading/decimal.mjs';
import { priceFraction } from './solana_token_metadata.mjs';
const cache = new Map();
const networks={ethereum:'eth-mainnet',base:'base-mainnet',bsc:'bnb-mainnet',robinhood:'robinhood-mainnet'};
const address=v=>/^0x[0-9a-f]{40}$/i.test(v||'')?v.toLowerCase():null;
export function preciseTokenMark(units,decimals,price) {
  const fraction=priceFraction(price);
  if(!fraction||!/^\d{1,78}$/.test(units||'')||!Number.isInteger(decimals)||decimals<0||decimals>30)return null;
  return atomicToDecimal(BigInt(units)*fraction.units*1000000n/(10n**BigInt(decimals+fraction.scale)),6);
}
export async function loadAlchemyTokenPrices({chain,contracts,rpcUrl,fetchImpl=fetch,now=Date.now(),priceCache=cache}) {
  const network=networks[chain];let endpoint;try{endpoint=new URL(rpcUrl);}catch{return {rows:[],request_count:0,state:'unavailable'};}
  if(!network||endpoint.hostname!==network+'.g.alchemy.com'||endpoint.protocol!=='https:'||!/^\/v2\/[A-Za-z0-9_-]+$/.test(endpoint.pathname))return {rows:[],request_count:0,state:'unavailable'};
  const ids=[...new Set(contracts.map(address).filter(Boolean))].slice(0,40);
  for(const [key,row] of priceCache)if(row.expires<=now)priceCache.delete(key);
  const missing=ids.filter(id=>!priceCache.has(network+':'+id)); let failed=false;
  if(missing.length)try {
    const result=await fetchImpl(`https://api.g.alchemy.com/prices/v1/${endpoint.pathname.slice(4)}/tokens/by-address`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({addresses:missing.map(address=>({network,address}))}),redirect:'manual',signal:AbortSignal.timeout(3500)});
    if(!result.ok)throw Error('prices_unavailable');
    const text=await result.text();if(text.length>128000)throw Error('prices_too_large');
    const body=JSON.parse(text);if(!Array.isArray(body.data)||body.data.length>missing.length)throw Error('prices_invalid');
    const seen=new Set(),staged=new Map();
    for(const row of body.data) {
      const id=address(row.address);if(row.network!==network||!missing.includes(id)||seen.has(id))throw Error('price_identity_invalid');seen.add(id);
      if(row.error)continue;
      const price=row.prices?.find(p=>String(p.currency).toLowerCase()==='usd');
      const at=Date.parse(price?.lastUpdatedAt),fraction=priceFraction(price?.value);
      if(!fraction||!Number.isFinite(at)||at>now+60000||now-at>900000)continue;
      staged.set(network+':'+id,{value:{contract:id,price:atomicToDecimal(fraction.units,fraction.scale),observed_at:new Date(at).toISOString(),provider:'alchemy_prices'},expires:Math.min(now+300000,at+900000)});
    }
    for(const id of missing)if(!staged.has(network+':'+id))staged.set(network+':'+id,{value:null,expires:now+60000});
    // Commit only after every response identity has been checked.
    for(const [key,row] of staged){while(priceCache.size>=1024)priceCache.delete(priceCache.keys().next().value);priceCache.set(key,row);}
  } catch {failed=true;}
  return {rows:ids.flatMap(id=>priceCache.get(network+':'+id)?.value?[priceCache.get(network+':'+id).value]:[]),request_count:missing.length?1:0,state:failed?'unavailable':'available'};
}
