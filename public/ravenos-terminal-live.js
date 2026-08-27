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
const PLAN_OVERLAY_TYPES = new Set(["plan-entry", "plan-target", "plan-risk"]);
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
  paneScrollPositions: {},
  selectedMarker: null,
  planQualificationIssue: "unavailable",
  holderListGeneration: 0,
  holderListCache: new Map(),
  holderListLoadingKey: "",
};

function renderLaunchBadge() {
  const badge = document.getElementById("terminalLaunchBadge");
  if (!badge) return;
  const labels = {
    velocity: "Velocity → Terminal",
    raven: "Raven → Terminal",
    activity: "Activity → Terminal",
  };
  const label = state.lane === "spot" ? labels[state.launchSource] : "";
  badge.hidden = !label;
  badge.textContent = label || "";
  badge.title = label
    ? "Opened from Discover with exact-market Raven overlays requested. Qualified strategy levels remain research only."
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
  return titleCase(chain, "Unknown chain");
}

function tradeCapabilityLabel(value) {
  const labels = {
    review_only: "route review · signing off",
    route_review_only: "route review · signing off",
    route_review_separate: "route review separate · signing off",
    adapter_not_activated: "trading adapter not active",
    market_data_only: "market data only",
    lookup_only: "exact lookup only",
  };
  return labels[String(value || "").toLowerCase()] || "trading capability unavailable";
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
      row.chart ? "exact chart" : row.lookup ? "exact lookup" : "planned",
      row.route_review ? "route review" : "adapter queued",
      "signing off",
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
  setText("terminalTapeState", `${safeRows.length} public trades`);
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

function terminalUsesPaneNavigation() {
  return window.matchMedia?.("(max-width: 820px)")?.matches === true;
}

function afterTerminalPaneVisible(callback) {
  requestAnimationFrame(() => requestAnimationFrame(() => callback?.()));
}

function setTerminalPane(pane = "chart", { restoreScroll = true, focusId = "" } = {}) {
  const requested = new Set(["chart", "trade", "book", "raven", "account"]).has(pane) ? pane : "chart";
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
  afterTerminalPaneVisible(() => {
    if (next === "chart") state.workspace?.chartHandle?.resize?.();
    if (mobile && restoreScroll) {
      const fallback = document.querySelector(`[data-terminal-pane-button="${next}"]`)?.getBoundingClientRect?.().top + (window.scrollY || 0);
      const saved = state.paneScrollPositions[next];
      const top = Number.isFinite(saved) ? saved : Number.isFinite(fallback) ? Math.max(0, fallback - 8) : 0;
      window.scrollTo({ top, behavior: "auto" });
    }
    if (focusId) document.getElementById(focusId)?.focus?.({ preventScroll: true });
  });
  updateMonitorHandoff();
  syncPlanActionSurfaces();
  return next;
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
  const href = savedMonitorHandoffHref(subject, {
    action: "monitor",
    timeframe: state.timeframe,
    indicators: Array.from(state.workspace?.activeIndicators || []).filter((value) => SAVED_INDICATORS.has(value)),
    ravenOverlays: currentRavenOverlayTypes(),
    density: state.density,
    selectedPanel: document.querySelector(".terminal-live")?.dataset.terminalPane || "chart",
  });
  link.hidden = !href;
  if (href) link.href = href;
}

function updateTerminalPaneAvailability() {
  const perps = state.lane === "perps";
  const marketRail = document.getElementById("terminalMarketRail");
  if (marketRail) marketRail.hidden = !perps;
  const bookButton = document.querySelector('[data-terminal-pane-button="book"]');
  if (bookButton) bookButton.hidden = !perps;
  const tradeSection = document.getElementById("terminalTradeReviewSection");
  const tradeButton = document.querySelector('[data-terminal-pane-button="trade"]');
  const tradeVisible = perps && tradeSection?.hidden === false;
  if (tradeButton) tradeButton.hidden = !tradeVisible;
  const accountDock = document.getElementById("terminalAccountDock");
  const accountButton = document.querySelector('[data-terminal-pane-button="account"]');
  const accountVisible = perps && state.flags?.public_account_view_available === true;
  if (accountDock) accountDock.hidden = !accountVisible;
  if (accountButton) accountButton.hidden = !accountVisible;
  syncWalletControls();
  const current = document.querySelector(".terminal-live")?.dataset.terminalPane || "chart";
  if ((!perps && ["trade", "book", "account"].includes(current)) || (current === "trade" && !tradeVisible) || (current === "account" && !accountVisible)) setTerminalPane("chart");
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

function browserWalletProvider() {
  return globalThis.ethereum?.request ? globalThis.ethereum : null;
}

function browserWalletAddress(accounts = []) {
  return Array.isArray(accounts)
    ? accounts.find((value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || ""))) || null
    : null;
}

function syncWalletControls() {
  const available = Boolean(browserWalletProvider());
  const connected = state.walletTransportConnected && Boolean(state.walletAddress);
  for (const id of ["terminalWalletConnect", "terminalUseWallet"]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.hidden = !available || (id === "terminalWalletConnect" && state.lane !== "perps");
    button.textContent = connected ? "Disconnect view" : "Connect wallet";
    button.dataset.connected = String(connected);
    button.setAttribute("aria-label", connected
      ? "Disconnect the wallet address from this local public account view"
      : "Connect a browser wallet address for Hyperliquid public account context");
  }
}

function updateWalletShellCapability() {
  window.RavenOSShell?.setCapabilities?.({
    wallet: state.walletTransportConnected && state.walletAddress
      ? `${shortAccountAddress(state.walletAddress)} · public view`
      : browserWalletProvider() ? "Wallet ready · not connected" : "No wallet provider",
    signing: "Sign off",
    broadcast: "Broadcast off",
  });
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
  const wallet = browserWalletProvider();
  if (!wallet) return;
  if (state.walletTransportConnected) {
    clearConnectedWalletView();
    return;
  }
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

function initializeWalletAddressControl() {
  const wallet = browserWalletProvider();
  syncWalletControls();
  updateWalletShellCapability();
  if (!wallet?.on || state.walletListenersBound) return;
  state.walletListenersBound = true;
  wallet.on("accountsChanged", (accounts) => {
    if (!state.walletTransportConnected) return;
    const address = browserWalletAddress(accounts);
    if (!address) {
      clearConnectedWalletView("Wallet account access ended · no wallet permission was retained by RavenOS");
      return;
    }
    if (state.walletTransportConnected && state.walletAddress?.toLowerCase() === address.toLowerCase()) return;
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

function renderDecisionSupport({ changed = "", strengthens = [], weakens = [], checkpoint = "", reference = "" } = {}) {
  const fields = [
    ["terminalDecisionChanged", decisionSupportValue(changed)],
    ["terminalDecisionStrengthens", decisionSupportValue(strengthens)],
    ["terminalDecisionWeakens", decisionSupportValue(weakens)],
    ["terminalDecisionCheckpoint", decisionSupportValue(checkpoint)],
    ["terminalDecisionReference", decisionSupportValue(reference)],
  ];
  let visible = 0;
  for (const [id, value] of fields) visible += Number(setOptionalField(id, value));
  const host = document.getElementById("terminalDecisionSupport");
  if (host) host.hidden = visible === 0;
  return visible;
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

function ravenAlphaCard() {
  if (state.lane === "perps") {
    const payload = state.context || {};
    const context = payload.raven_context || {};
    const read = payload.raven_read || {};
    const selectedId = state.selected?.instrument_id;
    if (
      context.context_available !== true
      || !selectedId
      || payload.instrument?.instrument_id !== selectedId
      || context.instrument_id !== selectedId
    ) return null;
    return cleanAlphaCard({
      id: "raven-current-read",
      label: "Raven read",
      headline: read.headline,
      detail: read.why_raven_noticed || read.summary,
      meta: `${titleCase(context.outcomes?.evidence_maturity, "Observed")} evidence${context.observed_at ? ` · ${timestamp(context.observed_at)}` : ""}`,
      tone: context.observed_side === "short" ? "negative" : context.observed_side === "long" ? "positive" : "neutral",
    });
  }
  if (state.lane === "spot") {
    const context = state.context?.spot_context;
    if (!state.context?.spot_identity_validated || context?.state !== "current") return null;
    return cleanAlphaCard({
      id: "raven-current-read",
      label: "Raven read",
      headline: `${state.selected?.symbol || context.symbol} · ${context.movement_state}`,
      detail: context.what_changed,
      meta: `${context.scope_label || "Exact evidence"}${context.observed_at ? ` · ${timestamp(context.observed_at)}` : ""}`,
      tone: /rose|accelerat|expanded|increas/i.test(`${context.movement_state} ${context.what_changed}`)
        ? "positive"
        : /fell|decelerat|contract|decreas/i.test(`${context.movement_state} ${context.what_changed}`)
          ? "negative"
          : "neutral",
    });
  }
  return cleanAlphaCard(state.context?.alpha_card || {});
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
  const map = read?.structure_map || {};
  const anatomy = workspace.marketAnatomy || {};
  const profile = anatomy.market_profile || {};
  const controls = profile.token_controls || {};
  const holderProfile = profile.holder_distribution || anatomy.holder_distribution || {};
  const instrumentId = workspace.instrument?.canonical_id;
  const flow = spotFlowEvidence(workspace);
  const liquidity = finite(anatomy.liquidity_usd);
  const marketCap = finite(anatomy.market_cap_usd);
  const poolAgeMs = finite(anatomy.pool_age_ms);
  const top10Pct = finite(holderProfile.top_10_pct);
  const developerHoldingPct = finite(controls.developer_holding_pct);
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
    || finite(read.score) < 4
    || !["current", "fresh", "live"].includes(String(workspace.providerFreshnessState || "").toLowerCase())
    || !["current", "fresh", "live"].includes(String(workspace.candleFreshnessState || "").toLowerCase())
    || workspace.marketActivityState !== "active"
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
  const cards = [
    ravenAlphaCard(),
    planAlphaCard(),
    spotFlowAlphaCard(),
    technicalAlphaCard(),
    ...projectedAlphaCards(),
  ].filter(Boolean).filter((card, index, rows) => rows.findIndex((candidate) => candidate.id === card.id) === index).slice(0, 5);
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
    ? "no recent trades"
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

function safeProfileLink(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !url.hostname
      || url.hostname === "localhost"
      || url.hostname.endsWith(".local")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const SOLANA_DISPLAY_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function currentHolderIdentity() {
  if (state.lane !== "spot" || String(state.selected?.chainId || "").toLowerCase() !== "solana") return null;
  const poolAddress = String(state.selected?.pairAddress || "").trim();
  const tokenAddress = String(state.selected?.tokenAddress || "").trim();
  const quoteAddress = String(state.selected?.quoteTokenAddress || "").trim();
  if (!poolAddress || !tokenAddress) return null;
  return {
    key: `solana:${poolAddress}:${tokenAddress}`,
    chain: "solana",
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_address: quoteAddress,
  };
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
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== "ravenos.onchain_holder_list.v1"
    || payload?.state !== "available"
    || payload?.identity?.chain !== "solana"
    || payload.identity.pool_address !== identity.pool_address
    || payload.identity.token_address !== identity.token_address
    || !Array.isArray(payload.holders)
    || payload.holders.length > 20
    || payload?.coverage?.complete_holder_census !== false
  ) return null;
  const holders = payload.holders.filter((row) => (
    Number.isInteger(row?.rank)
    && row.rank >= 1
    && SOLANA_DISPLAY_ADDRESS_RE.test(String(row?.holder_address || ""))
    && typeof row?.balance === "string"
    && finite(row?.supply_share_pct) !== null
    && finite(row.supply_share_pct) >= 0
    && finite(row.supply_share_pct) <= 100
    && ["owner", "token_account", "exact_pool_account"].includes(row?.classification)
  ));
  if (holders.length !== payload.holders.length) return null;
  return { ...payload, holders };
}

function renderHolderListMessage(message) {
  const host = document.getElementById("terminalHolderListRows");
  if (!host) return;
  host.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.className = "terminal-holder-list-message";
  paragraph.textContent = message;
  host.append(paragraph);
}

function renderHolderListProjection(payload) {
  const host = document.getElementById("terminalHolderListRows");
  if (!host) return;
  host.replaceChildren();
  for (const row of payload.holders) {
    const item = document.createElement("article");
    item.className = "terminal-holder-row";
    item.dataset.classification = row.classification;
    const rank = document.createElement("span");
    rank.className = "terminal-holder-rank";
    rank.textContent = `#${row.rank}`;
    const identity = document.createElement("div");
    const address = document.createElement("a");
    address.href = `https://solscan.io/account/${row.holder_address}`;
    address.target = "_blank";
    address.rel = "noopener noreferrer nofollow";
    address.textContent = compactHolderAddress(row.holder_address);
    address.title = row.holder_address;
    const classification = document.createElement("small");
    classification.textContent = row.classification === "exact_pool_account"
      ? "Exact pool account · excluded from wallet concentration"
      : row.classification === "owner"
        ? row.token_account_count > 1 ? `${row.token_account_count} top token accounts · same owner` : "On-chain owner"
        : "Token account · owner unresolved";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy holder ${row.rank} address`);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(row.holder_address);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1_200);
      } catch {
        copy.textContent = "Copy failed";
      }
    });
    identity.append(address, classification, copy);
    const balance = document.createElement("strong");
    balance.textContent = holderBalanceLabel(row.balance);
    balance.title = row.balance;
    const share = document.createElement("strong");
    share.textContent = profilePercent(row.supply_share_pct) || "—";
    item.append(rank, identity, balance, share);
    host.append(item);
  }
  setText("terminalHolderListState", `${payload.holders.length} owners`);
  const observed = timestamp(payload.observed_at);
  setText("terminalHolderListNote", `Largest 20 token accounts, grouped by owner when available · not a complete holder census · ${observed}.`);
}

function renderHolderListSurface() {
  const details = document.getElementById("terminalHolderList");
  if (!details) return;
  const identity = currentHolderIdentity();
  details.hidden = !identity;
  if (!identity) {
    details.dataset.identityKey = "";
    return;
  }
  const changed = details.dataset.identityKey !== identity.key;
  details.dataset.identityKey = identity.key;
  const cached = state.holderListCache.get(identity.key);
  if (cached) renderHolderListProjection(cached);
  else if (state.holderListLoadingKey === identity.key) {
    setText("terminalHolderListState", "Loading");
    setText("terminalHolderListNote", "Reading the largest on-chain token accounts for this exact token.");
    renderHolderListMessage("Loading top holders…");
  } else {
    setText("terminalHolderListState", "View list");
    setText("terminalHolderListNote", "Ranked on-chain owners for this exact token.");
    renderHolderListMessage("Open this section to load the current holder list.");
  }
  if (changed && details.open && !cached) void loadHolderList();
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
    if (generation !== state.holderListGeneration || currentHolderIdentity()?.key !== identity.key) return;
    const verified = response.ok ? verifiedHolderProjection(payload, identity) : null;
    if (!verified) {
      setText("terminalHolderListState", "Unavailable");
      setText("terminalHolderListNote", "Top holders aren’t available for this market yet.");
      renderHolderListMessage("The exact holder list could not be verified, so RavenOS did not show partial or substituted accounts.");
      return;
    }
    state.holderListCache.set(identity.key, verified);
    if (state.holderListCache.size > 24) state.holderListCache.delete(state.holderListCache.keys().next().value);
    renderHolderListProjection(verified);
  } catch {
    if (generation !== state.holderListGeneration || currentHolderIdentity()?.key !== identity.key) return;
    setText("terminalHolderListState", "Unavailable");
    setText("terminalHolderListNote", "Top holders aren’t available for this market yet.");
    renderHolderListMessage("The exact holder list could not be loaded. No substitute market was used.");
  } finally {
    if (state.holderListLoadingKey === identity.key) state.holderListLoadingKey = "";
  }
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
  const links = document.getElementById("terminalProfileLinks");
  const credit = document.getElementById("terminalProfileCredit");
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
    && distributionTotal !== null
    && distributionTotal >= 99
    && distributionTotal <= 101;

  if (distributionRoot) distributionRoot.hidden = !distributionVisible;
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
  const controls = anatomy?.market_profile?.token_controls || {};
  const profileImage = anatomy?.market_profile?.token?.image_url;
  if (profileImage) setInstrumentImage(profileImage);
  const chipRows = [];
  if (controls.mint_authority === "disabled") chipRows.push(["Mint locked", "positive"]);
  else if (controls.mint_authority === "enabled") chipRows.push(["Mint authority active", "warning"]);
  if (controls.freeze_authority === "disabled") chipRows.push(["Freeze locked", "positive"]);
  else if (controls.freeze_authority === "enabled") chipRows.push(["Freeze authority active", "warning"]);
  if (controls.honeypot === "flagged") chipRows.push(["Honeypot flag", "danger"]);
  else if (controls.honeypot === "not_flagged") chipRows.push(["No honeypot flag", "positive"]);
  const developerHolding = finite(controls.developer_holding_pct);
  if (developerHolding !== null && developerHolding >= 0 && developerHolding <= 100) {
    chipRows.push([`Developer holds ${developerHolding.toFixed(developerHolding < 1 ? 2 : 1)}%`, developerHolding >= 5 ? "warning" : "neutral"]);
  }
  if (anatomy?.market_profile?.launch?.completed === true) chipRows.push(["Launch complete", "neutral"]);
  for (const [label, tone] of chipRows) {
    const chip = document.createElement("span");
    chip.className = "terminal-profile-chip";
    chip.dataset.tone = tone;
    chip.textContent = label;
    chips?.append(chip);
  }

  if (links) links.replaceChildren();
  let linkCount = 0;
  for (const link of (Array.isArray(anatomy?.market_profile?.links) ? anatomy.market_profile.links : []).slice(0, 6)) {
    const href = safeProfileLink(link?.url);
    const label = customerFacingText(link?.label, "");
    if (!href || !label) continue;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer nofollow";
    anchor.textContent = label;
    links?.append(anchor);
    linkCount += 1;
  }

  const attribution = anatomy?.market_profile?.attribution || {};
  const attributionUrl = safeProfileLink(attribution.url);
  const creditVisible = attribution.required === true && Boolean(attributionUrl);
  if (credit) {
    credit.hidden = !creditVisible;
    credit.textContent = creditVisible ? customerFacingText(attribution.label, "Token data source") : "";
    if (creditVisible) credit.href = attributionUrl;
    else credit.removeAttribute("href");
  }
  const factsVisible = chipRows.length > 0 || linkCount > 0 || creditVisible;
  if (facts) facts.hidden = !factsVisible;
  const section = document.getElementById("terminalAnatomySection");
  if (section && (distributionVisible || factsVisible)) section.hidden = false;
}

function renderMarketAnatomy(workspace = state.workspace?.state || {}) {
  const anatomy = workspace?.marketAnatomy || {};
  const chartProvider = readableProvider(workspace?.candleSeries?.provider || workspace?.source);
  renderSpotMarketProfile({});
  if (state.lane === "perps") {
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
    setText("terminalFingerprint", state.selected?.instrument_id, "Exact contract unavailable");
    setText("terminalAnatomyState", `${chartProvider} · exact contract`);
    return;
  }

  if (state.lane === "spot") {
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
    const marketCap = finite(anatomy.market_cap_usd ?? state.selected?.marketCap);
    const fdv = finite(anatomy.fully_diluted_value_usd ?? state.selected?.fdv);
    const routeState = String(anatomy.route?.state || "").toLowerCase();
    const buys24h = finite(anatomy.buys_24h ?? state.selected?.buys24h);
    const sells24h = finite(anatomy.sells_24h ?? state.selected?.sells24h);
    const dayFlow = buys24h !== null && sells24h !== null
      ? `${compact(buys24h)} buy · ${compact(sells24h)} sell`
      : compact(anatomy.transactions_24h ?? state.selected?.txns24h);
    const shortVolume = finite(activity.volume_usd_5m);
    const poolAgeMs = finite(anatomy.pool_age_ms)
      ?? (finite(activity.market_age_seconds) === null ? null : finite(activity.market_age_seconds) * 1_000);
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
      { label: "Pool age", value: ageLabel(poolAgeMs ?? state.selected?.pairAgeMs) },
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
  if (terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
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
  setText("terminalInstrumentMeta", row ? `${row.instrument_id} · ${timestamp(row.observed_at)}` : "Hyperliquid perpetual · unavailable");
  setText("terminalPickerSymbol", row?.asset, "No instrument");
  setText("terminalPickerMeta", row?.instrument_id, "Search any supported market");
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
  setText("terminalInstrumentMeta", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "venue unavailable"} · market snapshot` : "Search for a symbol, token, or contract");
  setText("terminalPickerSymbol", row ? `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}` : "Exact spot market required");
  setText("terminalPickerMeta", row ? `${row.chainId}:pool:${row.pairAddress}` : "Search symbol, token, pool, or contract");
  setText("terminalVenueLabel", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}` : "Unresolved");
  setText("terminalCapabilityLabel", row ? `Spot · ${row.quoteSymbol || "quote"} quote · ${chartRequestSupported ? "exact pool" : "chart unavailable"}` : "Search any supported market");
  setLastMetric(row?.priceUsd);
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
  setText("terminalComparableChange", "");
  setText("terminalComparableFavorable", "");
  setText("terminalComparableAdverse", "");
  setText("terminalComparableNote", "");
}

function renderComparables(comparables = {}) {
  const sample = Math.max(0, Math.trunc(finite(comparables.sample_size) || 0));
  if (!sample) {
    resetComparableEvidence();
    return false;
  }
  setComparableVisible(true);
  setText("terminalComparableState", titleCase(comparables.evidence_maturity, sample ? "Observed" : "Forming"));
  setText("terminalComparableN", sample.toLocaleString());
  setText("terminalComparableChange", percent(comparables.median_observed_change_pct));
  setText("terminalComparableFavorable", percent(comparables.median_favorable_excursion_pct));
  setText("terminalComparableAdverse", percent(comparables.median_adverse_excursion_pct));
  setText("terminalComparableNote", `${sample} completed future-only path${sample === 1 ? "" : "s"}${comparables.matured_through ? `; matured through ${timestamp(comparables.matured_through)}` : ""}.`);
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
    ? `Raven plan shown on the exact chart. ${planSummaryLabel(qualified)}. Research only.`
    : "Raven plan hidden. Other Raven chart layers were preserved.");
  return true;
}

function focusPlanPreview() {
  if (!qualifiedPlanData()) {
    announceRavenAction("A current Raven plan is not available for this exact market.");
    return false;
  }
  if (terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
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
      : null;
  if (!target) return false;
  if (terminalUsesPaneNavigation()) setTerminalPane("raven", { restoreScroll: false });
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
    load.hidden = state.lane !== "perps";
    load.disabled = state.lane !== "perps";
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
  setText("terminalPlanDisclaimer", plan.disclaimer || "Based on completed paths for this market. Research only—not personalized targets, stops, or orders.");
  syncPlanActionSurfaces(validated);
  return true;
}

function loadRavenPlanIntoTicket() {
  const validated = qualifiedPlanData();
  if (!validated || state.lane !== "perps") return;
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
  setContextField("terminalBehavior", "", "Behavior");
  setContextField("terminalPath", "", "Path");
  setContextField("terminalEvidenceMaturity", "", "Evidence");
  setText("terminalReadHeadline", "");
  setText("terminalReadSummary", "");
  setText("terminalWhy", "");
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
  const annotations = workspace.ravenAnnotations;
  const exactAnnotations = annotations?.role === "annotation_only"
    && annotations?.identity_scope === "exact_pool"
    && annotations?.candle_replacement_allowed === false
    && annotations?.instrument_id === workspace.instrument?.canonical_id
    ? annotations
    : null;
  const planContract = payload?.chart_overlays;
  const planOverlays = planContract?.role === "annotation_only"
    && planContract?.candle_replacement_allowed === false
    && planContract?.instrument_id === workspace.instrument?.canonical_id
    && Array.isArray(planContract.overlays)
    ? planContract.overlays
    : [];
  const overlays = [
    ...(Array.isArray(exactAnnotations?.overlays) ? exactAnnotations.overlays : []),
    ...(state.planOverlayEnabled ? planOverlays : []),
  ];
  state.workspace?.render?.({
    asset: state.selected ? `${state.selected.symbol}/${state.selected.quoteSymbol}` : "Exact pool",
    market: "crypto_spot",
    venue: state.selected?.dexId || "exact_pool",
    chain: state.selected?.chainId || "",
    timeframe: state.timeframe,
    events: Array.isArray(exactAnnotations?.events) ? exactAnnotations.events : [],
    overlays,
    visibleOverlayTypes: [
      ...currentRavenOverlayTypes(),
      ...(state.planOverlayEnabled ? ["plan-entry", "plan-target", "plan-risk"] : []),
    ],
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
  const maturity = customerFacingText(row.matured_comparables?.evidence_maturity, "")
    || (finite(row.matured_comparables?.sample_size) > 0 ? "Observed history" : "Forming");
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
  setText("terminalReadSummary", why);
  setText("terminalWhy", why);
  setContextField("terminalContextIdentity", selectedId, "Market");
  setContextField("terminalBehavior", row.pressure_state, "Pressure");
  setContextField("terminalPath", path, "Path");
  setContextField("terminalEvidenceMaturity", maturity, "Evidence");
  setText("terminalEvidenceState", finite(row.context_age_seconds) !== null ? `Observed ${durationLabel(row.context_age_seconds)} · current feed` : "Exact current opportunity");
  setState("terminalContextFreshness", "fresh", "Current");
  renderComparables(row.matured_comparables || {});
  renderDecisionSupport({ changed: why, checkpoint: path, reference });
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
  const deliveryLabel = delivery.freshness_state === "fresh" ? "current feed" : `${titleCase(delivery.freshness_state)} feed`;
  setContextControlsVisible(true, { kind: "Raven", trigger: "Raven Read" });
  setText("terminalReadHeadline", customerFacingText(read.headline, `${state.selected?.asset || "Instrument"} · current Raven read`));
  setText("terminalReadSummary", customerFacingText(read.summary, ""));
  setText("terminalWhy", customerFacingText(read.why_raven_noticed || context.why_raven_noticed, ""));
  setContextField("terminalContextIdentity", payload?.instrument?.instrument_id || state.selected?.instrument_id, "Market");
  setContextField("terminalBehavior", titleCase(context.behavior_family, ""), "Behavior");
  setContextField("terminalPath", titleCase(context.current_path || context.pressure_state || context.context_state, ""), "Path");
  setContextField("terminalEvidenceMaturity", titleCase(context.outcomes?.evidence_maturity, ""), "Evidence");
  setText("terminalEvidenceState", `${observationLabel} · ${deliveryLabel}`);
  setState("terminalContextFreshness", delivery.freshness_state || "unavailable", delivery.fallback ? `Earlier data · ${titleCase(delivery.freshness_state)}` : delivery.freshness_state === "fresh" ? "Current" : titleCase(delivery.freshness_state));
  renderDecisionSupport({
    changed: read.summary,
    strengthens: read.what_would_strengthen,
    weakens: read.what_would_weaken,
    checkpoint: opportunityEvidence?.path_review?.state,
    reference: opportunityReference(opportunityEvidence) || context.public_context_id,
  });
  renderComparables(payload?.matured_comparables || {});
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
    raven_why: customerFacingText(evidence.why_raven_noticed || decision.why_now, ""),
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
  const why = customerFacingText(
    context.raven_why || context.what_changed,
    context.what_changed,
  );
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
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadHeadline", `${row.symbol || context.symbol || "Token"} · ${movement}`);
  setText("terminalReadSummary", customerFacingText(context.what_changed, ""));
  setText("terminalWhy", why);
  setContextField("terminalContextIdentity", context.scope_label, "Scope");
  setContextField("terminalBehavior", movement, "Activity");
  setContextField(
    "terminalPath",
    context.decision_support?.next_checkpoint || "",
    "Checkpoint",
  );
  setContextField("terminalEvidenceMaturity", context.confidence_maturity || risk, context.confidence_maturity ? "Evidence" : "Risk");
  setText(
    "terminalEvidenceState",
    observedAge === null ? "Observed · current feed" : `Observed ${durationLabel(observedAge)} · current feed`,
  );
  setState("terminalContextFreshness", "fresh", "Current");
  renderDecisionSupport({
    changed: context.what_changed,
    strengthens: context.decision_support?.what_strengthens,
    weakens: context.decision_support?.what_weakens || context.risk,
    checkpoint: context.decision_support?.next_checkpoint,
    reference: context.public_reference,
  });
  resetComparableEvidence();
  refreshSpotStructurePlan();
  updateShell({
    subject: spotSubject(row, { ravenIntelligence: true }),
    marketLabel: `${row.symbol}/${row.quoteSymbol} exact pool`,
    thesis: context.what_changed,
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

function updateQuoteBoundary() {
  const flags = state.flags?.flags || {};
  const customerQuoteEnabled = state.flags?.quote_only === true
    && flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE === true
    && flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE === true;
  const orderPlanEnabled = state.flags?.order_plan_available === true
    && Array.isArray(state.flags?.order_plan_markets)
    && state.flags.order_plan_markets.includes("hyperliquid_perpetual")
    && state.lane === "perps"
    && String(state.selected?.instrument_id || "").startsWith("hyperliquid:perp:");
  const section = document.getElementById("terminalTradeReviewSection");
  if (section) section.hidden = !orderPlanEnabled;
  if (!orderPlanEnabled) {
    clearTimeout(state.marketPreviewExpiryTimer);
    clearTimeout(state.orderPlanExpiryTimer);
    state.marketPreviewExpiryTimer = null;
    state.orderPlanExpiryTimer = null;
  }
  setText("terminalQuoteState", orderPlanEnabled ? "Exact market" : customerQuoteEnabled ? "Review only" : "Read only");
  setText("terminalQuoteContract", orderPlanEnabled ? "Exact-market order plan" : customerQuoteEnabled ? "Read-only route review" : "Quote preview not enabled");
  setText("terminalQuoteNote", orderPlanEnabled
    ? "No order payload is created. Nothing is signed or sent."
    : customerQuoteEnabled
      ? "A current route may be reviewed where supported. No order can be signed or sent."
      : "No transaction is prepared, signed, or sent.");
  if (orderPlanEnabled) syncMarketPreviewControls();
  updateTerminalPaneAvailability();
  renderTradeConsequences();
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
  }, remaining + 50);
}

async function requestOrderPlan({ automatic = false } = {}) {
  if (
    state.lane !== "perps"
    || !state.selected?.instrument_id
    || state.flags?.order_plan_available !== true
  ) return;
  const notional = finite(document.getElementById("terminalPreviewNotional")?.value);
  const leverage = finite(document.getElementById("terminalPreviewLeverage")?.value);
  const price = finite(document.getElementById("terminalPreviewPrice")?.value);
  const takeProfit = finite(document.getElementById("terminalPreviewTakeProfit")?.value);
  const stopLoss = finite(document.getElementById("terminalPreviewStopLoss")?.value);
  const timeInForce = String(document.getElementById("terminalPreviewTif")?.value || "gtc");
  const marginMode = String(document.getElementById("terminalPreviewMarginMode")?.value || "cross");
  const reduceOnly = document.getElementById("terminalPreviewReduceOnly")?.checked === true;
  const maxImpactBps = finite(document.getElementById("terminalPreviewImpactLimit")?.value) || 100;
  const action = document.getElementById("terminalPreviewAction");
  const accountScenario = state.accountSnapshot?.ok === true
    && state.flags?.account_scenario_available === true
    && Array.isArray(state.flags?.account_scenario_venues)
    && state.flags.account_scenario_venues.includes("hyperliquid");
  const generation = ++state.orderPlanGeneration;
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
      body: JSON.stringify({
        ...(accountScenario ? { address: state.accountSnapshot.account.address } : {}),
        instrument_id: state.selected.instrument_id,
        side: state.marketPreviewSide,
        order_type: state.orderPlanType,
        notional_usdc: notional,
        leverage,
        limit_price: state.orderPlanType === "limit" ? price : null,
        trigger_price: state.orderPlanType === "trigger" ? price : null,
        time_in_force: state.orderPlanType === "limit" ? timeInForce : null,
        take_profit_price: takeProfit,
        stop_loss_price: stopLoss,
        margin_mode: marginMode,
        reduce_only: reduceOnly,
        max_impact_bps: maxImpactBps,
      }),
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

async function loadTradeFlags() {
  try {
    const { response, payload } = await fetchJson("/api/trade/flags");
    state.flags = response.ok ? payload : null;
  } catch {
    state.flags = null;
  }
  updateQuoteBoundary();
}

async function selectPerp(asset, { updateUrl = true } = {}) {
  const row = state.markets.find((item) => item.asset === asset);
  if (!row) return;
  const generation = ++state.selectionGeneration;
  state.lane = "perps";
  renderLaunchBadge();
  state.selected = row;
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

  const chartPromise = state.workspace.load({
    market: "perpetuals",
    asset: row.asset,
    timeframe: state.timeframe,
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
  });
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
  state.lane = lane;
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
  const generation = ++state.selectionGeneration;
  state.lane = "spot";
  renderLaunchBadge();
  state.selected = row;
  state.context = null;
  state.opportunityEvidence = null;
  updateTerminalPaneAvailability();
  clearExternalChart();
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadTrigger", "Raven Read");
  document.getElementById("terminalSpotResults").hidden = true;
  document.getElementById("terminalSpotSearch").value = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  document.getElementById("venueSelect").replaceChildren(new Option(`${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}`, String(row.chainId || "spot")));
  renderSpotFacts(row);
  setText("terminalChartTitle", `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"} · ${state.timeframe}`);
  setText("terminalChartStatus", "Loading exact-pool candles.");
  const chartCapability = spotChartCapability(row, state.timeframe);
  const hasChartCoverage = chartCapability.chart_request_supported;
  setText("terminalDeepLink", hasChartCoverage ? "Market anatomy" : "Coverage unavailable");
  document.getElementById("terminalDeepLink").href = hasChartCoverage ? "#terminalAnatomySection" : "/docs/#availability";
  setContextUnavailable();
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject: spotSubject(row), timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const instrumentId = `${String(row.chainId || "").toLowerCase()}:pool:${row.pairAddress}`;
  const chartPromise = state.workspace.load({
    market: "crypto_spot",
    asset: `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`,
    timeframe: state.timeframe,
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
  });
  const opportunityPromise = fetchExactOpportunityEvidence(instrumentId);
  const [chartState, opportunityResult] = await Promise.all([chartPromise, opportunityPromise]);
  if (generation !== state.selectionGeneration) return;
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} candles · exact pool`
    : chartState?.message || "Exact-pool candles unavailable.");
  setText("terminalCapabilityLabel", [
    `Spot · ${row.quoteSymbol || "quote"} quote`,
    chartState?.candles?.length ? `${chartState.candles.length.toLocaleString()} candles` : "chart unavailable",
    tradeCapabilityLabel(chartCapability.trading_state),
  ].join(" · "));
  renderSpotContext(chartState, row, { updateUrl, radarEvidence: opportunityResult.spot });
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
    setText("terminalReadSummary", summary);
    setText("terminalWhy", optionParts.length
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
  ++state.selectionGeneration;
  state.lane = lane;
  state.selected = null;
  state.context = null;
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
  if (!identity) {
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
  document.getElementById("terminalModeSelect").addEventListener("change", (event) => setLane(event.target.value));
  document.getElementById("assetSelect").addEventListener("change", (event) => selectPerp(event.target.value));
  document.getElementById("terminalInstrumentTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.getElementById("terminalReadTrigger").addEventListener("click", focusTerminalRaven);
  document.getElementById("timeframeSelect").addEventListener("change", (event) => {
    const timeframe = TIMEFRAMES.has(event.target.value) ? event.target.value : "1h";
    if (timeframe === state.timeframe) return;
    state.timeframe = timeframe;
    updateMonitorHandoff();
    if (state.lane === "perps" && state.selected) selectPerp(state.selected.asset);
    else if (state.lane === "spot" && state.selected) selectSpot(state.selected);
    else if (state.lane === "equity" && state.selected) selectAtlasInstrument(state.selected);
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
  });
  document.getElementById("terminalMarkerClose")?.addEventListener("click", clearMarkerInspection);
  document.getElementById("terminalHolderList")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) void loadHolderList();
  });
  document.getElementById("terminalChartMarkerClose")?.addEventListener("click", clearMarkerInspection);
  document.getElementById("terminalChartMarkerEvidence")?.addEventListener("click", showFullMarkerEvidence);
  document.getElementById("terminalPreviewLong")?.addEventListener("click", () => setMarketPreviewSide("long", { refresh: true }));
  document.getElementById("terminalPreviewShort")?.addEventListener("click", () => setMarketPreviewSide("short", { refresh: true }));
  for (const button of document.querySelectorAll("[data-order-type]")) {
    button.addEventListener("click", () => setOrderPlanType(button.dataset.orderType, { refresh: true }));
  }
  document.getElementById("terminalPreviewAction")?.addEventListener("click", () => requestOrderPlan());
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
  document.getElementById("terminalWalletConnect")?.addEventListener("click", () => void useBrowserWalletAddress());
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
    button.addEventListener("click", () => setTerminalPane(button.dataset.terminalPaneButton));
  }
}

function renderWorkspaceState(workspace = {}) {
  const workspaceState = workspace?.state || "unavailable";
  const operatorState = workspace?.operatorStateLabel || titleCase(workspaceState);
  setState("terminalMarketFreshness", workspaceState, operatorState);
  setText("terminalChartStatus", workspace?.candles?.length
    ? `${workspace.candles.length.toLocaleString()} candles · ${workspace?.marketActivityState === "no_recent_trades" && finite(workspace?.lastCandleAgeSeconds) !== null ? `last trade ${durationLabel(workspace.lastCandleAgeSeconds)}` : titleCase(workspace.connectionState)}`
    : workspace?.message || titleCase(workspaceState));
  renderSourceDetails(workspace);
  renderMarketAnatomy(workspace);
  renderTradeConsequences();
  renderAlphaStack();
  syncPlanActionSurfaces();
  const boundary = document.getElementById("terminalBoundary");
  if (!boundary) return;
  const connection = String(workspace?.connectionState || "").toLowerCase();
  const liveLabel = connection === "snapshot_only"
    ? "Market snapshot current"
    : ["live", "connected"].includes(connection)
      ? "Live market feed"
      : connection === "connecting"
        ? "Market feed connecting"
        : "Market data available";
  boundary.dataset.state = workspaceState;
  boundary.querySelector("strong").textContent = workspace?.marketActivityState === "no_recent_trades"
    ? "Market current · no recent trades"
    : workspaceState === "live"
      ? liveLabel
      : workspaceState === "delayed"
        ? "Chart delayed"
        : titleCase(workspaceState);
}

function bindWorkspaceEvents() {
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id && event.detail?.state !== "loading") return;
    renderWorkspaceState(event.detail);
    if (state.lane === "perps" && event.detail?.orderBook) renderTerminalBook(event.detail.orderBook);
  });
  document.addEventListener("ravenos:chartmarket", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    if (state.lane === "perps") {
      if (event.detail?.orderBook) renderTerminalBook(event.detail.orderBook);
      renderPerpFacts();
    }
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
  state.requestedPanel = SAVED_PANELS.has(params.get("panel")) ? params.get("panel") : "chart";
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
  setTerminalPane(state.requestedPanel);
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
      signingAvailable: false,
      submissionAvailable: false,
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
