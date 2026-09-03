import { ravenOSContext, savedMonitorHandoffHref } from "./ravenos-context-store.js";
import {
  RAVENOS_CHART_TIMEFRAMES,
  RAVENOS_TERMINAL_CHAIN_ROLLOUT,
  getChartDataPlaneDiagnostics,
  resolveChartCapability,
} from "./ravenos-chart-data-plane.js";
import { customerFacingText } from "./ravenos-intelligence-contract.js";
import { mountTradingViewChart } from "./ravenos-tradingview-adapter.js";

document.body.classList.add("ros-terminal-live-shell");

const TIMEFRAMES = new Set(RAVENOS_CHART_TIMEFRAMES);
const SAVED_INDICATORS = new Set(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const SAVED_RAVEN_OVERLAYS = new Set(["structure", "pressure", "participation", "replay", "risk", "pressure-zone", "history-window", "breadth-line", "compression-band", "regime-marker", "liquidity-zone", "participant-shift"]);
const SAVED_DENSITIES = new Set(["compact", "comfortable"]);
const SAVED_PANELS = new Set(["chart", "raven", "book", "trade", "account"]);
const TERMINAL_PANELS = new Set(["chart", "activity", "holders", "raven", "book", "trade", "account"]);
const SPOT_ACTIVITY_VIEWS = new Set(["trades", "wallets"]);
const PLAN_OVERLAY_TYPES = new Set(["plan-entry", "plan-target", "plan-risk"]);
const SPOT_TICKET_STORAGE_KEY = "ravenos.universal_shadow_ticket_preferences.v1";
const DEFAULT_SPOT_BUY_SIZES = Object.freeze([10, 50, 100, 500]);
const DEFAULT_SPOT_NATIVE_BUY_SIZES = Object.freeze([0.1, 0.5, 1, 2]);
const SPOT_PLAN_SOURCES = new Set(["raven_exact_market", "user_preset", "custom"]);
const SOLANA_CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_WRAPPED_NATIVE_MINT = "So11111111111111111111111111111111111111112";
const ROBINHOOD_CANONICAL_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ROBINHOOD_NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const BSC_BINANCE_PEG_USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const BASE_CIRCLE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913";
const ETHEREUM_CIRCLE_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const EVM_NATIVE_ASSET = ROBINHOOD_NATIVE_ETH;
const EVM_SPOT_PROFILES = Object.freeze({
  robinhood: Object.freeze({
    profile_id: "robinhood-mainnet-v1",
    chain_namespace: "robinhood",
    chain_id: 4663,
    canonical_chain_id: "eip155:4663",
    accounting_address: ROBINHOOD_CANONICAL_USDG,
    accounting_symbol: "USDG",
    native_symbol: "ETH",
  }),
  bsc: Object.freeze({
    profile_id: "bsc-mainnet-v1",
    chain_namespace: "bsc",
    chain_id: 56,
    canonical_chain_id: "eip155:56",
    accounting_address: BSC_BINANCE_PEG_USDC,
    accounting_symbol: "USDC",
    native_symbol: "BNB",
  }),
  base: Object.freeze({
    profile_id: "base-mainnet-v1",
    chain_namespace: "base",
    chain_id: 8453,
    canonical_chain_id: "eip155:8453",
    accounting_address: BASE_CIRCLE_USDC,
    accounting_symbol: "USDC",
    native_symbol: "ETH",
  }),
  ethereum: Object.freeze({
    profile_id: "ethereum-mainnet-v1",
    chain_namespace: "ethereum",
    chain_id: 1,
    canonical_chain_id: "eip155:1",
    accounting_address: ETHEREUM_CIRCLE_USDC,
    accounting_symbol: "USDC",
    native_symbol: "ETH",
  }),
});
const announcedEvmWallets = new Map();
const boundEvmWalletProviders = new WeakSet();
function rememberAnnouncedEvmWallet(event) {
  const detail = event?.detail;
  const provider = detail?.provider;
  const uuid = String(detail?.info?.uuid || "").trim();
  const name = String(detail?.info?.name || "Wallet").trim().slice(0, 80);
  if (!provider?.request || !uuid || announcedEvmWallets.has(uuid)) return;
  announcedEvmWallets.set(uuid, Object.freeze({ provider, name, uuid }));
}
globalThis.addEventListener?.("eip6963:announceProvider", rememberAnnouncedEvmWallet);
globalThis.dispatchEvent?.(new Event("eip6963:requestProvider"));
const SPOT_TRADE_REFRESH_MS = 5_000;
const SPOT_TRADE_RENDER_LIMIT = 60;
const state = {
  lane: "perps",
  markets: [],
  publicPerps: null,
  atlas: null,
  selected: null,
  timeframe: "1h",
  workspace: null,
  context: null,
  opportunityEvidence: null,
  flags: null,
  searchGeneration: 0,
  selectionGeneration: 0,
  searchTimer: null,
  externalChart: null,
  marketPreview: null,
  marketPreviewSide: "long",
  marketPreviewGeneration: 0,
  marketPreviewExpiryTimer: null,
  orderPlan: null,
  orderPlanType: "market",
  orderPlanGeneration: 0,
  orderPlanExpiryTimer: null,
  planOverlayEnabled: false,
  launchSource: "",
  autoRavenOverlays: false,
  savedRavenOverlays: [],
  density: "comfortable",
  requestedPanel: "chart",
  chartRead: null,
  orderBook: null,
  tapeRows: [],
  accountSnapshot: null,
  accountHistory: null,
  accountHistoryLoading: false,
  accountTab: "positions",
  accountGeneration: 0,
  walletTransportConnected: false,
  walletAddress: null,
  walletListenersBound: false,
  selectedEvmWalletProvider: null,
  selectedSolanaWalletProvider: null,
  paneScrollPositions: {},
  selectedMarker: null,
  planQualificationIssue: "unavailable",
  holderListGeneration: 0,
  holderListCache: new Map(),
  holderListLoadingKey: "",
  holderListFilter: "all",
  holderListExpandedKey: "",
  marketControlRisk: null,
  spotTradeGeneration: 0,
  spotTradeCache: new Map(),
  spotTradeLoadingKey: "",
  spotTradeFilter: "all",
  spotActivityView: "trades",
  spotWalletFilter: "all",
  spotTradeRefreshTimer: null,
  spotCurrentPrice: null,
  spotValuationReference: null,
  projectProfile: null,
  spotTicketSide: "buy",
  spotTicketPlanSource: "user_preset",
  spotTicketPreferences: null,
  spotQuote: null,
  spotQuoteGeneration: 0,
  spotQuoteExpiryTimer: null,
  spotQuoteRefreshTimer: null,
  spotQuoteAbortController: null,
  spotQuoteStatus: "idle",
  spotQuoteExpiresAt: 0,
  spotQuoteFingerprint: "",
  spotQuoteFollow: false,
  solanaWalletAddress: null,
  solanaWalletConnected: false,
  spotLiveTicket: null,
  spotLiveUnsignedTransaction: null,
  spotLiveProviderQuote: null,
  spotLivePending: false,
  spotLiveResult: null,
  liveAuth: null,
  liveSession: null,
  liveBuilderApproval: null,
  liveTicket: null,
  liveExecutionPending: false,
  liveExecutionResult: null,
  walletExecutionBundle: null,
};

function renderLaunchBadge() {
  const badge = document.getElementById("terminalLaunchBadge");
  if (!badge) return;
  const labels = {
    velocity: "Found in Velocity",
    raven: "Found by Raven",
    activity: "Found in Activity",
  };
  const label = state.lane === "spot" ? labels[state.launchSource] : "";
  badge.hidden = !label;
  badge.textContent = label || "";
  badge.title = label
    ? "Opened from Discover. Raven chart levels appear only when this exact market has current evidence."
    : "";
}

function spotChartCapability(row = {}, timeframe = "1h") {
  const market = row || {};
  const coverage = market.chart_coverage;
  const resolved = resolveChartCapability({
    market: "crypto_spot",
    chain: market.chainId,
    instrumentType: "spot_pool",
    pairAddress: market.pairAddress,
    timeframe,
    providerId: coverage?.provider_id || "",
  });
  if (coverage?.schema_version === "ravenos.search_chart_coverage.v1" && coverage.state === "unavailable") {
    return {
      ...resolved,
      chart_ready: false,
      chart_request_supported: false,
      unavailable_reason: coverage.reason || resolved.unavailable_reason,
    };
  }
  return resolved;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boundedSpotBuySize(value) {
  const amount = finite(value);
  return amount !== null && amount >= 1 && amount <= 100_000
    ? Number(amount.toFixed(2))
    : null;
}

function boundedSpotNativeBuySize(value) {
  const amount = finite(value);
  return amount !== null && amount >= 0.001 && amount <= 50
    ? Number(amount.toFixed(4))
    : null;
}

function spotAssetPreference(value) {
  return new Set(["auto", "canonical_usdc", "native"]).has(value) ? value : "auto";
}

function boundedSpotPreference(value, fallback, { minimum, maximum } = {}) {
  const amount = finite(value);
  return amount !== null && amount >= minimum && amount <= maximum ? amount : fallback;
}

function loadSpotTicketPreferences() {
  if (state.spotTicketPreferences) return state.spotTicketPreferences;
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(SPOT_TICKET_STORAGE_KEY) || "null");
  } catch {
    stored = null;
  }
  const buySizes = Array.isArray(stored?.buy_sizes_usdc)
    ? stored.buy_sizes_usdc.slice(0, 4).map(boundedSpotBuySize)
    : [];
  while (buySizes.length < 4) buySizes.push(DEFAULT_SPOT_BUY_SIZES[buySizes.length]);
  const nativeBuySizes = Array.isArray(stored?.buy_sizes_native)
    ? stored.buy_sizes_native.slice(0, 4).map(boundedSpotNativeBuySize)
    : [];
  while (nativeBuySizes.length < 4) nativeBuySizes.push(DEFAULT_SPOT_NATIVE_BUY_SIZES[nativeBuySizes.length]);
  state.spotTicketPreferences = {
    schema_version: "ravenos.universal_shadow_ticket_preferences.v1",
    buy_sizes_usdc: buySizes.map((value, index) => value ?? DEFAULT_SPOT_BUY_SIZES[index]),
    buy_sizes_native: nativeBuySizes.map((value, index) => value ?? DEFAULT_SPOT_NATIVE_BUY_SIZES[index]),
    funding_preference: spotAssetPreference(stored?.funding_preference),
    settlement_preference: spotAssetPreference(stored?.settlement_preference),
    take_profit_pct: boundedSpotPreference(stored?.take_profit_pct, 25, { minimum: 0.1, maximum: 1_000 }),
    stop_loss_pct: boundedSpotPreference(stored?.stop_loss_pct, 12, { minimum: 0.1, maximum: 99 }),
    slippage_bps: boundedSpotPreference(stored?.slippage_bps, 50, { minimum: 5, maximum: 300 }),
    priority_mode: stored?.priority_mode === "capped" ? "capped" : "standard",
    priority_cap_lamports: Math.round(boundedSpotPreference(stored?.priority_cap_lamports, 10_000, { minimum: 1_000, maximum: 50_000 })),
  };
  return state.spotTicketPreferences;
}

function saveSpotTicketPreferences(next = {}) {
  const current = loadSpotTicketPreferences();
  state.spotTicketPreferences = { ...current, ...next, schema_version: current.schema_version };
  try {
    localStorage.setItem(SPOT_TICKET_STORAGE_KEY, JSON.stringify(state.spotTicketPreferences));
  } catch {
    // Local convenience state is optional; the ticket remains usable without persistence.
  }
  return state.spotTicketPreferences;
}

function setText(id, value, fallback = "--") {
  const element = document.getElementById(id);
  if (element) element.textContent = value === null || value === undefined || value === "" ? fallback : String(value);
}

function hasOperatorValue(value) {
  if (value === null || value === undefined || value === "") return false;
  const clean = String(value).trim().toLowerCase();
  return Boolean(clean) && !new Set([
    "--",
    "—",
    "unavailable",
    "unknown",
    "not projected",
    "checking",
    "resolving",
    "timestamp unavailable",
  ]).has(clean);
}

function setOptionalField(id, value, { fallback = "", show = hasOperatorValue(value) } = {}) {
  const element = document.getElementById(id);
  if (!element) return false;
  element.textContent = show ? String(value) : fallback;
  const cell = element.closest("div");
  if (cell) cell.hidden = !show;
  return show;
}

function setLastMetric(value) {
  const label = formatPrice(value);
  const show = hasOperatorValue(label);
  setText("terminalLast", show ? label : "");
  const cell = document.getElementById("terminalLastMetric");
  if (cell) cell.hidden = !show;
}

const SPOT_CURRENT_PRICE_SOURCE_PRIORITY = Object.freeze({
  pair_snapshot: 1,
  chart_candle: 2,
  exact_pool_trade_tape: 3,
});

function seedSelectedSpotValuation(row = {}) {
  const identity = currentProjectIdentity();
  const referencePrice = finite(row.priceUsd);
  const marketCap = finite(row.marketCap);
  const fdv = finite(row.fdv);
  if (!identity || referencePrice === null || referencePrice <= 0 || ![marketCap, fdv].some((value) => value !== null && value > 0)) {
    state.spotValuationReference = null;
    return null;
  }
  state.spotValuationReference = {
    identityKey: identity.key,
    referencePrice,
    marketCap: marketCap !== null && marketCap > 0 ? marketCap : null,
    fdv: fdv !== null && fdv > 0 ? fdv : null,
  };
  return state.spotValuationReference;
}

function currentSpotValuation(price) {
  const identity = currentProjectIdentity();
  const reference = state.spotValuationReference;
  const currentPrice = finite(price);
  if (!identity || reference?.identityKey !== identity.key || currentPrice === null || currentPrice <= 0) return null;
  const multiplier = currentPrice / reference.referencePrice;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  const scale = (value) => {
    const source = finite(value);
    const result = source === null ? null : source * multiplier;
    return result !== null && Number.isFinite(result) && result > 0 && result <= 1_000_000_000_000_000 ? result : null;
  };
  return { marketCap: scale(reference.marketCap), fdv: scale(reference.fdv) };
}

function reconcileSelectedSpotPrice(update = {}) {
  const selected = currentProjectIdentity();
  const chain = String(update.chain || "").trim().toLowerCase();
  const poolAddress = String(update.pool_address || "").trim();
  const tokenAddress = String(update.token_address || "").trim();
  const quoteAddress = String(update.quote_token_address || "").trim();
  const price = finite(update.price ?? update.last_price ?? update.last);
  const source = String(update.source || "").trim();
  const observedAt = String(update.observed_at || update.observedAt || "").trim();
  const observedMs = Date.parse(observedAt);
  if (
    !selected
    || chain !== selected.chain
    || !sameSelectedAddress(chain, poolAddress, selected.poolAddress)
    || !sameSelectedAddress(chain, tokenAddress, selected.tokenAddress)
    || (selected.quoteAddress && !sameSelectedAddress(chain, quoteAddress, selected.quoteAddress))
    || price === null
    || price <= 0
    || price > 1_000_000_000_000
    || !Object.hasOwn(SPOT_CURRENT_PRICE_SOURCE_PRIORITY, source)
    || (!Number.isFinite(observedMs) && source !== "pair_snapshot")
    || (Number.isFinite(observedMs) && observedMs > Date.now() + 30_000)
  ) return false;
  const candidateObservedMs = Number.isFinite(observedMs) ? observedMs : Number.NEGATIVE_INFINITY;
  const current = state.spotCurrentPrice?.identityKey === selected.key ? state.spotCurrentPrice : null;
  const currentPriority = SPOT_CURRENT_PRICE_SOURCE_PRIORITY[current?.source] || 0;
  const candidatePriority = SPOT_CURRENT_PRICE_SOURCE_PRIORITY[source];
  if (
    current
    && (
      candidateObservedMs < current.observedMs
      || (candidateObservedMs === current.observedMs && candidatePriority < currentPriority)
    )
  ) return false;
  state.spotCurrentPrice = {
    identityKey: selected.key,
    price,
    observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
    observedMs: candidateObservedMs,
    source,
  };
  const valuation = currentSpotValuation(price);
  state.selected = {
    ...state.selected,
    priceUsd: price,
    lastUpdated: state.spotCurrentPrice.observedAt,
    marketCap: valuation?.marketCap ?? state.selected?.marketCap ?? null,
    fdv: valuation?.fdv ?? state.selected?.fdv ?? null,
  };
  setLastMetric(price);
  setMarketMetric(
    2,
    valuation?.marketCap !== null && valuation?.marketCap !== undefined ? "Market cap" : "FDV",
    compact(valuation?.marketCap ?? valuation?.fdv ?? state.selected?.marketCap ?? state.selected?.fdv, { currency: true }),
  );
  setText(
    "terminalAnatomy2Label",
    valuation?.marketCap !== null && valuation?.marketCap !== undefined ? "Market cap" : "FDV",
  );
  setText(
    "terminalAnatomy2",
    compact(valuation?.marketCap ?? valuation?.fdv ?? state.selected?.marketCap ?? state.selected?.fdv, { currency: true }),
  );
  return true;
}

function setMarketMetric(index, label, value, { show = hasOperatorValue(value) } = {}) {
  setText(`terminalMetric${index}Label`, label, "");
  setText(`terminalMetric${index}`, show ? value : "", "");
  const cell = document.getElementById(`terminalMetric${index}Cell`);
  if (cell) cell.hidden = !show;
  return show;
}

function clearMarketMetrics() {
  setLastMetric(null);
  for (let index = 2; index <= 6; index += 1) setMarketMetric(index, "", "", { show: false });
}

function setState(id, value, label = null) {
  const element = document.getElementById(id);
  if (!element) return;
  element.dataset.state = String(value || "unavailable").toLowerCase();
  element.textContent = label || titleCase(value);
}

function titleCase(value, fallback = "Unavailable") {
  const clean = String(value || "").trim();
  if (!clean) return fallback;
  return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeStateLabel(value) {
  const state = String(value || "").trim().toLowerCase();
  const labels = {
    review_capability_check_required: "Review unavailable",
    preview_available: "Review available",
    route_available: "Route available",
    unavailable: "Route unavailable",
  };
  return labels[state] || titleCase(value, "Route unavailable");
}

function chainDisplayName(value) {
  const chain = String(value || "").trim().toLowerCase();
  if (chain === "robinhood") return "Robinhood Chain";
  if (chain === "bsc") return "BNB Chain";
  if (chain === "sui") return "Sui";
  return titleCase(chain, "Unknown chain");
}

function tradeCapabilityLabel(value) {
  const labels = {
    review_only: "trade preview available",
    route_review_only: "trade preview available",
    route_review_separate: "trade preview available",
    adapter_not_activated: "trading coming later",
    market_data_only: "charts only",
    lookup_only: "lookup only",
  };
  return labels[String(value || "").toLowerCase()] || "trading not available";
}

function marketUpdateLabel(value) {
  const labels = {
    polling: "Updating",
    connecting: "Connecting",
    connected: "Live updates",
    live: "Live updates",
    snapshot_only: "Latest snapshot",
    degraded: "Updates delayed",
    disconnected: "Not connected",
  };
  return labels[String(value || "").trim().toLowerCase()] || titleCase(value, "Latest prices");
}

function renderChainCoverage() {
  const host = document.getElementById("terminalChainCoverageGrid");
  if (!host) return;
  host.replaceChildren();
  for (const row of RAVENOS_TERMINAL_CHAIN_ROLLOUT.current) {
    const card = document.createElement("article");
    const label = document.createElement("strong");
    const detail = document.createElement("span");
    label.textContent = row.label;
    detail.textContent = [
      row.chart ? "Charts available" : row.lookup ? "Lookup available" : "Planned",
      row.route_review ? "trade preview available" : "trading coming later",
    ].join(" · ");
    card.dataset.chain = row.chain;
    card.dataset.state = row.state;
    card.append(label, detail);
    host.append(card);
  }
}

function formatPrice(value) {
  const result = finite(value);
  if (result === null || result <= 0) return "--";
  if (result >= 1000) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (result >= 1) return `$${result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
  return `$${result.toLocaleString("en-US", { maximumSignificantDigits: 7 })}`;
}

function compact(value, { currency = false } = {}) {
  const result = finite(value);
  if (result === null) return "--";
  const label = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
  return currency ? `$${label}` : label;
}

function percent(value, { ratio = false, precision = 2 } = {}) {
  const result = finite(value);
  if (result === null) return "--";
  const scaled = ratio ? result * 100 : result;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(Math.abs(scaled) < 0.1 ? 4 : precision)}%`;
}

function timestamp(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function durationLabel(seconds) {
  const value = Math.max(0, Math.trunc(finite(seconds) || 0));
  if (value < 60) return `${value}s ago`;
  if (value < 3600) return `${Math.max(1, Math.round(value / 60))}m ago`;
  if (value < 86_400) return `${Math.max(1, Math.round(value / 3600))}h ago`;
  return `${Math.max(1, Math.round(value / 86_400))}d ago`;
}

function ageLabel(milliseconds) {
  const value = finite(milliseconds);
  if (value === null || value < 0) return "Unavailable";
  const days = value / 86_400_000;
  if (days < 1) return `${Math.max(1, Math.round(value / 3_600_000))}h`;
  if (days < 90) return `${Math.round(days)}d`;
  if (days < 730) return `${(days / 365).toFixed(1)}y`;
  return `${Math.round(days / 365)}y`;
}

function marketTime(value) {
  const numeric = finite(value);
  const parsed = numeric === null
    ? new Date(value || "")
    : new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed);
}

function formatMarketSize(value) {
  const amount = finite(value);
  if (amount === null || amount < 0) return "";
  if (amount >= 10_000) return compact(amount);
  if (amount >= 1) return amount.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return amount.toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

function normalizeBookLevel(row = {}) {
  const price = finite(row.price ?? row.px);
  const declaredSize = finite(row.size ?? row.sz);
  const notional = finite(row.notional_usd);
  const size = declaredSize ?? (price && notional !== null ? notional / price : null);
  if (!(price > 0) || size === null || size < 0) return null;
  return {
    price,
    size,
    orders: finite(row.order_count ?? row.orders ?? row.n),
    notional: notional ?? price * size,
  };
}

function terminalBookSides(book = {}) {
  const bids = (Array.isArray(book?.bids) ? book.bids : [])
    .map(normalizeBookLevel)
    .filter(Boolean)
    .sort((left, right) => right.price - left.price)
    .slice(0, 12);
  const asks = (Array.isArray(book?.asks) ? book.asks : [])
    .map(normalizeBookLevel)
    .filter(Boolean)
    .sort((left, right) => left.price - right.price)
    .slice(0, 12);
  return { bids, asks };
}

function appendBookLevel(host, row, side, maxSize) {
  const line = document.createElement("div");
  line.className = `terminal-book-row ${side}`;
  line.style.setProperty("--depth", `${Math.min(100, (row.size / maxSize) * 100).toFixed(1)}%`);
  const orders = row.orders === null ? "" : Math.max(0, Math.trunc(row.orders)).toLocaleString();
  for (const value of [formatPrice(row.price), formatMarketSize(row.size), orders]) {
    const cell = document.createElement("span");
    cell.textContent = value;
    line.append(cell);
  }
  host.append(line);
}

function renderTerminalBook(book = state.orderBook) {
  const host = document.getElementById("terminalBook");
  if (!host) return;
  const { bids, asks } = terminalBookSides(book);
  host.replaceChildren();
  if (!bids.length || !asks.length) {
    state.orderBook = null;
    const waiting = document.createElement("div");
    waiting.className = "terminal-market-wait";
    waiting.textContent = "Waiting for current venue depth.";
    host.append(waiting);
    setText("terminalBookState", "Connecting");
    const balance = document.getElementById("terminalBookBalance");
    if (balance) balance.hidden = true;
    return;
  }
  state.orderBook = book;
  const maxSize = Math.max(...bids.map((row) => row.size), ...asks.map((row) => row.size), 1);
  asks.slice().reverse().forEach((row) => appendBookLevel(host, row, "ask", maxSize));
  const summary = book?.summary || {};
  const bestBid = finite(summary.best_bid) ?? bids[0].price;
  const bestAsk = finite(summary.best_ask) ?? asks[0].price;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : null;
  const spread = finite(summary.spread_bps) ?? (mid ? ((bestAsk - bestBid) / mid) * 10_000 : null);
  const separator = document.createElement("div");
  separator.className = "terminal-book-spread";
  const spreadLabel = document.createElement("span");
  spreadLabel.textContent = "Spread";
  const spreadValue = document.createElement("strong");
  spreadValue.textContent = spread === null ? "Current book" : `${spread.toFixed(spread < 1 ? 3 : 2)} bps`;
  separator.append(spreadLabel, spreadValue);
  host.append(separator);
  bids.forEach((row) => appendBookLevel(host, row, "bid", maxSize));

  const bidNotional = finite(summary.bid_notional_usd) ?? bids.reduce((sum, row) => sum + row.notional, 0);
  const askNotional = finite(summary.ask_notional_usd) ?? asks.reduce((sum, row) => sum + row.notional, 0);
  const total = bidNotional + askNotional;
  const bidShare = total > 0 ? (bidNotional / total) * 100 : 50;
  const askShare = 100 - bidShare;
  setText("terminalBookBidShare", `Bid ${bidShare.toFixed(0)}%`);
  setText("terminalBookAskShare", `Ask ${askShare.toFixed(0)}%`);
  const bidBar = document.getElementById("terminalBookBidBar");
  const askBar = document.getElementById("terminalBookAskBar");
  if (bidBar) bidBar.style.width = `${bidShare}%`;
  if (askBar) askBar.style.width = `${askShare}%`;
  const balance = document.getElementById("terminalBookBalance");
  if (balance) balance.hidden = total <= 0;
  setText("terminalBookState", `${Math.min(bids.length, asks.length)} × ${Math.min(bids.length, asks.length)}${spread === null ? "" : ` · ${spread.toFixed(spread < 1 ? 2 : 1)} bps`}`);
}

function normalizeTapeRow(row = {}) {
  const observedAt = row.observed_at || row.observedAt || row.time;
  const time = marketTime(observedAt);
  const numericTime = finite(observedAt);
  const observedKey = numericTime === null
    ? Date.parse(observedAt || "")
    : numericTime > 10_000_000_000 ? numericTime : numericTime * 1_000;
  const price = finite(row.price ?? row.px);
  const size = finite(row.size ?? row.sz);
  if (!time || !(price > 0) || size === null || size < 0) return null;
  const bookSide = String(row.book_side || row.side || "").toLowerCase();
  const side = bookSide === "bid" || bookSide === "buy" || row.side_code === "B"
    ? "bid"
    : bookSide === "ask" || bookSide === "sell" || row.side_code === "A"
      ? "ask"
      : "trade";
  return {
    time,
    observedAt,
    observedKey,
    price,
    size,
    side,
    notional: finite(row.notional_usd) ?? price * size,
  };
}

function renderTerminalTape(rows = state.tapeRows) {
  const host = document.getElementById("terminalTape");
  if (!host) return;
  const seen = new Set();
  const safeRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeTapeRow(row);
    if (!normalized) continue;
    const key = [normalized.observedKey, normalized.side, normalized.price, normalized.size].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    safeRows.push(normalized);
    if (safeRows.length >= 60) break;
  }
  state.tapeRows = safeRows;
  host.replaceChildren();
  if (!safeRows.length) {
    const waiting = document.createElement("div");
    waiting.className = "terminal-market-wait";
    waiting.textContent = "Waiting for the first public venue trade.";
    host.append(waiting);
    setText("terminalTapeState", "Connecting");
    return;
  }
  for (const row of safeRows) {
    const line = document.createElement("div");
    line.className = `terminal-tape-row ${row.side}`;
    for (const value of [row.time, formatPrice(row.price), compact(row.notional, { currency: true })]) {
      const cell = document.createElement("span");
      cell.textContent = value;
      line.append(cell);
    }
    host.append(line);
  }
  setText("terminalTapeState", `${safeRows.length} public txns`);
}

function resetTerminalMarketFlow() {
  state.orderBook = null;
  state.tapeRows = [];
  renderTerminalBook(null);
  renderTerminalTape([]);
}

function renderTerminalMarketFlow(marketData = {}) {
  if (state.lane !== "perps") return;
  if (marketData?.book) renderTerminalBook(marketData.book);
  if (Array.isArray(marketData?.tape?.trades)) renderTerminalTape(marketData.tape.trades);
}

function setTerminalPaneStatus(pane, label, tone = "neutral") {
  const button = document.querySelector(`[data-terminal-pane-button="${pane}"]`);
  if (!button) return;
  const clean = customerFacingText(label, "").trim().slice(0, 24);
  button.dataset.status = clean;
  button.dataset.statusTone = ["neutral", "positive", "warning", "negative"].includes(tone) ? tone : "neutral";
  const name = button.textContent.trim();
  button.setAttribute("aria-label", clean ? `${name} · ${clean}` : name);
  syncProjectResearchMenu();
}

function syncMobileTradeDock() {
  const dock = document.getElementById("terminalMobileTradeDock");
  const tradeButton = document.querySelector('[data-terminal-pane-button="trade"]');
  if (!dock) return;
  const available = tradeButton?.hidden === false
    && (state.lane === "perps" || (state.lane === "spot" && spotTicketQualified()));
  dock.hidden = !available;
  const primary = dock.querySelector('[data-terminal-mobile-side="primary"]');
  const secondary = dock.querySelector('[data-terminal-mobile-side="secondary"]');
  if (primary) {
    primary.textContent = state.lane === "perps" ? "Review long" : "Review buy";
    primary.setAttribute("aria-label", state.lane === "perps"
      ? "Open the read-only long plan"
      : "Open the read-only buy and exit review");
  }
  if (secondary) {
    secondary.textContent = state.lane === "perps" ? "Review short" : "Review sell";
    secondary.setAttribute("aria-label", state.lane === "perps"
      ? "Open the read-only short plan"
      : "Open the read-only sell route review");
  }
}

function terminalUsesPaneNavigation() {
  return window.matchMedia?.("(max-width: 820px)")?.matches === true;
}

function afterTerminalPaneVisible(callback) {
  requestAnimationFrame(() => requestAnimationFrame(() => callback?.()));
}

function syncTerminalPaneUrl(pane) {
  if (!TERMINAL_PANELS.has(pane)) return;
  const url = new URL(window.location.href);
  if (pane === "chart") url.searchParams.delete("panel");
  else url.searchParams.set("panel", pane);
  if (pane === "activity" && state.spotActivityView === "wallets") url.searchParams.set("activity_view", "wallets");
  else url.searchParams.delete("activity_view");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState({}, "", next);
  }
}

function setTerminalPane(pane = "chart", { restoreScroll = true, focusId = "" } = {}) {
  const requested = TERMINAL_PANELS.has(pane) ? pane : "chart";
  const requestedButton = document.querySelector(`[data-terminal-pane-button="${requested}"]`);
  const next = requestedButton?.hidden ? "chart" : requested;
  const root = document.querySelector(".terminal-live");
  const previous = root?.dataset.terminalPane || "chart";
  const mobile = terminalUsesPaneNavigation();
  if (mobile && previous !== next) state.paneScrollPositions[previous] = Math.max(0, window.scrollY || 0);
  if (root) root.dataset.terminalPane = next;
  for (const button of document.querySelectorAll("[data-terminal-pane-button]")) {
    button.setAttribute("aria-pressed", String(button.dataset.terminalPaneButton === next));
  }
  syncSpotActivityView();
  afterTerminalPaneVisible(() => {
    if (next === "chart") {
      state.workspace?.chartHandle?.resize?.();
      if (state.lane === "spot") void loadSpotTrades();
    }
    if (next === "activity") void loadSpotTrades();
    if (!["chart", "activity", "trade"].includes(next)) clearSpotTradeRefresh();
    if (next === "holders") {
      const holderList = document.getElementById("terminalHolderList");
      if (holderList) holderList.open = true;
      void loadHolderList();
      void loadSpotTrades();
    }
    if (mobile && restoreScroll) {
      const fallback = document.querySelector(`[data-terminal-pane-button="${next}"]`)?.getBoundingClientRect?.().top + (window.scrollY || 0);
      const saved = state.paneScrollPositions[next];
      const top = Number.isFinite(saved) ? saved : Number.isFinite(fallback) ? Math.max(0, fallback - 8) : 0;
      window.scrollTo({ top, behavior: "auto" });
    }
    if (focusId) document.getElementById(focusId)?.focus?.({ preventScroll: true });
  });
  syncTerminalPaneUrl(next);
  updateMonitorHandoff();
  syncPlanActionSurfaces();
  return next;
}

function terminalPaneSurface(pane) {
  const targets = {
    chart: ".terminal-chart-panel",
    activity: "#terminalSpotActivitySection",
    holders: "#terminalAnatomySection",
    trade: state.lane === "spot" ? "#terminalSpotTicketSection" : "#terminalTradeReviewSection",
    book: "#terminalMarketRail",
    raven: "#terminalContextSection:not([hidden]), #terminalAlphaSection:not([hidden]), #terminalPlanSection:not([hidden]), #terminalRavenEmptySection:not([hidden])",
    account: "#terminalAccountDock",
  };
  return document.querySelector(targets[pane] || targets.chart);
}

function inspectTerminalPane(pane) {
  const mobile = terminalUsesPaneNavigation();
  const next = setTerminalPane(pane, { restoreScroll: mobile });
  if (mobile) return next;
  if (state.lane === "spot") {
    afterTerminalPaneVisible(() => {
      const dock = document.querySelector(".terminal-intelligence");
      const target = terminalPaneSurface(next);
      dock?.scrollTo?.({ top: 0, behavior: "auto" });
      if (target && !target.hidden && target.matches?.("[tabindex]")) target.focus?.({ preventScroll: true });
    });
    return next;
  }
  afterTerminalPaneVisible(() => {
    const target = terminalPaneSurface(next);
    if (!target || target.hidden) return;
    target.scrollIntoView?.({ behavior: "smooth", block: "start" });
    if (target.matches?.("[tabindex]")) target.focus?.({ preventScroll: true });
  });
  return next;
}

function inspectActiveWallets() {
  if (state.lane !== "spot" || !currentProjectIdentity()) return;
  state.spotActivityView = "wallets";
  inspectTerminalPane("activity");
}

function inspectSpotRisk() {
  if (state.lane !== "spot" || !currentProjectIdentity()) return;
  setTerminalPane("holders", { restoreScroll: false });
  const focusRisk = () => afterTerminalPaneVisible(() => {
    const risk = document.getElementById("terminalRiskScreen");
    const anatomy = document.getElementById("terminalAnatomySection");
    const target = risk && !risk.hidden ? risk : anatomy;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target?.focus?.({ preventScroll: true });
  });
  focusRisk();
  void loadHolderList().finally(focusRisk);
}

function revealSpotHolders(event) {
  if (state.lane !== "spot" || !currentProjectIdentity()) return;
  event?.preventDefault?.();
  setTerminalPane("holders", { restoreScroll: false });
  afterTerminalPaneVisible(() => {
    const holderList = document.getElementById("terminalHolderList");
    const anatomy = document.getElementById("terminalAnatomySection");
    const target = holderList && !holderList.hidden ? holderList : anatomy;
    if (holderList && !holderList.hidden) holderList.open = true;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    const focusTarget = holderList && !holderList.hidden ? holderList.querySelector("summary") : anatomy;
    focusTarget?.focus?.({ preventScroll: true });
  });
}

function currentRavenOverlayTypes() {
  const measured = state.workspace?.diagnostics?.()?.chart?.active_overlay_types || [];
  return [...new Set([...state.savedRavenOverlays, ...measured].filter((value) => SAVED_RAVEN_OVERLAYS.has(value)))];
}

function captureCurrentRavenOverlayTypes() {
  setTimeout(() => {
    const measured = state.workspace?.diagnostics?.()?.chart?.active_overlay_types || [];
    state.savedRavenOverlays = [...new Set(measured.filter((value) => SAVED_RAVEN_OVERLAYS.has(value)))];
    updateMonitorHandoff();
  }, 0);
}

function updateMonitorHandoff() {
  const link = document.getElementById("terminalMonitorLink");
  if (!link) return;
  const subject = ravenOSContext.getState().subject;
  const currentPanel = document.querySelector(".terminal-live")?.dataset.terminalPane || "chart";
  const href = savedMonitorHandoffHref(subject, {
    action: "monitor",
    timeframe: state.timeframe,
    indicators: Array.from(state.workspace?.activeIndicators || []).filter((value) => SAVED_INDICATORS.has(value)),
    ravenOverlays: currentRavenOverlayTypes(),
    density: state.density,
    selectedPanel: SAVED_PANELS.has(currentPanel) ? currentPanel : "chart",
  });
  link.hidden = !href;
  if (href) link.href = href;
}

function updateTerminalPaneAvailability() {
  const perps = state.lane === "perps";
  const spot = state.lane === "spot";
  const root = document.querySelector(".terminal-live");
  if (root) root.dataset.terminalLane = state.lane;
  const marketRail = document.getElementById("terminalMarketRail");
  if (marketRail) marketRail.hidden = !perps;
  const holdersButton = document.querySelector('[data-terminal-pane-button="holders"]');
  if (holdersButton) holdersButton.hidden = !spot;
  const activityButton = document.querySelector('[data-terminal-pane-button="activity"]');
  const spotActivityAvailable = spot && Boolean(currentProjectIdentity());
  if (activityButton) {
    // The spot-market activity surface is always Txns. Do not reuse the
    // Hyperliquid order-book label when pane state changes on mobile.
    activityButton.textContent = "Txns";
    activityButton.hidden = !spotActivityAvailable;
  }
  const activitySection = document.getElementById("terminalSpotActivitySection");
  if (activitySection) activitySection.hidden = !spotActivityAvailable;
  const bookButton = document.querySelector('[data-terminal-pane-button="book"]');
  if (bookButton) {
    bookButton.textContent = "Txns";
    bookButton.hidden = !perps;
  }
  const tradeSection = document.getElementById("terminalTradeReviewSection");
  const spotTradeSection = document.getElementById("terminalSpotTicketSection");
  const tradeButton = document.querySelector('[data-terminal-pane-button="trade"]');
  const tradeVisible = (perps && tradeSection?.hidden === false) || (spot && spotTradeSection?.hidden === false);
  if (tradeButton) tradeButton.hidden = !tradeVisible;
  if (tradeVisible) setTerminalPaneStatus("trade", perps ? "Preview" : spotTicketQualified() ? "Route review" : "Coming later", perps || spotTicketQualified() ? "positive" : "neutral");
  syncMobileTradeDock();
  const accountDock = document.getElementById("terminalAccountDock");
  const accountButton = document.querySelector('[data-terminal-pane-button="account"]');
  const accountVisible = perps && state.flags?.public_account_view_available === true;
  if (accountDock) accountDock.hidden = !accountVisible;
  if (accountButton) accountButton.hidden = !accountVisible;
  const ravenAvailable = syncRavenPaneAvailability();
  syncWalletControls();
  const current = root?.dataset.terminalPane || "chart";
  if (
    (!perps && ["trade", "book", "account"].includes(current))
    || (!spot && ["activity", "holders"].includes(current))
    || (current === "activity" && !spotActivityAvailable)
    || (current === "trade" && !tradeVisible)
    || (current === "account" && !accountVisible)
    || (current === "raven" && !ravenAvailable)
  ) setTerminalPane("chart");
}

function accountMoney(value) {
  const amount = finite(value);
  if (amount === null) return "—";
  const magnitude = Math.abs(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: magnitude >= 1000 ? 0 : magnitude >= 10 ? 2 : 4,
  }).format(amount);
}

function accountNumber(value) {
  const amount = finite(value);
  if (amount === null) return "—";
  return amount.toLocaleString("en-US", { maximumFractionDigits: Math.abs(amount) < 10 ? 5 : 2 });
}

function accountTone(value) {
  const amount = finite(value);
  return amount === null ? null : amount >= 0 ? "positive" : "negative";
}

function shortAccountAddress(value) {
  const address = String(value || "");
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function evmWalletName(provider, fallback = "Browser wallet") {
  if (provider?.isMetaMask && !provider?.isRabby) return "MetaMask";
  if (provider?.isCoinbaseWallet || provider?.isWalletLink) return "Coinbase Wallet";
  if (provider?.isRabby) return "Rabby";
  if (provider?.isRainbow) return "Rainbow";
  if (provider?.isPhantom) return "Phantom";
  if (provider?.isTrust || provider?.isTrustWallet) return "Trust Wallet";
  if (provider?.isBraveWallet) return "Brave Wallet";
  return String(fallback || "Browser wallet").slice(0, 80);
}

function detectedEvmWallets() {
  const rows = [];
  const seen = new Set();
  const add = (provider, name) => {
    if (!provider?.request || seen.has(provider)) return;
    seen.add(provider);
    rows.push({ provider, name: evmWalletName(provider, name) });
  };
  for (const announced of announcedEvmWallets.values()) add(announced.provider, announced.name);
  for (const provider of Array.isArray(globalThis.ethereum?.providers) ? globalThis.ethereum.providers : []) add(provider);
  add(globalThis.ethereum);
  const rank = ["MetaMask", "Coinbase Wallet", "Rabby", "Rainbow", "Phantom", "Trust Wallet", "Brave Wallet"];
  rows.sort((left, right) => {
    const leftRank = rank.indexOf(left.name);
    const rightRank = rank.indexOf(right.name);
    return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank) || left.name.localeCompare(right.name);
  });
  return rows;
}

function detectedSolanaWallets() {
  const rows = [];
  const seen = new Set();
  const add = (provider, name) => {
    if (!provider?.connect || provider?.publicKey === undefined || seen.has(provider)) return;
    seen.add(provider);
    rows.push({ provider, name });
  };
  add(globalThis.phantom?.solana, "Phantom");
  add(globalThis.solflare, "Solflare");
  add(globalThis.backpack?.solana || globalThis.backpack, "Backpack");
  add(globalThis.glowSolana, "Glow");
  add(globalThis.solana, globalThis.solana?.isPhantom ? "Phantom" : globalThis.solana?.isSolflare ? "Solflare" : "Solana wallet");
  return rows;
}

function browserWalletProvider() {
  return state.selectedEvmWalletProvider || detectedEvmWallets()[0]?.provider || null;
}

function walletLaunchHref(wallet, chainType) {
  const current = location.href;
  const encoded = encodeURIComponent(current);
  const ref = encodeURIComponent(location.origin);
  if (chainType === "solana") {
    if (wallet === "Phantom") return `https://phantom.app/ul/browse/${encoded}?ref=${ref}`;
    if (wallet === "Solflare") return `https://solflare.com/ul/v1/browse/${encoded}?ref=${ref}`;
    if (wallet === "Backpack") return "https://backpack.app/";
    if (wallet === "Glow") return "https://glow.app/";
    return null;
  }
  if (wallet === "MetaMask") return `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`;
  if (wallet === "Coinbase Wallet") return `https://go.cb-w.com/dapp?cb_url=${encoded}`;
  if (wallet === "Trust Wallet") return `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`;
  if (wallet === "Rabby") return "https://rabby.io/";
  if (wallet === "Rainbow") return "https://rainbow.me/";
  if (wallet === "Phantom") return "https://phantom.app/";
  return null;
}

function walletChoiceButton({ name, detail, detected, onChoose, href = null }) {
  const row = href ? document.createElement("a") : document.createElement("button");
  row.className = "terminal-wallet-choice";
  if (href) {
    row.href = href;
    row.rel = "noopener noreferrer";
  } else {
    row.type = "button";
    row.addEventListener("click", onChoose);
  }
  const mark = document.createElement("span");
  mark.className = "terminal-wallet-choice-mark";
  mark.textContent = name.slice(0, 1).toUpperCase();
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = name;
  const note = document.createElement("small");
  note.textContent = detail;
  copy.append(title, note);
  const stateLabel = document.createElement("span");
  stateLabel.className = "terminal-wallet-choice-state";
  stateLabel.textContent = detected ? "Detected" : "Open app";
  row.append(mark, copy, stateLabel);
  return row;
}

function chooseExternalWallet(chainType = "evm") {
  const dialog = document.getElementById("terminalWalletChooser") || document.createElement("dialog");
  dialog.id = "terminalWalletChooser";
  dialog.className = "terminal-wallet-chooser";
  dialog.setAttribute("aria-labelledby", "terminalWalletChooserTitle");
  if (!dialog.isConnected) document.body.append(dialog);
  const detected = chainType === "solana" ? detectedSolanaWallets() : detectedEvmWallets();
  const popular = chainType === "solana"
    ? ["Phantom", "Solflare", "Backpack", "Glow"]
    : ["MetaMask", "Coinbase Wallet", "Rabby", "Rainbow", "Phantom", "Trust Wallet"];
  dialog.replaceChildren();
  const header = document.createElement("header");
  const heading = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = chainType === "solana" ? "Solana" : "EVM";
  const title = document.createElement("h2");
  title.id = "terminalWalletChooserTitle";
  title.textContent = "Choose wallet";
  heading.append(eyebrow, title);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const intro = document.createElement("p");
  intro.textContent = "RavenOS reads your public address. Your wallet confirms every transaction.";
  const list = document.createElement("div");
  list.className = "terminal-wallet-choice-list";
  dialog.append(header, intro, list);
  if (state.liveAuth?.authenticated !== true) {
    const signIn = document.createElement("a");
    signIn.className = "terminal-wallet-sign-in";
    signIn.href = terminalSignInHref();
    signIn.textContent = "Sign in with email";
    dialog.append(signIn);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (provider = null) => {
      if (settled) return;
      settled = true;
      resolve(provider);
    };
    const closeHandler = () => finish(null);
    dialog.addEventListener("close", closeHandler, { once: true });
    const rendered = new Set();
    for (const name of popular) {
      const candidate = detected.find((row) => row.name === name);
      rendered.add(candidate?.provider);
      const href = candidate ? null : walletLaunchHref(name, chainType);
      if (!candidate && !href) continue;
      const row = walletChoiceButton({
        name,
        detected: Boolean(candidate),
        detail: candidate ? "Connect in this browser" : "Open RavenOS in this wallet",
        href,
        onChoose: () => {
          finish(candidate.provider);
          dialog.close();
        },
      });
      if (href) row.addEventListener("click", () => {
        finish(null);
        dialog.close();
      });
      list.append(row);
    }
    for (const candidate of detected) {
      if (rendered.has(candidate.provider)) continue;
      list.append(walletChoiceButton({
        name: candidate.name,
        detected: true,
        detail: "Connect in this browser",
        onChoose: () => {
          finish(candidate.provider);
          dialog.close();
        },
      }));
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
}

function browserWalletAddress(accounts = []) {
  return Array.isArray(accounts)
    ? accounts.find((value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || ""))) || null
    : null;
}

function currentSpotChain() {
  return String(currentProjectIdentity()?.chain || "").toLowerCase();
}

function currentSpotWallet() {
  if (currentSpotChain() === "solana") {
    return {
      address: state.solanaWalletAddress,
      connected: state.solanaWalletConnected && Boolean(state.solanaWalletAddress),
      provider: solanaWalletProvider(),
    };
  }
  return {
    address: state.walletAddress,
    connected: state.walletTransportConnected && Boolean(state.walletAddress),
    provider: browserWalletProvider(),
  };
}

function currentSpotLiveGate() {
  return state.liveSession?.gate?.chains?.[currentSpotChain()] || null;
}

function evmSpotProfile(chain = currentSpotChain()) {
  return EVM_SPOT_PROFILES[String(chain || "").toLowerCase()] || null;
}

function spotAccountingSymbol(chain = currentSpotChain()) {
  return evmSpotProfile(chain)?.accounting_symbol || "USDC";
}

function shortSpotWalletAddress(value) {
  return currentSpotChain() === "solana" ? shortSolanaAddress(value) : shortAccountAddress(value);
}

function syncWalletControls() {
  const evmConnected = state.walletTransportConnected && Boolean(state.walletAddress);
  const spotWallet = currentSpotWallet();
  for (const id of ["terminalWalletConnect", "terminalUseWallet"]) {
    const button = document.getElementById(id);
    if (!button) continue;
    const topLevel = id === "terminalWalletConnect";
    const connected = topLevel && state.lane === "spot" ? spotWallet.connected : evmConnected;
    button.hidden = state.flags?.browser_wallet_connection_available === false;
    button.textContent = connected ? "Disconnect view" : "Connect wallet";
    button.dataset.connected = String(connected);
    button.setAttribute("aria-label", connected
      ? "Clear the wallet address from this tab"
      : state.lane === "spot"
        ? `Choose a ${chainDisplayName(currentSpotChain())} wallet`
        : "Choose an EVM wallet");
  }
}

function updateWalletShellCapability() {
  const hyperliquidLive = state.liveSession?.gate?.chains?.hyperliquid?.available_to_principal === true;
  const spotWallet = currentSpotWallet();
  const spotLive = currentSpotLiveGate()?.available_to_principal === true;
  const chain = currentSpotChain();
  window.RavenOSShell?.setCapabilities?.({
    wallet: state.lane === "spot" && spotWallet.connected
      ? `${shortSpotWalletAddress(spotWallet.address)} · ${spotLive ? "wallet confirmation" : "public view"}`
      : state.walletTransportConnected && state.walletAddress
      ? `${shortAccountAddress(state.walletAddress)} · ${hyperliquidLive ? "live confirmation" : "public view"}`
      : state.lane === "spot" ? spotWallet.provider ? "Wallet ready · not connected" : "Choose wallet" : browserWalletProvider() ? "Wallet ready · not connected" : "Choose wallet",
    signing: state.lane === "spot" ? spotLive ? "Wallet confirms" : "Sign off" : hyperliquidLive ? "Wallet confirms" : "Sign off",
    broadcast: state.lane === "spot" ? spotLive ? evmSpotProfile(chain) ? "0x reviewed" : "Jupiter reviewed" : "Broadcast off" : hyperliquidLive ? "Hyperliquid direct" : "Broadcast off",
  });
}

function authenticatedTerminalOrigin() {
  return location.hostname.toLowerCase() === "app.ravenos.xyz";
}

function liveTerminalHref() {
  const target = new URL(location.href);
  target.protocol = "https:";
  target.host = "app.ravenos.xyz";
  return target.toString();
}

function terminalSignInHref() {
  const target = new URL("/account/", location.origin);
  target.searchParams.set("intent", "sign_in");
  target.searchParams.set("return_to", `${location.pathname}${location.search}`);
  return target.toString();
}

function clearLiveExecutionTicket(message = "") {
  state.liveBuilderApproval = null;
  state.liveTicket = null;
  state.liveExecutionResult = null;
  if (message) setText("terminalLiveExecutionMessage", message);
  renderLiveExecution();
}

function currentSpotLiveReady() {
  if (!spotQuoteStillCurrent() || !currentSpotWallet().connected) return false;
  return state.spotTicketSide === "sell" || state.spotQuote?.shadow_execution?.round_trip?.exit_verified === true;
}

function spotLiveTicketMatchesCurrentTrade(ticket) {
  const snapshot = spotTicketSnapshot();
  const reviewed = ticket?.reviewed_order || {};
  if (!snapshot) return false;
  const evmProfile = evmSpotProfile(snapshot.chain);
  if (evmProfile) {
    const selectedKind = (snapshot.side === "buy" ? snapshot.funding_preference : snapshot.settlement_preference) === "native"
      ? "native"
      : "canonical_usdc";
    const expectedInput = snapshot.side === "buy"
      ? selectedKind === "native" ? EVM_NATIVE_ASSET : evmProfile.accounting_address
      : snapshot.token_address;
    const expectedOutput = snapshot.side === "buy" ? snapshot.token_address : evmProfile.accounting_address;
    return new Set(["ravenos.evm_live_ticket.v1", "ravenos.robinhood_live_ticket.v1"]).has(ticket?.schema_version)
      && (!ticket.profile_id || ticket.profile_id === evmProfile.profile_id)
      && (!ticket.chain_namespace || ticket.chain_namespace === evmProfile.chain_namespace)
      && ticket.chain_id === evmProfile.chain_id
      && ticket.wallet_address?.toLowerCase() === snapshot.wallet_address?.toLowerCase()
      && ticket.exact_market?.instrument_id === snapshot.instrument_id
      && ticket.exact_market?.pool_address?.toLowerCase() === snapshot.pool_address.toLowerCase()
      && reviewed.side === snapshot.side
      && sameSelectedAddress(snapshot.chain, reviewed.sell_token, expectedInput)
      && sameSelectedAddress(snapshot.chain, reviewed.buy_token, expectedOutput)
      && Date.parse(ticket.expires_at || "") > Date.now() + 500;
  }
  if (snapshot.chain !== "solana" || ticket?.schema_version !== "ravenos.solana_live_ticket.v1") return false;
  const selectedKind = (snapshot.side === "buy" ? snapshot.funding_preference : snapshot.settlement_preference) === "native"
    ? "native"
    : "canonical_usdc";
  const expectedInput = snapshot.side === "buy"
    ? selectedKind === "native" ? SOLANA_WRAPPED_NATIVE_MINT : SOLANA_CANONICAL_USDC_MINT
    : snapshot.token_address;
  const expectedOutput = snapshot.side === "buy"
    ? snapshot.token_address
    : selectedKind === "native" ? SOLANA_WRAPPED_NATIVE_MINT : SOLANA_CANONICAL_USDC_MINT;
  return ticket.wallet_address === state.solanaWalletAddress
    && ticket.exact_market?.instrument_id === snapshot.instrument_id
    && ticket.exact_market?.pool_address === snapshot.pool_address
    && reviewed.side === snapshot.side
    && sameSelectedAddress("solana", reviewed.input_mint, expectedInput)
    && sameSelectedAddress("solana", reviewed.output_mint, expectedOutput)
    && Date.parse(ticket.expires_at || "") > Date.now() + 500;
}

function renderSpotLiveExecution() {
  const host = document.getElementById("terminalSpotLiveExecution");
  const action = document.getElementById("terminalSpotLiveAction");
  const link = document.getElementById("terminalSpotLiveLink");
  const order = document.getElementById("terminalSpotLiveOrder");
  const section = document.getElementById("terminalSpotTicketSection");
  if (!host || !action || !link || !order) return;
  const chain = currentSpotChain();
  const spot = state.lane === "spot" && (chain === "solana" || Boolean(evmSpotProfile(chain))) && spotTicketQualified();
  host.hidden = !spot;
  if (!spot) return;
  action.hidden = true;
  link.hidden = true;
  order.hidden = true;
  host.dataset.state = "unavailable";
  const liveAvailable = currentSpotLiveGate()?.available_to_principal === true;
  const chainLabel = chainDisplayName(chain);
  const accountingSymbol = spotAccountingSymbol(chain);
  const wallet = currentSpotWallet();
  if (section) section.dataset.liveEnabled = String(liveAvailable);
  if (!authenticatedTerminalOrigin()) {
    setText("terminalSpotLiveState", state.flags?.live_execution?.chains?.[chain]?.source_ready ? "Secure workspace" : "Not live");
    link.hidden = false;
    link.href = liveTerminalHref();
    link.textContent = "Sign in / trade";
    setText("terminalSpotLiveMessage", "Wallet-signed trades open in the secure workspace.");
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: currentSpotLiveReady() });
    return;
  }
  if (state.liveAuth?.authenticated !== true) {
    setText("terminalSpotLiveState", "Sign in");
    link.hidden = false;
    link.href = terminalSignInHref();
    link.textContent = "Sign in to trade";
    setText("terminalSpotLiveMessage", "Sign-in and wallet confirmation stay separate.");
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: currentSpotLiveReady() });
    return;
  }
  if (!liveAvailable) {
    const configured = state.liveSession?.gate?.configured === true;
    setText("terminalSpotLiveState", configured ? "Canary only" : "Locked");
    setText("terminalSpotLiveMessage", configured ? "This account is not in the live canary." : `${chainLabel} execution is not activated.`);
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: currentSpotLiveReady() });
    return;
  }
  host.dataset.state = state.spotLiveResult?.ok === false ? "error" : "ready";
  if (state.spotLivePending) {
    setText("terminalSpotLiveState", "Working");
    setText("terminalSpotLiveMessage", "Keep this tab open. Confirm only the exact transaction shown by your wallet.");
    updateSpotExecutionRail({ quoted: true, exitVerified: true });
    return;
  }
  if (state.spotLiveResult?.ok === true) {
    const confirmed = state.spotLiveResult?.reconciliation?.state === "provider_confirmed";
    setText("terminalSpotLiveState", confirmed ? "Confirmed" : "Check pending");
    setText("terminalSpotLiveMessage", confirmed
      ? `${chainLabel} confirmed the exact economic result.`
      : "Submission is indeterminate. Do not retry until the wallet and chain are checked.");
    order.hidden = false;
    const transactionReference = state.spotLiveResult?.reconciliation?.signature || state.spotLiveResult?.transaction_hash;
    setText("terminalSpotLiveSummary", transactionReference ? shortAccountAddress(transactionReference) : "Reconciliation required");
    const feeBps = finite(state.spotLiveResult?.fee_bps);
    setText("terminalSpotLiveDetail", `${feeBps === null ? "Raven fee reviewed" : `Raven ${(feeBps / 100).toFixed(2)}%`} · noncustodial wallet signature`);
    updateSpotExecutionRail({ quoted: true, exitVerified: true });
    return;
  }
  if (state.spotLiveResult?.ok === false) {
    state.spotLiveTicket = null;
    state.spotLiveUnsignedTransaction = null;
    state.spotLiveProviderQuote = null;
    setText("terminalSpotLiveState", "Not sent");
    setText("terminalSpotLiveMessage", String(state.spotLiveResult.error || "The wallet canceled or the route expired.").replaceAll("_", " "));
    action.hidden = false;
    if (!wallet.connected) {
      action.textContent = "Reconnect wallet";
      action.dataset.liveAction = "connect";
    } else if (currentSpotLiveReady() && chain === "solana") {
      action.textContent = "Prepare again";
      action.dataset.liveAction = "prepare";
    } else {
      action.textContent = "Review again";
      action.dataset.liveAction = "review";
    }
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: currentSpotLiveReady() });
    return;
  }
  if (!wallet.connected) {
    setText("terminalSpotLiveState", "Connect wallet");
    action.hidden = false;
    action.textContent = "Connect trading wallet";
    action.dataset.liveAction = "connect";
    setText("terminalSpotLiveMessage", "The wallet signs. Raven never receives the key.");
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: false });
    return;
  }
  if (!currentSpotLiveReady()) {
    setText("terminalSpotLiveState", "Review first");
    action.hidden = false;
    action.textContent = "Review current route";
    action.dataset.liveAction = "review";
    setText("terminalSpotLiveMessage", state.spotTicketSide === "buy" ? `A current ${accountingSymbol} exit proof is required.` : "Refresh the exact sell route.");
    updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: false });
    return;
  }
  if (!spotLiveTicketMatchesCurrentTrade(state.spotLiveTicket)) {
    state.spotLiveTicket = null;
    state.spotLiveUnsignedTransaction = null;
    state.spotLiveProviderQuote = null;
    setText("terminalSpotLiveState", "Ready");
    action.hidden = false;
    action.textContent = chain === "solana" ? `Prepare ${state.spotTicketSide}` : "Review current route";
    action.dataset.liveAction = chain === "solana" ? "prepare" : "review";
    setText("terminalSpotLiveMessage", chain === "solana"
      ? "Raven rechecks identity, balance, route, simulation, and exit."
      : "The next review creates one short-lived fee-bound wallet ticket.");
    updateSpotExecutionRail({ quoted: true, exitVerified: true });
    return;
  }
  const reviewed = state.spotLiveTicket.reviewed_order || {};
  const notional = finite(reviewed.notional_usdc)
    ?? finite(displayBaseUnitsClient(reviewed.notional_accounting_base_units, state.spotLiveTicket?.accounting?.decimals));
  const feeBps = finite(state.spotLiveTicket?.fee?.fee_bps);
  order.hidden = false;
  setText("terminalSpotLiveState", "Wallet confirmation");
  setText("terminalSpotLiveSummary", `${String(reviewed.side || "").toUpperCase()} · ${notional === null ? "current route" : Number(notional).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${accountingSymbol} value`);
  setText("terminalSpotLiveDetail", chain === "solana"
    ? `${reviewed.funding_kind} → ${reviewed.settlement_kind} · ${feeBps === null ? "fee reviewed" : `Raven ${(feeBps / 100).toFixed(2)}%`}`
    : `0x exact route · ${feeBps === null ? "fee reviewed" : `Raven ${(feeBps / 100).toFixed(2)}%`}`);
  action.hidden = false;
  action.textContent = `Sign & send ${reviewed.side}`;
  action.dataset.liveAction = "execute";
  setText("terminalSpotLiveMessage", `Expires ${new Intl.DateTimeFormat("en", { minute: "numeric", second: "2-digit" }).format(new Date(state.spotLiveTicket.expires_at))}.`);
  updateSpotExecutionRail({ quoted: true, exitVerified: true });
}

function currentPerpScenarioReady() {
  const blockers = Array.isArray(state.orderPlan?.review?.blockers)
    ? state.orderPlan.review.blockers.filter((reason) => reason !== "venue_margin_settings_change_required")
    : [];
  return state.orderPlan?.ok === true
    && Boolean(state.orderPlan?.account_context)
    && new Set(["account_scenario_available", "account_scenario_blocked"]).has(state.orderPlan?.state)
    && state.orderPlanType !== "trigger"
    && !state.orderPlan?.risk_bracket?.configured
    && blockers.length === 0
    && Date.parse(state.orderPlan?.expires_at || "") > Date.now() + 1_000;
}

function renderLiveExecution() {
  const host = document.getElementById("terminalLiveExecution");
  const action = document.getElementById("terminalLiveExecutionAction");
  const link = document.getElementById("terminalLiveExecutionLink");
  const order = document.getElementById("terminalLiveExecutionOrder");
  if (!host || !action || !link || !order) return;
  const perps = state.lane === "perps" && String(state.selected?.instrument_id || "").startsWith("hyperliquid:perp:");
  host.hidden = !perps;
  if (!perps) return;
  action.hidden = true;
  link.hidden = true;
  order.hidden = true;
  host.dataset.state = "unavailable";
  const publicCapability = state.flags?.live_execution;
  if (!authenticatedTerminalOrigin()) {
    setText("terminalLiveExecutionState", publicCapability?.code_ready ? "Secure workspace" : "Not live");
    link.hidden = false;
    link.href = liveTerminalHref();
    link.textContent = "Sign in / trade live";
    setText("terminalLiveExecutionMessage", "Wallet-signed orders open in the secure workspace.");
    return;
  }
  if (state.liveAuth?.authenticated !== true) {
    setText("terminalLiveExecutionState", "Sign in");
    link.hidden = false;
    link.href = terminalSignInHref();
    link.textContent = "Sign in to trade";
    setText("terminalLiveExecutionMessage", "Account sign-in and wallet confirmation are separate.");
    return;
  }
  const gate = state.liveSession?.gate;
  if (gate?.chains?.hyperliquid?.available_to_principal !== true) {
    setText("terminalLiveExecutionState", gate?.configured ? "Canary only" : "Locked");
    setText("terminalLiveExecutionMessage", gate?.configured
      ? "This account is not in the live canary."
      : "Live execution is not activated.");
    updateWalletShellCapability();
    return;
  }
  host.dataset.state = state.liveExecutionResult?.ok === false ? "error" : "ready";
  if (state.liveExecutionPending) {
    setText("terminalLiveExecutionState", "Working");
    setText("terminalLiveExecutionMessage", "Keep this tab open and confirm only the order shown in your wallet.");
    return;
  }
  if (state.liveExecutionResult?.ok === true) {
    setText("terminalLiveExecutionState", state.liveExecutionResult.reconciliation?.state === "provider_confirmed" ? "Confirmed" : "Submitted");
    setText("terminalLiveExecutionMessage", state.liveExecutionResult.reconciliation?.state === "provider_confirmed"
      ? "Hyperliquid confirmed the exact order."
      : "The wallet reported the order; provider reconciliation is still indeterminate.");
    return;
  }
  if (state.liveExecutionResult?.ok === false) {
    state.liveTicket = null;
    setText("terminalLiveExecutionState", "Not sent");
    setText("terminalLiveExecutionMessage", String(state.liveExecutionResult.error || "The wallet canceled or the current ticket expired.").replaceAll("_", " "));
    action.hidden = false;
    if (!state.walletTransportConnected || !state.walletAddress) {
      action.textContent = "Reconnect wallet";
      action.dataset.liveAction = "connect";
    } else if (currentPerpScenarioReady()) {
      action.textContent = "Prepare again";
      action.dataset.liveAction = "prepare";
    } else {
      action.textContent = "Review again";
      action.dataset.liveAction = "review";
    }
    return;
  }
  if (!state.walletTransportConnected || !state.walletAddress) {
    setText("terminalLiveExecutionState", "Connect wallet");
    action.hidden = false;
    action.textContent = "Connect trading wallet";
    action.dataset.liveAction = "connect";
    setText("terminalLiveExecutionMessage", "The wallet signs. Raven never receives the key.");
    return;
  }
  if (!currentPerpScenarioReady()) {
    setText("terminalLiveExecutionState", "Review first");
    action.hidden = false;
    action.textContent = "Review current order";
    action.dataset.liveAction = "review";
    setText("terminalLiveExecutionMessage", state.orderPlanType === "trigger" || state.orderPlan?.risk_bracket?.configured
      ? "Live v1 supports market or limit entries without attached brackets."
      : "Refresh the exact market and account check.");
    return;
  }
  if (state.liveBuilderApproval && Date.parse(state.liveBuilderApproval.expires_at || "") <= Date.now() + 500) {
    state.liveBuilderApproval = null;
  }
  if (state.liveBuilderApproval) {
    const fee = state.liveBuilderApproval.fee || {};
    setText("terminalLiveExecutionState", "Fee approval");
    setText("terminalLiveExecutionSummary", `Raven fee ${fee.fee_percent || ""} · ${fee.fee_token || "USDC"}`);
    setText("terminalLiveExecutionDetail", "One-time Hyperliquid cap · revocable in Hyperliquid");
    order.hidden = false;
    action.hidden = false;
    action.textContent = `Approve ${fee.fee_percent || "Raven fee"}`;
    action.dataset.liveAction = "approve_fee";
    setText("terminalLiveExecutionMessage", "This approval allows only the shown per-order builder fee. It grants no withdrawal or arbitrary-order access.");
    return;
  }
  if (!state.liveTicket || Date.parse(state.liveTicket.expires_at || "") <= Date.now() + 500) {
    state.liveTicket = null;
    setText("terminalLiveExecutionState", "Ready");
    action.hidden = false;
    action.textContent = "Prepare live order";
    action.dataset.liveAction = "prepare";
    const fee = state.liveSession?.hyperliquid_fee;
    setText("terminalLiveExecutionMessage", fee?.enabled
      ? `Raven will recheck the market. Fee ${fee.fee_percent} in USDC.`
      : "Raven will recheck the market and issue a short-lived ticket.");
    return;
  }
  const reviewed = state.liveTicket.reviewed_order || {};
  setText("terminalLiveExecutionState", "Wallet confirmation");
  setText("terminalLiveExecutionSummary", `${String(reviewed.side || "").toUpperCase()} ${state.liveTicket.instrument?.exact_market_id} · ${Number(reviewed.notional_usdc).toLocaleString("en-US")} USDC`);
  const ticketFee = state.liveTicket.fee || {};
  const feeDetail = ticketFee.raven_fee_enabled
    ? ` · Raven ${(Number(ticketFee.raven_fee_bps) / 100).toFixed(2)}% ≈ ${Number(ticketFee.estimated_raven_fee_usdc).toFixed(2)} USDC`
    : " · Raven fee 0";
  setText("terminalLiveExecutionDetail", `${reviewed.base_size} @ ${reviewed.limit_or_guard_price} max · ${reviewed.leverage}× ${reviewed.margin_mode}${feeDetail}${state.liveTicket.pre_actions?.update_leverage?.required ? " · settings confirmation first" : ""}`);
  order.hidden = false;
  action.hidden = false;
  action.textContent = `Place ${reviewed.side} · wallet confirms`;
  action.dataset.liveAction = "execute";
  setText("terminalLiveExecutionMessage", `Expires ${new Intl.DateTimeFormat("en", { minute: "numeric", second: "2-digit" }).format(new Date(state.liveTicket.expires_at))}. Wallet signs the exact order.`);
  updateWalletShellCapability();
}

async function loadLiveExecutionSession() {
  if (!authenticatedTerminalOrigin()) {
    renderLiveExecution();
    return;
  }
  try {
    const auth = await fetchJson("/api/v1/auth/session");
    state.liveAuth = auth.response.ok && auth.payload?.authenticated === true ? auth.payload : { authenticated: false };
    if (state.liveAuth.authenticated !== true) {
      state.liveSession = null;
      updateQuoteBoundary();
      return;
    }
    const live = await fetchJson("/api/trade/live/session");
    state.liveSession = live.response.ok ? live.payload : null;
  } catch {
    state.liveAuth = { authenticated: false };
    state.liveSession = null;
  }
  updateQuoteBoundary();
}

async function ensureWalletExecutionBundle() {
  if (globalThis.RavenOSWalletExecution) return globalThis.RavenOSWalletExecution;
  if (!state.walletExecutionBundle) {
    state.walletExecutionBundle = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/ravenos-wallet-execution.js";
      script.async = true;
      script.onload = () => globalThis.RavenOSWalletExecution ? resolve(globalThis.RavenOSWalletExecution) : reject(new Error("wallet_execution_bundle_invalid"));
      script.onerror = () => reject(new Error("wallet_execution_bundle_unavailable"));
      document.head.append(script);
    }).catch((error) => {
      state.walletExecutionBundle = null;
      throw error;
    });
  }
  return state.walletExecutionBundle;
}

function renderEmptyTerminalAccount() {
  const summary = document.getElementById("terminalAccountSummary");
  if (summary) summary.hidden = true;
  for (const id of [
    "terminalAccountPositionsCount",
    "terminalAccountBalancesCount",
    "terminalAccountOrdersCount",
    "terminalAccountHistoryCount",
    "terminalAccountFillsCount",
    "terminalAccountFundingCount",
  ]) {
    const count = document.getElementById(id);
    if (count) count.hidden = true;
  }
  const ledger = document.getElementById("terminalAccountLedger");
  if (ledger) {
    const empty = document.createElement("div");
    empty.className = "terminal-account-empty";
    const title = document.createElement("strong");
    title.textContent = "Connect a wallet or load a public Hyperliquid address.";
    const note = document.createElement("span");
    note.textContent = "Raven reads public account state only. No signature, approval, or order permission is requested.";
    empty.append(title, note);
    ledger.replaceChildren(empty);
  }
}

function clearConnectedWalletView(message = "Wallet address disconnected from this tab · no wallet permission was retained") {
  ++state.accountGeneration;
  state.accountSnapshot = null;
  state.accountHistory = null;
  state.accountHistoryLoading = false;
  state.walletTransportConnected = false;
  state.walletAddress = null;
  const input = document.getElementById("terminalAccountAddress");
  if (input) input.value = "";
  const status = document.getElementById("terminalAccountStatus");
  if (status) {
    status.dataset.tone = "";
    status.textContent = message;
  }
  renderEmptyTerminalAccount();
  renderTerminalTicketAccount();
  clearMarketPreviewResult("Wallet view disconnected. Review again to use a market-only plan.");
  syncOrderPlanControls();
  syncWalletControls();
  updateWalletShellCapability();
  renderTradeConsequences();
  if (state.lane === "spot" && evmSpotProfile()) {
    setText("terminalSpotWalletState", "Not connected");
    setText("terminalSpotWalletNote", "Raven retained no wallet permission.");
    setText("terminalSpotBalance", "Connect wallet");
    clearSpotQuoteResult("Wallet disconnected. Review was cleared.");
  }
}

function selectedAccountPosition() {
  const market = String(state.selected?.asset || state.selected?.symbol || "").replace(/-PERP$/i, "").toUpperCase();
  return (state.accountSnapshot?.positions || []).find((position) => String(position.market || "").toUpperCase() === market) || null;
}

function renderTerminalTicketAccount() {
  const host = document.getElementById("terminalTicketAccount");
  const sizePresets = document.getElementById("terminalAccountSizePresets");
  const snapshot = state.accountSnapshot;
  const show = state.lane === "perps" && Boolean(snapshot?.ok) && snapshot.state !== "empty";
  if (!host) return;
  host.hidden = !show;
  if (sizePresets) sizePresets.hidden = !show;
  if (!show) return;
  const position = selectedAccountPosition();
  setText("terminalTicketAddress", shortAccountAddress(snapshot.account?.address), "Public account");
  document.getElementById("terminalTicketAddress").title = snapshot.account?.address || "";
  setText("terminalTicketWithdrawable", accountMoney(snapshot.summary?.withdrawable_usdc));
  setText("terminalTicketPosition", position ? `${titleCase(position.side)} ${accountNumber(position.size)}` : "Flat");
  setText("terminalTicketPnl", position ? accountMoney(position.unrealized_pnl_usdc) : accountMoney(0));
  setText("terminalTicketMode", position
    ? `${titleCase(position.leverage_mode)} · ${accountNumber(position.leverage)}×`
    : "No open position");
  const pnl = document.getElementById("terminalTicketPnl");
  const pnlValue = finite(position?.unrealized_pnl_usdc);
  pnl?.classList.toggle("terminal-positive", pnlValue !== null && pnlValue >= 0);
  pnl?.classList.toggle("terminal-negative", pnlValue !== null && pnlValue < 0);
  const marginMode = document.getElementById("terminalPreviewMarginMode");
  if (marginMode && new Set(["cross", "isolated"]).has(position?.leverage_mode)) marginMode.value = position.leverage_mode;
  const leverage = document.getElementById("terminalPreviewLeverage");
  if (leverage && [...leverage.options].some((option) => Number(option.value) === finite(position?.leverage))) leverage.value = String(position.leverage);
}

function accountCell(value, { side = null, tone = null, title = "" } = {}) {
  const cell = document.createElement("span");
  cell.textContent = String(value ?? "");
  if (side) cell.dataset.side = side;
  if (tone) cell.dataset.tone = tone;
  if (title) cell.title = title;
  return cell;
}

function accountAction(label, onClick, { title = "" } = {}) {
  const cell = document.createElement("span");
  cell.className = "terminal-account-action-cell";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (title) button.title = title;
  button.addEventListener("click", onClick);
  cell.append(button);
  return cell;
}

async function reviewPositionClose(position = {}) {
  const market = String(position.market || "").toUpperCase();
  if (!market) return;
  const targetAsset = `${market}-PERP`;
  if (state.selected?.asset !== targetAsset) await selectPerp(targetAsset);
  if (state.selected?.asset !== targetAsset) return;
  setOrderPlanType("market", { refresh: false });
  setMarketPreviewSide(position.side === "long" ? "short" : "long", { refresh: false });
  const notional = document.getElementById("terminalPreviewNotional");
  const leverage = document.getElementById("terminalPreviewLeverage");
  const marginMode = document.getElementById("terminalPreviewMarginMode");
  const reduceOnly = document.getElementById("terminalPreviewReduceOnly");
  const targetSize = finite(position.size) || 0;
  const book = terminalBookSides(state.orderBook || {});
  const levels = position.side === "long" ? book.bids : book.asks;
  let remaining = targetSize;
  let closeNotional = 0;
  for (const level of levels) {
    if (remaining <= 1e-10) break;
    const consumed = Math.min(remaining, level.size);
    closeNotional += consumed * level.price;
    remaining -= consumed;
  }
  if (remaining > Math.max(1e-8, targetSize * 1e-8)) closeNotional = (finite(position.mark_notional_usdc) || 10) * 0.995;
  if (notional) notional.value = String(Math.floor(Math.min(250_000, Math.max(10, closeNotional)) * 100) / 100);
  if (leverage && [...leverage.options].some((option) => Number(option.value) === finite(position.leverage))) leverage.value = String(position.leverage);
  if (marginMode && new Set(["cross", "isolated"]).has(position.leverage_mode)) marginMode.value = position.leverage_mode;
  if (reduceOnly) reduceOnly.checked = true;
  clearMarketPreviewResult(`Review a reduce-only ${market} close against the current account and book.`);
  setTerminalPane("trade");
  void requestOrderPlan();
}

function applyAccountSizePreset(percentOfMargin) {
  const withdrawable = finite(state.accountSnapshot?.summary?.withdrawable_usdc);
  const leverage = finite(document.getElementById("terminalPreviewLeverage")?.value);
  const requestedPercent = finite(percentOfMargin);
  const input = document.getElementById("terminalPreviewNotional");
  if (!input || !(withdrawable > 0) || !(leverage >= 1) || !(requestedPercent > 0)) return;
  const feeReserve = requestedPercent >= 100 ? 0.99 : 1;
  const notional = Math.min(250_000, Math.max(10, withdrawable * leverage * requestedPercent / 100 * feeReserve));
  input.value = String(Number(notional.toFixed(2)));
  clearMarketPreviewResult(`${requestedPercent >= 100 ? "Maximum" : `${requestedPercent}%`} account margin budget selected. Review current fees and collateral next.`);
}

function accountLedgerDefinition(tab, snapshot) {
  if (tab === "balances") {
    return {
      columns: ["Asset", "Total", "Available", "On hold", "Entry notional"],
      rows: (snapshot.balances || []).map((balance) => [
        accountCell(balance.asset),
        accountCell(accountNumber(balance.total)),
        accountCell(accountNumber(balance.available)),
        accountCell(accountNumber(balance.on_hold)),
        accountCell(finite(balance.entry_notional_usdc) === null ? "—" : accountMoney(balance.entry_notional_usdc)),
      ]),
      empty: "No spot balances on this account.",
    };
  }
  if (tab === "orders") {
    return {
      columns: ["Market", "Side", "Remaining", "Price", "Order", "Placed"],
      rows: (snapshot.open_orders || []).map((order) => {
        const mechanics = [order.order_type, order.time_in_force ? String(order.time_in_force).toUpperCase() : "", order.reduce_only ? "Reduce only" : ""].filter(Boolean).join(" · ");
        const price = order.is_trigger && finite(order.trigger_price) !== null ? `Trigger ${formatPrice(order.trigger_price)}` : formatPrice(order.limit_price);
        return [
          accountCell(order.market),
          accountCell(titleCase(order.side), { side: order.side }),
          accountCell(accountNumber(order.size)),
          accountCell(price),
          accountCell(mechanics),
          accountCell(order.placed_at ? timestamp(order.placed_at) : "Venue order"),
        ];
      }),
      empty: "No open orders on this account.",
    };
  }
  if (tab === "history") {
    const history = state.accountHistory;
    return {
      columns: ["Market", "Side", "Original", "Filled", "Price", "Status", "Updated"],
      rows: (history?.orders || []).map((order) => {
        const price = order.is_trigger && finite(order.trigger_price) !== null ? `Trigger ${formatPrice(order.trigger_price)}` : formatPrice(order.limit_price);
        const mechanics = [titleCase(order.status), order.reduce_only ? "Reduce only" : ""].filter(Boolean).join(" · ");
        return [
          accountCell(order.market),
          accountCell(titleCase(order.side), { side: order.side }),
          accountCell(accountNumber(order.original_size)),
          accountCell(accountNumber(order.filled_size)),
          accountCell(price),
          accountCell(mechanics),
          accountCell(order.status_at ? timestamp(order.status_at) : "Recorded"),
        ];
      }),
      loading: state.accountHistoryLoading,
      empty: history?.ok
        ? "No historical orders on this account."
        : history
          ? "Current order history could not be loaded."
          : "Open this tab to load bounded order history.",
    };
  }
  if (tab === "fills") {
    return {
      columns: ["Market", "Direction", "Size", "Price", "Closed P&L", "Fee / time"],
      rows: (snapshot.fills || []).map((fill) => {
        const pnl = finite(fill.closed_pnl_usdc);
        return [
          accountCell(fill.market),
          accountCell(fill.direction || titleCase(fill.side), { side: fill.side }),
          accountCell(accountNumber(fill.size)),
          accountCell(formatPrice(fill.price)),
          accountCell(accountMoney(fill.closed_pnl_usdc), { tone: pnl === null ? null : pnl >= 0 ? "positive" : "negative" }),
          accountCell(`${accountMoney(fill.fee_paid)}${fill.fee_asset ? ` ${fill.fee_asset}` : ""}${fill.filled_at ? ` · ${timestamp(fill.filled_at)}` : ""}`),
        ];
      }),
      empty: "No recent fills on this account.",
    };
  }
  if (tab === "funding") {
    return {
      columns: ["Market", "Side", "Since open", "Since change", "All time"],
      rows: (snapshot.funding || []).map((funding) => [
        accountCell(funding.market),
        accountCell(titleCase(funding.side), { side: funding.side }),
        accountCell(accountMoney(funding.since_open_usdc), { tone: accountTone(funding.since_open_usdc) }),
        accountCell(accountMoney(funding.since_change_usdc), { tone: accountTone(funding.since_change_usdc) }),
        accountCell(accountMoney(funding.all_time_usdc), { tone: accountTone(funding.all_time_usdc) }),
      ]),
      empty: "No open-position funding rows on this account.",
    };
  }
  return {
    columns: ["Market", "Side / size", "Entry", "Notional", "Unrealized P&L", "Liquidation", "Action"],
    rows: (snapshot.positions || []).map((position) => {
      const pnl = finite(position.unrealized_pnl_usdc);
      const leverage = finite(position.leverage) === null ? "" : ` · ${accountNumber(position.leverage)}×`;
      const roe = finite(position.return_on_equity) === null ? "" : ` · ${percent(position.return_on_equity, { ratio: true })}`;
      return [
        accountCell(position.market),
        accountCell(`${titleCase(position.side)} ${accountNumber(position.size)}${leverage}`, { side: position.side }),
        accountCell(formatPrice(position.entry_price)),
        accountCell(accountMoney(position.mark_notional_usdc)),
        accountCell(`${accountMoney(position.unrealized_pnl_usdc)}${roe}`, { tone: pnl === null ? null : pnl >= 0 ? "positive" : "negative" }),
        accountCell(finite(position.liquidation_price) === null ? "No liq. price" : formatPrice(position.liquidation_price)),
        accountAction("Review close", () => reviewPositionClose(position), { title: `Prefill a reduce-only ${position.market} close review` }),
      ];
    }),
    empty: "No open perpetual positions on this account.",
  };
}

function renderTerminalAccountLedger() {
  const host = document.getElementById("terminalAccountLedger");
  const snapshot = state.accountSnapshot;
  if (!host || !snapshot?.ok) return;
  const definition = accountLedgerDefinition(state.accountTab, snapshot);
  host.replaceChildren();
  if (!definition.rows.length) {
    const empty = document.createElement("div");
    empty.className = "terminal-account-empty";
    const label = document.createElement("strong");
    label.textContent = definition.loading ? "Loading current order history…" : definition.empty;
    const note = document.createElement("span");
    note.textContent = definition.loading
      ? "This history is requested only when you open the tab."
      : "The other account tabs remain available.";
    empty.append(label, note);
    host.append(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "terminal-account-grid";
  grid.dataset.view = state.accountTab;
  const columns = document.createElement("div");
  columns.className = "terminal-account-columns";
  columns.append(...definition.columns.map((label) => accountCell(label)));
  grid.append(columns);
  for (const rowCells of definition.rows) {
    const row = document.createElement("div");
    row.className = "terminal-account-row";
    row.append(...rowCells);
    grid.append(row);
  }
  host.append(grid);
}

function renderTerminalAccount(snapshot) {
  state.accountSnapshot = snapshot;
  const summary = snapshot.summary || {};
  const summaryHost = document.getElementById("terminalAccountSummary");
  if (summaryHost) summaryHost.hidden = snapshot.state === "empty";
  setText("terminalAccountEquity", accountMoney(summary.account_value_usdc));
  setText("terminalAccountWithdrawable", accountMoney(summary.withdrawable_usdc));
  setText("terminalAccountExposure", accountMoney(summary.position_notional_usdc));
  setText("terminalAccountMargin", finite(summary.margin_utilization_ratio) === null
    ? accountMoney(summary.margin_used_usdc)
    : `${accountMoney(summary.margin_used_usdc)} · ${percent(summary.margin_utilization_ratio, { ratio: true }).replace(/^\+/, "")}`);
  setText("terminalAccountMaintenance", accountMoney(summary.maintenance_margin_usdc));
  setText("terminalAccountLeverage", finite(summary.account_leverage) === null ? "—" : `${accountNumber(summary.account_leverage)}×`);
  const counts = {
    terminalAccountPositionsCount: (snapshot.positions || []).length,
    terminalAccountBalancesCount: (snapshot.balances || []).length,
    terminalAccountOrdersCount: (snapshot.open_orders || []).length,
    terminalAccountFillsCount: (snapshot.fills || []).length,
    terminalAccountFundingCount: (snapshot.funding || []).length,
  };
  for (const [id, value] of Object.entries(counts)) {
    setText(id, value);
    const count = document.getElementById(id);
    if (count) count.hidden = false;
  }
  renderTerminalAccountLedger();
  renderTerminalTicketAccount();
}

function setAccountTab(tab) {
  state.accountTab = new Set(["positions", "balances", "orders", "history", "fills", "funding"]).has(tab) ? tab : "positions";
  for (const button of document.querySelectorAll("[data-account-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.accountTab === state.accountTab));
  }
  renderTerminalAccountLedger();
  if (state.accountTab === "history" && !state.accountHistory && !state.accountHistoryLoading) void loadTerminalAccountHistory();
}

async function loadTerminalAccountHistory() {
  const address = state.accountSnapshot?.account?.address;
  if (!address || state.accountHistoryLoading) return;
  state.accountHistoryLoading = true;
  renderTerminalAccountLedger();
  try {
    const { response, payload } = await fetchJson("/api/trade/account-history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, kind: "orders" }),
    });
    if (!response.ok || !payload?.ok || payload.account?.address !== address) throw new Error("account_history_failed");
    state.accountHistory = payload;
    const count = document.getElementById("terminalAccountHistoryCount");
    setText("terminalAccountHistoryCount", (payload.orders || []).length);
    if (count) count.hidden = false;
  } catch {
    state.accountHistory = {
      ok: false,
      orders: [],
    };
    const status = document.getElementById("terminalAccountStatus");
    if (status) {
      status.dataset.tone = "error";
      status.textContent = "Current order history could not be loaded. Account snapshot remains available.";
    }
  } finally {
    state.accountHistoryLoading = false;
    if (state.accountTab === "history") renderTerminalAccountLedger();
  }
}

async function loadTerminalAccount(addressInput, { walletTransport = false } = {}) {
  const address = String(addressInput || "").trim();
  const status = document.getElementById("terminalAccountStatus");
  const submit = document.querySelector("#terminalAccountForm button[type='submit']");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    status.dataset.tone = "error";
    status.textContent = "Enter a complete 0x Hyperliquid address";
    return;
  }
  const generation = ++state.accountGeneration;
  state.accountHistory = null;
  state.accountHistoryLoading = false;
  state.walletTransportConnected = walletTransport;
  state.walletAddress = walletTransport ? address : null;
  syncWalletControls();
  updateWalletShellCapability();
  const historyCount = document.getElementById("terminalAccountHistoryCount");
  if (historyCount) historyCount.hidden = true;
  submit.disabled = true;
  status.dataset.tone = "";
  status.textContent = "Loading current account state…";
  try {
    const { response, payload } = await fetchJson("/api/trade/account-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (generation !== state.accountGeneration) return;
    if (!response.ok || !payload?.ok) throw new Error("account_snapshot_failed");
    renderTerminalAccount(payload);
    syncOrderPlanControls();
    status.textContent = walletTransport
      ? `${shortAccountAddress(payload.account?.address)} · wallet connected · public Hyperliquid account loaded · no signature requested`
      : `${shortAccountAddress(payload.account?.address)} · current venue state · public observation only`;
    if (state.lane === "perps" && state.selected?.instrument_id) void requestOrderPlan({ automatic: true });
  } catch {
    if (generation !== state.accountGeneration) return;
    status.dataset.tone = "error";
    status.textContent = "That account could not be loaded right now. Try again.";
  } finally {
    if (generation === state.accountGeneration) submit.disabled = false;
  }
}

async function useBrowserWalletAddress() {
  const status = document.getElementById("terminalAccountStatus");
  if (state.walletTransportConnected) {
    clearConnectedWalletView();
    return;
  }
  const wallet = await chooseExternalWallet("evm");
  if (!wallet) return;
  state.selectedEvmWalletProvider = wallet;
  initializeWalletAddressControl();
  if (status) {
    status.dataset.tone = "";
    status.textContent = "Requesting a public address from the browser wallet…";
  }
  try {
    const accounts = await wallet.request({ method: "eth_requestAccounts" });
    const address = browserWalletAddress(accounts);
    if (!address) throw new Error("wallet_address_unavailable");
    const input = document.getElementById("terminalAccountAddress");
    if (input) input.value = address;
    await loadTerminalAccount(address, { walletTransport: true });
  } catch {
    state.walletTransportConnected = false;
    state.walletAddress = null;
    syncWalletControls();
    updateWalletShellCapability();
    if (status) {
      status.dataset.tone = "error";
      status.textContent = "Wallet connection was canceled or no EVM address was returned. A public address can still be loaded manually.";
    }
  }
}

async function connectTerminalWallet() {
  if (state.lane === "spot") {
    setTerminalPane("trade");
    await connectSpotWalletReadOnly();
    return;
  }
  setTerminalPane("account");
  await useBrowserWalletAddress();
}

function initializeWalletAddressControl() {
  const wallet = browserWalletProvider();
  syncWalletControls();
  updateWalletShellCapability();
  if (!wallet?.on || boundEvmWalletProviders.has(wallet)) return;
  boundEvmWalletProviders.add(wallet);
  wallet.on("accountsChanged", (accounts) => {
    if (!state.walletTransportConnected) return;
    const address = browserWalletAddress(accounts);
    if (!address) {
      clearConnectedWalletView("Wallet account access ended · no wallet permission was retained by RavenOS");
      return;
    }
    if (state.walletTransportConnected && state.walletAddress?.toLowerCase() === address.toLowerCase()) return;
    if (state.lane === "spot" && evmSpotProfile()) {
      state.walletAddress = address;
      setText("terminalSpotWalletState", shortAccountAddress(address));
      setText("terminalSpotWalletNote", "Address updated. Review a new exact route before signing.");
      setText("terminalSpotBalance", "Read on quote");
      clearSpotQuoteResult("Wallet account changed. Review a new exact route.");
      syncSpotTicketControls();
      syncWalletControls();
      updateWalletShellCapability();
      return;
    }
    const input = document.getElementById("terminalAccountAddress");
    if (input) input.value = address;
    void loadTerminalAccount(address, { walletTransport: true });
  });
  wallet.on("disconnect", () => {
    if (state.walletTransportConnected) clearConnectedWalletView("Wallet provider disconnected · public account view cleared");
  });
}

function readableProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  const labels = {
    atlas_listed_market: "Atlas listed market",
    coingecko_onchain: "CoinGecko Onchain",
    dexpaprika: "DexPaprika",
    hyperliquid_native: "Hyperliquid",
    yahoo_finance: "Listed-market provider",
  };
  return labels[provider] || titleCase(value, "Provider unavailable");
}

function operatorList(value, fallback = "Unavailable") {
  if (Array.isArray(value)) {
    const rows = value.map((item) => customerFacingText(item, "")).filter(Boolean);
    return rows.length ? rows.join(" · ") : fallback;
  }
  if (value && typeof value === "object") {
    if (value.label) return customerFacingText(value.label, fallback);
    if (value.summary) return customerFacingText(value.summary, fallback);
  }
  return customerFacingText(value, fallback);
}

function setAnatomySlot(index, label, value, { show = hasOperatorValue(value) } = {}) {
  setText(`terminalAnatomy${index}Label`, show ? label : "", "");
  setText(`terminalAnatomy${index}`, show ? value : "", "");
  const cell = document.getElementById(`terminalAnatomy${index}`)?.closest("div");
  if (cell) cell.hidden = !show;
  return show;
}

function setAnatomyRows(rows = []) {
  const useful = rows.filter((row) => row && (row.show ?? hasOperatorValue(row.value)));
  for (let index = 1; index <= 7; index += 1) {
    const row = useful[index - 1];
    setAnatomySlot(index, row?.label || "", row?.value || "", { show: Boolean(row) });
    document.getElementById(`terminalAnatomy${index}`)?.closest("div")?.classList.remove("terminal-anatomy-wide");
  }
  if (useful.length % 2 === 1) document.getElementById(`terminalAnatomy${useful.length}`)?.closest("div")?.classList.add("terminal-anatomy-wide");
  const section = document.getElementById("terminalAnatomySection");
  if (section) section.hidden = useful.length === 0;
  return useful.length;
}

function currentRavenPaneSurface() {
  const surfaces = [
    ["terminalContextSection", "Current", "positive"],
    ["terminalAlphaSection", "Current", "positive"],
    ["terminalPlanSection", "Plan current", "positive"],
  ];
  return surfaces.find(([id]) => document.getElementById(id)?.hidden === false) || null;
}

function syncRavenPaneAvailability() {
  const availableSurface = currentRavenPaneSurface();
  const emptySurface = document.getElementById("terminalRavenEmptySection");
  const ravenButton = document.querySelector('[data-terminal-pane-button="raven"]');
  if (emptySurface) emptySurface.hidden = Boolean(availableSurface);
  if (ravenButton) ravenButton.disabled = false;
  setTerminalPaneStatus(
    "raven",
    availableSurface?.[1] || "Forming",
    availableSurface?.[2] || "neutral",
  );
  return true;
}

function setContextControlsVisible(visible, { kind = "Raven", trigger = "Raven Read" } = {}) {
  const cell = document.getElementById("terminalContextStateCell");
  const section = document.getElementById("terminalContextSection");
  const triggerNode = document.getElementById("terminalReadTrigger");
  const shellTrigger = document.getElementById("rosContextTrigger");
  if (cell) cell.hidden = !visible;
  if (section) section.hidden = !visible;
  if (triggerNode) {
    triggerNode.hidden = !visible;
    if (visible) triggerNode.textContent = trigger;
  }
  if (shellTrigger) shellTrigger.hidden = !visible;
  setText("terminalContextKindLabel", kind, "");
  syncRavenPaneAvailability();
  if (!visible) document.body.classList.remove("ros-context-open");
}

function setComparableVisible(visible) {
  const section = document.getElementById("terminalComparableSection");
  if (section) section.hidden = !visible;
}

function setContextField(id, value, label = "") {
  if (label) setText(`${id}Label`, label, "");
  return setOptionalField(id, value);
}

function decisionSupportValue(value) {
  if (Array.isArray(value)) return operatorList(value, "");
  return customerFacingText(value, "").trim();
}

function renderDecisionSupport({
  changed = "",
  strengthens = [],
  weakens = [],
  checkpoint = "",
  reference = "",
  scope = "",
  observed = "",
} = {}) {
  const mainFields = [
    ["terminalDecisionStrengthens", decisionSupportValue(strengthens)],
    ["terminalDecisionWeakens", decisionSupportValue(weakens)],
  ];
  let mainVisible = 0;
  for (const [id, value] of mainFields) mainVisible += Number(setOptionalField(id, value));
  const checkpointVisible = Number(setOptionalField("terminalDecisionCheckpoint", decisionSupportValue(checkpoint)));
  const host = document.getElementById("terminalDecisionSupport");
  if (host) host.hidden = mainVisible < 1;

  const evidenceFields = [
    ["terminalContextIdentity", decisionSupportValue(scope)],
    ["terminalEvidenceObserved", observed ? timestamp(observed) : ""],
    ["terminalDecisionChanged", decisionSupportValue(changed)],
    ["terminalDecisionReference", decisionSupportValue(reference)],
  ];
  let evidenceVisible = 0;
  for (const [id, value] of evidenceFields) evidenceVisible += Number(setOptionalField(id, value));
  const details = document.getElementById("terminalEvidenceDetails");
  if (details) {
    details.hidden = evidenceVisible < 1;
    if (evidenceVisible < 1) details.open = false;
  }
  return mainVisible + checkpointVisible + evidenceVisible;
}

const ALPHA_EMPTY_LANGUAGE = /\b(?:unknown|unavailable|insufficient|missing|not projected|checking|resolving)\b/i;

function cleanAlphaCard(card = {}) {
  const label = customerFacingText(card.label, "").trim();
  const headline = customerFacingText(card.headline, "").trim();
  const detail = customerFacingText(card.detail, "").trim();
  const meta = customerFacingText(card.meta, "").trim();
  if (!label || !headline || ALPHA_EMPTY_LANGUAGE.test(`${label} ${headline} ${detail} ${meta}`)) return null;
  const actions = (Array.isArray(card.actions) ? card.actions : [])
    .filter((action) => ["toggle-plan", "inspect-plan"].includes(action?.type) && action?.label)
    .map((action) => ({
      type: action.type,
      label: customerFacingText(action.label, "").slice(0, 48),
      pressed: action.pressed === true,
    }))
    .filter((action) => action.label);
  return {
    id: String(card.id || `${label}:${headline}`).slice(0, 160),
    label,
    headline,
    detail,
    meta,
    tone: ["positive", "negative", "warning", "neutral"].includes(card.tone) ? card.tone : "neutral",
    actions,
  };
}

function technicalAlphaCard(read = state.chartRead) {
  if (
    read?.schema_version !== "ravenos.chart_read.v1"
    || read.state !== "available"
    || read.evidence_scope !== "provider_candles_only"
    || !["long", "short"].includes(read.direction)
    || !(finite(read.facts?.close) > 0)
    || !(finite(read.facts?.rsi) >= 0)
  ) return null;
  const direction = read.direction === "long" ? "↑" : "↓";
  const facts = [`RSI ${finite(read.facts.rsi).toFixed(0)}`];
  const volumeRatio = finite(read.facts.volume_ratio);
  if (volumeRatio !== null) facts.push(`volume ${volumeRatio.toFixed(1)}× recent`);
  const map = read.structure_map;
  if (
    finite(map?.entry_reference) > 0
    && finite(map?.invalidation_reference) > 0
    && finite(map?.favorable_reference) > 0
  ) {
    facts.push(`map ${formatPrice(map.entry_reference)} → ${formatPrice(map.favorable_reference)} · invalidates ${formatPrice(map.invalidation_reference)}`);
  }
  return cleanAlphaCard({
    id: "technical-chart-read",
    label: "Chart setup",
    headline: `${read.setup === "breakout_confirmed" ? "Breakout confirmed" : "Trend aligned"} ${direction} · ${read.score}/${read.score_max}`,
    detail: facts.join(" · "),
    meta: `${read.timeframe} · current price action`,
    tone: read.direction === "long" ? "positive" : "negative",
  });
}

function exactSpotRavenDirection() {
  if (state.lane !== "spot" || state.context?.spot_identity_validated !== true) return null;
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  const selected = currentProjectIdentity();
  const publicInstrumentId = selected ? `${selected.chain}:pool:${selected.poolAddress}` : "";
  const discovery = state.opportunityEvidence?.discovery;
  const identity = discovery?.exact_identity;
  const evidence = discovery?.raven_evidence_state;
  const velocity = discovery?.velocity_state;
  const direction = velocity?.value === "upside_velocity"
    ? "long"
    : velocity?.value === "downside_velocity"
      ? "short"
      : null;
  const evidenceObserved = Date.parse(String(evidence?.observed_at || ""));
  const velocityObserved = Date.parse(String(velocity?.observed_at || ""));
  if (
    !direction
    || !activeInstrumentId
    || !selected
    || state.opportunityEvidence?.instrument_id !== publicInstrumentId
    || identity?.instrument_id !== publicInstrumentId
    || String(identity?.chain || "").toLowerCase() !== selected.chain
    || !sameSelectedAddress(selected.chain, identity?.pool_address, selected.poolAddress)
    || !sameSelectedAddress(selected.chain, identity?.token_address, selected.tokenAddress)
    || (selected.quoteAddress && !sameSelectedAddress(selected.chain, identity?.quote_token_address, selected.quoteAddress))
    || evidence?.qualified !== true
    || evidence?.raven_signal !== true
    || !["current", "fresh"].includes(String(evidence?.freshness || "").toLowerCase())
    || velocity?.availability !== "available"
    || !["current", "fresh"].includes(String(velocity?.freshness || "").toLowerCase())
    || !Number.isFinite(evidenceObserved)
    || !Number.isFinite(velocityObserved)
    || Math.abs(evidenceObserved - velocityObserved) > 1_000
  ) return null;
  return {
    direction,
    value: velocity.value,
    observedAt: velocity.observed_at,
    scope: state.context.spot_context?.evidence_scope === "exact_token" ? "Exact-token Raven behavior" : "Exact-pool Raven behavior",
  };
}

function ravenChartConflictCard(read = state.chartRead) {
  const raven = exactSpotRavenDirection();
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  if (
    !raven
    || read?.schema_version !== "ravenos.chart_read.v1"
    || read.state !== "available"
    || read.evidence_scope !== "provider_candles_only"
    || read.instrument_id !== activeInstrumentId
    || !["long", "short"].includes(read.direction)
    || read.direction === raven.direction
  ) return null;
  const ravenArrow = raven.direction === "long" ? "↑" : "↓";
  const chartArrow = read.direction === "long" ? "↑" : "↓";
  return cleanAlphaCard({
    id: "raven-chart-conflict",
    label: "Evidence conflict",
    headline: `Raven behavior is ${ravenArrow}; ${read.timeframe} chart structure is ${chartArrow}`,
    detail: "The behavioral read and current candle structure disagree. RavenOS is not promoting a directional plan until they align.",
    meta: `${raven.scope} · provider-backed chart ${read.score}/${read.score_max} · same exact market`,
    tone: "warning",
  });
}

function spotFlowEvidence(workspace = state.workspace?.state || {}) {
  const anatomy = workspace.marketAnatomy || {};
  const activity = anatomy.current_activity || {};
  const holders = anatomy.holder_distribution || {};
  const windows = [
    ["5m", activity.buys_5m, activity.sells_5m, activity.traders_5m, holders.change_5m_pct],
    ["1h", activity.buys_1h, activity.sells_1h, activity.traders_1h, holders.change_1h_pct],
    ["24h", activity.buys_24h ?? anatomy.buys_24h, activity.sells_24h ?? anatomy.sells_24h, activity.traders_24h, holders.change_24h_pct],
  ];
  const selected = windows.find(([, buysValue, sellsValue, tradersValue]) => {
    const buys = finite(buysValue);
    const sells = finite(sellsValue);
    const traders = finite(tradersValue);
    return buys !== null && sells !== null && buys + sells >= 20 && (traders === null || traders >= 10);
  });
  if (!selected) return null;
  const [window, buysValue, sellsValue, tradersValue, holderChangeValue] = selected;
  const buys = finite(buysValue);
  const sells = finite(sellsValue);
  const traders = finite(tradersValue);
  const holderChange = finite(holderChangeValue);
  const buyRatio = buys / Math.max(1, sells);
  const sellRatio = sells / Math.max(1, buys);
  const accumulation = buyRatio >= 1.5 && holderChange !== null && holderChange > 0;
  const distribution = sellRatio >= 1.5 && holderChange !== null && holderChange < 0;
  return {
    window,
    scope: anatomy.raven_context?.evidence_scope === "exact_token" ? "exact_token" : "exact_pool",
    buys,
    sells,
    traders,
    holderChange,
    buyRatio,
    sellRatio,
    buyShare: buys / Math.max(1, buys + sells),
    accumulation,
    distribution,
  };
}

function spotFlowAlphaCard() {
  if (state.lane !== "spot" || !state.context?.spot_identity_validated) return null;
  const evidence = spotFlowEvidence();
  if (!evidence) return null;
  const { window, scope, buys, sells, traders, holderChange, buyRatio, sellRatio, accumulation, distribution } = evidence;
  if (!accumulation && !distribution && buyRatio < 1.75 && sellRatio < 1.75) return null;
  const buySide = accumulation || (!distribution && buyRatio >= sellRatio);
  const ratio = buySide ? buyRatio : sellRatio;
  const holderLabel = holderChange === null ? "" : ` · holders ${percent(holderChange)}`;
  return cleanAlphaCard({
    id: "exact-flow-read",
    label: accumulation ? "Accumulation" : distribution ? "Distribution" : buySide ? "Buy pressure" : "Sell pressure",
    headline: `${buySide ? "Buy" : "Sell"} count ${ratio.toFixed(1)}× opposing flow${holderLabel}`,
    detail: `${compact(buys)} buys · ${compact(sells)} sells${traders === null ? "" : ` · ${compact(traders)} traders`} over ${window}`,
    meta: scope === "exact_token"
      ? "Token-wide activity · selected pool revalidated"
      : holderChange === null ? "Exact-pool activity" : "Exact-pool activity + exact-token holder change",
    tone: buySide ? "positive" : "negative",
  });
}

function createSpotStructurePlan(context = {}, workspace = state.workspace?.state || {}) {
  const read = state.chartRead;
  const ravenDirection = exactSpotRavenDirection();
  const map = read?.structure_map || {};
  const anatomy = workspace.marketAnatomy || {};
  const profile = anatomy.market_profile || {};
  const controls = profile.token_controls || {};
  const holderProjection = state.holderListCache.get(currentHolderIdentity()?.key);
  const controlRisk = verifiedMarketControlRisk(holderProjection?.risk_screen, currentHolderIdentity());
  const instrumentId = workspace.instrument?.canonical_id;
  const flow = spotFlowEvidence(workspace);
  const liquidity = finite(anatomy.liquidity_usd);
  const marketCap = finite(anatomy.market_cap_usd);
  const poolAgeMs = finite(anatomy.pool_age_ms);
  const top10Pct = finite(controlRisk?.metrics?.top_10_wallet_supply_pct);
  const developerHoldingPct = finite(controlRisk?.metrics?.developer_supply_pct);
  const rsi = finite(read?.facts?.rsi);
  const volumeRatio = finite(read?.facts?.volume_ratio);
  const entry = finite(map.entry_reference);
  const risk = finite(map.invalidation_reference);
  const primaryTarget = finite(map.favorable_reference);
  const sample = Math.max(0, Math.trunc(finite(workspace.returnedBars) || workspace.candles?.length || 0));
  const contextText = `${context.movement_state || ""} ${context.what_changed || ""}`;
  const controlEvidenceComplete = [controls.mint_authority, controls.freeze_authority]
    .every((value) => ["disabled", "enabled"].includes(String(value || "").toLowerCase()))
    && ["not_flagged", "flagged"].includes(String(controls.honeypot || "").toLowerCase());
  const unsafeControls = [controls.mint_authority, controls.freeze_authority]
    .some((value) => /enabled|active|retained/i.test(String(value || "")))
    || (controls.honeypot && !/^(?:not_flagged|clear|false)$/i.test(String(controls.honeypot)));
  if (
    context.schema_version !== "ravenos.spot_market_context.v1"
    || context.state !== "current"
    || context.research_only !== true
    || context.actionable !== false
    || !instrumentId
    || read?.schema_version !== "ravenos.chart_read.v1"
    || read.state !== "available"
    || read.evidence_scope !== "provider_candles_only"
    || read.instrument_id !== instrumentId
    || read.direction !== "long"
    || ravenDirection?.direction === "short"
    || finite(read.score) < 4
    || !["current", "fresh", "live"].includes(String(workspace.providerFreshnessState || "").toLowerCase())
    || !["current", "fresh", "live"].includes(String(workspace.candleFreshnessState || "").toLowerCase())
    || workspace.marketActivityState !== "active"
    || !controlRisk
    || !flow
    || flow.buyShare < 0.58
    || (flow.traders !== null && flow.traders < 10)
    || !/rose|rising|accelerat|expand|increas|buy/i.test(contextText)
    || /fell|falling|decelerat|contract|decreas|sell pressure/i.test(contextText)
    || !(liquidity >= 2_500)
    || sample < 55
    || !(entry > 0)
    || !(risk > 0)
    || !(primaryTarget > entry)
    || !(risk < entry)
    || unsafeControls
    || ["high", "severe"].includes(controlRisk?.level)
  ) return null;
  const riskDistance = entry - risk;
  const riskPct = (riskDistance / entry) * 100;
  if (!(riskPct >= 0.15 && riskPct <= 20)) return null;
  const depthToMarketCap = liquidity !== null && marketCap !== null && marketCap > 0 ? liquidity / marketCap : null;
  const defensiveSignals = [
    riskPct >= 8 ? `wide ${riskPct.toFixed(1)}% structural risk` : "",
    liquidity < 25_000 ? `${compact(liquidity, { currency: true })} pool depth` : "",
    marketCap !== null && marketCap < 100_000 ? `${compact(marketCap, { currency: true })} market cap` : "",
    poolAgeMs !== null && poolAgeMs < 86_400_000 ? "pool younger than 24h" : "",
    top10Pct !== null && top10Pct >= 55 ? `top 10 hold ${top10Pct.toFixed(1)}%` : "",
    developerHoldingPct !== null && developerHoldingPct >= 8 ? `developer holds ${developerHoldingPct.toFixed(1)}%` : "",
    rsi !== null && rsi >= 76 ? `RSI ${rsi.toFixed(0)} is extended` : "",
    flow.holderChange !== null && flow.holderChange < 0 ? `holders ${percent(flow.holderChange)}` : "",
    depthToMarketCap !== null && depthToMarketCap < 0.025 ? `${(depthToMarketCap * 100).toFixed(1)}% depth / market cap` : "",
    ...(controlRisk?.risk_factors || []).slice(0, 2).map((row) => row.label.toLowerCase()),
  ].filter(Boolean);
  const breakoutQualified = read.setup === "breakout_confirmed"
    && finite(read.score) >= 4
    && flow.buyShare >= 0.62
    && (volumeRatio === null || volumeRatio >= 1.05)
    && (rsi === null || rsi <= 82);
  const accumulationQualified = flow.accumulation
    && flow.holderChange !== null
    && flow.holderChange > 0
    && flow.buyShare >= 0.62;
  let policy = {
    id: "adaptive_trend",
    label: "Adaptive trend scale-out",
    multiples: [0.9, 1.8, 3],
    allocations: [40, 35, 25],
  };
  if (defensiveSignals.length || !controlEvidenceComplete) {
    policy = {
      id: "defensive_de_risk",
      label: "Defensive de-risk",
      multiples: [0.65, 1.25, 2.1],
      allocations: [55, 30, 15],
    };
  } else if (breakoutQualified) {
    policy = {
      id: "breakout_runner",
      label: "Breakout runner",
      multiples: [1.2, 2.4, 4],
      allocations: [25, 30, 45],
    };
  } else if (accumulationQualified) {
    policy = {
      id: "accumulation_scale_out",
      label: "Accumulation scale-out",
      multiples: [1, 2.1, 3.6],
      allocations: [30, 35, 35],
    };
  }
  const target = (multiple, allocationPct, label) => ({
    label,
    price: entry + riskDistance * multiple,
    excursion_pct: riskPct * multiple,
    reward_risk: multiple,
    allocation_pct: allocationPct,
  });
  const takeProfits = policy.multiples.map((multiple, index) => target(
    multiple,
    policy.allocations[index],
    index === policy.multiples.length - 1 ? `TP${index + 1} / runner` : `TP${index + 1}`,
  ));
  const strategyReasons = [
    `${read.setup === "breakout_confirmed" ? "Breakout" : "Trend"} structure ${read.score}/${read.score_max}${rsi === null ? "" : ` · RSI ${rsi.toFixed(0)}`}`,
    `${Math.round(flow.buyShare * 100)}% buy-side across ${flow.window}${flow.traders === null ? "" : ` · ${compact(flow.traders)} traders`}`,
    flow.holderChange === null ? "" : `Holder count ${percent(flow.holderChange)} over ${flow.window}`,
    depthToMarketCap === null ? `${compact(liquidity, { currency: true })} exact-pool liquidity` : `${(depthToMarketCap * 100).toFixed(1)}% liquidity / market cap`,
    volumeRatio === null ? "" : `${volumeRatio.toFixed(1)}× recent candle volume`,
    ...defensiveSignals,
  ].filter(Boolean).slice(0, 5);
  const observedAt = read.observed_at || context.observed_at;
  const frozenId = String(context.public_attention_id || `${instrumentId}:${context.observed_at || observedAt || "current"}`);
  return {
    schema_version: "ravenos.plan_preview.v1",
    plan_id: `${frozenId}:${policy.id}:v1`,
    state: "research_only",
    enabled_by_default: false,
    opt_in_required: true,
    instrument_id: instrumentId,
    direction: "long",
    as_of: observedAt,
    frozen_context_id: frozenId,
    review_horizon: `${read.timeframe} structure map`,
    sample_size: sample,
    evidence_unit: "market candles",
    evidence_maturity: "current_structure",
    evidence_label: `${sample.toLocaleString()} market candles · ${flow.scope === "exact_token" ? "token-wide current buy flow" : "exact-pool current buy flow"}`,
    strategy_id: policy.id,
    strategy_label: policy.label,
    strategy_reasons: strategyReasons,
    strategy_inputs: {
      chart_setup: read.setup,
      chart_score: read.score,
      rsi,
      volume_ratio: volumeRatio,
      buy_share: flow.buyShare,
      holder_change_pct: flow.holderChange,
      liquidity_usd: liquidity,
      market_cap_usd: marketCap,
      liquidity_to_market_cap_ratio: depthToMarketCap,
      pool_age_ms: poolAgeMs,
      top_10_holder_pct: top10Pct,
      developer_holding_pct: developerHoldingPct,
      token_control_evidence: controlEvidenceComplete ? "complete" : "not_in_packet",
      structural_risk_pct: riskPct,
    },
    methodology: `${policy.label}: target spacing and trim sizes adapt to current exact-pool structure, volatility, flow participation, holders, depth, age, concentration, and available token-control evidence.`,
    levels: {
      entry_reference: { price: entry, observed_at: observedAt, source: "latest observed close" },
      target_reference: { price: takeProfits[1].price, excursion_pct: takeProfits[1].excursion_pct, source: `${policy.label} primary scale-out reference` },
      risk_reference: { price: risk, excursion_pct: -riskPct, source: "recent market-structure invalidation" },
    },
    take_profits: takeProfits,
    production_qualified: false,
    personalized: false,
    executable: false,
    signing_available: false,
    submission_available: false,
    disclaimer: "Exact-market research references only. Review liquidity and slippage before acting; these levels are not personalized orders.",
  };
}

function spotPlanOverlays(plan = {}) {
  const validated = planPreviewData(plan);
  if (!validated || state.lane !== "spot") return [];
  const observed = Date.parse(plan.as_of || "") / 1_000;
  if (!Number.isFinite(observed)) return [];
  const lineage = { frozen_context_id: plan.frozen_context_id, methodology: "exact_pool_raven_flow_plus_provider_structure" };
  const level = ({ id, type, label, summary, severity, price }) => ({
    id: `${plan.plan_id}:${id}`,
    instrument_id: plan.instrument_id,
    type,
    label,
    summary,
    severity,
    priceMin: price,
    priceMax: price,
    startTime: observed,
    observed_at: plan.as_of,
    lineage,
  });
  return [
    level({ id: "entry", type: "plan-entry", label: "Decision reference", summary: "Latest observed close", severity: "info", price: validated.levels.entry_reference.price }),
    ...validated.takeProfits.map((target, index) => level({
      id: `target-${index + 1}`,
      type: "plan-target",
      label: `${target.label} · ${target.allocation_pct}%`,
      summary: `${target.reward_risk}R scale-out reference`,
      severity: "success",
      price: target.price,
    })),
    level({ id: "risk", type: "plan-risk", label: "Structure invalidation", summary: "Recent exact-pool structure", severity: "danger", price: validated.levels.risk_reference.price }),
  ];
}

function refreshSpotStructurePlan() {
  if (state.lane !== "spot" || !(state.context?.spot_identity_validated || state.context?.spot_plan_identity_validated)) return false;
  const planPreview = createSpotStructurePlan(state.context.spot_context, state.workspace?.state || {});
  const nextContext = { ...state.context };
  delete nextContext.plan_preview;
  delete nextContext.chart_overlays;
  if (planPreview) {
    nextContext.plan_preview = planPreview;
    nextContext.chart_overlays = {
      schema_version: "ravenos.chart_overlays.v1",
      instrument_id: planPreview.instrument_id,
      role: "annotation_only",
      candle_replacement_allowed: false,
      overlays: spotPlanOverlays(planPreview),
    };
    if (state.autoRavenOverlays) state.planOverlayEnabled = true;
  } else {
    state.planOverlayEnabled = false;
  }
  state.context = nextContext;
  renderPlanPreview(planPreview || {});
  applySpotContextChart(nextContext);
  syncPlanActionSurfaces();
  renderAlphaStack();
  return Boolean(planPreview);
}

function planAlphaCard() {
  const validated = qualifiedPlanData();
  if (!validated) return null;
  const { plan, levels, sample, takeProfits } = validated;
  const spotPlan = state.lane === "spot" && takeProfits.length >= 2;
  return cleanAlphaCard({
    id: "evidence-plan",
    label: spotPlan ? "TP strategy" : "Trade path",
    headline: spotPlan
      ? `${customerFacingText(plan.strategy_label, "Custom scale-out")} · ${percent(levels.risk_reference.excursion_pct)} structural risk`
      : `${titleCase(plan.direction)} · ${percent(levels.target_reference.excursion_pct)} favorable / ${percent(levels.risk_reference.excursion_pct)} adverse`,
    detail: spotPlan
      ? takeProfits.map((target) => `${target.label} ${percent(target.excursion_pct)} · ${target.allocation_pct}%`).join(" · ")
      : `${formatPrice(levels.entry_reference.price)} decision · ${formatPrice(levels.target_reference.price)} favorable · ${formatPrice(levels.risk_reference.price)} invalidation`,
    meta: plan.evidence_label || `${sample.toLocaleString()} completed paths · research only`,
    tone: plan.direction === "short" ? "negative" : "positive",
    actions: [
      { type: "toggle-plan", label: state.planOverlayEnabled ? "Hide from chart" : "Show on chart", pressed: state.planOverlayEnabled },
      { type: "inspect-plan", label: "Details", pressed: false },
    ],
  });
}

function projectedAlphaCards() {
  const workspace = state.workspace?.state || {};
  const contract = workspace.alphaLayers || workspace.marketAnatomy?.alpha_layers;
  if (
    contract?.schema_version !== "ravenos.alpha_layers.v1"
    || contract.role !== "evidence_only"
    || contract.instrument_id !== workspace.instrument?.canonical_id
    || !Array.isArray(contract.layers)
  ) return [];
  return contract.layers
    .filter((layer) => layer?.state === "available" && finite(layer.evidence_count) >= 1)
    .filter((layer) => layer.kind !== "actor_activity" || (layer.privacy?.addresses_removed === true && layer.independence_adjusted === true))
    .map((layer) => cleanAlphaCard({
      id: `projected:${layer.id}`,
      label: layer.label,
      headline: layer.headline,
      detail: layer.detail,
      meta: layer.evidence_label,
      tone: layer.tone,
    }))
    .filter(Boolean)
    .slice(0, 2);
}

function renderAlphaStack() {
  const section = document.getElementById("terminalAlphaSection");
  const host = document.getElementById("terminalAlphaStack");
  if (!section || !host) return 0;
  if (marketRiskBlocksAction()) {
    state.planOverlayEnabled = false;
    host.replaceChildren();
    section.hidden = true;
    return 0;
  }
  const planCard = planAlphaCard();
  const conflictCard = ravenChartConflictCard();
  const cards = [
    planCard,
    conflictCard,
    spotFlowAlphaCard(),
    technicalAlphaCard(),
    ...projectedAlphaCards(),
  ].filter(Boolean).filter((card, index, rows) => rows.findIndex((candidate) => candidate.id === card.id) === index).slice(0, 5);
  setText("terminalAlphaEyebrow", conflictCard ? "Raven vs chart" : "Raven actions");
  setText("terminalAlphaTitle", conflictCard ? "Decision cross-check" : planCard ? "Chart and plan" : "Chart checks");
  setText("terminalAlphaState", conflictCard ? "Mixed evidence" : "Review only");
  host.replaceChildren();
  section.hidden = cards.length === 0;
  for (const card of cards) {
    const node = document.createElement("article");
    node.className = "terminal-alpha-card";
    node.dataset.tone = card.tone;
    const label = document.createElement("span");
    label.textContent = card.label;
    const headline = document.createElement("strong");
    headline.textContent = card.headline;
    node.append(label, headline);
    if (card.detail) {
      const detail = document.createElement("p");
      detail.textContent = card.detail;
      node.append(detail);
    }
    if (card.meta) {
      const meta = document.createElement("small");
      meta.textContent = card.meta;
      node.append(meta);
    }
    if (Array.isArray(card.actions) && card.actions.length) {
      const actions = document.createElement("div");
      actions.className = "terminal-alpha-actions";
      for (const spec of card.actions.slice(0, 2)) {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = spec.label;
        action.dataset.ravenAction = spec.type;
        if (spec.type === "toggle-plan") action.setAttribute("aria-pressed", String(spec.pressed === true));
        action.addEventListener("click", () => {
          if (spec.type === "toggle-plan") setPlanOverlayActive(!state.planOverlayEnabled, { source: "alpha-card" });
          if (spec.type === "inspect-plan") focusPlanPreview();
        });
        actions.append(action);
      }
      node.append(actions);
    }
    host.append(node);
  }
  return cards.length;
}

function clearExternalChart() {
  state.externalChart?.remove?.();
  state.externalChart = null;
  document.querySelector(".terminal-controls")?.classList.remove("external-chart-active");
  if (state.workspace?.root) state.workspace.root.hidden = false;
  const credit = document.getElementById("terminalChartCredit");
  if (credit) {
    credit.textContent = "Lightweight Charts™ by TradingView";
    credit.href = "https://www.tradingview.com/";
  }
}

function tradingViewInterval(timeframe = state.timeframe) {
  return ({
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "1h": "60",
    "4h": "240",
    "1d": "D",
    "1w": "W",
    "1M": "W",
  })[timeframe] || "60";
}

function showListedVisualChart(row = state.selected) {
  clearExternalChart();
  const subject = atlasSubject(row || {});
  const exactInstrument = row?.instrument?.schema_version === "ravenos.instrument.v1" ? row.instrument : row;
  const entity = {
    entity_id: `${subject.instrumentType}:us:${subject.symbol}`,
    entity_kind: subject.instrumentType,
    symbol: subject.symbol,
    name: exactInstrument?.display_name || subject.label,
  };
  const host = document.getElementById("terminalChart");
  if (!host || !subject.symbol || !subject.instrumentId) return null;
  const panel = document.createElement("section");
  panel.className = "terminal-external-chart";
  const chart = document.createElement("div");
  chart.className = "terminal-external-chart-host";
  const footer = document.createElement("footer");
  const note = document.createElement("span");
  note.textContent = "Visual market context · timing shown in chart";
  const link = document.createElement("a");
  link.textContent = "Chart by TradingView";
  link.target = "_blank";
  link.rel = "noopener nofollow";
  footer.append(note, link);
  panel.append(chart, footer);
  host.append(panel);
  const resolved = mountTradingViewChart(chart, entity, {
    interval: tradingViewInterval(),
    exactInstrument,
  });
  if (!resolved) {
    panel.remove();
    return null;
  }
  link.href = resolved.attribution_url;
  if (state.workspace?.root) state.workspace.root.hidden = true;
  document.querySelector(".terminal-controls")?.classList.add("external-chart-active");
  const credit = document.getElementById("terminalChartCredit");
  if (credit) {
    credit.textContent = "Chart by TradingView";
    credit.href = resolved.attribution_url;
  }
  state.externalChart = panel;
  return resolved;
}

function renderExternalSourceDetails(resolved) {
  setText("terminalSourceSummary", "Chart details");
  setText("terminalSourceProvider", "TradingView");
  setText("terminalSourceInterval", `${state.timeframe} visual context`);
  setText("terminalSourceContinuity", "Displayed by TradingView · not extracted by RavenOS");
  setText("terminalSourceFreshness", resolved?.timing || "Timing shown in chart");
}

function renderSourceDetails(workspace = state.workspace?.state || {}) {
  const series = workspace?.candleSeries || {};
  const derivation = workspace?.derivation || series.derivation || {};
  const continuity = workspace?.continuity || {};
  const candleAudit = continuity.candles || {};
  const provider = readableProvider(series.provider || workspace?.source);
  const requestedInterval = series.timeframe || workspace?.timeframe || state.timeframe;
  const sourceInterval = series.source_interval || derivation.source_interval || requestedInterval;
  const mode = derivation.state === "derived" ? "Derived" : "Direct";
  const gaps = finite(candleAudit.missing_source_buckets);
  const duplicates = finite(candleAudit.conflicting_duplicates);
  const continuityLabel = continuity.state
    ? `${titleCase(continuity.state)}${gaps ? ` · ${gaps} missing source bucket${gaps === 1 ? "" : "s"}` : ""}${duplicates ? ` · ${duplicates} conflicting duplicate${duplicates === 1 ? "" : "s"}` : ""}`
    : "Not reported by this venue";
  const age = finite(workspace?.lastCandleAgeSeconds ?? candleAudit.age_seconds);
  const providerFreshness = workspace?.providerFreshnessState || "unavailable";
  const candleFreshness = workspace?.candleFreshnessState || series.freshness_state || candleAudit.freshness_state || workspace?.state || "unavailable";
  const activity = workspace?.marketActivityState;
  const activityLabel = activity === "no_recent_trades"
    ? "no recent txns"
    : activity === "activity_reported_chart_lagging"
      ? "chart catching up"
      : activity === "active"
        ? "active market"
        : null;

  setText("terminalSourceSummary", "Source details");
  setText("terminalSourceProvider", provider);
  setText("terminalSourceInterval", derivation.state === "derived"
    ? `${requestedInterval} from complete ${sourceInterval} bars`
    : `${mode} ${sourceInterval} bars`);
  setText("terminalSourceContinuity", continuityLabel);
  setText(
    "terminalSourceFreshness",
    `${providerFreshness === "current" ? "Provider current" : titleCase(providerFreshness)} · ${titleCase(candleFreshness)} candles${age !== null ? ` · last bar ${durationLabel(age)}` : ""}${activityLabel ? ` · ${activityLabel}` : ""}`,
  );
}

function profilePercent(value) {
  const result = finite(value);
  if (result === null || result < 0 || result > 100) return null;
  return `${result.toFixed(result < 1 ? 2 : 1)}%`;
}

const PROJECT_LINK_KINDS = new Set(["website", "x", "telegram", "discord", "farcaster", "zora"]);
const PROJECT_LINK_HOSTS = Object.freeze({
  x: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
  telegram: new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]),
  discord: new Set(["discord.gg", "www.discord.gg", "discord.com", "www.discord.com"]),
  farcaster: new Set(["warpcast.com", "www.warpcast.com", "farcaster.xyz", "www.farcaster.xyz"]),
  zora: new Set(["zora.co", "www.zora.co"]),
});

function safeProfileLink(value, kind = "") {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !host
      || host === "localhost"
      || host.endsWith(".local")
      || host === "0.0.0.0"
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]"
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || (PROJECT_LINK_HOSTS[kind] && !PROJECT_LINK_HOSTS[kind].has(host))
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function currentProjectIdentity() {
  if (state.lane !== "spot") return null;
  const chain = String(state.selected?.chainId || "").trim().toLowerCase();
  const poolAddress = String(state.selected?.pairAddress || "").trim();
  const tokenAddress = String(state.selected?.tokenAddress || "").trim();
  const quoteAddress = String(state.selected?.quoteTokenAddress || "").trim();
  if (!chain || !poolAddress || !tokenAddress) return null;
  if (
    chain !== "solana"
    && (
      !EVM_POOL_ID_RE.test(poolAddress)
      || !EVM_DISPLAY_ADDRESS_RE.test(tokenAddress)
      || (quoteAddress && !EVM_DISPLAY_ADDRESS_RE.test(quoteAddress))
    )
  ) return null;
  const normalizeAddress = (value) => chain === "solana" ? value : value.toLowerCase();
  return {
    key: `${chain}:${normalizeAddress(poolAddress)}:${normalizeAddress(tokenAddress)}:${normalizeAddress(quoteAddress)}`,
    chain,
    poolAddress,
    tokenAddress,
    quoteAddress,
    label: `${state.selected?.symbol || "Token"}/${state.selected?.quoteSymbol || "quote"}`,
  };
}

function clientProjectDescription(token = {}) {
  if (token?.description_role !== "project_description") return null;
  const clean = String(token?.description || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean && clean.length <= 321 ? clean : null;
}

function verifiedProjectProfile(profile, identity = currentProjectIdentity()) {
  const exact = profile?.identity || {};
  if (
    !identity
    || profile?.schema_version !== "ravenos.onchain_market_profile.v1"
    || exact.state !== "exact"
    || String(exact.chain || "").toLowerCase() !== identity.chain
    || !sameSelectedAddress(identity.chain, exact.pool_address, identity.poolAddress)
    || !sameSelectedAddress(identity.chain, exact.token_address, identity.tokenAddress)
    || (identity.quoteAddress && !sameSelectedAddress(identity.chain, exact.quote_token_address, identity.quoteAddress))
  ) return null;
  const links = [];
  const seenKinds = new Set();
  for (const row of (Array.isArray(profile.links) ? profile.links : []).slice(0, 6)) {
    const kind = String(row?.kind || "").toLowerCase();
    const href = PROJECT_LINK_KINDS.has(kind) ? safeProfileLink(row?.url, kind) : null;
    if (!href || seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    links.push({ kind, href });
  }
  return {
    ...profile,
    token: {
      ...(profile.token || {}),
      description: clientProjectDescription(profile.token),
    },
    links,
  };
}

function projectLinkLabel(kind, href) {
  const labels = {
    x: "X",
    telegram: "Telegram",
    discord: "Discord",
    farcaster: "Farcaster",
    zora: "Zora",
  };
  if (labels[kind]) return labels[kind];
  try {
    return new URL(href).hostname.replace(/^www\./, "").slice(0, 48) || "Website";
  } catch {
    return "Website";
  }
}

function quickProjectLinkLabel(kind) {
  return ({ x: "X", telegram: "TG", website: "Web", discord: "Discord", farcaster: "FC", zora: "Zora" })[kind] || "Link";
}

function projectResearchLabel(value, fallback) {
  const clean = customerFacingText(value, "").replace(/\s+/g, " ").trim();
  return (clean || fallback).slice(0, 34);
}

function syncProjectResearchMenu() {
  const identity = currentProjectIdentity();
  const holderPane = document.querySelector('[data-terminal-pane-button="holders"]');
  const activityPane = document.querySelector('[data-terminal-pane-button="activity"]');
  const ravenPane = document.querySelector('[data-terminal-pane-button="raven"]');
  const holderState = document.getElementById("terminalHolderListState")?.textContent;
  const walletState = document.getElementById("terminalActivityWalletCount")?.textContent;
  const rows = [
    {
      action: "risk",
      label: projectResearchLabel(holderPane?.dataset.status, "Review safety"),
      tone: holderPane?.dataset.statusTone || "neutral",
    },
    {
      action: "holders",
      label: projectResearchLabel(holderState, "View list"),
      tone: /unavailable/i.test(holderState || "") ? "warning" : /\d/.test(holderState || "") ? "positive" : "neutral",
    },
    {
      action: "wallets",
      label: projectResearchLabel(walletState === "Returned sample" ? "Load sample" : walletState, "Load sample"),
      tone: activityPane?.dataset.statusTone || "neutral",
    },
    {
      action: "raven",
      label: projectResearchLabel(ravenPane?.dataset.status, "Checking"),
      tone: ravenPane?.dataset.statusTone || "neutral",
      disabled: ravenPane?.disabled === true,
    },
  ];
  const stateIds = {
    risk: "terminalProjectRiskState",
    holders: "terminalProjectHolderState",
    wallets: "terminalProjectWalletState",
    raven: "terminalProjectRavenState",
  };
  for (const row of rows) {
    const button = document.querySelector(`[data-project-research-action="${row.action}"]`);
    if (!button) continue;
    const title = button.querySelector("span")?.textContent?.trim() || "Token check";
    setText(stateIds[row.action], row.label);
    button.dataset.tone = ["positive", "warning", "negative"].includes(row.tone) ? row.tone : "neutral";
    button.disabled = !identity || row.disabled === true;
    button.setAttribute("aria-label", `${title} · ${row.label}`);
  }
}

function runProjectResearchAction(action) {
  if (!currentProjectIdentity()) return;
  closeProjectLinks();
  if (action === "risk") inspectSpotRisk();
  else if (action === "holders") setHolderListFilter("all", { reveal: true });
  else if (action === "wallets") inspectActiveWallets();
  else if (action === "raven") {
    setTerminalPane("raven", { restoreScroll: false });
    focusTerminalRaven();
  }
}

function renderQuickMarketTools(identity, profile) {
  const root = document.getElementById("terminalMarketTools");
  const address = document.getElementById("terminalQuickAddress");
  const links = document.getElementById("terminalQuickLinks");
  if (!root || !address || !links) return;
  root.hidden = !identity;
  links.replaceChildren();
  links.hidden = true;
  if (!identity) {
    address.textContent = "";
    address.removeAttribute("title");
    return;
  }
  address.textContent = compactHolderAddress(identity.tokenAddress);
  address.title = identity.tokenAddress;
  const priority = { x: 0, telegram: 1, website: 2, discord: 3, farcaster: 4, zora: 5 };
  const quickLinks = [...(profile?.links || [])]
    .sort((left, right) => (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9))
    .slice(0, 3);
  for (const link of quickLinks) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer nofollow";
    anchor.dataset.kind = link.kind;
    anchor.textContent = `${quickProjectLinkLabel(link.kind)} ↗`;
    anchor.setAttribute("aria-label", `Open listed ${projectLinkLabel(link.kind, link.href)} link for ${identity.label}`);
    links.append(anchor);
  }
  links.hidden = links.childElementCount === 0;
}

function ensureCopyGlyph(button) {
  if (!button || button.querySelector(".terminal-copy-glyph")) return;
  const glyph = document.createElement("span");
  glyph.className = "terminal-copy-glyph";
  glyph.setAttribute("aria-hidden", "true");
  button.replaceChildren(glyph);
}

function setCopyButtonState(button, state = "ready", {
  readyLabel = "Copy value",
  copiedLabel = "Value copied",
  failedLabel = "Value could not be copied",
} = {}) {
  if (!button) return;
  ensureCopyGlyph(button);
  const labels = {
    ready: { accessible: readyLabel, title: readyLabel, feedback: "" },
    copied: { accessible: copiedLabel, title: "Copied", feedback: "Copied" },
    failed: { accessible: failedLabel, title: "Copy failed", feedback: "Copy failed" },
  };
  const next = labels[state] || labels.ready;
  button.dataset.copyState = labels[state] ? state : "ready";
  button.dataset.copyFeedback = next.feedback;
  button.setAttribute("aria-label", next.accessible);
  button.title = next.title;
}

function setProjectCopyLabels({ copied = false, failed = false } = {}) {
  const project = document.getElementById("terminalProjectCopy");
  const quick = document.getElementById("terminalQuickCopy");
  const copyState = copied ? "copied" : failed ? "failed" : "ready";
  const labels = {
    readyLabel: "Copy exact token contract",
    copiedLabel: "Exact token contract copied",
    failedLabel: "Exact token contract could not be copied",
  };
  setCopyButtonState(project, copyState, labels);
  setCopyButtonState(quick, copyState, labels);
}

function projectExplorerUrl(identity) {
  const bases = {
    solana: "https://solscan.io/token/",
    ethereum: "https://etherscan.io/token/",
    eth: "https://etherscan.io/token/",
    base: "https://basescan.org/token/",
    bsc: "https://bscscan.com/token/",
    bnb: "https://bscscan.com/token/",
  };
  return bases[identity?.chain] && identity?.tokenAddress
    ? `${bases[identity.chain]}${encodeURIComponent(identity.tokenAddress)}`
    : null;
}

function closeProjectLinks({ restoreFocus = false } = {}) {
  const trigger = document.getElementById("terminalProjectLinksTrigger");
  const popover = document.getElementById("terminalProjectLinksPopover");
  if (!trigger || !popover) return;
  const wasOpen = !popover.hidden;
  popover.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("terminal-project-links-open");
  if (restoreFocus && wasOpen && !trigger.hidden) trigger.focus();
}

function setProjectLinksOpen(open) {
  const trigger = document.getElementById("terminalProjectLinksTrigger");
  const popover = document.getElementById("terminalProjectLinksPopover");
  const identity = currentProjectIdentity();
  if (!trigger || !popover || !identity || trigger.hidden) {
    closeProjectLinks();
    return;
  }
  const shouldOpen = open === true;
  if (shouldOpen) syncProjectResearchMenu();
  popover.hidden = !shouldOpen;
  trigger.setAttribute("aria-expanded", String(shouldOpen));
  document.body.classList.toggle("terminal-project-links-open", shouldOpen);
  if (shouldOpen) requestAnimationFrame(() => popover.focus());
}

function renderProjectLinks(profile) {
  const identity = currentProjectIdentity();
  const trigger = document.getElementById("terminalProjectLinksTrigger");
  const popover = document.getElementById("terminalProjectLinksPopover");
  const links = document.getElementById("terminalProfileLinks");
  const empty = document.getElementById("terminalProjectLinksEmpty");
  if (!trigger || !popover || !links || !empty) return null;
  const previousIdentityKey = popover.dataset.identityKey || "";
  if (!identity) {
    state.projectProfile = null;
    trigger.hidden = true;
    trigger.removeAttribute("aria-label");
    popover.dataset.identityKey = "";
    closeProjectLinks();
    links.replaceChildren();
    renderQuickMarketTools(null, null);
    return null;
  }
  if (previousIdentityKey && previousIdentityKey !== identity.key) closeProjectLinks();
  popover.dataset.identityKey = identity.key;
  trigger.hidden = false;
  trigger.setAttribute("aria-label", `Open token research and project links for ${identity.label}`);
  const verified = verifiedProjectProfile(profile, identity);
  state.projectProfile = verified;
  renderQuickMarketTools(identity, verified);
  setText("terminalProjectLinksTitle", `${identity.label} · ${chainDisplayName(identity.chain)}`);
  setText("terminalProjectDescription", verified?.token?.description || "No project description is listed for this exact token.");
  setText("terminalProjectAddress", identity.tokenAddress);
  links.replaceChildren();
  for (const link of (verified?.links || [])) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer nofollow";
    anchor.dataset.kind = link.kind;
    anchor.textContent = `${projectLinkLabel(link.kind, link.href)} ↗`;
    links.append(anchor);
  }
  links.hidden = links.childElementCount === 0;
  empty.hidden = links.childElementCount > 0;

  const search = document.getElementById("terminalProjectSearchX");
  const searchUrl = new URL("https://x.com/search");
  searchUrl.searchParams.set("q", identity.tokenAddress);
  searchUrl.searchParams.set("src", "typed_query");
  searchUrl.searchParams.set("f", "live");
  if (search) search.href = searchUrl.toString();
  const explorer = document.getElementById("terminalProjectExplorer");
  const explorerUrl = projectExplorerUrl(identity);
  if (explorer) {
    explorer.hidden = !explorerUrl;
    explorer.textContent = explorerUrl ? `Open ${chainDisplayName(identity.chain)} explorer` : "";
    if (explorerUrl) explorer.href = explorerUrl;
    else explorer.removeAttribute("href");
  }
  setProjectCopyLabels();
  setText("terminalProjectLinkStatus", "", "");
  const credit = document.getElementById("terminalProjectCredit");
  const attributionUrl = safeProfileLink(verified?.attribution?.url);
  const creditVisible = verified?.attribution?.required === true && Boolean(attributionUrl);
  if (credit) {
    credit.hidden = !creditVisible;
    credit.textContent = creditVisible ? customerFacingText(verified.attribution.label, "Token profile source") : "";
    if (creditVisible) credit.href = attributionUrl;
    else credit.removeAttribute("href");
  }
  syncProjectResearchMenu();
  return verified;
}

async function copyProjectContract() {
  const identity = currentProjectIdentity();
  if (!identity) return;
  try {
    await navigator.clipboard.writeText(identity.tokenAddress);
    setProjectCopyLabels({ copied: true });
    setText("terminalProjectLinkStatus", "Exact token contract copied.", "");
    setTimeout(() => {
      if (currentProjectIdentity()?.key === identity.key) setProjectCopyLabels();
    }, 1_200);
  } catch {
    setProjectCopyLabels({ failed: true });
    setText("terminalProjectLinkStatus", "The exact token contract could not be copied.", "");
  }
}

const SOLANA_DISPLAY_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_DISPLAY_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_POOL_ID_RE = /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const HOLDER_CHAINS = new Set(["solana", "robinhood", "base", "bsc", "ethereum"]);
const HOLDER_INITIAL_ROW_COUNT = 20;
const HOLDER_EXPLORERS = Object.freeze({
  solana: "https://solscan.io/account/",
  robinhood: "https://robinhoodchain.blockscout.com/address/",
  base: "https://basescan.org/address/",
  bsc: "https://bscscan.com/address/",
  ethereum: "https://etherscan.io/address/",
});
const MARKET_CONTROL_RISK_SCHEMA = "ravenos.market_control_risk.v1";
const MARKET_CONTROL_RISK_LEVELS = new Set(["forming", "measured_low", "watch", "elevated", "high", "severe"]);
const MARKET_CONTROL_RISK_SEVERITIES = new Set(["info", "positive", "elevated", "high", "critical"]);

function currentHolderIdentity() {
  const chain = String(state.selected?.chainId || "").toLowerCase();
  if (state.lane !== "spot" || !HOLDER_CHAINS.has(chain)) return null;
  const poolAddress = String(state.selected?.pairAddress || "").trim();
  const tokenAddress = String(state.selected?.tokenAddress || "").trim();
  const quoteAddress = String(state.selected?.quoteTokenAddress || "").trim();
  const poolPattern = chain === "solana" ? SOLANA_DISPLAY_ADDRESS_RE : EVM_POOL_ID_RE;
  const tokenPattern = chain === "solana" ? SOLANA_DISPLAY_ADDRESS_RE : EVM_DISPLAY_ADDRESS_RE;
  // Preserve the existing Solana selection contract; the Worker validates its
  // addresses before returning holder evidence. Newly added EVM identities are
  // address-strict in the browser as well as at the Worker boundary.
  if (!poolAddress || !tokenAddress || (chain !== "solana" && (!poolPattern.test(poolAddress) || !tokenPattern.test(tokenAddress) || (quoteAddress && !tokenPattern.test(quoteAddress))))) return null;
  const normalize = (value) => chain === "solana" ? value : value.toLowerCase();
  return {
    key: `${chain}:${normalize(poolAddress)}:${normalize(tokenAddress)}`,
    chain,
    pool_address: normalize(poolAddress),
    token_address: normalize(tokenAddress),
    quote_address: quoteAddress ? normalize(quoteAddress) : "",
  };
}

function holderExplorerUrl(chain, address) {
  const base = HOLDER_EXPLORERS[String(chain || "").toLowerCase()];
  const pattern = chain === "solana" ? SOLANA_DISPLAY_ADDRESS_RE : EVM_DISPLAY_ADDRESS_RE;
  return base && pattern.test(String(address || "")) ? `${base}${address}` : null;
}

function compactHolderAddress(value) {
  const address = String(value || "");
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

function holderBalanceLabel(value) {
  const clean = String(value ?? "").trim();
  const number = Number(clean);
  if (clean && Number.isFinite(number) && Math.abs(number) < 1e15) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 3 }).format(number);
  }
  return clean || "—";
}

function verifiedHolderProjection(payload, identity) {
  const chain = String(identity?.chain || "").toLowerCase();
  const complete = payload?.coverage?.complete_holder_census;
  const totalOwners = Number(payload?.coverage?.total_owner_rows);
  const maximumSourceAccounts = Number(payload?.coverage?.maximum_source_accounts);
  const largestWalletPct = finite(payload?.summary?.largest_non_pool_wallet_supply_pct);
  const top3WalletPct = finite(payload?.summary?.top_3_wallet_supply_pct);
  const top10WalletPct = finite(payload?.summary?.top_10_wallet_supply_pct);
  const poolExclusionUnresolved = payload?.coverage?.pool_account_exclusion_state === "unresolved_pool_id";
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== "ravenos.onchain_holder_list.v2"
    || payload?.state !== "available"
    || String(payload?.identity?.chain || "").toLowerCase() !== chain
    || !sameSelectedAddress(chain, payload.identity.pool_address, identity.pool_address)
    || !sameSelectedAddress(chain, payload.identity.token_address, identity.token_address)
    || !Array.isArray(payload.holders)
    || payload.holders.length > 100
    || ![true, false].includes(complete)
    || (complete && (!Number.isInteger(totalOwners) || totalOwners < payload.holders.length || payload?.coverage?.scan_state !== "complete"))
    || (!complete && (!Number.isInteger(maximumSourceAccounts) || maximumSourceAccounts < payload.holders.length || maximumSourceAccounts > (chain === "solana" ? 20 : 50)))
    || (poolExclusionUnresolved
      ? [largestWalletPct, top3WalletPct, top10WalletPct].some((value) => value !== null)
        || payload.holders.some((row) => row?.excluded_from_wallet_concentration === true || row?.classification === "exact_pool_account")
      : [largestWalletPct, top3WalletPct, top10WalletPct].some((value) => value === null || value < 0 || value > 100)
        || largestWalletPct > top3WalletPct
        || top3WalletPct > top10WalletPct)
  ) return null;
  const addressPattern = chain === "solana" ? SOLANA_DISPLAY_ADDRESS_RE : EVM_DISPLAY_ADDRESS_RE;
  const holders = payload.holders.filter((row) => (
    Number.isInteger(row?.rank)
    && row.rank >= 1
    && addressPattern.test(String(row?.holder_address || ""))
    && typeof row?.balance === "string"
    && finite(row?.supply_share_pct) !== null
    && finite(row.supply_share_pct) >= 0
    && finite(row.supply_share_pct) <= 100
    && ["owner", "contract", "token_account", "exact_pool_account"].includes(row?.classification)
    && holderExplorerUrl(chain, row.holder_address) === row.explorer_url
  ));
  if (holders.length !== payload.holders.length) return null;
  return { ...payload, holders };
}

function verifiedMarketControlRisk(payload, identity) {
  const exact = payload?.identity || {};
  const cleanEvidence = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 12).map((row) => {
    if (
      !row
      || !String(row.id || "").match(/^[a-z0-9_:-]{1,80}$/i)
      || !MARKET_CONTROL_RISK_SEVERITIES.has(row.severity)
      || !["control", "market_integrity", "authenticity"].includes(row.dimension)
    ) return null;
    const label = customerFacingText(row.label, "").slice(0, 80);
    const detail = customerFacingText(row.detail, "").slice(0, 240);
    return label && detail ? { ...row, label, detail } : null;
  }).filter(Boolean);
  if (
    !identity
    || payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== MARKET_CONTROL_RISK_SCHEMA
    || payload?.state !== "available"
    || !MARKET_CONTROL_RISK_LEVELS.has(payload.level)
    || String(exact.chain || "").toLowerCase() !== identity.chain
    || exact.pool_address !== identity.pool_address
    || exact.token_address !== identity.token_address
  ) return null;
  const riskFactors = cleanEvidence(payload.risk_factors);
  const mitigatingChecks = cleanEvidence(payload.mitigating_checks);
  const measuredFacts = cleanEvidence(payload.measured_facts);
  const unmeasured = (Array.isArray(payload.unmeasured) ? payload.unmeasured : [])
    .slice(0, 8)
    .map((value) => customerFacingText(value, "").slice(0, 100))
    .filter(Boolean);
  if (riskFactors.length !== (payload.risk_factors || []).length || mitigatingChecks.length !== (payload.mitigating_checks || []).length) return null;
  return {
    ...payload,
    title: customerFacingText(payload.title, "Risk screen").slice(0, 100),
    summary: customerFacingText(payload.summary, "").slice(0, 440),
    risk_factors: riskFactors,
    mitigating_checks: mitigatingChecks,
    measured_facts: measuredFacts,
    unmeasured,
  };
}

function marketRiskBlocksAction(risk = state.marketControlRisk) {
  const identity = currentHolderIdentity();
  const exact = risk?.identity || {};
  return Boolean(
    identity
    && ["high", "severe"].includes(risk?.level)
    && String(exact.chain || "").toLowerCase() === identity.chain
    && exact.pool_address === identity.pool_address
    && exact.token_address === identity.token_address
  );
}

function renderSpotTicketRiskSummary(risk = state.marketControlRisk, { loading = false, unavailable = false } = {}) {
  const root = document.getElementById("terminalSpotRiskSummary");
  if (!root) return;
  if (!risk) {
    root.dataset.state = unavailable ? "unavailable" : "forming";
    const label = loading ? "Checking" : unavailable ? "Unavailable" : "Checking";
    const note = loading
      ? "Exact holder and control checks"
      : unavailable ? "No risk level was inferred" : "Open holders for current evidence";
    setText("terminalSpotRiskCompact", label);
    setText("terminalSpotRiskCompactNote", note);
    root.title = note;
    root.setAttribute("aria-label", `Market risk: ${label}. ${note}. Review holders and safety.`);
    return;
  }
  const label = {
    measured_low: "Measured low",
    watch: "Watch",
    elevated: "Elevated",
    high: "High",
    severe: "Severe",
  }[risk.level] || "Review";
  const lead = risk.risk_factors?.[0]?.label
    || (risk.mitigating_checks?.length ? `${risk.mitigating_checks.length} checks passed` : "Current exact-market evidence");
  root.dataset.state = risk.level || "forming";
  setText("terminalSpotRiskCompact", label);
  setText("terminalSpotRiskCompactNote", lead);
  root.title = lead;
  root.setAttribute("aria-label", `Market risk: ${label}. ${lead}. Review holders and safety.`);
}

function renderMarketRiskInterrupt(risk = state.marketControlRisk) {
  const root = document.getElementById("terminalRiskInterrupt");
  if (!root) return;
  const blocked = marketRiskBlocksAction(risk);
  root.hidden = !blocked;
  root.dataset.level = blocked ? risk.level : "forming";
  if (!blocked) {
    setText("terminalRiskInterruptTitle", "Review this market before trading");
    setText("terminalRiskInterruptSummary", "");
    setText("terminalRiskInterruptLevel", "Review");
    document.getElementById("terminalRiskInterruptFacts")?.replaceChildren();
    return;
  }
  const level = risk.level === "severe" ? "Severe" : "High";
  setText("terminalRiskInterruptEyebrow", "Pre-trade risk · exact pool");
  setText("terminalRiskInterruptTitle", risk.title || `${level} market-control risk`);
  setText("terminalRiskInterruptSummary", risk.summary || "Verified ownership or market-integrity evidence needs review before using this setup.");
  setText("terminalRiskInterruptLevel", level);
  const host = document.getElementById("terminalRiskInterruptFacts");
  if (host) {
    host.replaceChildren();
    const severityRank = { critical: 0, high: 1, elevated: 2, info: 3, positive: 4 };
    const factors = [...risk.risk_factors]
      .sort((left, right) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9))
      .slice(0, 3);
    for (const factor of factors) {
      const item = document.createElement("li");
      item.textContent = factor.label;
      host.append(item);
    }
  }
}

function setActiveMarketControlRisk(risk) {
  state.marketControlRisk = risk || null;
  renderMarketRiskInterrupt(state.marketControlRisk);
  renderSpotTicketRiskSummary(state.marketControlRisk);
  const blocked = marketRiskBlocksAction();
  const context = document.getElementById("terminalContextSection");
  const contextGuard = document.getElementById("terminalContextRiskGuard");
  if (context) context.dataset.riskBlocked = String(blocked);
  if (contextGuard) contextGuard.hidden = !blocked;
  if (blocked && context?.hidden === false) setTerminalPaneStatus("raven", "Paused", "negative");
  else if (context?.hidden === false) setTerminalPaneStatus("raven", "Current", "positive");
  if (blocked) {
    state.planOverlayEnabled = false;
    clearPlanMarkerInspection();
    syncPlanActionSurfaces(null);
    if (state.lane === "spot" && state.workspace) applySpotContextChart();
  }
  renderAlphaStack();
}

function renderRiskEvidenceList(host, rows) {
  if (!host) return;
  host.replaceChildren();
  for (const row of rows) {
    const item = document.createElement("li");
    item.dataset.severity = row.severity;
    const label = document.createElement("strong");
    label.textContent = row.label;
    const detail = document.createElement("span");
    detail.textContent = row.detail;
    item.append(label, detail);
    host.append(item);
  }
}

function renderMarketControlRisk(payload, { loading = false, unavailable = false } = {}) {
  const root = document.getElementById("terminalRiskScreen");
  if (!root) return;
  const identity = currentHolderIdentity();
  const risk = verifiedMarketControlRisk(payload, identity);
  setActiveMarketControlRisk(risk);
  renderSpotTicketRiskSummary(risk, { loading, unavailable });
  root.hidden = !identity;
  root.dataset.level = risk?.level || "forming";
  if (!identity) return;
  if (!risk) {
    setText("terminalRiskTitle", loading ? "Checking this exact market" : "Risk checks need a refresh");
    setText("terminalRiskLevel", loading ? "Checking" : "Not loaded");
    setTerminalPaneStatus("holders", loading ? "Checking" : unavailable ? "Unavailable" : "Not loaded", unavailable ? "warning" : "neutral");
    setText("terminalRiskSummary", loading
      ? "Reading pool-excluded holder concentration and exact token controls."
      : "Raven could not verify the current holder and control evidence. No risk factor was inferred.");
    for (const [sectionId, listId] of [["terminalRiskFactorsSection", "terminalRiskFactors"], ["terminalRiskChecksSection", "terminalRiskChecks"]]) {
      const section = document.getElementById(sectionId);
      if (section) section.hidden = true;
      document.getElementById(listId)?.replaceChildren();
    }
    const details = document.getElementById("terminalRiskUnknownsDetails");
    if (details) details.hidden = true;
    return;
  }
  root.dataset.level = risk.level;
  const riskLabel = {
    measured_low: "Measured low",
    watch: "Watch",
    elevated: "Elevated",
    high: "High risk",
    severe: "Severe risk",
  }[risk.level] || "Forming";
  setTerminalPaneStatus("holders", riskLabel, ["high", "severe"].includes(risk.level) ? "negative" : ["watch", "elevated"].includes(risk.level) ? "warning" : "positive");
  setText("terminalRiskTitle", risk.title);
  setText("terminalRiskLevel", riskLabel.replace(/ risk$/i, ""));
  setText("terminalRiskSummary", risk.summary);
  const riskSection = document.getElementById("terminalRiskFactorsSection");
  const checkSection = document.getElementById("terminalRiskChecksSection");
  if (riskSection) riskSection.hidden = risk.risk_factors.length === 0;
  if (checkSection) checkSection.hidden = risk.mitigating_checks.length === 0;
  renderRiskEvidenceList(document.getElementById("terminalRiskFactors"), risk.risk_factors);
  renderRiskEvidenceList(document.getElementById("terminalRiskChecks"), risk.mitigating_checks);
  const unknownDetails = document.getElementById("terminalRiskUnknownsDetails");
  const unknownList = document.getElementById("terminalRiskUnknowns");
  if (unknownDetails) unknownDetails.hidden = risk.unmeasured.length === 0;
  setText("terminalRiskUnknownCount", risk.unmeasured.length ? String(risk.unmeasured.length) : "");
  if (unknownList) {
    unknownList.replaceChildren();
    for (const value of risk.unmeasured) {
      const item = document.createElement("li");
      item.textContent = value;
      unknownList.append(item);
    }
  }
}

function renderVerifiedHolderConcentration(payload) {
  const root = document.getElementById("terminalHolderMap");
  const bar = document.getElementById("terminalHolderBar");
  const top10 = finite(payload?.summary?.top_10_wallet_supply_pct);
  if (!root || !bar) return false;
  if (top10 === null || top10 < 0 || top10 > 100) {
    root.hidden = false;
    setText("terminalHolderMapLabel", "Wallet concentration");
    setText("terminalHolderMapState", payload?.coverage?.pool_account_exclusion_state === "unresolved_pool_id"
      ? "Pool exclusion unresolved"
      : "Unavailable");
    for (const id of ["terminalHolderTop10Cell", "terminalHolderNext10Cell", "terminalHolderNext20Cell", "terminalHolderRestCell"]) {
      const cell = document.getElementById(id);
      if (cell) cell.hidden = true;
    }
    bar.replaceChildren();
    bar.setAttribute("aria-label", "Pool-excluded wallet concentration is unresolved for this market.");
    return false;
  }
  const rest = Math.max(0, 100 - top10);
  root.hidden = false;
  setText("terminalHolderMapLabel", "Wallet concentration · pool excluded");
  setText("terminalHolderTop10Label", "Top 10 wallets");
  setText("terminalHolderRestLabel", "All others");
  document.getElementById("terminalHolderNext10Cell").hidden = true;
  document.getElementById("terminalHolderNext20Cell").hidden = true;
  document.getElementById("terminalHolderTop10Cell").hidden = false;
  document.getElementById("terminalHolderRestCell").hidden = false;
  setText("terminalHolderTop10", profilePercent(top10));
  setText("terminalHolderRest", profilePercent(rest));
  setText("terminalHolderNext10", "");
  setText("terminalHolderNext20", "");
  bar.replaceChildren();
  for (const value of [top10, rest]) {
    const segment = document.createElement("span");
    segment.style.flex = `${value} 1 0`;
    bar.append(segment);
  }
  bar.setAttribute("aria-label", `Top 10 non-pool wallets hold ${profilePercent(top10)} of supply; all other accounts hold ${profilePercent(rest)}.`);
  const complete = payload.coverage?.complete_holder_census === true;
  const observedMs = Date.parse(String(payload.observed_at || ""));
  const freshness = Number.isFinite(observedMs)
    ? ` · updated ${durationLabel(Math.max(0, Math.round((Date.now() - observedMs) / 1_000)))}`
    : "";
  setText("terminalHolderMapState", `${complete ? "Complete census" : "Indexed holders"}${freshness}`);
  return true;
}

function renderHolderListMessage(message) {
  const host = document.getElementById("terminalHolderListRows");
  if (!host) return;
  const more = document.getElementById("terminalHolderListMore");
  if (more) more.hidden = true;
  host.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.className = "terminal-holder-list-message";
  paragraph.textContent = message;
  host.append(paragraph);
}

function currentHolderCountTrend() {
  const distribution = state.workspace?.state?.marketAnatomy?.holder_distribution || {};
  if (distribution.state !== "available" || distribution.scope !== "exact_token") return null;
  for (const [window, value] of [["1h", distribution.change_1h_pct], ["5m", distribution.change_5m_pct], ["24h", distribution.change_24h_pct]]) {
    const change = finite(value);
    if (change !== null) return { window, change };
  }
  return null;
}

function renderHolderCheck(payload) {
  const root = document.getElementById("terminalHolderCheck");
  if (!root) return;
  const largest = finite(payload?.summary?.largest_non_pool_wallet_supply_pct);
  const top3 = finite(payload?.summary?.top_3_wallet_supply_pct);
  const top10 = finite(payload?.summary?.top_10_wallet_supply_pct);
  const holderCount = finite(payload?.summary?.holder_count);
  const trend = currentHolderCountTrend();
  if ([largest, top3, top10].some((value) => value === null)) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  setText("terminalHolderLargest", profilePercent(largest));
  setText("terminalHolderTop3", profilePercent(top3));
  setText("terminalHolderCheckTop10", profilePercent(top10));
  setText("terminalHolderOwnerCount", holderCount === null ? "Partial scan" : compact(holderCount));
  setText("terminalHolderOwnerScope", payload.coverage?.complete_holder_census === true ? "Complete census" : "Indexed snapshot");
  setText("terminalHolderTrend", trend ? percent(trend.change) : "Not measured");
  setText("terminalHolderTrendScope", trend ? `${trend.window} · exact token holder count` : "Wallet balance history not inferred");
  const observedMs = Date.parse(String(payload.observed_at || ""));
  setText("terminalHolderCheckState", Number.isFinite(observedMs)
    ? `Updated ${durationLabel(Math.max(0, Math.round((Date.now() - observedMs) / 1_000)))}`
    : "Current snapshot");
  for (const button of root.querySelectorAll("button")) button.disabled = false;
}

function holderTradeEvidence(payload) {
  const projectIdentity = currentProjectIdentity();
  const holderIdentity = currentHolderIdentity();
  const trades = state.spotTradeCache.get(projectIdentity?.key)?.payload;
  if (!projectIdentity || !holderIdentity || !trades) return null;
  const normalize = (value) => holderIdentity.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase();
  const holders = new Map((Array.isArray(payload?.holders) ? payload.holders : [])
    .filter((row) => row.excluded_from_wallet_concentration !== true)
    .map((row) => [normalize(row.holder_address), row]));
  const byHolder = new Map();
  for (const trade of trades.trades) {
    const address = normalize(trade.trader_address);
    if (!address || !holders.has(address)) continue;
    const current = byHolder.get(address) || { tradeCount: 0, buyUsd: 0, sellUsd: 0 };
    current.tradeCount += 1;
    if (trade.side === "buy") current.buyUsd += Number(trade.volume_usd) || 0;
    else current.sellUsd += Number(trade.volume_usd) || 0;
    byHolder.set(address, current);
  }
  const totals = [...byHolder.values()].reduce((result, row) => ({
    tradeCount: result.tradeCount + row.tradeCount,
    buyUsd: result.buyUsd + row.buyUsd,
    sellUsd: result.sellUsd + row.sellUsd,
  }), { tradeCount: 0, buyUsd: 0, sellUsd: 0 });
  return {
    byHolder,
    holderCount: byHolder.size,
    returnedTradeCount: trades.trades.length,
    ...totals,
    netBuyUsd: totals.buyUsd - totals.sellUsd,
  };
}

function renderHolderTradeActivity(payload) {
  const root = document.getElementById("terminalHolderActivity");
  if (!root) return;
  const evidence = holderTradeEvidence(payload);
  root.hidden = !evidence;
  if (!evidence) return;
  const matched = evidence.holderCount;
  setText("terminalHolderActivityState", matched ? `${matched} seen` : "No overlap");
  setText("terminalHolderActivitySummary", matched
    ? `${matched} listed non-pool holder${matched === 1 ? "" : "s"} appeared in ${evidence.tradeCount} of ${evidence.returnedTradeCount} returned exact-pool swaps · sample net ${spotFlowLabel(evidence.netBuyUsd)}.`
    : `No listed non-pool holder appeared in the ${evidence.returnedTradeCount} returned exact-pool swaps. This bounded sample does not prove inactivity.`);
  root.dataset.tone = evidence.netBuyUsd > 0 ? "positive" : evidence.netBuyUsd < 0 ? "negative" : "neutral";
}

function holderRowsForFilter(payload, filter = state.holderListFilter) {
  const rows = Array.isArray(payload?.holders) ? payload.holders : [];
  const activeAddresses = holderTradeEvidence(payload)?.byHolder || new Map();
  const normalize = (value) => payload?.identity?.chain === "solana" ? String(value || "") : String(value || "").toLowerCase();
  if (filter === "wallets") return rows.filter((row) => row.excluded_from_wallet_concentration !== true);
  if (filter === "large") return rows.filter((row) => row.excluded_from_wallet_concentration !== true && finite(row.supply_share_pct) >= 1);
  if (filter === "active") return rows.filter((row) => row.excluded_from_wallet_concentration !== true && activeAddresses.has(normalize(row.holder_address)));
  if (filter === "pool") return rows.filter((row) => row.classification === "exact_pool_account");
  return rows;
}

function currentHolderListViewKey() {
  const identity = currentHolderIdentity();
  return identity ? `${identity.key}:${state.holderListFilter}` : "";
}

function expandCurrentHolderList() {
  const identity = currentHolderIdentity();
  const payload = state.holderListCache.get(identity?.key);
  if (!identity || !payload) return;
  state.holderListExpandedKey = currentHolderListViewKey();
  renderHolderListProjection(payload);
}

function setHolderListFilter(filter, { reveal = false } = {}) {
  if (!["all", "wallets", "large", "active", "pool"].includes(filter)) return;
  state.holderListFilter = filter;
  for (const button of document.querySelectorAll("[data-holder-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.holderFilter === filter));
  }
  const cached = state.holderListCache.get(currentHolderIdentity()?.key);
  if (cached) renderHolderListProjection(cached);
  if (filter === "active" && !state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload) void loadSpotTrades();
  if (!reveal) return;
  inspectTerminalPane("holders");
  const details = document.getElementById("terminalHolderList");
  if (details) details.open = true;
  afterTerminalPaneVisible(() => details?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  void loadHolderList();
}

function renderHolderListProjection(payload) {
  const host = document.getElementById("terminalHolderListRows");
  if (!host) return;
  const previousScrollTop = host.scrollTop;
  const holderActivityByAddress = holderTradeEvidence(payload)?.byHolder || new Map();
  for (const button of document.querySelectorAll("[data-holder-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.holderFilter === state.holderListFilter));
  }
  host.replaceChildren();
  const filteredRows = holderRowsForFilter(payload);
  const expanded = state.holderListExpandedKey === currentHolderListViewKey();
  const visibleRows = expanded ? filteredRows : filteredRows.slice(0, HOLDER_INITIAL_ROW_COUNT);
  for (const row of visibleRows) {
    const item = document.createElement("article");
    item.className = "terminal-holder-row";
    item.dataset.classification = row.classification;
    const rank = document.createElement("span");
    rank.className = "terminal-holder-rank";
    rank.textContent = `#${row.rank}`;
    const identity = document.createElement("div");
    const address = document.createElement("a");
    address.href = holderExplorerUrl(payload.identity.chain, row.holder_address);
    address.target = "_blank";
    address.rel = "noopener noreferrer nofollow";
    address.textContent = compactHolderAddress(row.holder_address);
    address.title = row.holder_address;
    const classification = document.createElement("small");
    const holderKey = payload.identity.chain === "solana" ? row.holder_address : row.holder_address.toLowerCase();
    const holderActivity = holderActivityByAddress.get(holderKey);
    const classificationLabel = row.classification === "exact_pool_account"
      ? "Exact pool account · excluded from wallet concentration"
      : row.classification === "contract"
        ? "Contract account"
      : row.classification === "owner"
        ? row.token_account_count > 1 ? `${row.token_account_count} top token accounts · same owner` : "On-chain owner"
        : "Token account · owner unresolved";
    classification.textContent = holderActivity
      ? `${classificationLabel} · ${holderActivity.tradeCount} returned swaps · net ${spotFlowLabel(holderActivity.buyUsd - holderActivity.sellUsd)}`
      : classificationLabel;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "terminal-copy-icon terminal-holder-copy";
    setCopyButtonState(copy, "ready", {
      readyLabel: `Copy holder ${row.rank} address`,
      copiedLabel: `Holder ${row.rank} address copied`,
      failedLabel: `Holder ${row.rank} address could not be copied`,
    });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(row.holder_address);
        setCopyButtonState(copy, "copied", {
          readyLabel: `Copy holder ${row.rank} address`,
          copiedLabel: `Holder ${row.rank} address copied`,
          failedLabel: `Holder ${row.rank} address could not be copied`,
        });
        setTimeout(() => setCopyButtonState(copy, "ready", {
          readyLabel: `Copy holder ${row.rank} address`,
          copiedLabel: `Holder ${row.rank} address copied`,
          failedLabel: `Holder ${row.rank} address could not be copied`,
        }), 1_200);
      } catch {
        setCopyButtonState(copy, "failed", {
          readyLabel: `Copy holder ${row.rank} address`,
          copiedLabel: `Holder ${row.rank} address copied`,
          failedLabel: `Holder ${row.rank} address could not be copied`,
        });
      }
    });
    const addressLine = document.createElement("div");
    addressLine.className = "terminal-holder-address-line";
    addressLine.append(address, copy);
    identity.className = "terminal-holder-identity";
    identity.append(addressLine, classification);
    const balance = document.createElement("strong");
    balance.textContent = holderBalanceLabel(row.balance);
    balance.title = row.balance;
    const share = document.createElement("strong");
    share.textContent = profilePercent(row.supply_share_pct) || "—";
    item.append(rank, identity, balance, share);
    host.append(item);
  }
  if (!visibleRows.length) renderHolderListMessage(state.holderListFilter === "pool"
    ? "The exact pool account is not present in the returned top-holder rows."
    : "No returned holder matches this filter.");
  const more = document.getElementById("terminalHolderListMore");
  const remainingRows = Math.max(0, filteredRows.length - visibleRows.length);
  if (more) {
    more.hidden = remainingRows === 0;
    more.textContent = remainingRows ? `Show ${remainingRows} more` : "";
  }
  host.scrollTop = Math.min(previousScrollTop, Math.max(0, host.scrollHeight - host.clientHeight));
  const complete = payload.coverage.complete_holder_census === true;
  const indexedOwners = Number(payload.coverage.total_owner_rows);
  const totalOwners = Number.isInteger(indexedOwners) && indexedOwners >= payload.holders.length ? indexedOwners : null;
  const filterLabel = { wallets: "wallets", large: "1%+ wallets", active: "active holders", pool: "pool accounts" }[state.holderListFilter];
  setText("terminalHolderListState", filterLabel
    ? filteredRows.length > visibleRows.length ? `${visibleRows.length} of ${filteredRows.length} ${filterLabel}` : `${visibleRows.length} ${filterLabel}`
    : totalOwners !== null ? `${visibleRows.length} of ${compact(totalOwners)} owners` : filteredRows.length > visibleRows.length ? `${visibleRows.length} of ${filteredRows.length} indexed` : `${visibleRows.length} owners`);
  const observed = timestamp(payload.observed_at);
  const source = customerFacingText(payload?.source?.label, "On-chain source");
  setText("terminalHolderListNote", complete
    ? `${compact(totalOwners)} owners · ${source} · ${observed}.`
    : `${payload.holders.length} indexed${totalOwners !== null ? ` of ${compact(totalOwners)}` : ""} · ${source} · ${observed}.`);
  renderVerifiedHolderConcentration(payload);
  renderHolderCheck(payload);
  renderHolderTradeActivity(payload);
  renderMarketControlRisk(payload.risk_screen);
  const trades = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
  if (trades) renderActiveTraders(trades);
  if (state.lane === "spot" && (state.context?.spot_identity_validated || state.context?.spot_plan_identity_validated)) refreshSpotStructurePlan();
}

function renderHolderListSurface() {
  const details = document.getElementById("terminalHolderList");
  if (!details) return;
  const identity = currentHolderIdentity();
  details.hidden = !identity;
  if (!identity) {
    details.dataset.identityKey = "";
    const holderCheck = document.getElementById("terminalHolderCheck");
    if (holderCheck) holderCheck.hidden = true;
    renderMarketControlRisk(null);
    return;
  }
  const changed = details.dataset.identityKey !== identity.key;
  details.dataset.identityKey = identity.key;
  const cached = state.holderListCache.get(identity.key);
  if (cached) renderHolderListProjection(cached);
  else if (state.holderListLoadingKey === identity.key) {
    document.getElementById("terminalHolderCheck").hidden = true;
    setText("terminalHolderListState", "Loading");
    setText("terminalHolderListNote", "Loading current holders.");
    renderHolderListMessage("Loading top holders…");
    renderMarketControlRisk(null, { loading: true });
  } else {
    document.getElementById("terminalHolderCheck").hidden = true;
    setText("terminalHolderListState", "View list");
    setText("terminalHolderListNote", "Current holders for this token.");
    renderHolderListMessage("Open to load holders.");
    renderMarketControlRisk(null, { loading: false });
  }
  const holderPaneActive = !terminalUsesPaneNavigation()
    || document.querySelector(".terminal-live")?.dataset.terminalPane === "holders";
  if (changed && details.open && holderPaneActive && !cached) void loadHolderList();
}

async function loadHolderList() {
  const identity = currentHolderIdentity();
  if (!identity || state.holderListLoadingKey === identity.key) return;
  const cached = state.holderListCache.get(identity.key);
  if (cached) {
    renderHolderListProjection(cached);
    return;
  }
  const generation = ++state.holderListGeneration;
  state.holderListLoadingKey = identity.key;
  renderHolderListSurface();
  const params = new URLSearchParams({
    chain: identity.chain,
    pair_address: identity.pool_address,
    token_address: identity.token_address,
  });
  if (identity.quote_address) params.set("quote_address", identity.quote_address);
  try {
    const { response, payload } = await fetchJson(`/api/onchain/holders?${params.toString()}`);
    const verified = response.ok ? verifiedHolderProjection(payload, identity) : null;
    // A market can finish resolving while this request is in flight. The
    // response is still valid for the exact identity that requested it, so
    // retain verified evidence even when a newer selection owns the screen.
    // Rendering remains restricted to the current exact identity below.
    if (verified) {
      state.holderListCache.set(identity.key, verified);
      if (state.holderListCache.size > 24) state.holderListCache.delete(state.holderListCache.keys().next().value);
      if (currentHolderIdentity()?.key === identity.key) renderHolderListProjection(verified);
      return;
    }
    if (generation !== state.holderListGeneration || currentHolderIdentity()?.key !== identity.key) return;
    if (!verified) {
      setText("terminalHolderListState", "Unavailable");
      const providerMissing = ["holder_source_disabled", "holder_source_misconfigured"].includes(payload?.error);
      setText("terminalHolderListNote", providerMissing ? "Holder index not connected." : "Holders unavailable for this market.");
      renderHolderListMessage(providerMissing ? "Holder index not connected." : "No unverified or substitute wallets shown.");
      renderMarketControlRisk(null, { unavailable: true });
      return;
    }
  } catch {
    if (generation !== state.holderListGeneration || currentHolderIdentity()?.key !== identity.key) return;
    setText("terminalHolderListState", "Unavailable");
    setText("terminalHolderListNote", "Holders unavailable for this market.");
    renderHolderListMessage("No substitute wallets shown.");
    renderMarketControlRisk(null, { unavailable: true });
  } finally {
    if (state.holderListLoadingKey === identity.key) state.holderListLoadingKey = "";
    const current = currentHolderIdentity();
    const details = document.getElementById("terminalHolderList");
    const holderPaneActive = !terminalUsesPaneNavigation()
      || document.querySelector(".terminal-live")?.dataset.terminalPane === "holders";
    if (
      current
      && current.key !== identity.key
      && details?.open
      && holderPaneActive
      && !state.holderListCache.has(current.key)
    ) queueMicrotask(() => void loadHolderList());
  }
}

const SPOT_TRADE_SCHEMA = "ravenos.onchain_pool_trades.v1";
const SPOT_TRADE_LINK_HOSTS = new Set(["solscan.io", "basescan.org", "bscscan.com", "etherscan.io", "robinhoodchain.blockscout.com"]);

function clearSpotTradeRefresh() {
  clearTimeout(state.spotTradeRefreshTimer);
  state.spotTradeRefreshTimer = null;
}

function spotTradeSurfaceActive() {
  if (document.hidden || state.lane !== "spot" || !currentProjectIdentity()) return false;
  if (!terminalUsesPaneNavigation()) return true;
  return ["chart", "activity", "trade"].includes(document.querySelector(".terminal-live")?.dataset.terminalPane || "chart");
}

function scheduleSpotTradeRefresh() {
  clearSpotTradeRefresh();
  if (!spotTradeSurfaceActive()) return;
  state.spotTradeRefreshTimer = setTimeout(() => void loadSpotTrades({ force: true }), SPOT_TRADE_REFRESH_MS);
}

function safeSpotTradeLink(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && SPOT_TRADE_LINK_HOSTS.has(url.hostname) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function spotTradeAddressValid(chain, value) {
  const address = String(value || "");
  return chain === "solana"
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
    : /^0x[a-f0-9]{40}$/.test(address);
}

function verifiedSpotTradeProjection(payload, identity = currentProjectIdentity()) {
  if (
    !identity
    || payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== SPOT_TRADE_SCHEMA
    || payload?.state !== "available"
    || String(payload?.identity?.chain || "").toLowerCase() !== identity.chain
    || !sameSelectedAddress(identity.chain, payload?.identity?.pool_address, identity.poolAddress)
    || !sameSelectedAddress(identity.chain, payload?.identity?.token_address, identity.tokenAddress)
    || !sameSelectedAddress(identity.chain, payload?.identity?.quote_token_address, identity.quoteAddress)
    || !Array.isArray(payload?.trades)
    || payload.trades.length > 120
    || !Array.isArray(payload?.active_traders)
    || payload.active_traders.length > 24
    || payload?.execution_boundary?.signing_available !== false
    || payload?.execution_boundary?.submission_available !== false
  ) return null;
  const trades = payload.trades.filter((row) => (
    typeof row?.event_id === "string"
    && row.event_id.length > 0
    && row.event_id.length <= 180
    && ["buy", "sell"].includes(row?.side)
    && Number.isFinite(Date.parse(String(row?.observed_at || "")))
    && finite(row?.price_usd) !== null
    && finite(row.price_usd) > 0
    && finite(row.price_usd) <= 1_000_000_000_000
    && finite(row?.volume_usd) !== null
    && finite(row.volume_usd) > 0
    && ["standard", "largest_10_pct"].includes(row?.sample_size_tier)
    && (!row.trader_address || spotTradeAddressValid(identity.chain, row.trader_address))
    && (!row.trader_explorer_url || Boolean(safeSpotTradeLink(row.trader_explorer_url)))
    && (!row.transaction_explorer_url || Boolean(safeSpotTradeLink(row.transaction_explorer_url)))
  ));
  const traders = payload.active_traders.filter((row) => (
    Number.isInteger(row?.rank)
    && row.rank >= 1
    && spotTradeAddressValid(identity.chain, row?.trader_address)
    && Number.isInteger(row?.trade_count)
    && row.trade_count >= 1
    && ["repeat", "single_observation"].includes(row?.recurrence)
    && ["buy_dominant", "sell_dominant", "mixed"].includes(row?.direction)
    && (!row.explorer_url || Boolean(safeSpotTradeLink(row.explorer_url)))
  ));
  if (trades.length !== payload.trades.length || traders.length !== payload.active_traders.length) return null;
  return { ...payload, trades, active_traders: traders };
}

function renderSpotTradeMessage(message) {
  const host = document.getElementById("terminalSpotTradeRows");
  if (!host) return;
  host.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  host.append(paragraph);
}

function spotFlowLabel(value) {
  const amount = finite(value);
  if (amount === null) return "—";
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${compact(Math.abs(amount), { currency: true })}`;
}

function renderSpotTradeSummary(payload) {
  const fiveMinute = payload?.summary?.windows?.m5 || {};
  const oneHour = payload?.summary?.windows?.h1 || {};
  const current = Number(fiveMinute.trade_count || 0) > 0 ? fiveMinute : oneHour;
  const windowLabel = current === fiveMinute ? "5m" : "1h";
  setText("terminalSpotFlow1Label", `${windowLabel} sample`);
  setText("terminalSpotFlow2Label", "Sample buy share");
  setText("terminalSpotFlow3Label", "Sample net flow");
  setText("terminalSpotFlow1", compact(current.trade_count));
  setText("terminalSpotFlow2", profilePercent(current.buy_volume_share_pct) || "—");
  setText("terminalSpotFlow3", spotFlowLabel(current.net_buy_volume_usd));
  const repeatShare = profilePercent(payload?.summary?.repeat_trader_volume_share_pct);
  setText("terminalSpotFlow4", `${compact(payload?.summary?.repeat_trader_count)}${repeatShare ? ` · ${repeatShare} flow` : ""}`);
  const netFlow = finite(current.net_buy_volume_usd);
  const flowNode = document.getElementById("terminalSpotFlow3");
  if (flowNode) flowNode.dataset.tone = netFlow === null || netFlow === 0 ? "neutral" : netFlow > 0 ? "positive" : "negative";
  document.getElementById("terminalSpotFlow").hidden = false;
}

function filteredSpotTrades(payload) {
  const repeatAddresses = new Set(payload.active_traders.filter((row) => row.recurrence === "repeat").map((row) => row.trader_address));
  return payload.trades.filter((row) => (
    state.spotTradeFilter === "all"
    || row.side === state.spotTradeFilter
    || (state.spotTradeFilter === "large" && row.sample_size_tier === "largest_10_pct")
    || (state.spotTradeFilter === "repeat" && repeatAddresses.has(row.trader_address))
  )).slice(0, SPOT_TRADE_RENDER_LIMIT);
}

function appendSpotTradeLink(host, { href, label, title = "" } = {}) {
  const safeHref = safeSpotTradeLink(href);
  if (!safeHref) return null;
  const anchor = document.createElement("a");
  anchor.href = safeHref;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer nofollow";
  anchor.textContent = label;
  if (title) anchor.title = title;
  host.append(anchor);
  return anchor;
}

function renderSpotTradeRows(payload) {
  const host = document.getElementById("terminalSpotTradeRows");
  if (!host) return;
  host.replaceChildren();
  const rows = filteredSpotTrades(payload);
  if (!rows.length) {
    renderSpotTradeMessage("No swaps match this filter in the current exact-pool sample.");
    return;
  }
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "terminal-spot-trade-row";
    item.dataset.sizeTier = row.sample_size_tier;
    const observed = document.createElement("time");
    observed.dateTime = row.observed_at;
    observed.textContent = durationLabel((Date.now() - Date.parse(row.observed_at)) / 1_000);
    observed.title = timestamp(row.observed_at);
    const side = document.createElement("span");
    side.className = "terminal-spot-side";
    side.dataset.side = row.side;
    side.textContent = row.side;
    const volume = document.createElement("strong");
    volume.textContent = compact(row.volume_usd, { currency: true });
    volume.title = `$${Number(row.volume_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    const price = document.createElement("span");
    price.textContent = formatPrice(row.price_usd);
    const trader = document.createElement("div");
    trader.className = "terminal-spot-trader";
    if (row.trader_address) {
      appendSpotTradeLink(trader, { href: row.trader_explorer_url, label: compactHolderAddress(row.trader_address), title: row.trader_address });
    } else {
      const unavailable = document.createElement("span");
      unavailable.textContent = "Not listed";
      trader.append(unavailable);
    }
    appendSpotTradeLink(trader, { href: row.transaction_explorer_url, label: "Tx", title: "Open public transaction" });
    item.append(observed, side, volume, price, trader);
    host.append(item);
  }
}

function renderActiveWalletMessage(message) {
  const host = document.getElementById("terminalActiveTraderRows");
  if (!host) return;
  host.replaceChildren();
  const note = document.createElement("p");
  note.textContent = message;
  host.append(note);
}

function activeWalletHolderMap() {
  const identity = currentProjectIdentity();
  const payload = state.holderListCache.get(currentHolderIdentity()?.key);
  if (!identity || !payload || !Array.isArray(payload.holders)) return null;
  const normalize = (value) => identity.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase();
  return new Map(payload.holders
    .filter((row) => row?.excluded_from_wallet_concentration !== true && row?.holder_address)
    .map((row) => [normalize(row.holder_address), row]));
}

function filteredActiveWallets(payload, holderMap = activeWalletHolderMap()) {
  const rows = Array.isArray(payload?.active_traders) ? payload.active_traders : [];
  const identity = currentProjectIdentity();
  const normalize = (value) => identity?.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase();
  if (state.spotWalletFilter === "repeat") return rows.filter((row) => row.recurrence === "repeat");
  if (state.spotWalletFilter === "buy") return rows.filter((row) => row.direction === "buy_dominant");
  if (state.spotWalletFilter === "sell") return rows.filter((row) => row.direction === "sell_dominant");
  if (state.spotWalletFilter === "holders") return holderMap ? rows.filter((row) => holderMap.has(normalize(row.trader_address))) : [];
  return rows;
}

function renderActiveWalletFilters(payload, holderMap = activeWalletHolderMap()) {
  const rows = Array.isArray(payload?.active_traders) ? payload.active_traders : [];
  const identity = currentProjectIdentity();
  const normalize = (value) => identity?.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase();
  const counts = {
    all: rows.length,
    repeat: rows.filter((row) => row.recurrence === "repeat").length,
    buy: rows.filter((row) => row.direction === "buy_dominant").length,
    sell: rows.filter((row) => row.direction === "sell_dominant").length,
    holders: holderMap ? rows.filter((row) => holderMap.has(normalize(row.trader_address))).length : 0,
  };
  const holderButton = document.querySelector('[data-active-wallet-filter="holders"]');
  if (holderButton) holderButton.hidden = !holderMap;
  if (!holderMap && state.spotWalletFilter === "holders") state.spotWalletFilter = "all";
  setText("terminalActiveWalletAllCount", counts.all);
  setText("terminalActiveWalletRepeatCount", counts.repeat);
  setText("terminalActiveWalletBuyCount", counts.buy);
  setText("terminalActiveWalletSellCount", counts.sell);
  setText("terminalActiveWalletHolderCount", counts.holders);
  for (const button of document.querySelectorAll("[data-active-wallet-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.activeWalletFilter === state.spotWalletFilter));
  }
  return counts;
}

function renderActiveTraders(payload) {
  const host = document.getElementById("terminalActiveTraderRows");
  if (!host) return;
  host.replaceChildren();
  const holderMap = activeWalletHolderMap();
  renderActiveWalletFilters(payload, holderMap);
  const rows = filteredActiveWallets(payload, holderMap);
  if (!payload.active_traders.length) {
    renderActiveWalletMessage("No wallet addresses were available in this returned exact-pool sample.");
    setText("terminalActiveTraderState", "No wallet rows");
    return;
  }
  if (!rows.length) {
    const emptyMessages = {
      repeat: "No repeat wallet appears in this returned exact-pool sample.",
      buy: "No buy-heavy wallet appears in this returned exact-pool sample.",
      sell: "No sell-heavy wallet appears in this returned exact-pool sample.",
      holders: "No active wallet in this returned sample also appears in the current listed-holder rows.",
    };
    renderActiveWalletMessage(emptyMessages[state.spotWalletFilter] || "No wallet matches this filter in the returned exact-pool sample.");
    setText("terminalActiveTraderState", "No matches");
    return;
  }
  const identity = currentProjectIdentity();
  const normalize = (value) => identity?.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase();
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "terminal-active-trader-row";
    const rank = document.createElement("span");
    rank.textContent = `#${row.rank}`;
    const identity = document.createElement("div");
    identity.className = "terminal-active-wallet-identity";
    appendSpotTradeLink(identity, { href: row.explorer_url, label: compactHolderAddress(row.trader_address), title: row.trader_address });
    const description = document.createElement("small");
    const direction = row.direction === "buy_dominant" ? "Buy-heavy" : row.direction === "sell_dominant" ? "Sell-heavy" : "Mixed flow";
    const lastSeenAge = Math.max(0, (Date.now() - Date.parse(row.last_seen_at)) / 1_000);
    const listedHolder = holderMap?.get(normalize(row.trader_address));
    const listedLabel = listedHolder
      ? `Listed holder #${listedHolder.rank}${profilePercent(listedHolder.supply_share_pct) ? ` · ${profilePercent(listedHolder.supply_share_pct)} supply` : ""} · `
      : "";
    description.textContent = `${listedLabel}${row.recurrence === "repeat" ? "Repeat wallet" : "Seen once"} · ${direction} · last seen ${durationLabel(lastSeenAge)}`;
    identity.append(description);
    const metrics = document.createElement("dl");
    metrics.className = "terminal-active-wallet-metrics";
    const metricValues = [
      ["Swaps", compact(row.trade_count)],
      ["Buy / sell", `${compact(row.buy_count)} / ${compact(row.sell_count)}`],
      ["Sample volume", compact(row.total_volume_usd, { currency: true })],
      ["Sample net", spotFlowLabel(row.net_buy_volume_usd), finite(row.net_buy_volume_usd)],
    ];
    for (const [label, value, toneValue] of metricValues) {
      const metric = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      if (toneValue !== undefined) detail.dataset.tone = toneValue === null || toneValue === 0 ? "neutral" : toneValue > 0 ? "positive" : "negative";
      metric.append(term, detail);
      metrics.append(metric);
    }
    item.append(rank, identity, metrics);
    host.append(item);
  }
  const filterLabels = { repeat: "repeat", buy: "buy-heavy", sell: "sell-heavy", holders: "listed holders" };
  setText("terminalActiveTraderState", state.spotWalletFilter === "all" ? `${rows.length} wallets` : `${rows.length} ${filterLabels[state.spotWalletFilter]}`);
  setText("terminalActiveTraderNote", "Public transaction senders ranked by returned volume for this exact pool. Repeat does not imply related ownership, skill, or profitability; this is not complete wallet history.");
}

function renderSpotTradeProjection(payload) {
  const tapeUpdate = state.workspace?.ingestExactPoolTrades?.(payload);
  // The workspace owns the exact-pool clock and emits the one canonical price
  // event used by both the forming candle and the header. A rejected or older
  // tape response must never update the header independently.
  if (tapeUpdate?.accepted !== true) setText("terminalSpotActivityState", "Refreshing");
  renderSpotTradeSummary(payload);
  renderSpotTradeRows(payload);
  if (state.spotActivityView === "wallets") renderActiveTraders(payload);
  setText("terminalActivityTradeCount", `${payload.trades.length} swaps`);
  setText("terminalActivityWalletCount", `${payload.active_traders.length} wallet${payload.active_traders.length === 1 ? "" : "s"}`);
  const latestAge = Math.max(0, (Date.now() - Date.parse(payload?.freshness?.latest_trade_at || payload.observed_at)) / 1_000);
  setText("terminalSpotActivityState", `${payload.freshness.state === "live" ? "Live" : "Recent"} · ${durationLabel(latestAge)}`);
  setTerminalPaneStatus("activity", `${payload.trades.length} swaps`, payload.trades.length ? "positive" : "neutral");
  setText("terminalSpotTradeCoverage", `${payload.trades.length} recent swaps · exact pool · bounded 24h sample`);
  const credit = document.getElementById("terminalSpotTradeCredit");
  const creditUrl = String(payload?.source?.attribution_url || "");
  if (credit && creditUrl === "https://www.coingecko.com/en/api") {
    credit.href = creditUrl;
    credit.textContent = payload?.source?.label || "Data provided by CoinGecko";
  }
  for (const button of document.querySelectorAll("[data-spot-trade-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.spotTradeFilter === state.spotTradeFilter));
  }
  const holderSurface = document.getElementById("terminalHolderList");
  const holderPaneActive = !terminalUsesPaneNavigation() || document.querySelector(".terminal-live")?.dataset.terminalPane === "holders";
  const holders = state.holderListCache.get(currentHolderIdentity()?.key);
  if (holders && holderSurface?.open && holderPaneActive) renderHolderListProjection(holders);
}

function renderSpotTradeSurface() {
  const section = document.getElementById("terminalSpotActivitySection");
  if (!section) return;
  const identity = currentProjectIdentity();
  section.hidden = !identity;
  if (!identity) return;
  const entry = state.spotTradeCache.get(identity.key);
  if (entry?.payload) {
    renderSpotTradeProjection(entry.payload);
    return;
  }
  document.getElementById("terminalSpotFlow").hidden = true;
  setText("terminalActivityTradeCount", "Current sample");
  setText("terminalActivityWalletCount", "Returned sample");
  setText("terminalSpotActivityState", state.spotTradeLoadingKey === identity.key ? "Loading" : "Ready to load");
  setTerminalPaneStatus("activity", state.spotTradeLoadingKey === identity.key ? "Loading" : "Load");
  setText("terminalActiveTraderState", "Waiting");
  renderActiveWalletMessage(state.spotTradeLoadingKey === identity.key
    ? "Loading active wallets from the returned exact-pool sample…"
    : "Open Active wallets to load the current exact-pool sample.");
  renderSpotTradeMessage(state.spotTradeLoadingKey === identity.key
    ? "Loading recent exact-pool swaps…"
    : "Open Txns to load exact-pool activity.");
}

async function loadSpotTrades({ force = false } = {}) {
  const identity = currentProjectIdentity();
  if (!identity || state.spotTradeLoadingKey === identity.key) return;
  const cached = state.spotTradeCache.get(identity.key);
  if (!force && cached?.payload && Date.now() - cached.loadedAt < SPOT_TRADE_REFRESH_MS) {
    renderSpotTradeProjection(cached.payload);
    scheduleSpotTradeRefresh();
    return;
  }
  const generation = ++state.spotTradeGeneration;
  state.spotTradeLoadingKey = identity.key;
  if (!cached?.payload) renderSpotTradeSurface();
  else {
    setText("terminalSpotActivityState", "Refreshing");
    setTerminalPaneStatus("activity", "Refreshing");
  }
  const params = new URLSearchParams({
    chain: identity.chain,
    pair_address: identity.poolAddress,
    token_address: identity.tokenAddress,
    quote_address: identity.quoteAddress,
  });
  try {
    const { response, payload } = await fetchJson(`/api/onchain/trades?${params.toString()}`);
    if (generation !== state.spotTradeGeneration || currentProjectIdentity()?.key !== identity.key) return;
    const verified = response.ok ? verifiedSpotTradeProjection(payload, identity) : null;
    if (!verified) {
      setText("terminalSpotActivityState", "Unavailable");
      setTerminalPaneStatus("activity", "Unavailable", "warning");
      document.getElementById("terminalSpotFlow").hidden = true;
      setText("terminalActiveTraderState", "Unavailable");
      renderActiveWalletMessage("Active wallets aren’t available for this exact pool yet. No token-wide or similarly named market was substituted.");
      renderSpotTradeMessage("Recent exact-pool swaps aren’t available for this market yet. No token-wide or similarly named market was substituted.");
      return;
    }
    state.spotTradeCache.set(identity.key, { payload: verified, loadedAt: Date.now() });
    if (state.spotTradeCache.size > 24) state.spotTradeCache.delete(state.spotTradeCache.keys().next().value);
    renderSpotTradeProjection(verified);
  } catch {
    if (generation !== state.spotTradeGeneration || currentProjectIdentity()?.key !== identity.key) return;
    setText("terminalSpotActivityState", "Unavailable");
    setTerminalPaneStatus("activity", "Unavailable", "warning");
    document.getElementById("terminalSpotFlow").hidden = true;
    setText("terminalActiveTraderState", "Unavailable");
    renderActiveWalletMessage("Active wallets couldn’t be loaded for this exact pool. No alternate market was used.");
    renderSpotTradeMessage("Recent exact-pool swaps couldn’t be loaded. No alternate market was used.");
  } finally {
    if (state.spotTradeLoadingKey === identity.key) state.spotTradeLoadingKey = "";
    scheduleSpotTradeRefresh();
  }
}

function setSpotTradeFilter(filter) {
  if (!new Set(["all", "buy", "sell", "large", "repeat"]).has(filter)) return;
  state.spotTradeFilter = filter;
  const payload = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
  if (payload) renderSpotTradeProjection(payload);
}

function syncSpotActivityView({ updateUrl = false } = {}) {
  const view = SPOT_ACTIVITY_VIEWS.has(state.spotActivityView) ? state.spotActivityView : "trades";
  state.spotActivityView = view;
  const trades = document.getElementById("terminalSpotTradesView");
  const wallets = document.getElementById("terminalActiveTraders");
  if (trades) trades.hidden = view !== "trades";
  if (wallets) wallets.hidden = view !== "wallets";
  for (const button of document.querySelectorAll("[data-spot-activity-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.spotActivityView === view));
  }
  if (updateUrl && (document.querySelector(".terminal-live")?.dataset.terminalPane || "chart") === "activity") {
    syncTerminalPaneUrl("activity");
  }
}

function setSpotActivityView(view) {
  if (!SPOT_ACTIVITY_VIEWS.has(view)) return;
  state.spotActivityView = view;
  syncSpotActivityView({ updateUrl: true });
  const payload = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
  if (payload) renderSpotTradeProjection(payload);
  else void loadSpotTrades();
  if (view === "wallets") {
    void loadHolderList().then(() => {
      const currentPayload = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
      if (currentPayload && state.spotActivityView === "wallets") renderActiveTraders(currentPayload);
    });
  }
}

function setSpotWalletFilter(filter) {
  if (!new Set(["all", "repeat", "buy", "sell", "holders"]).has(filter)) return;
  if (filter === "holders" && !activeWalletHolderMap()) return;
  state.spotWalletFilter = filter;
  const payload = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
  if (payload) renderActiveTraders(payload);
}

function setInstrumentImage(value) {
  const image = document.getElementById("terminalInstrumentImage");
  const root = image?.closest(".terminal-instrument");
  if (!image || !root) return;
  let source = null;
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol === "https:"
      && ["assets.geckoterminal.com", "coin-images.coingecko.com", "assets.coingecko.com", "cdn.dexscreener.com"].includes(url.hostname)
    ) source = url.toString();
  } catch {
    source = null;
  }
  image.hidden = !source;
  root.classList.toggle("has-image", Boolean(source));
  if (source) {
    image.onerror = () => setInstrumentImage(null);
    image.src = source;
  }
  else image.removeAttribute("src");
}

function renderSpotMarketProfile(anatomy = {}) {
  renderHolderListSurface();
  const distributionRoot = document.getElementById("terminalHolderMap");
  const bar = document.getElementById("terminalHolderBar");
  const facts = document.getElementById("terminalProfileFacts");
  const chips = document.getElementById("terminalProfileChips");
  const credit = document.getElementById("terminalProfileCredit");
  const projectProfile = renderProjectLinks(anatomy?.market_profile);
  const distribution = anatomy?.holder_distribution || {};
  const parts = [
    finite(distribution.top_10_pct),
    finite(distribution.next_10_pct),
    finite(distribution.next_20_pct),
    finite(distribution.rest_pct),
  ];
  const distributionTotal = parts.every((value) => value !== null)
    ? parts.reduce((sum, value) => sum + value, 0)
    : null;
  const distributionVisible = distribution.state === "available"
    && distribution.exact_pool_accounts_excluded === true
    && distributionTotal !== null
    && distributionTotal >= 99
    && distributionTotal <= 101;

  if (distributionRoot) distributionRoot.hidden = !distributionVisible;
  setText("terminalHolderMapLabel", "Wallet concentration · pool excluded");
  setText("terminalHolderTop10Label", "Top 10 wallets");
  setText("terminalHolderRestLabel", "All others");
  document.getElementById("terminalHolderNext10Cell").hidden = false;
  document.getElementById("terminalHolderNext20Cell").hidden = false;
  if (bar) {
    bar.replaceChildren();
    if (distributionVisible) {
      for (const value of parts) {
        const segment = document.createElement("span");
        segment.style.flex = `${value} 1 0`;
        bar.append(segment);
      }
      bar.setAttribute(
        "aria-label",
        `Holder distribution: top 10 ${profilePercent(parts[0])}, ranks 11 to 20 ${profilePercent(parts[1])}, ranks 21 to 40 ${profilePercent(parts[2])}, remaining holders ${profilePercent(parts[3])}.`,
      );
    }
  }
  setText("terminalHolderTop10", distributionVisible ? profilePercent(parts[0]) : "", "");
  setText("terminalHolderNext10", distributionVisible ? profilePercent(parts[1]) : "", "");
  setText("terminalHolderNext20", distributionVisible ? profilePercent(parts[2]) : "", "");
  setText("terminalHolderRest", distributionVisible ? profilePercent(parts[3]) : "", "");
  const holderCount = finite(distribution.holder_count);
  const holderObservedMs = Date.parse(String(distribution.observed_at || ""));
  const holderAgeSeconds = Number.isFinite(holderObservedMs)
    ? Math.max(0, Math.round((Date.now() - holderObservedMs) / 1_000))
    : null;
  setText(
    "terminalHolderMapState",
    distributionVisible
      ? `${holderCount === null ? "" : `${compact(holderCount)} holders · `}${holderAgeSeconds === null ? timestamp(distribution.observed_at) : `updated ${durationLabel(holderAgeSeconds)}`}`
      : "",
    "",
  );
  const holderState = document.getElementById("terminalHolderMapState");
  if (holderState) holderState.title = distributionVisible ? timestamp(distribution.observed_at) : "";

  if (chips) chips.replaceChildren();
  const controls = projectProfile?.token_controls || {};
  const profileImage = projectProfile?.token?.image_url;
  if (profileImage) setInstrumentImage(profileImage);
  const chipRows = [];
  if (controls.mint_authority === "disabled") chipRows.push(["Mint locked", "positive"]);
  else if (controls.mint_authority === "enabled") chipRows.push(["Mint authority active", "warning"]);
  if (controls.freeze_authority === "disabled") chipRows.push(["Freeze locked", "positive"]);
  else if (controls.freeze_authority === "enabled") chipRows.push(["Freeze authority active", "warning"]);
  if (controls.honeypot === "flagged") chipRows.push(["Honeypot flag", "danger"]);
  else if (controls.honeypot === "not_flagged") chipRows.push(["No honeypot flag", "positive"]);
  if (anatomy?.market_profile?.launch?.completed === true) chipRows.push(["Launch complete", "neutral"]);
  if (anatomy?.token_lifecycle?.dex_paid === true) chipRows.push(["DEX paid*", "neutral"]);
  for (const [label, tone] of chipRows) {
    const chip = document.createElement("span");
    chip.className = "terminal-profile-chip";
    chip.dataset.tone = tone;
    chip.textContent = label;
    chips?.append(chip);
  }

  const attribution = projectProfile?.attribution || {};
  const attributionUrl = safeProfileLink(attribution.url);
  const creditVisible = attribution.required === true && Boolean(attributionUrl);
  if (credit) {
    credit.hidden = !creditVisible;
    credit.textContent = creditVisible ? customerFacingText(attribution.label, "Token data source") : "";
    if (creditVisible) credit.href = attributionUrl;
    else credit.removeAttribute("href");
  }
  const factsVisible = chipRows.length > 0 || creditVisible;
  if (facts) facts.hidden = !factsVisible;
  const section = document.getElementById("terminalAnatomySection");
  if (section && (distributionVisible || factsVisible)) section.hidden = false;
  const cachedHolders = state.holderListCache.get(currentHolderIdentity()?.key);
  if (cachedHolders) renderVerifiedHolderConcentration(cachedHolders);
  const dexPaidChip = Array.from(chips?.children || []).find((chip) => chip.textContent === "DEX paid*");
  if (dexPaidChip) dexPaidChip.title = "Dexch-reported. Payment time is unavailable.";
}

function renderMarketAnatomy(workspace = state.workspace?.state || {}) {
  const anatomy = workspace?.marketAnatomy || {};
  const chartProvider = readableProvider(workspace?.candleSeries?.provider || workspace?.source);
  renderSpotMarketProfile({});
  if (state.lane === "perps") {
    setText("terminalAnatomyEyebrow", "Market structure");
    setText("terminalAnatomyTitle", "Depth, positioning, and venue conditions");
    const market = selectedPerpSnapshot();
    const spread = finite(
      state.context?.market_data?.book?.summary?.spread_bps
      ?? workspace?.orderBook?.summary?.spread_bps,
    );
    const mark = finite(market.mark);
    const oracle = finite(market.oracle);
    const basis = mark !== null && oracle !== null && oracle > 0 ? ((mark / oracle) - 1) * 100 : null;
    setAnatomyRows([
      { label: "Open interest", value: compact(market.openInterestUsd, { currency: true }) },
      { label: "24h volume", value: compact(market.volume, { currency: true }) },
      { label: "Funding", value: percent(market.funding, { ratio: true }) },
      { label: "Book spread", value: spread === null ? null : `${spread.toFixed(spread < 1 ? 3 : 2)} bps` },
      { label: "Mark / oracle", value: basis === null ? null : percent(basis) },
      { label: "24h move", value: percent(market.change) },
    ]);
    setText("terminalFingerprint", state.selected?.instrument_id, "Exact market unavailable");
    setText("terminalAnatomyState", `${chartProvider} · current market`);
    return;
  }

  if (state.lane === "spot") {
    setText("terminalAnatomyEyebrow", "Holders & safety");
    setText("terminalAnatomyTitle", "Holder map and token checks");
    const holderDistribution = anatomy.holder_distribution || {};
    const holderCount = holderDistribution.state === "available"
      ? finite(holderDistribution.holder_count)
      : null;
    const holderChange = finite(
      holderDistribution.change_1h_pct
      ?? holderDistribution.change_5m_pct
      ?? holderDistribution.change_24h_pct,
    );
    const holderWindow = finite(holderDistribution.change_1h_pct) !== null
      ? "1h"
      : finite(holderDistribution.change_5m_pct) !== null
        ? "5m"
        : finite(holderDistribution.change_24h_pct) !== null
          ? "24h"
          : "";
    const holderState = holderCount === null
      ? null
      : `${compact(holderCount)}${holderChange === null ? "" : ` · ${holderWindow} ${percent(holderChange)}`}`;
    const activity = anatomy.current_activity || {};
    const buys5m = finite(activity.buys_5m);
    const sells5m = finite(activity.sells_5m);
    const traders5m = finite(activity.traders_5m);
    const shortFlow = buys5m !== null && sells5m !== null
      ? `${compact(buys5m)} buy · ${compact(sells5m)} sell${traders5m === null ? "" : ` · ${compact(traders5m)} traders`}`
      : null;
    const liveValuation = currentSpotValuation(state.spotCurrentPrice?.price);
    const marketCap = liveValuation?.marketCap ?? finite(anatomy.market_cap_usd ?? state.selected?.marketCap);
    const fdv = liveValuation?.fdv ?? finite(anatomy.fully_diluted_value_usd ?? state.selected?.fdv);
    const routeState = String(anatomy.route?.state || "").toLowerCase();
    const buys24h = finite(anatomy.buys_24h ?? state.selected?.buys24h);
    const sells24h = finite(anatomy.sells_24h ?? state.selected?.sells24h);
    const dayFlow = buys24h !== null && sells24h !== null
      ? `${compact(buys24h)} buy · ${compact(sells24h)} sell`
      : compact(anatomy.transactions_24h ?? state.selected?.txns24h);
    const shortVolume = finite(activity.volume_usd_5m);
    const poolAgeMs = finite(anatomy.pool_age_ms)
      ?? (finite(activity.market_age_seconds) === null ? null : finite(activity.market_age_seconds) * 1_000);
    const tokenCreatedAtMs = Date.parse(anatomy.token_created_at || anatomy.token_lifecycle?.created_at || "");
    const tokenAgeMs = Number.isFinite(tokenCreatedAtMs) ? Math.max(0, Date.now() - tokenCreatedAtMs) : null;
    const migratedAtMs = Date.parse(anatomy.migrated_at || anatomy.token_lifecycle?.migrated_at || "");
    const migratedAgo = Number.isFinite(migratedAtMs)
      ? durationLabel(Math.max(0, (Date.now() - migratedAtMs) / 1_000))
      : null;
    const ageValue = tokenAgeMs !== null
      ? `${ageLabel(tokenAgeMs)}${migratedAgo ? ` · M ${migratedAgo}` : ""}`
      : ageLabel(poolAgeMs ?? state.selected?.pairAgeMs);
    setAnatomyRows([
      { label: "Liquidity", value: compact(anatomy.liquidity_usd ?? state.selected?.liquidityUsd, { currency: true }) },
      { label: marketCap !== null ? "Market cap" : "FDV", value: compact(marketCap ?? fdv, { currency: true }) },
      {
        label: shortVolume === null ? "24h volume" : "5m volume",
        value: compact(shortVolume ?? anatomy.volume_24h_usd ?? state.selected?.volume24h, { currency: true }),
      },
      {
        label: shortFlow ? "5m flow" : buys24h !== null && sells24h !== null ? "24h flow" : "24h transactions",
        value: shortFlow || dayFlow,
      },
      { label: "Holders", value: holderState },
      { label: tokenAgeMs !== null ? "Token age" : "Pool age", value: ageValue },
      {
        label: "Route",
        value: routeStateLabel(routeState),
        show: ["preview_available", "route_available"].includes(routeState),
      },
    ]);
    renderSpotMarketProfile(anatomy);
    setText("terminalFingerprint", anatomy.pool_fingerprint || `${state.selected?.chainId || "unknown"}:pool:${state.selected?.pairAddress || "unresolved"}`);
    setText("terminalAnatomyState", anatomy.exact_identity === false ? "Identity unavailable" : "Exact pool");
    return;
  }

  setText("terminalAnatomyEyebrow", "Listed context");
  setText("terminalAnatomyTitle", "Session, movement, and market context");
  const subject = atlasSubject(state.selected || {});
  const instrument = state.selected?.instrument?.schema_version === "ravenos.instrument.v1" ? state.selected.instrument : state.selected || {};
  const options = atlasOptionsFor(state.selected);
  const session = String(instrument.market_session?.state || "").toLowerCase();
  setAnatomyRows([
    { label: "Session", value: titleCase(session), show: Boolean(session) && session !== "unknown" },
    { label: "5d move", value: percent(state.selected?.change_5d, { ratio: true }) },
    { label: "21d move", value: percent(state.selected?.change_21d, { ratio: true }) },
    { label: "63d move", value: percent(state.selected?.change_63d, { ratio: true }) },
    { label: "Options", value: options ? titleCase(options.regime) : null },
    { label: "Settlement", value: `${subject.settlementAsset || "USD"} · broker custody` },
  ]);
  setText("terminalFingerprint", subject.instrumentId, "Exact listing unavailable");
  setText("terminalAnatomyState", "Exact listing");
}

function renderTradeConsequences() {
  if (state.lane === "perps") {
    setText("terminalSettlementConsequence", "USDC margin remains at Hyperliquid; no order is prepared");
    setText("terminalPortfolioConsequence", state.accountSnapshot?.ok
      ? "Public account exposure is observed without asserting ownership"
      : "Load a public address to add account-specific exposure to the desk");
    renderTerminalTicketAccount();
    return;
  }
  if (state.lane === "spot") {
    const quote = String(state.selected?.quoteSymbol || "quote asset").toUpperCase();
    setText("terminalSettlementConsequence", `${quote} pool settlement; USDC intent requires an exact reviewed route`);
    setText("terminalPortfolioConsequence", "No wallet balance, custody, or resulting holding is inferred");
    return;
  }
  const subject = atlasSubject(state.selected || {});
  setText("terminalSettlementConsequence", `${subject.settlementAsset || "USD"} settles at the broker; RavenOS does not hold funds`);
  setText("terminalPortfolioConsequence", "No broker account, buying power, or resulting position is connected");
}

function historicalOutcomeText(value = {}) {
  const outcome = value && typeof value === "object" ? value : {};
  const sample = Math.max(0, Math.trunc(finite(outcome.sample_size) || 0));
  if (!sample) return "No matured comparable outcome is projected for this marker";
  const change = percent(outcome.median_change_pct);
  return `${sample} matured path${sample === 1 ? "" : "s"} · median ${change}${outcome.matured_through ? ` · through ${timestamp(outcome.matured_through)}` : ""}`;
}

function pathTransitionText(value = {}) {
  if (!value || typeof value !== "object") return operatorList(value);
  const parts = [value.behavior, value.pressure, value.observed_side, value.state]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => titleCase(item));
  return parts.length ? parts.join(" · ") : "Unavailable";
}

function conciseEvidence(value, fallback = "") {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const text = rows
    .map((item) => evidenceText(item, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  return (text || fallback).slice(0, 240);
}

function evidenceText(value, fallback = "") {
  let current = value;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    current = current.label ?? current.source ?? current.summary ?? current.title ?? current.name ?? "";
  }
  return customerFacingText(typeof current === "string" || typeof current === "number" ? current : "", fallback);
}

function markerPresentation(marker = {}) {
  const inspection = marker.inspection || {};
  const read = marker.raven_read || {};
  const source = inspection.source_evidence || read.evidence?.[0] || marker.metadata || {};
  const plan = PLAN_OVERLAY_TYPES.has(marker.type) ? qualifiedPlanData() : null;
  const sourceLabel = evidenceText(source, evidenceText(marker.source, plan ? evidenceText(marker.summary || marker.label, "") : ""));
  const sourceTime = source?.observed_at || marker.exact_observed_at || marker.observed_at;
  const sourceText = `${sourceLabel}${sourceTime ? `${sourceLabel ? " · " : ""}${timestamp(sourceTime)}` : ""}`;
  return {
    title: customerFacingText(marker.label || read.title || "Raven decision detail", "Raven decision detail").slice(0, 120),
    source: sourceText.slice(0, 220),
    maturity: customerFacingText(inspection.evidence_maturity || read.confidence || plan?.plan?.evidence_maturity, "").slice(0, 80),
    support: conciseEvidence(inspection.support || (plan ? plan.plan.strategy_reasons : null)),
    contradiction: conciseEvidence(
      inspection.contradiction,
      plan ? customerFacingText(plan.levels?.risk_reference?.source, "") : "",
    ),
    inspection,
    read,
  };
}

function setChartMarkerField(rowId, value) {
  const row = document.getElementById(rowId);
  const field = row?.querySelector("dd");
  const show = hasOperatorValue(value);
  if (row) row.hidden = !show;
  if (field) field.textContent = show ? String(value) : "";
}

function renderMarkerDetail(marker = {}) {
  const detail = document.getElementById("terminalMarkerDetail");
  if (!detail) return;
  const view = markerPresentation(marker);
  setText("terminalMarkerTitle", view.title);
  setOptionalField("terminalMarkerSource", view.source);
  setOptionalField("terminalMarkerMaturity", titleCase(view.maturity, ""));
  setOptionalField("terminalMarkerPath", pathTransitionText(view.inspection.path_transition));
  const historical = view.inspection.historical_outcome || {};
  setOptionalField("terminalMarkerOutcome", finite(historical.sample_size) > 0 ? historicalOutcomeText(historical) : "");
  setOptionalField("terminalMarkerSupport", operatorList(view.inspection.support, view.support));
  setOptionalField("terminalMarkerContradiction", operatorList(view.inspection.contradiction, view.contradiction));
  detail.hidden = false;
}

function renderChartMarkerInspector(marker = {}) {
  const inspector = document.getElementById("terminalChartMarkerInspector");
  if (!inspector) return;
  const view = markerPresentation(marker);
  setText("terminalChartMarkerTitle", view.title);
  setChartMarkerField("terminalChartMarkerSourceRow", view.source);
  setChartMarkerField("terminalChartMarkerMaturityRow", titleCase(view.maturity, ""));
  setChartMarkerField("terminalChartMarkerSupportRow", view.support);
  setChartMarkerField("terminalChartMarkerContradictionRow", view.contradiction);
  inspector.hidden = false;
  syncChartRavenDock();
}

function handleMarkerSelect(marker = {}) {
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  if (!activeInstrumentId || (marker.instrument_id && marker.instrument_id !== activeInstrumentId)) {
    announceRavenAction("Marker unavailable because its exact instrument does not match the active chart.");
    return false;
  }
  state.selectedMarker = marker;
  renderMarkerDetail(marker);
  renderChartMarkerInspector(marker);
  announceRavenAction(`${customerFacingText(marker.label || "Raven marker", "Raven marker")} selected. Compact evidence is visible on the chart.`);
  return true;
}

function clearMarkerInspection() {
  state.selectedMarker = null;
  const detail = document.getElementById("terminalMarkerDetail");
  const inspector = document.getElementById("terminalChartMarkerInspector");
  if (detail) detail.hidden = true;
  if (inspector) inspector.hidden = true;
  state.workspace?.clearMarkerSelection?.();
  syncChartRavenDock();
}

function showFullMarkerEvidence() {
  if (!state.selectedMarker) return false;
  renderMarkerDetail(state.selectedMarker);
  if (state.lane === "spot" || terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
  afterTerminalPaneVisible(() => {
    const detail = document.getElementById("terminalMarkerDetail");
    detail?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    detail?.focus?.({ preventScroll: true });
  });
  announceRavenAction("Full evidence opened for the selected Raven marker. The chart viewport and overlays were preserved.");
  return true;
}

function unwrap(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", ...(init.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null);
  return { response, payload: unwrap(payload) };
}

function exactInstrumentMatch(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function qualifiedPerpOpportunity(payload, instrumentId) {
  const row = payload?.selected_opportunity;
  if (
    !row
    || !exactInstrumentMatch(row.instrument_id, instrumentId)
    || !["fresh", "current"].includes(String(row.context_state || "").toLowerCase())
    || row.research_only !== true
    || row.execution_available !== false
    || payload?.selection?.silently_replaced === true
  ) return null;
  return row;
}

function qualifiedSpotOpportunity(payload, instrumentId) {
  const rows = Array.isArray(payload?.census?.discovery_radar?.rows) ? payload.census.discovery_radar.rows : [];
  const selected = payload?.selected_discovery_market
    || rows.find((row) => exactInstrumentMatch(row?.instrument_id, instrumentId));
  const discovery = selected?.discovery;
  const evidence = discovery?.raven_evidence_state;
  if (
    !selected
    || !exactInstrumentMatch(selected.instrument_id, instrumentId)
    || !exactInstrumentMatch(discovery?.exact_identity?.instrument_id, instrumentId)
    || discovery?.exact_identity?.identity_scope !== "exact_pool"
    || evidence?.qualified !== true
    || evidence?.raven_signal !== true
    || evidence?.availability !== "available"
    || !["current", "fresh"].includes(String(evidence.freshness || "").toLowerCase())
    || payload?.discovery_selection?.silently_replaced === true
  ) return null;
  return selected;
}

async function fetchExactOpportunityEvidence(instrumentId, instrument = "") {
  if (!instrumentId) return { perp: null, spot: null, generatedAt: null };
  const params = new URLSearchParams({ instrument_id: instrumentId });
  if (instrument) params.set("instrument", instrument);
  try {
    const { response, payload } = await fetchJson(`/api/opportunity?${params.toString()}`);
    const currentDelivery = payload?.delivery?.freshness_state === "fresh"
      && payload?.delivery?.fallback === false;
    if (!response.ok || payload?.ok !== true || payload?.schema_version !== "ravenos.opportunity_workspace.v2" || !currentDelivery) {
      return { perp: null, spot: null, generatedAt: null };
    }
    return {
      perp: qualifiedPerpOpportunity(payload, instrumentId),
      spot: qualifiedSpotOpportunity(payload, instrumentId),
      generatedAt: payload.generated_at || null,
    };
  } catch {
    return { perp: null, spot: null, generatedAt: null };
  }
}

function perpSubject(row = {}) {
  return {
    id: row.instrument_id,
    instrumentId: row.instrument_id,
    type: "instrument",
    label: row.asset,
    symbol: row.asset,
    assetClass: "crypto",
    instrumentType: "perpetual",
    identityScope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    marketType: "perp",
    quoteAsset: "USD",
    settlementAsset: "USDC",
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    capabilities: {
      chart: true,
      live_price: true,
      book: true,
      tape: true,
      funding: true,
      open_interest: true,
      raven_intelligence: true,
      quote_preview: false,
      execution: false,
    },
  };
}

function spotSubject(row = {}, { ravenIntelligence = false } = {}) {
  const chain = String(row.chainId || "").toLowerCase();
  const pairAddress = String(row.pairAddress || "");
  const label = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  const capability = spotChartCapability(row, state.timeframe);
  return {
    id: `${chain}:pool:${pairAddress}`,
    instrumentId: `${chain}:pool:${pairAddress}`,
    type: "pool",
    label,
    symbol: row.symbol || "",
    assetClass: "crypto",
    instrumentType: "exact_pool",
    identityScope: "exact_pool",
    chain,
    venue: String(row.dexId || "unknown").toLowerCase(),
    marketType: "spot",
    quoteAsset: String(row.quoteSymbol || "").toUpperCase(),
    settlementAsset: String(row.quoteSymbol || "").toUpperCase(),
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    tokenAddress: String(row.tokenAddress || ""),
    quoteTokenAddress: String(row.quoteTokenAddress || ""),
    poolAddress: pairAddress,
    capabilities: {
      chart: capability.chart_ready,
      live_price: finite(row.priceUsd) !== null,
      liquidity: finite(row.liquidityUsd) !== null,
      route_preview: capability.route_preview_support === true,
      raven_intelligence: ravenIntelligence === true,
      execution: false,
    },
  };
}

function atlasSubject(row = {}) {
  const instrument = row.instrument?.schema_version === "ravenos.instrument.v1"
    ? row.instrument
    : row.schema_version === "ravenos.instrument.v1"
      ? row
      : {};
  const symbol = String(row.symbol || instrument.symbol || "").toUpperCase();
  const quote = instrument.quote_asset?.symbol || "USD";
  const settlement = instrument.settlement_asset?.symbol || "USD";
  return {
    id: row.instrument_id || instrument.instrument_id,
    instrumentId: row.instrument_id || instrument.instrument_id,
    type: "instrument",
    label: symbol || instrument.display_name || "Traditional market",
    symbol,
    assetClass: instrument.asset_class || "equity",
    instrumentType: instrument.instrument_type || "equity",
    identityScope: instrument.identity_scope || "exact_instrument",
    chain: instrument.chain || "none",
    venue: instrument.venue || "unknown",
    marketType: "equities",
    quoteAsset: quote,
    settlementAsset: settlement,
    preferredCashAsset: instrument.preferred_cash_asset?.symbol || "USD",
    economicNumeraire: instrument.economic_numeraire || "USDC",
    capabilities: { ...(instrument.capabilities || {}), execution: false },
  };
}

function setWhyLabel(value = "Why Raven noticed this") {
  setText("terminalWhyLabel", value);
}

function setReadNarrative(summaryValue = "", whyValue = "") {
  const summary = customerFacingText(summaryValue, "").trim();
  const why = customerFacingText(whyValue, "").trim();
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const summaryNode = document.getElementById("terminalReadSummary");
  const whyNode = document.getElementById("terminalWhy");
  setText("terminalReadSummary", summary);
  setText("terminalWhy", why);
  if (summaryNode) summaryNode.hidden = !summary || normalize(summary) === normalize(why);
  if (whyNode?.parentElement) whyNode.parentElement.hidden = !why;
}

function selectedPerpSnapshot(row = state.selected, streamed = state.workspace?.state?.marketState || {}) {
  const last = finite(streamed.last ?? row?.last_price ?? row?.lastPrice);
  const mark = finite(streamed.mark ?? row?.mark_price ?? row?.markPx);
  const oracle = finite(streamed.oracle ?? row?.oracle_price ?? row?.oraclePx);
  const funding = finite(streamed.funding ?? row?.funding_rate ?? row?.funding);
  const openInterestUsd = finite(row?.open_interest_usd) ?? (
    finite(streamed.open_interest ?? row?.open_interest_base ?? row?.openInterest) !== null && (mark || last)
      ? finite(streamed.open_interest ?? row?.open_interest_base ?? row?.openInterest) * (mark || last)
      : null
  );
  const volume = finite(streamed.volume_24h ?? row?.day_notional_volume_usd ?? row?.dayNtlVlm);
  const previous = finite(streamed.previous_day_price ?? row?.previous_day_price ?? row?.prevDayPx);
  const change = last && previous ? (last / previous - 1) * 100 : finite(row?.day_change_pct);
  return { last, mark, oracle, funding, openInterestUsd, volume, change };
}

function renderPerpFacts() {
  const row = state.selected;
  const market = selectedPerpSnapshot(row);
  setInstrumentImage(null);
  setText("terminalInstrumentScope", "Exact instrument");
  setText("terminalInstrument", row?.asset);
  setText("terminalInstrumentMeta", row ? `Hyperliquid perpetual · ${timestamp(row.observed_at)}` : "Hyperliquid perpetual · unavailable");
  setText("terminalPickerSymbol", row?.asset, "No instrument");
  setText("terminalPickerMeta", row ? "Hyperliquid · perpetual" : "Search any supported market");
  const pickerMeta = document.getElementById("terminalPickerMeta");
  if (pickerMeta) pickerMeta.title = row?.instrument_id || "";
  setText("terminalVenueLabel", "Hyperliquid");
  setText("terminalCapabilityLabel", "Perpetual · USDC margin");
  setLastMetric(market.last);
  setMarketMetric(2, "Mark", formatPrice(market.mark));
  setMarketMetric(3, "Funding", percent(market.funding, { ratio: true }));
  setMarketMetric(4, "Open interest", compact(market.openInterestUsd, { currency: true }));
  setMarketMetric(5, "24h volume", compact(market.volume, { currency: true }));
  setMarketMetric(6, "24h change", percent(market.change));
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.toggle("terminal-positive", market.change !== null && market.change >= 0);
  changeNode?.classList.toggle("terminal-negative", market.change !== null && market.change < 0);
  updateTerminalPaneAvailability();
  renderMarketAnatomy();
  renderTradeConsequences();
}

function renderSpotFacts(row = state.selected) {
  const chartRequestSupported = spotChartCapability(row, state.timeframe).chart_request_supported;
  setInstrumentImage(row?.imageUrl);
  setText("terminalInstrumentScope", "Exact pool");
  setText("terminalInstrument", row ? `${row.symbol}/${row.quoteSymbol || "QUOTE"}` : "No pool selected");
  setText("terminalInstrumentMeta", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "venue unavailable"}` : "Search for a symbol, token, or contract");
  setText("terminalPickerSymbol", row ? `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}` : "Exact spot market required");
  setText("terminalPickerMeta", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "pool"} · ${compactHolderAddress(row.pairAddress)}` : "Search symbol, token, pool, or contract");
  const pickerMeta = document.getElementById("terminalPickerMeta");
  if (pickerMeta) pickerMeta.title = row ? `${String(row.chainId || "").toLowerCase()}:pool:${row.pairAddress}` : "";
  setText("terminalVenueLabel", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}` : "Unresolved");
  setText("terminalCapabilityLabel", row ? `Spot · ${row.quoteSymbol || "quote"} quote · ${chartRequestSupported ? "exact pool" : "chart unavailable"}` : "Search any supported market");
  if (row && !chartRequestSupported) {
    reconcileSelectedSpotPrice({
      chain: row.chainId,
      pool_address: row.pairAddress,
      token_address: row.tokenAddress,
      quote_token_address: row.quoteTokenAddress,
      price: row.priceUsd,
      observed_at: row.lastUpdated,
      source: "pair_snapshot",
    });
  } else {
    state.spotCurrentPrice = null;
    setLastMetric(null);
  }
  setMarketMetric(2, finite(row?.marketCap) !== null ? "Market cap" : "FDV", compact(row?.marketCap ?? row?.fdv, { currency: true }));
  setMarketMetric(3, "Liquidity", compact(row?.liquidityUsd, { currency: true }));
  setMarketMetric(4, "24h volume", compact(row?.volume24h, { currency: true }));
  const buys24h = finite(row?.buys24h);
  const sells24h = finite(row?.sells24h);
  setMarketMetric(
    5,
    buys24h !== null && sells24h !== null ? "24h buy / sell" : "24h transactions",
    buys24h !== null && sells24h !== null ? `${compact(buys24h)} / ${compact(sells24h)}` : compact(row?.txns24h),
  );
  setMarketMetric(6, "24h change", percent(row?.priceChange24h));
  const change = finite(row?.priceChange24h);
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.toggle("terminal-positive", change !== null && change >= 0);
  changeNode?.classList.toggle("terminal-negative", change !== null && change < 0);
  updateTerminalPaneAvailability();
  renderMarketAnatomy();
  renderTradeConsequences();
}

function atlasOptionsFor(row = state.selected) {
  const subject = atlasSubject(row || {});
  return (state.atlas?.options_context || []).find((option) => (
    option?.underlying_instrument_id === subject.instrumentId
    || String(option?.underlying || "").toUpperCase() === subject.symbol
  )) || null;
}

function renderAtlasFacts(row = state.selected) {
  const subject = atlasSubject(row || {});
  setInstrumentImage(null);
  const instrument = row?.instrument || {};
  const options = atlasOptionsFor(row);
  const session = instrument.market_session?.state || "unknown";
  setText("terminalInstrumentScope", "Exact listed instrument");
  setText("terminalInstrument", subject.symbol || "No instrument selected");
  setText("terminalInstrumentMeta", row ? `${titleCase(instrument.market_identity?.listing || subject.venue)} · ${subject.instrumentId} · ${timestamp(row.observed_at)}` : "Select an exact listed instrument");
  setText("terminalPickerSymbol", subject.symbol, "Exact listed instrument required");
  setText("terminalPickerMeta", subject.instrumentId, "Search equities and ETFs");
  setText("terminalVenueLabel", titleCase(instrument.market_identity?.listing || subject.venue));
  setText("terminalCapabilityLabel", `${titleCase(subject.instrumentType)} · ${subject.settlementAsset} settlement · ${titleCase(session)} session`);
  setLastMetric(row?.price);
  setMarketMetric(2, "5d change", percent(row?.change_5d, { ratio: true }));
  setMarketMetric(3, "21d change", percent(row?.change_21d, { ratio: true }));
  setMarketMetric(4, "63d change", percent(row?.change_63d, { ratio: true }));
  setMarketMetric(5, "Options context", options ? titleCase(options.regime) : null);
  setMarketMetric(6, "Market session", titleCase(session), { show: Boolean(session) && session !== "unknown" });
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.remove("terminal-positive", "terminal-negative");
  updateTerminalPaneAvailability();
  renderMarketAnatomy();
  renderTradeConsequences();
}

function renderListedFacts(row = state.selected) {
  const subject = atlasSubject(row || {});
  setInstrumentImage(null);
  const instrument = row?.instrument?.schema_version === "ravenos.instrument.v1" ? row.instrument : row || {};
  const session = instrument.market_session?.state || "unknown";
  const listing = instrument.market_identity?.listing || subject.venue;
  setText("terminalInstrumentScope", "Exact listed instrument");
  setText("terminalInstrument", subject.symbol || "No instrument selected");
  setText("terminalInstrumentMeta", subject.instrumentId ? `${titleCase(listing)} · ${subject.instrumentId}` : "Select an exact listed instrument");
  setText("terminalPickerSymbol", subject.symbol, "Exact listed instrument required");
  setText("terminalPickerMeta", subject.instrumentId, "Search equities and ETFs");
  setText("terminalVenueLabel", titleCase(listing));
  setText("terminalCapabilityLabel", `${titleCase(subject.instrumentType)} · ${subject.settlementAsset} settlement · market-data inspection only`);
  setLastMetric(null);
  setMarketMetric(2, "Settlement", subject.settlementAsset);
  setMarketMetric(3, "Economic view", subject.economicNumeraire);
  setMarketMetric(4, "Market session", titleCase(session), { show: Boolean(session) && session !== "unknown" });
  setMarketMetric(5, "", "", { show: false });
  setMarketMetric(6, "", "", { show: false });
  document.getElementById("terminalMetric6")?.classList.remove("terminal-positive", "terminal-negative");
  updateTerminalPaneAvailability();
  renderMarketAnatomy();
  renderTradeConsequences();
}

function resetComparableEvidence() {
  setComparableVisible(false);
  setText("terminalComparableState", "");
  setText("terminalComparableN", "");
  setText("terminalComparablePositive", "");
  setText("terminalComparableChange", "");
  setText("terminalComparableFavorable", "");
  setText("terminalComparableAdverse", "");
  setText("terminalComparableNote", "");
}

function renderComparables(comparables = {}, { horizon = null, instrument = null } = {}) {
  const sample = Math.max(0, Math.trunc(finite(comparables.sample_size) || 0));
  if (!sample) {
    resetComparableEvidence();
    return false;
  }
  const positive = finite(comparables.positive_followthrough_rate);
  const positiveLabel = positive === null ? "--" : `${(positive * 100).toFixed(1)}%`;
  const cleanHorizon = customerFacingText(horizon, "").replace(/\s*research window\s*$/i, "").trim();
  const marketLabel = customerFacingText(instrument, "this exact market");
  setComparableVisible(true);
  setText("terminalComparableState", titleCase(comparables.evidence_maturity, sample ? "Observed" : "Forming"));
  setText("terminalComparableN", sample.toLocaleString());
  setText("terminalComparablePositive", positiveLabel);
  setText("terminalComparableChange", percent(comparables.median_observed_change_pct));
  setText("terminalComparableFavorable", percent(comparables.median_favorable_excursion_pct));
  setText("terminalComparableAdverse", percent(comparables.median_adverse_excursion_pct));
  setText("terminalComparableNote", positive === null
    ? `${sample} completed Raven observation${sample === 1 ? "" : "s"} for ${marketLabel}${comparables.matured_through ? `, measured through ${timestamp(comparables.matured_through)}` : ""}. Historical context—not a forecast.`
    : `In ${sample} completed Raven observation${sample === 1 ? "" : "s"} for ${marketLabel}, ${positiveLabel} ended with a positive price return${cleanHorizon ? ` over ${cleanHorizon}` : ""}. Historical frequency—not a forecast.`);
  return true;
}

function resetPlanPreview() {
  state.planOverlayEnabled = false;
  clearPlanMarkerInspection();
  const section = document.getElementById("terminalPlanSection");
  const toggle = document.getElementById("terminalPlanToggle");
  if (section) section.hidden = true;
  if (toggle) toggle.checked = false;
  const load = document.getElementById("terminalPlanLoad");
  if (load) {
    load.disabled = true;
    load.hidden = false;
  }
  const ladder = document.getElementById("terminalPlanLadderRow");
  if (ladder) ladder.hidden = true;
  const why = document.getElementById("terminalPlanWhyRow");
  if (why) why.hidden = true;
  setText("terminalPlanEntry", "");
  setText("terminalPlanTarget", "");
  setText("terminalPlanRisk", "");
  setText("terminalPlanEvidence", "");
  setText("terminalPlanLadder", "");
  setText("terminalPlanWhy", "");
  syncPlanActionSurfaces(null);
  syncSpotPlanSource();
  syncRavenPaneAvailability();
}

function activeChartEvidenceInstrumentId() {
  const workspace = state.workspace?.state || {};
  const instrument = workspace.instrument || {};
  if (workspace.state !== "live" || !instrument.canonical_id) return null;
  if (state.lane === "perps") {
    const selectedId = String(state.selected?.instrument_id || "");
    const exact = /^hyperliquid:perp:([A-Z0-9._-]+)$/i.exec(selectedId);
    const selectedAsset = String(state.selected?.asset || "").replace(/-PERP$/i, "").toUpperCase();
    const chartAsset = String(instrument.base_asset || instrument.symbol || "").replace(/-PERP$/i, "").toUpperCase();
    return exact
      && String(workspace.marketIdentity || "") === selectedId
      && instrument.instrument_type === "perpetual"
      && instrument.identity_scope === "venue_market"
      && instrument.chain === "hyperliquid"
      && instrument.venue === "hyperliquid"
      && exact[1].toUpperCase() === selectedAsset
      && chartAsset === selectedAsset
      ? selectedId
      : null;
  }
  if (state.lane === "spot") {
    const selectedPool = String(state.selected?.pairAddress || "");
    const selectedToken = String(state.selected?.tokenAddress || "");
    return instrument.instrument_type === "spot_pool"
      && instrument.identity_scope === "exact_pool"
      && String(instrument.chain || "").toLowerCase() === String(state.selected?.chainId || "").toLowerCase()
      && String(instrument.pool_address || "").toLowerCase() === selectedPool.toLowerCase()
      && (!selectedToken || String(instrument.token_address || "").toLowerCase() === selectedToken.toLowerCase())
      ? instrument.canonical_id
      : null;
  }
  return null;
}

function planPreviewData(plan = {}) {
  const levels = plan?.levels;
  const sample = Math.max(0, Math.trunc(finite(plan?.sample_size) || 0));
  const entry = finite(levels?.entry_reference?.price);
  const target = finite(levels?.target_reference?.price);
  const risk = finite(levels?.risk_reference?.price);
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  const rawTakeProfits = Array.isArray(plan?.take_profits) ? plan.take_profits : [];
  const takeProfits = rawTakeProfits.map((row) => ({
    label: customerFacingText(row?.label, "").trim(),
    price: finite(row?.price),
    excursion_pct: finite(row?.excursion_pct),
    reward_risk: finite(row?.reward_risk),
    allocation_pct: finite(row?.allocation_pct),
  })).filter((row) => (
    row.label
    && row.price > 0
    && row.excursion_pct !== null
    && row.reward_risk > 0
    && row.allocation_pct > 0
  ));
  const takeProfitAllocation = takeProfits.reduce((sum, row) => sum + row.allocation_pct, 0);
  const takeProfitsOrdered = takeProfits.every((row, index) => index === 0 || (
    plan.direction === "long"
      ? row.price > takeProfits[index - 1].price
      : row.price < takeProfits[index - 1].price
  ));
  if (
    plan?.schema_version !== "ravenos.plan_preview.v1"
    || plan?.state !== "research_only"
    || plan?.executable !== false
    || plan?.signing_available !== false
    || plan?.submission_available !== false
    || !levels
    || !(entry > 0)
    || !(target > 0)
    || !(risk > 0)
    || !["long", "short"].includes(plan.direction)
    || (!activeInstrumentId || plan.instrument_id !== activeInstrumentId)
    || (plan.direction === "long" && !(target > entry && risk < entry))
    || (plan.direction === "short" && !(target < entry && risk > entry))
    || (rawTakeProfits.length > 0 && takeProfits.length !== rawTakeProfits.length)
    || (takeProfits.length > 0 && (takeProfits.length < 2 || takeProfits.length > 5))
    || (takeProfits.length > 0 && takeProfits.some((row) => plan.direction === "long" ? row.price <= entry : row.price >= entry))
    || (takeProfits.length > 0 && (!takeProfitsOrdered || Math.abs(takeProfitAllocation - 100) > 0.01))
    || sample <= 0
  ) return null;
  return { plan, levels, sample, takeProfits };
}

function planEvidenceIsCurrent() {
  if (state.workspace?.state?.state !== "live") return false;
  if (state.lane === "spot") {
    const context = state.context?.spot_context;
    const providerState = String(state.workspace?.state?.providerFreshnessState || "current").toLowerCase();
    const candleState = String(state.workspace?.state?.candleFreshnessState || "current").toLowerCase();
    return (state.context?.spot_identity_validated === true || state.context?.spot_plan_identity_validated === true)
      && context?.state === "current"
      && ["current", "fresh"].includes(providerState)
      && ["current", "fresh"].includes(candleState);
  }
  if (state.lane === "perps") {
    return state.context?.raven_context?.context_available === true
      && ["current", "fresh"].includes(String(state.context?.raven_context?.context_state || "").toLowerCase())
      && state.context?.delivery?.freshness_state === "fresh"
      && state.context?.delivery?.fallback !== true;
  }
  return false;
}

function qualifiedPlanData(plan = state.context?.plan_preview || {}) {
  const validated = planPreviewData(plan);
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  const contract = state.context?.chart_overlays;
  const planObservedAt = Date.parse(plan?.as_of || "");
  const fail = (reason) => {
    state.planQualificationIssue = reason;
    return null;
  };
  if (marketRiskBlocksAction()) return fail("market_control_risk");
  if (activeInstrumentId && plan?.instrument_id && plan.instrument_id !== activeInstrumentId) return fail("exact_instrument_mismatch");
  if (!validated) return fail("invalid_plan_contract");
  if (!activeInstrumentId || plan.instrument_id !== activeInstrumentId) return fail("exact_instrument_mismatch");
  if (!Number.isFinite(planObservedAt)) return fail("plan_observed_at_invalid");
  if (!planEvidenceIsCurrent()) return fail("evidence_not_current");
  if (
    contract?.schema_version !== "ravenos.chart_overlays.v1"
    || contract?.role !== "annotation_only"
    || contract?.candle_replacement_allowed !== false
    || contract?.instrument_id !== activeInstrumentId
    || !Array.isArray(contract?.overlays)
  ) return fail("invalid_overlay_contract");
  const overlays = contract.overlays.filter((overlay) => PLAN_OVERLAY_TYPES.has(overlay?.type));
  const targetCount = validated.takeProfits.length || 1;
  const expectedCount = targetCount + 2;
  const counts = overlays.reduce((result, overlay) => {
    result[overlay.type] = (result[overlay.type] || 0) + 1;
    return result;
  }, {});
  const overlaysValid = overlays.every((overlay) => {
    const observedAt = Date.parse(overlay?.observed_at || "");
    const lineage = overlay?.lineage;
    return typeof overlay?.id === "string"
      && overlay.id.startsWith(`${plan.plan_id}:`)
      && overlay.instrument_id === activeInstrumentId
      && finite(overlay.priceMin) > 0
      && finite(overlay.priceMax) > 0
      && Number.isFinite(observedAt)
      && lineage && typeof lineage === "object"
      && Object.values(lineage).some(Boolean);
  });
  if (
    overlays.length !== expectedCount
    || counts["plan-entry"] !== 1
    || counts["plan-target"] !== targetCount
    || counts["plan-risk"] !== 1
    || !overlaysValid
  ) return fail("plan_overlay_mismatch");
  state.planQualificationIssue = null;
  return { ...validated, overlays, targetCount, levelCount: expectedCount };
}

function captureChartViewport() {
  const instrumentId = state.workspace?.state?.instrument?.canonical_id || null;
  const handle = state.workspace?.chartHandle;
  return instrumentId && handle ? {
    instrumentId,
    timeRange: handle.visibleTimeRange?.() || null,
    logicalRange: handle.visibleLogicalRange?.() || null,
  } : null;
}

function restoreChartViewport(viewport) {
  if (!viewport || viewport.instrumentId !== state.workspace?.state?.instrument?.canonical_id) return false;
  const handle = state.workspace?.chartHandle;
  if (!handle) return false;
  handle.resize?.();
  if (viewport.timeRange) return handle.setVisibleTimeRange?.(viewport.timeRange) === true;
  return true;
}

function announceRavenAction(message = "") {
  const live = document.getElementById("terminalRavenActionStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = customerFacingText(message, ""); });
}

function syncChartRavenDock() {
  const dock = document.getElementById("terminalChartRavenDock");
  if (!dock) return;
  const planVisible = document.getElementById("terminalChartPlanStrip")?.hidden === false;
  const markerVisible = document.getElementById("terminalChartMarkerInspector")?.hidden === false;
  dock.hidden = !planVisible && !markerVisible;
}

function planSummaryLabel(qualified) {
  if (!qualified) return "";
  return qualified.targetCount === 1
    ? "Entry + TP + Risk"
    : `Entry + ${qualified.targetCount} TP + Risk`;
}

function syncPlanActionSurfaces(qualified = qualifiedPlanData()) {
  if (!qualified) state.planOverlayEnabled = false;
  const active = Boolean(qualified && state.planOverlayEnabled);
  const toggle = document.getElementById("terminalPlanToggle");
  if (toggle) {
    toggle.checked = active;
    toggle.disabled = !qualified;
  }
  setText("terminalPlanToggleLabel", active ? "Hide from chart" : "Show on chart", "Show on chart");
  setText(
    "terminalPlanToggleHint",
    active ? "Remove only the transient plan levels; other Raven layers stay active." : "Add these current-evidence levels to the chart.",
    "",
  );
  const strip = document.getElementById("terminalChartPlanStrip");
  if (strip) strip.hidden = !active;
  setText("terminalChartPlanSummary", active ? planSummaryLabel(qualified) : "", "");
  const measured = state.workspace?.diagnostics?.()?.chart;
  const measuredLayers = finite(measured?.active_overlay_count);
  const activeLayers = measuredLayers === null ? qualified?.levelCount || 0 : Math.max(0, Math.trunc(measuredLayers));
  setText("terminalChartRavenLayerCount", `${activeLayers} Raven layer${activeLayers === 1 ? "" : "s"} active`, "");
  const inspect = document.getElementById("terminalChartPlanInspect");
  if (inspect) inspect.setAttribute("aria-expanded", String(terminalUsesPaneNavigation() && document.querySelector(".terminal-live")?.dataset.terminalPane === "raven"));
  syncChartRavenDock();
  return active;
}

function clearPlanMarkerInspection() {
  if (!PLAN_OVERLAY_TYPES.has(state.selectedMarker?.type)) return;
  clearMarkerInspection();
}

function setPlanOverlayActive(requested, { source = "plan", switchToChart = requested, focus = true } = {}) {
  const qualified = qualifiedPlanData();
  if (requested && !qualified) {
    const wasActive = state.planOverlayEnabled;
    state.planOverlayEnabled = false;
    if (wasActive) applyActiveContextOverlays();
    syncPlanActionSurfaces(null);
    renderAlphaStack();
    announceRavenAction("Raven plan unavailable. Exact identity, current evidence, and complete levels are required.");
    return false;
  }
  const viewport = captureChartViewport();
  const changed = state.planOverlayEnabled !== Boolean(requested);
  state.planOverlayEnabled = Boolean(requested);
  if (changed) applyActiveContextOverlays();
  if (!requested) clearPlanMarkerInspection();
  syncPlanActionSurfaces(qualified);
  renderAlphaStack();
  if (requested && switchToChart && terminalUsesPaneNavigation()) setTerminalPane("chart", { focusId: focus ? "terminalChartPlanInspect" : "" });
  afterTerminalPaneVisible(() => {
    restoreChartViewport(viewport);
    if (requested && focus) document.getElementById("terminalChartPlanInspect")?.focus?.({ preventScroll: true });
    if (!requested && source === "chart-strip") document.getElementById("terminalChart")?.focus?.({ preventScroll: true });
    syncPlanActionSurfaces(qualifiedPlanData());
  });
  announceRavenAction(requested
    ? `Raven plan shown on the exact chart. ${planSummaryLabel(qualified)}. Research only; not financial advice.`
    : "Raven plan hidden. Other Raven chart layers were preserved.");
  return true;
}

function focusPlanPreview() {
  if (!qualifiedPlanData()) {
    announceRavenAction("A current Raven plan is not available for this exact market.");
    return false;
  }
  if (state.lane === "spot" || terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
  afterTerminalPaneVisible(() => {
    const section = document.getElementById("terminalPlanSection");
    section?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    section?.focus?.({ preventScroll: true });
    document.getElementById("terminalChartPlanInspect")?.setAttribute("aria-expanded", "true");
  });
  announceRavenAction("Full Raven plan evidence opened. Chart levels and viewport remain active.");
  return true;
}

function focusTerminalRaven() {
  const target = document.getElementById("terminalContextSection")?.hidden === false
    ? document.getElementById("terminalContextSection")
    : document.getElementById("terminalAlphaSection")?.hidden === false
      ? document.getElementById("terminalAlphaSection")
      : document.getElementById("terminalPlanSection")?.hidden === false
        ? document.getElementById("terminalPlanSection")
        : document.getElementById("terminalRavenEmptySection")?.hidden === false
          ? document.getElementById("terminalRavenEmptySection")
          : null;
  if (!target) return false;
  if (state.lane === "spot" || terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
  afterTerminalPaneVisible(() => {
    target.scrollIntoView?.({ block: "start", behavior: "smooth" });
    target.focus?.({ preventScroll: true });
  });
  announceRavenAction(`${state.lane === "equity" ? "Atlas" : "Raven"} intelligence opened for the selected exact market.`);
  return true;
}

function renderPlanPreview(plan = {}) {
  const validated = qualifiedPlanData(plan);
  if (!validated) {
    resetPlanPreview();
    return false;
  }
  const { levels, sample, takeProfits } = validated;
  const spotPlan = state.lane === "spot" && takeProfits.length >= 2;
  const section = document.getElementById("terminalPlanSection");
  if (section) section.hidden = false;
  const load = document.getElementById("terminalPlanLoad");
  if (load) {
    load.hidden = state.lane === "spot" ? !spotTicketQualified() : state.lane !== "perps";
    load.disabled = false;
    load.textContent = state.lane === "spot" ? "Use Raven suggestion in quote ticket" : "Load levels into trade ticket";
  }
  setText("terminalPlanLabel", spotPlan ? "Raven custom TP strategy" : "Plan preview");
  setText("terminalPlanTitle", spotPlan ? customerFacingText(plan.strategy_label, "Adaptive scale-out") : "What similar paths suggest");
  setText("terminalPlanState", `${titleCase(plan.direction)} · research only`);
  setText("terminalPlanEntry", formatPrice(levels.entry_reference.price));
  setText("terminalPlanTarget", `${formatPrice(levels.target_reference.price)} · ${percent(levels.target_reference.excursion_pct)}`);
  setText("terminalPlanRisk", `${formatPrice(levels.risk_reference.price)} · ${percent(levels.risk_reference.excursion_pct)}`);
  setText("terminalPlanEvidence", plan.evidence_label || `${sample.toLocaleString()} paths · ${titleCase(plan.evidence_maturity)}`);
  const ladder = document.getElementById("terminalPlanLadderRow");
  if (ladder) ladder.hidden = !spotPlan;
  setText("terminalPlanLadder", spotPlan
    ? takeProfits.map((row) => `${row.label} ${formatPrice(row.price)} (${percent(row.excursion_pct)}) · trim ${row.allocation_pct}%`).join("  ·  ")
    : "");
  const why = document.getElementById("terminalPlanWhyRow");
  const reasons = Array.isArray(plan.strategy_reasons)
    ? plan.strategy_reasons.map((value) => customerFacingText(value, "").trim()).filter(Boolean).slice(0, 5)
    : [];
  if (why) why.hidden = !spotPlan || !reasons.length;
  setText("terminalPlanWhy", spotPlan ? reasons.join(" · ") : "");
  const planDisclaimer = String(plan.disclaimer || "Based on completed paths for this market. Research only—not personalized targets, stops, or orders.").trim();
  setText("terminalPlanDisclaimer", /financial advice/i.test(planDisclaimer) ? planDisclaimer : `${planDisclaimer} Not financial advice.`);
  syncPlanActionSurfaces(validated);
  syncSpotPlanSource();
  syncRavenPaneAvailability();
  return true;
}

function loadRavenPlanIntoTicket() {
  const validated = qualifiedPlanData();
  if (!validated || !new Set(["perps", "spot"]).has(state.lane)) return;
  if (state.lane === "spot") {
    if (!spotTicketQualified()) return;
    state.spotTicketPlanSource = "raven_exact_market";
    syncSpotPlanSource();
    setTerminalPane("trade");
    if (terminalUsesPaneNavigation()) {
      requestAnimationFrame(() => document.getElementById("terminalSpotTicketSection")?.scrollIntoView({ block: "start" }));
    }
    clearSpotQuoteResult("Raven exact-market levels selected for this review. They remain research only and do not authorize a trade.");
    announceRavenAction("Raven exact-market levels selected in the quote ticket. Your presets were preserved separately.");
    return;
  }
  const { plan, levels } = validated;
  setMarketPreviewSide(plan.direction === "short" ? "short" : "long");
  setOrderPlanType("limit");
  const price = document.getElementById("terminalPreviewPrice");
  const takeProfit = document.getElementById("terminalPreviewTakeProfit");
  const stopLoss = document.getElementById("terminalPreviewStopLoss");
  if (price) price.value = String(levels.entry_reference.price);
  if (takeProfit) takeProfit.value = String(levels.target_reference.price);
  if (stopLoss) stopLoss.value = String(levels.risk_reference.price);
  const bracket = document.getElementById("terminalBracket");
  if (bracket) bracket.open = true;
  setTerminalPane("trade");
  if (window.matchMedia("(max-width: 820px)").matches) {
    requestAnimationFrame(() => document.getElementById("terminalTradeReviewSection")?.scrollIntoView({ block: "start" }));
  }
  clearMarketPreviewResult("Raven research levels loaded for your review. They do not authorize an order.");
  void requestOrderPlan();
}

function setContextUnavailable() {
  state.context = null;
  state.opportunityEvidence = null;
  clearMarkerInspection();
  setContextControlsVisible(false);
  setContextField("terminalContextIdentity", "", "Market");
  setContextField("terminalBehavior", "", "Setup");
  setContextField("terminalPath", "", "Path");
  setContextField("terminalEvidenceMaturity", "", "Read strength");
  setText("terminalReadHeadline", "");
  setReadNarrative();
  setText("terminalEvidenceState", "");
  renderDecisionSupport();
  resetComparableEvidence();
  resetPlanPreview();
  renderAlphaStack();
}

function setContextChecking({ identity } = {}) {
  state.context = null;
  state.opportunityEvidence = null;
  clearMarkerInspection();
  resetPlanPreview();
  setContextControlsVisible(false);
  setTerminalPaneStatus("raven", "Checking");
  setContextField("terminalContextIdentity", identity || "");
  renderDecisionSupport();
  resetComparableEvidence();
  renderAlphaStack();
}

function contextChartEvent(payload) {
  const event = payload?.chart_event;
  const candles = state.workspace?.state?.candles || [];
  const observed = Math.trunc(Date.parse(event?.observed_at || "") / 1000);
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  if (
    !event?.event_id
    || !activeInstrumentId
    || event?.instrument_id !== activeInstrumentId
    || payload?.instrument?.instrument_id !== activeInstrumentId
    || !event?.lineage?.public_context_id
    || !Number.isFinite(observed)
    || !candles.length
  ) return null;
  const nearest = candles.reduce((best, candle) => (
    Math.abs(Number(candle.time) - observed) < Math.abs(Number(best.time) - observed) ? candle : best
  ), candles[0]);
  return {
    type: "opportunity-marker",
    severity: "info",
    label: event.label || "Raven observation",
    time: nearest.time,
    exact_observed_at: event.observed_at,
    event_id: event.event_id,
    instrument_id: event.instrument_id,
    lineage: event.lineage,
    inspection: event.inspection || null,
  };
}

function applyContextChartEvent(payload) {
  const event = contextChartEvent(payload);
  const activeInstrumentId = activeChartEvidenceInstrumentId();
  const sourceOverlays = payload?.chart_overlays?.role === "annotation_only"
    && payload?.chart_overlays?.candle_replacement_allowed === false
    && payload?.chart_overlays?.instrument_id === activeInstrumentId
    && payload?.instrument?.instrument_id === activeInstrumentId
    && Array.isArray(payload?.chart_overlays?.overlays)
    ? payload.chart_overlays.overlays
    : [];
  const overlays = sourceOverlays.filter((overlay) => (
    !String(overlay?.type || "").startsWith("plan-") || state.planOverlayEnabled
  ));
  const visibleOverlayTypes = [
    ...currentRavenOverlayTypes(),
    ...(state.planOverlayEnabled ? ["plan-entry", "plan-target", "plan-risk"] : []),
  ];
  state.workspace?.render?.({
    asset: state.selected?.asset,
    market: "perp",
    venue: "hyperliquid",
    chain: "hyperliquid",
    timeframe: state.timeframe,
    events: event ? [event] : [],
    overlays,
    visibleOverlayTypes,
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
    onOverlaySelect: captureCurrentRavenOverlayTypes,
  });
}

function applySpotContextChart(payload = state.context || {}) {
  const workspace = state.workspace?.state || {};
  const riskBlocked = marketRiskBlocksAction();
  const annotations = workspace.ravenAnnotations;
  const exactAnnotations = annotations?.role === "annotation_only"
    && annotations?.identity_scope === "exact_pool"
    && annotations?.candle_replacement_allowed === false
    && annotations?.instrument_id === workspace.instrument?.canonical_id
    ? annotations
    : null;
  const lifecycleAnnotations = workspace.marketEvents?.role === "annotation_only"
    && workspace.marketEvents?.identity_scope === "exact_pool"
    && workspace.marketEvents?.candle_replacement_allowed === false
    && workspace.marketEvents?.current_price_authority === false
    && workspace.marketEvents?.execution_authority === false
    && workspace.marketEvents?.instrument_id === workspace.instrument?.canonical_id
    ? workspace.marketEvents
    : null;
  const planContract = payload?.chart_overlays;
  const planOverlays = planContract?.role === "annotation_only"
    && planContract?.candle_replacement_allowed === false
    && planContract?.instrument_id === workspace.instrument?.canonical_id
    && Array.isArray(planContract.overlays)
    ? planContract.overlays
    : [];
  const overlays = [
    ...(riskBlocked ? [] : Array.isArray(exactAnnotations?.overlays) ? exactAnnotations.overlays : []),
    ...(riskBlocked ? [] : state.planOverlayEnabled ? planOverlays : []),
  ];
  state.workspace?.render?.({
    asset: state.selected ? `${state.selected.symbol}/${state.selected.quoteSymbol}` : "Exact pool",
    market: "crypto_spot",
    venue: state.selected?.dexId || "exact_pool",
    chain: state.selected?.chainId || "",
    timeframe: state.timeframe,
    events: [
      ...(Array.isArray(lifecycleAnnotations?.events) ? lifecycleAnnotations.events : []),
      ...(riskBlocked ? [] : Array.isArray(exactAnnotations?.events) ? exactAnnotations.events : []),
    ],
    overlays,
    visibleOverlayTypes: riskBlocked ? [] : [
      ...currentRavenOverlayTypes(),
      ...(state.planOverlayEnabled ? ["plan-entry", "plan-target", "plan-risk"] : []),
    ],
    showChartRead: !riskBlocked,
    showMarketEvents: true,
    showRavenAnnotations: !riskBlocked,
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
    onOverlaySelect: captureCurrentRavenOverlayTypes,
  });
}

function applyActiveContextOverlays() {
  if (state.planOverlayEnabled && !qualifiedPlanData()) {
    state.planOverlayEnabled = false;
    clearPlanMarkerInspection();
  }
  if (state.lane === "spot") applySpotContextChart();
  else if (state.context) applyContextChartEvent(state.context);
  syncPlanActionSurfaces();
}

function opportunityReference(row = {}) {
  return customerFacingText(row?.public_opportunity_id || row?.discovery?.raven_evidence_state?.lineage?.public_artifact_id, "");
}

function renderPerpOpportunityFallback(row, { updateUrl = true, generatedAt = null } = {}) {
  const selectedId = state.selected?.instrument_id;
  if (!row || !exactInstrumentMatch(row.instrument_id, selectedId)) return false;
  const maturity = titleCase(
    customerFacingText(row.matured_comparables?.evidence_maturity, "")
      || (finite(row.matured_comparables?.sample_size) > 0 ? "Observed history" : "Forming"),
    "Forming",
  );
  const why = customerFacingText(row.why_raven_noticed, "");
  const path = customerFacingText(row.path_review?.state, "");
  const observedAt = row.observed_at || generatedAt || null;
  const reference = opportunityReference(row);
  state.context = {
    instrument: { instrument_id: selectedId },
    raven_context: {
      instrument_id: selectedId,
      context_available: true,
      context_state: "fresh",
      observed_at: observedAt,
      observed_side: row.observed_direction,
      pressure_state: row.pressure_state,
      behavior_family: row.pressure_state || "Raven observation",
      current_path: path,
      outcomes: { ...row.matured_comparables, evidence_maturity: maturity },
      public_context_id: reference || null,
    },
    raven_read: {
      headline: `${row.instrument || state.selected?.asset || "Instrument"} · ${customerFacingText(row.pressure_state, "Raven observation")}`,
      summary: why,
      why_raven_noticed: why,
      what_would_strengthen: [],
      what_would_weaken: [],
    },
    delivery: { freshness_state: "fresh", fallback: false },
    exact_opportunity_only: true,
  };
  state.opportunityEvidence = row;
  resetPlanPreview();
  setContextControlsVisible(true, { kind: "Raven", trigger: "Raven Read" });
  setText("terminalReadHeadline", state.context.raven_read.headline);
  setReadNarrative(why, why);
  setContextField("terminalContextIdentity", selectedId, "Market");
  setContextField("terminalBehavior", row.pressure_state, "Setup");
  setContextField("terminalPath", path, "Path");
  setContextField("terminalEvidenceMaturity", maturity, "Read strength");
  setText("terminalEvidenceState", finite(row.context_age_seconds) !== null ? `Updated ${durationLabel(row.context_age_seconds)}` : "Current");
  setState("terminalContextFreshness", "fresh", "Current");
  renderComparables(row.matured_comparables || {}, {
    horizon: row.plan_preview?.review_horizon,
    instrument: row.instrument || state.selected?.asset,
  });
  renderDecisionSupport({ changed: why, checkpoint: path, reference, scope: selectedId, observed: observedAt });
  renderMarketAnatomy();
  updateShell({
    subject: perpSubject(state.selected),
    marketLabel: state.context.raven_read.headline,
    thesis: why,
    setup: path || row.context_state,
    supporting: [why].filter(Boolean),
    contradicting: [],
    invalidation: [],
    evidenceState: maturity,
    freshnessState: "fresh",
    freshnessLabel: "Exact Raven opportunity",
    observedAt,
    nextTransition: path,
  }, { updateUrl });
  renderAlphaStack();
  return true;
}

function renderPerpContext(payload, { updateUrl = true, opportunityEvidence = null, opportunityGeneratedAt = null } = {}) {
  state.context = payload;
  state.opportunityEvidence = opportunityEvidence;
  renderTerminalMarketFlow(payload?.market_data || {});
  const context = payload?.raven_context || {};
  const read = payload?.raven_read || {};
  const delivery = payload?.delivery || {};
  const selectedId = state.selected?.instrument_id;
  const available = context.context_available === true
    && ["fresh", "current"].includes(String(context.context_state || "").toLowerCase())
    && delivery.freshness_state === "fresh"
    && delivery.fallback === false
    && exactInstrumentMatch(payload?.instrument?.instrument_id, selectedId)
    && exactInstrumentMatch(context.instrument_id, selectedId);
  if (!available) {
    if (renderPerpOpportunityFallback(opportunityEvidence, { updateUrl, generatedAt: opportunityGeneratedAt })) return;
    const staleEvidenceWithheld = context.context_available === true
      && (!["fresh", "current"].includes(String(context.context_state || "").toLowerCase()) || delivery.freshness_state !== "fresh");
    setContextUnavailable();
    if (staleEvidenceWithheld) {
      state.context = {
        ...payload,
        raven_context: { ...context, context_available: false },
        stale_context_withheld: true,
      };
      state.planQualificationIssue = "evidence_not_current";
    }
    renderMarketAnatomy();
    updateShell({
      subject: perpSubject({ ...state.selected, instrument_id: payload?.instrument?.instrument_id || state.selected?.instrument_id }),
      marketLabel: `${state.selected?.asset || "Instrument"} market`,
      thesis: "",
      setup: "",
      supporting: [],
      contradicting: [],
      evidenceState: "",
      freshnessState: payload?.market_data?.freshness_state || "live",
      observedAt: payload?.market_data?.generated_at || null,
    }, { updateUrl });
    return;
  }
  const observationLabel = context.context_state === "fresh"
    ? "Current observation"
    : finite(context.context_age_seconds) !== null
      ? `Observed ${durationLabel(context.context_age_seconds)}`
      : "Timestamped observation";
  setContextControlsVisible(true, { kind: "Raven", trigger: "Raven Read" });
  setText("terminalReadHeadline", customerFacingText(read.headline, `${state.selected?.asset || "Instrument"} · current Raven read`));
  setReadNarrative(read.summary, read.why_raven_noticed || context.why_raven_noticed);
  setContextField("terminalBehavior", titleCase(context.behavior_family, ""), "Setup");
  setContextField("terminalPath", titleCase(context.current_path || context.pressure_state || context.context_state, ""), "Path");
  setContextField("terminalEvidenceMaturity", titleCase(context.outcomes?.evidence_maturity, ""), "Read strength");
  setText("terminalEvidenceState", context.context_age_seconds !== null && context.context_age_seconds !== undefined
    ? `Updated ${durationLabel(context.context_age_seconds)}`
    : observationLabel);
  setState("terminalContextFreshness", delivery.freshness_state || "unavailable", delivery.fallback ? `Earlier data · ${titleCase(delivery.freshness_state)}` : delivery.freshness_state === "fresh" ? "Current" : titleCase(delivery.freshness_state));
  renderDecisionSupport({
    changed: read.summary,
    strengthens: read.what_would_strengthen,
    weakens: read.what_would_weaken,
    checkpoint: opportunityEvidence?.path_review?.state,
    reference: opportunityReference(opportunityEvidence) || context.public_context_id,
    scope: payload?.instrument?.instrument_id || state.selected?.instrument_id,
    observed: context.observed_at || payload?.market_data?.generated_at,
  });
  renderComparables(payload?.matured_comparables || {}, {
    horizon: payload?.plan_preview?.review_horizon,
    instrument: payload?.instrument?.instrument || state.selected?.asset,
  });
  renderPlanPreview(payload?.plan_preview || {});
  applyContextChartEvent(payload);
  syncPlanActionSurfaces();
  renderMarketAnatomy();
  updateShell({
    subject: perpSubject({ ...state.selected, instrument_id: payload?.instrument?.instrument_id || state.selected?.instrument_id }),
    marketLabel: read.headline || `${state.selected?.asset} market`,
    thesis: customerFacingText(read.summary, "No exact Raven thesis is currently available."),
    setup: context.context_state || "observed",
    supporting: Array.isArray(read.what_would_strengthen) ? read.what_would_strengthen : [],
    contradicting: Array.isArray(read.what_would_weaken) ? read.what_would_weaken : [],
    evidenceState: context.outcomes?.evidence_maturity || "forming",
    freshnessState: delivery.freshness_state || "data_unavailable",
    freshnessLabel: "Raven read",
    observedAt: context.observed_at || payload?.market_data?.generated_at || null,
    nextTransition: opportunityEvidence?.path_review?.state,
  }, { updateUrl });
  renderAlphaStack();
}

function sameSelectedAddress(chain, left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  return String(chain || "").toLowerCase() === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

function spotContextFromRadar(radarRow, row) {
  const discovery = radarRow?.discovery;
  const identity = discovery?.exact_identity;
  const evidence = discovery?.raven_evidence_state;
  const chain = String(row?.chainId || "").toLowerCase();
  if (
    !radarRow
    || !exactInstrumentMatch(radarRow.instrument_id, `${chain}:pool:${row?.pairAddress || ""}`)
    || !sameSelectedAddress(chain, identity?.pool_address, row?.pairAddress)
    || !sameSelectedAddress(chain, identity?.token_address, row?.tokenAddress)
    || evidence?.qualified !== true
    || evidence?.raven_signal !== true
  ) return null;
  const decision = discovery.decision_support || {};
  const behavior = discovery.primary_behavior_state || {};
  const contradictions = Array.isArray(evidence.contradictions) ? evidence.contradictions : [];
  return {
    schema_version: "ravenos.spot_market_context.v1",
    state: "current",
    evidence_scope: "exact_pool",
    scope_label: "This exact pool",
    chain,
    token_address: identity.token_address,
    selected_pool_address: identity.pool_address,
    evidence_pool_address: identity.pool_address,
    symbol: radarRow.symbol || row.symbol,
    name: radarRow.name || row.name,
    observed_at: evidence.observed_at,
    movement_state: titleCase(behavior.value, "Raven observation"),
    what_changed: customerFacingText(evidence.what_changed || decision.what_changed, ""),
    risk: operatorList(contradictions, ""),
    raven_why: customerFacingText(decision.why_now || evidence.why_raven_noticed, ""),
    timing_lead_seconds: Number.isFinite(Number(evidence.timing_lead_seconds))
      ? Math.max(0, Math.floor(Number(evidence.timing_lead_seconds)))
      : null,
    behavioral_evidence: Array.isArray(evidence.behavioral_evidence) ? evidence.behavioral_evidence : [],
    confidence_maturity: evidence.confidence_maturity,
    decision_support: decision,
    public_reference: evidence.lineage?.public_artifact_id || null,
    research_only: true,
    actionable: false,
    execution_available: false,
    signing_available: false,
    submission_available: false,
  };
}

function providerSpotPlanContext(workspace, row) {
  const context = workspace?.marketAnatomy?.raven_context || {};
  const chain = String(row?.chainId || "").toLowerCase();
  const identityMatches = context.schema_version === "ravenos.spot_market_context.v1"
    && context.state === "current"
    && String(context.chain || "").toLowerCase() === chain
    && sameSelectedAddress(chain, context.token_address, row?.tokenAddress)
    && sameSelectedAddress(chain, context.selected_pool_address, row?.pairAddress)
    && (
      context.evidence_scope === "exact_token"
      || (context.evidence_scope === "exact_pool" && sameSelectedAddress(chain, context.evidence_pool_address, row?.pairAddress))
    );
  if (
    !identityMatches
    || context.research_only !== true
    || context.actionable !== false
    || context.execution_available !== false
    || context.signing_available !== false
    || context.submission_available !== false
    || !hasOperatorValue(context.what_changed)
  ) return null;
  return context;
}

function renderSpotContext(workspace, row, { updateUrl = true, radarEvidence = null } = {}) {
  const chain = String(row?.chainId || "").toLowerCase();
  const radarContext = spotContextFromRadar(radarEvidence, row);
  const workspaceContext = workspace?.marketAnatomy?.raven_context || {};
  const workspaceContextMatches = workspaceContext.schema_version === "ravenos.spot_market_context.v1"
    && workspaceContext.state === "current"
    && String(workspaceContext.chain || "").toLowerCase() === chain
    && sameSelectedAddress(chain, workspaceContext.token_address, row?.tokenAddress)
    && sameSelectedAddress(chain, workspaceContext.selected_pool_address, row?.pairAddress);
  const context = radarContext && workspaceContextMatches
    ? {
        ...workspaceContext,
        movement_state: radarContext.movement_state,
        what_changed: radarContext.what_changed,
        risk: radarContext.risk || workspaceContext.risk,
        raven_why: radarContext.raven_why,
        behavioral_evidence: radarContext.behavioral_evidence,
        confidence_maturity: radarContext.confidence_maturity,
        timing_lead_seconds: radarContext.timing_lead_seconds
          ?? (Number.isFinite(Number(workspaceContext.broader_attention?.lead_seconds))
            ? Math.max(0, Math.floor(Number(workspaceContext.broader_attention.lead_seconds)))
            : null),
        decision_support: radarContext.decision_support,
        public_reference: radarContext.public_reference,
      }
    : radarContext || {};
  const identityMatches = context.schema_version === "ravenos.spot_market_context.v1"
    && context.state === "current"
    && String(context.chain || "").toLowerCase() === chain
    && sameSelectedAddress(chain, context.token_address, row?.tokenAddress)
    && (
      context.evidence_scope === "exact_token"
      || (
        context.evidence_scope === "exact_pool"
        && sameSelectedAddress(chain, context.evidence_pool_address, row?.pairAddress)
      )
    );
  const available = identityMatches
    && context.research_only === true
    && context.actionable === false
    && context.execution_available === false
    && context.signing_available === false
    && context.submission_available === false
    && hasOperatorValue(context.what_changed);
  if (!available) {
    const planContext = providerSpotPlanContext(workspace, row);
    setContextUnavailable();
    if (planContext) {
      state.context = {
        spot_context: planContext,
        spot_identity_validated: false,
        spot_plan_identity_validated: true,
        selected_market_analysis_only: true,
      };
      refreshSpotStructurePlan();
    }
    updateShell({
      subject: spotSubject(row),
      marketLabel: `${row.symbol}/${row.quoteSymbol} exact pool`,
      thesis: "",
      setup: "",
      evidenceState: "",
      freshnessState: workspace?.state || "data_unavailable",
      freshnessLabel: workspace?.operatorStateLabel || "",
      observedAt: workspace?.observedAt || row.lastUpdated,
    }, { updateUrl });
    return false;
  }

  const observedMs = Date.parse(context.observed_at || "");
  const observedAge = Number.isFinite(observedMs)
    ? Math.max(0, Math.floor((Date.now() - observedMs) / 1_000))
    : null;
  const movement = customerFacingText(context.movement_state, "Activity changed");
  const behaviorWhy = customerFacingText(
    context.raven_why || context.what_changed,
    context.what_changed,
  );
  const timingLead = Number.isFinite(Number(context.timing_lead_seconds)) && Number(context.timing_lead_seconds) >= 60
    ? `Raven observed this ${durationLabel(Number(context.timing_lead_seconds)).replace(/\s+ago$/i, "")} before broader attention.`
    : "";
  const why = [behaviorWhy, timingLead]
    .filter((value, index, values) => value && !values.slice(0, index).some((prior) => prior.includes(value)))
    .join(" ");
  const risk = customerFacingText(context.risk, "");
  resetPlanPreview();
  state.context = {
    raven_context: {
      context_available: true,
      context_state: "current",
      observed_at: context.observed_at,
      evidence_scope: context.evidence_scope,
    },
    spot_context: context,
    radar_evidence: radarEvidence,
    spot_identity_validated: true,
  };
  state.opportunityEvidence = radarEvidence;
  setContextControlsVisible(true, { kind: "Raven", trigger: "Raven Read" });
  setWhyLabel("Current read");
  setText("terminalReadHeadline", `${row.symbol || context.symbol || "Token"} · ${movement}`);
  setReadNarrative(context.what_changed, why);
  setContextField("terminalBehavior", movement, "Setup");
  setContextField("terminalPath", risk, "Risk");
  setContextField("terminalEvidenceMaturity", titleCase(context.confidence_maturity, "") || risk, context.confidence_maturity ? "Read strength" : "Risk");
  setText(
    "terminalEvidenceState",
    observedAge === null ? "Current" : `Updated ${durationLabel(observedAge)}`,
  );
  setState("terminalContextFreshness", "fresh", "Current");
  renderDecisionSupport({
    changed: context.what_changed,
    strengthens: context.decision_support?.what_strengthens,
    weakens: context.decision_support?.what_weakens || context.risk,
    checkpoint: context.decision_support?.next_checkpoint,
    reference: context.public_reference,
    scope: context.scope_label,
    observed: context.observed_at,
  });
  resetComparableEvidence();
  refreshSpotStructurePlan();
  updateShell({
    subject: spotSubject(row, { ravenIntelligence: true }),
    marketLabel: `${row.symbol}/${row.quoteSymbol} exact pool`,
    thesis: why,
    setup: context.movement_state,
    supporting: [why, ...(context.behavioral_evidence || [])].filter(Boolean),
    contradicting: [
      ...(Array.isArray(context.decision_support?.what_weakens) ? context.decision_support.what_weakens : [context.decision_support?.what_weakens]),
      risk,
    ].filter(Boolean),
    evidenceState: context.confidence_maturity || "observed",
    freshnessState: workspace?.state || "live",
    freshnessLabel: workspace?.operatorStateLabel || "Raven read",
    observedAt: context.observed_at,
    nextTransition: context.decision_support?.next_checkpoint,
  }, { updateUrl });
  renderAlphaStack();
  return true;
}

function updateShell({ subject, marketLabel, thesis, setup, supporting = [], contradicting = [], invalidation = [], evidenceState, freshnessState, freshnessLabel = "", observedAt, nextTransition = "" }, { updateUrl = true } = {}) {
  ravenOSContext.setSelection({ subject, timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const hasIntelligence = Boolean(
    hasOperatorValue(thesis)
    || hasOperatorValue(setup)
    || supporting.length
    || contradicting.length
    || hasOperatorValue(evidenceState),
  );
  window.RavenOSShell?.setCapabilities?.({
    market: state.workspace?.state?.state === "live" ? `Live · ${state.workspace.state.source}` : titleCase(state.workspace?.state?.state),
    wallet: state.walletTransportConnected && state.walletAddress
      ? `${shortAccountAddress(state.walletAddress)} · public view`
      : browserWalletProvider() ? "Wallet ready · not connected" : "No wallet provider",
    mode: "Read only",
    signing: "Sign off",
    broadcast: "Broadcast off",
    evidence: evidenceState === "atlas_context" ? "Atlas context linked" : hasOperatorValue(evidenceState) ? "Exact evidence linked" : "",
  });
  window.RavenOSShell?.setIntelligence?.({
    subject,
    evidenceRole: "selected_market_context",
    marketState: { label: marketLabel || "Market data available", regime: state.lane },
    setupState: { state: setup || "market_data_only", confirmation: "read only" },
    thesis: customerFacingText(thesis, marketLabel || "Market data available"),
    supportingEvidence: supporting,
    contradictingEvidence: contradicting,
    invalidation,
    timeHorizon: state.timeframe,
    confidence: { label: evidenceState || "market_data_only" },
    evidenceQuality: {
      state: evidenceState || "market_data_only",
      lineageComplete: Boolean(
        state.context?.raven_context?.context_available
        || state.context?.atlas_context?.context_available
        || (state.context?.spot_identity_validated && state.context?.spot_context?.public_reference),
      ),
    },
    freshness: { state: freshnessState || "data_unavailable", label: freshnessLabel, observedAt },
    nextExpectedTransition: hasOperatorValue(nextTransition)
      ? nextTransition
      : hasIntelligence
      ? state.lane === "perps"
        ? "Watch for the next market or evidence transition."
        : state.lane === "equity"
          ? "Use the selected market and available Atlas context together."
          : "Use exact-pool market data and any admitted Raven marker separately."
      : "Continue monitoring the selected exact market.",
  });
  updateMonitorHandoff();
}

function solanaWalletProvider() {
  const provider = state.selectedSolanaWalletProvider || detectedSolanaWallets()[0]?.provider;
  return provider?.connect && provider?.publicKey !== undefined ? provider : null;
}

function solanaWalletAddress(value) {
  const address = String(value?.toString?.() || value || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
}

function shortSolanaAddress(value) {
  const address = String(value || "");
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
}

function spotTicketQualified() {
  const identity = currentProjectIdentity();
  return state.lane === "spot"
    && Array.isArray(state.flags?.spot_quote_preview_chains)
    && state.flags.spot_quote_preview_chains.includes(identity?.chain)
    && Boolean(identity.poolAddress && identity.tokenAddress && identity.quoteAddress)
    && state.flags?.spot_quote_preview_available === true;
}

function spotTicketIdentityAvailable() {
  const identity = currentProjectIdentity();
  return state.lane === "spot" && Boolean(identity?.chain && identity.poolAddress && identity.tokenAddress && identity.quoteAddress);
}

function nativeCurrencyForChain(chain) {
  return ({
    solana: "SOL",
    base: "ETH",
    ethereum: "ETH",
    bsc: "BNB",
    robinhood: "ETH",
    arbitrum: "ETH",
    optimism: "ETH",
    polygon: "POL",
    avalanche: "AVAX",
    tron: "TRX",
    sui: "SUI",
  })[String(chain || "").toLowerCase()] || "NATIVE";
}

function activeSpotAssetPreference(side = state.spotTicketSide) {
  const preferences = loadSpotTicketPreferences();
  const preference = side === "sell" ? preferences.settlement_preference : preferences.funding_preference;
  return evmSpotProfile() && side === "sell" && preference === "native" ? "canonical_usdc" : preference;
}

function selectedSpotAssetKind(side = state.spotTicketSide) {
  return activeSpotAssetPreference(side) === "native" ? "native" : "canonical_usdc";
}

function activeSpotBuySizeConfig() {
  const native = selectedSpotAssetKind("buy") === "native";
  const preferences = loadSpotTicketPreferences();
  return {
    key: native ? "buy_sizes_native" : "buy_sizes_usdc",
    values: native ? preferences.buy_sizes_native : preferences.buy_sizes_usdc,
    defaults: native ? DEFAULT_SPOT_NATIVE_BUY_SIZES : DEFAULT_SPOT_BUY_SIZES,
    symbol: native ? nativeCurrencyForChain(currentProjectIdentity()?.chain) : spotAccountingSymbol(),
    native,
  };
}

function syncSpotAssetPreferenceControls() {
  const identity = currentProjectIdentity();
  const nativeSymbol = nativeCurrencyForChain(identity?.chain);
  const side = state.spotTicketSide === "sell" ? "sell" : "buy";
  const preference = activeSpotAssetPreference(side);
  const selectedKind = selectedSpotAssetKind(side);
  setText("terminalSpotAssetPreferenceLabel", side === "buy" ? "Pay" : "Receive");
  setText("terminalSpotNativeAssetLabel", nativeSymbol);
  const preferenceState = document.getElementById("terminalSpotAssetPreferenceState");
  if (preferenceState) preferenceState.hidden = preference !== "auto" || !spotTicketQualified();
  setText("terminalSpotAssetPreferenceState", `→ ${spotAccountingSymbol(identity?.chain)}`);
  for (const button of document.querySelectorAll("[data-spot-asset-preference]")) {
    const active = button.dataset.spotAssetPreference === preference;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !spotTicketQualified()
      || (Boolean(evmSpotProfile(identity?.chain)) && side === "sell" && button.dataset.spotAssetPreference === "native");
  }
}

function setSpotAssetPreference(preference) {
  const next = spotAssetPreference(preference);
  if (evmSpotProfile() && state.spotTicketSide === "sell" && next === "native") return;
  const key = state.spotTicketSide === "sell" ? "settlement_preference" : "funding_preference";
  saveSpotTicketPreferences({ [key]: next });
  setText("terminalSpotBalance", currentSpotWallet().connected ? "Read on quote" : "Not verified");
  const input = document.getElementById("terminalSpotAmount");
  if (input && state.spotTicketSide === "buy") input.value = String(activeSpotBuySizeConfig().values[1]);
  syncSpotAssetPreferenceControls();
  renderSpotQuickSizes();
  syncSpotTicketControls();
  clearSpotQuoteResult(`${next === "auto" ? "Auto" : next === "native" ? nativeCurrencyForChain(currentProjectIdentity()?.chain) : spotAccountingSymbol()} selected. Review a new route.`);
}

function updateSpotExecutionRail({ quoted = false, exitVerified = false } = {}) {
  const connected = currentSpotWallet().connected;
  const liveAvailable = currentSpotLiveGate()?.available_to_principal === true;
  const ticketReady = Boolean(state.spotLiveTicket && Date.parse(state.spotLiveTicket.expires_at || "") > Date.now() + 500);
  const submitted = state.spotLiveResult?.ok === true;
  for (const item of document.querySelectorAll("#terminalSpotExecutionRail [data-terminal-step]")) {
    const step = item.dataset.terminalStep;
    delete item.dataset.state;
    if (step === "connect" && connected) item.dataset.state = "complete";
    if (step === "quote" && quoted) item.dataset.state = "complete";
    if (step === "review" && exitVerified) item.dataset.state = "complete";
    else if (step === "review" && quoted) item.dataset.state = "current";
    if (step === "sign") {
      item.setAttribute("aria-disabled", String(!liveAvailable || !ticketReady));
      if (ticketReady) item.dataset.state = "current";
      if (submitted) item.dataset.state = "complete";
      const note = item.querySelector("small");
      if (note) note.textContent = liveAvailable ? ticketReady ? "Wallet" : "After prepare" : "Locked";
    }
    if (step === "send") {
      item.setAttribute("aria-disabled", String(!liveAvailable || !submitted));
      if (submitted) item.dataset.state = state.spotLiveResult?.reconciliation?.state === "provider_confirmed" ? "complete" : "current";
      const note = item.querySelector("small");
      if (note) note.textContent = liveAvailable ? submitted ? "Reconciled" : "After sign" : "Locked";
    }
  }
}

function setSpotTicketExitSummary(summaryState = "idle", label = "Not reviewed", note = "Request a current route") {
  const root = document.getElementById("terminalSpotExitSummary");
  if (root) root.dataset.state = summaryState;
  setText("terminalSpotExitCompact", label);
  setText("terminalSpotExitCompactNote", note);
  if (root) root.title = note;
}

function clearSpotQuoteResult(message = "Select a size and review a current route. Nothing will be submitted.", { invalidate = true, stopFollowing = true } = {}) {
  if (invalidate) state.spotQuoteGeneration += 1;
  state.spotQuoteAbortController?.abort?.();
  state.spotQuoteAbortController = null;
  state.spotQuote = null;
  state.spotQuoteStatus = "idle";
  state.spotQuoteExpiresAt = 0;
  state.spotQuoteFingerprint = "";
  state.spotLiveTicket = null;
  state.spotLiveUnsignedTransaction = null;
  state.spotLiveProviderQuote = null;
  state.spotLiveResult = null;
  clearTimeout(state.spotQuoteExpiryTimer);
  state.spotQuoteExpiryTimer = null;
  clearSpotQuoteRefresh();
  if (stopFollowing) state.spotQuoteFollow = false;
  syncSpotQuoteFollowControl();
  const result = document.getElementById("terminalSpotQuoteResult");
  if (result) {
    result.hidden = true;
    delete result.dataset.state;
  }
  setText("terminalSpotQuoteState", spotTicketQualified() ? "Ready to review" : spotTicketIdentityAvailable() ? "Adapter pending" : "Unavailable");
  setText("terminalSpotQuoteMessage", message);
  setSpotTicketExitSummary();
  updateSpotExecutionRail();
  renderSpotLiveExecution();
}

function syncSpotAdvancedSummary() {
  const source = {
    raven_exact_market: "Raven plan",
    user_preset: "Preset",
    custom: "Custom plan",
  }[state.spotTicketPlanSource] || "Preset";
  const slippage = finite(document.getElementById("terminalSpotSlippage")?.value) ?? loadSpotTicketPreferences().slippage_bps;
  setText("terminalSpotAdvancedState", `${source} · ${(slippage / 100).toFixed(2)}% slippage`);
}

function renderSpotQuickSizes() {
  const preferences = loadSpotTicketPreferences();
  const sizeConfig = activeSpotBuySizeConfig();
  const host = document.getElementById("terminalSpotBuyPresets");
  if (host) {
    host.replaceChildren(...sizeConfig.values.map((amount) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.spotBuyAmount = String(amount);
      button.textContent = sizeConfig.native ? `${amount} ${sizeConfig.symbol}` : `$${amount}`;
      button.addEventListener("click", () => {
        const input = document.getElementById("terminalSpotAmount");
        if (input) {
          input.disabled = false;
          input.value = String(amount);
          input.placeholder = "";
        }
        state.spotSellPercent = null;
        clearSpotQuoteResult("Quick-buy size selected. Review a current exact route.");
      });
      return button;
    }));
  }
  for (const input of document.querySelectorAll("[data-spot-buy-size-index]")) {
    const index = Number(input.dataset.spotBuySizeIndex);
    input.value = String(sizeConfig.values[index] ?? sizeConfig.defaults[index]);
    input.min = sizeConfig.native ? "0.001" : "1";
    input.max = sizeConfig.native ? "50" : "100000";
    input.step = sizeConfig.native ? "0.001" : "1";
  }
  setText("terminalSpotQuickSizeLabel", `Customize ${sizeConfig.symbol} sizes`);
  const tp = document.getElementById("terminalSpotTakeProfitPct");
  const sl = document.getElementById("terminalSpotStopLossPct");
  const slippage = document.getElementById("terminalSpotSlippage");
  const priority = document.getElementById("terminalSpotPriorityMode");
  const cap = document.getElementById("terminalSpotPriorityCap");
  if (tp) tp.value = String(preferences.take_profit_pct);
  if (sl) sl.value = String(preferences.stop_loss_pct);
  if (slippage && [...slippage.options].some((option) => Number(option.value) === preferences.slippage_bps)) slippage.value = String(preferences.slippage_bps);
  if (priority) priority.value = preferences.priority_mode;
  if (cap) cap.value = String(preferences.priority_cap_lamports);
  syncSpotAdvancedSummary();
}

function qualifiedSpotRavenPlan() {
  if (state.lane !== "spot") return null;
  const validated = qualifiedPlanData();
  return validated && validated.plan?.instrument_id === activeChartEvidenceInstrumentId() ? validated : null;
}

function syncSpotPlanSource() {
  const raven = qualifiedSpotRavenPlan();
  const ravenButton = document.querySelector('[data-spot-plan-source="raven_exact_market"]');
  if (ravenButton) ravenButton.disabled = !raven;
  if (!raven && state.spotTicketPlanSource === "raven_exact_market") state.spotTicketPlanSource = "user_preset";
  for (const button of document.querySelectorAll("[data-spot-plan-source]")) {
    const active = button.dataset.spotPlanSource === state.spotTicketPlanSource;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const preset = document.getElementById("terminalSpotPresetInputs");
  const custom = document.getElementById("terminalSpotCustomInputs");
  const receipt = document.getElementById("terminalSpotRavenPlanReceipt");
  if (preset) preset.hidden = state.spotTicketPlanSource !== "user_preset";
  if (custom) custom.hidden = state.spotTicketPlanSource !== "custom";
  if (receipt) receipt.hidden = state.spotTicketPlanSource !== "raven_exact_market" || !raven;
  if (raven) {
    const targets = raven.takeProfits.length ? raven.takeProfits : [raven.levels.target_reference];
    setText("terminalSpotRavenPlanLevels", `${targets.map((row) => formatPrice(row.price)).join(" / ")} · risk ${formatPrice(raven.levels.risk_reference.price)}`);
    setText("terminalSpotRavenPlanObserved", `${raven.plan.evidence_label || `${raven.sample} paths`} · observed ${timestamp(raven.plan.as_of)} · research only`);
  }
  const notes = {
    raven_exact_market: "Raven's original exact-market levels remain visible even if you later switch to your own plan.",
    user_preset: "Your percentages are stored only on this device and stay separate from Raven research.",
    custom: "Your exact prices are local ticket inputs. RavenOS will never relabel them as a Raven suggestion.",
  };
  setText("terminalSpotPlanSourceNote", notes[state.spotTicketPlanSource]);
  syncSpotAdvancedSummary();
}

function setSpotPlanSource(source) {
  const next = SPOT_PLAN_SOURCES.has(source) ? source : "user_preset";
  if (next === "raven_exact_market" && !qualifiedSpotRavenPlan()) return;
  state.spotTicketPlanSource = next;
  syncSpotPlanSource();
  clearSpotQuoteResult("Exit-plan source changed. Review the exact route again.");
}

function spotPlanRequest() {
  const source = SPOT_PLAN_SOURCES.has(state.spotTicketPlanSource) ? state.spotTicketPlanSource : "user_preset";
  if (source === "raven_exact_market") {
    const raven = qualifiedSpotRavenPlan();
    if (!raven) return { source: "unavailable" };
    return {
      source,
      instrument_id: raven.plan.instrument_id,
      plan_id: raven.plan.plan_id,
      observed_at: raven.plan.as_of,
      entry_reference_price: raven.levels.entry_reference.price,
      take_profit_prices: (raven.takeProfits.length ? raven.takeProfits : [raven.levels.target_reference]).map((row) => row.price),
      stop_loss_price: raven.levels.risk_reference.price,
      research_only: true,
      authorizes_transaction: false,
    };
  }
  if (source === "custom") {
    return {
      source,
      take_profit_price: finite(document.getElementById("terminalSpotTakeProfitPrice")?.value),
      stop_loss_price: finite(document.getElementById("terminalSpotStopLossPrice")?.value),
      authorizes_transaction: false,
    };
  }
  return {
    source: "user_preset",
    preset_id: "local_default",
    preset_version: 1,
    take_profit_pct: finite(document.getElementById("terminalSpotTakeProfitPct")?.value),
    stop_loss_pct: finite(document.getElementById("terminalSpotStopLossPct")?.value),
    authorizes_transaction: false,
  };
}

function spotTicketSnapshot() {
  const identity = currentProjectIdentity();
  if (!identity) return null;
  const chain = identity.chain;
  const evm = chain !== "solana";
  const normalizeAddress = (value) => evm ? String(value || "").toLowerCase() : value;
  const wallet = currentSpotWallet();
  const slippageBps = finite(document.getElementById("terminalSpotSlippage")?.value) || 50;
  const priorityMode = document.getElementById("terminalSpotPriorityMode")?.value === "capped" ? "capped" : "standard";
  const priorityCap = finite(document.getElementById("terminalSpotPriorityCap")?.value) || 10_000;
  const amount = document.getElementById("terminalSpotAmount")?.value;
  return {
    schema_version: "ravenos.universal_shadow_quote_request.v1",
    instrument_id: `${chain}:pool:${normalizeAddress(identity.poolAddress)}`,
    identity_scope: "exact_pool",
    chain,
    pool_address: normalizeAddress(identity.poolAddress),
    token_address: normalizeAddress(identity.tokenAddress),
    quote_address: normalizeAddress(identity.quoteAddress),
    side: state.spotTicketSide,
    funding_preference: activeSpotAssetPreference("buy"),
    settlement_preference: activeSpotAssetPreference("sell"),
    display_amount: state.spotSellPercent ? null : String(amount || ""),
    sell_percent: state.spotTicketSide === "sell" ? state.spotSellPercent : null,
    wallet_address: wallet.connected ? wallet.address : null,
    slippage_bps: slippageBps,
    priority: {
      mode: priorityMode,
      maximum_lamports: priorityMode === "capped" ? priorityCap : null,
      jito: false,
    },
    plan: spotPlanRequest(),
  };
}

function spotTicketFingerprint(snapshot = spotTicketSnapshot()) {
  return snapshot ? JSON.stringify(snapshot) : "";
}

function spotQuoteStillCurrent() {
  return Boolean(
    state.spotQuote
    && state.spotQuoteStatus === "current"
    && state.spotQuoteExpiresAt > Date.now()
    && state.spotQuoteFingerprint
    && state.spotQuoteFingerprint === spotTicketFingerprint(),
  );
}

function syncSpotQuoteFollowControl() {
  const control = document.getElementById("terminalSpotQuoteFollow");
  const available = currentSpotChain() === "solana";
  if (!available) state.spotQuoteFollow = false;
  if (control) {
    control.checked = state.spotQuoteFollow;
    control.disabled = !available;
  }
  setText("terminalSpotQuoteAutoState", available ? state.spotQuoteFollow ? "Keeps this ticket current" : "Off" : "Refresh before signing");
}

function clearSpotQuoteRefresh() {
  clearTimeout(state.spotQuoteRefreshTimer);
  state.spotQuoteRefreshTimer = null;
}

function spotQuoteSurfaceActive() {
  if (document.hidden || !spotTicketQualified()) return false;
  if (!terminalUsesPaneNavigation()) return true;
  return (document.querySelector(".terminal-live")?.dataset.terminalPane || "chart") === "trade";
}

function scheduleSpotQuoteRefresh() {
  clearSpotQuoteRefresh();
  if (currentSpotChain() !== "solana") return;
  if (!state.spotQuoteFollow || !spotQuoteStillCurrent() || !spotQuoteSurfaceActive()) return;
  const expectedFingerprint = state.spotQuoteFingerprint;
  const delay = Math.max(250, state.spotQuoteExpiresAt - Date.now() - 3_000);
  setText("terminalSpotQuoteAutoState", `Following · refreshes before expiry`);
  state.spotQuoteRefreshTimer = setTimeout(() => {
    state.spotQuoteRefreshTimer = null;
    if (
      state.spotQuoteFollow
      && expectedFingerprint === state.spotQuoteFingerprint
      && expectedFingerprint === spotTicketFingerprint()
      && spotQuoteSurfaceActive()
    ) void requestSpotQuote({ automatic: true, expectedFingerprint });
  }, delay);
}

function spotQuoteResponseMatches(payload, snapshot) {
  if (!payload?.ok || payload?.review_available !== true || !snapshot) return false;
  const chain = snapshot.chain;
  const exact = payload?.intent?.exact_market || {};
  const sameIdentity = String(exact.instrument_id || "") === snapshot.instrument_id
    && sameSelectedAddress(chain, exact.pool_address, snapshot.pool_address)
    && sameSelectedAddress(chain, exact.token_address, snapshot.token_address)
    && sameSelectedAddress(chain, exact.quote_address, snapshot.quote_address)
    && String(payload?.intent?.side || "").toLowerCase() === snapshot.side;
  const requestedPreference = snapshot.side === "buy" ? snapshot.funding_preference : snapshot.settlement_preference;
  const selectedKind = requestedPreference === "native" ? "native" : "canonical_usdc";
  const evmProfile = evmSpotProfile(chain);
  const preference = payload?.asset_preference || {};
  const expectedOutputMint = snapshot.side === "buy"
    ? snapshot.token_address
    : evmProfile
      ? evmProfile.accounting_address
      : selectedKind === "native" ? SOLANA_WRAPPED_NATIVE_MINT : SOLANA_CANONICAL_USDC_MINT;
  const expectedInputMint = snapshot.side === "buy"
    ? evmProfile
      ? selectedKind === "native" ? EVM_NATIVE_ASSET : evmProfile.accounting_address
      : selectedKind === "native" ? SOLANA_WRAPPED_NATIVE_MINT : SOLANA_CANONICAL_USDC_MINT
    : snapshot.token_address;
  const inputMint = String(payload?.quote?.input_mint || payload?.intent?.input_mint || "");
  const outputMint = String(payload?.quote?.output_mint || payload?.intent?.output_mint || "");
  const fee = payload.fee_disclosure || payload.fee_policy || payload?.quote?.fee_policy || {};
  const configuredFeeBps = finite(fee.configured?.fee_bps ?? fee.configured_fee_bps);
  const actualFeeBps = finite(fee.actual?.fee_bps ?? fee.actual_fee_bps ?? fee.fee_bps);
  const expiresAt = spotQuoteEffectiveExpiry(payload);
  return sameIdentity
    && preference.requested === requestedPreference
    && preference.selected === selectedKind
    && sameSelectedAddress(chain, inputMint, expectedInputMint)
    && sameSelectedAddress(chain, outputMint, expectedOutputMint)
    && configuredFeeBps !== null
    && actualFeeBps !== null
    && (!evmProfile || spotLiveTicketMatchesCurrentTrade(payload.ticket))
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now();
}

function spotQuoteEffectiveExpiry(payload) {
  const values = [
    payload?.ticket?.expires_at,
    payload?.provider_quote?.expires_at,
    payload?.timing?.expires_at,
    payload?.quote?.expires_at,
    payload?.shadow_execution?.round_trip?.expires_at,
    payload?.shadow_execution?.entry_route?.expires_at,
    payload?.shadow_execution?.exit_route?.expires_at,
    payload?.shadow_execution?.source_valuation_route?.expires_at,
  ].filter((value) => value !== null && value !== undefined && String(value).trim());
  if (!values.length) return Number.NaN;
  const parsed = values.map((value) => Date.parse(value));
  return parsed.every(Number.isFinite) ? Math.min(...parsed) : Number.NaN;
}

function syncSpotTicketControls() {
  const identity = currentProjectIdentity();
  const identityAvailable = spotTicketIdentityAvailable();
  const qualified = spotTicketQualified();
  const section = document.getElementById("terminalSpotTicketSection");
  if (section) section.hidden = !identityAvailable;
  if (!identityAvailable) {
    clearSpotQuoteResult("Select a verified exact pool to open its chain-specific trade ticket.", { invalidate: true });
    return;
  }
  const side = state.spotTicketSide === "sell" ? "sell" : "buy";
  const symbol = String(state.selected?.symbol || "TOKEN").toUpperCase();
  const nativeSymbol = nativeCurrencyForChain(identity?.chain);
  const assetPreference = activeSpotAssetPreference(side);
  const selectedAssetKind = selectedSpotAssetKind(side);
  const selectedAssetSymbol = selectedAssetKind === "native" ? nativeSymbol : spotAccountingSymbol(identity?.chain);
  setText("terminalSpotTicketEyebrow", `${chainDisplayName(identity?.chain)} · ${qualified ? "route review" : "trading status"}`);
  if (section) section.dataset.adapterState = qualified ? "active" : "pending";
  const adapterNotice = document.getElementById("terminalSpotAdapterNotice");
  if (adapterNotice) adapterNotice.hidden = qualified;
  if (!qualified) {
    setText("terminalSpotAdapterTitle", `${chainDisplayName(identity?.chain)} route pending`);
    setText("terminalSpotAdapterCopy", "Charts and wallet data are live. Trading is not.");
  }
  const buyPresets = document.getElementById("terminalSpotBuyPresets");
  const sellPresets = document.getElementById("terminalSpotSellPresets");
  if (buyPresets) buyPresets.hidden = side !== "buy";
  if (sellPresets) sellPresets.hidden = side !== "sell";
  setText("terminalSpotTicketTitle", qualified
    ? side === "buy"
      ? `Buy ${symbol} with ${assetPreference === "auto" ? "Auto" : selectedAssetSymbol}`
      : `Sell ${symbol} to ${assetPreference === "auto" ? "Auto" : selectedAssetSymbol}`
    : `${chainDisplayName(identity?.chain)} trade adapter`);
  setText("terminalSpotAmountLabel", side === "buy" ? "Spend" : "Sell amount");
  setText("terminalSpotAmountUnit", side === "buy" ? selectedAssetSymbol : symbol);
  setText("terminalSpotBalanceUnit", side === "buy" ? selectedAssetSymbol : symbol);
  setText("terminalSpotQuoteOutputLabel", side === "buy" ? "Expected token" : `Expected ${selectedAssetSymbol}`);
  const quoteStep = document.querySelector('#terminalSpotExecutionRail [data-terminal-step="quote"] strong');
  const reviewStep = document.querySelector('#terminalSpotExecutionRail [data-terminal-step="review"] small');
  if (quoteStep) quoteStep.textContent = side === "buy" ? "Buy quote" : "Sell quote";
  if (reviewStep) reviewStep.textContent = side === "buy" ? `Back to ${spotAccountingSymbol(identity?.chain)}` : `To ${selectedAssetSymbol}`;
  const action = document.getElementById("terminalSpotQuoteAction");
  if (action) {
    action.textContent = qualified ? side === "buy" ? "Review buy + exit" : `Review ${selectedAssetSymbol} exit` : `${chainDisplayName(identity?.chain)} route pending`;
    action.disabled = !qualified;
  }
  syncSpotAssetPreferenceControls();
  for (const button of document.querySelectorAll("[data-spot-side]")) {
    const active = button.dataset.spotSide === side;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll("[data-spot-sell-pct]")) button.disabled = !currentSpotWallet().connected;
  const amountInput = document.getElementById("terminalSpotAmount");
  if (amountInput) {
    amountInput.disabled = !qualified || side === "sell";
    amountInput.placeholder = side === "sell" ? "Choose a wallet percentage below" : "";
    if (side === "buy") {
      amountInput.min = selectedAssetKind === "native" ? "0.001" : "1";
      amountInput.max = selectedAssetKind === "native" ? "50" : "100000";
      amountInput.step = selectedAssetKind === "native" ? "0.001" : "1";
    }
  }
  const walletButton = document.getElementById("terminalSpotWalletConnect");
  if (walletButton) walletButton.disabled = !qualified;
  const feePreview = evmSpotProfile(identity?.chain) ? state.flags?.evm_fee_preview?.chains?.[identity.chain] || state.flags?.evm_fee_preview || {} : state.flags?.spot_fee_preview || {};
  if (qualified) {
    if (state.spotQuoteStatus === "idle" && !state.spotQuote) setText("terminalSpotQuoteState", "Ready to review");
    const freeFeeBps = finite(feePreview.free_fee_bps);
    const proFeeBps = finite(feePreview.pro_fee_bps);
    const proDiscount = finite(feePreview.pro_discount_pct);
    setText("terminalSpotActiveFee", freeFeeBps === null ? "Shown before review" : `Free · ${(freeFeeBps / 100).toFixed(2)}%`);
    setText("terminalSpotProFee", proFeeBps === null ? "Pro rate unavailable" : `${(proFeeBps / 100).toFixed(2)}%${proDiscount === null ? "" : ` · ${Math.round(proDiscount)}% lower`}`);
    setText("terminalSpotFeeCompact", freeFeeBps === null ? "At review" : `${(freeFeeBps / 100).toFixed(2)}%`);
    setText("terminalSpotFeeCompactNote", proFeeBps === null
      ? "Exact cost shown in review"
      : `Pro ${(proFeeBps / 100).toFixed(2)}% · ${feePreview.enabled === true ? "included in review" : "not charged in preview"}`);
    setText("terminalSpotFeeNote", feePreview.enabled === true
      ? "The server-enforced Raven fee is included in every current review before signing."
      : "The configured Raven fee is visible now; quote/review mode currently charges 0 bps.");
  }
  if (!qualified) {
    const adapterState = state.flags?.trade_adapter_states?.[identity?.chain] || "adapter_pending";
    setText("terminalSpotQuoteState", titleCase(adapterState, "Adapter pending"));
    setText("terminalSpotQuoteMessage", `${chainDisplayName(identity?.chain)} route unavailable.`);
    setText("terminalSpotActiveFee", "Shown when adapter qualifies");
    setText("terminalSpotProFee", "Pro discount preserved");
    setText("terminalSpotFeeCompact", "Pending");
    setText("terminalSpotFeeCompactNote", "Shown when route qualifies");
  }
  syncSpotPlanSource();
  updateSpotExecutionRail({ quoted: spotQuoteStillCurrent(), exitVerified: spotQuoteStillCurrent() && state.spotQuote?.shadow_execution?.round_trip?.exit_verified === true });
  syncSpotQuoteFollowControl();
  renderSpotLiveExecution();
}

function setSpotTicketSide(side) {
  const next = side === "sell" ? "sell" : "buy";
  state.spotTicketSide = next;
  state.spotSellPercent = null;
  setText("terminalSpotBalance", currentSpotWallet().connected ? "Read on quote" : "Not verified");
  const advanced = document.getElementById("terminalSpotAdvanced");
  if (advanced && next === "sell") advanced.open = true;
  const input = document.getElementById("terminalSpotAmount");
  if (input) {
    input.disabled = next === "sell";
    input.placeholder = next === "sell" ? "Choose a wallet percentage below" : "";
    input.value = next === "buy" ? String(activeSpotBuySizeConfig().values[1]) : "";
  }
  renderSpotQuickSizes();
  syncSpotTicketControls();
  clearSpotQuoteResult(`${next === "buy" ? "Buy" : "Sell"} selected. Review a new exact route.`);
}

async function connectSolanaWalletReadOnly() {
  if (state.solanaWalletConnected) {
    state.solanaWalletConnected = false;
    state.solanaWalletAddress = null;
    setText("terminalSpotWalletState", "Not connected");
    setText("terminalSpotWalletNote", "Local address cleared. RavenOS retained no wallet permission.");
    setText("terminalSpotBalance", "Connect wallet");
    const button = document.getElementById("terminalSpotWalletConnect");
    if (button) button.textContent = "Connect";
    syncSpotTicketControls();
    syncWalletControls();
    updateWalletShellCapability();
    clearSpotQuoteResult("Wallet view disconnected. Existing quote review was cleared.");
    return;
  }
  const provider = await chooseExternalWallet("solana");
  if (!provider) return;
  state.selectedSolanaWalletProvider = provider;
  setText("terminalSpotWalletState", "Requesting address…");
  try {
    const result = await provider.connect();
    const address = solanaWalletAddress(result?.publicKey || provider.publicKey);
    if (!address) throw new Error("solana_wallet_address_unavailable");
    state.solanaWalletAddress = address;
    state.solanaWalletConnected = true;
    setText("terminalSpotWalletState", shortSolanaAddress(address));
    setText("terminalSpotWalletNote", state.liveSession?.gate?.chains?.solana?.available_to_principal === true
      ? "Address connected. A signature is requested only after you prepare and confirm an exact trade."
      : "Read-only address connected for exact-token balance sizing. No signature permission was requested.");
    setText("terminalSpotBalance", "Read on quote");
    const button = document.getElementById("terminalSpotWalletConnect");
    if (button) button.textContent = "Clear";
    syncSpotTicketControls();
    syncWalletControls();
    updateWalletShellCapability();
    clearSpotQuoteResult("Wallet address connected. Review a current exact route.");
  } catch {
    state.solanaWalletConnected = false;
    state.solanaWalletAddress = null;
    setText("terminalSpotWalletState", "Connection canceled");
    setText("terminalSpotWalletNote", "No address or permission was retained. Buy quotes remain available; percentage sells require a current exact-mint balance.");
    syncSpotTicketControls();
    syncWalletControls();
    updateWalletShellCapability();
  }
}

async function connectEvmSpotWalletReadOnly() {
  if (state.walletTransportConnected) {
    clearConnectedWalletView("Wallet address cleared from this tab.");
    setText("terminalSpotWalletState", "Not connected");
    setText("terminalSpotWalletNote", "Raven retained no wallet permission.");
    setText("terminalSpotBalance", "Connect wallet");
    clearSpotQuoteResult("Wallet disconnected. Review was cleared.");
    return;
  }
  const provider = await chooseExternalWallet("evm");
  if (!provider) return;
  state.selectedEvmWalletProvider = provider;
  initializeWalletAddressControl();
  setText("terminalSpotWalletState", "Requesting address…");
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = browserWalletAddress(accounts);
    if (!address) throw new Error("wallet_address_unavailable");
    state.walletAddress = address;
    state.walletTransportConnected = true;
    setText("terminalSpotWalletState", shortAccountAddress(address));
    setText("terminalSpotWalletNote", currentSpotLiveGate()?.available_to_principal === true
      ? "Connected. Your wallet confirms the exact fee-bound transaction."
      : "Address connected. No signature requested.");
    setText("terminalSpotBalance", "Read on quote");
    const button = document.getElementById("terminalSpotWalletConnect");
    if (button) button.textContent = "Clear";
    syncSpotTicketControls();
    syncWalletControls();
    updateWalletShellCapability();
    clearSpotQuoteResult("Wallet connected. Review a current exact route.");
  } catch {
    state.walletTransportConnected = false;
    state.walletAddress = null;
    setText("terminalSpotWalletState", "Connection canceled");
    setText("terminalSpotWalletNote", "No address or permission was retained.");
    syncSpotTicketControls();
    syncWalletControls();
    updateWalletShellCapability();
  }
}

async function connectSpotWalletReadOnly() {
  return currentSpotChain() === "solana" ? connectSolanaWalletReadOnly() : connectEvmSpotWalletReadOnly();
}

function spotQuoteReason(reason) {
  const messages = {
    exact_market_unavailable: "The selected pool could not be revalidated. No alternate pool was used.",
    exact_market_identity_mismatch: "The quote response did not match this exact token, pool, and quote asset.",
    quote_provider_rate_limited: "The route provider is busy. Try again in a moment.",
    quote_provider_timeout: "The route provider did not answer before the quote deadline.",
    quote_provider_unavailable: "A current route is temporarily unavailable. No stale quote was shown.",
    amount_below_minimum: "Increase the amount before requesting a route.",
    amount_above_maximum: "Reduce the amount before requesting a route.",
    sell_balance_required: "Connect a wallet for percentage sizing or enter an exact token amount.",
    insufficient_balance: "That percentage or amount exceeds the current exact-token balance.",
    selected_mint_unavailable: "Token decimals could not be verified from the configured Solana RPC.",
    native_source_valuation_unavailable: "SOL entry value could not be verified against USDC. No partial route was shown.",
    jito_not_available: "Jito routing is not available in quote/review mode.",
    allowance_required: "This asset needs a separate 0x allowance first. No approval was created automatically.",
    robinhood_stock_token_trading_restricted: "Stock-token trading is unavailable in this terminal.",
    robinhood_native_sell_settlement_not_supported: "RH sells currently settle to USDG.",
    robinhood_chain_switch_failed: "Open Robinhood Chain in your wallet and try again.",
    evm_native_sell_settlement_not_supported: `Sells on ${chainDisplayName(currentSpotChain())} currently settle to ${spotAccountingSymbol()}.`,
    evm_chain_switch_failed: `Open ${chainDisplayName(currentSpotChain())} in your wallet and try again.`,
    bsc_live_execution_disabled: "BNB Chain trading is temporarily off.",
    bsc_accounting_asset_identity_unresolved: "BNB Chain settlement-token identity could not be verified.",
    base_live_execution_disabled: "Base trading is temporarily off.",
    base_accounting_asset_identity_unresolved: "Base USDC identity could not be verified.",
    ethereum_live_execution_disabled: "Ethereum trading is temporarily off.",
    ethereum_accounting_asset_identity_unresolved: "Ethereum USDC identity could not be verified.",
    insufficient_native_gas_balance: `Add ${nativeCurrencyForChain(currentSpotChain())} for this trade and its maximum network fee.`,
    recent_authentication_required: "Sign in again before preparing a live route.",
    live_execution_not_configured: "Wallet trading is not active for this session.",
    robinhood_live_execution_disabled: "Robinhood Chain trading is temporarily off.",
  };
  return messages[String(reason || "")] || "A current exact route is unavailable. Nothing was prepared.";
}

function displayQuoteAmount(value, fallbackSymbol = "") {
  if (value && typeof value === "object") {
    const amount = String(value.display ?? value.amount ?? "").trim();
    const symbol = String(value.symbol || fallbackSymbol).trim();
    return amount ? `${amount} ${symbol}`.trim() : "--";
  }
  return value == null || value === "" ? "--" : `${value} ${fallbackSymbol}`.trim();
}

function displayBaseUnitsClient(value, decimals) {
  const raw = String(value ?? "").trim();
  const places = Number(decimals);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(places) || places < 0 || places > 18) return null;
  const padded = raw.padStart(places + 1, "0");
  const whole = (places ? padded.slice(0, -places) : padded) || "0";
  const fraction = places ? padded.slice(-places).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeEvmSpotPreparePayload(payload, snapshot) {
  if (!payload?.ok || !new Set(["ravenos.evm_live_prepare_response.v1", "ravenos.robinhood_live_prepare_response.v1"]).has(payload?.schema_version)) return payload;
  const ticket = payload.ticket || {};
  const providerQuote = payload.provider_quote || {};
  const review = payload.review || {};
  const reviewed = ticket.reviewed_order || {};
  const requestedPreference = snapshot.side === "buy" ? snapshot.funding_preference : snapshot.settlement_preference;
  const selectedPreference = snapshot.side === "buy" && requestedPreference === "native" ? "native" : "canonical_usdc";
  const routeSources = Array.isArray(providerQuote.route?.fills)
    ? [...new Set(providerQuote.route.fills.map((row) => String(row?.source || "").trim()).filter(Boolean))]
    : [];
  const notional = finite(displayBaseUnitsClient(ticket.accounting?.notional_base_units, ticket.accounting?.decimals));
  const exitValue = finite(review.executable_exit?.display);
  const friction = snapshot.side === "buy" && notional > 0 && exitValue !== null
    ? Math.max(-100, Math.min(100, ((notional - exitValue) / notional) * 100))
    : null;
  const tokenBalance = displayBaseUnitsClient(review.token?.balance_base_units, review.token?.decimals);
  return {
    ...payload,
    review_available: true,
    intent: {
      exact_market: {
        instrument_id: snapshot.instrument_id,
        pool_address: snapshot.pool_address,
        token_address: snapshot.token_address,
        quote_address: snapshot.quote_address,
      },
      side: snapshot.side,
      input_mint: reviewed.sell_token,
      output_mint: reviewed.buy_token,
    },
    asset_preference: {
      requested: requestedPreference,
      selected: selectedPreference,
    },
    quote: {
      quote_id: providerQuote.provider_quote_id,
      input_mint: reviewed.sell_token,
      output_mint: reviewed.buy_token,
      expected_output_display: review.expected_output,
      minimum_output_display: review.minimum_output,
      price_impact_bps: null,
      route: { venues: routeSources },
      observed_at: providerQuote.observed_at,
      expires_at: ticket.expires_at,
    },
    timing: {
      quoted_at: providerQuote.observed_at,
      expires_at: ticket.expires_at,
      provider_latency_ms: null,
    },
    fee_disclosure: {
      configured_fee_bps: ticket.fee?.fee_bps,
      actual_fee_bps: ticket.fee?.fee_bps,
    },
    shadow_execution: {
      round_trip: {
        exit_verified: snapshot.side === "sell" || ticket.exit_proof?.verified === true,
        current_executable_liquidation_usdc: snapshot.side === "sell" ? finite(review.expected_output?.display) : exitValue,
        round_trip_friction_pct: friction,
        expires_at: ticket.expires_at,
      },
    },
    balance: snapshot.side === "sell" && tokenBalance !== null ? {
      available: true,
      amount: { display: tokenBalance, symbol: String(ticket.exact_market?.symbol || state.selected?.symbol || "TOKEN") },
    } : null,
  };
}

function scheduleSpotQuoteExpiry(payload) {
  clearTimeout(state.spotQuoteExpiryTimer);
  const quoteId = payload?.quote?.quote_id || payload?.quote?.canonical_quote_id || payload?.quote_id;
  const expiresAt = spotQuoteEffectiveExpiry(payload);
  const tick = () => {
    if (!state.spotQuote || (state.spotQuote?.quote?.quote_id || state.spotQuote?.quote?.canonical_quote_id || state.spotQuote?.quote_id) !== quoteId) return;
    const remaining = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
    if (remaining <= 0) {
      state.spotQuote = null;
      state.spotLiveTicket = null;
      state.spotLiveUnsignedTransaction = null;
      state.spotLiveProviderQuote = null;
      state.spotQuoteStatus = "expired";
      state.spotQuoteExpiresAt = 0;
      const result = document.getElementById("terminalSpotQuoteResult");
      if (result) result.dataset.state = "expired";
      setText("terminalSpotQuoteState", "Refresh quote");
      setText("terminalSpotQuoteTiming", "Quote expired · request a new exact route");
      setSpotTicketExitSummary("expired", "Expired", "Refresh the exact route");
      updateSpotExecutionRail();
      renderSpotLiveExecution();
      if (state.spotQuoteFollow && state.spotQuoteFingerprint === spotTicketFingerprint() && spotQuoteSurfaceActive()) {
        void requestSpotQuote({ automatic: true, expectedFingerprint: state.spotQuoteFingerprint });
      }
      return;
    }
    const seconds = Math.ceil(remaining / 1_000);
    setText("terminalSpotQuoteTiming", `Current for ${seconds}s · quoted ${timestamp(payload?.timing?.quoted_at || payload?.quote?.observed_at || payload?.observed_at)}`);
    setText("terminalSpotExitCompactNote", `Current for ${seconds}s`);
    state.spotQuoteExpiryTimer = setTimeout(tick, Math.min(1_000, remaining));
  };
  tick();
  scheduleSpotQuoteRefresh();
}

function renderSpotQuote(payload, clientRttMs, { snapshot, fingerprint } = {}) {
  if (!payload?.ok) {
    clearSpotQuoteResult(spotQuoteReason(payload?.unavailable_reason || payload?.error), { invalidate: false });
    setText("terminalSpotQuoteState", "Try again");
    setSpotTicketExitSummary("unavailable", "Unavailable", "No stale route shown");
    return;
  }
  if (!spotQuoteResponseMatches(payload, snapshot) || fingerprint !== spotTicketFingerprint()) {
    clearSpotQuoteResult("The route response no longer matches this exact ticket. No stale or substituted quote was shown.", { invalidate: true });
    setText("terminalSpotQuoteState", "Review again");
    setSpotTicketExitSummary("unavailable", "Review again", "Exact ticket changed");
    return;
  }
  state.spotQuote = payload;
  state.spotQuoteStatus = "current";
  state.spotQuoteFingerprint = fingerprint;
  state.spotQuoteExpiresAt = spotQuoteEffectiveExpiry(payload);
  const quote = payload.quote || {};
  const chain = snapshot?.chain || currentSpotChain();
  const evmProfile = evmSpotProfile(chain);
  const outputMint = String(quote.output_mint || payload?.intent?.output_mint || "");
  const outputSymbol = evmProfile && sameSelectedAddress(chain, outputMint, evmProfile.accounting_address)
    ? evmProfile.accounting_symbol
    : evmProfile && sameSelectedAddress(chain, outputMint, EVM_NATIVE_ASSET)
      ? evmProfile.native_symbol
      : sameSelectedAddress("solana", outputMint, SOLANA_CANONICAL_USDC_MINT)
        ? "USDC"
        : sameSelectedAddress("solana", outputMint, SOLANA_WRAPPED_NATIVE_MINT)
          ? "SOL"
          : String(state.selected?.symbol || "TOKEN");
  setText("terminalSpotQuoteOutput", displayQuoteAmount(quote.expected_output_display ?? quote.expected_output ?? quote.output, outputSymbol));
  setText("terminalSpotQuoteMinimum", `Minimum ${displayQuoteAmount(quote.minimum_output_display ?? quote.minimum_output ?? quote.minimum, outputSymbol)}`);
  setText("terminalSpotQuoteImpact", finite(quote.price_impact_bps) === null ? "Not reported" : `${Number(quote.price_impact_bps).toFixed(2)} bps`);
  const labels = Array.isArray(quote.route?.venues)
    ? quote.route.venues
    : Array.isArray(quote.route_labels)
      ? quote.route_labels
      : Array.isArray(quote.route)
        ? quote.route
        : [];
  setText("terminalSpotQuoteRoute", labels.length ? labels.slice(0, 3).join(" → ") : evmProfile ? "0x exact-input route" : "Jupiter exact-input route");
  const fee = payload.fee_disclosure || payload.fee_policy || quote.fee_policy || {};
  const configuredFeeBps = finite(fee.configured?.fee_bps ?? fee.configured_fee_bps);
  const actualFeeBps = finite(fee.actual?.fee_bps ?? fee.actual_fee_bps ?? fee.fee_bps);
  setText("terminalSpotQuoteFee", configuredFeeBps === null || actualFeeBps === null
    ? "Unavailable"
    : evmProfile
      ? `${(configuredFeeBps / 100).toFixed(2)}% · ${actualFeeBps} bps charged`
      : `${(configuredFeeBps / 100).toFixed(2)}% configured · ${actualFeeBps} bps charged`);
  const providerLatency = finite(payload.timing?.provider_latency_ms ?? quote.provider_latency_ms ?? payload.provider_latency_ms);
  setText("terminalSpotQuoteLatency", `${Math.round(clientRttMs)}ms RTT${providerLatency === null ? "" : ` · ${Math.round(providerLatency)}ms provider`}`);
  const roundTrip = payload.shadow_execution?.round_trip || null;
  const exitValue = finite(roundTrip?.current_executable_liquidation_usdc);
  const friction = finite(roundTrip?.round_trip_friction_pct);
  const quoteOnlyLoss = finite(roundTrip?.quote_only_round_trip_loss_pct);
  const sellExit = state.spotTicketSide === "sell"
    ? displayQuoteAmount(quote.expected_output_display ?? quote.expected_output ?? quote.output, outputSymbol)
    : null;
  setText("terminalSpotQuoteExit", sellExit || (exitValue === null ? "Not resolved" : `$${exitValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`));
  setText("terminalSpotQuoteFrictionLabel", friction === null && quoteOnlyLoss !== null ? "Before network costs" : "Round-trip friction");
  setText("terminalSpotQuoteFriction", friction !== null
    ? `${friction.toFixed(2)}%`
    : quoteOnlyLoss !== null
      ? `${Math.abs(quoteOnlyLoss).toFixed(2)}% ${quoteOnlyLoss < 0 ? "gain" : "loss"}`
      : roundTrip?.exit_verified ? "Network cost pending" : "Unavailable");
  setText("terminalSpotQuoteExitState", roundTrip?.exit_verified ? "Verified now" : state.spotTicketSide === "sell" ? "This is the exit route" : "Unresolved · trade unavailable");
  setSpotTicketExitSummary(
    roundTrip?.exit_verified || state.spotTicketSide === "sell" ? "current" : "unavailable",
    roundTrip?.exit_verified ? "Verified now" : state.spotTicketSide === "sell" ? "Current exit" : "Not verified",
    roundTrip?.exit_verified ? "Entry + USDC exit" : state.spotTicketSide === "sell" ? `Token → ${outputSymbol}` : "Buy remains unavailable",
  );
  const result = document.getElementById("terminalSpotQuoteResult");
  if (result) {
    result.hidden = false;
    result.dataset.state = "current";
  }
  setText("terminalSpotQuoteState", "Current quote");
  setText("terminalSpotQuoteMessage", roundTrip?.exit_verified
    ? `Entry + ${spotAccountingSymbol(chain)} exit verified.${evmProfile ? " Ready for wallet confirmation." : " Review only."}`
    : state.spotTicketSide === "buy"
      ? `${spotAccountingSymbol(chain)} exit unresolved. Buy unavailable.`
      : `Current ${outputSymbol} exit. Review only.`);
  const balance = payload.balance || {};
  if (balance.available === true) {
    const balanceAmount = balance.amount && typeof balance.amount === "object" ? balance.amount.display : balance.display ?? balance.amount;
    setText("terminalSpotBalance", balanceAmount);
    setText("terminalSpotBalanceUnit", balance.amount?.symbol || document.getElementById("terminalSpotBalanceUnit")?.textContent);
  }
  updateSpotExecutionRail({ quoted: true, exitVerified: roundTrip?.exit_verified === true || state.spotTicketSide === "sell" });
  renderSpotLiveExecution();
  scheduleSpotQuoteExpiry(payload);
}

async function requestSpotQuote({ automatic = false, expectedFingerprint = "" } = {}) {
  if (!spotTicketQualified()) return;
  const chain = currentSpotChain();
  const evmProfile = evmSpotProfile(chain);
  const wallet = currentSpotWallet();
  const action = document.getElementById("terminalSpotQuoteAction");
  if (evmProfile && (!authenticatedTerminalOrigin() || state.liveAuth?.authenticated !== true)) {
    clearSpotQuoteResult("Sign in to the secure workspace before preparing a wallet route.");
    setText("terminalSpotQuoteState", "Sign in");
    return;
  }
  if (evmProfile && currentSpotLiveGate()?.available_to_principal !== true) {
    clearSpotQuoteResult(`${chainDisplayName(chain)} wallet trading is not active for this session.`);
    setText("terminalSpotQuoteState", "Locked");
    return;
  }
  if (evmProfile && !wallet.connected) {
    clearSpotQuoteResult("Connect an EVM wallet before requesting an exact wallet-bound route.");
    setText("terminalSpotQuoteState", "Connect wallet");
    return;
  }
  if (state.spotTicketSide === "sell" && (!wallet.connected || !state.spotSellPercent)) {
    clearSpotQuoteResult(`Connect a ${chainDisplayName(chain)} wallet and choose 25%, 50%, 75%, or 100%.`);
    setText("terminalSpotQuoteState", "Choose sell size");
    return;
  }
  const snapshot = spotTicketSnapshot();
  const fingerprint = spotTicketFingerprint(snapshot);
  if (!snapshot || (automatic && expectedFingerprint && expectedFingerprint !== fingerprint)) return;
  state.spotQuoteAbortController?.abort?.();
  const controller = new AbortController();
  state.spotQuoteAbortController = controller;
  const generation = ++state.spotQuoteGeneration;
  state.spotQuote = null;
  state.spotLiveTicket = null;
  state.spotLiveUnsignedTransaction = null;
  state.spotLiveProviderQuote = null;
  state.spotLiveResult = null;
  state.spotQuoteStatus = automatic ? "refreshing" : "quoting";
  state.spotQuoteFingerprint = fingerprint;
  state.spotQuoteExpiresAt = 0;
  clearTimeout(state.spotQuoteExpiryTimer);
  clearSpotQuoteRefresh();
  const startedAt = performance.now();
  if (action) {
    action.disabled = true;
    action.textContent = automatic ? "Refreshing route…" : "Checking exact route…";
  }
  setText("terminalSpotQuoteState", automatic ? "Refreshing" : "Quoting");
  setText("terminalSpotQuoteMessage", automatic ? "Refreshing this unchanged exact ticket before expiry…" : "Checking the exact pool, token mints, balance sizing, and current route…");
  setSpotTicketExitSummary("loading", automatic ? "Refreshing" : "Checking", "Entry + reverse route");
  updateSpotExecutionRail();
  const timeout = setTimeout(() => controller.abort(), evmProfile ? 12_000 : 8_000);
  try {
    const endpoint = evmProfile ? `/api/trade/live/${chain}/prepare` : "/api/trade/spot-quote-preview";
    const { payload: rawPayload } = await fetchJson(endpoint, {
      method: "POST",
      headers: evmProfile ? liveExecutionRequestHeaders() : { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    const payload = evmProfile ? normalizeEvmSpotPreparePayload(rawPayload, snapshot) : rawPayload;
    if (generation !== state.spotQuoteGeneration || fingerprint !== state.spotQuoteFingerprint || fingerprint !== spotTicketFingerprint()) return;
    if (evmProfile && payload?.ok) {
      state.spotLiveTicket = payload.ticket;
      state.spotLiveProviderQuote = payload.provider_quote;
    }
    renderSpotQuote(payload, performance.now() - startedAt, { snapshot, fingerprint });
  } catch {
    if (generation !== state.spotQuoteGeneration) return;
    renderSpotQuote({ ok: false, unavailable_reason: controller.signal.aborted ? "quote_provider_timeout" : "quote_provider_unavailable" }, performance.now() - startedAt, { snapshot, fingerprint });
  } finally {
    clearTimeout(timeout);
    if (state.spotQuoteAbortController === controller) state.spotQuoteAbortController = null;
    if (generation === state.spotQuoteGeneration && action) {
      action.disabled = false;
      action.textContent = state.spotTicketSide === "buy" ? "Review buy + exit" : `Review ${spotAccountingSymbol(chain)} exit`;
    }
  }
}

async function prepareSolanaLiveTrade() {
  if (!currentSpotLiveReady()) return renderSpotLiveExecution();
  const snapshot = spotTicketSnapshot();
  if (!snapshot || snapshot.wallet_address !== state.solanaWalletAddress) return renderSpotLiveExecution();
  state.spotLivePending = true;
  state.spotLiveResult = null;
  state.spotLiveTicket = null;
  state.spotLiveUnsignedTransaction = null;
  renderSpotLiveExecution();
  try {
    const { response, payload } = await fetchJson("/api/trade/live/solana/prepare", {
      method: "POST",
      headers: liveExecutionRequestHeaders(),
      body: JSON.stringify({
        ...snapshot,
        review_quote_id: state.spotQuote?.quote?.quote_id || null,
        review_expires_at: state.spotQuote?.timing?.expires_at || null,
      }),
    });
    if (!response.ok || !payload?.ok || !spotLiveTicketMatchesCurrentTrade(payload.ticket)) {
      throw new Error(payload?.error || "solana_live_ticket_mismatch");
    }
    if (!payload.unsigned_transaction_base64) throw new Error("solana_unsigned_transaction_unavailable");
    state.spotLiveTicket = payload.ticket;
    state.spotLiveUnsignedTransaction = payload.unsigned_transaction_base64;
    const ticketId = payload.ticket.ticket_id;
    setTimeout(() => {
      if (state.spotLiveTicket?.ticket_id !== ticketId) return;
      if (Date.parse(state.spotLiveTicket.expires_at || "") <= Date.now() + 500) {
        state.spotLiveTicket = null;
        state.spotLiveUnsignedTransaction = null;
        renderSpotLiveExecution();
      }
    }, Math.max(0, Date.parse(payload.ticket.expires_at) - Date.now() - 400));
  } catch (error) {
    state.spotLiveResult = { ok: false, error: String(error?.code || error?.message || "solana_live_prepare_failed") };
  } finally {
    state.spotLivePending = false;
    renderSpotLiveExecution();
  }
}

async function executeSolanaLiveTrade() {
  const ticket = state.spotLiveTicket;
  const unsignedTransactionBase64 = state.spotLiveUnsignedTransaction;
  if (!ticket || !unsignedTransactionBase64 || !spotLiveTicketMatchesCurrentTrade(ticket)) {
    state.spotLiveTicket = null;
    state.spotLiveUnsignedTransaction = null;
    state.spotLiveResult = { ok: false, error: "solana_live_ticket_expired" };
    renderSpotLiveExecution();
    return;
  }
  state.spotLivePending = true;
  state.spotLiveResult = null;
  renderSpotLiveExecution();
  let submissionStarted = false;
  try {
    const execution = await ensureWalletExecutionBundle();
    const signed = await execution.signSolanaTicket({
      ticket,
      unsignedTransactionBase64,
      provider: solanaWalletProvider(),
      address: state.solanaWalletAddress,
    });
    state.spotLiveUnsignedTransaction = null;
    submissionStarted = true;
    const { response, payload } = await fetchJson("/api/trade/live/solana/execute", {
      method: "POST",
      headers: liveExecutionRequestHeaders(),
      body: JSON.stringify(signed),
    });
    if (!response.ok && response.status !== 202) throw new Error(payload?.error || "solana_live_submission_rejected");
    state.spotLiveResult = payload;
    state.spotLiveTicket = null;
  } catch (error) {
    state.spotLiveTicket = null;
    state.spotLiveUnsignedTransaction = null;
    state.spotLiveResult = submissionStarted
      ? { ok: true, reconciliation: { state: "indeterminate", signature: null }, warning: "Do not retry until wallet and chain state are checked." }
      : { ok: false, error: String(error?.shortMessage || error?.code || error?.message || "solana_live_trade_not_sent") };
  } finally {
    state.spotLivePending = false;
    renderSpotLiveExecution();
  }
}

async function executeEvmLiveTrade() {
  const ticket = state.spotLiveTicket;
  const providerQuote = state.spotLiveProviderQuote;
  const wallet = currentSpotWallet();
  const chain = currentSpotChain();
  const profile = evmSpotProfile(chain);
  if (!ticket || !providerQuote || !wallet.connected || !spotLiveTicketMatchesCurrentTrade(ticket)) {
    state.spotLiveTicket = null;
    state.spotLiveProviderQuote = null;
    state.spotLiveResult = { ok: false, error: "evm_live_ticket_expired" };
    renderSpotLiveExecution();
    return;
  }
  state.spotLivePending = true;
  state.spotLiveResult = null;
  renderSpotLiveExecution();
  let clientReport = null;
  try {
    const execution = await ensureWalletExecutionBundle();
    clientReport = await execution.executeEvmZeroXTicket({
      profile,
      ticket,
      quote: providerQuote,
      provider: browserWalletProvider(),
      address: wallet.address,
    });
    state.spotLiveProviderQuote = null;
    const { response, payload } = await fetchJson(`/api/trade/live/${chain}/report`, {
      method: "POST",
      headers: liveExecutionRequestHeaders(),
      body: JSON.stringify(clientReport),
    });
    if (!response.ok && response.status !== 202) throw new Error(payload?.error || "evm_live_report_rejected");
    state.spotLiveResult = { ...payload, fee_bps: ticket.fee?.fee_bps };
    state.spotLiveTicket = null;
  } catch (error) {
    const code = String(error?.shortMessage || error?.code || error?.message || "evm_live_trade_not_sent");
    state.spotLiveTicket = null;
    state.spotLiveProviderQuote = null;
    state.spotLiveResult = clientReport
      ? {
          ok: true,
          transaction_hash: clientReport.transaction_hash,
          fee_bps: ticket.fee?.fee_bps,
          reconciliation: { state: "indeterminate" },
          warning: "Do not retry until the wallet and chain are checked.",
        }
      : new Set(["robinhood_wallet_submission_indeterminate", "evm_wallet_submission_indeterminate"]).has(code)
        ? { ok: true, fee_bps: ticket.fee?.fee_bps, reconciliation: { state: "indeterminate" }, warning: "Check the wallet before retrying." }
        : { ok: false, error: code };
  } finally {
    state.spotLivePending = false;
    renderSpotLiveExecution();
  }
}

async function handleSpotLiveExecutionAction() {
  const action = document.getElementById("terminalSpotLiveAction")?.dataset.liveAction;
  if (action === "connect") return connectSpotWalletReadOnly();
  if (action === "review") return requestSpotQuote();
  if (action === "prepare") return prepareSolanaLiveTrade();
  if (action === "execute") return evmSpotProfile() ? executeEvmLiveTrade() : executeSolanaLiveTrade();
}

function updateQuoteBoundary() {
  const flags = state.flags?.flags || {};
  const customerQuoteEnabled = state.flags?.quote_only === true
    && flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE === true
    && flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE === true;
  const spotRouteReviewEnabled = spotTicketQualified();
  const orderPlanEnabled = state.flags?.order_plan_available === true
    && Array.isArray(state.flags?.order_plan_markets)
    && state.flags.order_plan_markets.includes("hyperliquid_perpetual")
    && state.lane === "perps"
    && String(state.selected?.instrument_id || "").startsWith("hyperliquid:perp:");
  const section = document.getElementById("terminalTradeReviewSection");
  if (section) section.hidden = !orderPlanEnabled;
  syncSpotTicketControls();
  if (!orderPlanEnabled) {
    clearTimeout(state.marketPreviewExpiryTimer);
    clearTimeout(state.orderPlanExpiryTimer);
    state.marketPreviewExpiryTimer = null;
    state.orderPlanExpiryTimer = null;
  }
  const routeReviewEnabled = customerQuoteEnabled || spotRouteReviewEnabled;
  const liveHyperliquid = state.liveSession?.gate?.chains?.hyperliquid?.available_to_principal === true;
  const liveSpot = currentSpotLiveGate()?.available_to_principal === true && state.lane === "spot";
  setText("terminalQuoteState", orderPlanEnabled ? "Exact market" : liveSpot ? "Wallet trade" : routeReviewEnabled ? "Review only" : "Read only");
  setText("terminalQuoteContract", orderPlanEnabled ? "Exact-market trade plan" : liveSpot ? "Wallet-signed exact route" : routeReviewEnabled ? "Read-only route review" : "Trade preview not enabled");
  setText("terminalQuoteNote", orderPlanEnabled
    ? liveHyperliquid ? "Review first. The connected wallet signs every live order." : "Preview only. Nothing can be signed or sent."
    : liveSpot
      ? "Review first. The connected wallet signs the exact simulated transaction."
      : routeReviewEnabled
        ? "A current route may be reviewed where supported. No order can be signed or sent."
      : "No transaction is prepared, signed, or sent.");
  const boundary = document.getElementById("terminalBoundary");
  if (boundary) {
    boundary.querySelector("strong").textContent = orderPlanEnabled
      ? liveHyperliquid ? "Wallet trading enabled" : "Trade preview available"
      : liveSpot
        ? "Wallet trading enabled"
        : routeReviewEnabled
          ? "Route review available"
        : "Trading coming later";
    boundary.querySelector("small").textContent = orderPlanEnabled || routeReviewEnabled
      ? (liveHyperliquid || liveSpot) ? "Review → wallet confirm → venue reconciliation" : "Preview only. No order can be signed or sent."
      : "Trading is not enabled. No order can be signed or sent.";
  }
  if (orderPlanEnabled) syncMarketPreviewControls();
  updateTerminalPaneAvailability();
  renderTradeConsequences();
  renderLiveExecution();
  renderSpotLiveExecution();
}

function syncMarketPreviewControls() {
  const select = document.getElementById("terminalPreviewLeverage");
  if (!select || state.lane !== "perps" || !state.selected) return;
  const maximum = Math.max(1, Math.trunc(finite(state.selected.max_leverage ?? state.selected.maxLeverage) || 1));
  const previous = Math.trunc(finite(select.value) || 3);
  const choices = [...new Set([1, 2, 3, 5, 10, 20, 25, 40, 50, maximum])]
    .filter((value) => value <= maximum)
    .sort((left, right) => left - right);
  select.replaceChildren(...choices.map((value) => new Option(`${value}×`, String(value))));
  const next = choices.includes(previous) ? previous : choices.includes(3) ? 3 : choices.at(-1);
  select.value = String(next);
  setText("terminalPreviewTitle", `Plan ${state.selected.asset || "perpetual"}`);
  syncOrderPlanControls();
}

function orderPlanActionText() {
  return state.accountSnapshot?.ok && state.flags?.account_scenario_available === true
    ? `Review ${state.marketPreviewSide} ${state.orderPlanType} + account`
    : `Review ${state.marketPreviewSide} ${state.orderPlanType}`;
}

function inputPrice(value) {
  const price = finite(value);
  if (!(price > 0)) return "";
  const digits = price >= 1_000 ? 2 : price >= 1 ? 5 : 9;
  return price.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function seedOrderPlanPrice() {
  if (state.orderPlanType === "market") return;
  const price = document.getElementById("terminalPreviewPrice");
  if (!price) return;
  const summary = state.orderBook?.summary || {};
  const mark = finite(state.selected?.mark_price ?? state.selected?.markPrice ?? state.selected?.last_price);
  const bestBid = finite(summary.best_bid);
  const bestAsk = finite(summary.best_ask);
  const reference = state.orderPlanType === "limit"
    ? state.marketPreviewSide === "long" ? bestBid ?? mark : bestAsk ?? mark
    : state.marketPreviewSide === "long" ? (mark ?? bestAsk) * 1.005 : (mark ?? bestBid) * 0.995;
  price.value = inputPrice(reference);
}

function syncOrderPlanControls() {
  const priceField = document.getElementById("terminalPreviewPriceField");
  const tifField = document.getElementById("terminalPreviewTifField");
  const priceLabel = document.getElementById("terminalPreviewPriceLabel");
  if (priceField) priceField.hidden = state.orderPlanType === "market";
  if (tifField) tifField.hidden = state.orderPlanType !== "limit";
  if (priceLabel) priceLabel.textContent = state.orderPlanType === "trigger" ? "Trigger price" : "Limit price";
  const action = document.getElementById("terminalPreviewAction");
  if (action) {
    action.dataset.side = state.marketPreviewSide;
    action.textContent = orderPlanActionText();
  }
}

function setOrderPlanType(type, { refresh = false, seed = true } = {}) {
  const supported = Array.isArray(state.flags?.order_plan_types) ? state.flags.order_plan_types : ["market", "limit", "trigger"];
  const next = supported.includes(type) ? type : "market";
  state.orderPlanType = next;
  for (const button of document.querySelectorAll("[data-order-type]")) {
    const active = button.dataset.orderType === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  syncOrderPlanControls();
  if (seed) seedOrderPlanPrice();
  clearMarketPreviewResult(`Review the ${next} entry and optional risk levels against the current exact market.`);
  if (refresh) void requestOrderPlan();
}

function setMarketPreviewSide(side, { refresh = false } = {}) {
  const next = side === "short" ? "short" : "long";
  state.marketPreviewSide = next;
  for (const button of document.querySelectorAll(".terminal-side-toggle [data-side]")) {
    const active = button.dataset.side === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const action = document.getElementById("terminalPreviewAction");
  if (action) {
    action.dataset.side = next;
    action.textContent = orderPlanActionText();
  }
  if (state.orderPlanType !== "market") seedOrderPlanPrice();
  if (refresh) void requestOrderPlan();
}

function marketPreviewReason(reason) {
  const messages = {
    book_stale: "The live book moved before this preview could be shown. Refresh it.",
    current_exact_book_unavailable: "The exact live book is temporarily unavailable. No alternate market was used.",
    market_preview_timeout: "The live book did not respond in time. Try again.",
    order_plan_timeout: "The exact-market plan did not respond in time. Try again.",
    insufficient_visible_depth: "The visible book cannot cover that size. Reduce the amount.",
    insufficient_depth_inside_limit: "The current book cannot fill that size without crossing your limit. Reduce the size or revise the limit.",
    price_impact_limit_exceeded: "Estimated impact exceeds the preview limit. Reduce the amount.",
    impact_limit_invalid: "Choose a supported impact guard between 0 and 500 bps.",
    notional_out_of_bounds: "Enter a size between 10 and 250,000 USDC.",
    leverage_invalid: "Choose a whole-number leverage supported by this market.",
    leverage_exceeds_market_maximum: "That leverage exceeds this market's current maximum.",
    exact_instrument_identity_mismatch: "The exact Hyperliquid instrument could not be confirmed. No substitute was used.",
    market_identity_mismatch: "The market response did not match the selected instrument. No substitute was used.",
    order_type_invalid: "Choose Market, Limit, or Trigger.",
    limit_price_invalid: "Enter a valid limit price.",
    trigger_price_invalid: "Enter a valid trigger price.",
    time_in_force_invalid: "Choose a supported time in force.",
    post_only_would_cross: "That post-only limit would cross the current book. Move it behind the best price.",
    ioc_not_marketable: "That IOC limit does not currently cross the book and would cancel immediately.",
    trigger_side_mismatch: "A long stop entry must trigger above market; a short stop entry must trigger below market.",
    take_profit_price_invalid: "Enter a valid take-profit price or leave it blank.",
    stop_loss_price_invalid: "Enter a valid stop-loss price or leave it blank.",
    take_profit_side_mismatch: "The take-profit level is on the wrong side of the planned entry.",
    stop_loss_side_mismatch: "The stop level is on the wrong side of the planned entry.",
    book_order_invalid: "The live book failed continuity checks. Refresh before relying on it.",
    book_summary_invalid: "The current bid and ask could not be verified.",
    account_identity_mismatch: "The account snapshot no longer matches this review. Reload the account.",
    account_snapshot_unavailable: "Current account state is unavailable. Reload the public account before reviewing impact.",
    account_snapshot_stale: "The account snapshot moved out of its review window. Reload it.",
    account_fee_rate_unavailable: "Current account fee rates could not be confirmed. No fee estimate was invented.",
    account_withdrawable_unavailable: "Current withdrawable collateral could not be confirmed.",
    margin_mode_invalid: "Choose Cross or Isolated margin.",
    reduce_only_would_not_reduce_position: "Reduce only would add or flip this exposure. Reverse the side or turn reduce only off.",
    account_scenario_provider_error: "Current account impact could not be confirmed. The market-only review remains available after unloading the account.",
    account_scenario_timeout: "The account and market did not respond inside the review window. Try again.",
  };
  return messages[reason] || "The current exact-market plan could not be verified. Nothing was prepared.";
}

function formatBaseSize(value) {
  const amount = finite(value);
  if (!(amount > 0)) return "--";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: amount >= 100 ? 2 : 4,
    maximumFractionDigits: amount >= 100 ? 2 : amount >= 1 ? 6 : 8,
  });
}

function clearMarketPreviewResult(message = "Review exact entry semantics and optional risk levels against the current book.") {
  state.marketPreview = null;
  state.orderPlan = null;
  state.liveTicket = null;
  state.liveBuilderApproval = null;
  state.liveExecutionResult = null;
  clearTimeout(state.marketPreviewExpiryTimer);
  clearTimeout(state.orderPlanExpiryTimer);
  state.marketPreviewExpiryTimer = null;
  state.orderPlanExpiryTimer = null;
  const result = document.getElementById("terminalPreviewResult");
  const accountResult = document.getElementById("terminalAccountScenarioResult");
  if (result) {
    result.hidden = true;
    delete result.dataset.state;
  }
  if (accountResult) {
    accountResult.hidden = true;
    delete accountResult.dataset.state;
  }
  const status = document.getElementById("terminalPreviewMessage");
  if (status) {
    status.textContent = message;
    delete status.dataset.state;
  }
  renderLiveExecution();
}

function setPreviewMetric(cellId, labelId, valueId, label, value, show = hasOperatorValue(value)) {
  const cell = document.getElementById(cellId);
  if (cell) cell.hidden = !show;
  setText(labelId, show ? label : "", "");
  setText(valueId, show ? value : "", "");
}

function tifLabel(value) {
  return ({ gtc: "Good til canceled", alo: "Post only", ioc: "Immediate or cancel" })[String(value || "").toLowerCase()] || "";
}

function signedBps(value) {
  const amount = finite(value);
  if (amount === null) return "";
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(2)} bps`;
}

function renderAccountScenario(plan = {}) {
  const host = document.getElementById("terminalAccountScenarioResult");
  if (!host) return;
  const accountContext = plan.account_context;
  if (!accountContext) {
    host.hidden = true;
    return;
  }
  const effect = plan.position_effect || {};
  const fee = plan.fee_estimate || {};
  const margin = plan.margin_check || {};
  const settings = plan.venue_settings || {};
  const blocked = plan.state === "account_scenario_blocked" || plan.review?.state === "blocked";
  const projectedSide = effect.projected_side === "flat" ? "Flat" : titleCase(effect.projected_side);
  setText("terminalScenarioState", blocked ? "Needs attention" : "Checks pass");
  setText("terminalScenarioEffect", titleCase(effect.effect));
  setText("terminalScenarioProjected", effect.projected_side === "flat"
    ? "Flat after plan"
    : `${projectedSide} ${accountNumber(effect.projected_size)} · ${accountMoney(effect.projected_notional_usdc)}`);
  const feeRate = finite(fee.account_fee_rate);
  setText("terminalScenarioFee", `${accountMoney(fee.estimated_entry_fee_usdc)}${feeRate === null ? "" : ` · ${(feeRate * 10_000).toFixed(2)} bps ${fee.liquidity_assumption || ""}`}`);
  setText("terminalScenarioMargin", accountMoney(margin.estimated_incremental_margin_usdc));
  setText("terminalScenarioCheck", `${accountMoney(margin.estimated_withdrawable_after_usdc)} · ${margin.state === "passes_current_snapshot" ? "passes" : "insufficient"}`);
  setText("terminalScenarioSettings", settings.settings_change_required
    ? `Set ${titleCase(settings.requested_margin_mode)} · ${accountNumber(settings.requested_leverage)}×`
    : `${titleCase(settings.requested_margin_mode)} · ${accountNumber(settings.requested_leverage)}×`);
  setText("terminalScenarioNote", blocked
    ? `Blocked by ${plan.review?.blockers?.map((value) => titleCase(value)).join(" · ") || "the current account check"}. Nothing was prepared.`
    : `Modeled from ${shortAccountAddress(accountContext.address)} at ${timestamp(accountContext.observed_at)}. Public observation is not wallet ownership verification.`);
  host.hidden = false;
  host.dataset.state = blocked ? "blocked" : "ready";
}

function renderOrderPlan(plan) {
  state.marketPreview = plan;
  state.orderPlan = plan;
  const result = document.getElementById("terminalPreviewResult");
  const message = document.getElementById("terminalPreviewMessage");
  if (!plan?.ok) {
    if (result) result.hidden = true;
    const accountResult = document.getElementById("terminalAccountScenarioResult");
    if (accountResult) accountResult.hidden = true;
    if (message) {
      message.textContent = marketPreviewReason(plan?.unavailable_reason);
      message.dataset.state = "error";
    }
    setText("terminalQuoteState", "Refresh");
    state.liveTicket = null;
    state.liveBuilderApproval = null;
    renderLiveExecution();
    return;
  }
  const intent = plan.intent || {};
  const entry = plan.entry_model || {};
  const fill = plan.fill_estimate || null;
  const bracket = plan.risk_bracket || null;
  const coin = plan.instrument?.exact_market_id || String(state.selected?.asset || "").replace(/-PERP$/i, "");
  const baseSize = intent.planned_base_size ?? fill?.base_size;
  renderAccountScenario(plan);
  setText("terminalPreviewEntryLabel", intent.order_type === "market"
    ? "Estimated current entry"
    : entry.state === "currently_marketable_limit"
      ? "Estimated limit entry"
      : entry.state === "resting_limit"
        ? "Planned resting entry"
        : "Conditional entry");
  setText("terminalPreviewFill", `${formatBaseSize(baseSize)} ${coin}`);
  if (fill) {
    setText("terminalPreviewVwap", `Reference ${formatPrice(fill.vwap_price)} · worst ${formatPrice(fill.worst_price)}`);
  } else if (intent.order_type === "limit") {
    setText("terminalPreviewVwap", `Limit ${formatPrice(intent.limit_price)} · ${tifLabel(intent.time_in_force)}`);
  } else {
    setText("terminalPreviewVwap", `Triggers at ${formatPrice(intent.trigger_price)} · reprices when activated`);
  }
  setText("terminalPreviewMargin", `${compact(intent.estimated_initial_margin_usdc, { currency: true })} USDC`);

  if (fill) {
    setPreviewMetric("terminalPreviewImpactCell", "terminalPreviewImpactLabel", "terminalPreviewImpact", "Impact", `${(finite(fill.price_impact_bps) || 0).toFixed(2)} bps`);
  } else {
    setPreviewMetric("terminalPreviewImpactCell", "terminalPreviewImpactLabel", "terminalPreviewImpact", intent.order_type === "trigger" ? "Trigger distance" : "From mark", signedBps(entry.distance_from_mid_bps));
  }
  if (bracket) {
    const stopValue = finite(bracket.stop_pnl_usdc);
    const stopLabel = stopValue === null ? "" : `${compact(Math.abs(stopValue), { currency: true })} · ${bracket.risk_pct.toFixed(2)}%`;
    const rewardRatio = finite(bracket.reward_to_risk);
    const targetValue = finite(bracket.target_pnl_usdc);
    setPreviewMetric("terminalPreviewSpreadCell", "terminalPreviewSpreadLabel", "terminalPreviewSpread", "Stop risk", stopLabel);
    setPreviewMetric(
      "terminalPreviewDepthCell",
      "terminalPreviewDepthLabel",
      "terminalPreviewDepth",
      rewardRatio !== null ? "Reward : risk" : "Target move",
      rewardRatio !== null ? `${rewardRatio.toFixed(2)}R` : targetValue === null ? "" : compact(targetValue, { currency: true }),
    );
  } else if (intent.order_type === "market") {
    setPreviewMetric("terminalPreviewSpreadCell", "terminalPreviewSpreadLabel", "terminalPreviewSpread", "Spread", finite(fill?.spread_bps) === null ? "" : `${Number(fill.spread_bps).toFixed(2)} bps`);
    const levels = Math.max(0, Math.trunc(finite(fill?.visible_levels_consumed) || 0));
    setPreviewMetric("terminalPreviewDepthCell", "terminalPreviewDepthLabel", "terminalPreviewDepth", "Depth used", `${levels} level${levels === 1 ? "" : "s"}`, levels > 0);
  } else if (intent.order_type === "limit") {
    setPreviewMetric("terminalPreviewSpreadCell", "terminalPreviewSpreadLabel", "terminalPreviewSpread", "Time in force", tifLabel(intent.time_in_force));
    setPreviewMetric("terminalPreviewDepthCell", "terminalPreviewDepthLabel", "terminalPreviewDepth", "Book state", entry.marketable ? "Marketable now" : "Resting order");
  } else {
    setPreviewMetric("terminalPreviewSpreadCell", "terminalPreviewSpreadLabel", "terminalPreviewSpread", "Activation", state.marketPreviewSide === "long" ? "Above market" : "Below market");
    setPreviewMetric("terminalPreviewDepthCell", "terminalPreviewDepthLabel", "terminalPreviewDepth", "On trigger", "Reprice live book");
  }

  setText("terminalPreviewTiming", `Book ${timestamp(plan.provenance?.observed_at)} · short-lived review`);
  setText("terminalQuoteState", plan.account_context
    ? plan.state === "account_scenario_blocked" ? "Account check" : "Account ready"
    : entry.state === "resting_limit" ? "Resting limit" : intent.order_type === "trigger" ? "Conditional" : "Current book");
  if (result) {
    result.hidden = false;
    result.dataset.state = "current";
  }
  if (message) {
    message.textContent = plan.account_context
      ? plan.state === "account_scenario_blocked"
        ? "The exact entry is modeled, but the current account check has blockers. Nothing was prepared."
        : "Current entry, fee tier, position effect, and incremental margin are modeled from the exact market and current public account snapshot."
      : bracket
      ? "Entry mechanics and risk math are reviewed separately. Fees, slippage after activation, and account liquidation effects are not included."
      : intent.order_type === "trigger"
        ? "The trigger is anchored to the current market; its future fill will be repriced when activated."
        : entry.state === "resting_limit"
          ? "This price rests behind the current book. A fill is not assumed."
          : "Current entry mechanics are estimated from the exact live book. Account-specific effects are not included.";
    delete message.dataset.state;
  }
  clearTimeout(state.orderPlanExpiryTimer);
  const remaining = Math.max(0, Date.parse(plan.expires_at || "") - Date.now());
  const planIdentity = plan.scenario_id || plan.plan_id;
  state.orderPlanExpiryTimer = setTimeout(() => {
    if ((state.orderPlan?.scenario_id || state.orderPlan?.plan_id) !== planIdentity) return;
    if (result) result.dataset.state = "expired";
    setText("terminalQuoteState", "Refresh");
    setText("terminalPreviewTiming", "Plan review expired · refresh against the current book");
    state.liveTicket = null;
    state.liveBuilderApproval = null;
    renderLiveExecution();
  }, remaining + 50);
  renderLiveExecution();
}

function currentOrderPlanRequest() {
  const accountScenario = state.accountSnapshot?.ok === true
    && state.flags?.account_scenario_available === true
    && Array.isArray(state.flags?.account_scenario_venues)
    && state.flags.account_scenario_venues.includes("hyperliquid");
  const price = finite(document.getElementById("terminalPreviewPrice")?.value);
  return {
    accountScenario,
    body: {
      ...(accountScenario ? { address: state.accountSnapshot.account.address } : {}),
      instrument_id: state.selected?.instrument_id,
      side: state.marketPreviewSide,
      order_type: state.orderPlanType,
      notional_usdc: finite(document.getElementById("terminalPreviewNotional")?.value),
      leverage: finite(document.getElementById("terminalPreviewLeverage")?.value),
      limit_price: state.orderPlanType === "limit" ? price : null,
      trigger_price: state.orderPlanType === "trigger" ? price : null,
      time_in_force: state.orderPlanType === "limit" ? String(document.getElementById("terminalPreviewTif")?.value || "gtc") : null,
      take_profit_price: finite(document.getElementById("terminalPreviewTakeProfit")?.value),
      stop_loss_price: finite(document.getElementById("terminalPreviewStopLoss")?.value),
      margin_mode: String(document.getElementById("terminalPreviewMarginMode")?.value || "cross"),
      reduce_only: document.getElementById("terminalPreviewReduceOnly")?.checked === true,
      max_impact_bps: finite(document.getElementById("terminalPreviewImpactLimit")?.value) || 100,
    },
  };
}

async function requestOrderPlan({ automatic = false } = {}) {
  if (
    state.lane !== "perps"
    || !state.selected?.instrument_id
    || state.flags?.order_plan_available !== true
  ) return;
  const action = document.getElementById("terminalPreviewAction");
  const { accountScenario, body } = currentOrderPlanRequest();
  const generation = ++state.orderPlanGeneration;
  state.liveTicket = null;
  state.liveBuilderApproval = null;
  state.liveExecutionResult = null;
  renderLiveExecution();
  if (action) {
    action.disabled = true;
    action.textContent = automatic
      ? accountScenario ? "Loading account + market…" : "Loading exact market…"
      : accountScenario ? "Reviewing account + market…" : "Reviewing exact market…";
  }
  setText("terminalQuoteState", "Checking book");
  try {
    const { payload } = await fetchJson(accountScenario ? "/api/trade/account-scenario" : "/api/trade/order-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (generation !== state.orderPlanGeneration) return;
    renderOrderPlan(payload);
  } catch {
    if (generation !== state.orderPlanGeneration) return;
    renderOrderPlan({ ok: false, unavailable_reason: "current_exact_book_unavailable" });
  } finally {
    if (generation === state.orderPlanGeneration && action) {
      action.disabled = false;
      action.dataset.side = state.marketPreviewSide;
      action.textContent = orderPlanActionText();
    }
  }
}

function liveExecutionRequestHeaders() {
  const csrf = String(state.liveAuth?.csrf_token || "");
  if (!csrf) throw new Error("csrf_token_unavailable");
  return { "content-type": "application/json", "x-ravenos-csrf": csrf };
}

function liveTicketMatchesCurrentPlan(ticket) {
  const request = currentOrderPlanRequest().body;
  const reviewed = ticket?.reviewed_order || {};
  return ticket?.wallet_address?.toLowerCase() === state.walletAddress?.toLowerCase()
    && ticket?.instrument?.instrument_id === state.selected?.instrument_id
    && reviewed.side === request.side
    && reviewed.order_type === request.order_type
    && Math.abs(Number(reviewed.notional_usdc) - Number(request.notional_usdc)) < 0.000001
    && Number(reviewed.leverage) === Number(request.leverage)
    && reviewed.margin_mode === request.margin_mode
    && reviewed.reduce_only === request.reduce_only
    && Date.parse(ticket.expires_at || "") > Date.now() + 500;
}

async function prepareHyperliquidLiveOrder() {
  if (!currentPerpScenarioReady() || !state.walletAddress) return renderLiveExecution();
  state.liveExecutionPending = true;
  state.liveExecutionResult = null;
  renderLiveExecution();
  try {
    const { body } = currentOrderPlanRequest();
    const { response, payload } = await fetchJson("/api/trade/live/hyperliquid/prepare", {
      method: "POST",
      headers: liveExecutionRequestHeaders(),
      body: JSON.stringify({ ...body, address: state.walletAddress, wallet_address: state.walletAddress }),
    });
    if (response.status === 409 && payload?.error === "builder_fee_approval_required" && payload?.builder_approval) {
      state.liveBuilderApproval = payload.builder_approval;
      state.liveTicket = null;
      return;
    }
    if (!response.ok || !payload?.ok || !liveTicketMatchesCurrentPlan(payload.ticket)) {
      throw new Error(payload?.error || "live_ticket_does_not_match_current_order");
    }
    state.liveBuilderApproval = null;
    state.liveTicket = payload.ticket;
  } catch (error) {
    state.liveTicket = null;
    state.liveExecutionResult = { ok: false, error: String(error?.code || error?.message || "live_order_prepare_failed") };
  } finally {
    state.liveExecutionPending = false;
    renderLiveExecution();
  }
}

async function approveHyperliquidBuilderFee() {
  const approval = state.liveBuilderApproval;
  if (!approval || Date.parse(approval.expires_at || "") <= Date.now() + 500) {
    state.liveBuilderApproval = null;
    state.liveExecutionResult = { ok: false, error: "builder_fee_approval_expired" };
    renderLiveExecution();
    return;
  }
  state.liveExecutionPending = true;
  state.liveExecutionResult = null;
  renderLiveExecution();
  try {
    const execution = await ensureWalletExecutionBundle();
    await execution.approveHyperliquidBuilderFee({
      approval,
      provider: browserWalletProvider(),
      address: state.walletAddress,
    });
    state.liveBuilderApproval = null;
    state.liveExecutionPending = false;
    await prepareHyperliquidLiveOrder();
  } catch (error) {
    state.liveExecutionResult = { ok: false, error: String(error?.shortMessage || error?.code || error?.message || "builder_fee_approval_failed") };
    state.liveExecutionPending = false;
    renderLiveExecution();
  }
}

async function executeHyperliquidLiveOrder() {
  const ticket = state.liveTicket;
  if (!ticket || !liveTicketMatchesCurrentPlan(ticket)) {
    state.liveTicket = null;
    state.liveExecutionResult = { ok: false, error: "live_ticket_expired" };
    renderLiveExecution();
    return;
  }
  state.liveExecutionPending = true;
  state.liveExecutionResult = null;
  renderLiveExecution();
  try {
    const execution = await ensureWalletExecutionBundle();
    const clientReport = await execution.executeHyperliquidTicket({
      ticket,
      provider: browserWalletProvider(),
      address: state.walletAddress,
    });
    const { response, payload } = await fetchJson("/api/trade/live/hyperliquid/report", {
      method: "POST",
      headers: liveExecutionRequestHeaders(),
      body: JSON.stringify(clientReport),
    });
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "live_order_reconciliation_failed");
    state.liveExecutionResult = payload;
    state.liveTicket = null;
    if (state.walletAddress) await loadTerminalAccount(state.walletAddress, { walletTransport: true });
  } catch (error) {
    state.liveExecutionResult = { ok: false, error: String(error?.shortMessage || error?.code || error?.message || "live_order_not_sent") };
  } finally {
    state.liveExecutionPending = false;
    renderLiveExecution();
  }
}

async function handleLiveExecutionAction() {
  const action = document.getElementById("terminalLiveExecutionAction")?.dataset.liveAction;
  if (action === "connect") return useBrowserWalletAddress();
  if (action === "review") return requestOrderPlan();
  if (action === "prepare") return prepareHyperliquidLiveOrder();
  if (action === "approve_fee") return approveHyperliquidBuilderFee();
  if (action === "execute") return executeHyperliquidLiveOrder();
}

async function loadTradeFlags() {
  try {
    const { response, payload } = await fetchJson("/api/trade/flags");
    state.flags = response.ok ? payload : null;
  } catch {
    state.flags = null;
  }
  updateQuoteBoundary();
  await loadLiveExecutionSession();
}

function perpChartRequest(row, timeframe = state.timeframe) {
  return {
    market: "perpetuals",
    asset: row.asset,
    timeframe,
    chain: "hyperliquid",
    marketIdentity: row.instrument_id,
    instrumentScope: "exact_instrument",
    expectedIdentity: {
      instrumentType: "perpetual",
      identityScope: "venue_market",
      chain: "hyperliquid",
      venue: "hyperliquid",
      baseAsset: String(row.asset || "").replace(/-PERP$/i, ""),
      quoteAsset: "USD",
    },
  };
}

function spotChartRequest(row, timeframe = state.timeframe) {
  const instrumentId = `${String(row.chainId || "").toLowerCase()}:pool:${row.pairAddress}`;
  return {
    market: "crypto_spot",
    asset: `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`,
    timeframe,
    chain: row.chainId,
    pairAddress: row.pairAddress,
    tokenAddress: row.tokenAddress,
    quoteAddress: row.quoteTokenAddress,
    instrumentScope: "exact_pool",
    marketIdentity: instrumentId,
    expectedIdentity: {
      instrumentType: "spot_pool",
      identityScope: "exact_pool",
      chain: row.chainId,
      poolAddress: row.pairAddress,
      tokenAddress: row.tokenAddress,
    },
  };
}

async function selectPerp(asset, { updateUrl = true } = {}) {
  closeProjectLinks();
  clearSpotTradeRefresh();
  clearSpotQuoteResult("Select an exact Solana pool to review a spot route.");
  const row = state.markets.find((item) => item.asset === asset);
  if (!row) return;
  const generation = ++state.selectionGeneration;
  state.lane = "perps";
  renderLaunchBadge();
  state.selected = row;
  setActiveMarketControlRisk(null);
  state.context = null;
  state.opportunityEvidence = null;
  resetTerminalMarketFlow();
  clearMarketPreviewResult();
  clearExternalChart();
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadTrigger", "Raven Read");
  document.getElementById("assetSelect").value = row.asset;
  document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
  setText("terminalChartTitle", `${row.asset} · ${state.timeframe}`);
  setText("terminalChartStatus", "Loading current candles and Raven context.");
  setText("terminalDeepLink", "Perp depth");
  document.getElementById("terminalDeepLink").href = `/perps/?asset=${encodeURIComponent(row.asset)}&timeframe=${encodeURIComponent(state.timeframe)}`;
  renderPerpFacts();
  setContextChecking({ identity: row.instrument_id });
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject: perpSubject(row), timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });

  const chartPromise = state.workspace.load(perpChartRequest(row));
  const contextPromise = fetchJson(`/api/perps/instrument?symbol=${encodeURIComponent(row.asset)}`).catch(() => null);
  const opportunityPromise = fetchExactOpportunityEvidence(row.instrument_id, row.asset);
  const [chartState, contextResult, opportunityResult] = await Promise.all([chartPromise, contextPromise, opportunityPromise]);
  if (generation !== state.selectionGeneration) return;
  renderPerpFacts();
  renderWorkspaceState(state.workspace?.state || chartState);
  if (contextResult?.response?.ok && contextResult.payload?.ok) renderPerpContext(contextResult.payload, {
    updateUrl,
    opportunityEvidence: opportunityResult.perp,
    opportunityGeneratedAt: opportunityResult.generatedAt,
  });
  else if (!renderPerpOpportunityFallback(opportunityResult.perp, { updateUrl, generatedAt: opportunityResult.generatedAt })) {
    setContextUnavailable();
    updateShell({
      subject: perpSubject(row),
      marketLabel: `${row.asset} market`,
      thesis: "",
      setup: "",
      evidenceState: "",
      freshnessState: chartState?.state || "data_unavailable",
      freshnessLabel: chartState?.operatorStateLabel || "Market data",
      observedAt: chartState?.observedAt || row.observed_at,
    }, { updateUrl });
  }
  void requestOrderPlan({ automatic: true });
}

function setLane(lane, { updateUrl = true, selectDefault = true } = {}) {
  if (!new Set(["perps", "spot", "equity"]).has(lane)) return;
  closeProjectLinks();
  clearSpotQuoteResult("Market changed. Review a new exact route.");
  state.lane = lane;
  setActiveMarketControlRisk(null);
  if (lane !== "spot") clearSpotTradeRefresh();
  renderLaunchBadge();
  updateTerminalPaneAvailability();
  document.getElementById("terminalModeSelect").value = lane;
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  if (lane === "perps") {
    document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
    if (selectDefault) {
      const selected = state.markets.some((row) => row.instrument_id === state.selected?.instrument_id)
        ? state.selected.asset
        : defaultPerp();
      if (selected) selectPerp(selected, { updateUrl });
    }
    return;
  }
  if (lane === "equity") {
    document.getElementById("venueSelect").replaceChildren(new Option("Select exact listing", "unavailable"));
    if (!selectDefault) return;
    renderExplicitSelectionUnavailable({ lane: "equity", reason: "Select an exact equity or ETF. RavenOS will not choose a listing for you." });
    return;
  }
  ++state.selectionGeneration;
  state.selected = null;
  state.spotCurrentPrice = null;
  state.spotValuationReference = null;
  clearExternalChart();
  document.getElementById("venueSelect").replaceChildren(new Option("Select exact pool", "unavailable"));
  renderSpotFacts(null);
  setText("terminalChartTitle", "Spot pool · no selection");
  setText("terminalChartStatus", "Search for an exact pool. No default token or synthetic chart is substituted.");
  setText("terminalDeepLink", "Open Spot coverage");
  document.getElementById("terminalDeepLink").href = "/chains/solana/";
  setContextUnavailable();
  state.workspace.load({ market: "crypto_spot", asset: "", timeframe: state.timeframe, instrumentScope: "exact_pool" });
  updateQuoteBoundary();
  updateShell({
    subject: { id: "spot-pool-unselected", label: "No spot pool selected", type: "market", assetClass: "crypto", instrumentType: "exact_pool", identityScope: "unselected", chain: "all", venue: "all", marketType: "spot", economicNumeraire: "USDC", capabilities: {} },
    marketLabel: "Exact spot pool required",
    thesis: "",
    setup: "",
    evidenceState: "",
    freshnessState: "data_unavailable",
    observedAt: null,
  }, { updateUrl });
}

function createSpotResult(row, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-search-result";
  button.dataset.index = String(index);
  const identity = document.createElement("strong");
  identity.textContent = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  const venue = document.createElement("span");
  const coverage = row.chart_coverage || {};
  const chartLabel = coverage.request_supported ? "chart check on open" : "chart unavailable";
  const providerLabel = coverage.provider_id ? ` · ${String(coverage.provider_id).replace("_onchain", "")}` : "";
  const matchLabel = row.input_match === "pool_address" ? "exact pool address · " : "";
  venue.textContent = `${chainDisplayName(row.chainId)} · ${row.dexId || "venue unavailable"}${providerLabel} · ${matchLabel}${chartLabel}`;
  const liquidity = document.createElement("span");
  liquidity.textContent = `Liquidity ${compact(row.liquidityUsd, { currency: true })}`;
  const price = document.createElement("small");
  price.textContent = formatPrice(row.priceUsd);
  button.append(identity, venue, liquidity, price);
  button.addEventListener("click", () => selectSpot(row));
  return button;
}

function rankSpotRows(rows = [], query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  return [...rows].sort((left, right) => {
    const quality = (row) => {
      const exactAddress = normalized && [row.tokenAddress, row.quoteTokenAddress, row.pairAddress]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === normalized);
      const exactName = normalized && [row.symbol, row.name].filter(Boolean).some((value) => String(value).toLowerCase() === normalized);
      return {
        exactAddress,
        exactName,
        chartReady: spotChartCapability(row, "1h").chart_request_supported,
        volume: Math.max(0, finite(row.volume24h) || 0),
        liquidity: Math.max(0, finite(row.liquidityUsd) || 0),
      };
    };
    const a = quality(left);
    const b = quality(right);
    return Number(b.exactAddress) - Number(a.exactAddress)
      || Number(b.exactName) - Number(a.exactName)
      || Number(b.chartReady) - Number(a.chartReady)
      || Number(b.volume > 0) - Number(a.volume > 0)
      || Number(b.liquidity > 0) - Number(a.liquidity > 0)
      || b.volume - a.volume
      || b.liquidity - a.liquidity;
  });
}

function renderSpotResults(rows, message = "") {
  const host = document.getElementById("terminalSpotResults");
  host.replaceChildren();
  host.hidden = false;
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "terminal-search-empty";
    empty.textContent = message || "No verified public pool matched this search.";
    host.append(empty);
    return;
  }
  host.append(...rows.slice(0, 12).map(createSpotResult));
}

async function searchSpot(query) {
  const clean = String(query || "").trim();
  const generation = ++state.searchGeneration;
  if (clean.length < 2) {
    document.getElementById("terminalSpotResults").hidden = true;
    return;
  }
  renderSpotResults([], "Searching public market coverage…");
  try {
    const { response, payload } = await fetchJson(`/api/dexscreener/search?q=${encodeURIComponent(clean)}`);
    if (generation !== state.searchGeneration) return;
    const rows = response.ok && Array.isArray(payload?.results)
      ? rankSpotRows(payload.results.filter((row) => row?.chainId && row?.pairAddress && row?.tokenAddress), clean)
      : [];
    renderSpotResults(rows, response.ok ? "No verified public pool matched this search." : "Public spot lookup is unavailable.");
  } catch {
    if (generation === state.searchGeneration) renderSpotResults([], "Public spot lookup is unavailable.");
  }
}

async function selectSpot(row, { updateUrl = true } = {}) {
  closeProjectLinks();
  clearSpotTradeRefresh();
  clearSpotQuoteResult("Exact market changed. Review a new current route.");
  const chainCoverage = document.getElementById("terminalChainCoverage");
  if (chainCoverage) chainCoverage.open = false;
  const generation = ++state.selectionGeneration;
  state.lane = "spot";
  renderLaunchBadge();
  state.spotCurrentPrice = null;
  state.selected = row;
  seedSelectedSpotValuation(row);
  setActiveMarketControlRisk(null);
  state.context = null;
  state.opportunityEvidence = null;
  state.spotTradeFilter = "all";
  state.spotWalletFilter = "all";
  state.holderListFilter = "all";
  state.holderListExpandedKey = "";
  updateTerminalPaneAvailability();
  clearExternalChart();
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadTrigger", "Raven Read");
  document.getElementById("terminalSpotResults").hidden = true;
  document.getElementById("terminalSpotSearch").value = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  document.getElementById("venueSelect").replaceChildren(new Option(`${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}`, String(row.chainId || "spot")));
  renderSpotFacts(row);
  renderSpotTradeSurface();
  if (spotTradeSurfaceActive()) void loadSpotTrades();
  if (HOLDER_CHAINS.has(String(row.chainId || "").toLowerCase())) void loadHolderList();
  setText("terminalChartTitle", `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"} · ${state.timeframe}`);
  setText("terminalChartStatus", "Loading this pool’s price history.");
  const chartCapability = spotChartCapability(row, state.timeframe);
  const hasChartCoverage = chartCapability.chart_request_supported;
  setText("terminalDeepLink", hasChartCoverage ? "Holders & safety" : "Chart unavailable");
  document.getElementById("terminalDeepLink").href = hasChartCoverage ? "#terminalAnatomySection" : "/docs/#availability";
  setContextUnavailable();
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject: spotSubject(row), timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const instrumentId = `${String(row.chainId || "").toLowerCase()}:pool:${row.pairAddress}`;
  const chartPromise = state.workspace.load(spotChartRequest(row));
  const opportunityPromise = fetchExactOpportunityEvidence(instrumentId);
  const [chartState, opportunityResult] = await Promise.all([chartPromise, opportunityPromise]);
  if (generation !== state.selectionGeneration) return;
  if (!chartState?.candles?.length) {
    reconcileSelectedSpotPrice({
      chain: row.chainId,
      pool_address: row.pairAddress,
      token_address: row.tokenAddress,
      quote_token_address: row.quoteTokenAddress,
      price: row.priceUsd,
      observed_at: row.lastUpdated,
      source: "pair_snapshot",
    });
  }
  const cachedTape = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
  if (cachedTape) renderSpotTradeProjection(cachedTape);
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} candles loaded`
    : chartState?.message || "Exact-pool candles unavailable.");
  setText("terminalCapabilityLabel", [
    `Spot · ${row.quoteSymbol || "quote"} pair`,
    chartState?.candles?.length ? `${chartState.candles.length.toLocaleString()} chart candles` : "chart unavailable",
    tradeCapabilityLabel(chartCapability.trading_state),
  ].join(" · "));
  renderSpotContext(chartState, row, { updateUrl, radarEvidence: opportunityResult.spot });
}

async function reloadSelectedTimeframe(timeframe) {
  if (!TIMEFRAMES.has(timeframe) || timeframe === state.timeframe || !state.selected) return;
  if (!new Set(["perps", "spot"]).has(state.lane)) {
    state.timeframe = timeframe;
    if (state.lane === "equity") await selectAtlasInstrument(state.selected);
    return;
  }
  closeProjectLinks();
  const priorTimeframe = state.timeframe;
  const generation = ++state.selectionGeneration;
  const row = state.selected;
  const request = state.lane === "perps"
    ? perpChartRequest(row, timeframe)
    : spotChartRequest(row, timeframe);
  const label = state.lane === "perps"
    ? row.asset
    : `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  setText("terminalChartStatus", `Loading ${timeframe} candles. The ${priorTimeframe} chart remains visible.`);
  const chartState = await state.workspace.load({ ...request, preserveChart: true });
  if (generation !== state.selectionGeneration) return;
  const loaded = chartState?.timeframe === timeframe
    && chartState?.pendingTimeframe == null
    && Array.isArray(chartState?.candles)
    && chartState.candles.length > 0;
  if (!loaded) {
    state.timeframe = chartState?.timeframe || priorTimeframe;
    document.getElementById("timeframeSelect").value = state.timeframe;
    state.workspace?.setTimeframe?.(state.timeframe);
    setText("terminalChartTitle", `${label} · ${state.timeframe}`);
    renderWorkspaceState(chartState);
    updateMonitorHandoff();
    return;
  }
  state.timeframe = timeframe;
  document.getElementById("timeframeSelect").value = timeframe;
  setText("terminalChartTitle", `${label} · ${timeframe}`);
  renderWorkspaceState(chartState);
  if (state.lane === "spot") {
    const cachedTape = state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload;
    if (cachedTape) renderSpotTradeProjection(cachedTape);
  }
  updateMonitorHandoff();
  ravenOSContext.setSelection({
    subject: state.lane === "perps" ? perpSubject(row) : spotSubject(row, { ravenIntelligence: Boolean(state.context?.spot_identity_validated) }),
    timeframe,
    workspace: "market-monitor",
  }, { updateUrl: true });
}

async function loadMarkets() {
  const { response, payload } = await fetchJson("/api/hyperliquid/perps");
  if (!response.ok || !payload?.ok || !Array.isArray(payload.results) || !payload.results.length) throw new Error("hyperliquid_markets_unavailable");
  state.markets = payload.results;
  const select = document.getElementById("assetSelect");
  select.replaceChildren(...state.markets.map((row) => new Option(row.asset, row.asset)));
}

async function loadPublicPerps() {
  try {
    const { response, payload } = await fetchJson("/api/perps");
    state.publicPerps = response.ok ? payload : null;
  } catch {
    state.publicPerps = null;
  }
}

function currentAtlasProjection(payload) {
  const execution = payload?.execution_boundary || {};
  const rows = payload?.market_context?.rows;
  const exactRows = Array.isArray(rows) && rows.length > 0 && rows.every((row) => (
    row?.instrument_id
    && row.instrument?.instrument_id === row.instrument_id
    && row.instrument?.identity_scope === "exact_instrument"
    && ["equity", "etf"].includes(row.instrument?.instrument_type)
    && row.instrument?.capabilities?.execution === false
  ));
  return payload?.schema_version === "ravenos.atlas_projection.v1"
    && ["available", "degraded"].includes(payload.state)
    && ["fresh", "delayed"].includes(payload.freshness?.state)
    && payload.delivery?.source === "current_public_origin"
    && payload.delivery?.fallback === false
    && exactRows
    && execution.signing_available === false
    && execution.submission_available === false;
}

async function loadAtlasProjection() {
  const { response, payload } = await fetchJson("/api/atlas");
  if (!response.ok || !currentAtlasProjection(payload)) throw new Error("atlas_current_projection_unavailable");
  state.atlas = payload;
  return payload;
}

function requestedAtlas(params) {
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim().toLowerCase();
  const asset = String(params.get("asset") || "").trim().toUpperCase();
  const rows = state.atlas?.market_context?.rows || [];
  if (instrumentId) {
    const row = rows.find((item) => String(item.instrument_id || "").toLowerCase() === instrumentId);
    if (!row) return { error: "That exact listed instrument is not in the current market list.", instrumentId, asset };
    if (asset && String(row.symbol || "").toUpperCase() !== asset) return { error: "The requested symbol and exact listed-instrument identity do not match.", instrumentId, asset };
    return { row };
  }
  if (asset) {
    const matches = rows.filter((item) => String(item.symbol || "").toUpperCase() === asset);
    if (matches.length !== 1) return { error: matches.length ? "The symbol is ambiguous. Select an exact listed instrument." : "That listed instrument is not in the current market list.", asset };
    return { row: matches[0] };
  }
  return { error: "Select an exact equity or ETF. RavenOS will not choose a listing for you.", asset };
}

function currentListedLookup(payload, query) {
  const execution = payload?.execution_boundary || {};
  const rows = payload?.results;
  return payload?.ok === true
    && payload?.schema_version === "ravenos.instrument_lookup.v1"
    && String(payload?.query || "").toUpperCase() === String(query || "").toUpperCase()
    && payload?.delivery?.source === "current_public_origin"
    && payload?.delivery?.freshness_state === "fresh"
    && payload?.delivery?.fallback === false
    && Array.isArray(rows)
    && rows.length <= 12
    && rows.every((row) => (
      row?.schema_version === "ravenos.instrument.v1"
      && row.identity_scope === "exact_instrument"
      && ["equity", "etf"].includes(row.instrument_type)
      && row.asset_class === row.instrument_type
      && row.chain === "none"
      && row.quote_asset?.symbol === "USD"
      && row.settlement_asset?.symbol === "USD"
      && row.capabilities?.execution === false
      && row.capabilities?.quote_preview === false
    ))
    && execution.broker_connection_available === false
    && execution.quote_preview_available === false
    && execution.signing_available === false
    && execution.submission_available === false;
}

async function resolveListedSelection({ instrumentId = "", asset = "" } = {}) {
  const exactId = String(instrumentId || "").trim().toLowerCase();
  const symbol = String(asset || "").trim().toUpperCase();
  if (!exactId || !symbol) {
    return { error: "Select an exact listed instrument from universal search. RavenOS will not infer a listing from a symbol alone." };
  }
  const { response, payload } = await fetchJson(`/api/instruments/search?q=${encodeURIComponent(symbol)}`);
  if (!response.ok || !currentListedLookup(payload, symbol)) {
    return { error: "Current listed-market identity lookup is unavailable. No older listing or alternate symbol was substituted." };
  }
  const matches = payload.results.filter((row) => (
    String(row.instrument_id || "").toLowerCase() === exactId
    && String(row.symbol || "").toUpperCase() === symbol
  ));
  if (matches.length !== 1) {
    return { error: "The requested symbol and exact listed-instrument identity do not match. No substitute was loaded." };
  }
  return { row: matches[0] };
}

async function selectAtlasInstrument(row, { updateUrl = true } = {}) {
  closeProjectLinks();
  clearSpotTradeRefresh();
  clearSpotQuoteResult("Select an exact Solana pool to review a spot route.");
  const requestedSubject = atlasSubject(row);
  const atlasRow = state.atlas?.market_context?.rows?.find(
    (candidate) => candidate?.instrument_id === requestedSubject.instrumentId,
  ) || null;
  const selectedRow = atlasRow || row;
  const subject = atlasSubject(selectedRow);
  if (!subject.instrumentId || !subject.symbol) {
    await renderExplicitSelectionUnavailable({ instrumentId: subject.instrumentId, asset: subject.symbol, lane: "equity", reason: "The selected row does not contain a complete exact listed-instrument identity." });
    return;
  }
  const generation = ++state.selectionGeneration;
  state.lane = "equity";
  renderLaunchBadge();
  state.selected = selectedRow;
  setActiveMarketControlRisk(null);
  updateTerminalPaneAvailability();
  clearExternalChart();
  const options = atlasRow ? atlasOptionsFor(selectedRow) : null;
  state.context = atlasRow ? { atlas_context: { context_available: true, instrument_id: subject.instrumentId } } : null;
  document.getElementById("terminalModeSelect").value = "equity";
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  const instrument = selectedRow?.instrument?.schema_version === "ravenos.instrument.v1" ? selectedRow.instrument : selectedRow;
  document.getElementById("venueSelect").replaceChildren(new Option(titleCase(instrument?.market_identity?.listing || subject.venue), subject.venue));
  if (atlasRow) renderAtlasFacts(selectedRow);
  else renderListedFacts(selectedRow);
  setText("terminalChartTitle", `${subject.symbol} · ${state.timeframe}`);
  setText("terminalChartStatus", "Loading current candles for this listing.");
  setText("terminalDeepLink", "Open in Atlas");
  document.getElementById("terminalDeepLink").href = `/atlas/?asset=${encodeURIComponent(subject.symbol)}`;
  resetComparableEvidence();
  if (atlasRow) {
    const risk = titleCase(state.atlas?.market_context?.risk_regime, "");
    const equity = titleCase(state.atlas?.market_context?.equity_regime, "");
    const breadth = titleCase(state.atlas?.market_context?.sector_breadth, "");
    const participation = titleCase(state.atlas?.market_context?.participation_quality, "");
    const alignment = titleCase(state.atlas?.posture?.alignment, "");
    const summary = [
      risk ? `${risk} risk regime` : "",
      equity ? `${equity.toLowerCase()} equities` : "",
      breadth ? `${breadth.toLowerCase()} breadth` : "",
      participation ? `${participation.toLowerCase()} participation` : "",
    ].filter(Boolean).join(" · ");
    const optionParts = [
      titleCase(options?.regime, ""),
      titleCase(options?.skew_state, ""),
      titleCase(options?.demand_state, ""),
    ].filter(Boolean);
    setContextControlsVisible(true, { kind: "Atlas", trigger: "Atlas Context" });
    setWhyLabel("Why it matters");
    setText("terminalReadHeadline", `${subject.symbol} · ${equity || "cross-market"} context`);
    setReadNarrative(summary, optionParts.length
      ? `Options are ${optionParts.join(" · ").toLowerCase()}; cross-market alignment is ${alignment.toLowerCase() || "mixed"}.`
      : `Cross-market alignment is ${alignment.toLowerCase() || "mixed"} with ${breadth.toLowerCase() || "current"} breadth.`);
    setContextField("terminalContextIdentity", risk, "Risk regime");
    setContextField("terminalBehavior", breadth, "Breadth");
    setContextField("terminalPath", participation, "Participation");
    setContextField("terminalEvidenceMaturity", optionParts.join(" · "), "Options");
    const atlasFreshness = state.atlas?.freshness?.state || "delayed";
    setText("terminalEvidenceState", `${atlasFreshness === "fresh" ? "Current" : titleCase(atlasFreshness)}${state.atlas?.generated_at ? ` · ${timestamp(state.atlas.generated_at)}` : ""}`);
    setState("terminalContextFreshness", atlasFreshness, atlasFreshness === "fresh" ? "Current" : titleCase(atlasFreshness));
    state.context = {
      ...state.context,
      alpha_card: {
        id: "atlas-current-read",
        label: "Atlas context",
        headline: `${subject.symbol} · ${equity || "Cross-market"}`,
        detail: summary,
        meta: `${alignment || "Cross-market"} alignment${state.atlas?.generated_at ? ` · ${timestamp(state.atlas.generated_at)}` : ""}`,
        tone: /risk on|bull|positive|broad/i.test(`${equity} ${breadth} ${alignment}`)
          ? "positive"
          : /risk off|bear|negative|narrow/i.test(`${equity} ${breadth} ${alignment}`)
            ? "negative"
            : "neutral",
      },
    };
  } else {
    setContextUnavailable();
  }
  renderAlphaStack();
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject, timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const chartState = await state.workspace.load({
    market: "equities",
    asset: subject.symbol,
    instrumentId: subject.instrumentId,
    instrumentType: subject.instrumentType,
    timeframe: state.timeframe,
    chain: "none",
    marketIdentity: subject.instrumentId,
    instrumentScope: "exact_instrument",
    expectedIdentity: {
      canonicalId: subject.instrumentId,
      instrumentType: subject.instrumentType,
      identityScope: "venue_market",
      chain: "none",
      venue: subject.venue,
      baseAsset: subject.symbol,
      quoteAsset: "USD",
    },
  });
  if (generation !== state.selectionGeneration) return;
  state.workspace.render({
    asset: subject.symbol,
    market: "equities",
    venue: subject.venue,
    chain: "none",
    timeframe: state.timeframe,
    events: [],
    overlays: [],
    visibleOverlayTypes: [],
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
    onOverlaySelect: captureCurrentRavenOverlayTypes,
  });
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} candles · ${titleCase(subject.instrumentType)}`
    : chartState?.message || "Exact listed-instrument candles unavailable.");
  let visualChart = null;
  if (!chartState?.candles?.length) {
    visualChart = showListedVisualChart(selectedRow);
    if (visualChart) {
      setText("terminalChartStatus", `TradingView visual chart · exact ${titleCase(subject.instrumentType)} · ${visualChart.timing}`);
      setState("terminalMarketFreshness", "available", "Chart");
      renderExternalSourceDetails(visualChart);
      setText("terminalAnatomyState", "TradingView · exact listing");
    }
  }
  if (!atlasRow && chartState?.candles?.length) setLastMetric(chartState.candles.at(-1)?.close);
  updateShell({
    subject,
    marketLabel: atlasRow ? `${subject.symbol} · ${titleCase(state.atlas?.market_context?.equity_regime)} equity regime` : `${subject.symbol} · exact listed market`,
    thesis: atlasRow
      ? `Cross-market alignment is ${titleCase(state.atlas?.posture?.alignment).toLowerCase()}.`
      : "",
    setup: atlasRow ? state.atlas?.posture?.state || "atlas_context" : "",
    supporting: atlasRow ? Object.entries(state.atlas?.rail_breadth || {}).slice(0, 4).map(([rail, value]) => `${titleCase(rail)}: ${titleCase(value?.trend)} trend · ${titleCase(value?.participation)} participation.`) : [],
    contradicting: atlasRow ? Object.entries(state.atlas?.provider_health || {}).filter(([, value]) => value?.degraded).map(([rail]) => `${titleCase(rail)} market data is updating.`) : [],
    evidenceState: atlasRow ? "atlas_context" : "",
    freshnessState: atlasRow ? state.atlas?.freshness?.state === "fresh" ? "live" : "delayed" : visualChart ? "visual_context" : chartState?.state || "data_unavailable",
    freshnessLabel: atlasRow ? "Atlas context" : visualChart ? "Chart context" : chartState?.operatorStateLabel || "",
    observedAt: atlasRow ? selectedRow.observed_at || state.atlas?.generated_at : chartState?.observedAt,
  }, { updateUrl });
}

function defaultPerp(requested = "") {
  const exact = String(requested || "").toUpperCase();
  if (exact && state.markets.some((row) => row.asset === exact)) return exact;
  const contexts = state.publicPerps?.data?.instrument_context?.rows || state.publicPerps?.instrument_context?.rows;
  if (Array.isArray(contexts)) {
    const freshnessRank = { fresh: 3, delayed: 2, stale: 1 };
    const best = contexts
      .filter((row) => row?.context_available === true && state.markets.some((market) => market.asset === row.instrument))
      .sort((left, right) => (
        (freshnessRank[right.context_state] || 0) - (freshnessRank[left.context_state] || 0)
        || (finite(left.context_age_seconds) ?? Infinity) - (finite(right.context_age_seconds) ?? Infinity)
        || Number(right.outcomes?.sample_size || 0) - Number(left.outcomes?.sample_size || 0)
      ))[0];
    if (best) return best.instrument;
  }
  return state.markets.some((row) => row.asset === "SOL-PERP") ? "SOL-PERP" : state.markets[0]?.asset;
}

function requestedPerp(params) {
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim();
  const asset = String(params.get("asset") || "").trim().toUpperCase();
  if (instrumentId) {
    const row = state.markets.find((item) => String(item.instrument_id || "").toLowerCase() === instrumentId.toLowerCase());
    if (!row) return { error: "That exact perpetual is not in the current market list.", instrumentId, asset };
    if (asset && row.asset !== asset) return { error: "The requested symbol and exact instrument identity do not match.", instrumentId, asset };
    return { row };
  }
  if (asset) {
    const row = state.markets.find((item) => item.asset === asset);
    return row ? { row } : { error: "That perpetual is not in the current market list.", asset };
  }
  return { row: null };
}

function parsePoolIdentity(value = "") {
  const parts = String(value || "").trim().split(":").filter(Boolean);
  if (parts.length === 3 && parts[1] === "pool") return { chainId: parts[0], pairAddress: parts[2] };
  if (parts.length >= 5 && parts[0] === "crypto" && parts[1] === "pool") {
    return { chainId: parts[2], pairAddress: parts.slice(4).join(":") };
  }
  return null;
}

function exactPoolRequestIdentityValid(identity, { tokenAddress = "", quoteAddress = "" } = {}) {
  const chain = String(identity?.chainId || "").toLowerCase();
  if (!chain || !identity?.pairAddress) return false;
  if (chain === "solana") return true;
  return EVM_POOL_ID_RE.test(String(identity.pairAddress))
    && (!tokenAddress || EVM_DISPLAY_ADDRESS_RE.test(String(tokenAddress)))
    && (!quoteAddress || EVM_DISPLAY_ADDRESS_RE.test(String(quoteAddress)));
}

function explicitUnavailableSubject({ instrumentId = "", asset = "", lane = "perps" } = {}) {
  const pool = parsePoolIdentity(instrumentId);
  if (pool || lane === "spot") {
    return {
      id: instrumentId || "spot-pool-unresolved",
      instrumentId: instrumentId || "spot-pool-unresolved",
      type: "pool",
      label: asset || "Requested spot market",
      symbol: asset,
      assetClass: "crypto",
      instrumentType: "exact_pool",
      identityScope: instrumentId ? "exact_pool" : "unselected",
      chain: pool?.chainId || "unknown",
      venue: "unknown",
      marketType: "spot",
      preferredCashAsset: "USDC",
      economicNumeraire: "USDC",
      capabilities: {},
    };
  }
  if (lane === "equity") {
    const instrumentType = instrumentId.startsWith("etf:") ? "etf" : "equity";
    return {
      id: instrumentId || "traditional-instrument-unresolved",
      instrumentId: instrumentId || "traditional-instrument-unresolved",
      type: "instrument",
      label: asset || "Requested listed instrument",
      symbol: asset,
      assetClass: instrumentType,
      instrumentType,
      identityScope: instrumentId ? "exact_instrument" : "unselected",
      chain: "none",
      venue: "unknown",
      marketType: "equities",
      quoteAsset: "USD",
      settlementAsset: "USD",
      preferredCashAsset: "USD",
      economicNumeraire: "USDC",
      capabilities: {},
    };
  }
  return {
    id: instrumentId || `hyperliquid:perp:${asset.replace(/-PERP$/, "") || "unknown"}`,
    instrumentId: instrumentId || `hyperliquid:perp:${asset.replace(/-PERP$/, "") || "unknown"}`,
    type: "instrument",
    label: asset || "Requested perpetual",
    symbol: asset,
    assetClass: "crypto",
    instrumentType: "perpetual",
    identityScope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    marketType: "perp",
    quoteAsset: "USD",
    settlementAsset: "USDC",
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    capabilities: {},
  };
}

async function renderExplicitSelectionUnavailable({ instrumentId = "", asset = "", lane = "perps", reason } = {}) {
  closeProjectLinks();
  ++state.selectionGeneration;
  state.lane = lane;
  state.selected = null;
  state.context = null;
  setActiveMarketControlRisk(null);
  clearExternalChart();
  document.getElementById("terminalModeSelect").value = lane;
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  const subject = explicitUnavailableSubject({ instrumentId, asset, lane });
  setWhyLabel(lane === "equity" ? "What Atlas adds" : "Why Raven noticed this");
  setText("terminalReadTrigger", lane === "equity" ? "Atlas Context" : "Raven Read");
  setText("terminalPickerSymbol", subject.label, "Requested market");
  setText("terminalPickerMeta", subject.id, "Exact identity unavailable");
  setText("terminalVenueLabel", subject.venue === "unknown" ? "Unresolved" : titleCase(subject.venue));
  setText("terminalCapabilityLabel", "Exact selection unavailable · no substitute loaded");
  setText("terminalInstrumentScope", subject.identityScope === "exact_pool" ? "Exact pool" : "Exact instrument");
  setText("terminalInstrument", subject.label);
  setText("terminalInstrumentMeta", subject.id);
  setText("terminalChartTitle", `${subject.label} · unavailable`);
  setText("terminalChartStatus", reason || "The exact requested market is unavailable. RavenOS did not choose a substitute.");
  clearMarketMetrics();
  setAnatomyRows([]);
  document.getElementById("terminalAnatomySection").hidden = true;
  setState("terminalMarketFreshness", "unavailable", "Unavailable");
  setContextUnavailable();
  updateQuoteBoundary();
  state.workspace.showUnavailable({
    message: reason || "The exact requested market is unavailable. No substitute data was loaded.",
    marketIdentity: subject.id,
    instrumentScope: subject.identityScope,
    timeframe: state.timeframe,
  });
  updateShell({
    subject,
    marketLabel: "Exact selection unavailable",
    thesis: "No market or Raven state is shown because the requested identity did not resolve exactly.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: "data_unavailable",
    observedAt: null,
  }, { updateUrl: false });
}

async function loadExactPool(instrumentId, { updateUrl = false, tokenAddress = "", quoteAddress = "" } = {}) {
  const identity = parsePoolIdentity(instrumentId);
  if (!identity || !exactPoolRequestIdentityValid(identity, { tokenAddress, quoteAddress })) {
    await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The requested exact-pool identity is malformed." });
    return;
  }
  try {
    const pairParams = new URLSearchParams({
      chainId: identity.chainId,
      pairAddress: identity.pairAddress,
    });
    if (tokenAddress) pairParams.set("tokenAddress", tokenAddress);
    const { response, payload } = await fetchJson(`/api/dexscreener/pair?${pairParams.toString()}`);
    const rows = response.ok && Array.isArray(payload?.results) ? payload.results : [];
    const row = rows.find((item) => String(item.pairAddress || "").toLowerCase() === identity.pairAddress.toLowerCase()
      && String(item.chainId || "").toLowerCase() === identity.chainId.toLowerCase());
    if (!row) {
      await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The exact requested pool is not available from the current market-data sources." });
      return;
    }
    if (
      (tokenAddress && !sameSelectedAddress(identity.chainId, row.tokenAddress, tokenAddress))
      || (quoteAddress && !sameSelectedAddress(identity.chainId, row.quoteTokenAddress, quoteAddress))
    ) {
      await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The exact pool resolved with different token orientation. RavenOS did not substitute the other side of the pair." });
      return;
    }
    setLane("spot", { updateUrl: false, selectDefault: false });
    await selectSpot(row, { updateUrl });
  } catch {
    await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "Exact-pool lookup is currently unavailable." });
  }
}

function bindControls() {
  initializeWalletAddressControl();
  renderSpotQuickSizes();
  syncSpotTicketControls();
  document.getElementById("terminalModeSelect").addEventListener("change", (event) => setLane(event.target.value));
  document.getElementById("assetSelect").addEventListener("change", (event) => selectPerp(event.target.value));
  document.getElementById("terminalInstrumentTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.getElementById("terminalReadTrigger").addEventListener("click", focusTerminalRaven);
  document.getElementById("terminalDeepLink")?.addEventListener("click", revealSpotHolders);
  document.getElementById("terminalRiskInterruptReview")?.addEventListener("click", revealSpotHolders);
  document.getElementById("terminalContextRiskReview")?.addEventListener("click", revealSpotHolders);
  document.getElementById("terminalProjectLinksTrigger")?.addEventListener("click", () => {
    const popover = document.getElementById("terminalProjectLinksPopover");
    setProjectLinksOpen(popover?.hidden === true);
  });
  document.getElementById("terminalProjectLinksClose")?.addEventListener("click", () => closeProjectLinks({ restoreFocus: true }));
  document.getElementById("terminalProjectCopy")?.addEventListener("click", () => void copyProjectContract());
  document.getElementById("terminalQuickCopy")?.addEventListener("click", () => void copyProjectContract());
  for (const button of document.querySelectorAll("[data-project-research-action]")) {
    button.addEventListener("click", () => runProjectResearchAction(button.dataset.projectResearchAction));
  }
  document.getElementById("timeframeSelect").addEventListener("change", (event) => {
    const timeframe = TIMEFRAMES.has(event.target.value) ? event.target.value : "1h";
    if (timeframe === state.timeframe) return;
    void reloadSelectedTimeframe(timeframe);
  });
  const spotSearch = document.getElementById("terminalSpotSearch");
  spotSearch.addEventListener("input", (event) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchSpot(event.target.value), 180);
  });
  spotSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.getElementById("terminalSpotResults").hidden = true;
    spotSearch.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#terminalSpotControl, #terminalSpotResults")) document.getElementById("terminalSpotResults").hidden = true;
    const popover = document.getElementById("terminalProjectLinksPopover");
    if (!popover?.hidden && !event.target.closest("#terminalProjectLinksPopover, #terminalProjectLinksTrigger")) closeProjectLinks();
  });
  document.addEventListener("keydown", (event) => {
    const popover = document.getElementById("terminalProjectLinksPopover");
    if (event.key !== "Escape") return;
    if (popover?.hidden === false) {
      event.preventDefault();
      closeProjectLinks({ restoreFocus: true });
      return;
    }
    if (terminalUsesPaneNavigation() && document.querySelector(".terminal-live")?.dataset.terminalPane === "trade") {
      event.preventDefault();
      setTerminalPane("chart", { restoreScroll: false, focusId: "terminalChart" });
    }
  });
  document.getElementById("terminalMarkerClose")?.addEventListener("click", clearMarkerInspection);
  document.getElementById("terminalHolderList")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) void loadHolderList();
  });
  for (const button of document.querySelectorAll("[data-holder-filter]")) {
    button.addEventListener("click", () => setHolderListFilter(button.dataset.holderFilter));
  }
  document.getElementById("terminalHolderListMore")?.addEventListener("click", expandCurrentHolderList);
  document.getElementById("terminalHolderLargeAction")?.addEventListener("click", () => setHolderListFilter("large", { reveal: true }));
  document.getElementById("terminalHolderTradesAction")?.addEventListener("click", inspectActiveWallets);
  document.getElementById("terminalHolderLinksAction")?.addEventListener("click", () => setProjectLinksOpen(true));
  for (const button of document.querySelectorAll("[data-spot-trade-filter]")) {
    button.addEventListener("click", () => setSpotTradeFilter(button.dataset.spotTradeFilter));
  }
  for (const button of document.querySelectorAll("[data-spot-activity-view]")) {
    button.addEventListener("click", () => setSpotActivityView(button.dataset.spotActivityView));
  }
  for (const button of document.querySelectorAll("[data-active-wallet-filter]")) {
    button.addEventListener("click", () => setSpotWalletFilter(button.dataset.activeWalletFilter));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearSpotTradeRefresh();
      clearSpotQuoteRefresh();
    } else {
      if (spotTradeSurfaceActive()) void loadSpotTrades();
      if (state.spotQuoteFollow) {
        if (spotQuoteStillCurrent()) scheduleSpotQuoteRefresh();
        else if (state.spotQuoteFingerprint === spotTicketFingerprint() && spotQuoteSurfaceActive()) {
          void requestSpotQuote({ automatic: true, expectedFingerprint: state.spotQuoteFingerprint });
        }
      }
    }
  });
  document.getElementById("terminalChartMarkerClose")?.addEventListener("click", clearMarkerInspection);
  document.getElementById("terminalChartMarkerEvidence")?.addEventListener("click", showFullMarkerEvidence);
  document.getElementById("terminalPreviewLong")?.addEventListener("click", () => setMarketPreviewSide("long", { refresh: true }));
  document.getElementById("terminalPreviewShort")?.addEventListener("click", () => setMarketPreviewSide("short", { refresh: true }));
  for (const button of document.querySelectorAll("[data-order-type]")) {
    button.addEventListener("click", () => setOrderPlanType(button.dataset.orderType, { refresh: true }));
  }
  document.getElementById("terminalPreviewAction")?.addEventListener("click", () => requestOrderPlan());
  document.getElementById("terminalLiveExecutionAction")?.addEventListener("click", () => void handleLiveExecutionAction());
  document.getElementById("terminalPreviewNotional")?.addEventListener("input", () => clearMarketPreviewResult("Size changed. Preview again against the current book."));
  document.getElementById("terminalPreviewNotional")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void requestOrderPlan();
  });
  document.getElementById("terminalPreviewLeverage")?.addEventListener("change", () => requestOrderPlan());
  document.getElementById("terminalPreviewPrice")?.addEventListener("input", () => clearMarketPreviewResult("Entry changed. Review again against the current book."));
  document.getElementById("terminalPreviewPrice")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void requestOrderPlan();
  });
  document.getElementById("terminalPreviewTif")?.addEventListener("change", () => requestOrderPlan());
  document.getElementById("terminalPreviewMarginMode")?.addEventListener("change", () => requestOrderPlan());
  document.getElementById("terminalPreviewImpactLimit")?.addEventListener("change", () => requestOrderPlan());
  document.getElementById("terminalPreviewReduceOnly")?.addEventListener("change", () => requestOrderPlan());
  document.getElementById("terminalPreviewTakeProfit")?.addEventListener("input", () => clearMarketPreviewResult("Risk levels changed. Review the plan again."));
  document.getElementById("terminalPreviewStopLoss")?.addEventListener("input", () => clearMarketPreviewResult("Risk levels changed. Review the plan again."));
  document.getElementById("terminalPlanLoad")?.addEventListener("click", loadRavenPlanIntoTicket);
  document.getElementById("terminalPlanToggle")?.addEventListener("change", (event) => {
    setPlanOverlayActive(event.target.checked === true, { source: "plan-preview" });
  });
  document.getElementById("terminalChartPlanInspect")?.addEventListener("click", focusPlanPreview);
  document.getElementById("terminalChartPlanHide")?.addEventListener("click", () => setPlanOverlayActive(false, { source: "chart-strip", switchToChart: false }));
  document.getElementById("terminalAccountForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadTerminalAccount(document.getElementById("terminalAccountAddress")?.value);
  });
  document.getElementById("terminalUseWallet")?.addEventListener("click", () => void useBrowserWalletAddress());
  document.getElementById("terminalWalletConnect")?.addEventListener("click", () => void connectTerminalWallet());
  document.getElementById("terminalSpotRiskSummary")?.addEventListener("click", inspectSpotRisk);
  document.getElementById("terminalSpotWalletConnect")?.addEventListener("click", () => void connectSpotWalletReadOnly());
  document.getElementById("terminalSpotQuoteAction")?.addEventListener("click", () => void requestSpotQuote());
  document.getElementById("terminalSpotLiveAction")?.addEventListener("click", () => void handleSpotLiveExecutionAction());
  document.getElementById("terminalSpotQuoteFollow")?.addEventListener("change", (event) => {
    state.spotQuoteFollow = event.currentTarget.checked === true;
    syncSpotQuoteFollowControl();
    if (!state.spotQuoteFollow) {
      clearSpotQuoteRefresh();
      return;
    }
    if (spotQuoteStillCurrent()) scheduleSpotQuoteRefresh();
    else if (state.spotQuoteFingerprint === spotTicketFingerprint() && spotQuoteSurfaceActive()) {
      void requestSpotQuote({ automatic: true, expectedFingerprint: state.spotQuoteFingerprint });
    }
  });
  document.getElementById("terminalSpotAmount")?.addEventListener("input", (event) => {
    state.spotSellPercent = null;
    event.currentTarget.disabled = false;
    event.currentTarget.placeholder = "";
    clearSpotQuoteResult("Size changed. Review a new exact route.");
  });
  document.getElementById("terminalSpotAmount")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void requestSpotQuote();
  });
  for (const button of document.querySelectorAll("[data-spot-side]")) {
    button.addEventListener("click", () => setSpotTicketSide(button.dataset.spotSide));
  }
  for (const button of document.querySelectorAll("[data-spot-asset-preference]")) {
    button.addEventListener("click", () => setSpotAssetPreference(button.dataset.spotAssetPreference));
  }
  for (const button of document.querySelectorAll("[data-spot-sell-pct]")) {
    button.addEventListener("click", () => {
      if (!currentSpotWallet().connected) return;
      state.spotSellPercent = Number(button.dataset.spotSellPct);
      const input = document.getElementById("terminalSpotAmount");
      if (input) {
        input.value = "";
        input.placeholder = `${state.spotSellPercent}% of balance`;
        input.disabled = true;
      }
      for (const candidate of document.querySelectorAll("[data-spot-sell-pct]")) {
        candidate.classList.toggle("active", candidate === button);
      }
      clearSpotQuoteResult(`${state.spotSellPercent}% of the current exact-token balance selected. Review a new route.`);
    });
  }
  for (const button of document.querySelectorAll("[data-spot-plan-source]")) {
    button.addEventListener("click", () => setSpotPlanSource(button.dataset.spotPlanSource));
  }
  for (const input of document.querySelectorAll("[data-spot-buy-size-index]")) {
    input.addEventListener("change", () => {
      const sizeConfig = activeSpotBuySizeConfig();
      const next = [...sizeConfig.values];
      const index = Number(input.dataset.spotBuySizeIndex);
      next[index] = (sizeConfig.native ? boundedSpotNativeBuySize(input.value) : boundedSpotBuySize(input.value)) ?? next[index];
      saveSpotTicketPreferences({ [sizeConfig.key]: next });
      renderSpotQuickSizes();
      clearSpotQuoteResult("Quick-buy sizes updated on this device.");
    });
  }
  document.getElementById("terminalSpotTakeProfitPct")?.addEventListener("change", (event) => {
    const value = boundedSpotPreference(event.currentTarget.value, 25, { minimum: 0.1, maximum: 1_000 });
    event.currentTarget.value = String(value);
    saveSpotTicketPreferences({ take_profit_pct: value });
    clearSpotQuoteResult("Your take-profit preset changed. Review the route again.");
  });
  document.getElementById("terminalSpotStopLossPct")?.addEventListener("change", (event) => {
    const value = boundedSpotPreference(event.currentTarget.value, 12, { minimum: 0.1, maximum: 99 });
    event.currentTarget.value = String(value);
    saveSpotTicketPreferences({ stop_loss_pct: value });
    clearSpotQuoteResult("Your stop-loss preset changed. Review the route again.");
  });
  for (const id of ["terminalSpotTakeProfitPrice", "terminalSpotStopLossPrice"]) {
    document.getElementById(id)?.addEventListener("input", () => clearSpotQuoteResult("Custom exit levels changed. Review the route again."));
  }
  document.getElementById("terminalSpotSlippage")?.addEventListener("change", (event) => {
    const slippage = Math.round(boundedSpotPreference(event.currentTarget.value, 50, { minimum: 5, maximum: 300 }));
    saveSpotTicketPreferences({ slippage_bps: slippage });
    setText("terminalSpotRoutingSummary", `${(slippage / 100).toFixed(2)}% slippage · ${document.getElementById("terminalSpotPriorityMode")?.value || "standard"} priority`);
    syncSpotAdvancedSummary();
    clearSpotQuoteResult("Slippage changed. Review a new exact route.");
  });
  document.getElementById("terminalSpotPriorityMode")?.addEventListener("change", (event) => {
    const mode = event.currentTarget.value === "capped" ? "capped" : "standard";
    saveSpotTicketPreferences({ priority_mode: mode });
    const field = document.getElementById("terminalSpotPriorityCapField");
    if (field) field.hidden = mode !== "capped";
    const slippage = Number(document.getElementById("terminalSpotSlippage")?.value || 50);
    setText("terminalSpotRoutingSummary", `${(slippage / 100).toFixed(2)}% slippage · ${mode} priority`);
    syncSpotAdvancedSummary();
    clearSpotQuoteResult("Priority policy changed. Review a new exact route.");
  });
  document.getElementById("terminalSpotPriorityCap")?.addEventListener("change", (event) => {
    const cap = Math.round(boundedSpotPreference(event.currentTarget.value, 10_000, { minimum: 1_000, maximum: 50_000 }));
    event.currentTarget.value = String(cap);
    saveSpotTicketPreferences({ priority_cap_lamports: cap });
    clearSpotQuoteResult("Priority cap changed. Review a new exact route.");
  });
  for (const button of document.querySelectorAll("[data-account-tab]")) {
    button.addEventListener("click", () => setAccountTab(button.dataset.accountTab));
  }
  for (const button of document.querySelectorAll("[data-notional-preset]")) {
    button.addEventListener("click", () => {
      const input = document.getElementById("terminalPreviewNotional");
      if (!input) return;
      input.value = button.dataset.notionalPreset;
      clearMarketPreviewResult("Size changed. Preview again against the current book.");
    });
  }
  for (const button of document.querySelectorAll("[data-account-size-pct]")) {
    button.addEventListener("click", () => applyAccountSizePreset(button.dataset.accountSizePct));
  }
  for (const button of document.querySelectorAll("[data-terminal-pane-button]")) {
    button.addEventListener("click", () => inspectTerminalPane(button.dataset.terminalPaneButton));
  }
  document.getElementById("terminalTradeSheetDismiss")?.addEventListener("click", () => {
    setTerminalPane("chart", { restoreScroll: false, focusId: "terminalChart" });
  });
  document.getElementById("terminalTradeTicketClose")?.addEventListener("click", () => {
    setTerminalPane("chart", { restoreScroll: false, focusId: "terminalChart" });
  });
  document.getElementById("terminalSpotTicketClose")?.addEventListener("click", () => {
    setTerminalPane("chart", { restoreScroll: false, focusId: "terminalChart" });
  });
  for (const button of document.querySelectorAll("[data-terminal-mobile-side]")) {
    button.addEventListener("click", () => {
      const secondary = button.dataset.terminalMobileSide === "secondary";
      if (state.lane === "spot") setSpotTicketSide(secondary ? "sell" : "buy");
      else setMarketPreviewSide(secondary ? "short" : "long", { refresh: false });
      setTerminalPane("trade", {
        restoreScroll: false,
        focusId: state.lane === "spot" ? "terminalSpotAmount" : "terminalPreviewNotional",
      });
    });
  }
}

function renderWorkspaceState(workspace = {}) {
  const workspaceState = workspace?.state || "unavailable";
  const operatorState = workspace?.operatorStateLabel || titleCase(workspaceState);
  setState("terminalMarketFreshness", workspaceState, operatorState);
  const chartStateLabel = `${workspaceState} ${operatorState}`.toLowerCase();
  const chartStatus = /current|fresh|live|connected/.test(chartStateLabel)
    ? "Current"
    : /delayed|stale|lag/.test(chartStateLabel)
      ? "Delayed"
      : /loading|checking|request|connect/.test(chartStateLabel)
        ? "Loading"
        : Array.isArray(workspace?.candles) && workspace.candles.length
          ? "Available"
          : "Unavailable";
  setTerminalPaneStatus("chart", chartStatus, chartStatus === "Current" ? "positive" : chartStatus === "Unavailable" ? "warning" : "neutral");
  setText("terminalChartStatus", workspace?.refreshError || (workspace?.candles?.length
    ? `${workspace.candles.length.toLocaleString()} candles · ${workspace?.marketActivityState === "no_recent_trades" && finite(workspace?.lastCandleAgeSeconds) !== null ? `last trade ${durationLabel(workspace.lastCandleAgeSeconds)}` : marketUpdateLabel(workspace.connectionState)}`
    : workspace?.message || titleCase(workspaceState)));
  renderSourceDetails(workspace);
  renderMarketAnatomy(workspace);
  renderTradeConsequences();
  renderAlphaStack();
  syncPlanActionSurfaces();
  const boundary = document.getElementById("terminalBoundary");
  if (!boundary) return;
  boundary.dataset.state = workspaceState;
}

function bindWorkspaceEvents() {
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id && event.detail?.state !== "loading") return;
    if (state.lane === "spot" && event.detail?.instrument?.identity_scope === "exact_pool") {
      const instrument = event.detail.instrument;
      const candle = Array.isArray(event.detail?.candles) ? event.detail.candles.at(-1) : null;
      reconcileSelectedSpotPrice({
        chain: instrument.chain,
        pool_address: instrument.pool_address,
        token_address: instrument.token_address,
        quote_token_address: state.selected?.quoteTokenAddress,
        price: candle?.close,
        observed_at: Number.isFinite(Number(candle?.time)) ? new Date(Number(candle.time) * 1_000).toISOString() : null,
        source: "chart_candle",
      });
    }
    renderWorkspaceState(event.detail);
    if (state.lane === "perps" && event.detail?.orderBook) renderTerminalBook(event.detail.orderBook);
  });
  document.addEventListener("ravenos:chartenrichment", (event) => {
    if (state.lane !== "spot" || !state.selected) return;
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    renderWorkspaceState(event.detail);
    renderSpotContext(event.detail, state.selected, { updateUrl: false, radarEvidence: state.opportunityEvidence });
  });
  document.addEventListener("ravenos:chartmarket", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    if (state.lane === "perps") {
      if (event.detail?.orderBook) renderTerminalBook(event.detail.orderBook);
      renderPerpFacts();
    }
  });
  document.addEventListener("ravenos:charttape", (event) => {
    if (state.lane !== "spot") return;
    if (event.detail?.instrument_id !== state.workspace?.state?.instrument?.canonical_id) return;
    reconcileSelectedSpotPrice({
      chain: event.detail?.chain,
      pool_address: event.detail?.pool_address,
      token_address: event.detail?.token_address,
      quote_token_address: event.detail?.quote_token_address,
      price: event.detail?.last_price,
      observed_at: event.detail?.observed_at,
      source: "exact_pool_trade_tape",
    });
  });
  document.addEventListener("ravenos:chartevent", (event) => {
    if (state.lane !== "perps") return;
    if (event.detail?.instrument_id !== state.workspace?.state?.instrument?.canonical_id) return;
    if (event.detail?.type === "trade.append") renderTerminalTape([event.detail.payload, ...state.tapeRows]);
  });
}

async function loadBuildIdentity() {
  try {
    const { response, payload } = await fetchJson("/ravenos_build.json");
    setText("terminalBuildId", response.ok ? payload?.public_build_id : null, "Build unavailable");
    const marker = document.querySelector("[data-ravenos-build-id]");
    if (marker) marker.textContent = response.ok ? payload?.public_build_id || "Build unavailable" : "Build unavailable";
  } catch {
    const marker = document.querySelector("[data-ravenos-build-id]");
    if (marker) marker.textContent = "Build unavailable";
  }
}

async function boot() {
  renderChainCoverage();
  const params = new URLSearchParams(location.search);
  const requestedLaunch = String(params.get("launch") || "").toLowerCase();
  state.launchSource = ["velocity", "raven", "activity"].includes(requestedLaunch) ? requestedLaunch : "";
  state.autoRavenOverlays = Boolean(state.launchSource && params.get("raven_overlays") === "auto");
  state.savedRavenOverlays = [...new Set(String(params.get("raven_overlays") || "").split(",").map((value) => value.trim()).filter((value) => SAVED_RAVEN_OVERLAYS.has(value)))];
  state.density = SAVED_DENSITIES.has(params.get("density")) ? params.get("density") : "comfortable";
  state.requestedPanel = TERMINAL_PANELS.has(params.get("panel")) ? params.get("panel") : "chart";
  state.spotActivityView = state.requestedPanel === "activity" && SPOT_ACTIVITY_VIEWS.has(params.get("activity_view")) ? params.get("activity_view") : "trades";
  document.documentElement.dataset.density = state.density;
  document.body.dataset.density = state.density;
  state.timeframe = TIMEFRAMES.has(params.get("timeframe")) ? params.get("timeframe") : TIMEFRAMES.has(ravenOSContext.getState().timeframe) ? ravenOSContext.getState().timeframe : "1h";
  document.getElementById("timeframeSelect").value = state.timeframe;
  state.workspace = window.RavenOSPriceWorkspace?.create?.(document.getElementById("terminalChart"), {
    timeframe: state.timeframe,
    indicators: [...new Set(String(params.has("indicators") ? params.get("indicators") : "ema20").split(",").map((value) => value.trim()).filter((value) => SAVED_INDICATORS.has(value)))],
    tradeLimit: 60,
    onTimeframeChange: (timeframe) => {
      if (!TIMEFRAMES.has(timeframe)) return;
      document.getElementById("timeframeSelect").value = timeframe;
      document.getElementById("timeframeSelect").dispatchEvent(new Event("change", { bubbles: true }));
    },
    onMarkerSelect: (marker) => handleMarkerSelect(marker),
    onIndicatorChange: () => updateMonitorHandoff(),
    onChartReadChange: (read) => {
      state.chartRead = read;
      if (state.lane === "spot" && (state.context?.spot_identity_validated || state.context?.spot_plan_identity_validated)) refreshSpotStructurePlan();
      else renderAlphaStack();
    },
  });
  if (!state.workspace) throw new Error("chart_runtime_unavailable");
  bindControls();
  setMarketPreviewSide("long");
  setOrderPlanType("market", { seed: false });
  bindWorkspaceEvents();
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim();
  const poolIdentity = parsePoolIdentity(instrumentId);
  const requestedType = String(params.get("instrument_type") || "").toLowerCase();
  const requestedClass = String(params.get("asset_class") || "").toLowerCase();
  const requestedMarket = String(params.get("market") || "").toLowerCase();
  const requestedLane = params.get("lane") === "equity"
      || requestedMarket === "equities"
      || ["equity", "etf"].includes(requestedType)
      || ["equity", "etf"].includes(requestedClass)
      || /^(equity|etf):/i.test(instrumentId)
    ? "equity"
    : params.get("lane") === "spot" || requestedMarket === "spot" || requestedMarket === "crypto_spot" || requestedType === "exact_pool" || Boolean(poolIdentity)
      ? "spot"
      : "perps";
  await Promise.all([loadTradeFlags(), loadBuildIdentity()]);
  if (requestedLane === "spot") {
    if (instrumentId) await loadExactPool(instrumentId, {
      updateUrl: false,
      tokenAddress: String(params.get("token_address") || "").trim(),
      quoteAddress: String(params.get("quote_address") || "").trim(),
    });
    else {
      setLane("spot", { updateUrl: false, selectDefault: false });
      const query = String(params.get("search") || params.get("asset") || "").trim();
      if (query) {
        document.getElementById("terminalSpotSearch").value = query;
        await searchSpot(query);
      }
    }
  } else if (requestedLane === "equity") {
    let atlasRequest = null;
    try {
      await loadAtlasProjection();
      atlasRequest = requestedAtlas(params);
    } catch {
      state.atlas = null;
    }
    if (atlasRequest?.row) {
      await selectAtlasInstrument(atlasRequest.row, { updateUrl: false });
    } else {
      try {
        const listed = await resolveListedSelection({ instrumentId, asset: params.get("asset") || "" });
        if (listed.error) {
          await renderExplicitSelectionUnavailable({ instrumentId, asset: params.get("asset") || "", lane: "equity", reason: listed.error });
        } else {
          await selectAtlasInstrument(listed.row, { updateUrl: false });
        }
      } catch {
        await renderExplicitSelectionUnavailable({ instrumentId, asset: params.get("asset") || "", lane: "equity", reason: "Current listed-market identity lookup is unavailable. No older listing or alternate symbol was substituted." });
      }
    }
  } else {
    await Promise.all([loadMarkets(), loadPublicPerps()]);
    const request = requestedPerp(params);
    if (request.error) await renderExplicitSelectionUnavailable({ instrumentId: request.instrumentId, asset: request.asset, lane: "perps", reason: request.error });
    else await selectPerp(request.row?.asset || defaultPerp(), { updateUrl: !request.row });
  }
  if (state.requestedPanel === "chart") setTerminalPane("chart");
  else inspectTerminalPane(state.requestedPanel);
  updateMonitorHandoff();
  window.__RAVENOS_TERMINAL__ = {
    getState: () => ({
      lane: state.lane,
      instrument: state.lane === "perps"
        ? state.selected?.asset || null
        : state.lane === "equity"
          ? state.selected?.symbol || null
          : state.selected ? `${state.selected.symbol}/${state.selected.quoteSymbol}` : null,
      instrumentId: state.workspace?.state?.instrument?.canonical_id || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      lastCandleTime: finite(state.workspace?.state?.candles?.at(-1)?.time),
      lastCandleClose: finite(state.workspace?.state?.candles?.at(-1)?.close),
      livePriceSource: state.workspace?.state?.marketState?.live_price_source || null,
      currentPrice: state.lane === "spot" ? state.spotCurrentPrice?.price ?? null : finite(state.workspace?.state?.marketState?.last),
      currentPriceObservedAt: state.lane === "spot" ? state.spotCurrentPrice?.observedAt || null : state.workspace?.state?.observedAt || null,
      currentPriceIdentityKey: state.lane === "spot" ? state.spotCurrentPrice?.identityKey || null : state.selected?.instrument_id || null,
      currentPriceSource: state.lane === "spot" ? state.spotCurrentPrice?.source || null : state.workspace?.state?.marketState?.live_price_source || null,
      chartState: state.workspace?.state?.state || "unavailable",
      connectionState: state.workspace?.state?.connectionState || "disconnected",
      candleSource: state.workspace?.state?.candleSeries?.provider || null,
      sourceInterval: state.workspace?.state?.candleSeries?.source_interval || null,
      derivationState: state.workspace?.state?.derivation?.state || null,
      continuityState: state.workspace?.state?.continuity?.state || null,
      marketAnatomy: state.workspace?.state?.marketAnatomy || null,
      providerTransitionCount: state.workspace?.state?.providerTransitionCount || 0,
      contextState: state.context?.raven_context?.context_state || (state.context?.atlas_context?.context_available ? "atlas_context" : "unavailable"),
      launchSource: state.launchSource || null,
      autoRavenOverlays: state.autoRavenOverlays,
      chartReadDirection: state.chartRead?.direction || null,
      chartReadSetup: state.chartRead?.setup || null,
      chartReadScore: finite(state.chartRead?.score),
      planPreviewAvailable: Boolean(qualifiedPlanData()),
      planQualificationIssue: state.planQualificationIssue,
      planStrategyId: state.context?.plan_preview?.strategy_id || null,
      planTargetCount: state.context?.plan_preview?.take_profits?.length || 0,
      planOverlayEnabled: state.planOverlayEnabled,
      activeTerminalPane: document.querySelector(".terminal-live")?.dataset.terminalPane || "chart",
      spotActivityView: state.spotActivityView,
      spotWalletFilter: state.spotWalletFilter,
      selectedMarkerLabel: state.selectedMarker?.label || null,
      quoteOnly: state.flags?.quote_only === true,
      marketPreviewAvailable: state.flags?.market_preview_available === true,
      marketPreviewState: state.marketPreview?.state || "unavailable",
      marketPreviewId: state.marketPreview?.preview_id || null,
      orderPlanAvailable: state.flags?.order_plan_available === true,
      orderPlanType: state.orderPlanType,
      orderPlanState: state.orderPlan?.state || "unavailable",
      orderPlanId: state.orderPlan?.plan_id || null,
      publicAccountViewAvailable: state.flags?.public_account_view_available === true,
      publicAccountObserved: state.accountSnapshot?.ok === true,
      publicAccountPositionCount: state.accountSnapshot?.positions?.length || 0,
      publicAccountBalanceCount: state.accountSnapshot?.balances?.length || 0,
      publicAccountOrderCount: state.accountSnapshot?.open_orders?.length || 0,
      accountHistoryAvailable: state.flags?.account_history_available === true,
      accountHistoryCount: state.accountHistory?.orders?.length || 0,
      accountScenarioAvailable: state.flags?.account_scenario_available === true,
      accountScenarioState: state.orderPlan?.account_context ? state.orderPlan.state : "unavailable",
      accountTab: state.accountTab,
      walletTransportConnected: state.walletTransportConnected,
      walletAddressConnected: Boolean(state.walletAddress),
      walletVerified: false,
      walletLinked: false,
      bookLevels: terminalBookSides(state.orderBook || {}).bids.length,
      tapeCount: state.tapeRows.length,
      spotTradeCount: state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload?.trades?.length || 0,
      spotRepeatTraderCount: state.spotTradeCache.get(currentProjectIdentity()?.key)?.payload?.summary?.repeat_trader_count || 0,
      spotQuotePreviewAvailable: state.flags?.spot_quote_preview_available === true,
      spotQuotePreviewChains: Array.isArray(state.flags?.spot_quote_preview_chains) ? [...state.flags.spot_quote_preview_chains] : [],
      tradeAdapterStates: state.flags?.trade_adapter_states || {},
      spotQuoteState: spotTicketQualified()
        ? state.spotQuoteStatus === "idle" ? "ready" : state.spotQuoteStatus
        : spotTicketIdentityAvailable() ? "adapter_pending" : "unavailable",
      spotQuoteCurrent: spotQuoteStillCurrent(),
      spotQuoteFollowing: state.spotQuoteFollow,
      spotPlanSource: state.spotTicketPlanSource,
      spotFundingPreference: activeSpotAssetPreference("buy"),
      spotSettlementPreference: activeSpotAssetPreference("sell"),
      spotWalletConnected: currentSpotWallet().connected,
      spotWalletChain: currentSpotChain(),
      liveExecutionConfigured: state.liveSession?.gate?.configured === true,
      liveHyperliquidAvailable: state.liveSession?.gate?.chains?.hyperliquid?.available_to_principal === true,
      liveSolanaAvailable: state.liveSession?.gate?.chains?.solana?.available_to_principal === true,
      liveRobinhoodAvailable: state.liveSession?.gate?.chains?.robinhood?.available_to_principal === true,
      liveBscAvailable: state.liveSession?.gate?.chains?.bsc?.available_to_principal === true,
      liveBaseAvailable: state.liveSession?.gate?.chains?.base?.available_to_principal === true,
      liveEthereumAvailable: state.liveSession?.gate?.chains?.ethereum?.available_to_principal === true,
      liveExecutionTicketState: state.liveTicket?.state || "unavailable",
      liveExecutionResultState: state.liveExecutionResult?.reconciliation?.state || state.liveExecutionResult?.client_report?.state || "unavailable",
      signingAvailable: state.liveSession?.gate?.available_to_principal === true,
      submissionAvailable: state.liveSession?.gate?.available_to_principal === true,
      diagnostics: state.workspace?.diagnostics?.() || null,
      dataPlane: getChartDataPlaneDiagnostics(),
    }),
  };
}

boot().catch((error) => {
  setState("terminalMarketFreshness", "unavailable", "Unavailable");
  setState("terminalContextFreshness", "unavailable", "Unavailable");
  setText("terminalChartStatus", "The verified market path could not be established. No substitute data is shown.");
  const boundary = document.getElementById("terminalBoundary");
  if (boundary) {
    boundary.dataset.state = "unavailable";
    boundary.querySelector("strong").textContent = "Market path unavailable";
    boundary.querySelector("small").textContent = "No earlier market state was substituted";
  }
  window.RavenOSShell?.setCapabilities?.({ market: "Data unavailable", wallet: "No customer session", mode: "Read only", signing: "Sign off", broadcast: "Broadcast off", evidence: "Evidence unavailable" });
  window.__RAVENOS_TERMINAL_BOOT_ERROR__ = error instanceof Error ? error.message : "terminal_boot_failed";
});
