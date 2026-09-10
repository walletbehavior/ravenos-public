import { applyEvmTradingRecord } from './evm_wallet_trading_record.mjs';
import { selectEvmHistoryAccounting } from './evm_wallet_history_window.mjs';
import { WalletHistoryPolicy } from './wallet_history_policy.mjs';
import { evmSettlementBases } from './evm_wallet_swaps.mjs';
import { loadWalletHistoricalPrices, walletUsdTradingRecord } from './wallet_historical_prices.mjs';
import { loadWalletTokenMarks, applyWalletTokenMark, walletTokenMarkSummary } from './wallet_token_marks.mjs';
import { randomUUID } from 'node:crypto';
import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { EVM_WALLET_LOOKUP_SCHEMA, EVM_WALLET_BASIC_PROFILE_SCHEMA, inspectEvmWallet, walletLookupFailureCode } from './evm_wallet_lookup.mjs';

const RETAIN_SECONDS = 86400;
function valid(result, id, now) {
  const profile = result?.profile, generated = Math.floor(Date.parse(profile?.generated_at)/1000);
  return result?.ok===true && result.schema_version===EVM_WALLET_LOOKUP_SCHEMA && result.source_wallet_id===id.source_wallet_id
    && profile?.schema_version===EVM_WALLET_BASIC_PROFILE_SCHEMA && profile.source_wallet?.chain===id.chain
    && profile.source_wallet?.chain_id===id.chain_id && profile.source_wallet?.address===id.address
    && result.source?.api_key_exposed===false && Number.isSafeInteger(generated) && generated<=now+60 && now-generated<=RETAIN_SECONDS;
}
function retained(result, now, fallback=false) {
  const recent=now-Math.floor(Date.parse(result.profile.generated_at)/1000)<300;
  return {...result,evidence_mode:'retained_raven_index',provider_request_performed:false,
    refresh_state:fallback?'provider_unavailable':null,
    freshness:{state:fallback?'retained_provider_unavailable':recent?'recent':'retained',observed_at:result.profile.generated_at,current_balance_claimed:false},
    persistence:{state:'shared_raven_profile',saved_to_raven_index:true,copy_eligible:false},
    source:{...result.source,delivery:'shared_profile_cache',request_count:0},
    activity:{...result.activity,scope:{...result.activity?.scope,provider_request_performed:false,evidence_mode:'retained_raven_index'}}};
}
// Keep snapshots in the existing append-only profile ledger. The extra reduced
// lookup envelope retains activity/provenance, never raw RPC payloads or tokens.
export async function inspectRetainedEvmWallet(input, {store,db,lookup=inspectEvmWallet,now=Math.floor(Date.now()/1000)}={}) {
  const id=normalizeSourceWalletChainIdentity({chain:input.chain,network:'mainnet',address:input.address});
  if(id.vm_family!=='evm')throw Error('evm_wallet_identity_required');
  const snapshot=await store.latestProfile(id.source_wallet_id);
  const {retained_lookup:envelope,...profile}=snapshot || {};
  const cached=envelope?{...envelope,profile}:null;
  const usable=valid(cached,id,now);
  const age=usable ? now-Math.floor(Date.parse(profile.balances_observed_at || profile.generated_at)/1000) : Infinity;
  if(usable && ((!input.refresh && age<3600) || age<300))return retained(cached,now);
  const token=randomUUID();
  const leased=await db.prepare(`INSERT INTO ravenos_wallet_lookup_leases VALUES (?,?,?)
    ON CONFLICT(source_wallet_id) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at
    WHERE expires_at<=?`).bind(id.source_wallet_id,token,now+90,now).run();
  if(!leased.meta?.changes){
    if(usable)return retained(cached,now);
    const error=new Error('wallet_analysis_in_progress');error.code=error.message;error.status=409;throw error;
  }
  try {
    const prior=profile?.wallet_reconstruction;
    const priorEvents=(cached?.retained_accounting_events || []).filter(event=>event.wallet_accounting?.version===1&&event.source_wallet?.chain===id.chain&&event.source_wallet?.address===id.address);
    const result=await lookup({...input,priorAnalysis:prior?.version===1?{...prior,events:priorEvents}:null});
    if(!valid(result,id,now))throw Error('evm_wallet_profile_identity_mismatch');
    // Insert a source only when absent: inspection cannot reset observer cursors.
    const existing=await store.getSourceWallet(id.source_wallet_id);
    if(!existing)await store.upsertSourceWallet({...id,now,state:'requested',provider_scope:'bounded_evm_history'});
    const newEvents=(result.retained_accounting_events || []).map(event=>({...event,schema_version:"ravenos.source_wallet_chain_event.v1",source_wallet_id:id.source_wallet_id}));
    if (newEvents.length && typeof store.recordEvents === "function") await store.recordEvents(id.source_wallet_id,newEvents,now);
    let {profile:nextProfile,...reduced}=result;
    if(input.env?.RAVENOS_WALLET_DEX_MARKS_ENABLED==='1') {
      const balances=nextProfile.positions?.provider_reported_token_balances||[];
      const marks=await loadWalletTokenMarks({chain:id.chain,contracts:balances.filter(row=>row.provider_mark_price_usd==null).map(row=>row.contract),now,cache:input.cache,fetchImpl:input.fetchImpl});
      const marked=balances.map(token=>applyWalletTokenMark(token,marks.rows.find(row=>row.contract===token.contract)));
      nextProfile={...nextProfile,positions:{...nextProfile.positions,provider_reported_token_balances:marked},provider_balance_summary:{...nextProfile.provider_balance_summary,...walletTokenMarkSummary(marked)},mark_coverage:{requested_tokens:marks.requested_tokens,cached_tokens:marks.cached_tokens,request_count:marks.request_count,unavailable:marks.unavailable}};
      reduced.source={...reduced.source,request_count:(reduced.source?.request_count||0)+marks.request_count};
    }
    let analyticalEvents=result.retained_accounting_events||[];
    if (profile?.durable_history && typeof store.listSourceEvents === "function") {
      const events=await store.listSourceEvents(id.source_wallet_id,WalletHistoryPolicy.evm_analysis_events);
      const accounting=selectEvmHistoryAccounting(events,{...profile.durable_history,opening_balances:profile.wallet_reconstruction?.opening_balances},WalletHistoryPolicy.evm_analysis_events);
      analyticalEvents=accounting.events;
      nextProfile={...applyEvmTradingRecord(nextProfile,analyticalEvents,{bases:evmSettlementBases(id.chain),openingBalances:accounting.openingBalances}),durable_history:{...profile.durable_history,events_retained:events.length,analysis_truncated:accounting.analysisTruncated},balances_observed_at:nextProfile.generated_at};
    } else if(analyticalEvents.length) {
      nextProfile=applyEvmTradingRecord(nextProfile,analyticalEvents,{bases:evmSettlementBases(id.chain),openingBalances:nextProfile.wallet_reconstruction?.opening_balances||{}});
    }
    if(nextProfile.trading_record&&input.env?.RAVENOS_WALLET_HISTORICAL_USD_ENABLED==='1') {
      // Refreshing balances must retain USD analysis. Read already-indexed FX;
      // only the background history worker may request missing price windows.
      const prices=await loadWalletHistoricalPrices(input.env,db,analyticalEvents,{now:now*1000,maximumDays:0});
      nextProfile={...nextProfile,trading_record:{...nextProfile.trading_record,usd:walletUsdTradingRecord(nextProfile,analyticalEvents,prices)}};
      nextProfile.pricing_pending=nextProfile.trading_record.usd.missing_native_prices>0;
    }
    await store.recordProfile(id.source_wallet_id,{...nextProfile,retained_lookup:reduced},Math.floor(Date.parse(nextProfile.generated_at)/1000));
    return {...result,...reduced,profile:nextProfile,persistence:{state:'shared_raven_profile',saved_to_raven_index:true,copy_eligible:false}};
  } catch(error) {
    if(usable)return {...retained(cached,now,true),refresh_error_code:walletLookupFailureCode(error),provider_request_performed:null,source:{...cached.source,delivery:'shared_profile_cache',request_count:null}};
    throw error;
  } finally {
    await db.prepare('DELETE FROM ravenos_wallet_lookup_leases WHERE source_wallet_id=? AND lease_token=?').bind(id.source_wallet_id,token).run();
  }
}
