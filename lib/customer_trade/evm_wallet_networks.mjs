import {EVM_CHAIN_PROFILES, resolveEvmChainProfile} from './evm_chain_profiles.mjs';

// Public wallet endpoints only. Raven's paid quote/history RPC credentials stay
// server-side. These network definitions also serve external-wallet add requests.
const publicNetworks = Object.freeze({
  ethereum: ['https://cloudflare-eth.com', 'https://etherscan.io'],
  base: ['https://mainnet.base.org', 'https://basescan.org'],
  bsc: ['https://bsc-dataseed-public.bnbchain.org', 'https://bscscan.com'],
  robinhood: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhoodchain.blockscout.com'],
});

export function evmWalletNetwork(selector) {
  const profile = resolveEvmChainProfile(selector);
  const [rpc, explorer] = publicNetworks[profile.chain_namespace];
  return {
    id: profile.chain_id,
    name: profile.network_label,
    nativeCurrency: {name: profile.native_symbol, symbol: profile.native_symbol, decimals: 18},
    rpcUrls: {default: {http: [rpc]}},
    blockExplorers: {default: {name: `${profile.network_label} Explorer`, url: explorer}},
  };
}

export const RAVEN_EVM_WALLET_NETWORKS = Object.freeze(Object.keys(EVM_CHAIN_PROFILES).map(evmWalletNetwork));
// Existing EVM networks use Privy's configured RPCs. Robinhood is custom.
export const RAVEN_CUSTOM_WALLET_RPC_ORIGINS = Object.freeze([new URL(publicNetworks.robinhood[0]).origin]);

export function evmWalletAddNetworkParameters(selector) {
  const network = evmWalletNetwork(selector);
  return {
    chainId: `0x${network.id.toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: network.rpcUrls.default.http,
    blockExplorerUrls: [network.blockExplorers.default.url],
  };
}
