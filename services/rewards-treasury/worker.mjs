import { canonicalJson, constructClaim, digest, privySignClaim, solanaRpc, treasuryConfig, validateClaim, verifySignedClaim } from './solana.mjs';
import { moneyMicros } from '../../lib/customer_product.mjs';

const fail = code => { throw new Error(code); };
const seconds = () => Math.floor(Date.now()/1000);
const result = (body,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function reservedClaim(db, input, config) {
  if (!/^rop_[a-f0-9]{64}$/.test(input.operation_id||'')) fail('treasury_operation_invalid');
  const row = await db.prepare("SELECT * FROM ravenos_reward_operations WHERE operation_id=? AND kind='claim'").bind(input.operation_id).first();
  if (!row || !['reserved','processing','indeterminate'].includes(row.state) || row.user_id!==input.user_id || String(row.amount_micros)!==input.amount_micros) fail('treasury_reservation_unavailable');
  const destination=JSON.parse(row.destination_json);
  if (canonicalJson(destination)!==canonicalJson(input.destination)) fail('treasury_destination_mismatch');
  validateClaim(config,input);
  const ledger=await db.prepare('SELECT COALESCE(SUM(reserved_delta),0) AS reserved FROM ravenos_reward_ledger WHERE operation_id=? AND user_id=?').bind(row.operation_id,row.user_id).first();
  if (String(ledger?.reserved)!==String(row.amount_micros)) fail('treasury_reservation_mismatch');
  if (destination.kind==='privy_embedded') {
    const proof=await db.prepare(`SELECT w.public_address FROM ravenos_privy_wallets w JOIN ravenos_user_privy_identities p ON p.raven_user_id=w.raven_user_id AND p.privy_user_id=w.privy_user_id
      WHERE w.wallet_record_id=? AND w.raven_user_id=? AND w.state='active' AND p.state='active' AND w.ecosystem='solana' AND w.wallet_type='privy_embedded'`).bind(destination.wallet_record_id,row.user_id).first();
    if (proof?.public_address!==destination.wallet_address) fail('treasury_wallet_verification_unavailable');
  } else {
    const proof=await db.prepare("SELECT wallet_address FROM ravenos_reward_wallet_challenges WHERE challenge_id=? AND user_id=? AND chain='solana' AND verified_at IS NOT NULL AND consumed_at IS NOT NULL AND expires_at>? AND verified_at<=?").bind(destination.verification_id,row.user_id,row.created_at,row.created_at).first();
    if (proof?.wallet_address!==destination.wallet_address) fail('treasury_wallet_verification_unavailable');
  }
  return row;
}

// Only this service holds its Privy treasury authorization. It has no public
// route and does not accept transaction instructions, spend keys or RPC URLs.
// One durable coordinator serializes the entire treasury's budget and outbox.
export class RewardsTreasury {
  constructor(ctx,env,dependencies={}) {
    this.ctx=ctx;this.env=env;this.storage=ctx.storage;this.tail=Promise.resolve();
    this.now=dependencies.now||seconds;
    this.build=dependencies.build||((input)=>constructClaim(env,input,{now:this.now()}));
    this.sign=dependencies.sign||((prepared)=>privySignClaim(env,prepared));
    this.rpc=dependencies.rpc||((method,params)=>solanaRpc(env,method,params));
    this.load=dependencies.load||((input,config)=>reservedClaim(env.RAVENOS_CUSTOMER_DB,input,config));
  }
  serialized(work) { const next=this.tail.then(work);this.tail=next.catch(()=>{});return next; }
  async fetch(request) {
    return this.serialized(async()=>{
      try {
        if (request.method!=='POST' || new URL(request.url).hostname!=='raven-rewards-treasury.internal') return result({ok:false},404);
        const raw=await request.text();if(raw.length>4096)return result({ok:false},413);
        const input=JSON.parse(raw), path=new URL(request.url).pathname;
        if(path==='/quote') {
          if(this.env.TREASURY_QUOTES_ENABLED!=='1')fail('treasury_quotes_disabled');
          const {unsigned_transaction,last_valid_block_height,...quote}=await this.build(input);
          return result(quote);
        }
        if(path==='/payout')return result(await this.payout(input));
        return result({ok:false},404);
      } catch {
        // Never echo provider messages, credentials, wallet data or wire bytes.
        return result({ok:false,error:'treasury_unavailable'},503);
      }
    });
  }
  async payout(input) {
    if(this.env.TREASURY_LIVE_ENABLED!=='1')fail('treasury_live_disabled');
    const config=treasuryConfig(this.env);
    await this.load(input,config);
    const key='claim:'+input.operation_id, identity=digest(canonicalJson(input));
    let item=await this.storage.get(key);
    if(item && item.identity!==identity)fail('treasury_idempotency_conflict');
    if(item?.transaction_hash) {
      await this.storage.setAlarm(Date.now()+5000);
      return {ok:true,state:item.state,transaction_hash:item.transaction_hash};
    }
    if(!item) {
      const prepared=await this.build(input);
      const day=Math.floor(this.now()/86400), budgetKey='budget:'+day;
      const used=BigInt(await this.storage.get(budgetKey)||'0'), amount=moneyMicros(input.amount_micros);
      if(used+amount>moneyMicros(config.daily_limit_micros))fail('treasury_daily_limit');
      item={identity,input,prepared,state:'prepared',created_at:this.now(),attempts:0};
      // Persist the reservation and exact unsigned message atomically before
      // contacting the signer. Crashes never create a second message.
      await this.storage.put({[key]:item,[budgetKey]:(used+amount).toString()});
    }
    if(item.prepared.treasury_wallet!==config.wallet_address)fail('treasury_policy_changed');
    const height=await this.rpc('getBlockHeight',[{commitment:'finalized'}]);
    if(!Number.isSafeInteger(height))fail('treasury_block_height_unavailable');
    if(height>item.prepared.last_valid_block_height)fail('treasury_prepared_transaction_expired');
    const signed=await this.sign(item.prepared);
    // An injected/misconfigured signer cannot replace the reviewed message.
    const checked=verifySignedClaim(item.prepared.unsigned_transaction,signed.signed_transaction,config.wallet_address);
    item={...item,...checked,state:'signed',signed_at:this.now()};
    await this.storage.put({[key]:item,['pending:'+input.operation_id]:key});
    await this.storage.setAlarm(Date.now()+5000);
    await this.broadcast(key,item).catch(()=>{});
    return {ok:true,state:'processing',transaction_hash:item.transaction_hash};
  }
  async broadcast(key,item) {
    if(this.env.TREASURY_LIVE_ENABLED!=='1')return;
    const config=treasuryConfig(this.env);
    if(item.prepared.treasury_wallet!==config.wallet_address)fail('treasury_policy_changed');
    const statuses=await this.rpc('getSignatureStatuses',[[item.transaction_hash],{searchTransactionHistory:true}]);
    const status=statuses?.value?.[0];
    if(!Array.isArray(statuses?.value))fail('treasury_status_unavailable');
    if(status?.err) { await this.storage.put(key,{...item,state:'review_required',reason:'chain_failed'});await this.storage.delete('pending:'+item.input.operation_id);return; }
    if(status?.confirmationStatus==='finalized') { await this.storage.put(key,{...item,state:'finalized'});await this.storage.delete('pending:'+item.input.operation_id);return; }
    if(status)return;
    const height=await this.rpc('getBlockHeight',[{commitment:'finalized'}]);
    if(!Number.isSafeInteger(height))fail('treasury_block_height_unavailable');
    if(height>item.prepared.last_valid_block_height) { await this.storage.put(key,{...item,state:'review_required',reason:'expired_unresolved'});await this.storage.delete('pending:'+item.input.operation_id);return; }
    // Recheck the durable reservation before every submission. A UI request
    // alone can never authorize money movement.
    await this.load(item.input,config);
    verifySignedClaim(item.prepared.unsigned_transaction,item.signed_transaction,config.wallet_address);
    // A timeout is an ambiguous submission. Retry only these exact bytes; the
    // independent customer-worker verifier decides whether a claim settled.
    await this.storage.put(key,{...item,state:'processing',attempts:item.attempts+1,last_attempt_at:this.now()});
    const hash=await this.rpc('sendTransaction',[item.signed_transaction,{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0}]);
    if(hash!==item.transaction_hash)fail('treasury_rpc_signature_mismatch');
  }
  async alarm() {
    return this.serialized(async()=>{
      if(this.env.TREASURY_LIVE_ENABLED!=='1')return;
      const pending=await this.storage.list({prefix:'pending:',limit:10});
      for(const [pendingKey,key] of pending) {
        const item=await this.storage.get(key);
        if(!item || !['signed','processing'].includes(item.state)){await this.storage.delete(pendingKey);continue;}
        await this.broadcast(key,item).catch(()=>{});
      }
      if(pending.size)await this.storage.setAlarm(Date.now()+15000);
    });
  }
}
export default {
  async fetch(request,env) {
    if(!env.TREASURY_COORDINATOR || request.method!=='POST' || new URL(request.url).hostname!=='raven-rewards-treasury.internal')return result({ok:false},404);
    const coordinator=env.TREASURY_COORDINATOR.get(env.TREASURY_COORDINATOR.idFromName('canonical-solana-usdc'));
    return coordinator.fetch(request);
  }
};
