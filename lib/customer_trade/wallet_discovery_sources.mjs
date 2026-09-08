import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { WalletHistoryPolicy } from './wallet_history_policy.mjs';
import bs58 from 'bs58';

// Priority describes where to look first, never the quality of a trader.
export const WalletDiscoverySources = Object.freeze({
  kol: {priority:900,label:'KOL list',ttl:30*86400},
  smart_money: {priority:850,label:'Smart-money list',ttl:7*86400},
  top_holder: {priority:700,label:'Top holder',ttl:86400},
  top_trader: {priority:650,label:'Top trader list',ttl:86400},
  active_trader: {priority:500,label:'Active pool trader',ttl:86400},
});

export function normalizeWalletDiscoverySource(input, now=Math.floor(Date.now()/1000)) {
  const id=normalizeSourceWalletChainIdentity({chain:input?.chain,network:'mainnet',address:input?.address});
  if((id.chain==='solana' && bs58.decode(id.address).length!==32) || /^0x0{40}$/i.test(id.address))throw Error('wallet_discovery_address_invalid');
  const kind=input.source_kind, policy=WalletDiscoverySources[kind];
  if (!policy || !/^[a-z][a-z0-9_]{1,79}$/.test(input.provider||'') || !Number.isSafeInteger(input.observed_at)
      || input.observed_at>now+60 || input.observed_at<0 || (input.source_wallet_id && input.source_wallet_id!==id.source_wallet_id)) throw Error('wallet_discovery_source_invalid');
  let reference;
  try {
    reference=new URL(input.source_reference);
    const ravenPool=reference.origin==='https://app.ravenos.xyz' && reference.pathname==='/terminal/'
      && [...reference.searchParams.keys()].every(key=>['chain','pair_address','token_address'].includes(key))
      && reference.searchParams.get('chain')===id.chain
      && [...reference.searchParams.values()].every(value=>/^[a-zA-Z0-9_]{1,100}$/.test(value));
    if (reference.protocol!=='https:' || reference.username || reference.password || reference.port || (reference.search&&!ravenPool)
      || reference.hash || reference.toString().length>500 || /^(?:localhost|127\.|0\.|\[|169\.254\.|10\.)/.test(reference.hostname)) throw Error();
  } catch {throw Error('wallet_discovery_reference_invalid');}
  const rank=input.source_rank??null;
  if (rank!==null && (!Number.isSafeInteger(rank)||rank<1||rank>100000)) throw Error('wallet_discovery_rank_invalid');
  return {...id,source_kind:kind,provider:input.provider,source_reference:reference.toString(),source_rank:rank,
    priority:policy.priority,observed_at:input.observed_at,expires_at:input.observed_at+policy.ttl};
}

export async function retainWalletDiscoverySource(db, input, now=Math.floor(Date.now()/1000)) {
  const row=normalizeWalletDiscoverySource(input,now);
  if(row.expires_at<=now)return false;
  await db.prepare(`INSERT INTO ravenos_wallet_discovery_sources
    (source_wallet_id,source_kind,provider,source_reference,source_rank,priority,observed_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source_wallet_id,source_kind,provider,source_reference) DO UPDATE SET
      source_rank=excluded.source_rank,priority=excluded.priority,observed_at=excluded.observed_at,expires_at=excluded.expires_at
    WHERE excluded.observed_at>observed_at OR (excluded.observed_at=observed_at AND excluded.source_rank IS NOT source_rank)`)
    .bind(row.source_wallet_id,row.source_kind,row.provider,row.source_reference,row.source_rank,row.priority,row.observed_at,row.expires_at).run();
  // Expired labels cannot hold a permanent place at the front of the queue.
  await db.prepare(`UPDATE ravenos_source_wallets SET discovery_priority=COALESCE((
      SELECT MAX(priority) FROM ravenos_wallet_discovery_sources WHERE source_wallet_id=? AND expires_at>?),0),
    discovery_priority_expires_at=COALESCE((SELECT MAX(expires_at) FROM ravenos_wallet_discovery_sources
      WHERE source_wallet_id=? AND expires_at>? AND priority=(SELECT MAX(priority) FROM ravenos_wallet_discovery_sources WHERE source_wallet_id=? AND expires_at>?)),0)
    WHERE source_wallet_id=?`)
    .bind(row.source_wallet_id,now,row.source_wallet_id,now,row.source_wallet_id,now,row.source_wallet_id).run();
  return true;
}

export async function walletDiscoverySourcesForPage(db, ids, now) {
  if(!ids.length)return new Map();
  if(ids.length>30)throw Error('wallet_discovery_page_invalid');
  const result=await db.prepare(`SELECT * FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY source_wallet_id ORDER BY priority DESC,source_rank,observed_at DESC,source_reference) AS position
    FROM ravenos_wallet_discovery_sources WHERE source_wallet_id IN (${ids.map(()=>'?').join(',')}) AND expires_at>?) WHERE position<=3`)
    .bind(...ids,now).all();
  const groups=new Map();
  for(const row of result.results||[]) {
    const items=groups.get(row.source_wallet_id)||[];
    items.push({kind:row.source_kind,label:WalletDiscoverySources[row.source_kind].label,provider:row.provider,
      source_reference:row.source_reference,rank:row.source_rank,observed_at:new Date(row.observed_at*1000).toISOString(),
      performance_claimed:false,identity_verified:false});
    groups.set(row.source_wallet_id,items);
  }
  return groups;
}

export async function queuePriorityWalletWarmups(db,backfillStore,{now=Date.now(),limit=4,helius=false,evm=false}={}) {
  if(!backfillStore?.enqueueJob)return {queued:0,provider_requests:0};
  const seconds=Math.floor(now/1000),bounded=Math.max(1,Math.min(8,Number(limit)||4));
  const rows=await db.prepare(`SELECT s.*,MAX(d.priority) AS active_source_priority FROM ravenos_source_wallets s
    JOIN ravenos_wallet_discovery_sources d ON d.source_wallet_id=s.source_wallet_id AND d.expires_at>?
    WHERE 1=1
      AND ((chain='solana' AND ?=1) OR (chain!='solana' AND ?=1))
      AND NOT EXISTS (SELECT 1 FROM ravenos_source_wallet_backfill_jobs j WHERE j.source_wallet_id=s.source_wallet_id)
      AND NOT EXISTS (SELECT 1 FROM ravenos_source_wallet_current_profiles p WHERE p.source_wallet_id=s.source_wallet_id)
    GROUP BY s.source_wallet_id
    ORDER BY active_source_priority DESC,s.last_observed_at DESC,s.source_wallet_id LIMIT ?`)
    .bind(seconds,helius?1:0,evm?1:0,bounded).all();
  for(const row of rows.results||[])await backfillStore.enqueueJob({address:row.address,chain:row.chain,
    provider:row.chain==='solana'?'helius_address_history':'alchemy_wallet_history',demand_class:'indexed_research',
    evidence_priority:row.active_source_priority,history_target:WalletHistoryPolicy.discovery_warmup_events,now});
  return {queued:rows.results?.length||0,provider_requests:0,maximum_history_per_wallet:WalletHistoryPolicy.discovery_warmup_events};
}
