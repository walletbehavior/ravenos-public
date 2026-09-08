import { authorizeCustomerApiRequest, consumeCustomerRateLimit } from './customer_identity.mjs';
import { createD1PrivyWalletStore } from './customer_privy_wallets.mjs';
import { createPortfolioSolanaRpcRequest } from './portfolio_governor/solana_preview_provider.mjs';
import { loadSolanaWalletHoldings, WALLET_TOKEN_PROGRAMS } from './customer_trade/solana_wallet_holdings.mjs';
import { SOLANA_USDC_MINT } from './portfolio_governor/solana_exposure.mjs';
import { alchemyWalletHistoryRuntime } from './customer_trade/alchemy_wallet_history.mjs';
import { evmSettlementBases } from './customer_trade/evm_wallet_swaps.mjs';

export const CUSTOMER_WALLET_BALANCES_ROUTE = '/api/v1/wallets/balances';
const snapshots = new Map();
const pending = new Map();
const chains = new Set(['solana','base','ethereum','robinhood','bsc']);
const decimal = (units, decimals) => { const n=String(units).padStart(decimals+1,'0');return decimals ? n.slice(0,-decimals)+'.'+n.slice(-decimals) : n; };
const json = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json','cache-control':'private, no-store','vary':'Cookie','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});

// Reuses Raven's read-only balance providers. No history scan, signer, quote,
// reward balance, or trial entitlement is needed to see one's own funds.
export async function loadCustomerWalletBalance(env, wallet, chain, {fetchImpl=globalThis.fetch,now=Date.now()}={}) {
  const address=wallet.public_address, observed_at=new Date(now).toISOString();
  if(chain==='solana') {
    const rpc=createPortfolioSolanaRpcRequest({rpc_url:env.RAVENOS_SOLANA_RPC_URL,wallet_reference:address,fetch_impl:fetchImpl});
    const holdings=await loadSolanaWalletHoldings({address,rpc,now:observed_at});
    const legacyAvailable=holdings.coverage.find(r=>r.program===WALLET_TOKEN_PROGRAMS[0])?.state==='available';
    const usdc=holdings.tokens.find(r=>r.mint===SOLANA_USDC_MINT && r.token_program===WALLET_TOKEN_PROGRAMS[0] && r.decimals===6);
    return {chain,address,observed_at,state:holdings.state,assets:[
      {symbol:'SOL',asset_id:'native',decimals:9,amount_base_units:holdings.native?.amount_base_units??null,amount:holdings.native?decimal(holdings.native.amount_base_units,9):null,spendable_before_network_fees:holdings.native?decimal(holdings.native.amount_base_units,9):null,canonical_usdc:false},
      {symbol:'USDC',asset_id:SOLANA_USDC_MINT,decimals:6,amount_base_units:legacyAvailable?usdc?.balance_base_units||'0':null,amount:legacyAvailable?usdc?.balance_display||'0.000000':null,spendable_before_network_fees:legacyAvailable?decimal(usdc?.spendable_base_units||'0',6):null,canonical_usdc:true},
    ],tokens:holdings.tokens,coverage:holdings.coverage,network_fee_asset:'SOL',scope:'confirmed_chain_balances_before_network_fees',execution_authority:false};
  }
  const runtime=alchemyWalletHistoryRuntime(env,chain);
  if(!runtime.enabled)throw Error('wallet_balance_provider_unavailable');
  const rpc=async(method,params)=>{
    const response=await fetchImpl(runtime.rpc_url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'manual',signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error('wallet_balance_provider_unavailable');
    const body=await response.text();if(body.length>16384)throw Error('wallet_balance_invalid');
    const result=JSON.parse(body);if(result.error||result.id!==1||!/^0x[0-9a-f]{1,64}$/i.test(result.result||''))throw Error('wallet_balance_invalid');
    return result.result;
  };
  if(BigInt(await rpc('eth_chainId',[]))!==BigInt(runtime.profile.chain_id))throw Error('wallet_balance_network_mismatch');
  const bases=Object.values(evmSettlementBases(chain)),stable=bases[0],native=bases.find(r=>r.contract==='native');
  const values=await Promise.allSettled([rpc('eth_getBalance',[address,'latest']),rpc('eth_call',[{to:stable.contract,data:'0x70a08231'+address.slice(2).padStart(64,'0')},'latest'])]);
  return {chain,address,observed_at,state:values.every(r=>r.status==='fulfilled')?'available':'partial',assets:[native,stable].map((asset,i)=>{
    const units=values[i].status==='fulfilled'?BigInt(values[i].value).toString():null;
    return {symbol:asset.label,asset_id:asset.contract,decimals:asset.decimals,amount_base_units:units,amount:units===null?null:decimal(units,asset.decimals),spendable_before_network_fees:null,canonical_usdc:asset.key==='usdc'};
  }),tokens:[],network_fee_asset:native.label,scope:'chain_local_balances_before_network_fees_token_spendability_requires_route_check',execution_authority:false};
}

export async function routeCustomerWalletBalances(request,env={},deps={}) {
  const url=new URL(request.url);if(url.pathname!==CUSTOMER_WALLET_BALANCES_ROUTE)return null;
  if(request.method!=='GET')return json({ok:false,error:'method_not_allowed'},405,{allow:'GET'});
  const auth=await(deps.authorize||authorizeCustomerApiRequest)(request,env,deps.identity||{});
  if(auth.response)return auth.response;
  const reply=(body,status,headers={})=>json(body,status,{...Object.fromEntries(auth.response_headers||[]),...headers});
  const chain=url.searchParams.get('chain')||'solana';
  if(!chains.has(chain)||[...url.searchParams.keys()].some(k=>k!=='chain'))return reply({ok:false,error:'wallet_balance_request_invalid'},400);
  try {
    const store=deps.walletStore||createD1PrivyWalletStore(env.RAVENOS_CUSTOMER_DB);
    const identity=await store.getIdentity(auth.principal.user_id);
    const wallet=identity?.state==='active'?(await store.listWallets(auth.principal.user_id)).find(w=>w.state==='active'&&w.ecosystem===(chain==='solana'?'solana':'evm')):null;
    if(!wallet)return reply({ok:true,chain,state:'wallet_not_linked',snapshot:null});
    const now=deps.now??Date.now(),key=`${auth.principal.user_id}:${chain}:${wallet.public_address}`;
    const cached=snapshots.get(key);
    if(cached&&now-cached.at<30000)return reply({ok:true,snapshot:cached.value,delivery:'recent_balance_cache'});
    const limiter=deps.rateLimit||consumeCustomerRateLimit;
    const limited=await limiter({store:auth.store,env,request,action:'wallet_balance',scope:'user',subject:auth.principal.user_id,now:Math.floor(now/1000),window_seconds:60,limit:15});
    if(!limited.allowed)return reply({ok:false,error:'wallet_balance_rate_limited'},429,{'retry-after':String(limited.retry_after_seconds||30)});
    if(!pending.has(key))pending.set(key,(deps.loadBalance||loadCustomerWalletBalance)(env,wallet,chain,{fetchImpl:deps.fetchImpl,now}).then(value=>{
      if(snapshots.size>=500)snapshots.delete(snapshots.keys().next().value);
      snapshots.set(key,{value,at:now});return value;
    }).finally(()=>pending.delete(key)));
    return reply({ok:true,snapshot:await pending.get(key),delivery:'chain_balance_read'});
  } catch { return reply({ok:false,error:'wallet_balance_unavailable'},503); }
}
