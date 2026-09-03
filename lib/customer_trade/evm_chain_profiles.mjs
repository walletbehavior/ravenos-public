const NATIVE_TOKEN_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO_X_ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function profile(input) {
  return deepFreeze({
    provider: "0x_swap_api_v2",
    allowance_holder: ZERO_X_ALLOWANCE_HOLDER,
    native_token_address: NATIVE_TOKEN_ADDRESS,
    ...input,
  });
}

export const EVM_NATIVE_TOKEN_ADDRESS = NATIVE_TOKEN_ADDRESS;
export const EVM_ZERO_X_ALLOWANCE_HOLDER = ZERO_X_ALLOWANCE_HOLDER;

export const ROBINHOOD_EVM_CHAIN_PROFILE = profile({
  profile_id: "robinhood-mainnet-v1",
  chain_namespace: "robinhood",
  chain_id: 4663,
  canonical_chain_id: "eip155:4663",
  wallet_chain_id_hex: "0x1237",
  venue: "robinhood-chain",
  network_label: "Robinhood Chain",
  native_symbol: "ETH",
  wrapped_native_token_address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  environment_prefix: "RAVENOS_ROBINHOOD_ZEROX",
  exact_market_prefix: "robinhood:pool:",
  accounting_asset: {
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    decimals: 6,
    representation: "paxos_usdg",
    issuer: "Paxos",
    circle_canonical_usdc: false,
  },
});

export const BSC_EVM_CHAIN_PROFILE = profile({
  profile_id: "bsc-mainnet-v1",
  chain_namespace: "bsc",
  chain_id: 56,
  canonical_chain_id: "eip155:56",
  wallet_chain_id_hex: "0x38",
  venue: "bnb-chain",
  network_label: "BNB Chain",
  native_symbol: "BNB",
  wrapped_native_token_address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  environment_prefix: "RAVENOS_BSC_ZEROX",
  exact_market_prefix: "bsc:pool:",
  accounting_asset: {
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    symbol: "USDC",
    decimals: 18,
    representation: "binance_peg_usdc",
    issuer: "Binance-Peg",
    circle_canonical_usdc: false,
  },
});

export const BASE_EVM_CHAIN_PROFILE = profile({
  profile_id: "base-mainnet-v1",
  chain_namespace: "base",
  chain_id: 8453,
  canonical_chain_id: "eip155:8453",
  wallet_chain_id_hex: "0x2105",
  venue: "base",
  network_label: "Base",
  native_symbol: "ETH",
  wrapped_native_token_address: "0x4200000000000000000000000000000000000006",
  environment_prefix: "RAVENOS_BASE_ZEROX",
  exact_market_prefix: "base:pool:",
  accounting_asset: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913".toLowerCase(),
    symbol: "USDC",
    decimals: 6,
    representation: "circle_native_usdc",
    issuer: "Circle",
    circle_canonical_usdc: true,
  },
});

export const ETHEREUM_EVM_CHAIN_PROFILE = profile({
  profile_id: "ethereum-mainnet-v1",
  chain_namespace: "ethereum",
  chain_id: 1,
  canonical_chain_id: "eip155:1",
  wallet_chain_id_hex: "0x1",
  venue: "ethereum",
  network_label: "Ethereum",
  native_symbol: "ETH",
  wrapped_native_token_address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  environment_prefix: "RAVENOS_ETHEREUM_ZEROX",
  exact_market_prefix: "ethereum:pool:",
  accounting_asset: {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    decimals: 6,
    representation: "circle_native_usdc",
    issuer: "Circle",
    circle_canonical_usdc: true,
  },
});

export const EVM_CHAIN_PROFILES = deepFreeze({
  robinhood: ROBINHOOD_EVM_CHAIN_PROFILE,
  bsc: BSC_EVM_CHAIN_PROFILE,
  base: BASE_EVM_CHAIN_PROFILE,
  ethereum: ETHEREUM_EVM_CHAIN_PROFILE,
});

const PROFILE_BY_ID = new Map(Object.values(EVM_CHAIN_PROFILES).map((value) => [value.profile_id, value]));
const PROFILE_ALIASES = new Map([
  ["robinhood", ROBINHOOD_EVM_CHAIN_PROFILE],
  ["robinhood-chain", ROBINHOOD_EVM_CHAIN_PROFILE],
  ["eip155:4663", ROBINHOOD_EVM_CHAIN_PROFILE],
  ["4663", ROBINHOOD_EVM_CHAIN_PROFILE],
  ["bsc", BSC_EVM_CHAIN_PROFILE],
  ["bnb", BSC_EVM_CHAIN_PROFILE],
  ["bnb-chain", BSC_EVM_CHAIN_PROFILE],
  ["binance-smart-chain", BSC_EVM_CHAIN_PROFILE],
  ["eip155:56", BSC_EVM_CHAIN_PROFILE],
  ["56", BSC_EVM_CHAIN_PROFILE],
  ["base", BASE_EVM_CHAIN_PROFILE],
  ["base-mainnet", BASE_EVM_CHAIN_PROFILE],
  ["eip155:8453", BASE_EVM_CHAIN_PROFILE],
  ["8453", BASE_EVM_CHAIN_PROFILE],
  ["ethereum", ETHEREUM_EVM_CHAIN_PROFILE],
  ["eth", ETHEREUM_EVM_CHAIN_PROFILE],
  ["ethereum-mainnet", ETHEREUM_EVM_CHAIN_PROFILE],
  ["eip155:1", ETHEREUM_EVM_CHAIN_PROFILE],
  ["1", ETHEREUM_EVM_CHAIN_PROFILE],
]);

export function resolveEvmChainProfile(value) {
  if (value && typeof value === "object") {
    const byId = PROFILE_BY_ID.get(String(value.profile_id || "").trim().toLowerCase());
    if (byId === value || byId) return byId;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = PROFILE_BY_ID.get(normalized) || PROFILE_ALIASES.get(normalized);
  if (!matched) {
    const error = new Error("evm_chain_profile_not_supported");
    error.code = "evm_chain_profile_not_supported";
    throw error;
  }
  return matched;
}

export function evmChainProfileForOrder(input = {}, fallback = null) {
  const selectors = [
    input.profile_id,
    input.chain_profile_id,
    input.chain_namespace,
    input.canonical_chain_id,
    input.chain_id,
    input.chainId,
    fallback,
  ].filter((value) => value !== null && value !== undefined && String(value).trim());
  if (!selectors.length) {
    const error = new Error("evm_chain_profile_required");
    error.code = "evm_chain_profile_required";
    throw error;
  }
  const profiles = selectors.map(resolveEvmChainProfile);
  const first = profiles[0];
  if (profiles.some((value) => value.profile_id !== first.profile_id)) {
    const error = new Error("evm_chain_profile_mismatch");
    error.code = "evm_chain_profile_mismatch";
    throw error;
  }
  return first;
}
