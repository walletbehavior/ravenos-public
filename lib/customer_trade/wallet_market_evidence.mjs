import { createHash } from 'node:crypto';
import { walletCardSummariesForPage } from './wallet_card_summary.mjs';
import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { WalletDiscoverySources, walletDiscoverySourcesForPage } from './wallet_discovery_sources.mjs';

export const WalletMarketEvidence = Object.freeze({
  schema: 'ravenos.wallet_market_evidence.v1', window_seconds: 86400,
  maximum_projection_rows: 120, displayed_markets: 3, repeat_transactions: 3,
  signals: ['any', 'repeat_activity', 'multiple_markets', 'two_sided'],
  history: ['any', 'cached', 'not_analyzed'], sorts: ['priority','recent', 'activity', 'markets'],
});
const fail = () => { throw new Error('wallet_observation_query_invalid'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = value => new Date(value * 1000).toISOString();

export function normalizeObservationQuery(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  if (Object.keys(input).some(key => !['signal','history','sort','source','active_within_hours'].includes(key))) fail();
  const output = {signal:input.signal ?? 'any',history:input.history ?? 'any',sort:input.sort ?? 'priority',source:input.source??'any',active_within_hours:input.active_within_hours ?? null};
  if (!WalletMarketEvidence.signals.includes(output.signal) || !WalletMarketEvidence.history.includes(output.history) || !WalletMarketEvidence.sorts.includes(output.sort)) fail();
  if(output.source!=='any'&&!Object.hasOwn(WalletDiscoverySources,output.source))fail();
  if (output.active_within_hours !== null && ![1,6,24].includes(output.active_within_hours)) fail();
  return Object.freeze(output);
}

// A displayed provider USD mark is kept precisely, never added across pools.
// Multi-hop legs can otherwise be counted twice as wallet trading volume.
function usdMicros(value) {
  if (!['string','number'].includes(typeof value)) return null;
  const text = String(value);
  if (!/^\d{1,13}(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction=''] = text.split('.');
  const amount = BigInt(whole)*1000000n + BigInt((fraction+'000000').slice(0,6));
  return amount > 0n && amount <= 1000000000000000000n ? amount : null;
}

function marketIdentity(input) {
  try {
    const chain=input.chain;
    const token=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:input.token_address});
    const quote=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:input.quote_token_address});
    const pool=String(input.pool_address || '');
    if (chain==='solana') normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:pool});
    else if (!/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(pool)) return null;
    if (token.address===quote.address) return null;
    const result={chain,pool_address:chain==='solana'?pool:pool.toLowerCase(),token_address:token.address,quote_token_address:quote.address};
    return {...result,instrument_id:`${chain}:pool:${result.pool_address}`};
  } catch { return null; }
}

export function observedWalletMarketEvidence(projection, {now=Math.floor(Date.now()/1000), admitted_wallets=[]} = {}) {
  if (projection?.ok!==true || projection.safe_public!==true || projection.schema_version!=='ravenos.onchain_pool_trades.v1') return [];
  const market=marketIdentity(projection.identity || {});
  const sampledAt=Math.floor(Date.parse(projection.observed_at)/1000);
  if (!market || !Number.isSafeInteger(sampledAt) || sampledAt>now+60 || sampledAt<now-WalletMarketEvidence.window_seconds) return [];
  const admitted=new Map(admitted_wallets.map(wallet=>[wallet.address,wallet]));
  const groups=new Map();
  const txPattern=market.chain==='solana'?/^[1-9A-HJ-NP-Za-km-z]{64,100}$/:/^0x[a-fA-F0-9]{64}$/;
  for (const trade of (Array.isArray(projection.trades)?projection.trades:[]).slice(0,WalletMarketEvidence.maximum_projection_rows)) {
    let identity;
    try { identity=normalizeSourceWalletChainIdentity({chain:market.chain,network:'mainnet',address:trade.trader_address}); } catch { continue; }
    if (!admitted.has(identity.address) || admitted.get(identity.address).source_wallet_id!==identity.source_wallet_id) continue;
    const at=Math.floor(Date.parse(trade.observed_at)/1000);
    if (!Number.isSafeInteger(at) || at>Math.min(now,sampledAt)+60 || at<now-WalletMarketEvidence.window_seconds || !txPattern.test(trade.transaction_hash || '') || !['buy','sell'].includes(trade.side)) continue;
    const tx=market.chain==='solana'?trade.transaction_hash:trade.transaction_hash.toLowerCase();
    const group=groups.get(identity.source_wallet_id) || {identity,transactions:new Set(),buys:new Set(),sells:new Set(),first:at,last:at,largest:null};
    group.transactions.add(tx);
    group[trade.side==='buy'?'buys':'sells'].add(tx);
    group.first=Math.min(group.first,at);group.last=Math.max(group.last,at);
    const mark=usdMicros(trade.volume_usd);
    if (mark!==null && (group.largest===null || mark>group.largest)) group.largest=mark;
    groups.set(identity.source_wallet_id,group);
  }
  return [...groups.values()].map(group=>{
    const sample={schema_version:WalletMarketEvidence.schema,market,
      window:{first_observed_at:iso(group.first),last_observed_at:iso(group.last)},
      unique_transactions:group.transactions.size,buy_transactions:group.buys.size,sell_transactions:group.sells.size,
      largest_sampled_swap_usd_micros:group.largest?.toString() || null,
      scope:'retained_exact_pool_sample',history_complete:false,performance_claimed:false,copyability_claimed:false};
    return {source_wallet_id:group.identity.source_wallet_id,market_id:'wme_'+hash(market.instrument_id).slice(0,40),
      chain:market.chain,sampled_at:sampledAt,first_event_at:group.first,last_event_at:group.last,
      unique_transactions:sample.unique_transactions,buy_transactions:sample.buy_transactions,sell_transactions:sample.sell_transactions,sample_json:JSON.stringify(sample)};
  });
}

export async function retainWalletMarketEvidence(db, rows) {
  const statements=rows.slice(0,120).map(row=>db.prepare(`INSERT INTO ravenos_source_wallet_market_evidence
    (source_wallet_id,market_id,chain,sampled_at,first_event_at,last_event_at,unique_transactions,buy_transactions,sell_transactions,sample_json)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_wallet_id,market_id) DO UPDATE SET
      sampled_at=excluded.sampled_at,first_event_at=excluded.first_event_at,last_event_at=excluded.last_event_at,
      unique_transactions=excluded.unique_transactions,buy_transactions=excluded.buy_transactions,sell_transactions=excluded.sell_transactions,sample_json=excluded.sample_json
    WHERE excluded.sampled_at>=sampled_at AND excluded.last_event_at>=last_event_at AND excluded.sample_json!=sample_json`)
    .bind(row.source_wallet_id,row.market_id,row.chain,row.sampled_at,row.first_event_at,row.last_event_at,row.unique_transactions,row.buy_transactions,row.sell_transactions,row.sample_json));
  let written=0;
  for (let i=0;i<statements.length;i+=40) for (const result of await db.batch(statements.slice(i,i+40))) written+=Number(result.meta?.changes || 0);
  return written;
}

export async function walletMarketEvidenceForPage(db, sourceIds, now) {
  if (!sourceIds.length) return new Map();
  if (sourceIds.length > 30) fail();
  const result=await db.prepare(`SELECT * FROM (
    SELECT source_wallet_id,sample_json,ROW_NUMBER() OVER (PARTITION BY source_wallet_id ORDER BY last_event_at DESC,market_id) AS position
    FROM ravenos_source_wallet_market_evidence WHERE source_wallet_id IN (${sourceIds.map(()=>'?').join(',')}) AND last_event_at>=? AND last_event_at<=? AND first_event_at>=?
  ) WHERE position<=?`).bind(...sourceIds,now-WalletMarketEvidence.window_seconds,now+60,now-WalletMarketEvidence.window_seconds,WalletMarketEvidence.displayed_markets).all();
  const bySource=new Map();
  for (const row of result.results || []) {
    const samples=bySource.get(row.source_wallet_id) || [];
    try { const sample=JSON.parse(row.sample_json); if(sample.schema_version===WalletMarketEvidence.schema)samples.push(sample); } catch { /* Missing evidence stays missing. */ }
    bySource.set(row.source_wallet_id,samples);
  }
  return bySource;
}

// One sample per wallet/pool. Expired evidence is excluded at read time; the
// existing budgeted scheduler removes at most 200 old rows per run.
export async function pruneWalletMarketEvidence(db, now) {
  return db.prepare(`DELETE FROM ravenos_source_wallet_market_evidence WHERE rowid IN (
    SELECT rowid FROM ravenos_source_wallet_market_evidence WHERE last_event_at<? ORDER BY last_event_at LIMIT 200
  )`).bind(now-7*86400).run();
}

export async function listObservedWallets(db, query, {market_evidence_enabled=false} = {}) {
  const observed=normalizeObservationQuery(query.observed);
  const now=query.evaluated_at ? Math.floor(Date.parse(query.evaluated_at)/1000) : Math.floor(Date.now()/1000);
  if (!Number.isSafeInteger(now) || !Number.isInteger(query.page_size) || query.page_size<1 || query.page_size>30 || !Number.isInteger(query.offset) || query.offset<0) fail();
  if (!market_evidence_enabled && (observed.signal!=='any' || !['priority','recent'].includes(observed.sort))) throw new Error('wallet_market_evidence_disabled');
  const evidence=market_evidence_enabled ? `, evidence AS (
    SELECT source_wallet_id,COUNT(*) AS market_count,MAX(unique_transactions) AS busiest_pool_transactions,
      MAX(CASE WHEN buy_transactions>0 AND sell_transactions>0 THEN 1 ELSE 0 END) AS two_sided,
      MAX(last_event_at) AS last_event_at
    FROM ravenos_source_wallet_market_evidence WHERE last_event_at>=? AND last_event_at<=? AND first_event_at>=? GROUP BY source_wallet_id
  )` : '';
  const cte=`WITH identities AS (
    SELECT source_wallet_id,chain,network,address,MAX(last_observed_at) AS last_observed_at FROM (
      SELECT source_wallet_id,chain,network,address,last_observed_at FROM ravenos_source_wallets
      UNION ALL SELECT source_wallet_id,chain,network,address,last_observed_at FROM ravenos_source_wallet_discovery_candidates
    ) GROUP BY source_wallet_id,chain,network,address
  ) ${evidence}, candidates AS (
    SELECT s.source_wallet_id,s.chain,s.network,s.address,
      COALESCE((SELECT MAX(priority) FROM ravenos_wallet_discovery_sources d WHERE d.source_wallet_id=s.source_wallet_id AND d.expires_at>${now}),0) AS discovery_priority,
      ${market_evidence_enabled?'MAX(COALESCE(s.last_observed_at,0),COALESCE(e.last_event_at,0))':'s.last_observed_at'} AS last_observed_at,
      EXISTS(SELECT 1 FROM ravenos_source_wallet_current_profiles h WHERE h.source_wallet_id=s.source_wallet_id) AS history_available,
      ${market_evidence_enabled?'COALESCE(e.market_count,0) AS market_count,COALESCE(e.busiest_pool_transactions,0) AS busiest_pool_transactions,COALESCE(e.two_sided,0) AS two_sided':'0 AS market_count,0 AS busiest_pool_transactions,0 AS two_sided'}
    FROM identities s ${market_evidence_enabled?'LEFT JOIN evidence e ON e.source_wallet_id=s.source_wallet_id':''}
    WHERE s.network='mainnet' AND (?='all' OR s.chain=?) AND s.last_observed_at IS NOT NULL
      AND (${observed.source!=='any'?1:0}=1 OR NOT EXISTS (SELECT 1 FROM ravenos_source_wallet_current_profiles p
        JOIN ravenos_source_wallet_profiles h ON h.profile_snapshot_id=p.profile_snapshot_id
        WHERE p.source_wallet_id=s.source_wallet_id AND h.schema_version!='ravenos.evm_wallet_basic_profile.v2'))
  )`;
  const conditions=[];
  const params=market_evidence_enabled?[now-WalletMarketEvidence.window_seconds,now+60,now-WalletMarketEvidence.window_seconds,query.chain,query.chain]:[query.chain,query.chain];
  if(observed.source!=='any') {conditions.push('EXISTS (SELECT 1 FROM ravenos_wallet_discovery_sources d WHERE d.source_wallet_id=candidates.source_wallet_id AND d.source_kind=? AND d.expires_at>?)');params.push(observed.source,now);}
  if (observed.active_within_hours!==null) { conditions.push('last_observed_at>=? AND last_observed_at<=?');params.push(now-observed.active_within_hours*3600,now+60); }
  if (observed.history!=='any') conditions.push(`history_available=${observed.history==='cached'?1:0}`);
  if (observed.signal==='repeat_activity') {conditions.push('busiest_pool_transactions>=?');params.push(WalletMarketEvidence.repeat_transactions);}
  if (observed.signal==='multiple_markets') conditions.push('market_count>=2');
  if (observed.signal==='two_sided') conditions.push('two_sided=1');
  const from='FROM candidates'+(conditions.length?' WHERE '+conditions.join(' AND '):'');
  const order=observed.sort==='priority'?'discovery_priority DESC,':observed.sort==='activity'?'busiest_pool_transactions DESC,':observed.sort==='markets'?'market_count DESC,':'';
  const result=await db.prepare(`${cte} SELECT *, COUNT(*) OVER() AS total_matching ${from} ORDER BY ${order}last_observed_at DESC,source_wallet_id ASC LIMIT ? OFFSET ?`)
    .bind(...params,query.page_size,query.offset).all();
  const rows=result.results || [];
  // COUNT OVER shares the filtered scan with the page. Only an out-of-range
  // page needs a second count; an empty first page already establishes zero.
  const total=rows.length ? Number(rows[0].total_matching) : query.offset>0
    ? Number((await db.prepare(`${cte} SELECT COUNT(*) AS count ${from}`).bind(...params).first())?.count || 0) : 0;
  const samples=market_evidence_enabled?await walletMarketEvidenceForPage(db,rows.map(row=>row.source_wallet_id),now):new Map();
  const sources=await walletDiscoverySourcesForPage(db,rows.filter(row=>row.discovery_priority>0).map(row=>row.source_wallet_id),now);
  const summaries=await walletCardSummariesForPage(db,rows.map(row=>row.source_wallet_id),now);
  return {rows:rows.map(row=>({source_wallet_id:row.source_wallet_id,cached_summary:summaries.get(row.source_wallet_id),
    source_wallet:{chain:row.chain,network:row.network,address:row.address},last_observed_at:iso(row.last_observed_at),
    history_available:Boolean(row.history_available),evidence_mode:'retained_raven_observation',performance_claimed:false,copyability_claimed:false,
    discovery_sources:sources.get(row.source_wallet_id)||[],
    market_evidence:market_evidence_enabled?{state:row.market_count?'available':'not_observed',window_hours:24,
      observed_market_count:Number(row.market_count),busiest_pool_transactions:Number(row.busiest_pool_transactions),
      two_sided_pool_observed:Boolean(row.two_sided),samples:samples.get(row.source_wallet_id) || [],
      history_complete:false,performance_claimed:false,copyability_claimed:false,provider_request_performed:false}:null})),
    total,observed_filters:observed,market_evidence_enabled,
    performance_filters_applied:false,provider_request_performed:false};
}
