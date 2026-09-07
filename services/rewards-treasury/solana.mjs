import { createHash, createPrivateKey, sign } from 'node:crypto';
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { CANONICAL_REWARD_ASSETS } from '../../lib/customer_rewards.mjs';
import { moneyMicros } from '../../lib/customer_product.mjs';
import { SOLANA_MAINNET_GENESIS_HASH } from '../../lib/customer_trade/operator_solana_canary.mjs';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = new PublicKey(CANONICAL_REWARD_ASSETS.solana.token);
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const fail = code => { throw new Error(code); };
export const digest = value => createHash('sha256').update(value).digest('hex');
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) fail('treasury_payload_invalid');
  return JSON.stringify(value);
}
export function address(value) {
  try { const key = new PublicKey(value); if (!PublicKey.isOnCurve(key.toBytes()) || key.equals(SystemProgram.programId)) fail('invalid'); return key.toBase58(); }
  catch { fail('treasury_wallet_invalid'); }
}
export const tokenAccount = owner => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), TOKEN.toBuffer(), USDC.toBuffer()], ATA)[0];
export function treasuryConfig(env) {
  const config = JSON.parse(env.TREASURY_POLICY_JSON || '{}');
  const wallet = address(config.wallet_address);
  for (const key of ['minimum_claim_micros','maximum_claim_micros','daily_limit_micros','maximum_network_cost_micros','sol_price_ceiling_micros']) if (moneyMicros(config[key]) <= 0n) fail('treasury_policy_invalid');
  if (moneyMicros(config.maximum_claim_micros) > moneyMicros(config.daily_limit_micros) || moneyMicros(config.minimum_claim_micros) > moneyMicros(config.maximum_claim_micros)) fail('treasury_policy_invalid');
  if (!Number.isSafeInteger(config.maximum_cost_bps) || config.maximum_cost_bps < 1 || config.maximum_cost_bps > 1000) fail('treasury_policy_invalid');
  return { ...config, wallet_address: wallet };
}
export function validateClaim(config, input) {
  const destination = input.destination;
  if (destination?.chain !== 'solana' || destination.token !== USDC.toBase58() || !['privy_embedded','external_connected'].includes(destination.kind)) fail('treasury_destination_invalid');
  const wallet = address(destination.wallet_address);
  const amount = moneyMicros(input.amount_micros);
  if (wallet === config.wallet_address || input.treasury_wallet && input.treasury_wallet !== config.wallet_address || destination.treasury_wallet && destination.treasury_wallet !== config.wallet_address) fail('treasury_identity_mismatch');
  if (amount < moneyMicros(config.minimum_claim_micros) || amount > moneyMicros(config.maximum_claim_micros)) fail('treasury_amount_out_of_policy');
  return { destination: wallet, amount };
}
export async function solanaRpc(env, method, params, fetchImpl = globalThis.fetch) {
  let url; try { url = new URL(env.TREASURY_SOLANA_RPC_URL); } catch { fail('treasury_rpc_unavailable'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('treasury_rpc_invalid');
  let response;
  try { response = await fetchImpl(url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), redirect:'manual', signal:AbortSignal.timeout(6000) }); }
  catch { fail('treasury_rpc_unavailable'); }
  if (!response.ok) fail('treasury_rpc_unavailable');
  const raw = await response.text(); if (raw.length > 100000) fail('treasury_rpc_invalid');
  let body; try { body = JSON.parse(raw); } catch { fail('treasury_rpc_invalid'); }
  if (body.id !== 1 || body.error) fail('treasury_rpc_unavailable');
  return body.result;
}
function balance(account, owner) {
  if (!account || account.owner !== TOKEN.toBase58() || account.executable || account.data?.[1] !== 'base64') fail('treasury_token_account_invalid');
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length !== 165 || !data.subarray(0,32).equals(USDC.toBuffer()) || !data.subarray(32,64).equals(new PublicKey(owner).toBuffer()) || data[108] !== 1 || data.readUInt32LE(72) !== 0 || data.readUInt32LE(129) !== 0) fail('treasury_token_account_invalid');
  return data.readBigUInt64LE(64);
}
export function claimTransaction({ treasury, destination, amount, blockhash, create_destination, operation_id='rop_'+'0'.repeat(64) }) {
  if(!/^rop_[a-f0-9]{64}$/.test(operation_id))fail('treasury_operation_invalid');
  const from = new PublicKey(treasury), to = new PublicKey(destination);
  const tx = new Transaction({feePayer:from,recentBlockhash:blockhash});
  if (create_destination) tx.add(new TransactionInstruction({programId:ATA,keys:[
    {pubkey:from,isSigner:true,isWritable:true}, {pubkey:tokenAccount(destination),isSigner:false,isWritable:true},
    {pubkey:to,isSigner:false,isWritable:false}, {pubkey:USDC,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}, {pubkey:TOKEN,isSigner:false,isWritable:false}
  ],data:Buffer.from([1])})); // Idempotent canonical ATA creation; no arbitrary accounts.
  const data = Buffer.alloc(10); data[0]=12; data.writeBigUInt64LE(BigInt(amount),1); data[9]=6;
  tx.add(new TransactionInstruction({programId:TOKEN,keys:[
    {pubkey:tokenAccount(treasury),isSigner:false,isWritable:true}, {pubkey:USDC,isSigner:false,isWritable:false},
    {pubkey:tokenAccount(destination),isSigner:false,isWritable:true}, {pubkey:from,isSigner:true,isWritable:false}
  ],data}));
  // Distinct claims for the same amount/destination/blockhash must not collapse
  // into one network transaction or one provider idempotency record.
  tx.add(new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from('raven-reward:'+operation_id)}));
  return tx;
}
export async function readSolValue(env, request, {now=Math.floor(Date.now()/1000),fetch_impl=globalThis.fetch}={}) {
  const mint='So11111111111111111111111111111111111111112';
  if(!env.TREASURY_JUPITER_API_KEY)fail('treasury_network_valuation_unavailable');
  let response;
  try { response=await fetch_impl('https://api.jup.ag/price/v3?ids='+mint,{headers:{'x-api-key':env.TREASURY_JUPITER_API_KEY},redirect:'manual',signal:AbortSignal.timeout(4000)}); }
  catch { fail('treasury_network_valuation_unavailable'); }
  if(!response.ok)fail('treasury_network_valuation_unavailable');
  const raw=await response.text();if(raw.length>8192)fail('treasury_network_valuation_invalid');
  let price;try{price=JSON.parse(raw)[mint];}catch{fail('treasury_network_valuation_invalid');}
  const decimal=String(price?.usdPrice), match=/^(\d{1,6})(?:\.(\d{1,18}))?$/.exec(decimal);
  if(!match || !Number.isSafeInteger(price.blockId) || price.decimals!==9)fail('treasury_network_valuation_invalid');
  const micros=BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0').slice(0,6))+( /[1-9]/.test((match[2]||'').slice(6))?1n:0n );
  const observed=await request('getBlockTime',[price.blockId]);
  if(micros<=0n || !Number.isSafeInteger(observed) || observed<now-90 || observed>now+30)fail('treasury_network_valuation_stale');
  return {amount_micros:micros.toString(),observed_at:observed,source:'jupiter_price_v3',slot:price.blockId};
}
export async function constructClaim(env, input, { now=Math.floor(Date.now()/1000), request=null, valuation=null }={}) {
  const config = treasuryConfig(env), claim = validateClaim(config,input);
  const call = request || ((method,params)=>solanaRpc(env,method,params));
  const [genesis, latest, accounts, funds, price] = await Promise.all([
    call('getGenesisHash',[]),call('getLatestBlockhash',[{commitment:'finalized'}]),
    call('getMultipleAccounts',[[tokenAccount(config.wallet_address).toBase58(),tokenAccount(claim.destination).toBase58()],{encoding:'base64',commitment:'finalized'}]),
    call('getBalance',[config.wallet_address,{commitment:'finalized'}]),
    valuation?valuation():readSolValue(env,call,{now})
  ]);
  if(!Number.isSafeInteger(price.observed_at) || price.observed_at<now-90 || price.observed_at>now+30 || moneyMicros(price.amount_micros)>moneyMicros(config.sol_price_ceiling_micros))fail('treasury_network_valuation_out_of_policy');
  if (genesis !== SOLANA_MAINNET_GENESIS_HASH) fail('treasury_chain_mismatch');
  const block = latest?.value;
  if (!block?.blockhash || !Number.isSafeInteger(block.lastValidBlockHeight)) fail('treasury_blockhash_invalid');
  const source = accounts?.value?.[0], target = accounts?.value?.[1];
  if (!Array.isArray(accounts?.value) || accounts.value.length !== 2) fail('treasury_account_evidence_unavailable');
  const spendable = balance(source,config.wallet_address);
  if (target !== null) balance(target,claim.destination);
  if (spendable < claim.amount) fail('treasury_funding_unavailable');
  const tx = claimTransaction({treasury:config.wallet_address,destination:claim.destination,amount:claim.amount,blockhash:block.blockhash,create_destination:target===null,operation_id:input.operation_id});
  const [fee,rent] = await Promise.all([call('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'finalized'}]), target===null?call('getMinimumBalanceForRentExemption',[165,{commitment:'finalized'}]):0]);
  if (!Number.isSafeInteger(fee?.value) || fee.value<=0 || !Number.isSafeInteger(rent) || rent<0 || !Number.isSafeInteger(funds?.value)) fail('treasury_cost_evidence_unavailable');
  const lamports = BigInt(fee.value)+BigInt(rent);
  if (BigInt(funds.value)<lamports) fail('treasury_gas_funding_unavailable');
  const cost = (lamports*moneyMicros(config.sol_price_ceiling_micros)+999999999n)/1000000000n;
  if (cost>moneyMicros(config.maximum_network_cost_micros) || cost*10000n>claim.amount*BigInt(config.maximum_cost_bps)) fail('treasury_cost_out_of_policy');
  const unsigned = tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  return {ok:true,chain:'solana',token:USDC.toBase58(),wallet_address:claim.destination,treasury_wallet:config.wallet_address,
    amount_micros:claim.amount.toString(),spendable_usdc_micros:spendable.toString(),network_cost_micros:cost.toString(),network_cost_lamports:lamports.toString(),
    network_cost_basis:'measured_network_and_ata_rent_with_verified_sol_price_ceiling',price_observed_at:price.observed_at,
    quote_id:'rtq_'+digest(unsigned),expires_at:now+60,unsigned_transaction:unsigned,last_valid_block_height:block.lastValidBlockHeight};
}
export function verifySignedClaim(unsigned, signed, treasury) {
  try {
    if (typeof signed!=='string' || signed.length>2000) fail('invalid');
    const expected=Transaction.from(Buffer.from(unsigned,'base64')), actual=Transaction.from(Buffer.from(signed,'base64'));
    if (!actual.serializeMessage().equals(expected.serializeMessage()) || actual.signatures.length!==1 || actual.signatures[0].publicKey.toBase58()!==treasury || !actual.verifySignatures()) fail('invalid');
    return {signed_transaction:actual.serialize().toString('base64'),transaction_hash:bs58.encode(actual.signatures[0].signature)};
  } catch { fail('treasury_signed_transaction_mismatch'); }
}
export async function privySignClaim(env, prepared, {fetch_impl=globalThis.fetch,now=Date.now()}={}) {
  if (env.TREASURY_LIVE_ENABLED!=='1') fail('treasury_live_disabled');
  const id=env.TREASURY_PRIVY_WALLET_ID, app=env.TREASURY_PRIVY_APP_ID;
  if (!/^[a-z0-9_-]{8,100}$/i.test(id||'') || !app || !env.TREASURY_PRIVY_APP_SECRET || !env.TREASURY_PRIVY_AUTHORIZATION_KEY) fail('treasury_signer_unavailable');
  const url=`https://api.privy.io/v1/wallets/${id}/rpc`;
  const body={method:'signTransaction',params:{transaction:prepared.unsigned_transaction,encoding:'base64'}};
  const headers={'privy-app-id':app,'privy-idempotency-key':'raven-claim-'+digest(prepared.unsigned_transaction),'privy-request-expiry':String(now+30000)};
  let signature;
  try {
    const raw=env.TREASURY_PRIVY_AUTHORIZATION_KEY.replace(/^wallet-auth:/,'');
    const key=raw.includes('BEGIN PRIVATE KEY')?createPrivateKey(raw):createPrivateKey({key:Buffer.from(raw,'base64'),format:'der',type:'pkcs8'});
    if (key.asymmetricKeyType!=='ec' || key.asymmetricKeyDetails?.namedCurve!=='prime256v1') fail('invalid');
    signature=sign('sha256',Buffer.from(canonicalJson({version:1,method:'POST',url,body,headers})),key).toString('base64');
  } catch { fail('treasury_signer_unavailable'); }
  let response;
  try { response=await fetch_impl(url,{method:'POST',headers:{...headers,'privy-authorization-signature':signature,authorization:'Basic '+Buffer.from(app+':'+env.TREASURY_PRIVY_APP_SECRET).toString('base64'),'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(6000)}); }
  catch { fail('treasury_signer_unavailable'); }
  if (!response.ok) fail('treasury_signer_unavailable');
  const raw=await response.text(); if(raw.length>8192)fail('treasury_signer_response_invalid');
  let result;try{result=JSON.parse(raw);}catch{fail('treasury_signer_response_invalid');}
  if(result.method!=='signTransaction'||result.data?.encoding!=='base64')fail('treasury_signer_response_invalid');
  return verifySignedClaim(prepared.unsigned_transaction,result.data.signed_transaction,prepared.treasury_wallet);
}
