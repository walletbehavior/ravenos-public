import { alchemyWalletHistoryRuntime } from './alchemy_wallet_history.mjs';
import { priceFraction } from './solana_token_metadata.mjs';
import { buildEvmTradingRecord } from './evm_wallet_trading_record.mjs';
import { evmSettlementBases } from './evm_wallet_swaps.mjs';

const DAY=86400, BUCKET=300;
const symbols=new Set(['ETH','SOL','BNB']);
const time=e=>Math.floor(Date.parse(e.chain_evidence?.block_time)/1000);
const mintUSDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const mintSOL='So11111111111111111111111111111111111111112';

// Shared public FX cache. No destination wallets or user identities are sent to
// the price API. At most two missing days are fetched per worker invocation.
export async function loadWalletHistoricalPrices(env,db,events,{fetchImpl=globalThis.fetch,now=Date.now(),maximumDays=2}={}) {
  if (env.RAVENOS_WALLET_HISTORICAL_USD_ENABLED!=='1'||!db?.prepare||!events.length) return [];
  const chain=events[0].source_wallet.chain,symbol=chain==='solana'?'SOL':chain==='bsc'?'BNB':'ETH';
  let runtime;
  for (const candidate of chain==='solana'?['base','robinhood','ethereum']:[chain]) {
    const found=alchemyWalletHistoryRuntime(env,candidate);if(found.enabled){runtime=found;break;}
  }
  if (!runtime) return [];
  const nowSeconds=Math.floor(now/1000), days=[...new Set(events.map(time).filter(t=>Number.isSafeInteger(t)&&t<=nowSeconds&&t>=nowSeconds-180*DAY).map(t=>Math.floor(t/DAY)*DAY))].sort((a,b)=>b-a);
  let remaining=Math.min(2,Math.max(0,maximumDays));
  for (const day of days) {
    if (!remaining) break;
    const lease=await db.prepare(`INSERT INTO ravenos_wallet_price_windows VALUES (?,?,?) ON CONFLICT(symbol,day_at) DO UPDATE SET retry_after=excluded.retry_after WHERE retry_after<=?`).bind(symbol,day,nowSeconds+600,nowSeconds).run();
    if (!lease.meta?.changes) continue;
    remaining--;
    try {
      const key=new URL(runtime.rpc_url).pathname.split('/').at(-1);
      const response=await fetchImpl(`https://api.g.alchemy.com/prices/v1/${key}/tokens/historical`,{method:'POST',headers:{'content-type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(5000),body:JSON.stringify({symbol,startTime:new Date(day*1000).toISOString(),endTime:new Date(Math.min(day+DAY,nowSeconds)*1000).toISOString(),interval:'5m'})});
      if (!response.ok||Number(response.headers.get('content-length'))>128*1024) continue;
      const text=await response.text();if(text.length>128*1024)continue;
      const body=JSON.parse(text);
      if(body.symbol!==symbol||body.currency!=='usd'||!Array.isArray(body.data)||body.data.length>290)continue;
      const seen=new Set(),rows=[];
      for(const row of body.data){
        const at=Date.parse(row.timestamp)/1000;
        if(!Number.isSafeInteger(at)||at<day||at>Math.min(day+DAY,nowSeconds)||at%BUCKET||seen.has(at)||typeof row.value!=='string'||!priceFraction(row.value))throw Error('wallet_historical_price_invalid');
        seen.add(at);rows.push({at,value:row.value});
      }
      for(let i=0;i<rows.length;i+=40)await db.batch(rows.slice(i,i+40).map(row=>db.prepare('INSERT OR IGNORE INTO ravenos_wallet_historical_prices VALUES (?,?,?,?,?)').bind(symbol,row.at,row.value,nowSeconds,'alchemy_historical_5m')));
      // Keep a failed/gapped day retryable; only complete past days are durable.
      const complete=day+DAY<nowSeconds && Array.from({length:288},(_,i)=>day+i*BUCKET).every(at=>seen.has(at));
      if(complete)await db.prepare('UPDATE ravenos_wallet_price_windows SET retry_after=? WHERE symbol=? AND day_at=?').bind(nowSeconds+180*DAY,symbol,day).run();
    } catch { /* Provider errors cannot expose URLs/keys or break wallet reads. */ }
  }
  if(!days.length)return [];
  const rows=await db.prepare('SELECT symbol,bucket_at,price_usd,provider FROM ravenos_wallet_historical_prices WHERE symbol=? AND bucket_at>=? AND bucket_at<=? ORDER BY bucket_at').bind(symbol,days.at(-1),Math.min(days[0]+DAY,nowSeconds)).all();
  return rows.results||[];
}

export function historicalUsdValue(units,decimals,symbol,at,prices) {
  if(!/^[0-9]{1,78}$/.test(String(units))||!Number.isInteger(decimals)||decimals<0||decimals>30||!symbols.has(symbol)||!Number.isFinite(at))return null;
  const bucket=Math.floor(at/BUCKET)*BUCKET;
  const row=prices.find(p=>p.symbol===symbol&&p.bucket_at===bucket);
  const price=row&&priceFraction(row.price_usd);
  if(!price||row.provider!=='alchemy_historical_5m')return null;
  return {micro_usd:(BigInt(units)*price.units*1000000n/(10n**BigInt(decimals+price.scale))).toString(),reference_at:new Date(bucket*1000).toISOString(),provider:row.provider,maximum_reference_age_seconds:BUCKET,rounded:'down_to_micro_usd'};
}

// USD is an analytical view of the existing event ledger. It cannot create a
// Raven fee, reward or Copy signal, and never substitutes today's FX for a fill.
export function walletUsdTradingRecord(profile,events,prices=[]) {
  const chain=profile.source_wallet.chain,solana=chain==='solana';
  const bases=solana ? {[mintUSDC]:{key:'usdc',decimals:6},[mintSOL]:{key:'sol',decimals:9},native_sol:{key:'sol',decimals:9}} : evmSettlementBases(chain);
  const opening={...(profile.wallet_reconstruction?.opening_balances||{})},ordered=[...events].sort((a,b)=>time(a)-time(b)||String(a.event_id).localeCompare(String(b.event_id)));
  let eligible=0,priced=0,missingNativePrices=0;
  const transformed=ordered.map(event=>{
    let accounting=event.wallet_accounting;
    if(solana){
      const economic=event.economic||{},buy=event.classification.kind==='SWAP_BUY',sell=event.classification.kind==='SWAP_SELL';
      const source=economic.source_asset,destination=economic.destination_asset,settlement=buy?source:destination,asset=buy?destination:source;
      const movements=(economic.deltas||[]).map(d=>({contract:d.mint,decimals:d.decimals,delta_raw:d.amount_base_units}));
      for(const d of economic.deltas||[])if(!Object.hasOwn(opening,d.mint)&&/^[0-9]+$/.test(d.balance_before_base_units||''))opening[d.mint]=d.balance_before_base_units;
      accounting={version:1,movements,trade:(buy||sell)&&bases[settlement?.mint]&&asset?{kind:event.classification.kind,token:asset.mint,quantity:asset.amount_base_units,decimals:asset.decimals,basis:bases[settlement.mint],consideration:settlement.amount_base_units}:null};
    }
    const trade=accounting?.trade;let usd=null;
    if(trade){
      eligible++;
      if(trade.basis.key==='usdc'&&trade.basis.decimals===6)usd={micro_usd:trade.consideration,provider:'canonical_usdc_equivalent'};
      else { const symbol={eth:'ETH',weth:'ETH',sol:'SOL',bnb:'BNB',wbnb:'BNB'}[trade.basis.key]; if(symbol){usd=historicalUsdValue(trade.consideration,trade.basis.decimals,symbol,time(event),prices);if(!usd)missingNativePrices++;} }
      if(usd)priced++;
    }
    return {...event,chain_evidence:{...event.chain_evidence,block_number:event.chain_evidence.block_number??event.chain_evidence.slot,transaction_index:event.chain_evidence.transaction_index??0},wallet_accounting:{...accounting,trade:usd?{...trade,basis:{key:'usd',decimals:6},consideration:usd.micro_usd}:null}};
  });
  const record=buildEvmTradingRecord(transformed,{bases:Object.fromEntries(Object.keys(bases).map(k=>[k,{key:'usd',label:'USD reference',decimals:6}])),openingBalances:opening,generatedAt:profile.generated_at,balances:profile.positions?.provider_reported_token_balances||[],valuationBasis:'usd'});
  const network=[];
  for(const event of ordered){
    const paid=solana?event.economic?.wallet_paid_transaction_fee:event.wallet_accounting?.wallet_paid_network_fee;
    const amount=solana?event.economic?.transaction_fee_lamports:event.wallet_accounting?.gas_fee_units;
    if(!paid||!(/^[0-9]+$/.test(String(amount??''))))continue;
    const value=historicalUsdValue(String(amount),solana?9:18,solana?'SOL':chain==='bsc'?'BNB':'ETH',time(event),prices);
    network.push({at:time(event),micro_usd:value?.micro_usd??null});
  }
  for(const [period,days] of [['h24',1],['d7',7],['d30',30],['d90',90],['all_available',Infinity]]){
    const selected=network.filter(n=>n.at>=Date.parse(profile.generated_at)/1000-days*86400),valued=selected.filter(n=>n.micro_usd!==null);
    const amount=valued.reduce((sum,n)=>sum+BigInt(n.micro_usd),0n),digits=amount.toString().padStart(7,'0');
    record.periods[period].observed_network_fee_usd=valued.length?digits.slice(0,-6)+'.'+digits.slice(-6):null;
    record.periods[period].network_fee_observations=selected.length;
    record.periods[period].network_fee_priced_observations=valued.length;
  }
  return {missing_native_prices:missingNativePrices,network_fee_scope:solana?'wallet_paid_solana_transaction_fees':'wallet_paid_receipt_gas_component_extra_l1_fees_not_included',periods:record.periods,tokens:record.tokens,unrealized_summary:record.unrealized_summary,eligible_trades:eligible,priced_trades:priced,coverage_pct:eligible?Math.floor(priced*10000/eligible)/100:null,scope:'historical_5m_fx_and_canonical_usdc_equivalent',network_fees_included:false,price_reference_is_execution_price:false,missing_fx_is_zero:false};
}
