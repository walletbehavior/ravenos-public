import bs58 from "bs58";
import { normalizeSourceWalletChainIdentity } from "./source_wallet_chain_identity.mjs";

// The deployed shared-source table currently admits Solana and Robinhood.
// Other EVM lookups remain separate until its chain constraints are migrated.
export const MARKET_WALLET_INDEX_CHAINS = Object.freeze(["solana", "robinhood"]);
const MAXIMUM_ROWS = 20;
const RETAINED_SECONDS = 86400;
const THROTTLE_SECONDS = 300;
const recent = new WeakMap();

function normalizedAddress(chain, address) {
  if (typeof address !== "string") return null;
  try {
    if (chain === "solana" && bs58.decode(address).length !== 32) return null;
    if (chain !== "solana" && /^0x0{40}$/i.test(address)) return null;
    return normalizeSourceWalletChainIdentity({ chain, network: "mainnet", address }).address;
  } catch { return null; }
}

export function observedMarketWallets(projection, { now = Math.floor(Date.now() / 1000) } = {}) {
  const chain = projection?.identity?.chain;
  if (!MARKET_WALLET_INDEX_CHAINS.includes(chain) || projection?.ok !== true || projection.safe_public !== true) return [];
  const holders = projection.schema_version === "ravenos.onchain_holder_list.v2";
  const trades = projection.schema_version === "ravenos.onchain_pool_trades.v1";
  if (!holders && !trades) return [];
  const identity = projection.identity;
  const poolPattern = chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
  if (!poolPattern.test(identity.pool_address || "") || !normalizedAddress(chain, identity.token_address)) return [];
  const excluded = new Set([identity.pool_address, identity.token_address, identity.quote_token_address].filter(Boolean).map(value => chain === "solana" ? value : value.toLowerCase()));
  const rows = holders ? projection.holders : projection.trades;
  const found = new Map();
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, 120)) {
    if (holders && (row.classification !== "owner" || row.excluded_from_wallet_concentration === true)) continue;
    const address = normalizedAddress(chain, holders ? row.holder_address : row.trader_address);
    const observed = Math.floor(Date.parse(holders ? projection.observed_at : row.observed_at) / 1000);
    if (!address || excluded.has(address) || !Number.isSafeInteger(observed) || observed > now + 60 || now - observed > RETAINED_SECONDS) continue;
    const source = normalizeSourceWalletChainIdentity({ chain, network: "mainnet", address });
    const prior = found.get(source.source_wallet_id);
    if (!prior && found.size >= MAXIMUM_ROWS) continue;
    if (!prior || observed > prior.observed_at) found.set(source.source_wallet_id, {
      ...source, observed_at: observed, provider_scope: holders ? "retained_public_holders" : "retained_public_trade_senders",
    });
  }
  return [...found.values()];
}

export async function retainMarketWallets(env, projection, store, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (String(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED) !== "1" || String(env.RAVENOS_WALLET_SCREENER_ENABLED) !== "1" || !env.RAVENOS_CUSTOMER_DB || !store?.recordSeenMarketWallet) return { state: "disabled", retained: 0 };
  const db = env.RAVENOS_CUSTOMER_DB;
  let throttle = recent.get(db);
  if (!throttle) { throttle = new Map(); recent.set(db, throttle); }
  let retained = 0;
  for (const wallet of observedMarketWallets(projection, { now })) {
    const previous = throttle.get(wallet.source_wallet_id);
    if (previous && now - previous.at < THROTTLE_SECONDS) continue;
    const marker = { at: now };
    throttle.set(wallet.source_wallet_id, marker);
    try { await store.recordSeenMarketWallet(wallet, now); retained += 1; }
    catch { if (throttle.get(wallet.source_wallet_id) === marker) throttle.delete(wallet.source_wallet_id); }
  }
  while (throttle.size > 1000) throttle.delete(throttle.keys().next().value);
  return { state: "completed", retained, provider_requests: 0, history_queued: false };
}
