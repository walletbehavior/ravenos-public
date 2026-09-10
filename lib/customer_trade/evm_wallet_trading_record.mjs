import { atomicToDecimal, decimalToAtomic } from '../agentic_trading/decimal.mjs';
import { evmAnalyticalSettlementEvent } from './evm_wallet_swaps.mjs';

export const EVM_WALLET_TRADING_PROFILE_VERSION = 5;

const signed=(n,d)=>(n<0n?'-':'')+atomicToDecimal(n<0n?-n:n,d);
const ratio=(n,d)=>d>0n?Number(n*10000n/d)/100:null;
const mean=rows=>rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length):null;
const sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0n);

// Analytical FIFO only: this does not touch execution, fees, rewards or Copy
// authority. Unknown starting inventory occupies real lots with unknown cost.
export function buildEvmTradingRecord(events,{bases,openingBalances={},generatedAt,balances=[],valuationBasis="usdc"}) {
  const ordered=[...events].filter(e=>e.wallet_accounting?.version===1)
    .sort((a,b)=>a.chain_evidence.block_number-b.chain_evidence.block_number||a.chain_evidence.transaction_index-b.chain_evidence.transaction_index||a.event_id.localeCompare(b.event_id));
  const definitions=Object.fromEntries(Object.values(bases).map(b=>[b.key,b]));
  const settlement=new Set(Object.keys(bases)),lots=new Map(),unknown=new Set(),tokenStats=new Map(),closes=[],trades=[];
  const now=Date.parse(generatedAt),precisions=new Map(),invalidTokens=new Set(),movementTokens=new Set();
  for(const event of ordered)for(const movement of event.wallet_accounting.movements){
    movementTokens.add(movement.contract);
    if(!/^[-]?[0-9]{1,78}$/.test(movement.delta_raw||''))invalidTokens.add(movement.contract);
    // Transfers retain exact raw units even when their display metadata was
    // unavailable. Missing metadata is not a conflicting precision assertion.
    if(movement.decimals==null)continue;
    if(!Number.isInteger(movement.decimals)||movement.decimals<0||movement.decimals>30){invalidTokens.add(movement.contract);continue;}
    if(precisions.has(movement.contract)&&precisions.get(movement.contract)!==movement.decimals)invalidTokens.add(movement.contract);
    precisions.set(movement.contract,movement.decimals);
  }
  for(const contract of movementTokens)if(!precisions.has(contract))invalidTokens.add(contract);
  const ensure=(contract,decimals)=>{
    if(lots.has(contract))return;
    const opening=openingBalances[contract];
    if(!/^[0-9]+$/.test(opening??''))unknown.add(contract);
    lots.set(contract,opening&&BigInt(opening)>0n?[{quantity:BigInt(opening),cost:null,basis:null,opened:null}]:[]);
    tokenStats.set(contract,{mint:contract,decimals,buy_count:0,sell_count:0,first_trade_at:null,last_trade_at:null});
  };
  for(const event of ordered) {
    const accounting=event.wallet_accounting,at=Date.parse(event.chain_evidence.block_time);
    if(!Number.isFinite(at)||at>now)continue;
    const trade=accounting.trade;
    for(const movement of accounting.movements) {
      if(settlement.has(movement.contract)||invalidTokens.has(movement.contract))continue;
      const {contract}=movement,decimals=precisions.get(contract); ensure(contract,decimals);
      const list=lots.get(contract),stats=tokenStats.get(contract),delta=BigInt(movement.delta_raw);
      // A trade still needs its own verified precision. Reusing a consistent
      // scale for raw transfer inventory cannot create a buy or known cost.
      const matchedTrade=movement.decimals===decimals&&trade?.token===contract&&definitions[trade.basis.key]?.decimals===trade.basis.decimals&&trade.decimals===decimals&&trade.quantity===String(delta<0n?-delta:delta);
      if(matchedTrade) {
        const entry={...trade,at,amount:BigInt(trade.consideration)};trades.push(entry);
        stats[trade.kind==='SWAP_BUY'?'buy_count':'sell_count']++;
        stats.first_trade_at??=event.chain_evidence.block_time;stats.last_trade_at=event.chain_evidence.block_time;
      }
      if(delta>0n) {
        const known=matchedTrade&&trade.kind==='SWAP_BUY';
        list.push({quantity:delta,cost:known?BigInt(trade.consideration):null,basis:known?trade.basis.key:null,opened:known?at:null});
      } else if(delta<0n) {
        let remaining=-delta,quantity=0n,cost=0n,held=0;
        while(remaining>0n&&list.length) {
          const lot=list[0],take=remaining<lot.quantity?remaining:lot.quantity;
          const part=lot.cost===null?null:lot.cost*take/lot.quantity;
          if(matchedTrade&&trade.kind==='SWAP_SELL'&&!unknown.has(contract)&&lot.basis===trade.basis.key&&part!==null) {
            quantity+=take;cost+=part;held=Math.max(held,(at-lot.opened)/1000);
          }
          lot.quantity-=take;remaining-=take;if(part!==null)lot.cost-=part;
          if(lot.quantity===0n)list.shift();
        }
        if(remaining>0n)unknown.add(contract);
        if(quantity>0n) {
          const proceeds=BigInt(trade.consideration)*quantity/(-delta),pnl=proceeds-cost;
          closes.push({mint:contract,basis:trade.basis.key,at,cost,proceeds,pnl,hold:held,fully_matched:quantity===-delta,roi:ratio(pnl,cost)});
        }
      }
    }
  }
  const periods={};
  for(const [key,days] of [['h24',1],['d7',7],['d30',30],['d90',90],['all_available',Infinity]]) {
    const cutoff=now-days*86400000,selected=trades.filter(t=>t.at>=cutoff),realized=closes.filter(t=>t.at>=cutoff);
    const byBasis=Object.fromEntries(Object.entries(definitions).map(([key,b])=>{
      const rows=realized.filter(r=>r.basis===key);return [key,{count:rows.length,pnl:rows.length?signed(sum(rows,'pnl'),b.decimals):null,cost:rows.length?signed(sum(rows,'cost'),b.decimals):null,roi_pct:ratio(sum(rows,'pnl'),sum(rows,'cost'))}];
    }));
    const active=Object.values(byBasis).filter(b=>b.count>0);
    periods[key]={observations:realized.length,fully_matched_sells:realized.filter(r=>r.fully_matched).length,realized_pnl:Object.fromEntries(Object.entries(byBasis).map(([k,v])=>[k,v.pnl])),roi_pct:active.length===1?active[0].roi_pct:null,
      win_rate_pct:realized.length?Math.round(realized.filter(r=>r.pnl>0n).length/realized.length*10000)/100:null,
      buy_count:selected.filter(t=>t.kind==='SWAP_BUY').length,sell_count:selected.filter(t=>t.kind==='SWAP_SELL').length,trade_count:selected.length,
      average_hold_seconds:mean(realized.map(r=>r.hold)),by_basis:byBasis,
      buy_notional_by_basis:Object.fromEntries(Object.entries(definitions).map(([k,b])=>{const buys=selected.filter(t=>t.basis.key===k&&t.kind==='SWAP_BUY'),total=sum(buys,'amount');return [k,{count:buys.length,total:buys.length?signed(total,b.decimals):null,average:buys.length?signed(total/BigInt(buys.length),b.decimals):null}];})),
      sell_notional_by_basis:Object.fromEntries(Object.entries(definitions).map(([k,b])=>{const sells=selected.filter(t=>t.basis.key===k&&t.kind==='SWAP_SELL');return [k,{total:sells.length?signed(sum(sells,'amount'),b.decimals):null}];})),
      distribution:[[-Infinity,-50,'Below −50%'],[-50,0,'−50% to 0%'],[0,100,'0% to 100%'],[100,400,'100% to 400%'],[400,Infinity,'400%+']].map(([a,b,label])=>({label,count:realized.filter(r=>r.roi!==null&&r.roi>=a&&r.roi<b).length})),
    };
  }
  const tokens=[...tokenStats.values()].filter(t=>t.buy_count||t.sell_count).map(t=>{
    const list=lots.get(t.mint),balance=balances.find(b=>b.contract===t.mint),quantity=list.reduce((n,l)=>n+l.quantity,0n);
    const reconciled=!unknown.has(t.mint)&&balance?.decimals===t.decimals&&balance.balance_raw===quantity.toString();
    const costsKnown=reconciled&&list.every(l=>l.cost!==null);
    const byBasis=Object.fromEntries(Object.entries(definitions).map(([k,b])=>{
      const rows=closes.filter(r=>r.mint===t.mint&&r.basis===k),open=list.filter(l=>l.basis===k&&l.cost!==null);
      return [k,{matched_closes:rows.length,matched_cost:rows.length?signed(sum(rows,'cost'),b.decimals):null,matched_proceeds:rows.length?signed(sum(rows,'proceeds'),b.decimals):null,realized_pnl:rows.length?signed(sum(rows,'pnl'),b.decimals):null,remaining_cost:open.length?signed(sum(open,'cost'),b.decimals):null,remaining_quantity:open.reduce((n,l)=>n+l.quantity,0n).toString()}];
    }));
    // Only exact canonical-USDC acquisition costs produce USD-equivalent
    // unrealized P&L here. ETH/WETH/USDG costs require historical FX evidence.
    let unrealized=null;
    if(costsKnown&&list.length&&list.every(l=>l.basis===valuationBasis)&&balance?.provider_mark_value_usd!=null) {
      try {const value=BigInt(decimalToAtomic(balance.provider_mark_value_usd,6));unrealized=signed(value-sum(list,'cost'),6);}catch{ /* leave unknown */ }
    }
    return {...t,by_basis:byBasis,balance_reconciled:reconciled,remaining_cost_complete:costsKnown,unrealized_pnl_usd:unrealized,unrealized_scope:unrealized===null?'unavailable':valuationBasis==='usd'?'matched_historical_usd_reference_cost_indicative_mark':'matched_canonical_usdc_cost_indicative_usd_mark'};
  }).sort((a,b)=>String(b.last_trade_at).localeCompare(String(a.last_trade_at))||a.mint.localeCompare(b.mint));
  return {schema_version:'ravenos.wallet_trading_record.v1',periods,tokens:tokens.slice(0,100),token_count:tokens.length,tokens_truncated:tokens.length>100,
    unrealized_summary:{value_usd:tokens.some(t=>t.unrealized_pnl_usd!==null)?signed(tokens.reduce((n,t)=>t.unrealized_pnl_usd===null?n:n+(t.unrealized_pnl_usd.startsWith('-')?-1n:1n)*BigInt(decimalToAtomic(t.unrealized_pnl_usd.replace('-',''),6)),0n),6):null,covered_tokens:tokens.filter(t=>t.unrealized_pnl_usd!==null).length,visible_holdings:balances.length},
    discovery_metrics:{scope:'retained_known_cost_sell_observations',
      double_tokens:closes.length?new Set(closes.filter(r=>r.roi>=100).map(r=>r.mint)).size:null,
      mooner_tokens:closes.length?new Set(closes.filter(r=>r.roi>=400).map(r=>r.mint)).size:null,
      loss_75_pct:closes.length?Math.round(closes.filter(r=>r.roi<=-75).length/closes.length*10000)/100:null,
      big_loss_count:closes.length?closes.filter(r=>r.roi<=-50).length:null,
      under_15_seconds_count:closes.length?closes.filter(r=>r.hold<15).length:null,
      tokens_15_plus_buys:trades.length?tokens.filter(t=>t.buy_count>=15).length:null,
      warning_tokens_pct:null,unrealized_profit_share_pct:null},
    incoming_transfers:ordered.filter(e=>e.wallet_accounting?.incoming_transfer).slice(0,5).map(e=>e.wallet_accounting.incoming_transfer),
    basis_labels:Object.fromEntries(Object.entries(definitions).map(([k,b])=>[k,b.label])),scope:'receipt_verified_swaps_known_cost_fifo',distribution_unit:'matched_sell_observation',settlement_bases_combined:false,network_fees_included:false,wallet_creation_time_claimed:false,
    source_history_complete:false,unresolved_starting_inventory_tokens:unknown.size,invalid_precision_tokens:invalidTokens.size};
}

export function applyEvmTradingRecord(profile,events,{bases,openingBalances}) {
  events=events.map(evmAnalyticalSettlementEvent);
  const record=buildEvmTradingRecord(events,{bases,openingBalances,generatedAt:profile.generated_at,balances:profile.positions.provider_reported_token_balances});
  const all=record.periods.all_available,decoded=all.trade_count;
  if(!decoded&&!profile.trading_record)return {...profile,profile_version:EVM_WALLET_TRADING_PROFILE_VERSION,wallet_reconstruction:{version:1,decoded_trades:0,opening_balances:openingBalances}};
  const times=events.filter(e=>e.wallet_accounting?.trade).map(e=>e.chain_evidence.block_time).sort();
  return {...profile,profile_version:EVM_WALLET_TRADING_PROFILE_VERSION,trading_record:record,discovery_metrics:record.discovery_metrics,
    wallet_reconstruction:{version:1,decoded_trades:decoded,opening_balances:openingBalances},
    coverage:{...profile.coverage,first_observed_at:times[0]||profile.coverage.first_observed_at,last_observed_at:times.at(-1)||profile.coverage.last_observed_at,transactions_observed:events.length,normalized_events:events.length,history_scope:'bounded_retained_receipt_history',trade_events:decoded,known_cost_basis_pct:all.sell_count?Math.round(all.fully_matched_sells/all.sell_count*10000)/100:null},
    behavior:{...profile.behavior,trade_count:decoded,buy_count:all.buy_count,sell_count:all.sell_count,first_trade_at:times[0]||null,last_trade_at:times.at(-1)||null,tokens_traded:record.token_count,buy_notional_by_basis:all.buy_notional_by_basis,sell_notional_by_basis:all.sell_notional_by_basis,average_hold_seconds:all.average_hold_seconds},
    source_performance:{...profile.source_performance,state:all.observations?'partial':'insufficient_evidence',realized_pnl_usdc:all.realized_pnl.usdc??null,realized_pnl_by_basis:all.realized_pnl,roi_pct:all.roi_pct,win_rate_pct:all.win_rate_pct,closed_lots:all.observations,closed_observations:all.observations,windows:record.periods,by_basis:all.by_basis,
      limitations:['Known-cost FIFO on verified pool swaps in the retained window; unmatched inventory stays unknown.','Settlement currencies remain separate; historical FX is not inferred from current prices.','Gas and unsupported protocols are excluded from trade P&L.']},
    provider_activity:{...profile.provider_activity,raven_decoded_trade_transactions:decoded,trade_activity_claimed:true},
    data_quality:{...profile.data_quality,analysis_scope:'bounded_verified_pool_swaps_and_transfer_inventory',cost_basis_coverage_pct:all.sell_count?Math.round(all.fully_matched_sells/all.sell_count*10000)/100:null},
  };
}
