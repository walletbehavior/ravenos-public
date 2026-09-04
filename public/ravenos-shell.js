import {
  RavenDataStateLabels,
  adaptLegacyNarrator,
  customerFacingText,
  createIntelligenceRecord,
  createTerminalIntelligence,
  renderIntelligence,
} from "/ravenos-intelligence-contract.js";
import { ravenOSContext } from "/ravenos-context-store.js";
import { resolveChartCapability } from "/ravenos-chart-data-plane.js";
import { resolveTradingViewChart } from "/ravenos-tradingview-adapter.js";

const NAV_ITEMS = Object.freeze([
  {
    key: "discover",
    label: "Discover",
    href: "/discover/",
    glyph: "D",
    match: ["discover", "home", "opportunity"],
  },
  { key: "terminal", label: "Terminal", href: "/terminal/", glyph: "T", match: ["terminal", "perps"] },
  { key: "agents", label: "Agents", href: "/agents/", glyph: "G", mobile: false, match: ["agents"] },
  { key: "community", label: "Community", href: "/community/", glyph: "C", mobile: false, match: ["community"] },
  {
    key: "intelligence",
    label: "Raven Lab",
    href: "/intelligence/",
    glyph: "I",
    mobile: false,
    match: ["intelligence", "behavior", "outcomes", "claims", "replay", "memory", "research", "chain-solana", "chain-base", "chain-ethereum"],
  },
  { key: "portfolio", label: "Portfolio", href: "/portfolio/", glyph: "P", match: ["portfolio"] },
  { key: "atlas", label: "Atlas", href: "/atlas/", glyph: "A", mobile: false, match: ["atlas"] },
]);

let customerAccountState = Object.freeze({
  available: false,
  authenticated: false,
  canonicalOrigin: "",
  username: "",
});

function spotChartRequestSupported(row = {}, timeframe = "1h") {
  const coverage = row.chart_coverage;
  if (coverage?.schema_version === "ravenos.search_chart_coverage.v1") {
    if (coverage.state === "unavailable") return false;
    if (timeframe === "1m") return coverage.one_minute_request_supported === true;
    if (timeframe === "1h") return coverage.one_hour_request_supported === true;
  }
  return resolveChartCapability({
    market: "crypto_spot",
    chain: row.chainId,
    instrumentType: "spot_pool",
    pairAddress: row.pairAddress,
    timeframe,
    providerId: coverage?.provider_id || "",
  }).chart_request_supported;
}

function currentSlug() {
  const configured = document.getElementById("ravenosRouteConfig");
  if (configured) {
    try { return JSON.parse(configured.textContent || "{}").slug || ""; } catch { /* use path */ }
  }
  return location.pathname.split("/").filter(Boolean)[0] || "discover";
}

function formatObservedAt(value) {
  if (!value) return "No timestamp";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No timestamp";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function safeMetric(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactCurrency(value) {
  const parsed = finiteNumber(value);
  return parsed === null
    ? "liquidity unavailable"
    : `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(parsed)} liquidity`;
}

function shortMarketId(value) {
  const clean = String(value || "").trim();
  if (!clean) return "unavailable";
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 7)}…${clean.slice(-5)}`;
}

function chainDisplayName(value) {
  const chain = String(value || "").trim().toLowerCase();
  if (chain === "robinhood") return "Robinhood Chain";
  if (chain === "bsc") return "BNB Chain";
  return chain ? chain.charAt(0).toUpperCase() + chain.slice(1) : "Unknown chain";
}

function venueDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw || ["all", "unknown"].includes(raw.toLowerCase())) return "";
  if (/^0x[a-f0-9]{8,}$/i.test(raw) || /^[1-9A-HJ-NP-Za-km-z]{28,}$/.test(raw)) return "";
  const aliases = {
    hyperliquid: "Hyperliquid",
    pumpswap: "PumpSwap",
    raydium: "Raydium",
    meteora: "Meteora",
    uniswap: "Uniswap",
    pancakeswap: "PancakeSwap",
  };
  return aliases[raw.toLowerCase()] || raw.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractedMarketAddresses(value = "") {
  const clean = String(value || "").slice(0, 512);
  const evm = clean.match(/0x[a-fA-F0-9]{40}/g) || [];
  const solanaScan = clean.replace(/0x[a-fA-F0-9]{40}/g, (match) => " ".repeat(match.length));
  const matches = [
    ...evm,
    ...(solanaScan.match(/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g) || []),
  ];
  return [...new Map(matches.map((address) => [address.toLowerCase().startsWith("0x") ? address.toLowerCase() : address, address])).values()].slice(0, 3);
}

const SOLANA_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function isExactSolanaPublicAddress(value = "") {
  const clean = String(value || "").trim();
  if (clean.length < 32 || clean.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(clean)) return false;
  let decoded = 0n;
  for (const character of clean) {
    const digit = SOLANA_BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return false;
    decoded = (decoded * 58n) + BigInt(digit);
  }
  let nonzeroBytes = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    nonzeroBytes += 1;
  }
  const leadingZeroBytes = clean.match(/^1*/)?.[0].length || 0;
  return leadingZeroBytes + nonzeroBytes === 32;
}

function publicWalletCommandResult(query = "") {
  const address = String(query || "").trim();
  if (!isExactSolanaPublicAddress(address)) return null;
  return {
    commandType: "wallet",
    label: "Analyze public wallet",
    detail: `${shortMarketId(address)} · Solana public address`,
    group: "Wallet intelligence",
    state: "Open in Pro",
    href: `https://app.ravenos.xyz/account/copy/?wallet=${encodeURIComponent(address)}`,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function terminalHref(subject = {}) {
  const params = new URLSearchParams();
  const values = {
    asset: subject.label,
    instrument_id: subject.id,
    instrument_type: subject.instrumentType,
    asset_class: subject.assetClass,
    identity_scope: subject.identityScope,
    chain: subject.chain,
    venue: subject.venue,
    market: subject.marketType,
    quote: subject.quoteAsset,
    settlement: subject.settlementAsset,
    cash: subject.preferredCashAsset,
    numeraire: subject.economicNumeraire,
    token_address: subject.tokenAddress,
    quote_address: subject.quoteTokenAddress,
    pair_address: subject.poolAddress,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value && !["all", "unknown", "unselected"].includes(String(value).toLowerCase())) params.set(key, value);
  }
  return `/terminal/${params.size ? `?${params.toString()}` : ""}`;
}

function validRecentSubject(subject = {}) {
  const id = String(subject.id || "").trim();
  const label = String(subject.label || subject.symbol || "").trim();
  const instrumentType = String(subject.instrumentType || subject.marketType || "").trim().toLowerCase();
  const identityScope = String(subject.identityScope || "").trim().toLowerCase();
  if (!id || id === "unselected" || !label || /^no\s+.+\s+selected$/i.test(label)) return false;
  if (["unknown", "unselected"].includes(instrumentType) || identityScope === "unselected") return false;
  if (instrumentType === "exact_pool") {
    return Boolean(subject.poolAddress || /:pool:/i.test(id))
      && !["", "all", "unknown"].includes(String(subject.chain || "").toLowerCase());
  }
  if (["perp", "perpetual"].includes(instrumentType)) return /^hyperliquid:perp:[A-Za-z0-9._-]+$/.test(id);
  return identityScope === "exact_instrument" && id.includes(":");
}

function recentMarketContexts(context = {}, limit = 10) {
  const candidates = [
    { subject: context.subject, timeframe: context.timeframe, workspace: context.workspace, leftAt: context.updatedAt },
    ...(Array.isArray(context.history) ? context.history : []),
  ];
  const seen = new Set();
  return candidates.filter((item) => {
    const subject = item?.subject || {};
    const identity = String(subject.id || "").trim().toLowerCase();
    if (!validRecentSubject(subject) || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, limit);
}

function recentSubjectMeta(subject = {}) {
  const type = String(subject.instrumentType || subject.marketType || "Exact instrument")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const seen = new Set();
  return [chainDisplayName(subject.chain), venueDisplayName(subject.venue), type]
    .filter((value) => {
      const key = String(value || "").trim().toLowerCase();
      if (!key || ["all", "unknown", "unknown chain"].includes(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" · ");
}

function navMarkup(slug, { mobile = false } = {}) {
  const items = NAV_ITEMS.filter((item) => !mobile || item.mobile !== false).map((item) => {
    const active = item.match.includes(slug) ? " active" : "";
    const className = mobile ? "ros-mobile-nav-item" : "ros-workspace-nav-item";
    return `<a class="${className}${active}" href="${ravenOSContext.decorateHref(item.href)}" data-ros-context-link data-ros-base-href="${item.href}" data-ros-nav="${item.key}"><span class="ros-nav-glyph" aria-hidden="true">${item.glyph}</span><span>${item.label}</span></a>`;
  }).join("");
  if (!mobile) return items;
  const moreActive = NAV_ITEMS.some((item) => item.mobile === false && item.match.includes(slug)) ? " active" : "";
  return `${items}<button class="ros-mobile-nav-item${moreActive}" type="button" data-ros-utility="more" aria-label="More RavenOS destinations"><span class="ros-nav-glyph" aria-hidden="true">M</span><span>More</span></button>`;
}

function providerCreditMarkup() {
  const providers = [
    { mark: "DP", name: "DexPaprika", role: "Exact-pool market history", href: "https://dexpaprika.com/", official: true },
    { mark: "DS", name: "DexScreener", role: "Pool discovery and current market state", href: "https://dexscreener.com/" },
    { mark: "CG", name: "CoinGecko", role: "Data provided by CoinGecko · exact-pool market history", href: "https://www.coingecko.com/en/api" },
    { mark: "DX", name: "Dexch", role: "Launchpad discovery and lifecycle enrichment", href: "https://dexch.art/" },
    { mark: "HL", name: "Hyperliquid", role: "Venue-native perpetual markets", href: "https://hyperliquid.xyz/" },
    { mark: "SEC", name: "SEC + Atlas", role: "Filings and public listed-market context", href: "https://www.sec.gov/edgar/search/" },
    { mark: "M", name: "Moralis", role: "Read-only wallet and holder inputs", href: "https://moralis.com/" },
    { mark: "K", name: "Constant-K + Raven", role: "Evidence and participant interpretation", href: "/docs/" },
    { mark: "CF", name: "Cloudflare", role: "Edge delivery and caching", href: "https://www.cloudflare.com/" },
    { mark: "TV", name: "TradingView", role: "Listed-market visual context and chart renderer", href: "https://www.tradingview.com/" },
  ];
  const rows = providers.map((provider) => `<a class="ros-provider-row" href="${provider.href}" ${provider.href.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}><span class="ros-provider-mark${provider.official ? " official" : ""}">${provider.official ? '<img src="/assets/providers/dexpaprika-symbol.svg" alt="" width="24" height="24" />' : escapeHtml(provider.mark)}</span><span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.role)}</small></span></a>`).join("");
  return `<details class="ros-provider-credit"><summary aria-label="Data sources and attribution" title="Data sources and attribution"><img src="/assets/providers/dexpaprika-symbol.svg" alt="" width="24" height="24" /><span class="ros-provider-label" aria-hidden="true">Sources</span><span class="ros-provider-attribution">Data by DexPaprika, CoinGecko + Dexch</span></summary><section class="ros-provider-panel" aria-label="RavenOS data providers"><header><span>Data sources</span><strong>Market data behind RavenOS</strong><p>RavenOS combines market data, filings, and participant signals into one decision workspace.</p></header><div class="ros-provider-grid">${rows}</div><footer>Provider attribution describes data sources, not endorsement or partnership.</footer></section></details>`;
}

function createShellMarkup(slug) {
  return `
    <header class="ros-topbar" data-ros-shell data-freshness-visible="false" data-context-visible="false">
      <a class="ros-brand" href="/discover/" aria-label="RavenOS Discover">
        <span class="ros-brand-mark" aria-hidden="true">R</span>
        <span class="ros-brand-type"><strong>RavenOS</strong></span>
      </a>
      <nav class="ros-workspace-nav" aria-label="RavenOS workspaces">${navMarkup(slug)}</nav>
      <button class="ros-command-trigger" id="rosCommandTrigger" type="button" aria-label="Search markets or wallets" aria-haspopup="dialog" aria-controls="rosCommandPalette">
        <span class="ros-search-icon" aria-hidden="true"></span>
        <span class="ros-command-copy"><strong>Search markets or wallets</strong><small>Symbol, contract, wallet, or pasted message</small></span>
        <kbd>⌘ K</kbd>
      </button>
      <div class="ros-freshness" id="rosFreshness" hidden><span class="ros-state-dot"></span><span><strong>Data unavailable</strong><time>No timestamp</time></span></div>
      <button class="ros-context-trigger" id="rosContextTrigger" type="button" aria-controls="rosContextRail" aria-expanded="false" hidden><span>Raven Read</span></button>
      ${providerCreditMarkup()}
      <button class="ros-profile-trigger" id="rosProfileTrigger" type="button" aria-label="Open account and settings">R</button>
    </header>
    <button class="ros-drawer-scrim" id="rosDrawerScrim" type="button" aria-label="Close open panel"></button>
    <aside class="ros-context-rail" id="rosContextRail" aria-label="Raven and Atlas intelligence">
      <header class="ros-context-header"><div><span>Selected instrument</span><strong id="rosContextSubject">No instrument selected</strong><small id="rosContextMeta">Search any supported market</small></div><button id="rosContextClose" type="button" aria-label="Close intelligence">Close</button></header>
      <section class="ros-context-intro"><span>One decision read</span><h2 id="rosMarketState">Data unavailable</h2><p id="rosThesis">Select an exact instrument to connect current market facts, Raven evidence, and Atlas context.</p></section>
      <section class="ros-context-section ros-context-grid"><div><span>Path</span><strong id="rosSetupState">Not ready</strong></div><div><span>Horizon</span><strong id="rosHorizon">Not specified</strong></div><div><span>Confidence</span><strong id="rosConfidence">Unrated</strong></div><div><span>Evidence</span><strong id="rosEvidenceQuality">Unknown</strong></div></section>
      <section class="ros-context-section"><span>What supports it</span><ul id="rosSupportingEvidence"><li>No confirming evidence is currently available.</li></ul></section>
      <section class="ros-context-section"><span>What would weaken it</span><ul id="rosContradictingEvidence"><li>No explicit invalidation is currently available.</li></ul></section>
      <section class="ros-context-section"><span>Next transition</span><p id="rosNextTransition">No transition is currently declared.</p></section>
      <section class="ros-context-section ros-evidence-navigation"><span>Evidence trail</span><div id="rosEvidenceNavigation"></div></section>
      <footer class="ros-context-footer"><button type="button" data-ros-context-action="terminal">Open in Terminal</button></footer>
    </aside>
    <aside class="ros-utility-drawer" id="rosUtilityDrawer" aria-label="RavenOS utilities">
      <header><div><span>Workspace</span><strong id="rosUtilityTitle">More</strong><a class="ros-utility-boundary" href="/terms/">Research only · Not financial advice</a></div><button id="rosUtilityClose" type="button">Close</button></header>
      <div class="ros-utility-content" id="rosUtilityContent"></div>
    </aside>
    <nav class="ros-mobile-nav" aria-label="Mobile primary navigation">${navMarkup(slug, { mobile: true })}</nav>
    <dialog class="ros-command-palette" id="rosCommandPalette" aria-label="Universal market and wallet search">
      <div class="ros-command-head"><div><span>Universal search</span><strong>Search a market, token, pool, or public wallet.</strong></div><button type="button" id="rosCommandClose" aria-label="Close search">Close</button></div>
      <label class="ros-command-input-wrap" for="rosCommandInput"><span class="ros-search-icon" aria-hidden="true"></span><input id="rosCommandInput" type="search" autocomplete="off" spellcheck="false" placeholder="BTC, BONK, SPY, token, pool, or wallet address" /></label>
      <div class="ros-search-status" id="rosSearchStatus">Loading supported markets…</div>
      <div class="ros-command-results" id="rosCommandResults"></div>
      <footer><span>Exact identity</span><span>Recent markets stay on this browser</span><span>Research only</span></footer>
    </dialog>`;
}

function setList(id, values, fallback) {
  const host = document.getElementById(id);
  if (!host) return;
  host.replaceChildren();
  const items = Array.isArray(values) && values.length ? values : [fallback];
  for (const value of items.slice(0, 5)) {
    const li = document.createElement("li");
    li.textContent = value?.label || String(value);
    host.append(li);
  }
}

function renderEvidenceNavigation(context, intelligence) {
  const host = document.getElementById("rosEvidenceNavigation");
  if (!host) return;
  host.replaceChildren();
  const exactSelected = context?.subject?.id && context.subject.id !== "unselected";
  const claimCandidates = [context?.detectionId, ...(intelligence?.sourceReferences || [])];
  const claimId = claimCandidates.find((value) => /^claim_[a-z0-9_-]{8,96}$/i.test(String(value || ""))) || "";
  const destinations = [
    { label: "Participant Intelligence", detail: "Broader aggregate context", href: "/behavior/" },
    { label: "Similar History", detail: exactSelected ? "Exact context requested; match is verified there" : "Broader historical context", href: "/replay/" },
    { label: "Measured Followthrough", detail: context?.outcomeId ? "Outcome reference attached" : "Broader measured context", href: "/outcomes/" },
  ];
  if (claimId) destinations.splice(1, 0, { label: "Original claim", detail: "Exact claim reference attached", href: `/claims/?id=${encodeURIComponent(claimId)}` });
  else destinations.splice(1, 0, { label: "Original claim", detail: "Exact claim not attached", href: "" });

  for (const destination of destinations) {
    const row = document.createElement(destination.href ? "a" : "div");
    row.className = "ros-evidence-destination";
    if (destination.href) {
      row.dataset.rosContextLink = "";
      row.dataset.rosBaseHref = destination.href;
      row.href = ravenOSContext.decorateHref(destination.href);
    } else row.dataset.state = "unavailable";
    const label = document.createElement("strong");
    label.textContent = destination.label;
    const detail = document.createElement("small");
    detail.textContent = destination.detail;
    row.append(label, detail);
    host.append(row);
  }
  const invalidation = document.createElement("div");
  invalidation.className = "ros-evidence-destination";
  invalidation.dataset.state = intelligence?.invalidation?.length ? "declared" : "unavailable";
  const invalidationLabel = document.createElement("strong");
  invalidationLabel.textContent = "Invalidation state";
  const invalidationDetail = document.createElement("small");
  invalidationDetail.textContent = intelligence?.invalidation?.length ? "Declared in this Raven Read" : "Unavailable for this Raven Read";
  invalidation.append(invalidationLabel, invalidationDetail);
  host.append(invalidation);
}

function unwrap(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", ...(init.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null);
  return { response, payload: unwrap(payload) };
}

function instrumentSubject(row = {}) {
  return {
    id: row.instrument_id,
    instrumentId: row.instrument_id,
    type: "instrument",
    label: row.asset || row.instrument || row.symbol,
    symbol: row.asset || row.instrument || row.symbol,
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
      raven_intelligence: Boolean(row.raven_context),
      quote_preview: false,
      execution: false,
    },
  };
}

function atlasInstrumentSubject(row = {}) {
  const instrument = row.instrument || {};
  const symbol = String(row.symbol || instrument.symbol || "").toUpperCase();
  return {
    id: row.instrument_id || instrument.instrument_id,
    instrumentId: row.instrument_id || instrument.instrument_id,
    type: "instrument",
    label: symbol || instrument.display_name || "Listed instrument",
    symbol,
    assetClass: instrument.asset_class || "equity",
    instrumentType: instrument.instrument_type || "equity",
    identityScope: instrument.identity_scope || "exact_instrument",
    chain: instrument.chain || "none",
    venue: instrument.venue || "unknown",
    marketType: "equities",
    quoteAsset: instrument.quote_asset?.symbol || "USD",
    settlementAsset: instrument.settlement_asset?.symbol || "USD",
    preferredCashAsset: instrument.preferred_cash_asset?.symbol || "USD",
    economicNumeraire: instrument.economic_numeraire || "USDC",
    capabilities: { ...(instrument.capabilities || {}), execution: false },
  };
}

function traditionalSearchInstrument(instrument = {}) {
  const subject = atlasInstrumentSubject({
    instrument_id: instrument.instrument_id,
    symbol: instrument.symbol,
    instrument,
  });
  if (
    !subject.id
    || !subject.symbol
    || !["equity", "etf"].includes(subject.instrumentType)
    || subject.identityScope !== "exact_instrument"
    || subject.capabilities.execution !== false
  ) return null;
  const visualChart = resolveTradingViewChart({
    entity_id: `${subject.instrumentType}:us:${subject.symbol}`,
    entity_kind: subject.instrumentType,
    symbol: subject.symbol,
    name: instrument.display_name || subject.symbol,
  }, { exactInstrument: instrument });
  const chartAvailable = instrument.capabilities?.chart === true || Boolean(visualChart);
  return {
    instrument_id: subject.id,
    asset: subject.symbol,
    symbol: subject.symbol,
    label: `${subject.symbol} · ${instrument.display_name || subject.instrumentType.toUpperCase()}`,
    name: instrument.display_name || subject.symbol,
    detail: `${instrument.market_identity?.listing || subject.venue} · USD settlement · USDC economic view`,
    state: chartAvailable ? "Exact listing · chart available" : "Exact listing · chart unavailable",
    group: "Listed markets",
    raven_context: false,
    subject,
  };
}

function atlasSearchInstrument(row = {}, query = "") {
  const entityId = String(row.entity_id || "").trim();
  const symbol = String(row.symbol || "").trim().toUpperCase();
  const kind = String(row.entity_kind || "").trim().toLowerCase();
  if (!entityId || !symbol || row.selectable !== true) return null;
  if (kind === "sec_filing" && !/(?:\d{10}-\d{2}-\d{6}|\b10-[kq]\b|\b8-k\b|\bform\s*4\b)/i.test(query)) return null;
  const kindLabels = {
    index: "Index",
    forex_pair: "Forex",
    future_root: "Futures",
    future_contract: "Futures contract",
    rate_series: "Rate series",
    economic_series: "Economic series",
    energy_series: "Energy series",
    sec_issuer: "SEC issuer",
    sec_filing: "SEC filing",
    crypto_context_asset: "Crypto context",
  };
  const timing = String(row.data_timing || row.status || "").toUpperCase();
  const timingLabel = timing === "PERIODIC" ? "Periodic" : timing === "DELAYED" ? "Delayed" : timing === "LIVE" ? "Timing shown on open" : "Availability checked on open";
  return {
    instrument_id: `atlas:${entityId}`,
    asset: symbol,
    symbol,
    label: `${symbol} · ${row.name || kindLabels[kind] || "Atlas entity"}`,
    name: row.name || symbol,
    detail: `${kindLabels[kind] || kind.replaceAll("_", " ")} · ${row.provider || "Atlas"} · ${timingLabel}`,
    state: row.public_display_eligibility === "allowed" ? "Open Atlas context" : "Identity available · values checked on open",
    group: "Atlas",
    atlas_entity_kind: kind,
    destination: "atlas",
    href: `/atlas/?entity_id=${encodeURIComponent(entityId)}`,
    raven_context: false,
  };
}

function spotInstrumentSubject(row = {}) {
  const chain = String(row.chainId || "").trim().toLowerCase();
  const pairAddress = String(row.pairAddress || "").trim();
  const symbol = String(row.symbol || "UNKNOWN").trim().toUpperCase();
  const quote = String(row.quoteSymbol || "QUOTE").trim().toUpperCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(chain) || !pairAddress || !String(row.tokenAddress || "").trim()) return null;
  return {
    id: `${chain}:pool:${pairAddress}`,
    instrumentId: `${chain}:pool:${pairAddress}`,
    type: "pool",
    label: `${symbol}/${quote}`,
    symbol,
    assetClass: "crypto",
    instrumentType: "exact_pool",
    identityScope: "exact_pool",
    chain,
    venue: String(row.dexId || "unknown").trim().toLowerCase(),
    marketType: "spot",
    quoteAsset: quote,
    settlementAsset: quote,
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    tokenAddress: String(row.tokenAddress || "").trim(),
    quoteTokenAddress: String(row.quoteTokenAddress || "").trim(),
    poolAddress: pairAddress,
    capabilities: {
      chart: spotChartRequestSupported(row),
      live_price: finiteNumber(row.priceUsd) !== null,
      liquidity: finiteNumber(row.liquidityUsd) !== null,
      route_preview: chain === "solana",
      raven_intelligence: false,
      execution: false,
    },
  };
}

function spotSearchInstrument(row = {}) {
  const subject = spotInstrumentSubject(row);
  if (!subject) return null;
  const chainLabel = chainDisplayName(subject.chain);
  const chartRequestSupported = spotChartRequestSupported(row, "1h");
  return {
    ...row,
    instrument_id: subject.id,
    asset: subject.label,
    label: subject.label,
    detail: `${row.name || subject.symbol} · ${chainLabel} · ${row.dexId || "venue unavailable"} · pool ${shortMarketId(row.pairAddress)} · ${compactCurrency(row.liquidityUsd)}`,
    state: row.input_match === "pool_address"
      ? chartRequestSupported ? "Pool address resolved · exact chart opens here" : "Pool address resolved · chart unavailable"
      : chartRequestSupported ? "Exact pool · chart coverage checked on open" : "Exact pool · chart unavailable",
    group: `Spot · ${chainLabel}`,
    raven_context: false,
    subject,
  };
}

function spotSearchQuality(row = {}, query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  const addressTerms = extractedMarketAddresses(query).map((value) => value.toLowerCase());
  const chain = String(row.chainId || "").toLowerCase();
  const symbol = String(row.symbol || "").trim().toLowerCase();
  const name = String(row.name || "").trim().toLowerCase();
  const exactAddress = normalized && [row.tokenAddress, row.quoteTokenAddress, row.pairAddress]
    .filter(Boolean)
    .some((value) => addressTerms.includes(String(value).toLowerCase()) || String(value).toLowerCase() === normalized);
  const exactName = normalized && (symbol === normalized || name === normalized);
  const chartReady = spotChartRequestSupported(row, "1h");
  const volume = Math.max(0, finiteNumber(row.volume24h) || 0);
  const liquidity = Math.max(0, finiteNumber(row.liquidityUsd) || 0);
  return { exactAddress, exactName, chartReady, active: volume > 0, liquid: liquidity > 0, volume, liquidity };
}

function rankSpotSearchRows(rows = [], query = "") {
  return [...rows].sort((left, right) => {
    const a = spotSearchQuality(left, query);
    const b = spotSearchQuality(right, query);
    return Number(b.exactAddress) - Number(a.exactAddress)
      || Number(b.exactName) - Number(a.exactName)
      || Number(b.chartReady) - Number(a.chartReady)
      || Number(b.active) - Number(a.active)
      || Number(b.liquid) - Number(a.liquid)
      || b.volume - a.volume
      || b.liquidity - a.liquidity
      || String(left.symbol || left.name || "").localeCompare(String(right.symbol || right.name || ""));
  });
}

function utilityMarkup(kind, context) {
  if (kind === "watchlist") {
    const history = recentMarketContexts(context, 10);
    const recent = history.length
      ? `<div class="ros-utility-list">${history.map((item) => {
        const subject = item.subject || {};
        const meta = recentSubjectMeta(subject);
        return `<a href="${escapeHtml(terminalHref(subject))}" data-recent-instrument="${escapeHtml(subject.id)}"><strong>${escapeHtml(subject.label || subject.symbol || subject.id)}</strong><span>${escapeHtml(meta || "Exact instrument")}</span></a>`;
      }).join("")}</div>`
      : `<div class="ros-utility-empty"><strong>No recent markets</strong><p>Markets you open will appear here.</p></div>`;
    return `<section><span>Recent markets on this browser</span>${recent}</section><section><span>Saved markets</span><strong>Pick up where you left off</strong><p>Save an exact pool or instrument with its chart settings, then reopen it on any signed-in device.</p><a href="https://app.ravenos.xyz/monitor/">Open saved markets</a></section>`;
  }
  if (kind === "alerts") {
    return `<section class="ros-utility-unavailable"><span>Raven alerts</span><strong>Watch meaningful market changes</strong><p>Choose a saved market and the changes Raven should watch. Alerts appear in RavenOS; Telegram, email, and push are not available yet.</p><a href="https://app.ravenos.xyz/monitor/">Open Raven alerts</a></section>`;
  }
  const accountHref = customerAccountState.available && customerAccountState.canonicalOrigin
    ? `${customerAccountState.canonicalOrigin}/account/`
    : "/account/";
  const accountLabel = customerAccountState.authenticated ? "Account & security" : "Create account or sign in";
  const accountDetail = customerAccountState.authenticated
    ? `Signed in${customerAccountState.username ? ` · @${escapeHtml(customerAccountState.username)}` : " · choose a username"}`
    : customerAccountState.available ? "Google, email, password, or code" : "Sign-in temporarily unavailable";
  const copyHref = customerAccountState.available && customerAccountState.canonicalOrigin
    ? `${customerAccountState.canonicalOrigin}/account/copy/`
    : "https://app.ravenos.xyz/account/copy/";
  return `<div class="ros-more-menu">
    <section>
      <span>Research workspaces</span>
      <nav class="ros-more-links" aria-label="Research workspaces">
        <a href="/community/"><strong>Community</strong><span>Evidence-qualified public profiles</span></a>
        <a href="/intelligence/"><strong>Raven Lab</strong><span>Behavior and perps context</span></a>
        <a href="/atlas/"><strong>Atlas</strong><span>Market breadth, filings, and listed-market context</span></a>
      </nav>
    </section>
    <section>
      <span>Your workspace</span>
      <nav class="ros-more-links" aria-label="Account and saved research">
        <a href="${escapeHtml(accountHref)}"><strong>${accountLabel}</strong><span>${accountDetail}</span></a>
        <button type="button" data-ros-utility="watchlist"><strong>Recent & saved</strong><span>Recently opened markets and saved exact charts</span></button>
        <button type="button" data-ros-utility="alerts"><strong>Raven Monitor</strong><span>Watch saved markets and review important changes</span></button>
        <a href="${escapeHtml(copyHref)}"><strong>Wallet Intelligence &amp; Raven Copy</strong><span>Separate source returns from follower-realistic shadow results</span></a>
      </nav>
    </section>
    <section>
      <span>Plans & help</span>
      <nav class="ros-more-links" aria-label="Plans and help">
        <a href="/pricing/"><strong>Plans</strong><span>Free, Pro, Desk, and Enterprise</span></a>
        <a href="/docs/"><strong>Quick guide</strong><span>Find, inspect, and evaluate a market</span></a>
        <a href="/faq/"><strong>FAQ</strong><span>What RavenOS can and cannot do</span></a>
      </nav>
    </section>
  </div>`;
}

export function mountRavenOSShell(options = {}) {
  if (window.RavenOSShell?.mounted) return window.RavenOSShell;
  const slug = options.slug || currentSlug();
  const isTerminal = location.pathname.startsWith("/terminal/") || location.pathname.startsWith("/perps/");
  document.body.classList.add("ros-shell-active", isTerminal ? "ros-shell-terminal" : "ros-shell-route");
  document.body.insertAdjacentHTML("afterbegin", createShellMarkup(slug));

  let intelligence = createIntelligenceRecord({ subject: ravenOSContext.getState().subject });
  let capabilities = {};
  let instrumentIndex = [];
  let instrumentSources = [];
  let searchReady = false;
  let searchFailure = false;
  let spotSearchTimer = null;
  let spotSearchController = null;
  let spotSearchGeneration = 0;
  let spotSearch = { query: "", rows: [], state: "idle" };
  let commandActiveIndex = -1;
  const palette = document.getElementById("rosCommandPalette");
  const commandInput = document.getElementById("rosCommandInput");
  const commandResults = document.getElementById("rosCommandResults");
  const searchStatus = document.getElementById("rosSearchStatus");

  function renderContext(context = ravenOSContext.getState()) {
    const subject = context.subject;
    const selected = subject.id !== "unselected";
    document.getElementById("rosContextSubject").textContent = selected ? subject.label : "No instrument selected";
    document.getElementById("rosContextMeta").textContent = selected
      ? [subject.assetClass, subject.instrumentType, subject.venue, subject.chain].filter((value) => value && !["unknown", "all"].includes(value)).join(" · ") || subject.id
      : "Search any supported market";
    document.querySelectorAll("[data-ros-context-link]").forEach((link) => {
      link.setAttribute("href", ravenOSContext.decorateHref(link.dataset.rosBaseHref || link.getAttribute("href")));
    });
    renderEvidenceNavigation(context, intelligence);
  }

  function setIntelligence(next) {
    const presentation = next?.presentation && typeof next.presentation === "object" ? next.presentation : {};
    intelligence = next?.schemaVersion ? next : createIntelligenceRecord(next || {}, { subject: ravenOSContext.getState().subject });
    const freshness = intelligence.freshness;
    const freshnessHost = document.getElementById("rosFreshness");
    const contextTrigger = document.getElementById("rosContextTrigger");
    const shell = document.querySelector("[data-ros-shell]");
    const exactSubjectSelected = Boolean(intelligence.subject?.id && intelligence.subject.id !== "unselected");
    const decisionContextAvailable = Boolean(
      intelligence.supportingEvidence.length
      || intelligence.contradictingEvidence.length
      || intelligence.invalidation.length
      || !["unavailable", "unqualified", "market_data_only", "unknown"].includes(intelligence.setupState.state)
      || !["unavailable", "market_data_only", "unknown"].includes(intelligence.evidenceQuality.state)
    );
    const showFreshness = presentation.status === true || (
      presentation.status !== false
      && Boolean(freshness.observedAt)
      && freshness.state !== "data_unavailable"
    );
    const showContext = presentation.context === true || (
      presentation.context !== false
      && exactSubjectSelected
      && decisionContextAvailable
    );
    freshnessHost.hidden = !showFreshness;
    contextTrigger.hidden = !showContext;
    contextTrigger.querySelector("span").textContent = presentation.contextLabel || "Raven Read";
    contextTrigger.setAttribute("aria-label", presentation.contextLabel || "Open Raven Read");
    shell.dataset.freshnessVisible = String(showFreshness);
    shell.dataset.contextVisible = String(showContext);
    if (!showContext && document.body.classList.contains("ros-context-open")) closeDrawers();
    freshnessHost.dataset.state = freshness.state;
    freshnessHost.querySelector("strong").textContent = freshness.label || RavenDataStateLabels[freshness.state] || "Data unavailable";
    freshnessHost.querySelector("time").textContent = formatObservedAt(freshness.observedAt);
    document.getElementById("rosMarketState").textContent = intelligence.marketState.label;
    document.getElementById("rosThesis").textContent = renderIntelligence(intelligence, "conciseOpportunitySummary");
    document.getElementById("rosSetupState").textContent = intelligence.setupState.state.replaceAll("_", " ");
    document.getElementById("rosHorizon").textContent = intelligence.timeHorizon;
    document.getElementById("rosConfidence").textContent = intelligence.confidence.label;
    document.getElementById("rosEvidenceQuality").textContent = intelligence.evidenceQuality.state.replaceAll("_", " ");
    document.getElementById("rosNextTransition").textContent = intelligence.nextExpectedTransition;
    setList("rosSupportingEvidence", intelligence.supportingEvidence, "No confirming evidence is currently available.");
    setList("rosContradictingEvidence", [...intelligence.contradictingEvidence, ...intelligence.invalidation], "No explicit invalidation is currently available.");
    renderEvidenceNavigation(ravenOSContext.getState(), intelligence);
    return intelligence;
  }

  function setCapabilities(next = {}) {
    const defaults = {
      market: "Data unavailable",
      wallet: "No session",
      mode: "Read only",
      signing: "Sign off",
      broadcast: "Broadcast off",
      evidence: "Evidence pending",
    };
    capabilities = { ...defaults, ...next };
    Object.entries(capabilities).forEach(([key, value]) => {
      const field = document.querySelector(`[data-ros-capability="${key}"]`);
      if (field) field.textContent = safeMetric(value);
    });
    const host = document.getElementById("rosCapabilityStatus");
    if (host) host.dataset.marketState = capabilities.market.toLowerCase().replaceAll(" ", "_");
    return capabilities;
  }

  function closeDrawers() {
    document.body.classList.remove("ros-context-open", "ros-utility-open");
    document.getElementById("rosContextTrigger").setAttribute("aria-expanded", "false");
  }

  function openContext() {
    document.body.classList.remove("ros-utility-open");
    document.body.classList.add("ros-context-open");
    document.getElementById("rosContextTrigger").setAttribute("aria-expanded", "true");
  }

  function openUtility(kind = "more") {
    const context = ravenOSContext.getState();
    document.getElementById("rosUtilityTitle").textContent = kind === "watchlist" ? "Watchlists" : kind === "alerts" ? "Alerts" : "More";
    document.getElementById("rosUtilityContent").innerHTML = utilityMarkup(kind, context);
    document.body.classList.remove("ros-context-open");
    document.body.classList.add("ros-utility-open");
  }

  function renderCustomerAccountState(next = {}) {
    const candidateUsername = String(next.username || "").trim().toLowerCase();
    const username = /^[a-z][a-z0-9_]{2,23}$/.test(candidateUsername) ? candidateUsername : "";
    customerAccountState = Object.freeze({
      available: next.available === true,
      authenticated: next.authenticated === true,
      canonicalOrigin: String(next.canonicalOrigin || ""),
      username,
    });
    const trigger = document.getElementById("rosProfileTrigger");
    trigger.textContent = customerAccountState.authenticated
      ? (customerAccountState.username.charAt(0).toUpperCase() || "R")
      : "R";
    trigger.dataset.accountState = customerAccountState.authenticated ? "authenticated" : customerAccountState.available ? "available" : "pending";
    trigger.setAttribute("aria-label", customerAccountState.authenticated ? "Open account and security" : "Open account");
  }

  async function hydrateCustomerAccountState() {
    try {
      const configResult = await fetchJson("/api/v1/auth/config");
      const config = configResult.payload || {};
      const next = {
        available: config.available === true,
        authenticated: false,
        canonicalOrigin: config.canonical_origin || "",
        username: "",
      };
      if (config.available === true && config.on_authenticated_origin === true) {
        const sessionResult = await fetchJson("/api/v1/auth/session");
        if (sessionResult.payload?.authenticated === true) {
          next.authenticated = true;
          next.username = sessionResult.payload.account?.username || "";
        }
      }
      renderCustomerAccountState(next);
    } catch {
      renderCustomerAccountState();
    }
  }

  function appendCommandResult(item, host = commandResults) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ros-command-result ${item.commandType === "wallet" ? "wallet" : "instrument"}`;
    const eyebrow = document.createElement("span");
    eyebrow.className = "ros-command-result-group";
    eyebrow.textContent = item.group || (item.raven_context ? "Raven now" : "Live market");
    const title = document.createElement("strong");
    title.textContent = item.label || item.asset;
    const detail = document.createElement("span");
    detail.className = "ros-command-result-detail";
    detail.textContent = item.detail || item.instrument_id || "";
    const state = document.createElement("small");
    state.textContent = item.state || "Inspect";
    button.append(eyebrow, title, detail, state);
    button.addEventListener("pointerenter", () => {
      const buttons = [...commandResults.querySelectorAll(".ros-command-result")];
      commandActiveIndex = buttons.indexOf(button);
      for (const candidate of buttons) candidate.dataset.active = String(candidate === button);
    });
    button.addEventListener("click", () => {
      palette.close();
      if (item.href) {
        ravenOSContext.navigate(item.href);
        return;
      }
      const subject = item.subject || instrumentSubject(item);
      ravenOSContext.setSelection({ subject }, { updateUrl: false });
      ravenOSContext.navigate(terminalHref(subject));
    });
    host.append(button);
  }

  function appendCommandGroup(labelText, rows, countText = "") {
    if (!rows.length) return;
    const section = document.createElement("section");
    section.className = "ros-command-group";
    if (labelText === "Recently viewed") section.classList.add("recent");
    const heading = document.createElement("header");
    const label = document.createElement("strong");
    label.textContent = labelText;
    const count = document.createElement("span");
    count.textContent = countText || `${rows.length} exact ${rows.length === 1 ? "choice" : "choices"}`;
    heading.append(label, count);
    const grid = document.createElement("div");
    grid.className = "ros-command-group-grid";
    for (const item of rows) appendCommandResult(item, grid);
    section.append(heading, grid);
    commandResults.append(section);
  }

  function recentCommandResults() {
    return recentMarketContexts(ravenOSContext.getState(), 10).map((item) => {
      const subject = item.subject || {};
      return {
        instrument_id: subject.id,
        subject,
        label: subject.label || subject.symbol || subject.id,
        detail: recentSubjectMeta(subject) || "Exact instrument",
        group: "Recent market",
        state: "Reopen",
      };
    });
  }

  function commandMatchRank(item, normalized) {
    if (!normalized) return 0;
    const values = [
      item.symbol,
      item.asset,
      item.subject?.symbol,
      item.label,
      item.name,
      item.instrument?.display_name,
      item.tokenAddress,
      item.quoteTokenAddress,
      item.pairAddress,
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    if (values.slice(0, 3).some((value) => value === normalized)) return 0;
    if (values.some((value) => value === normalized)) return 1;
    if (values.slice(0, 3).some((value) => value === `${normalized}-perp` || value.startsWith(`${normalized}/`))) return 2;
    if (values.some((value) => value.startsWith(normalized))) return 3;
    if (values.some((value) => value.split(/[^a-z0-9]+/).includes(normalized))) return 4;
    return 5;
  }

  function commandFamily(item) {
    const subject = item.subject || {};
    const type = String(subject.instrumentType || item.instrument?.instrument_type || "").toLowerCase();
    if (type === "perpetual" || String(item.instrument_id || "").startsWith("hyperliquid:perp:")) return "Perpetuals";
    if (type === "exact_pool" || String(item.instrument_id || "").includes(":pool:")) return "Spot markets";
    if (["equity", "etf"].includes(type)) return "Stocks & ETFs";
    const atlasKind = String(item.atlas_entity_kind || "").toLowerCase();
    if (atlasKind === "index") return "Indices";
    if (["forex_pair", "future_root", "future_contract"].includes(atlasKind)) return "Macro markets";
    if (["rate_series", "economic_series"].includes(atlasKind)) return "Rates & economy";
    if (atlasKind === "energy_series") return "Energy";
    if (["sec_issuer", "sec_filing"].includes(atlasKind)) return "Companies & filings";
    return "Other exact instruments";
  }

  function commandFamilyRank(item, normalized, rows) {
    const family = commandFamily(item);
    const explicitPerp = /(?:-perp|\bperp(?:etual)?s?)$/i.test(normalized);
    const addressQuery = extractedMarketAddresses(normalized).length > 0;
    const exactPerp = rows.some((row) => commandFamily(row) === "Perpetuals" && commandMatchRank(row, normalized) === 0);
    const contextFamilies = ["Indices", "Macro markets", "Rates & economy", "Energy", "Companies & filings", "Other exact instruments"];
    const order = addressQuery
      ? ["Spot markets", "Perpetuals", "Stocks & ETFs", ...contextFamilies]
      : explicitPerp || exactPerp
        ? ["Perpetuals", "Stocks & ETFs", "Spot markets", ...contextFamilies]
        : ["Stocks & ETFs", "Perpetuals", "Spot markets", ...contextFamilies];
    const rank = order.indexOf(family);
    return rank === -1 ? order.length : rank;
  }

  function commandSpotQualityRank(item) {
    const subject = item.subject || {};
    if (subject.instrumentType !== "exact_pool") return [0, 0, 0, 0];
    return [
      subject.capabilities?.chart === true ? 0 : 1,
      finiteNumber(item.volume24h) > 0 ? 0 : 1,
      -(finiteNumber(item.volume24h) || 0),
      -(finiteNumber(item.liquidityUsd) || 0),
    ];
  }

  function compareSpotQuality(left, right) {
    const a = commandSpotQualityRank(left);
    const b = commandSpotQualityRank(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
  }

  function uniqueCommandResults(rows = []) {
    const seen = new Set();
    return rows.filter((item) => {
      const identity = String(item?.instrument_id || item?.subject?.id || "").toLowerCase();
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }

  function renderCommands(query = "") {
    const clean = query.trim();
    const normalized = clean.toLowerCase();
    const walletResult = publicWalletCommandResult(clean);
    commandResults.replaceChildren();
    commandActiveIndex = -1;
    const recent = clean ? [] : recentCommandResults();
    const recentIds = new Set(recent.map((item) => String(item.instrument_id || "").toLowerCase()));
    if (recent.length) appendCommandGroup("Recently viewed", recent, `${recent.length} on this browser`);
    const indexedInstruments = instrumentIndex
      .filter((item) => !normalized || [item.asset, item.label, item.symbol, item.name, item.instrument_id, item.detail, item.instrument?.display_name, item.instrument?.market_identity?.listing].filter(Boolean).join(" ").toLowerCase().includes(normalized))
      .filter((item) => !recentIds.has(String(item.instrument_id || item.subject?.id || "").toLowerCase()))
      .slice(0, clean ? 16 : recent.length ? 0 : 6);
    const resolvedResults = spotSearch.query === normalized ? spotSearch.rows : [];
    const candidates = uniqueCommandResults([...indexedInstruments, ...resolvedResults]);
    const instruments = candidates
      .sort((left, right) => (
        commandMatchRank(left, normalized) - commandMatchRank(right, normalized)
        || Number(Boolean(right.raven_context)) - Number(Boolean(left.raven_context))
        || commandFamilyRank(left, normalized, candidates) - commandFamilyRank(right, normalized, candidates)
        || compareSpotQuality(left, right)
        || String(left.label || left.asset).localeCompare(String(right.label || right.asset))
      ))
      .slice(0, clean ? 24 : 8);
    const grouped = new Map();
    for (const item of instruments) {
      const family = commandFamily(item);
      if (!grouped.has(family)) grouped.set(family, []);
      grouped.get(family).push(item);
    }
    for (const [family, rows] of grouped) {
      appendCommandGroup(family, rows);
    }
    if (walletResult) {
      appendCommandGroup("Wallet intelligence", [walletResult], "Explicit public address · Pro analysis");
    }
    if (!instruments.length && !recent.length && !walletResult) {
      const empty = document.createElement("div");
      empty.className = "ros-command-empty";
      const searchPending = clean.length >= 1 && spotSearch.query === normalized && spotSearch.state === "searching";
      empty.innerHTML = searchPending
        ? "<strong>Resolving exact markets.</strong><p>RavenOS is checking listed instruments, perpetuals, chains, DEXs, and pools without making a mode choice for you.</p>"
        : "<strong>No supported market or public wallet matched.</strong><p>RavenOS will not silently choose a chain, pool, venue, expiry, contract, or wallet identity.</p>";
      commandResults.append(empty);
    }
    const registryState = !clean && recent.length
      ? `${recent.length} recently viewed exact market${recent.length === 1 ? "" : "s"} · stored only on this browser · type to search all markets`
      : searchFailure
      ? "Live market catalog unavailable"
      : searchReady
        ? `${instrumentIndex.length.toLocaleString()} indexed exact markets · ${instrumentSources.join(" + ")} · live lookup checks additional exact pools`
        : "Loading supported markets…";
    const spotState = clean.length < 1 || spotSearch.query !== normalized
      ? ""
      : spotSearch.state === "searching"
        ? " · resolving exact markets"
        : spotSearch.state === "ready"
          ? ` · ${spotSearch.rows.length.toLocaleString()} additional exact market${spotSearch.rows.length === 1 ? "" : "s"}${spotSearch.summary ? ` · ${spotSearch.summary}` : ""}`
          : spotSearch.state === "empty"
            ? ` · no additional exact market matched${spotSearch.summary ? ` · ${spotSearch.summary}` : ""}`
            : spotSearch.state === "unavailable"
              ? " · live market lookup unavailable"
              : "";
    const walletState = walletResult ? " · public-wallet analysis available" : "";
    searchStatus.textContent = registryState + spotState + walletState;
  }

  function moveCommandSelection(direction) {
    const buttons = [...commandResults.querySelectorAll(".ros-command-result")];
    if (!buttons.length) return;
    commandActiveIndex = commandActiveIndex < 0
      ? direction > 0 ? 0 : buttons.length - 1
      : (commandActiveIndex + direction + buttons.length) % buttons.length;
    for (const [index, button] of buttons.entries()) button.dataset.active = String(index === commandActiveIndex);
    buttons[commandActiveIndex].scrollIntoView({ block: "nearest" });
  }

  function scheduleSpotSearch(query = "") {
    clearTimeout(spotSearchTimer);
    spotSearchController?.abort();
    spotSearchController = null;
    const raw = query.trim().slice(0, 512);
    const addressTerms = extractedMarketAddresses(raw);
    const clean = addressTerms.length ? addressTerms.join(" ") : raw.slice(0, 96);
    const normalized = raw.toLowerCase();
    if (clean.length < 1) {
      ++spotSearchGeneration;
      spotSearch = { query: "", rows: [], state: "idle", summary: "" };
      return;
    }
    if (spotSearch.query === normalized && ["searching", "ready", "empty"].includes(spotSearch.state)) return;
    const generation = ++spotSearchGeneration;
    spotSearch = { query: normalized, rows: [], state: "searching", summary: "" };
    spotSearchTimer = setTimeout(async () => {
      const controller = new AbortController();
      spotSearchController = controller;
      const timeout = setTimeout(() => controller.abort(), 6_000);
      try {
        const likelyContractAddress = addressTerms.length > 0;
        const spotApplicable = clean.length >= 2;
        const listedApplicable = !likelyContractAddress;
        const atlasApplicable = clean.length >= 2 && !likelyContractAddress;
        const [spotResult, listedResult, atlasResult] = await Promise.allSettled([
          spotApplicable
            ? fetchJson(`/api/dexscreener/search?q=${encodeURIComponent(clean)}`, { signal: controller.signal })
            : Promise.resolve(null),
          listedApplicable
            ? fetchJson(`/api/instruments/search?q=${encodeURIComponent(clean)}`, { signal: controller.signal })
            : Promise.resolve(null),
          atlasApplicable
            ? fetchJson(`/api/atlas/search?q=${encodeURIComponent(clean)}&limit=20`, { signal: controller.signal })
            : Promise.resolve(null),
        ]);
        if (generation !== spotSearchGeneration) return;
        const seen = new Set();
        const spotAvailable = spotApplicable
          && spotResult.status === "fulfilled"
          && spotResult.value?.response?.ok
          && Array.isArray(spotResult.value?.payload?.results);
        const listedAvailable = listedApplicable && (
          listedResult.status === "fulfilled"
          && listedResult.value?.response?.ok
          && Array.isArray(listedResult.value?.payload?.results)
        );
        const atlasAvailable = atlasApplicable && (
          atlasResult.status === "fulfilled"
          && atlasResult.value?.response?.ok
          && atlasResult.value?.payload?.schema_version === "atlas_search_result_v1"
          && Array.isArray(atlasResult.value?.payload?.results)
        );
        const spotRows = spotAvailable ? rankSpotSearchRows(spotResult.value.payload.results, clean) : [];
        const listedRows = !listedAvailable ? [] : listedResult.value.payload.results;
        const listedSymbols = new Set(listedRows.map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean));
        const atlasRows = atlasAvailable ? atlasResult.value.payload.results : [];
        const rows = [...spotRows.flatMap((row) => {
          const instrument = spotSearchInstrument(row);
          if (!instrument || seen.has(instrument.instrument_id)) return [];
          seen.add(instrument.instrument_id);
          return [instrument];
        }), ...listedRows.flatMap((row) => {
          const instrument = traditionalSearchInstrument(row);
          if (!instrument || seen.has(instrument.instrument_id)) return [];
          seen.add(instrument.instrument_id);
          return [instrument];
        }), ...atlasRows.flatMap((row) => {
          if (["equity", "etf"].includes(row.entity_kind) && listedSymbols.has(String(row.symbol || "").toUpperCase())) return [];
          const instrument = atlasSearchInstrument(row, clean);
          if (!instrument || seen.has(instrument.instrument_id)) return [];
          seen.add(instrument.instrument_id);
          return [instrument];
        })].slice(0, 48);
        const summary = [
          !spotApplicable ? "onchain search starts at 2 characters" : spotAvailable ? "onchain markets current" : "onchain markets unavailable",
          !listedApplicable ? "listed markets not applicable" : listedAvailable ? "listed markets current" : "listed markets unavailable",
          !atlasApplicable ? "Atlas context not applicable" : atlasAvailable ? "Atlas catalog current" : "Atlas catalog unavailable",
        ].join(" · ");
        spotSearch = {
          query: normalized,
          rows,
          state: rows.length ? "ready" : (spotAvailable || listedAvailable) ? "empty" : "unavailable",
          summary,
        };
      } catch {
        if (generation !== spotSearchGeneration) return;
        spotSearch = { query: normalized, rows: [], state: "unavailable", summary: "" };
      } finally {
        clearTimeout(timeout);
        if (spotSearchController === controller) spotSearchController = null;
      }
      if (commandInput.value.trim().toLowerCase() === normalized) renderCommands(commandInput.value);
    }, 180);
  }

  async function hydrateInstrumentSearch() {
    try {
      const [perpsResult, opportunityResult, atlasResult] = await Promise.allSettled([
        fetchJson("/api/hyperliquid/perps"),
        fetchJson("/api/opportunity"),
        fetchJson("/api/atlas"),
      ]);
      const perpsPayload = perpsResult.status === "fulfilled" ? perpsResult.value : null;
      const opportunityPayload = opportunityResult.status === "fulfilled" ? opportunityResult.value?.payload : null;
      const opportunityRows = opportunityPayload?.census?.opportunities?.rows || [];
      const opportunityById = new Map(opportunityRows.map((row) => [row.instrument_id, row]));
      const rows = perpsPayload?.response?.ok && Array.isArray(perpsPayload.payload?.results) ? perpsPayload.payload.results : [];
      const perpRows = rows.map((row) => {
        const raven = opportunityById.get(row.instrument_id);
        return {
          ...row,
          label: row.asset,
          detail: customerFacingText(raven?.why_raven_noticed, "Hyperliquid perpetual · USD/USDC settled"),
          state: raven ? `Raven ${raven.context_state || "observed"}` : "Live market",
          group: raven ? "Raven now" : "Hyperliquid",
          raven_context: Boolean(raven),
        };
      });
      const atlasPayload = atlasResult.status === "fulfilled" ? atlasResult.value : null;
      const atlas = atlasPayload?.payload;
      const atlasCurrent = atlasPayload?.response?.ok
        && atlas?.schema_version === "ravenos.atlas_projection.v1"
        && ["fresh", "delayed"].includes(atlas?.freshness?.state)
        && atlas?.delivery?.source === "current_public_origin"
        && atlas?.delivery?.fallback === false;
      const atlasRows = atlasCurrent && Array.isArray(atlas?.market_context?.rows)
        ? atlas.market_context.rows.filter((row) => row?.instrument_id && row?.instrument?.instrument_id === row.instrument_id && row.instrument?.identity_scope === "exact_instrument").map((row) => {
          const subject = atlasInstrumentSubject(row);
          return {
            ...row,
            asset: subject.symbol,
            label: subject.label,
            detail: `${row.instrument?.market_identity?.listing || subject.venue} · Atlas ${atlas.freshness.state}`,
            state: "Atlas context",
            group: "Atlas markets",
            raven_context: false,
            subject,
          };
        })
        : [];
      instrumentIndex = [...perpRows, ...atlasRows];
      instrumentSources = [perpRows.length ? "Hyperliquid" : "", atlasRows.length ? "Atlas" : ""].filter(Boolean);
      searchReady = instrumentIndex.length > 0;
      searchFailure = !searchReady;
    } catch {
      searchFailure = true;
    }
    renderCommands(commandInput.value);
  }

  function openPalette(query = "") {
    const requestedQuery = typeof query === "string" ? query.trim() : "";
    if (requestedQuery) commandInput.value = requestedQuery;
    closeDrawers();
    scheduleSpotSearch(commandInput.value);
    renderCommands(commandInput.value);
    if (!palette.open) palette.showModal();
    requestAnimationFrame(() => commandInput.focus());
    if (!searchReady && !searchFailure) hydrateInstrumentSearch();
  }

  document.getElementById("rosCommandTrigger").addEventListener("click", () => openPalette());
  document.getElementById("rosCommandClose").addEventListener("click", () => palette.close());
  commandInput.addEventListener("input", () => {
    scheduleSpotSearch(commandInput.value);
    renderCommands(commandInput.value);
  });
  commandInput.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      moveCommandSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      const buttons = commandResults.querySelectorAll(".ros-command-result");
      const selected = buttons[commandActiveIndex >= 0 ? commandActiveIndex : 0];
      if (selected) {
        event.preventDefault();
        selected.click();
      }
    }
  });
  document.getElementById("rosContextTrigger").addEventListener("click", () => document.body.classList.contains("ros-context-open") ? closeDrawers() : openContext());
  document.getElementById("rosContextClose").addEventListener("click", closeDrawers);
  document.getElementById("rosUtilityClose").addEventListener("click", closeDrawers);
  document.getElementById("rosDrawerScrim").addEventListener("click", closeDrawers);
  document.getElementById("rosProfileTrigger").addEventListener("click", () => openUtility("more"));
  window.addEventListener("ravenos:accountstate", (event) => renderCustomerAccountState({
    ...customerAccountState,
    authenticated: event.detail?.authenticated === true,
    username: event.detail?.username || "",
  }));
  document.querySelectorAll("[data-ros-utility]").forEach((button) => button.addEventListener("click", () => openUtility(button.dataset.rosUtility)));
  document.getElementById("rosUtilityContent").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ros-utility]");
    if (button) openUtility(button.dataset.rosUtility);
  });
  document.querySelector('[data-ros-context-action="terminal"]').addEventListener("click", () => ravenOSContext.navigate("/terminal/"));
  document.addEventListener("keydown", (event) => {
    const commandKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    const slashKey = event.key === "/" && !event.target.closest("input, textarea, select, [contenteditable='true']");
    if (commandKey || slashKey) {
      event.preventDefault();
      openPalette();
    }
    if (event.key === "Escape" && palette.open) {
      event.preventDefault();
      palette.close();
    } else if (event.key === "Escape") {
      closeDrawers();
    }
  });

  document.addEventListener("ravenos:terminalcontext", (event) => {
    const facts = event.detail || {};
    ravenOSContext.setSelection({
      subject: facts.subject,
      timeframe: facts.timeHorizon || ravenOSContext.getState().timeframe,
      workspace: facts.workspace || ravenOSContext.getState().workspace,
      detectionId: facts.detectionId || null,
      outcomeId: facts.outcomeId || null,
    });
    setIntelligence(createTerminalIntelligence(facts));
  });
  document.addEventListener("ravenos:priceworkspace", (event) => {
    const price = event.detail || {};
    setCapabilities({
      market: `${RavenDataStateLabels[price.state] || price.state || "Data unavailable"}${price.source ? ` · ${price.source}` : ""}`,
      evidence: price.lineage ? "Evidence linked" : "Evidence pending",
    });
  });

  ravenOSContext.subscribe(renderContext);
  setIntelligence(intelligence);
  setCapabilities(capabilities);
  hydrateInstrumentSearch();
  hydrateCustomerAccountState();
  const api = {
    mounted: true,
    setIntelligence,
    setCapabilities,
    adaptLegacyNarrator: (payload, context = {}) => setIntelligence(adaptLegacyNarrator(payload, { ...context, subject: ravenOSContext.getState().subject })),
    openCommandPalette: openPalette,
    openContext,
    openUtility,
    getIntelligence: () => intelligence,
  };
  window.RavenOSShell = api;
  return api;
}

function autoMount() {
  if (document.body?.dataset?.ravenosShell === "off") return;
  mountRavenOSShell();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
else autoMount();
