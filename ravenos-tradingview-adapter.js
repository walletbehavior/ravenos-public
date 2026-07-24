export const TradingViewAdapterVersion = "ravenos.tradingview_symbol_adapter.v2";

const EXACT_SYMBOLS = Object.freeze({
  "equity:us:AAPL": Object.freeze({ symbol: "NASDAQ:AAPL", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/NASDAQ-AAPL/" }),
  "etf:us:SPY": Object.freeze({ symbol: "AMEX:SPY", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/AMEX-SPY/" }),
  "etf:us:QQQ": Object.freeze({ symbol: "NASDAQ:QQQ", timing: "Timing shown in chart", session: "U.S. equities", href: "https://www.tradingview.com/symbols/NASDAQ-QQQ/" }),
  "index:us:SPX": Object.freeze({ symbol: "SP:SPX", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/SP-SPX/" }),
  "index:us:NDX": Object.freeze({ symbol: "NASDAQ:NDX", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/NASDAQ-NDX/" }),
  "index:us:DJI": Object.freeze({ symbol: "DJ:DJI", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/DJ-DJI/" }),
  "index:us:RUT": Object.freeze({ symbol: "CBOEFTSE:RUT", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/CBOEFTSE-RUT/" }),
  "index:us:VIX": Object.freeze({ symbol: "CBOE:VIX", timing: "Timing shown in chart", session: "U.S. volatility index", href: "https://www.tradingview.com/symbols/CBOE-VIX/" }),
  "index:us:DXY": Object.freeze({ symbol: "TVC:DXY", timing: "Timing shown in chart", session: "U.S. dollar index", href: "https://www.tradingview.com/symbols/TVC-DXY/" }),
  "index:us:SOX": Object.freeze({ symbol: "NASDAQ:SOX", timing: "Timing shown in chart", session: "U.S. semiconductor index", href: "https://www.tradingview.com/symbols/NASDAQ-SOX/" }),
  "index:us:NYA": Object.freeze({ symbol: "NYSE:NYA", timing: "Timing shown in chart", session: "U.S. broad-market index", href: "https://www.tradingview.com/symbols/NYSE-NYA/" }),
  "index:us:OEX": Object.freeze({ symbol: "CBOE:OEX", timing: "Timing shown in chart", session: "U.S. index", href: "https://www.tradingview.com/symbols/CBOE-OEX/" }),
  "fred:DGS2": Object.freeze({ symbol: "TVC:US02Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US02Y/" }),
  "fred:DGS5": Object.freeze({ symbol: "TVC:US05Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US05Y/" }),
  "fred:DGS10": Object.freeze({ symbol: "TVC:US10Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US10Y/" }),
  "fred:DGS30": Object.freeze({ symbol: "TVC:US30Y", timing: "Timing shown in chart", session: "U.S. rates", href: "https://www.tradingview.com/symbols/TVC-US30Y/" }),
  "fred:DFF": Object.freeze({ symbol: "FRED:DFF", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-DFF/" }),
  "fred:SOFR": Object.freeze({ symbol: "FRED:SOFR", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-SOFR/" }),
  "fred:T10Y2Y": Object.freeze({ symbol: "FRED:T10Y2Y", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-T10Y2Y/" }),
  "fred:T10Y3M": Object.freeze({ symbol: "FRED:T10Y3M", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-T10Y3M/" }),
  "fred:DFII10": Object.freeze({ symbol: "FRED:DFII10", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-DFII10/" }),
  "fred:BAMLH0A0HYM2": Object.freeze({ symbol: "FRED:BAMLH0A0HYM2", timing: "Periodic macro series", session: "Federal Reserve series", href: "https://www.tradingview.com/symbols/FRED-BAMLH0A0HYM2/" }),
  "fx:EURUSD": Object.freeze({ symbol: "FX_IDC:EURUSD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/EURUSD/" }),
  "fx:USDJPY": Object.freeze({ symbol: "FX_IDC:USDJPY", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/USDJPY/" }),
  "fx:GBPUSD": Object.freeze({ symbol: "FX_IDC:GBPUSD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/GBPUSD/" }),
  "fx:AUDUSD": Object.freeze({ symbol: "FX_IDC:AUDUSD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/AUDUSD/" }),
  "fx:USDCAD": Object.freeze({ symbol: "FX_IDC:USDCAD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/USDCAD/" }),
  "fx:USDCHF": Object.freeze({ symbol: "FX_IDC:USDCHF", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/USDCHF/" }),
  "fx:NZDUSD": Object.freeze({ symbol: "FX_IDC:NZDUSD", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/NZDUSD/" }),
  "fx:EURJPY": Object.freeze({ symbol: "FX_IDC:EURJPY", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/EURJPY/" }),
  "fx:EURGBP": Object.freeze({ symbol: "FX_IDC:EURGBP", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/EURGBP/" }),
  "fx:USDCNH": Object.freeze({ symbol: "FX_IDC:USDCNH", timing: "Timing shown in chart", session: "Global FX", href: "https://www.tradingview.com/symbols/USDCNH/" }),
  "future:CME:ES": Object.freeze({ symbol: "CME_MINI:ES1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/CME_MINI-ES1!/" }),
  "future:CME:NQ": Object.freeze({ symbol: "CME_MINI:NQ1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/CME_MINI-NQ1!/" }),
  "future:CBOT:YM": Object.freeze({ symbol: "CBOT_MINI:YM1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/CBOT_MINI-YM1!/" }),
  "future:CME:RTY": Object.freeze({ symbol: "CME_MINI:RTY1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/CME_MINI-RTY1!/" }),
  "future:NYMEX:CL": Object.freeze({ symbol: "NYMEX:CL1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/NYMEX-CL1!/" }),
  "future:NYMEX:NG": Object.freeze({ symbol: "NYMEX:NG1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/NYMEX-NG1!/" }),
  "future:COMEX:GC": Object.freeze({ symbol: "COMEX:GC1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/COMEX-GC1!/" }),
  "future:COMEX:SI": Object.freeze({ symbol: "COMEX:SI1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/COMEX-SI1!/" }),
  "future:COMEX:HG": Object.freeze({ symbol: "COMEX:HG1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/COMEX-HG1!/" }),
  "future:CBOT:ZN": Object.freeze({ symbol: "CBOT:ZN1!", timing: "Timing shown in chart", session: "Continuous front contract", href: "https://www.tradingview.com/symbols/CBOT-ZN1!/" }),
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
  const entry = exactInstrument
    ? dynamicExactListing(entity, exactInstrument)
    : EXACT_SYMBOLS[entityId];
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
    price_axis: Object.freeze({
      side: "right",
      auto_scale: "visible_range",
      precision: "instrument_native",
    }),
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
