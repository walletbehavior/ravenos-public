import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';

// A public HTML page, not a private/undocumented API. Only visible account links
// are admitted. Names, social identities and provider P&L never become facts here.
export const KolscanPublicList = Object.freeze({
  provider:'kolscan_public_daily',url:'https://kolscan.io/leaderboard',
  refresh_seconds:21600,maximum_bytes:1024*1024,maximum_wallets:200,
});

export function parseKolscanPublicLeaderboard(html,{now=Math.floor(Date.now()/1000)}={}) {
  if(typeof html!=='string'||new TextEncoder().encode(html).length>KolscanPublicList.maximum_bytes
      || !/KOL Leaderboard/i.test(html)) throw Error('public_wallet_list_unavailable');
  const wallets=new Map();
  for(const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    let url;
    try {url=new URL(match[1].replaceAll('&amp;','&'),KolscanPublicList.url);}catch{continue;}
    if(url.origin!=='https://kolscan.io'||!/^\/account\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname)
        || (url.searchParams.has('timeframe')&&url.searchParams.get('timeframe')!=='1'))continue;
    try {
      const identity=normalizeSourceWalletChainIdentity({chain:'solana',network:'mainnet',address:url.pathname.slice('/account/'.length)});
      if(!wallets.has(identity.address))wallets.set(identity.address,{address:identity.address,rank:wallets.size+1});
    }catch{continue;}
    if(wallets.size>KolscanPublicList.maximum_wallets)throw Error('public_wallet_list_limit_exceeded');
  }
  if(!wallets.size)throw Error('public_wallet_list_empty');
  return {schema_version:'ravenos.wallet_source_list.v1',chain:'solana',source_kind:'kol',
    provider:KolscanPublicList.provider,source_reference:KolscanPublicList.url,observed_at:now,wallets:[...wallets.values()]};
}

async function boundedHtml(response) {
  if(Number(response.headers.get('content-length'))>KolscanPublicList.maximum_bytes)throw Error('public_wallet_list_too_large');
  if(!response.headers.get('content-type')?.includes('text/html')||!response.body)throw Error('public_wallet_list_response_invalid');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>KolscanPublicList.maximum_bytes)throw Error('public_wallet_list_too_large');
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function refreshPublicWalletList(env,{walletStore,fetchImpl=fetch,now=Math.floor(Date.now()/1000)}={}) {
  const db=env.RAVENOS_CUSTOMER_DB,policy=KolscanPublicList;
  if(env.RAVENOS_WALLET_PUBLIC_LISTS_ENABLED!=='1'||env.RAVENOS_WALLET_INTELLIGENCE_ENABLED!=='1'
      || env.RAVENOS_WALLET_SCREENER_ENABLED!=='1'||!db?.prepare||!walletStore?.recordSeenMarketWallet)return {state:'disabled',provider_requests:0};
  await db.prepare('INSERT OR IGNORE INTO ravenos_public_wallet_list_refresh (provider,next_refresh_at) VALUES (?,0)').bind(policy.provider).run();
  // Reserve before fetching: overlapping scheduled Workers cannot multiply reads.
  const claimed=await db.prepare('UPDATE ravenos_public_wallet_list_refresh SET next_refresh_at=?,state=? WHERE provider=? AND next_refresh_at<=?')
    .bind(now+policy.refresh_seconds,'refreshing',policy.provider,now).run();
  if(!claimed.meta?.changes)return {state:'cached',provider_requests:0};
  try {
    const response=await fetchImpl(policy.url,{headers:{accept:'text/html','user-agent':'RavenOS-Wallet-Discovery/1.0 (+https://ravenos.xyz)'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('public_wallet_list_http_'+response.status);
    const packet=parseKolscanPublicLeaderboard(await boundedHtml(response),{now});
    for(const wallet of packet.wallets) {
      const identity=normalizeSourceWalletChainIdentity({chain:packet.chain,network:'mainnet',address:wallet.address});
      await walletStore.recordSeenMarketWallet({...identity,observed_at:now,provider_scope:'retained_public_wallet_list',
        discovery_source:{source_kind:packet.source_kind,provider:packet.provider,source_reference:packet.source_reference,source_rank:wallet.rank}},now);
    }
    await db.prepare('UPDATE ravenos_public_wallet_list_refresh SET state=?,last_success_at=?,wallet_count=?,last_error_code=NULL WHERE provider=?')
      .bind('current',now,packet.wallets.length,policy.provider).run();
    return {state:'current',provider:policy.provider,wallets:packet.wallets.length,provider_requests:1,wallet_history_requests:0};
  }catch(error) {
    const code=/^public_wallet_list_[a-z0-9_]{1,80}$/.test(error?.message||'')?error.message
      : ['TimeoutError','AbortError'].includes(error?.name)?'public_wallet_list_timeout':'public_wallet_list_failed';
    await db.prepare('UPDATE ravenos_public_wallet_list_refresh SET state=?,next_refresh_at=?,last_error_code=? WHERE provider=?')
      .bind('unavailable',now+3600,code,policy.provider).run();
    return {state:'unavailable',provider:policy.provider,error_code:code,provider_requests:1,wallet_history_requests:0};
  }
}
