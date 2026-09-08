import { heliusWalletReadRuntime } from './helius_wallet_history.mjs';
import { loadSolanaWalletHoldings } from './solana_wallet_holdings.mjs';
import { createSolanaTokenMetadataLoader } from './solana_token_metadata.mjs';
import { loadWalletTokenMarks } from './wallet_token_marks.mjs';

export function createSolanaWalletProfileReads(env,{rpc,metadataCache,cache}={}) {
  const read=(method,params)=>{
    const runtime=heliusWalletReadRuntime(env);
    if(!runtime.enabled)throw Error('wallet_read_provider_unavailable');
    return rpc(runtime.rpc_url,method,params,{timeoutMs:3500,maxBytes:1024*1024});
  };
  return {
    loadHoldings:({address,now})=>loadSolanaWalletHoldings({address,now:new Date(now*1000).toISOString(),rpc:read}),
    loadTokenMetadata:createSolanaTokenMetadataLoader({cache:metadataCache,rpc:read}),
    ...(env.RAVENOS_WALLET_DEX_MARKS_ENABLED==='1'?{loadTokenMarks:({tokens,now})=>loadWalletTokenMarks({chain:'solana',contracts:tokens.filter(row=>row.provider_mark_price_usd==null).map(row=>row.mint),now,cache})}:{}),
  };
}
