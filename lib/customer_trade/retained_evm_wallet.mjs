import { randomUUID } from 'node:crypto';
import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { EVM_WALLET_LOOKUP_SCHEMA, EVM_WALLET_BASIC_PROFILE_SCHEMA, inspectEvmWallet } from './evm_wallet_lookup.mjs';

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
  const age=usable ? now-Math.floor(Date.parse(profile.generated_at)/1000) : Infinity;
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
    const result=await lookup(input);
    if(!valid(result,id,now))throw Error('evm_wallet_profile_identity_mismatch');
    // Insert a source only when absent: inspection cannot reset observer cursors.
    const existing=await store.getSourceWallet(id.source_wallet_id);
    if(!existing)await store.upsertSourceWallet({...id,now,state:'requested',provider_scope:'bounded_evm_history'});
    const {profile:nextProfile,...reduced}=result;
    await store.recordProfile(id.source_wallet_id,{...nextProfile,retained_lookup:reduced},Math.floor(Date.parse(nextProfile.generated_at)/1000));
    return {...result,persistence:{state:'shared_raven_profile',saved_to_raven_index:true,copy_eligible:false}};
  } catch(error) {
    if(usable)return retained(cached,now,true);
    throw error;
  } finally {
    await db.prepare('DELETE FROM ravenos_wallet_lookup_leases WHERE source_wallet_id=? AND lease_token=?').bind(id.source_wallet_id,token).run();
  }
}
