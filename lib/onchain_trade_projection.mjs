export const ONCHAIN_TRADE_SCHEMA = "ravenos.onchain_pool_trades.v1";
export const PUBLIC_ONCHAIN_TRADE_ROUTE = "/api/onchain/trades";

const MAX_PROVIDER_ROWS = 300;
const MAX_PUBLIC_TRADES = 120;
const MAX_PUBLIC_TRADERS = 24;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_TRANSACTION_RE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_TRANSACTION_RE = /^0x[a-fA-F0-9]{64}$/;
const SUPPORTED_CHAINS = new Set(["solana", "base", "bsc", "ethereum", "robinhood"]);
const EXPLORERS = Object.freeze({
  solana: Object.freeze({ transaction: "https://solscan.io/tx/", account: "https://solscan.io/account/" }),
  base: Object.freeze({ transaction: "https://basescan.org/tx/", account: "https://basescan.org/address/" }),
  bsc: Object.freeze({ transaction: "https://bscscan.com/tx/", account: "https://bscscan.com/address/" }),
  ethereum: Object.freeze({ transaction: "https://etherscan.io/tx/", account: "https://etherscan.io/address/" }),
});

export const OnchainTradeProjectionContract = Object.freeze({
  schema_version: ONCHAIN_TRADE_SCHEMA,
  exact_pool_identity_required: true,
  maximum_provider_rows: MAX_PROVIDER_ROWS,
  maximum_public_trade_rows: MAX_PUBLIC_TRADES,
  maximum_public_trader_rows: MAX_PUBLIC_TRADERS,
  public_chain_addresses_only: true,
  customer_account_join_allowed: false,
  actor_labels_inferred: false,
  relationships_inferred: false,
  profitability_inferred: false,
  execution_available: false,
});

function finite(value, { minimum = 0, maximum = 1_000_000_000_000_000 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function cleanChain(value) {
  const chain = String(value || "").trim().toLowerCase();
  return SUPPORTED_CHAINS.has(chain) ? chain : null;
}

function cleanAddress(chain, value) {
  const address = String(value || "").trim();
  if (chain === "solana") return SOLANA_ADDRESS_RE.test(address) ? address : null;
  return EVM_ADDRESS_RE.test(address) ? address.toLowerCase() : null;
}

function cleanTransaction(chain, value) {
  const transaction = String(value || "").trim();
  if (chain === "solana") return SOLANA_TRANSACTION_RE.test(transaction) ? transaction : null;
  return EVM_TRANSACTION_RE.test(transaction) ? transaction.toLowerCase() : null;
}

function sameAddress(chain, left, right) {
  const a = cleanAddress(chain, left);
  const b = cleanAddress(chain, right);
  return Boolean(a && b && a === b);
}

function isoTimestamp(value, nowMs) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || parsed > nowMs + 300_000 || nowMs - parsed > 26 * 60 * 60 * 1_000) return null;
  return new Date(parsed).toISOString();
}

function explorerUrl(chain, kind, value) {
  const base = EXPLORERS[chain]?.[kind];
  return base ? `${base}${value}` : null;
}

function normalizeIdentity(identity = {}) {
  const chain = cleanChain(identity.chain);
  if (!chain) return null;
  const poolAddress = cleanAddress(chain, identity.pool_address);
  const tokenAddress = cleanAddress(chain, identity.token_address);
  const quoteAddress = cleanAddress(chain, identity.quote_token_address);
  if (!poolAddress || !tokenAddress || !quoteAddress || tokenAddress === quoteAddress) return null;
  return {
    chain,
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_token_address: quoteAddress,
    instrument_id: `${chain}:pool:${poolAddress}`,
  };
}

function normalizedTrade(row, identity, nowMs, index) {
  const attributes = row?.attributes && typeof row.attributes === "object" ? row.attributes : {};
  const fromAddress = cleanAddress(identity.chain, attributes.from_token_address);
  const toAddress = cleanAddress(identity.chain, attributes.to_token_address);
  if (!fromAddress || !toAddress) return null;
  const selectedIsFrom = sameAddress(identity.chain, fromAddress, identity.token_address);
  const selectedIsTo = sameAddress(identity.chain, toAddress, identity.token_address);
  const quoteIsFrom = sameAddress(identity.chain, fromAddress, identity.quote_token_address);
  const quoteIsTo = sameAddress(identity.chain, toAddress, identity.quote_token_address);
  if ((!selectedIsFrom && !selectedIsTo) || (!quoteIsFrom && !quoteIsTo) || selectedIsFrom === quoteIsFrom) return null;

  const observedAt = isoTimestamp(attributes.block_timestamp, nowMs);
  const transactionHash = cleanTransaction(identity.chain, attributes.tx_hash);
  const tokenAmount = finite(selectedIsFrom ? attributes.from_token_amount : attributes.to_token_amount);
  const quoteAmount = finite(quoteIsFrom ? attributes.from_token_amount : attributes.to_token_amount);
  const tokenPriceUsd = finite(selectedIsFrom ? attributes.price_from_in_usd : attributes.price_to_in_usd);
  const volumeUsd = finite(attributes.volume_in_usd);
  if (!observedAt || !transactionHash || tokenAmount === null || tokenAmount <= 0 || volumeUsd === null || volumeUsd <= 0) return null;
  const traderAddress = cleanAddress(identity.chain, attributes.tx_from_address);
  const blockNumber = finite(attributes.block_number, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  const providerId = String(row?.id || "").replace(/[^A-Za-z0-9:._-]/g, "").slice(0, 180);
  return {
    event_id: providerId || `${identity.chain}:${transactionHash}:${index}`,
    observed_at: observedAt,
    side: selectedIsFrom ? "sell" : "buy",
    price_usd: tokenPriceUsd,
    token_amount: tokenAmount,
    quote_amount: quoteAmount,
    volume_usd: volumeUsd,
    trader_address: traderAddress,
    transaction_hash: transactionHash,
    block_number: blockNumber === null ? null : Math.trunc(blockNumber),
    trader_explorer_url: traderAddress ? explorerUrl(identity.chain, "account", traderAddress) : null,
    transaction_explorer_url: explorerUrl(identity.chain, "transaction", transactionHash),
  };
}

function windowSummary(rows, nowMs, seconds) {
  const minimum = nowMs - seconds * 1_000;
  const selected = rows.filter((row) => Date.parse(row.observed_at) >= minimum);
  const buys = selected.filter((row) => row.side === "buy");
  const sells = selected.filter((row) => row.side === "sell");
  const buyVolume = buys.reduce((sum, row) => sum + row.volume_usd, 0);
  const sellVolume = sells.reduce((sum, row) => sum + row.volume_usd, 0);
  const totalVolume = buyVolume + sellVolume;
  const addresses = new Set(selected.map((row) => row.trader_address).filter(Boolean));
  return {
    trade_count: selected.length,
    buy_count: buys.length,
    sell_count: sells.length,
    volume_usd: totalVolume,
    buy_volume_usd: buyVolume,
    sell_volume_usd: sellVolume,
    net_buy_volume_usd: buyVolume - sellVolume,
    buy_volume_share_pct: totalVolume > 0 ? (buyVolume / totalVolume) * 100 : null,
    unique_trader_count: addresses.size || null,
  };
}

function activeTraderRows(rows) {
  const byAddress = new Map();
  for (const row of rows) {
    if (!row.trader_address) continue;
    const existing = byAddress.get(row.trader_address) || {
      trader_address: row.trader_address,
      trade_count: 0,
      buy_count: 0,
      sell_count: 0,
      buy_volume_usd: 0,
      sell_volume_usd: 0,
      first_seen_at: row.observed_at,
      last_seen_at: row.observed_at,
      explorer_url: row.trader_explorer_url,
    };
    existing.trade_count += 1;
    existing[`${row.side}_count`] += 1;
    existing[`${row.side}_volume_usd`] += row.volume_usd;
    if (Date.parse(row.observed_at) < Date.parse(existing.first_seen_at)) existing.first_seen_at = row.observed_at;
    if (Date.parse(row.observed_at) > Date.parse(existing.last_seen_at)) existing.last_seen_at = row.observed_at;
    byAddress.set(row.trader_address, existing);
  }
  return [...byAddress.values()].map((row) => {
    const total = row.buy_volume_usd + row.sell_volume_usd;
    const buyShare = total > 0 ? row.buy_volume_usd / total : 0.5;
    return {
      ...row,
      total_volume_usd: total,
      net_buy_volume_usd: row.buy_volume_usd - row.sell_volume_usd,
      recurrence: row.trade_count >= 2 ? "repeat" : "single_observation",
      direction: buyShare >= 0.65 ? "buy_dominant" : buyShare <= 0.35 ? "sell_dominant" : "mixed",
    };
  }).sort((left, right) => right.total_volume_usd - left.total_volume_usd || right.trade_count - left.trade_count)
    .slice(0, MAX_PUBLIC_TRADERS)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function attachSampleRanks(rows) {
  const rankedIds = [...rows]
    .sort((left, right) => right.volume_usd - left.volume_usd)
    .map((row) => row.event_id);
  const largestCount = Math.max(1, Math.ceil(rankedIds.length * 0.1));
  const largest = new Set(rankedIds.slice(0, largestCount));
  return rows.map((row) => ({
    ...row,
    sample_size_tier: largest.has(row.event_id) ? "largest_10_pct" : "standard",
  }));
}

export function buildPublicOnchainTradeProjection({
  identity = {},
  provider_payload = {},
  observed_at = null,
  source_label = "CoinGecko Onchain",
  attribution_url = "https://www.coingecko.com/en/api",
  now = () => new Date(),
} = {}) {
  const exactIdentity = normalizeIdentity(identity);
  if (!exactIdentity) throw new Error("onchain_trade_identity_invalid");
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue));
  if (!Number.isFinite(nowMs)) throw new Error("onchain_trade_clock_invalid");
  const seen = new Set();
  const normalized = [];
  for (const [index, row] of (Array.isArray(provider_payload?.data) ? provider_payload.data : []).slice(0, MAX_PROVIDER_ROWS).entries()) {
    const trade = normalizedTrade(row, exactIdentity, nowMs, index);
    if (!trade) continue;
    const key = `${trade.event_id}:${trade.side}:${trade.token_amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trade);
  }
  normalized.sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at));
  const trades = attachSampleRanks(normalized.slice(0, MAX_PUBLIC_TRADES));
  const traders = activeTraderRows(trades);
  const repeated = new Set(traders.filter((row) => row.recurrence === "repeat").map((row) => row.trader_address));
  const repeatedVolume = trades.filter((row) => repeated.has(row.trader_address)).reduce((sum, row) => sum + row.volume_usd, 0);
  const totalVolume = trades.reduce((sum, row) => sum + row.volume_usd, 0);
  const observedAt = isoTimestamp(observed_at || nowValue.toISOString(), nowMs) || new Date(nowMs).toISOString();
  return {
    ok: trades.length > 0,
    safe_public: true,
    schema_version: ONCHAIN_TRADE_SCHEMA,
    state: trades.length ? "available" : "unavailable",
    identity: exactIdentity,
    observed_at: observedAt,
    freshness: {
      state: trades.length && nowMs - Date.parse(trades[0].observed_at) <= 120_000 ? "live" : trades.length ? "recent" : "unavailable",
      latest_trade_at: trades[0]?.observed_at || null,
    },
    coverage: {
      scope: "exact_pool_last_24h_bounded",
      provider_row_limit: MAX_PROVIDER_ROWS,
      returned_trade_rows: trades.length,
      returned_trader_rows: traders.length,
      complete_history: false,
    },
    summary: {
      windows: {
        m5: windowSummary(trades, nowMs, 5 * 60),
        h1: windowSummary(trades, nowMs, 60 * 60),
        h24: windowSummary(trades, nowMs, 24 * 60 * 60),
      },
      repeat_trader_count: repeated.size,
      repeat_trader_volume_share_pct: totalVolume > 0 ? (repeatedVolume / totalVolume) * 100 : null,
      largest_trade_usd: trades.reduce((largest, row) => Math.max(largest, row.volume_usd), 0) || null,
    },
    trades,
    active_traders: traders,
    source: {
      label: String(source_label || "CoinGecko Onchain").slice(0, 80),
      attribution_url,
    },
    limitations: [
      "This is a bounded exact-pool tape, not complete lifetime history.",
      "Trader addresses are public transaction senders; beneficial ownership and related addresses are not inferred.",
      "Repeat activity describes only this returned pool sample and is not a smart-money label or performance claim.",
    ],
    privacy: {
      public_chain_addresses_only: true,
      customer_account_joined: false,
      private_labels_included: false,
    },
    execution_boundary: {
      research_only: true,
      signing_available: false,
      submission_available: false,
    },
  };
}

export function publicOnchainTradeUnavailable(error, identity = {}) {
  const code = String(error?.code || error?.message || "onchain_trade_unavailable");
  const invalid = code.includes("identity_invalid") || code.includes("request_invalid");
  return {
    status: invalid ? 400 : 200,
    payload: {
      ok: false,
      safe_public: true,
      schema_version: ONCHAIN_TRADE_SCHEMA,
      state: "unavailable",
      identity: normalizeIdentity(identity),
      error: invalid ? "onchain_trade_request_invalid" : "onchain_trade_temporarily_unavailable",
      trades: [],
      active_traders: [],
      execution_boundary: { research_only: true, signing_available: false, submission_available: false },
    },
  };
}
