import { ravenOSContext } from "/ravenos-context-store.js";
import { customerFacingText } from "/ravenos-intelligence-contract.js";

const REFRESH_MS = 45_000;
const state = {
  rows: new Map(),
  order: [],
  markets: new Map(),
  atlasRows: [],
  spotRows: [],
  spotTimeframe: "5m",
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
  if (row.source_type === "raven_spot_attention") {
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

function spotPoolHref(row, timeframe = "1m") {
  const chain = text(row.chainId || row.chain, "solana").toLowerCase();
  const pairAddress = text(row.pairAddress || row.pool_address, "");
  const symbol = text(row.symbol, "");
  const quote = text(row.quoteSymbol, "");
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
  const chain = text(row.chain, "solana").toLowerCase();
  const tokenAddress = text(row.token_address, "");
  return results
    .filter((candidate) => {
      const candidateChain = text(candidate.chainId, "").toLowerCase();
      const coverage = candidate.chart_coverage || {};
      return candidateChain === chain
        && sameTokenAddress(chain, tokenAddress, candidate.tokenAddress)
        && text(candidate.pairAddress, "") !== ""
        && finite(candidate.liquidityUsd) > 0
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
  if (label) label.textContent = pending ? "Opening chart…" : "Open chart";
  const leaderLabel = anchor.querySelector(".discover-spot-leader-open");
  if (leaderLabel) leaderLabel.textContent = pending ? "…" : "→";
}

function configureSpotLink(anchor, row) {
  anchor.href = terminalHref(row);
  if (anchor.getAttribute("href") !== "#") return;
  anchor.addEventListener("click", async (event) => {
    event.preventDefault();
    if (anchor.dataset.chartResolving === "true") return;
    setSpotLinkPending(anchor, true);
    const exactPool = await resolveSpotChart(row).catch(() => null);
    if (exactPool) {
      ravenOSContext.navigate(spotPoolHref(exactPool, "1m"));
      return;
    }
    setSpotLinkPending(anchor, false);
    window.RavenOSShell?.openCommandPalette?.(row.token_address);
  });
}

function append(node, tag, className, value) {
  const child = document.createElement(tag);
  if (className) child.className = className;
  child.textContent = value;
  node.append(child);
  return child;
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
  return {
    headline: "No reliable comparison yet",
    detail: "Watching current price and pressure for confirmation.",
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

function spotLeaderRows(kind) {
  const current = state.spotRows.filter((row) => {
    const age = finite(row.age_seconds);
    const liquidity = finite(row.market?.liquidity_usd);
    return row.chain === "Solana"
      && (age === null || age <= 3_600)
      && liquidity !== null
      && liquidity > 0;
  });
  if (kind === "velocity") {
    return current
      .filter((row) => spotMetric(row, "price_change") !== null)
      .sort((left, right) => {
        const movement = Math.abs(spotMetric(right, "price_change")) - Math.abs(spotMetric(left, "price_change"));
        if (movement) return movement;
        return (spotMetric(right, "volume_usd") || 0) - (spotMetric(left, "volume_usd") || 0);
      })
      .slice(0, 4);
  }
  return current
    .filter((row) => spotMetric(row, "traders") !== null)
    .sort((left, right) => {
      const traders = (spotMetric(right, "traders") || 0) - (spotMetric(left, "traders") || 0);
      if (traders) return traders;
      const rightTransactions = (spotMetric(right, "buys") || 0) + (spotMetric(right, "sells") || 0);
      const leftTransactions = (spotMetric(left, "buys") || 0) + (spotMetric(left, "sells") || 0);
      if (rightTransactions !== leftTransactions) return rightTransactions - leftTransactions;
      return (spotMetric(right, "volume_usd") || 0) - (spotMetric(left, "volume_usd") || 0);
    })
    .slice(0, 4);
}

function createSpotLeaderRow(row, kind, index) {
  const anchor = document.createElement("a");
  anchor.className = "discover-spot-leader";
  anchor.dataset.leaderType = kind;
  anchor.dataset.identityScope = row.identity_scope;
  configureSpotLink(anchor, row);
  anchor.setAttribute("aria-label", `${text(row.symbol)} ${kind === "velocity" ? "velocity" : "trending activity"} details`);

  append(anchor, "span", "discover-spot-rank", String(index + 1).padStart(2, "0"));
  const identity = append(anchor, "div", "discover-spot-leader-identity", "");
  identity.textContent = "";
  append(identity, "strong", "", text(row.symbol));
  const identityFacts = [
    text(row.venue, row.identity_scope === "exact_pool" ? "Exact pool" : "Exact token"),
    `${compact(row.market?.liquidity_usd, { currency: true })} liq`,
    spotTimingLabel(row),
  ].filter(Boolean);
  append(identity, "span", "", identityFacts.join(" · "));

  const metric = append(anchor, "div", "discover-spot-leader-metric", "");
  metric.textContent = "";
  if (kind === "velocity") {
    const movement = spotMetric(row, "price_change");
    const value = append(metric, "strong", "", percent(movement));
    if (movement !== null) value.classList.add(movement >= 0 ? "positive" : "negative");
    append(metric, "span", "", `${state.spotTimeframe} move`);
  } else {
    const traders = spotMetric(row, "traders");
    const buys = spotMetric(row, "buys");
    const sells = spotMetric(row, "sells");
    const transactions = buys === null && sells === null ? null : (buys || 0) + (sells || 0);
    append(metric, "strong", "", `${compact(traders)} traders`);
    append(metric, "span", "", [
      transactions === null ? null : `${compact(transactions)} tx`,
      spotMetric(row, "volume_usd") === null ? null : `${compact(spotMetric(row, "volume_usd"), { currency: true })} vol`,
    ].filter(Boolean).join(" · "));
  }
  append(anchor, "span", "discover-spot-leader-open", "→");
  return anchor;
}

function renderSpotLeaderList(id, kind) {
  const host = document.getElementById(id);
  host.replaceChildren();
  const rows = spotLeaderRows(kind);
  if (!rows.length) {
    append(host, "p", "discover-spot-leader-empty", `No current ${state.spotTimeframe} ${kind === "velocity" ? "movement" : "activity"} values.`);
    return;
  }
  rows.forEach((row, index) => host.append(createSpotLeaderRow(row, kind, index)));
}

function renderSpotPulse(rows = state.spotRows) {
  const host = document.getElementById("discoverSpotPulse");
  state.spotRows = Array.isArray(rows) ? rows : [];
  if (!state.spotRows.length) {
    host.hidden = true;
    document.getElementById("discoverVelocityLeaders").replaceChildren();
    document.getElementById("discoverTrendingLeaders").replaceChildren();
    return;
  }
  const activeFilter = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "all";
  host.hidden = !["all", "spot"].includes(activeFilter);
  document.querySelectorAll("[data-spot-timeframe]").forEach((button) => {
    const active = button.dataset.spotTimeframe === state.spotTimeframe;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.getElementById("discoverVelocityWindow").textContent = `${state.spotTimeframe} move`;
  document.getElementById("discoverTrendingWindow").textContent = `${state.spotTimeframe} activity`;
  renderSpotLeaderList("discoverVelocityLeaders", "velocity");
  renderSpotLeaderList("discoverTrendingLeaders", "trending");
}

function createOpportunityRow(row) {
  const atlas = row.source_type === "atlas_context";
  const spot = row.source_type === "raven_spot_attention";
  const anchor = document.createElement("a");
  anchor.className = "discover-row";
  anchor.dataset.opportunityId = text(row.public_opportunity_id || row.public_attention_id, row.instrument_id);
  anchor.dataset.marketType = atlas ? "equity" : spot ? "spot" : text(row.market_type, "unknown").toLowerCase();
  anchor.dataset.sourceType = atlas ? "atlas" : spot ? "raven-spot" : "raven";
  anchor.dataset.freshness = text(row.context_state, "unavailable").toLowerCase();
  if (spot) configureSpotLink(anchor, row);
  else anchor.href = terminalHref(row);

  const identity = append(anchor, "div", "discover-identity", "");
  identity.textContent = "";
  append(identity, "span", "", atlas ? `${title(row.market_type)} · Atlas` : spot ? "Spot · Solana" : title(row.market_type));
  append(identity, "strong", "", spot ? text(row.symbol) : text(row.instrument));
  append(identity, "small", "", atlas
    ? `${text(row.instrument_contract?.market_identity?.listing, title(row.instrument_contract?.venue))} · exact listing`
    : spot
      ? row.identity_scope === "exact_pool"
        ? `${text(row.venue, "Spot market")} · exact pool`
        : "Exact token · opens chart directly"
      : "Hyperliquid · exact perpetual");

  const thesis = append(anchor, "div", "discover-thesis", "");
  thesis.textContent = "";
  append(thesis, "span", "", "What changed");
  append(thesis, "strong", "", actualOpportunityDelta(row));
  append(thesis, "small", "", atlas
    ? "Broader-market context only; no Raven behavior is implied."
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
  append(market, "small", "", atlas
    ? text(row.market_detail, "Current exact listing")
    : spot
      ? spotAnatomy(row)
      : `OI ${compact(row.market_snapshot?.open_interest_usd ?? row.market_context?.open_interest, { currency: true })} · funding ${percent(finite(row.market_snapshot?.funding_rate ?? row.market_context?.funding_rate) === null ? null : Number(row.market_snapshot?.funding_rate ?? row.market_context?.funding_rate) * 100)}`);

  append(anchor, "span", "discover-open", spot ? "Open chart" : "Inspect");
  return anchor;
}

function updateOpportunityNode(node, row) {
  const replacement = createOpportunityRow(row);
  node.replaceWith(replacement);
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
  const active = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "all";
  document.getElementById("discoverSpotPulse").hidden = !state.spotRows.length || !["all", "spot"].includes(active);
  document.querySelector(".discover-filter-empty")?.remove();
  const rows = [...document.querySelectorAll(".discover-row")];
  const matching = rows.filter((row) => active === "all" || row.dataset.marketType === active);
  const limit = state.expanded ? Number.POSITIVE_INFINITY : window.matchMedia("(max-width: 560px)").matches ? 8 : 12;
  let shown = 0;
  rows.forEach((row) => {
    const matches = active === "all" || row.dataset.marketType === active;
    row.hidden = !matches || shown >= limit;
    if (matches) shown += 1;
  });
  const control = document.getElementById("discoverStreamControl");
  if (!control) return;
  if (!matching.length && rows.length) {
    const empty = document.createElement("div");
    empty.className = "workspace-state discover-filter-empty";
    const inner = append(empty, "div", "", "");
    append(inner, "span", "workspace-state-mark", "R");
    append(inner, "h2", "", active === "spot" ? "No spot movement meets the current filter" : "No current markets meet this filter");
    append(inner, "p", "", active === "spot"
      ? "Search any token or contract to inspect its exact supported markets."
      : "Try another market class or search for an exact instrument.");
    document.getElementById("discoverStream").append(empty);
  }
  control.hidden = matching.length <= (Number.isFinite(limit) ? limit : 12);
  control.textContent = state.expanded
    ? "Show the attention queue"
    : `Show ${Math.max(0, matching.length - limit).toLocaleString()} more exact markets`;
}

function renderOpportunities(rows, { generatedAt, appendOnly = false } = {}) {
  const host = document.getElementById("discoverStream");
  if (!appendOnly || !host.querySelector(".discover-row")) host.replaceChildren();
  const incomingIds = new Set();
  for (const row of rows) {
    const id = text(row.public_opportunity_id, row.instrument_id);
    incomingIds.add(id);
    state.rows.set(id, row);
    const existing = host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`);
    if (existing) updateOpportunityNode(existing, row);
    else {
      state.order.push(id);
      host.append(createOpportunityRow(row));
    }
  }
  for (const id of [...state.rows.keys()]) {
    if (incomingIds.has(id)) continue;
    state.rows.delete(id);
    state.order = state.order.filter((value) => value !== id);
    host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`)?.remove();
  }
  document.getElementById("discoverRowCount").textContent = rows.length.toLocaleString();
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
    container.textContent = "Live venue markets unavailable.";
    return;
  }
  ranked.forEach((row) => host.append(createPulseRow(row)));
  setState("discoverMarketState", "live", "Live provider");
}

function currentOpportunityPayload(payload) {
  const delivery = payload?.delivery || {};
  const census = payload?.census;
  const rows = census?.opportunities?.rows;
  if (delivery.source !== "current_public_origin" || delivery.fallback !== false) throw new Error("current_origin_contract_rejected");
  if (delivery.freshness_state !== "fresh") throw new Error(`current_origin_${delivery.freshness_state || "unavailable"}`);
  if (!census || census.source_state !== "current" || !Array.isArray(rows)) throw new Error("current_census_schema_rejected");
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
    )).map((row) => ({
      ...row,
      context_state: spot.state,
      source_type: "raven_spot_attention",
    }))
    : [];
  return {
    census,
    rows,
    spotRows,
    generatedAt: [census.generated_at, spot?.generated_at]
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || delivery.generated_at,
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
  return { rows: exactRows, generatedAt: payload.generated_at, state: payload.state, freshness: payload.freshness.state };
}

async function refresh({ manual = false } = {}) {
  if (state.loading || (state.paused && !manual)) return;
  state.loading = true;
  document.getElementById("discoverRefresh").textContent = "Refreshing…";
  const [opportunities, markets, atlas] = await Promise.allSettled([
    json("/api/opportunity"),
    json("/api/hyperliquid/perps"),
    json("/api/atlas"),
  ]);

  if (markets.status === "fulfilled" && markets.value.response.ok && Array.isArray(markets.value.payload?.results)) {
    state.markets.clear();
    markets.value.payload.results.forEach((row) => state.markets.set(row.instrument_id, row));
    renderMarkets(markets.value.payload.results);
  } else {
    state.markets.clear();
    setState("discoverMarketState", "unavailable", "Unavailable");
    document.getElementById("discoverPulse").replaceChildren();
  }

  let ravenRows = [];
  let ravenGeneratedAt = null;
  let ravenFailure = "";
  if (opportunities.status === "fulfilled" && opportunities.value.response.ok) {
    try {
      const current = currentOpportunityPayload(opportunities.value.payload);
      ravenRows = current.rows.map((row) => ({
        ...row,
        source_type: "raven_opportunity",
        market_snapshot: state.markets.get(row.instrument_id) || null,
      }));
      ravenRows = [...current.spotRows, ...ravenRows];
      renderSpotPulse(current.spotRows);
      ravenGeneratedAt = current.generatedAt;
      setState("discoverCensusState", "fresh", "Current");
    } catch {
      renderSpotPulse([]);
      setState("discoverCensusState", "unavailable", "Unavailable");
      ravenFailure = "Current Raven data did not meet freshness or identity requirements. Older observations were not substituted.";
    }
  } else {
    renderSpotPulse([]);
    setState("discoverCensusState", "unavailable", "Unavailable");
    const status = opportunities.status === "fulfilled" ? opportunities.value.response.status : "network";
    ravenFailure = `The current Raven read could not be reached${status === "network" ? "" : ` (${status})`}. Older observations were not substituted.`;
  }

  let atlasRows = [];
  let atlasGeneratedAt = null;
  let atlasFailure = "";
  if (atlas.status === "fulfilled" && atlas.value.response.ok) {
    try {
      const current = currentAtlasPayload(atlas.value.payload);
      atlasRows = current.rows;
      atlasGeneratedAt = current.generatedAt;
      state.atlasRows = atlasRows;
      setState("discoverAtlasState", current.freshness, current.state === "degraded" ? `Degraded · ${title(current.freshness)}` : title(current.freshness));
    } catch {
      state.atlasRows = [];
      setState("discoverAtlasState", "unavailable", "Unavailable");
      atlasFailure = "Current Atlas context did not meet freshness or identity requirements. Older context was not substituted.";
    }
  } else {
    state.atlasRows = [];
    setState("discoverAtlasState", "unavailable", "Unavailable");
    const status = atlas.status === "fulfilled" ? atlas.value.response.status : "network";
    atlasFailure = `Current Atlas context could not be reached${status === "network" ? "" : ` (${status})`}. Older context was not substituted.`;
  }

  const combinedRows = [...ravenRows, ...atlasRows];
  if (combinedRows.length) {
    const generatedAt = [ravenGeneratedAt, atlasGeneratedAt]
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    renderOpportunities(combinedRows, { generatedAt, appendOnly: state.rows.size > 0 });
    renderSourceNotice("raven", ravenFailure);
    renderSourceNotice("atlas", atlasFailure);
    const firstRaven = ravenRows[0];
    const firstAtlas = atlasRows[0];
    window.RavenOSShell?.setCapabilities?.({
      market: "Live markets + current projections",
      mode: "Read only",
      evidence: `${ravenRows.length} Raven · ${atlasRows.length} Atlas`,
      wallet: "No customer session",
      signing: "Sign off",
      broadcast: "Broadcast off",
    });
    window.RavenOSShell?.setIntelligence?.({
      subject: ravenOSContext.getState().subject,
      marketState: { label: `${combinedRows.length} current cross-market rows`, regime: "cross-market discovery" },
      setupState: { state: firstRaven ? "current_signal" : "broader_market_context", confirmation: "research only" },
      thesis: customerFacingText(firstRaven?.why_raven_noticed || firstAtlas?.what_changed, "Current market context is available."),
      supportingEvidence: [
        firstRaven ? `${firstRaven.instrument} retains exact ${firstRaven.identity_scope || "instrument"} identity.` : null,
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
  } else {
    state.rows.clear();
    state.order = [];
    document.getElementById("discoverRowCount").textContent = "0";
    renderOpportunityState({
      heading: "No current opportunities can be shown",
      detail: "Raven and Atlas did not return current exact markets. Older observations were not substituted; live venue prices may still be available.",
    });
  }

  state.lastRefresh = new Date().toISOString();
  state.loading = false;
  document.getElementById("discoverRefresh").textContent = "Refresh now";
}

function bind() {
  document.getElementById("discoverSearchTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.querySelectorAll("[data-discover-filter]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    document.querySelectorAll("[data-discover-filter]").forEach((item) => item.classList.toggle("active", item === button));
    state.expanded = false;
    applyFilter();
  }));
  document.querySelectorAll("[data-spot-timeframe]").forEach((button) => button.addEventListener("click", () => {
    state.spotTimeframe = button.dataset.spotTimeframe;
    renderSpotPulse();
  }));
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
}

bind();
refresh();
state.timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
window.__RAVENOS_DISCOVER__ = Object.freeze({
  getState: () => ({ rowCount: state.rows.size, marketCount: state.markets.size, spotCount: state.spotRows.length, spotTimeframe: state.spotTimeframe, paused: state.paused, expanded: state.expanded, loading: state.loading, lastRefresh: state.lastRefresh }),
  refresh: () => refresh({ manual: true }),
});
