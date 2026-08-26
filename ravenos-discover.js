import { ravenOSContext, savedMonitorHandoffFromTerminalHref } from "/ravenos-context-store.js";
import { customerFacingText } from "/ravenos-intelligence-contract.js";
import {
  buildDeskFrame,
  opportunityLifecycle,
  spotFlowRead,
  spotMarketHealth,
  spotVelocityRead,
} from "/ravenos-discover-intelligence.js";

const REFRESH_MS = 45 * 1_000;
const state = {
  rows: new Map(),
  order: [],
  markets: new Map(),
  atlasRows: [],
  featuredRows: [],
  featuredRefreshedAt: 0,
  spotRows: [],
  spotTimeframe: "5m",
  spotSort: "velocity",
  spotChain: "all",
  spotMetadata: new Map(),
  spotMetadataPending: null,
  spotDisplayOrder: [],
  spotPendingOrder: null,
  spotResolution: new Map(),
  scrolling: false,
  scrollTimer: null,
  payoff: null,
  brief: null,
  atlasContext: null,
  deskFrame: null,
  paused: false,
  expanded: false,
  loading: false,
  lastRefresh: null,
  timer: null,
};

function text(value, fallback = "Unavailable") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function usefulText(value) {
  const result = String(value ?? "").trim();
  if (!result || /^(?:unknown|unavailable|not available|not reported|n\/?a|null|none)$/i.test(result)) return "";
  return result;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function title(value, fallback = "Unavailable") {
  const result = text(value, fallback);
  return result.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compact(value, { currency = false } = {}) {
  const result = finite(value);
  if (result === null) return "—";
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
  return currency ? `$${formatted}` : formatted;
}

function percent(value) {
  const result = finite(value);
  return result === null ? "—" : `${result >= 0 ? "+" : ""}${result.toFixed(Math.abs(result) < 0.1 ? 3 : 2)}%`;
}

function when(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(parsed) + " UTC";
}

async function json(url) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  return { response, payload: await response.json().catch(() => null) };
}

function setState(id, value, label = null) {
  const node = document.getElementById(id);
  if (!node) return;
  node.dataset.state = text(value, "unavailable").toLowerCase();
  node.textContent = label || title(value);
}

function terminalHref(row) {
  if (row.source_type === "atlas_context") {
    const instrument = row.instrument_contract || {};
    const params = new URLSearchParams({
      asset: text(row.instrument, ""),
      instrument_id: text(row.instrument_id, ""),
      instrument_type: text(instrument.instrument_type, "equity"),
      asset_class: text(instrument.asset_class, "equity"),
      identity_scope: "exact_instrument",
      chain: "none",
      venue: text(instrument.venue, ""),
      market: "equities",
      quote: text(instrument.quote_asset?.symbol, "USD"),
      settlement: text(instrument.settlement_asset?.symbol, "USD"),
      cash: text(instrument.preferred_cash_asset?.symbol, "USD"),
      numeraire: text(instrument.economic_numeraire, "USDC"),
      timeframe: "1h",
    });
    return `/terminal/?${params.toString()}`;
  }
  if (
    row.source_type === "raven_spot_attention"
    || row.source_type === "market_activity"
    || (row.market_type === "spot" && row.identity_scope === "exact_pool")
  ) {
    if (row.identity_scope !== "exact_pool" || !row.pool_address) return "#";
    return spotPoolHref(row);
  }
  const params = new URLSearchParams({
    asset: text(row.instrument, ""),
    instrument_id: text(row.instrument_id, ""),
    instrument_type: "perpetual",
    asset_class: "crypto",
    identity_scope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    market: "perp",
    quote: "USD",
    settlement: "USDC",
    cash: "USDC",
    numeraire: "USDC",
    timeframe: "1h",
  });
  return `/terminal/?${params.toString()}`;
}

function atlasEntityHref(row) {
  return `/atlas/?entity_id=${encodeURIComponent(text(row.entity_id, ""))}`;
}

async function resolveExactListedInstrument(row) {
  const symbol = text(row.symbol, "").toUpperCase();
  const kind = text(row.entity_kind, "").toLowerCase();
  if (!symbol || !["equity", "etf"].includes(kind)) return null;
  const { response, payload } = await json(`/api/instruments/search?q=${encodeURIComponent(symbol)}`);
  if (!response.ok || payload?.schema_version !== "ravenos.instrument_lookup.v1") return null;
  const matches = (payload.results || []).filter((candidate) => (
    candidate?.schema_version === "ravenos.instrument.v1"
    && candidate.identity_scope === "exact_instrument"
    && String(candidate.symbol || "").toUpperCase() === symbol
    && candidate.instrument_type === kind
    && candidate.chain === "none"
    && candidate.instrument_id
  ));
  const unique = [...new Map(matches.map((candidate) => [candidate.instrument_id, candidate])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function exactListedTerminalHref(row, instrument) {
  return terminalHref({
    source_type: "atlas_context",
    instrument: row.symbol,
    instrument_id: instrument.instrument_id,
    instrument_contract: instrument,
  });
}

function spotPoolHref(row, timeframe = "1m", { launch = state.spotSort } = {}) {
  const chain = text(row.chainId || row.chain_id || row.chain, "solana").toLowerCase();
  const pairAddress = text(row.pairAddress || row.pool_address, "");
  const symbol = text(row.symbol, "");
  const quote = text(row.quoteSymbol || row.quote_symbol, "");
  if (!pairAddress) return "#";
  const params = new URLSearchParams({
    asset: quote ? `${symbol}/${quote}` : symbol,
    instrument_id: `${chain}:pool:${pairAddress}`,
    instrument_type: "exact_pool",
    asset_class: "crypto",
    identity_scope: "exact_pool",
    chain,
    venue: text(row.dexId || row.venue, ""),
    market: "spot",
    quote,
    settlement: quote,
    cash: "USDC",
    numeraire: "USDC",
    timeframe,
    launch: ["velocity", "raven", "activity"].includes(launch) ? launch : "discover",
    raven_overlays: "auto",
  });
  return `/terminal/?${params.toString()}`;
}

function sameTokenAddress(chain, left, right) {
  const expected = String(left || "").trim();
  const actual = String(right || "").trim();
  if (!expected || !actual) return false;
  return chain === "solana" ? expected === actual : expected.toLowerCase() === actual.toLowerCase();
}

function exactChartCandidates(row, results = []) {
  const chain = text(row.chain_id || row.chain, "solana").toLowerCase();
  const tokenAddress = text(row.token_address, "");
  return results
    .filter((candidate) => {
      const candidateChain = text(candidate.chainId, "").toLowerCase();
      const coverage = candidate.chart_coverage || {};
      return candidateChain === chain
        && sameTokenAddress(chain, tokenAddress, candidate.tokenAddress)
        && text(candidate.pairAddress, "") !== ""
        && coverage.state !== "unavailable"
        && coverage.one_minute_request_supported !== false;
    })
    .sort((left, right) => {
      const liquidity = (finite(right.liquidityUsd) || 0) - (finite(left.liquidityUsd) || 0);
      if (liquidity) return liquidity;
      const volume = (finite(right.volume24h) || 0) - (finite(left.volume24h) || 0);
      if (volume) return volume;
      const transactions = (finite(right.txns24h) || 0) - (finite(left.txns24h) || 0);
      if (transactions) return transactions;
      return text(left.pairAddress, "").localeCompare(text(right.pairAddress, ""));
    });
}

async function chartCandidateWorks(candidate) {
  const params = new URLSearchParams({
    market: "crypto_spot",
    asset: `${text(candidate.symbol, "TOKEN")}/${text(candidate.quoteSymbol, "QUOTE")}`,
    timeframe: "1m",
    limit: "240",
    chain: text(candidate.chainId, ""),
    pair_address: text(candidate.pairAddress, ""),
    token_address: text(candidate.tokenAddress, ""),
    quote_address: text(candidate.quoteTokenAddress, ""),
    instrument_scope: "exact_pool",
  });
  const { response, payload } = await json(`/api/terminal/chart?${params.toString()}`);
  const expectedChain = text(candidate.chainId, "").toLowerCase();
  const exactPair = text(payload?.pair_address || payload?.instrument?.pair_address, "");
  const exactToken = text(payload?.token_address || payload?.instrument?.token_address, "");
  return response.ok
    && payload?.ok === true
    && Array.isArray(payload.candles)
    && payload.candles.length > 0
    && sameTokenAddress(expectedChain, candidate.pairAddress, exactPair)
    && sameTokenAddress(expectedChain, candidate.tokenAddress, exactToken);
}

async function resolveSpotChart(row) {
  const { response, payload } = await json(`/api/dexscreener/search?q=${encodeURIComponent(text(row.token_address, ""))}`);
  if (!response.ok || !Array.isArray(payload?.results)) return null;
  const candidates = exactChartCandidates(row, payload.results);
  for (const candidate of candidates.slice(0, 3)) {
    try {
      if (await chartCandidateWorks(candidate)) return candidate;
    } catch {
      // Try the next exact market. No alternate token or aggregate chart is allowed.
    }
  }
  return null;
}

function setSpotLinkPending(anchor, pending) {
  anchor.toggleAttribute("aria-busy", pending);
  if (pending) anchor.dataset.chartResolving = "true";
  else delete anchor.dataset.chartResolving;
  const label = anchor.querySelector(".discover-open");
  if (label) label.textContent = pending ? "Opening Terminal…" : "Open in Terminal";
  const tokenLabel = anchor.querySelector(".discover-token-open");
  if (tokenLabel) tokenLabel.textContent = pending ? "Opening…" : "Terminal";
}

function resolveSpotChartCached(row) {
  const key = `${text(row.chain_id || row.chain, "solana").toLowerCase()}:${text(row.token_address, "")}`;
  if (!state.spotResolution.has(key)) {
    state.spotResolution.set(key, resolveSpotChart(row).catch(() => null));
  }
  return state.spotResolution.get(key);
}

async function primeSpotLink(anchor) {
  const row = anchor.__ravenSpotRow;
  if (!row || anchor.getAttribute("href") !== "#" || anchor.dataset.chartResolving === "true") return;
  const exactPool = await resolveSpotChartCached(row);
  if (!exactPool || anchor.__ravenSpotRow !== row) return;
  anchor.__ravenResolvedPool = exactPool;
  anchor.href = spotPoolHref(exactPool, "1m");
  syncSavedMonitorControl(anchor);
}

function configureSpotLink(anchor, row) {
  const previous = anchor.__ravenSpotRow;
  const sameToken = previous
    && text(previous.chain_id || previous.chain, "").toLowerCase() === text(row.chain_id || row.chain, "").toLowerCase()
    && sameTokenAddress(text(row.chain_id || row.chain, "").toLowerCase(), previous.token_address, row.token_address);
  if (!sameToken) anchor.__ravenResolvedPool = null;
  anchor.__ravenSpotRow = row;
  anchor.href = terminalHref(row);
  if (anchor.getAttribute("href") === "#" && anchor.__ravenResolvedPool) {
    anchor.href = spotPoolHref(anchor.__ravenResolvedPool, "1m");
  }
  if (anchor.dataset.spotLinkConfigured === "true") return;
  anchor.dataset.spotLinkConfigured = "true";
  const prime = () => { void primeSpotLink(anchor); };
  anchor.addEventListener("pointerenter", prime, { passive: true });
  anchor.addEventListener("focus", prime, { passive: true });
  anchor.addEventListener("touchstart", prime, { passive: true });
  anchor.addEventListener("click", async (event) => {
    const current = anchor.__ravenSpotRow;
    if (!current || anchor.getAttribute("href") !== "#") return;
    event.preventDefault();
    if (anchor.dataset.chartResolving === "true") return;
    setSpotLinkPending(anchor, true);
    const exactPool = anchor.__ravenResolvedPool || await resolveSpotChartCached(current);
    if (exactPool) {
      ravenOSContext.navigate(spotPoolHref(exactPool, "1m"));
      return;
    }
    setSpotLinkPending(anchor, false);
    window.RavenOSShell?.openCommandPalette?.(current.token_address);
  });
}

function append(node, tag, className, value) {
  const child = document.createElement(tag);
  if (className) child.className = className;
  child.textContent = value;
  node.append(child);
  return child;
}

function syncSavedMonitorControl(anchor) {
  const shell = anchor.closest(".discover-token-row-shell, .discover-row-shell");
  const control = shell?.querySelector(".discover-monitor-save");
  if (!control) return;
  const href = savedMonitorHandoffFromTerminalHref(anchor.href, { timeframe: state.spotTimeframe || "1h" });
  control.hidden = !href;
  if (href) control.href = href;
}

function wrapSavedMonitorControl(anchor, shellClass) {
  const existing = anchor.closest(`.${shellClass}`);
  if (existing) {
    syncSavedMonitorControl(anchor);
    return existing;
  }
  const shell = document.createElement("div");
  shell.className = shellClass;
  const control = document.createElement("a");
  control.className = "discover-monitor-save";
  control.textContent = "Save";
  control.setAttribute("aria-label", "Save this exact market to Saved Monitor");
  control.hidden = true;
  shell.append(anchor, control);
  syncSavedMonitorControl(anchor);
  return shell;
}

function renderDeskBrief({ brief = null, markets = [], spotRows = [], opportunityRows = [], atlas = null } = {}) {
  const section = document.getElementById("discoverDesk");
  const grid = document.getElementById("discoverDeskGrid");
  const signals = document.getElementById("discoverDeskSignals");
  const frame = buildDeskFrame({
    brief,
    markets,
    spotRows,
    opportunityRows,
    atlas,
    timeframe: state.spotTimeframe,
  });
  state.deskFrame = frame;
  grid.replaceChildren();
  signals.replaceChildren();
  document.getElementById("discoverDeskSummary").textContent = frame.summary;
  if (!frame.summary && !frame.cards.length) {
    section.hidden = true;
    return;
  }

  for (const signal of frame.signals) append(signals, "span", "", signal);
  for (const card of frame.cards) {
    const item = document.createElement("article");
    item.dataset.deskTone = card.tone;
    item.dataset.deskMetric = card.key;
    append(item, "span", "", card.label);
    if (card.value) append(item, "strong", "", card.value);
    if (card.detail) append(item, "small", "", card.detail);
    grid.append(item);
  }
  const observedAt = new Date(frame.observed_at || "");
  document.getElementById("discoverDeskFreshness").textContent = Number.isNaN(observedAt.getTime())
    ? "Live composite"
    : when(frame.observed_at);
  section.hidden = false;
}

function actualOpportunityDelta(row = {}) {
  if (row.source_type === "atlas_context") return text(row.what_changed, "Current Atlas context is available.");
  if (row.source_type === "raven_spot_attention") return text(row.what_changed, "Current spot activity is accelerating.");
  const market = row.market_snapshot || state.markets.get(row.instrument_id) || {};
  const current = finite(market.last_price ?? market.mark_price);
  const observed = finite(row.market_context?.entry_reference_price);
  const sinceObservation = current !== null && current > 0 && observed !== null && observed > 0
    ? ((current / observed) - 1) * 100
    : null;
  const dayChange = finite(market.day_change_pct);
  const parts = [];
  if (sinceObservation !== null) parts.push(`${percent(sinceObservation)} since Raven observed it`);
  if (dayChange !== null) parts.push(`${percent(dayChange)} over 24h`);
  if (finite(row.context_age_seconds) !== null) parts.push(`observation ${Math.max(1, Math.round(Number(row.context_age_seconds) / 60))}m old`);
  if (parts.length) return parts.join(" · ");
  return customerFacingText(row.why_raven_noticed, "No current instrument delta is available.");
}

function opportunityTraderRead(row = {}) {
  if (row.source_type === "raven_spot_attention") {
    if (row.broader_attention?.raven_observed_first === true) {
      return text(row.broader_attention.summary, row.risk);
    }
    return text(row.risk, "Short-window movement still needs follow-through.");
  }
  const translated = customerFacingText(row.why_raven_noticed, "");
  if (translated) return translated;
  const pressure = text(row.pressure_state, "").toLowerCase();
  const move = finite(row.market_snapshot?.day_change_pct);
  if (pressure.includes("mixed") || pressure.includes("choppy")) {
    if (move !== null && move >= 2) return `Price is up ${percent(move)}, but pressure is still mixed; waiting for follow-through.`;
    if (move !== null && move <= -2) return `Price is down ${Math.abs(move).toFixed(2)}%, but pressure is still mixed; direction remains choppy and unconfirmed.`;
    return "Long and short pressure remain mixed; the market is choppy and Raven is waiting for confirmation.";
  }
  if (pressure.includes("long crowding")) return "Long positioning looks crowded; watching for either a clean breakout or a fade.";
  if (pressure.includes("short crowding")) return "Short positioning looks crowded; watching for either a clean breakdown or a squeeze.";
  return "A current market change is visible, but direction still needs confirmation.";
}

function comparableSupport(row = {}) {
  const comparable = row.matured_comparables || {};
  const sample = finite(comparable.sample_size);
  const positiveRate = finite(comparable.positive_followthrough_rate);
  const favorable = finite(comparable.median_favorable_excursion_pct);
  const adverse = finite(comparable.median_adverse_excursion_pct);
  if (sample !== null && sample >= 10) {
    return {
      headline: positiveRate === null
        ? `${compact(sample)} similar periods`
        : `${compact(sample)} similar periods · ${Math.round(positiveRate * 100)}% finished higher`,
      detail: favorable !== null && adverse !== null
        ? `Median range ${percent(favorable)} favorable / ${percent(adverse)} adverse`
        : "Historical range is available in the full inspection.",
    };
  }
  if (sample !== null && sample > 1) {
    return {
      headline: `${compact(sample)} prior periods · early sample`,
      detail: "Useful for context, not enough to treat as confirmation.",
    };
  }
  if (sample === 1) {
    return {
      headline: "One prior period · too little to lean on",
      detail: "Current price and pressure still need to confirm the read.",
    };
  }
  const atom = Array.isArray(row.raven_atoms)
    ? row.raven_atoms.map((value) => usefulText(customerFacingText(value, ""))).find(Boolean)
    : "";
  const maturity = usefulText(comparable.evidence_maturity);
  const direction = usefulText(row.observed_direction);
  const friction = finite(row.market_context?.roundtrip_bps);
  return {
    headline: atom ? `${atom} observed` : "Current behavior observed",
    detail: [
      direction ? `${title(direction)} setup` : "",
      maturity ? `${title(maturity)} evidence` : "",
      friction === null ? "" : `${friction.toFixed(1)} bps observed round trip`,
    ].filter(Boolean).join(" · ") || "Price and pressure are being tracked for follow-through.",
  };
}

function pressureLabel(value) {
  const pressure = text(value, "").toLowerCase();
  if (pressure.includes("mixed") || pressure.includes("choppy")) return "Choppy / mixed";
  if (pressure.includes("long crowding")) return "Long crowding";
  if (pressure.includes("short crowding")) return "Short crowding";
  return title(value, "Direction forming");
}

function spotParticipation(row = {}) {
  const market = row.market || {};
  const buys = finite(market.buys_5m);
  const sells = finite(market.sells_5m);
  const traders = finite(market.traders_5m);
  const parts = [];
  if (buys !== null && sells !== null) parts.push(`${compact(buys)} buys · ${compact(sells)} sells`);
  if (traders !== null) parts.push(`${compact(traders)} traders`);
  return parts.join(" · ") || "Current activity is developing";
}

function spotAnatomy(row = {}) {
  const market = row.market || {};
  return [
    finite(market.liquidity_usd) === null ? null : `${compact(market.liquidity_usd, { currency: true })} liquidity`,
    finite(market.holder_count) === null ? null : `${compact(market.holder_count)} holders`,
    finite(market.price_change_1h_pct) === null ? null : `${percent(market.price_change_1h_pct)} over 1h`,
  ].filter(Boolean).join(" · ") || "Exact token activity";
}

function spotEvidenceHeadline(row = {}) {
  if (row.broader_attention?.raven_observed_first === true) {
    const seconds = finite(row.broader_attention.lead_seconds);
    if (seconds !== null && seconds > 0) {
      const duration = seconds >= 3600
        ? `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`
        : seconds >= 60
          ? `${Math.max(1, Math.round(seconds / 60))}m`
          : `${Math.round(seconds)}s`;
      return `${duration} before broader attention`;
    }
  }
  return spotParticipation(row);
}

function spotTimingLabel(row = {}) {
  if (row.broader_attention?.raven_observed_first !== true) return "";
  const seconds = finite(row.broader_attention.lead_seconds);
  if (seconds === null || seconds <= 0) return "";
  if (seconds >= 3600) return `Raven ${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h earlier`;
  if (seconds >= 60) return `Raven ${Math.max(1, Math.round(seconds / 60))}m earlier`;
  return `Raven ${Math.round(seconds)}s earlier`;
}

function spotMetric(row, metric, timeframe = state.spotTimeframe) {
  const suffix = ["price_change", "volume_change", "liquidity_change", "holder_change"].includes(metric) ? "_pct" : "";
  return finite(row?.market?.[`${metric}_${timeframe}${suffix}`]);
}

function hasDecisionUsefulSpotActivity(row) {
  const priceChange = spotMetric(row, "price_change");
  const volume = spotMetric(row, "volume_usd");
  const buys = spotMetric(row, "buys");
  const sells = spotMetric(row, "sells");
  const traders = spotMetric(row, "traders");
  return (priceChange !== null && Math.abs(priceChange) > 0)
    || (volume !== null && volume > 0)
    || (buys !== null && buys > 0)
    || (sells !== null && sells > 0)
    || (traders !== null && traders > 0);
}

function survivesCurrentSpotMarket(row = {}) {
  const market = row.market || {};
  const age = finite(row.age_seconds);
  const price = finite(market.price_usd);
  const liquidity = finite(market.liquidity_usd);
  const marketCap = finite(market.market_cap_usd);
  const change1h = finite(market.price_change_1h_pct);
  const change24h = finite(market.price_change_24h_pct);
  if (age !== null && age > 3_600) return false;
  if (price !== null && price <= 0) return false;
  if (liquidity !== null && liquidity <= 0) return false;
  if (marketCap !== null && marketCap < 1_000) return false;
  if ((change1h !== null && change1h <= -85) || (change24h !== null && change24h <= -95)) return false;
  if ([market.liquidity_change_5m_pct, market.liquidity_change_1h_pct, market.liquidity_change_24h_pct]
    .map(finite).some((value) => value !== null && value <= -85)) return false;

  const volume5m = finite(market.volume_usd_5m);
  const volume1h = finite(market.volume_usd_1h);
  const volume24h = finite(market.volume_usd_24h);
  const transactions = [market.buys_5m, market.sells_5m, market.buys_1h, market.sells_1h].map(finite);
  if (
    volume5m !== null
    && volume1h !== null
    && transactions.every((value) => value !== null)
    && volume5m <= 0
    && volume1h <= 0
    && transactions.reduce((sum, value) => sum + value, 0) <= 0
  ) return false;
  const dayTransactions = [finite(market.buys_24h), finite(market.sells_24h)];
  if (volume24h !== null && dayTransactions.every((value) => value !== null) && volume24h < 50 && dayTransactions[0] + dayTransactions[1] <= 2) return false;
  if (liquidity !== null && liquidity < 250 && volume24h !== null && volume24h < 100) return false;
  return true;
}

function spotRowId(row = {}) {
  return text(row.public_attention_id, `${text(row.chain, "solana")}:${text(row.token_address, row.instrument_id)}`);
}

function spotTokenFingerprint(value) {
  const clean = text(value, "");
  if (!clean) return "";
  return clean.length <= 13 ? clean : `${clean.slice(0, 5)}…${clean.slice(-4)}`;
}

function spotChainLabel(value) {
  const chain = text(value, "").toLowerCase();
  return chain === "robinhood" ? "Robinhood Chain" : title(chain, "On-chain");
}

function spotMarketAge(seconds) {
  const value = finite(seconds);
  if (value === null || value < 0) return "";
  if (value < 3_600) return `${Math.max(1, Math.round(value / 60))}m old`;
  if (value < 86_400) return `${Math.max(1, Math.round(value / 3_600))}h old`;
  if (value < 31_536_000) return `${Math.max(1, Math.round(value / 86_400))}d old`;
  return `${Math.max(1, Math.round(value / 31_536_000))}y old`;
}

function tokenPrice(value) {
  const result = finite(value);
  if (result === null) return "";
  if (result >= 1000) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (result >= 1) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (result >= 0.01) return `$${result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
  return `$${result.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 5 })}`;
}

function safeTokenImage(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && [
      "cdn.dexscreener.com",
      "coin-images.coingecko.com",
      "assets.coingecko.com",
    ].includes(url.hostname) ? url.toString() : "";
  } catch {
    return "";
  }
}

function spotRankedRows() {
  const current = state.spotRows.filter((row) => {
    const age = finite(row.age_seconds);
    const liquidity = finite(row.market?.liquidity_usd);
    const chain = text(row.chain_id || row.chain, "").toLowerCase();
    return ["solana", "base", "ethereum", "robinhood"].includes(chain)
      && (state.spotChain === "all" || chain === state.spotChain)
      && (age === null || age <= 3_600)
      && liquidity !== null
      && liquidity > 0
      && survivesCurrentSpotMarket(row)
      && !["inactive", "fragile"].includes(spotMarketHealth(row).state)
      && hasDecisionUsefulSpotActivity(row);
  });
  if (state.spotSort === "raven") {
    return current.sort((left, right) => {
      const leftScore = spotFlowRead(left, state.spotTimeframe).score + (left.source_type === "raven_spot_attention" ? 18 : 0);
      const rightScore = spotFlowRead(right, state.spotTimeframe).score + (right.source_type === "raven_spot_attention" ? 18 : 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return (spotMetric(right, "volume_usd") || 0) - (spotMetric(left, "volume_usd") || 0);
    });
  }
  if (state.spotSort === "velocity") {
    return current
      .map((row) => ({ row, read: spotVelocityRead(row, state.spotTimeframe) }))
      .filter(({ read }) => read.qualified)
      .sort((left, right) => {
        if (left.read.score !== right.read.score) return right.read.score - left.read.score;
        if (left.read.flow_aligned !== right.read.flow_aligned) return Number(right.read.flow_aligned) - Number(left.read.flow_aligned);
        if (left.read.chase_risk !== right.read.chase_risk) return Number(left.read.chase_risk) - Number(right.read.chase_risk);
        return (spotMetric(right.row, "volume_usd") || 0) - (spotMetric(left.row, "volume_usd") || 0);
      })
      .map(({ row }) => row);
  }
  return current
    .filter((row) => (
      spotMetric(row, "traders") !== null
      || spotMetric(row, "buys") !== null
      || spotMetric(row, "sells") !== null
    ))
    .sort((left, right) => {
      const traders = (spotMetric(right, "traders") || 0) - (spotMetric(left, "traders") || 0);
      if (traders) return traders;
      const rightTransactions = (spotMetric(right, "buys") || 0) + (spotMetric(right, "sells") || 0);
      const leftTransactions = (spotMetric(left, "buys") || 0) + (spotMetric(left, "sells") || 0);
      if (rightTransactions !== leftTransactions) return rightTransactions - leftTransactions;
      return (spotMetric(right, "volume_usd") || 0) - (spotMetric(left, "volume_usd") || 0);
    });
}

function momentumGlyph(row) {
  const values = ["5m", "1h", "24h"].map((window) => finite(row?.market?.[`price_change_${window}_pct`]));
  const available = values.filter((value) => value !== null);
  if (!available.length) return null;
  const max = Math.max(1, ...available.map((value) => Math.abs(value)));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("discover-token-momentum");
  svg.setAttribute("viewBox", "0 0 54 24");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", ["5 minute", "1 hour", "24 hour"].map((label, index) => (
    values[index] === null ? null : `${label} ${percent(values[index])}`
  )).filter(Boolean).join(", "));
  const baseline = document.createElementNS(svg.namespaceURI, "line");
  baseline.setAttribute("x1", "1");
  baseline.setAttribute("x2", "53");
  baseline.setAttribute("y1", "12");
  baseline.setAttribute("y2", "12");
  baseline.setAttribute("class", "discover-token-momentum-axis");
  svg.append(baseline);
  values.forEach((value, index) => {
    if (value === null) return;
    const height = Math.max(2, Math.round((Math.abs(value) / max) * 10));
    const bar = document.createElementNS(svg.namespaceURI, "rect");
    bar.setAttribute("x", String(5 + index * 18));
    bar.setAttribute("width", "9");
    bar.setAttribute("y", String(value >= 0 ? 12 - height : 12));
    bar.setAttribute("height", String(height));
    bar.setAttribute("rx", "1.5");
    bar.setAttribute("class", value >= 0 ? "positive" : "negative");
    svg.append(bar);
  });
  return svg;
}

function spotRavenRead(row = {}) {
  if (row.source_type === "market_activity") {
    return text(row.what_changed, `Current ${state.spotTimeframe} exact-pool activity is available.`);
  }
  const timing = spotTimingLabel(row);
  const changed = text(row.what_changed, "")
    .replace(/^Price\s+(?:rose|fell|moved)\s+.+?\s+in\s+(?:5m|1h|24h)\.\s*/i, "")
    .replace(/^./, (letter) => letter.toUpperCase());
  if (timing && changed) return `${timing}. ${changed}`;
  if (timing) return `${timing} than broader attention.`;
  return changed || text(row.movement_state, "Current participation is changing.");
}

function tokenMetadata(row) {
  return {
    ...(state.spotMetadata.get(text(row.token_address, "")) || {}),
    ...(row.image_url ? { image_url: row.image_url } : {}),
  };
}

function renderTokenAvatar(host, row) {
  const avatar = append(host, "span", "discover-token-avatar", "");
  avatar.textContent = "";
  append(avatar, "span", "discover-token-avatar-fallback", text(row.symbol, "?").slice(0, 2).toUpperCase());
  const imageUrl = safeTokenImage(tokenMetadata(row).image_url);
  if (!imageUrl) return;
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = "";
  image.width = 38;
  image.height = 38;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("load", () => avatar.dataset.imageReady = "true", { once: true });
  image.addEventListener("error", () => image.remove(), { once: true });
  avatar.append(image);
}

function renderTokenStat(host, label, value) {
  if (!value) return;
  const node = append(host, "span", "discover-token-stat", "");
  node.textContent = "";
  append(node, "small", "", label);
  append(node, "strong", "", value);
}

function updateSpotTokenRow(anchor, row, index) {
  const flow = spotFlowRead(row, state.spotTimeframe);
  const velocity = spotVelocityRead(row, state.spotTimeframe);
  const alphaRead = state.spotSort === "velocity" ? velocity : flow;
  anchor.className = "discover-token-row";
  anchor.dataset.tokenRowId = spotRowId(row);
  anchor.dataset.tokenAddress = text(row.token_address, "");
  anchor.dataset.identityScope = text(row.identity_scope, "");
  anchor.dataset.freshness = text(row.context_state, "current").toLowerCase();
  anchor.dataset.flowState = flow.state;
  anchor.dataset.flowTone = alphaRead.tone;
  anchor.dataset.signalScore = String(alphaRead.score);
  anchor.dataset.velocityState = velocity.state;
  anchor.dataset.velocityGrade = velocity.grade;
  anchor.setAttribute("aria-label", `${text(row.symbol)} exact market in Terminal`);
  anchor.replaceChildren();
  configureSpotLink(anchor, row);

  const identity = append(anchor, "div", "discover-token-identity", "");
  identity.textContent = "";
  append(identity, "span", "discover-token-rank", String(index + 1).padStart(2, "0"));
  renderTokenAvatar(identity, row);
  const copy = append(identity, "span", "discover-token-copy", "");
  copy.textContent = "";
  const name = append(copy, "span", "discover-token-name", "");
  name.textContent = "";
  append(name, "strong", "", text(row.symbol));
  append(name, "small", "", text(row.name, ""));
  append(copy, "span", "discover-token-market-id", [
    text(row.chain, ""),
    row.identity_scope === "exact_pool" ? "Exact pool" : "Exact token",
    spotTokenFingerprint(row.pool_address || row.token_address),
    spotMarketAge(row.market?.market_age_seconds),
  ].filter(Boolean).join(" · "));

  const move = append(anchor, "div", "discover-token-move", "");
  move.textContent = "";
  const movement = spotMetric(row, "price_change");
  const movementValue = append(move, "strong", "", percent(movement));
  if (movement !== null) movementValue.classList.add(movement >= 0 ? "positive" : "negative");
  const currentPrice = tokenPrice(row.market?.price_usd);
  if (currentPrice) append(move, "span", "", currentPrice);
  const glyph = momentumGlyph(row);
  if (glyph) move.append(glyph);
  append(move, "small", "", `${state.spotTimeframe} move`);

  const anatomy = append(anchor, "div", "discover-token-anatomy", "");
  anatomy.textContent = "";
  renderTokenStat(anatomy, "Vol", finite(spotMetric(row, "volume_usd")) === null ? "" : compact(spotMetric(row, "volume_usd"), { currency: true }));
  renderTokenStat(anatomy, "Liq", finite(row.market?.liquidity_usd) === null ? "" : compact(row.market.liquidity_usd, { currency: true }));
  renderTokenStat(anatomy, "MCap", finite(row.market?.market_cap_usd) === null ? "" : compact(row.market.market_cap_usd, { currency: true }));
  const traders = spotMetric(row, "traders");
  const transactions = (spotMetric(row, "buys") || 0) + (spotMetric(row, "sells") || 0);
  renderTokenStat(
    anatomy,
    traders === null ? "Tx" : "Traders",
    traders === null ? (transactions > 0 ? compact(transactions) : "") : compact(traders),
  );
  renderTokenStat(
    anatomy,
    "Holders",
    finite(row.market?.holder_count) === null ? "" : compact(row.market.holder_count),
  );

  const raven = append(anchor, "div", "discover-token-raven", "");
  raven.textContent = "";
  const ravenTiming = row.broader_attention?.raven_observed_first === true;
  const flowLabel = ravenTiming && flow.state !== "balanced" ? `Raven timing · ${flow.label}` : ravenTiming ? "Raven timing" : flow.label;
  append(raven, "span", "", state.spotSort === "velocity"
    ? `${velocity.label} · ${velocity.grade}${velocity.score}`
    : `${flowLabel} · Q${flow.score}`);
  append(raven, "strong", "", state.spotSort === "velocity"
    ? velocity.headline
    : row.source_type === "market_activity" && flow.state !== "balanced"
      ? flow.summary
      : spotRavenRead(row));
  const risk = text(row.risk, "");
  const flowDetail = [state.spotSort === "velocity" ? velocity.detail : flow.detail, risk].filter(Boolean).join(" · ");
  if (flowDetail) append(raven, "small", "", flowDetail);

  const open = append(anchor, "span", "discover-token-open", "Terminal");
  open.setAttribute("aria-hidden", "true");
  syncSavedMonitorControl(anchor);
  return anchor;
}

function sameOrder(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function renderSpotTokenTape({ forceOrder = false } = {}) {
  const host = document.getElementById("discoverTokenTapeList");
  const updates = document.getElementById("discoverTokenUpdates");
  const ranked = spotRankedRows();
  const rankedIds = ranked.map(spotRowId);
  if (state.scrolling && !forceOrder && host.childElementCount) {
    const byId = new Map(ranked.map((row) => [spotRowId(row), row]));
    [...host.querySelectorAll(".discover-token-row")].forEach((node, index) => {
      const row = byId.get(node.dataset.tokenRowId);
      if (row) updateSpotTokenRow(node, row, index);
    });
    if (!sameOrder(rankedIds, state.spotDisplayOrder)) {
      state.spotPendingOrder = rankedIds;
      updates.hidden = false;
    }
    return;
  }
  state.spotDisplayOrder = rankedIds;
  state.spotPendingOrder = null;
  updates.hidden = true;
  const existing = new Map([...host.querySelectorAll(".discover-token-row")].map((node) => [node.dataset.tokenRowId, node]));
  const fragment = document.createDocumentFragment();
  ranked.forEach((row, index) => {
    const id = spotRowId(row);
    const node = existing.get(id) || document.createElement("a");
    updateSpotTokenRow(node, row, index);
    fragment.append(wrapSavedMonitorControl(node, "discover-token-row-shell"));
  });
  if (!ranked.length) {
    const empty = append(fragment, "div", "discover-token-empty", "");
    const copy = append(empty, "div", "", "");
    const chain = state.spotChain === "all" ? "Pools" : `${spotChainLabel(state.spotChain)} pools`;
    append(copy, "h3", "", `${chain} do not clear the current alpha gate`);
    append(copy, "p", "", state.spotSort === "velocity"
      ? `Nothing in the ${state.spotTimeframe} feed currently combines a compelling move with confirmed flow and usable depth.`
      : `Nothing in the ${state.spotTimeframe} feed currently has enough liquidity and decision-useful activity to rank.`);
    const actions = append(copy, "div", "discover-token-empty-actions", "");
    if (state.spotChain !== "all") {
      const reset = append(actions, "button", "", "Scan all chains");
      reset.type = "button";
      reset.addEventListener("click", () => {
        state.spotChain = "all";
        renderSpotPulse(state.spotRows, { forceOrder: true });
      });
    }
    const search = append(actions, "button", "", "Search exact market");
    search.type = "button";
    search.addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  }
  host.replaceChildren(fragment);
}

async function hydrateSpotMetadata(rows = state.spotRows) {
  if (state.spotMetadataPending) return state.spotMetadataPending;
  const addresses = [...new Set(rows
    .filter((row) => text(row.chain_id || row.chain, "").toLowerCase() === "solana")
    .map((row) => text(row.token_address, ""))
    .filter(Boolean))]
    .filter((address) => !state.spotMetadata.has(address))
    .slice(0, 30);
  if (!addresses.length) return null;
  state.spotMetadataPending = fetch(`/api/onchain/token-metadata?chain=solana&addresses=${encodeURIComponent(addresses.join(","))}`, {
    headers: { accept: "application/json" },
  }).then(async (response) => {
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.schema_version !== "ravenos.onchain_token_metadata.v1" || !Array.isArray(payload.results)) return;
    const byAddress = new Map(payload.results.map((row) => [text(row.token_address, ""), row]));
    addresses.forEach((address) => state.spotMetadata.set(address, byAddress.get(address) || {}));
    renderSpotTokenTape();
  }).catch(() => {
    addresses.forEach((address) => state.spotMetadata.set(address, {}));
  }).finally(() => {
    state.spotMetadataPending = null;
  });
  return state.spotMetadataPending;
}

function renderSpotPulse(rows = state.spotRows, { forceOrder = false } = {}) {
  const host = document.getElementById("discoverSpotPulse");
  state.spotRows = Array.isArray(rows) ? rows : [];
  const activeFilter = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "spot";
  host.hidden = activeFilter !== "spot";
  document.querySelectorAll("[data-spot-timeframe]").forEach((button) => {
    const active = button.dataset.spotTimeframe === state.spotTimeframe;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-spot-sort]").forEach((button) => {
    const active = button.dataset.spotSort === state.spotSort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-spot-chain]").forEach((button) => {
    const active = button.dataset.spotChain === state.spotChain;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const views = {
    velocity: {
      title: "Velocity alpha",
      summary: "Exact pools ranked by price expansion, flow confirmation, participation, depth, and chase risk.",
      column: "Velocity alpha",
    },
    raven: {
      title: "Raven token reads",
      summary: "Exact pools ranked by Raven timing and current evidence-backed flow quality.",
      column: "Why Raven noticed",
    },
    activity: {
      title: "Active token markets",
      summary: "Exact pools ranked by current traders, transactions, and volume.",
      column: "Current flow",
    },
  };
  const view = views[state.spotSort] || views.velocity;
  document.getElementById("discoverSpotPulseTitle").textContent = view.title;
  document.getElementById("discoverSpotPulseSummary").textContent = view.summary;
  document.getElementById("discoverSpotWhyColumn").textContent = view.column;
  renderSpotTokenTape({ forceOrder });
  void hydrateSpotMetadata(state.spotRows);
}

function currentParticipationPayoff(value) {
  if (
    value?.schema_version !== "ravenos.participation_payoff.v1"
    || value?.state !== "current"
    || value?.public_safe !== true
    || value?.measurement?.causal_claim !== false
    || !Array.isArray(value?.insights)
    || value.insights.length < 1
    || value.insights.length > 4
  ) return null;
  const insights = value.insights.filter((row) => (
    ["rewarding", "fragile", "punishing"].includes(row?.state)
    && text(row?.subject, "") !== ""
    && finite(row?.usable_sample) >= 20
  ));
  if (!insights.length) return null;
  return { ...value, insights };
}

function renderParticipationPayoff(value) {
  const section = document.getElementById("discoverPayoff");
  const strip = document.getElementById("discoverPayoffStrip");
  const payoff = currentParticipationPayoff(value);
  state.payoff = payoff;
  strip.replaceChildren();
  if (!payoff) {
    section.hidden = true;
    document.getElementById("discoverPayoffSummary").textContent = "";
    document.getElementById("discoverPayoffDetail").textContent = "";
    return;
  }
  document.getElementById("discoverPayoffTitle").textContent = text(payoff.headline, "Participation payoff");
  document.getElementById("discoverPayoffSummary").textContent = text(payoff.summary, "");
  document.getElementById("discoverPayoffWindow").textContent = text(payoff.measurement?.display_window, "Current outcomes");
  document.getElementById("discoverPayoffDetail").textContent = text(
    payoff.comparison,
    "Comparative market sample; not a causal claim.",
  );
  for (const insight of payoff.insights) {
    const item = document.createElement("article");
    item.dataset.payoffState = insight.state;
    append(item, "span", "", insight.state === "rewarding" ? "Working" : insight.state === "fragile" ? "Fragile" : "Punishing");
    append(item, "strong", "", insight.subject);
    append(item, "small", "", text(insight.operator_detail, `${compact(insight.usable_sample)} observations`));
    strip.append(item);
  }
  section.hidden = false;
}

function createListedMarketCard(row) {
  const anchor = document.createElement("a");
  anchor.className = "discover-listed-card";
  anchor.href = atlasEntityHref(row);
  anchor.dataset.entityKind = row.entity_kind;
  anchor.dataset.entityId = row.entity_id;
  const identity = append(anchor, "div", "", "");
  identity.textContent = "";
  append(identity, "strong", "", text(row.symbol));
  append(identity, "span", "", text(row.name));
  const detail = append(anchor, "div", "", "");
  detail.textContent = "";
  append(detail, "span", "", row.entity_kind === "etf" ? "ETF" : "Equity");
  append(detail, "small", "", row.optionable ? "Options · chart on open" : "Chart on open");
  append(anchor, "b", "", "→");
  anchor.addEventListener("click", async (event) => {
    event.preventDefault();
    if (anchor.dataset.resolving === "true") return;
    anchor.dataset.resolving = "true";
    anchor.setAttribute("aria-busy", "true");
    const status = detail.querySelector("small");
    if (status) status.textContent = "Resolving exact listing…";
    const instrument = await resolveExactListedInstrument(row).catch(() => null);
    if (instrument) {
      ravenOSContext.navigate(exactListedTerminalHref(row, instrument));
      return;
    }
    ravenOSContext.navigate(atlasEntityHref(row));
  });
  return anchor;
}

function renderListedUniverse(rows = []) {
  const section = document.getElementById("discoverListedUniverse");
  const host = document.getElementById("discoverListedGrid");
  state.featuredRows = Array.isArray(rows) ? rows : [];
  host.replaceChildren();
  if (!state.featuredRows.length) {
    section.hidden = true;
    return;
  }
  state.featuredRows.forEach((row) => host.append(createListedMarketCard(row)));
  document.getElementById("discoverListedCount").textContent = `${state.featuredRows.length} markets`;
  const active = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "spot";
  section.hidden = active !== "equity";
}

function createOpportunityRow(row) {
  const atlas = row.source_type === "atlas_context";
  const spot = row.source_type === "raven_spot_attention";
  const lifecycle = atlas || spot ? null : opportunityLifecycle(row, row.market_snapshot || {});
  const anchor = document.createElement("a");
  anchor.className = "discover-row";
  anchor.dataset.opportunityId = text(row.public_opportunity_id || row.public_attention_id, row.instrument_id);
  anchor.dataset.marketType = atlas ? "equity" : spot ? "spot" : text(row.market_type, "unknown").toLowerCase();
  anchor.dataset.sourceType = atlas ? "atlas" : spot ? "raven-spot" : "raven";
  anchor.dataset.freshness = text(row.context_state, "unavailable").toLowerCase();
  if (lifecycle) {
    anchor.dataset.lifecycle = lifecycle.state;
    anchor.dataset.signalScore = String(lifecycle.score);
  }
  if (spot) configureSpotLink(anchor, row);
  else anchor.href = terminalHref(row);

  const identity = append(anchor, "div", "discover-identity", "");
  identity.textContent = "";
  append(identity, "span", "", atlas ? `${title(row.market_type)} · Atlas` : spot ? `Spot · ${spotChainLabel(row.chain_id || row.chain || "solana")}` : title(row.market_type));
  append(identity, "strong", "", spot ? text(row.symbol) : text(row.instrument));
  append(identity, "small", "", atlas
    ? `${text(row.instrument_contract?.market_identity?.listing, title(row.instrument_contract?.venue))} · exact listing`
    : spot
      ? row.identity_scope === "exact_pool"
        ? `${text(row.venue, "Spot market")} · exact pool`
        : "Exact token · opens chart directly"
      : "Hyperliquid · exact perpetual");
  if (lifecycle) {
    const lifecycleNode = append(identity, "div", "discover-opportunity-meta", "");
    lifecycleNode.textContent = "";
    const badge = append(lifecycleNode, "b", "", lifecycle.label);
    badge.dataset.tone = lifecycle.tone;
    append(lifecycleNode, "small", "", `${lifecycle.quality} · Q${lifecycle.score}`);
  }

  const thesis = append(anchor, "div", "discover-thesis", "");
  thesis.textContent = "";
  append(thesis, "span", "", "What changed");
  append(thesis, "strong", "", actualOpportunityDelta(row));
  append(thesis, "small", "", atlas
    ? "Broader-market context only; no Raven behavior is implied."
    : lifecycle && lifecycle.state !== "forming"
      ? lifecycle.summary
      : opportunityTraderRead(row));

  const evidence = append(anchor, "div", "discover-evidence", "");
  evidence.textContent = "";
  append(evidence, "span", "", spot && row.broader_attention?.raven_observed_first === true ? "Raven timing" : "What supports it");
  const support = comparableSupport(row);
  append(evidence, "strong", "", atlas
    ? text(row.context_note, row.market_state)
    : spot
      ? spotEvidenceHeadline(row)
      : support.headline);
  append(evidence, "small", "", atlas
    ? text(row.market_state, "")
    : spot
      ? row.broader_attention?.raven_observed_first === true
        ? "The same exact token appeared in broader attention later."
        : ""
      : support.detail);

  const market = append(anchor, "div", "discover-market", "");
  market.textContent = "";
  append(market, "span", "", "Market state");
  append(market, "strong", "", atlas ? text(row.market_state) : spot ? text(row.movement_state, "Activity moving") : pressureLabel(row.pressure_state));
  const openInterest = finite(row.market_snapshot?.open_interest_usd ?? row.market_context?.open_interest);
  const funding = finite(row.market_snapshot?.funding_rate ?? row.market_context?.funding_rate);
  const marketDetail = atlas
    ? text(row.market_detail, "Current exact listing")
    : spot
      ? spotAnatomy(row)
      : [
        openInterest === null ? "" : `OI ${compact(openInterest, { currency: true })}`,
        funding === null ? "" : `funding ${percent(funding * 100)}`,
        lifecycle?.invalidation || "",
      ].filter(Boolean).join(" · ");
  if (marketDetail) append(market, "small", "", marketDetail);

  append(anchor, "span", "discover-open", spot ? "Open chart" : "Inspect");
  return anchor;
}

function updateOpportunityNode(node, row) {
  const replacement = createOpportunityRow(row);
  const target = node.closest(".discover-row-shell") || node;
  target.replaceWith(wrapSavedMonitorControl(replacement, "discover-row-shell"));
  return replacement;
}

function renderOpportunityState({ heading, detail, code = "" }) {
  const host = document.getElementById("discoverStream");
  host.replaceChildren();
  document.getElementById("discoverStreamControl").hidden = true;
  const stateNode = append(host, "div", "workspace-state", "");
  stateNode.textContent = "";
  const inner = append(stateNode, "div", "", "");
  inner.textContent = "";
  append(inner, "span", "workspace-state-mark", "R");
  append(inner, "h2", "", heading);
  append(inner, "p", "", detail);
  if (code) append(inner, "code", "", code);
}

function renderSourceNotice(source, detail) {
  const host = document.getElementById("discoverStream");
  host.querySelector(`[data-discover-source-notice="${source}"]`)?.remove();
  if (!detail) return;
  const notice = document.createElement("div");
  notice.className = "discover-source-notice";
  notice.dataset.discoverSourceNotice = source;
  append(notice, "strong", "", source === "raven" ? "Raven opportunities unavailable" : "Atlas context unavailable");
  append(notice, "span", "", detail);
  host.prepend(notice);
}

function applyFilter() {
  const active = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "spot";
  document.getElementById("discoverDesk").hidden = !state.deskFrame || active !== "signals";
  document.getElementById("discoverSpotPulse").hidden = active !== "spot";
  document.getElementById("discoverListedUniverse").hidden = !state.featuredRows.length || active !== "equity";
  document.getElementById("discoverPayoff").hidden = !state.payoff || active !== "signals";
  const opportunityLayout = document.getElementById("discoverOpportunityLayout");
  const perpPulse = document.getElementById("discoverPerpPulse");
  const spotOwnsView = active === "spot";
  const equityOwnsView = active === "equity" && state.featuredRows.length > 0;
  opportunityLayout.hidden = spotOwnsView || equityOwnsView;
  perpPulse.hidden = !["signals", "perpetual"].includes(active);
  opportunityLayout.dataset.side = perpPulse.hidden ? "hidden" : "visible";
  const streamCopy = {
    signals: ["Raven", "Raven signals", "Evidence-ranked setups with secondary observations separated from the primary queue."],
    perpetual: ["Perpetuals", "Perp opportunities", "Raven setups beside the current Hyperliquid market tape."],
    equity: ["Atlas", "Listed-market context", "Exact stocks and ETFs with deeper research available in Atlas."],
  }[active] || ["Raven", "Current opportunities", "What changed, why it matters, and the market behind the read."];
  document.getElementById("discoverStreamEyebrow").textContent = streamCopy[0];
  document.getElementById("discoverStreamTitle").textContent = streamCopy[1];
  document.getElementById("discoverStreamSummary").textContent = streamCopy[2];
  document.querySelectorAll(".discover-source-notice").forEach((notice) => {
    const source = notice.dataset.discoverSourceNotice;
    notice.hidden = active === "spot" || (source === "atlas" ? active !== "equity" : !["signals", "perpetual"].includes(active));
  });
  document.querySelector(".discover-filter-empty")?.remove();
  const rows = [...document.querySelectorAll(".discover-row")];
  const matching = rows.filter((row) => active === "signals"
    ? row.dataset.sourceType === "raven"
    : row.dataset.marketType === active);
  const collapsedEligible = matching.filter((row) => {
    if (!row.dataset.lifecycle) return true;
    if (["watch", "invalidated"].includes(row.dataset.lifecycle)) return false;
    return Number(row.dataset.signalScore || 0) >= 50;
  });
  const eligible = state.expanded ? matching : collapsedEligible;
  const eligibleSet = new Set(eligible);
  const collapsedLimit = window.matchMedia("(max-width: 560px)").matches ? 8 : 12;
  const limit = state.expanded ? Number.POSITIVE_INFINITY : collapsedLimit;
  let shown = 0;
  rows.forEach((row) => {
    const matches = eligibleSet.has(row);
    const hidden = !matches || shown >= limit;
    row.hidden = hidden;
    const shell = row.closest(".discover-row-shell");
    if (shell) shell.hidden = hidden;
    if (matches) shown += 1;
  });
  const control = document.getElementById("discoverStreamControl");
  if (!control) return;
  const hasFeaturedEquities = equityOwnsView;
  const hasTokenTape = active === "spot";
  if (!eligible.length && rows.length && !hasFeaturedEquities && !hasTokenTape) {
    const empty = document.createElement("div");
    empty.className = "workspace-state discover-filter-empty";
    const inner = append(empty, "div", "", "");
    append(inner, "span", "workspace-state-mark", "R");
    const onlyHeldBack = matching.length > 0 && matching.every((row) => (
      ["watch", "invalidated"].includes(row.dataset.lifecycle)
      || (row.dataset.lifecycle && Number(row.dataset.signalScore || 0) < 50)
    ));
    append(inner, "h2", "", onlyHeldBack
      ? "No active setups clear Raven's lifecycle gate"
      : active === "spot" ? "No spot movement meets the current filter" : "No current markets meet this filter");
    append(inner, "p", "", onlyHeldBack
      ? "Watch-only, low-confidence, and invalidated reads stay below the live queue; they remain available for review."
      : active === "spot"
        ? "Search any token or contract to inspect its exact supported markets."
        : "Try another market class or search for an exact instrument.");
    if (onlyHeldBack && active === "signals" && (state.spotRows.length || state.markets.size)) {
      const nextSurface = state.spotRows.length ? "spot" : "perpetual";
      const next = append(inner, "button", "workspace-primary-action", state.spotRows.length ? "Open token scanner" : "Open perp markets");
      next.type = "button";
      next.addEventListener("click", () => document.querySelector(`[data-discover-filter="${nextSurface}"]`)?.click());
    }
    document.getElementById("discoverStream").append(empty);
  }
  const hiddenCount = Math.max(0, matching.length - Math.min(collapsedEligible.length, collapsedLimit));
  control.hidden = hasTokenTape || hasFeaturedEquities || hiddenCount <= 0;
  control.textContent = state.expanded
    ? "Hide secondary observations"
    : `Review ${hiddenCount.toLocaleString()} secondary ${hiddenCount === 1 ? "read" : "reads"}`;
  const visibleCount = rows.filter((row) => !row.hidden).length;
  const surfaceCount = active === "spot"
    ? state.spotRows.length
    : active === "perpetual" ? state.markets.size
      : active === "equity" ? Math.max(state.featuredRows.length, visibleCount)
        : matching.length;
  document.getElementById("discoverRowCount").textContent = surfaceCount.toLocaleString();
}

function renderOpportunities(rows, { generatedAt, appendOnly = false } = {}) {
  const host = document.getElementById("discoverStream");
  if (!appendOnly || !host.querySelector(".discover-row")) host.replaceChildren();
  const lifecycleRank = { confirmed: 5, forming: 4, atlas: 3, fading: 2, watch: 1, invalidated: 0 };
  const orderedRows = [...rows].sort((left, right) => {
    const leftAtlas = left.source_type === "atlas_context";
    const rightAtlas = right.source_type === "atlas_context";
    const leftRead = leftAtlas ? { state: "atlas", score: 45 } : opportunityLifecycle(left, left.market_snapshot || {});
    const rightRead = rightAtlas ? { state: "atlas", score: 45 } : opportunityLifecycle(right, right.market_snapshot || {});
    const stateDifference = (lifecycleRank[rightRead.state] || 0) - (lifecycleRank[leftRead.state] || 0);
    if (stateDifference) return stateDifference;
    const scoreDifference = rightRead.score - leftRead.score;
    if (scoreDifference) return scoreDifference;
    return (finite(left.context_age_seconds) || 0) - (finite(right.context_age_seconds) || 0);
  });
  const incomingIds = new Set();
  for (const row of orderedRows) {
    const id = text(row.public_opportunity_id, row.instrument_id);
    incomingIds.add(id);
    state.rows.set(id, row);
    const existing = host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`);
    if (existing) updateOpportunityNode(existing, row);
    else {
      state.order.push(id);
      host.append(wrapSavedMonitorControl(createOpportunityRow(row), "discover-row-shell"));
    }
  }
  for (const id of [...state.rows.keys()]) {
    if (incomingIds.has(id)) continue;
    state.rows.delete(id);
    state.order = state.order.filter((value) => value !== id);
    const stale = host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`);
    (stale?.closest(".discover-row-shell") || stale)?.remove();
  }
  if (!state.scrolling) {
    for (const row of orderedRows) {
      const id = text(row.public_opportunity_id, row.instrument_id);
      const node = host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`);
      if (node) host.append(node.closest(".discover-row-shell") || node);
    }
  }
  state.order = orderedRows.map((row) => text(row.public_opportunity_id, row.instrument_id));
  document.getElementById("discoverRowCount").textContent = (rows.length + state.spotRows.length).toLocaleString();
  document.getElementById("discoverUpdatedAt").textContent = when(generatedAt);
  document.getElementById("discoverStreamControl").hidden = false;
  applyFilter();
}

function createPulseRow(row) {
  const anchor = document.createElement("a");
  anchor.className = "pulse-row";
  anchor.href = terminalHref({ instrument: row.asset, instrument_id: row.instrument_id });
  const identity = append(anchor, "div", "", "");
  identity.textContent = "";
  append(identity, "strong", "", text(row.asset));
  append(identity, "span", "", `${text(row.instrument_id)} · OI ${compact(row.open_interest_usd, { currency: true })}`);
  const change = append(anchor, "span", "pulse-change", percent(row.day_change_pct));
  const amount = finite(row.day_change_pct);
  if (amount !== null) change.classList.add(amount >= 0 ? "positive" : "negative");
  return anchor;
}

function renderMarkets(rows) {
  const host = document.getElementById("discoverPulse");
  host.replaceChildren();
  const ranked = [...rows].sort((left, right) => (finite(right.day_notional_volume_usd) || 0) - (finite(left.day_notional_volume_usd) || 0)).slice(0, 10);
  if (!ranked.length) {
    const container = append(host, "div", "workspace-state", "");
    container.textContent = "Current venue markets unavailable.";
    return;
  }
  ranked.forEach((row) => host.append(createPulseRow(row)));
  setState("discoverMarketState", "fresh", "Current");
}

function currentBriefPayload(payload) {
  const delivery = payload?.delivery || {};
  const data = payload?.data;
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== "ravenos_brief_public_origin_v1"
    || data?.schema_version !== "ravenos_brief_synthesized_public_v1"
    || delivery.source !== "current_public_origin"
    || delivery.fallback !== false
    || delivery.freshness_state !== "fresh"
  ) return null;
  return { ...data, generated_at: data.generated_at || payload.generated_at };
}

function currentOpportunityPayload(payload) {
  const delivery = payload?.delivery || {};
  const census = payload?.census;
  const rows = census?.opportunities?.rows;
  if (delivery.source !== "current_public_origin" || delivery.fallback !== false) throw new Error("current_origin_contract_rejected");
  if (delivery.freshness_state !== "fresh") throw new Error(`current_origin_${delivery.freshness_state || "unavailable"}`);
  if (!census || !["current", "delayed"].includes(census.source_state) || !Array.isArray(rows)) throw new Error("current_census_schema_rejected");
  const spot = census.spot_attention;
  const spotBoundary = spot?.execution_boundary || {};
  const spotRows = (
    spot?.schema_version === "ravenos.token_attention.v1"
    && ["current", "delayed"].includes(spot?.state)
    && Array.isArray(spot?.rows)
    && spotBoundary.research_only === true
    && spotBoundary.actionable === false
    && spotBoundary.signing_available === false
    && spotBoundary.submission_available === false
    && Number(spotBoundary.capital_assigned || 0) === 0
  )
    ? spot.rows.filter((row) => (
      row?.market_type === "spot"
      && row?.chain === "Solana"
      && ["exact_token", "exact_pool"].includes(row?.identity_scope)
      && row?.token_address
      && row?.research_only === true
      && row?.actionable === false
      && row?.execution_available === false
      && survivesCurrentSpotMarket(row)
    )).map((row) => ({
      ...row,
      context_state: spot.state,
      source_type: "raven_spot_attention",
    }))
    : [];
  return {
    census,
    freshness: census.source_state,
    rows: rows.filter((row) => String(row?.market_type || "").toLowerCase() !== "spot" || survivesCurrentSpotMarket(row)),
    spotRows,
    participationPayoff: currentParticipationPayoff(payload?.participation_payoff),
    generatedAt: [census.generated_at, spot?.generated_at]
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || delivery.generated_at,
  };
}

function currentOnchainPulsePayload(payload) {
  const execution = payload?.execution_boundary || {};
  const provenance = payload?.provenance || {};
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== "ravenos.onchain_market_pulse.v1"
    || !["current", "degraded"].includes(payload?.state)
    || payload?.freshness?.state !== "current"
    || !Array.isArray(payload?.rows)
    || execution.research_only !== true
    || execution.signing_available !== false
    || execution.submission_available !== false
    || !["exact_pool_market_activity", "token_velocity_plus_exact_pool_market_activity"].includes(provenance.role)
    || provenance.raven_signal !== false
  ) throw new Error("onchain_market_pulse_contract_rejected");
  const rows = payload.rows.filter((row) => {
    const chain = text(row?.chain_id || row?.chain, "").toLowerCase();
    const sourceValid = row?.source_type === "market_activity" || (
      row?.source_type === "jupiter_velocity"
      && row?.discovery_source === "jupiter_toptrending"
      && row?.jupiter?.category === "toptrending"
      && row?.jupiter?.metric_scope === "exact_token"
      && row?.jupiter?.route_scope === "best_current_exact_pool"
    );
    return sourceValid
      && row?.market_type === "spot"
      && ["solana", "base", "ethereum", "robinhood"].includes(chain)
      && row?.identity_scope === "exact_pool"
      && row?.instrument_id === `${chain}:pool:${text(row?.pool_address, "")}`
      && row?.token_address
      && row?.quote_token_address
      && row?.research_only === true
      && row?.actionable === false
      && row?.execution_available === false
      && survivesCurrentSpotMarket(row);
  });
  return {
    rows,
    generatedAt: payload.generated_at,
    state: payload.state,
  };
}

function currentAtlasPayload(payload) {
  const rows = payload?.market_context?.rows;
  const execution = payload?.execution_boundary || {};
  if (payload?.delivery?.source !== "current_public_origin" || payload?.delivery?.fallback !== false) throw new Error("atlas_current_origin_rejected");
  if (!payload?.schema_version || payload.schema_version !== "ravenos.atlas_projection.v1") throw new Error("atlas_schema_rejected");
  if (!["fresh", "delayed"].includes(payload?.freshness?.state) || !["available", "degraded"].includes(payload?.state)) throw new Error("atlas_freshness_rejected");
  if (!Array.isArray(rows)) throw new Error("atlas_rows_rejected");
  if (execution.signing_available !== false || execution.submission_available !== false) throw new Error("atlas_execution_boundary_rejected");
  const optionsById = new Map((payload.options_context || []).map((row) => [row.underlying_instrument_id, row]));
  const exactRows = rows.flatMap((row) => {
    const instrument = row?.instrument || {};
    if (!row?.instrument_id || instrument.instrument_id !== row.instrument_id || instrument.identity_scope !== "exact_instrument" || !["equity", "etf"].includes(instrument.instrument_type) || instrument.capabilities?.execution !== false) return [];
    const option = optionsById.get(row.instrument_id);
    const changes = [
      ["5d", row.change_5d],
      ["21d", row.change_21d],
      ["63d", row.change_63d],
    ].filter(([, value]) => finite(value) !== null).map(([label, value]) => `${label} ${percent(Number(value) * 100)}`);
    return [{
      public_opportunity_id: `atlas:${row.instrument_id}`,
      source_type: "atlas_context",
      instrument_id: row.instrument_id,
      instrument: row.symbol || instrument.symbol,
      instrument_contract: instrument,
      market_type: instrument.instrument_type,
      context_state: payload.freshness.state,
      what_changed: changes.length
        ? changes.join(" · ")
        : finite(row.price) !== null
          ? `Current price $${Number(row.price).toLocaleString("en-US", { maximumFractionDigits: 4 })}`
          : `${title(payload.market_context?.equity_regime)} equity regime`,
      context_note: option ? `${title(option.regime)} options · ${option.delayed ? "delayed" : "current"}` : "",
      market_state: `${title(payload.market_context?.equity_regime)} equity regime`,
      market_detail: [
        text(instrument.market_identity?.listing, title(instrument.venue)),
        finite(row.price) !== null ? `$${Number(row.price).toLocaleString("en-US", { maximumFractionDigits: 4 })}` : "",
      ].filter(Boolean).join(" · "),
      observed_at: row.observed_at || payload.generated_at,
    }];
  });
  return {
    rows: exactRows,
    generatedAt: payload.generated_at,
    generated_at: payload.generated_at,
    state: payload.state,
    freshness: payload.freshness.state,
    market_context: payload.market_context,
  };
}

function currentFeaturedAtlasPayload(payload) {
  const execution = payload?.execution_boundary || {};
  if (
    payload?.schema_version !== "atlas_featured_state_v1"
    || payload?.safe_public !== true
    || !Array.isArray(payload?.sections)
    || execution.signing_available !== false
    || execution.submission_available !== false
  ) throw new Error("atlas_featured_contract_rejected");
  const byKind = { etf: [], equity: [] };
  for (const section of payload.sections) {
    for (const row of section?.entities || []) {
      const kind = text(row?.entity_kind, "").toLowerCase();
      const expectedPrefix = kind === "etf" ? "etf:us:" : kind === "equity" ? "equity:us:" : "";
      if (
        !expectedPrefix
        || !String(row?.entity_id || "").startsWith(expectedPrefix)
        || !row?.symbol
        || row.selectable === false
        || row.public_display_eligibility !== "allowed"
      ) continue;
      byKind[kind].push(row);
    }
  }
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    if (byKind.etf[index]) rows.push(byKind.etf[index]);
    if (byKind.equity[index]) rows.push(byKind.equity[index]);
  }
  return rows;
}

async function refresh({ manual = false } = {}) {
  if (state.loading || (state.paused && !manual)) return;
  state.loading = true;
  document.getElementById("discoverRefresh").textContent = "Refreshing…";
  const shouldRefreshFeatured = manual || !state.featuredRows.length || Date.now() - state.featuredRefreshedAt >= 300_000;
  const [opportunities, markets, atlas, featured, onchainPulse, brief] = await Promise.allSettled([
    json("/api/opportunity"),
    json("/api/hyperliquid/perps"),
    json("/api/atlas"),
    shouldRefreshFeatured ? json("/api/atlas/featured?limit=40") : Promise.resolve(null),
    json(`/api/onchain/trending?chains=solana,base,ethereum,robinhood&duration=${encodeURIComponent(state.spotTimeframe)}`),
    json("/api/brief"),
  ]);

  if (shouldRefreshFeatured) {
    if (featured.status === "fulfilled" && featured.value?.response?.ok) {
      try {
        renderListedUniverse(currentFeaturedAtlasPayload(featured.value.payload));
        state.featuredRefreshedAt = Date.now();
      } catch {
        renderListedUniverse([]);
      }
    } else {
      renderListedUniverse([]);
    }
  }

  let marketRows = [];
  if (markets.status === "fulfilled" && markets.value.response.ok && Array.isArray(markets.value.payload?.results)) {
    state.markets.clear();
    marketRows = markets.value.payload.results;
    marketRows.forEach((row) => state.markets.set(row.instrument_id, row));
    renderMarkets(marketRows);
  } else {
    state.markets.clear();
    setState("discoverMarketState", "unavailable", "Unavailable");
    document.getElementById("discoverPulse").replaceChildren();
  }

  let ravenRows = [];
  let spotAttentionRows = [];
  let marketPulseRows = [];
  let ravenGeneratedAt = null;
  let marketPulseGeneratedAt = null;
  let ravenFailure = "";
  if (opportunities.status === "fulfilled" && opportunities.value.response.ok) {
    try {
      const current = currentOpportunityPayload(opportunities.value.payload);
      ravenRows = current.rows.map((row) => ({
        ...row,
        source_type: "raven_opportunity",
        market_snapshot: state.markets.get(row.instrument_id) || null,
      }));
      spotAttentionRows = current.spotRows;
      renderParticipationPayoff(current.participationPayoff);
      ravenGeneratedAt = current.generatedAt;
      setState("discoverCensusState", current.freshness, title(current.freshness));
    } catch {
      renderParticipationPayoff(null);
      setState("discoverCensusState", "unavailable", "Unavailable");
      ravenFailure = "Current Raven opportunities are temporarily unavailable. Historical reads are not shown as current.";
    }
  } else {
    renderParticipationPayoff(null);
    setState("discoverCensusState", "unavailable", "Unavailable");
    const status = opportunities.status === "fulfilled" ? opportunities.value.response.status : "network";
    ravenFailure = `Current Raven opportunities could not be reached${status === "network" ? "" : ` (${status})`}. Historical reads are not shown as current.`;
  }

  if (onchainPulse.status === "fulfilled" && onchainPulse.value.response.ok) {
    try {
      const current = currentOnchainPulsePayload(onchainPulse.value.payload);
      marketPulseRows = current.rows;
      marketPulseGeneratedAt = current.generatedAt;
    } catch {
      marketPulseRows = [];
    }
  }
  const tokenRows = [...spotAttentionRows, ...marketPulseRows];
  renderSpotPulse(tokenRows);

  let briefData = null;
  if (brief.status === "fulfilled" && brief.value.response.ok) {
    briefData = currentBriefPayload(brief.value.payload);
  }
  state.brief = briefData;

  let atlasRows = [];
  let atlasGeneratedAt = null;
  let atlasFailure = "";
  if (atlas.status === "fulfilled" && atlas.value.response.ok) {
    try {
      const current = currentAtlasPayload(atlas.value.payload);
      atlasRows = current.rows;
      atlasGeneratedAt = current.generatedAt;
      state.atlasRows = atlasRows;
      state.atlasContext = current;
      setState("discoverAtlasState", current.freshness, current.state === "degraded" ? `Degraded · ${title(current.freshness)}` : title(current.freshness));
    } catch {
      state.atlasRows = [];
      state.atlasContext = null;
      setState("discoverAtlasState", "unavailable", "Unavailable");
      atlasFailure = "Current Atlas context did not meet freshness or identity requirements. Older context was not substituted.";
    }
  } else {
    state.atlasRows = [];
    state.atlasContext = null;
    setState("discoverAtlasState", "unavailable", "Unavailable");
    const status = atlas.status === "fulfilled" ? atlas.value.response.status : "network";
    atlasFailure = `Current Atlas context could not be reached${status === "network" ? "" : ` (${status})`}. Older context was not substituted.`;
  }

  renderDeskBrief({
    brief: briefData,
    markets: marketRows,
    spotRows: tokenRows,
    opportunityRows: ravenRows,
    atlas: state.atlasContext,
  });

  const combinedRows = [...ravenRows, ...atlasRows];
  if (combinedRows.length) {
    const generatedAt = [ravenGeneratedAt, atlasGeneratedAt, marketPulseGeneratedAt]
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    renderOpportunities(combinedRows, { generatedAt, appendOnly: state.rows.size > 0 });
    renderSourceNotice("raven", ravenFailure);
    renderSourceNotice("atlas", atlasFailure);
    const firstRaven = ravenRows[0];
    const firstSpot = spotAttentionRows[0];
    const firstAtlas = atlasRows[0];
    window.RavenOSShell?.setCapabilities?.({
      market: "Current markets + Raven",
      mode: "Read only",
      evidence: [
        `${ravenRows.length + spotAttentionRows.length} Raven`,
        marketPulseRows.length ? `${marketPulseRows.length} live pools` : null,
        `${atlasRows.length} Atlas`,
      ].filter(Boolean).join(" · "),
      wallet: "No customer session",
      signing: "Sign off",
      broadcast: "Broadcast off",
    });
    window.RavenOSShell?.setIntelligence?.({
      subject: ravenOSContext.getState().subject,
      marketState: { label: `${combinedRows.length} current cross-market rows`, regime: "cross-market discovery" },
      setupState: { state: firstRaven ? "current_signal" : "broader_market_context", confirmation: "research only" },
      thesis: customerFacingText(firstRaven?.why_raven_noticed || firstSpot?.what_changed || firstAtlas?.what_changed, "Current market context is available."),
      supportingEvidence: [
        firstRaven ? `${firstRaven.instrument} retains exact ${firstRaven.identity_scope || "instrument"} identity.` : null,
        firstSpot ? `${firstSpot.symbol} retains exact ${firstSpot.identity_scope === "exact_pool" ? "pool" : "token"} identity.` : null,
        firstAtlas ? `${firstAtlas.instrument} retains exact listed identity; Atlas provenance remains separate.` : null,
      ].filter(Boolean),
      contradictingEvidence: [ravenFailure, atlasFailure].filter(Boolean),
      invalidation: [],
      timeHorizon: "current cycle",
      confidence: { label: "source bound" },
      evidenceQuality: { state: ravenRows.length ? "current" : "atlas_context", lineageComplete: true },
      freshness: { state: "live", observedAt: generatedAt },
      nextExpectedTransition: "Open an exact market to inspect its available Raven and Atlas context.",
    });
  } else if (tokenRows.length) {
    state.rows.clear();
    state.order = [];
    document.getElementById("discoverRowCount").textContent = tokenRows.length.toLocaleString();
    renderOpportunityState({
      heading: "No additional setups are current",
      detail: "Current token movement remains available above. Historical Raven reads are not shown as current.",
    });
  } else {
    state.rows.clear();
    state.order = [];
    document.getElementById("discoverRowCount").textContent = "0";
    renderOpportunityState({
      heading: "No current opportunities can be shown",
      detail: "Raven and Atlas did not return a current market read. Live venue activity may still be available.",
    });
  }

  applyFilter();
  state.lastRefresh = new Date().toISOString();
  state.loading = false;
  document.getElementById("discoverRefresh").textContent = "Refresh now";
}

function bind() {
  document.getElementById("discoverSearchTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.querySelectorAll("[data-discover-filter]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    document.querySelectorAll("[data-discover-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    state.expanded = false;
    applyFilter();
  }));
  document.querySelectorAll("[data-spot-timeframe]").forEach((button) => button.addEventListener("click", () => {
    state.spotTimeframe = button.dataset.spotTimeframe;
    renderSpotPulse(state.spotRows, { forceOrder: true });
    void refresh({ manual: true });
  }));
  document.querySelectorAll("[data-spot-sort]").forEach((button) => button.addEventListener("click", () => {
    state.spotSort = button.dataset.spotSort;
    renderSpotPulse(state.spotRows, { forceOrder: true });
  }));
  document.querySelectorAll("[data-spot-chain]").forEach((button) => button.addEventListener("click", () => {
    state.spotChain = button.dataset.spotChain;
    renderSpotPulse(state.spotRows, { forceOrder: true });
  }));
  document.getElementById("discoverTokenUpdates").addEventListener("click", () => renderSpotPulse(state.spotRows, { forceOrder: true }));
  document.getElementById("discoverStreamControl").addEventListener("click", () => {
    state.expanded = !state.expanded;
    applyFilter();
  });
  document.getElementById("discoverRefresh").addEventListener("click", () => refresh({ manual: true }));
  document.getElementById("discoverPause").addEventListener("click", (event) => {
    state.paused = !state.paused;
    event.currentTarget.textContent = state.paused ? "Resume updates" : "Pause updates";
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.paused && state.lastRefresh && Date.now() - Date.parse(state.lastRefresh) > REFRESH_MS) refresh();
  });
  window.addEventListener("scroll", () => {
    state.scrolling = true;
    window.clearTimeout(state.scrollTimer);
    state.scrollTimer = window.setTimeout(() => {
      state.scrolling = false;
    }, 650);
  }, { passive: true });
}

bind();
refresh();
state.timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
window.__RAVENOS_DISCOVER__ = Object.freeze({
  getState: () => ({
    rowCount: state.rows.size,
    marketCount: state.markets.size,
    spotCount: state.spotRows.length,
    solanaSpotCount: state.spotRows.filter((row) => text(row.chain_id || row.chain, "").toLowerCase() === "solana").length,
    evmSpotCount: state.spotRows.filter((row) => ["base", "ethereum", "robinhood"].includes(text(row.chain_id || row.chain, "").toLowerCase())).length,
    robinhoodSpotCount: state.spotRows.filter((row) => text(row.chain_id || row.chain, "").toLowerCase() === "robinhood").length,
    payoffCount: state.payoff?.insights?.length || 0,
    deskCardCount: state.deskFrame?.cards?.length || 0,
    lifecycleCounts: state.deskFrame?.lifecycle_counts || {},
    spotTimeframe: state.spotTimeframe,
    spotSort: state.spotSort,
    spotChain: state.spotChain,
    paused: state.paused,
    expanded: state.expanded,
    loading: state.loading,
    lastRefresh: state.lastRefresh,
  }),
  refresh: () => refresh({ manual: true }),
});
