import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';

// Cache-only join: opening Holders must never launch an RPC lookup per holder.
// Only public-chain analytical fields are selected, not the private account,
// subscription, watch, Copy strategy, reward or referral tables.
export async function enrichHolderWalletContext(payload,db) {
  if(!db?.prepare||!Array.isArray(payload?.holders)||!payload.identity?.token_address)return payload;
  const rows=payload.holders.filter(r=>r.classification==='owner').slice(0,40),ids=new Map();
  for(const row of rows)try{
    const id=normalizeSourceWalletChainIdentity({chain:payload.identity.chain,network:'mainnet',address:row.holder_address});ids.set(id.source_wallet_id,id.address);
  }catch{/* unresolved owners stay unresolved */}
  if(!ids.size)return payload;
  const found=await db.prepare(`SELECT c.source_wallet_id,c.generated_at,c.trade_count,c.first_trade_at,c.last_trade_at,
    (SELECT value FROM json_each(COALESCE(d.profile_json,p.profile_json),'$.trading_record.tokens') WHERE json_extract(value,'$.mint')=? LIMIT 1) AS token_record
    FROM ravenos_source_wallet_current_profiles c
    JOIN ravenos_source_wallet_profiles p ON p.profile_snapshot_id=c.profile_snapshot_id
    LEFT JOIN ravenos_source_wallet_profile_details d ON d.profile_snapshot_id=p.profile_snapshot_id
    WHERE c.source_wallet_id IN (${[...ids.keys()].map(()=>'?').join(',')})`).bind(payload.identity.token_address,...ids.keys()).all();
  const context=new Map((found.results||[]).map(row=>{
    let token;try{token=JSON.parse(row.token_record||'null');}catch{token=null;}
    const text=value=>typeof value==='string'&&/^-?\d{1,78}(?:\.\d{1,30})?$/.test(value)?value:null;
    return [ids.get(row.source_wallet_id),{
      source_wallet_id:row.source_wallet_id,observed_at:new Date(row.generated_at*1000).toISOString(),
      retained_trade_count:row.trade_count,first_retained_trade_at:row.first_trade_at?new Date(row.first_trade_at*1000).toISOString():null,
      token:token?{buy_count:token.buy_count,sell_count:token.sell_count,balance_reconciled:token.balance_reconciled===true,
        by_basis:Object.fromEntries(Object.entries(token.by_basis||{}).filter(([key])=>['usdc','usdt','sol','eth','weth','bnb','wbnb','usdg','binance_peg_usdc','binance_peg_usdt'].includes(key)).map(([key,v])=>[key,{matched_cost:text(v.matched_cost),matched_proceeds:text(v.matched_proceeds),realized_pnl:text(v.realized_pnl),remaining_cost:text(v.remaining_cost)}]))}:null,
      scope:'cached_public_wallet_analysis',provider_request_performed:false,wallet_age_claimed:false,
    }];
  }));
  return {...payload,holders:payload.holders.map(row=>({...row,wallet_context:context.get(payload.identity.chain==='solana'?row.holder_address:row.holder_address.toLowerCase())||null})),wallet_context_coverage:{analyzed_owners:context.size,maximum_owners:40,provider_request_performed:false}};
}
