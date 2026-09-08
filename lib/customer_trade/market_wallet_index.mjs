import { observedWalletMarketEvidence } from "./wallet_market_evidence.mjs";
import bs58 from "bs58";
import { SourceWalletChainRegistry, normalizeSourceWalletChainIdentity } from "./source_wallet_chain_identity.mjs";

export const MARKET_WALLET_INDEX_CHAINS = Object.freeze(Object.keys(SourceWalletChainRegistry));
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

export function observedMarketWallets(projection, { now = Math.floor(Date.now() / 1000), maximum_rows = MAXIMUM_ROWS } = {}) {
  const maximum = Math.min(120, Math.max(1, Math.floor(Number(maximum_rows) || MAXIMUM_ROWS)));
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
  for (const [index,row] of (Array.isArray(rows) ? rows : []).slice(0, 120).entries()) {
    if (holders && (row.classification !== "owner" || row.excluded_from_wallet_concentration === true)) continue;
    const address = normalizedAddress(chain, holders ? row.holder_address : row.trader_address);
    const observed = Math.floor(Date.parse(holders ? projection.observed_at : row.observed_at) / 1000);
    if (!address || excluded.has(address) || !Number.isSafeInteger(observed) || observed > now + 60 || now - observed > RETAINED_SECONDS) continue;
    const source = normalizeSourceWalletChainIdentity({ chain, network: "mainnet", address });
    const prior = found.get(source.source_wallet_id);
    if (!prior && found.size >= maximum) continue;
    if (!prior || observed > prior.observed_at) found.set(source.source_wallet_id, {
      ...source, observed_at: observed, provider_scope: holders ? "retained_public_holders" : "retained_public_trade_senders",
      ...(holders&&projection.coverage?.scope!=='observed_wallet_balances'?{discovery_source:{source_kind:'top_holder',provider:'raven_retained_holders',source_rank:Number.isInteger(row.rank)&&row.rank>0?row.rank:index+1,
        source_reference:`https://app.ravenos.xyz/terminal/?${new URLSearchParams({chain,pair_address:identity.pool_address,token_address:identity.token_address})}`}}:{}),
    });
  }
  const wallets=[...found.values()];
  if(trades) {
    // Rank only the sampled activity we can prove. This is not a P&L ranking.
    const samples=observedWalletMarketEvidence(projection,{now,admitted_wallets:wallets})
      .filter(row=>row.unique_transactions>=3).sort((a,b)=>b.unique_transactions-a.unique_transactions||a.source_wallet_id.localeCompare(b.source_wallet_id));
    for(const [index,sample]of samples.entries()) {
      const wallet=found.get(sample.source_wallet_id);
      wallet.discovery_source={source_kind:'active_trader',provider:'raven_retained_pool_trades',source_rank:index+1,
        source_reference:`https://app.ravenos.xyz/terminal/?${new URLSearchParams({chain,pair_address:identity.pool_address,token_address:identity.token_address})}`};
    }
    wallets.sort((a,b)=>Number(Boolean(b.discovery_source))-Number(Boolean(a.discovery_source))||(a.discovery_source?.source_rank||999)-(b.discovery_source?.source_rank||999));
  }
  return wallets;
}

export async function retainMarketWallets(env, projection, store, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (String(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED) !== "1" || String(env.RAVENOS_WALLET_SCREENER_ENABLED) !== "1" || !env.RAVENOS_CUSTOMER_DB || !store?.recordSeenMarketWallet) return { state: "disabled", retained: 0 };
  const db = env.RAVENOS_CUSTOMER_DB;
  let throttle = recent.get(db);
  if (!throttle) { throttle = new Map(); recent.set(db, throttle); }
  let retained = 0;
  const admitted = [];
  for (const wallet of observedMarketWallets(projection, { now })) {
    const previous = throttle.get(wallet.source_wallet_id);
    if (previous?.ready && now - previous.at < THROTTLE_SECONDS) { admitted.push(wallet); continue; }
    const marker = { at: now };
    throttle.set(wallet.source_wallet_id, marker);
    try { await store.recordSeenMarketWallet(wallet, now); marker.ready = true; admitted.push(wallet); retained += 1; }
    catch { if (throttle.get(wallet.source_wallet_id) === marker) throttle.delete(wallet.source_wallet_id); }
  }
  while (throttle.size > 1000) throttle.delete(throttle.keys().next().value);
  let marketEvidence = "disabled";
  if (String(env.RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED) === "1" && store.recordSeenMarketEvidence) {
    const samples = observedWalletMarketEvidence(projection, { now, admitted_wallets: admitted });
    const key = "market:" + samples[0]?.market_id;
    const previous = throttle.get(key);
    const fingerprint = samples.map(row => row.sample_json + row.source_wallet_id).join("|");
    if (samples.length && (!previous || previous.fingerprint !== fingerprint || now - previous.at >= THROTTLE_SECONDS)) {
      try { await store.recordSeenMarketEvidence(samples); throttle.set(key, { at: now, fingerprint }); marketEvidence = "retained"; }
      catch { marketEvidence = "unavailable"; }
    } else marketEvidence = samples.length ? "cached" : "no_valid_samples";
  }
  return { state: "completed", retained, market_evidence: marketEvidence, provider_requests: 0, history_queued: false };
}
