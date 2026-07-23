export const TradingViewAdapterVersion = "ravenos.tradingview_symbol_adapter.v1";

const EXACT_SYMBOLS = Object.freeze({
  "equity:us:AAPL": Object.freeze({ symbol: "NASDAQ:AAPL", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/NASDAQ-AAPL/" }),
  "etf:us:SPY": Object.freeze({ symbol: "AMEX:SPY", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/AMEX-SPY/" }),
  "etf:us:QQQ": Object.freeze({ symbol: "NASDAQ:QQQ", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/NASDAQ-QQQ/" }),
  "index:us:SPX": Object.freeze({ symbol: "SP:SPX", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/SP-SPX/" }),
  "index:us:NDX": Object.freeze({ symbol: "NASDAQ:NDX", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/NASDAQ-NDX/" }),
  "fred:DGS2": Object.freeze({ symbol: "TVC:US02Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US02Y/" }),
  "fred:DGS10": Object.freeze({ symbol: "TVC:US10Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US10Y/" }),
  "fred:DFF": Object.freeze({ symbol: "FRED:DFF", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-DFF/" }),
  "fx:EURUSD": Object.freeze({ symbol: "FX_IDC:EURUSD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/EURUSD/" }),
  "future:NYMEX:CL": Object.freeze({ symbol: "NYMEX:CL1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/NYMEX-CL1!/" }),
});

const SYMBOL_PATTERN = /^[A-Z0-9_!.-]{1,24}:[A-Z0-9_!.-]{1,32}$/;
const LISTED_ENTITY_PATTERN = /^(equity|etf):us:([A-Z0-9._-]{1,24})$/;
const EXACT_LISTING_VENUES = Object.freeze({
  nasdaq: "NASDAQ",
  nyse: "NYSE",
  "nyse-arca": "AMEX",
  amex: "AMEX",
  "cboe-bzx": "CBOE",
  cboe: "CBOE",
});

function clean(value) {
  return String(value || "").trim();
}

function dynamicExactListing(entity = {}, exactInstrument = null) {
  const entityId = clean(entity.entity_id);
  const entityMatch = LISTED_ENTITY_PATTERN.exec(entityId);
  if (!entityMatch || !exactInstrument || typeof exactInstrument !== "object") return null;
  const entityKind = entityMatch[1];
  const entitySymbol = entityMatch[2];
  const instrumentSymbol = clean(exactInstrument.symbol).toUpperCase();
  const instrumentType = clean(exactInstrument.instrument_type).toLowerCase();
  const instrumentId = clean(exactInstrument.instrument_id).toLowerCase();
  const venue = clean(exactInstrument.venue).toLowerCase();
  const exchange = EXACT_LISTING_VENUES[venue];
  if (
    exactInstrument.schema_version !== "ravenos.instrument.v1"
    || exactInstrument.identity_scope !== "exact_instrument"
    || instrumentSymbol !== entitySymbol
    || instrumentType !== entityKind
    || !instrumentId.startsWith(`${entityKind}:${venue}:`)
    || instrumentId.split(":").at(-1) !== instrumentSymbol.toLowerCase()
    || !exchange
  ) return null;
  const symbol = `${exchange}:${instrumentSymbol}`;
  if (!SYMBOL_PATTERN.test(symbol)) return null;
  return Object.freeze({
    symbol,
    timing: "Timing shown in chart",
    session: "U.S. listed market",
    href: `https://www.tradingview.com/symbols/${exchange}-${encodeURIComponent(instrumentSymbol)}/`,
  });
}

export function resolveTradingViewChart(entity = {}, { exactInstrument = null } = {}) {
  const entityId = clean(entity.entity_id);
  const entry = EXACT_SYMBOLS[entityId] || dynamicExactListing(entity, exactInstrument);
  if (!entry || !SYMBOL_PATTERN.test(entry.symbol)) return null;
  const canonicalSymbol = clean(entity.symbol || entity.canonical_symbol || entity.display_symbol).toUpperCase();
  const expectedSymbol = entityId.split(":").at(-1)?.toUpperCase() || "";
  if (canonicalSymbol && expectedSymbol && canonicalSymbol !== expectedSymbol) return null;
  return Object.freeze({
    schema_version: TradingViewAdapterVersion,
    entity_id: entityId,
    tradingview_symbol: entry.symbol,
    timing: entry.timing,
    session: entry.session,
    attribution: "Chart by TradingView",
    attribution_url: entry.href,
    visual_context_only: true,
  });
}

export function resolveTradingViewSymbol(symbol = "") {
  const requested = clean(symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(requested)) return null;
  const match = Object.entries(EXACT_SYMBOLS).find(([, entry]) => entry.symbol === requested);
  if (!match) return null;
  return Object.freeze({ entity_id: match[0], ...match[1] });
}

export function mountTradingViewChart(host, entity, { interval = "60", exactInstrument = null } = {}) {
  if (!(host instanceof HTMLElement)) return null;
  const resolved = resolveTradingViewChart(entity, { exactInstrument });
  if (!resolved) return null;
  const frame = document.createElement("iframe");
  const safeInterval = /^(?:1|3|5|15|30|60|120|240|D|W)$/.test(clean(interval)) ? clean(interval) : "60";
  const config = {
    autosize: true,
    symbol: resolved.tradingview_symbol,
    interval: safeInterval,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    backgroundColor: "rgba(8, 12, 19, 1)",
    gridColor: "rgba(255, 255, 255, 0.04)",
    hide_top_toolbar: false,
    hide_legend: false,
    save_image: false,
    calendar: false,
    support_host: "https://www.tradingview.com",
  };
  frame.className = "atlas-tv-frame";
  frame.src = `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
  frame.title = `${clean(entity.name) || clean(entity.symbol)} market chart`; 
  frame.loading = "eager";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.setAttribute("allow", "fullscreen");
  host.append(frame);
  return resolved;
}

export const TradingViewExactSymbols = EXACT_SYMBOLS;
export const TradingViewExactListingVenues = EXACT_LISTING_VENUES;
