export const RAVENOS_CONTEXT_SCHEMA = "ravenos.context.v2";
export const RAVENOS_CONTEXT_STORAGE_KEY = "ravenos:selected-context:v2";
const LEGACY_CONTEXT_STORAGE_KEY = "ravenos:selected-context:v1";

const QUERY_FIELDS = Object.freeze({
  asset: ["subject", "label"],
  instrument_id: ["subject", "id"],
  subject_id: ["subject", "id"],
  subject_type: ["subject", "type"],
  instrument_type: ["subject", "instrumentType"],
  asset_class: ["subject", "assetClass"],
  identity_scope: ["subject", "identityScope"],
  chain: ["subject", "chain"],
  venue: ["subject", "venue"],
  market: ["subject", "marketType"],
  quote: ["subject", "quoteAsset"],
  settlement: ["subject", "settlementAsset"],
  cash: ["subject", "preferredCashAsset"],
  numeraire: ["subject", "economicNumeraire"],
  timeframe: ["timeframe"],
  workspace: ["workspace"],
  detection: ["detectionId"],
  outcome: ["outcomeId"],
  wallet: ["walletId"],
});

function clean(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function defaultContext() {
  return {
    schemaVersion: RAVENOS_CONTEXT_SCHEMA,
    subject: {
      id: "unselected",
      type: "market",
      label: "No market selected",
      symbol: "",
      assetClass: "unknown",
      instrumentType: "unknown",
      identityScope: "unselected",
      chain: "all",
      venue: "all",
      marketType: "all",
      quoteAsset: "",
      settlementAsset: "",
      preferredCashAsset: "USDC",
      economicNumeraire: "USDC",
      capabilities: {},
    },
    timeframe: "1h",
    workspace: "market-monitor",
    detectionId: null,
    outcomeId: null,
    walletId: null,
    history: [],
    updatedAt: null,
  };
}

export function normalizeInstrumentSubject(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const label = clean(row.label || row.symbol || row.id, "No market selected");
  const instrumentType = clean(row.instrumentType || row.instrument_type || row.marketType || row.market_type, "unknown").toLowerCase();
  const assetClass = clean(row.assetClass || row.asset_class, ["perp", "perpetual", "spot", "token", "pool"].includes(instrumentType) ? "crypto" : "unknown").toLowerCase();
  return {
    id: clean(row.instrumentId || row.instrument_id || row.id || row.address || row.symbol || label, "unselected"),
    type: clean(row.type, "market").toLowerCase(),
    label,
    symbol: clean(row.symbol || row.label),
    assetClass,
    instrumentType,
    identityScope: clean(row.identityScope || row.identity_scope, instrumentType === "exact_pool" || instrumentType === "pool" ? "exact_pool" : instrumentType === "token" ? "token_aggregate" : row.id || row.instrument_id ? "exact_instrument" : "unselected").toLowerCase(),
    chain: clean(row.chain, "all").toLowerCase(),
    venue: clean(row.venue, "all").toLowerCase(),
    marketType: clean(row.marketType || row.market_type, "all").toLowerCase(),
    quoteAsset: clean(row.quoteAsset?.symbol || row.quote_asset?.symbol || row.quoteAsset || row.quote_asset || row.quote_asset_symbol).toUpperCase(),
    settlementAsset: clean(row.settlementAsset?.symbol || row.settlement_asset?.symbol || row.settlementAsset || row.settlement_asset || row.settlement_asset_symbol).toUpperCase(),
    preferredCashAsset: clean(row.preferredCashAsset?.symbol || row.preferred_cash_asset?.symbol || row.preferredCashAsset || row.preferred_cash_asset || row.preferred_cash_asset_symbol, assetClass === "crypto" ? "USDC" : "USD").toUpperCase(),
    economicNumeraire: clean(row.economicNumeraire || row.economic_numeraire, assetClass === "crypto" ? "USDC" : "USD").toUpperCase(),
    capabilities: row.capabilities && typeof row.capabilities === "object"
      ? Object.fromEntries(Object.entries(row.capabilities).map(([key, enabled]) => [key, Boolean(enabled)]))
      : {},
  };
}

export function normalizeContext(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const base = defaultContext();
  return {
    ...base,
    ...row,
    schemaVersion: RAVENOS_CONTEXT_SCHEMA,
    subject: normalizeInstrumentSubject(row.subject || base.subject),
    timeframe: clean(row.timeframe, base.timeframe),
    workspace: clean(row.workspace, base.workspace),
    detectionId: clean(row.detectionId, "") || null,
    outcomeId: clean(row.outcomeId, "") || null,
    walletId: clean(row.walletId, "") || null,
    history: Array.isArray(row.history) ? row.history.slice(0, 12) : [],
    updatedAt: row.updatedAt || null,
  };
}

function setPath(target, path, value) {
  if (path.length === 1) target[path[0]] = value;
  else target[path[0]][path[1]] = value;
}

export function contextFromSearch(search = "", seed = {}) {
  const context = normalizeContext(seed);
  const params = new URLSearchParams(search || "");
  for (const [query, path] of Object.entries(QUERY_FIELDS)) {
    const value = params.get(query);
    if (value) setPath(context, path, value);
  }
  context.subject = normalizeInstrumentSubject(context.subject);
  return context;
}

export function contextSearchParams(contextValue, options = {}) {
  const context = normalizeContext(contextValue);
  const params = new URLSearchParams(options.search || "");
  const values = {
    asset: context.subject.label === "No market selected" ? "" : context.subject.label,
    instrument_id: context.subject.id === "unselected" ? "" : context.subject.id,
    subject_id: context.subject.id === "unselected" ? "" : context.subject.id,
    subject_type: context.subject.type,
    instrument_type: context.subject.instrumentType === "unknown" ? "" : context.subject.instrumentType,
    asset_class: context.subject.assetClass === "unknown" ? "" : context.subject.assetClass,
    identity_scope: context.subject.identityScope === "unselected" ? "" : context.subject.identityScope,
    chain: context.subject.chain === "all" ? "" : context.subject.chain,
    venue: context.subject.venue === "all" ? "" : context.subject.venue,
    market: context.subject.marketType === "all" ? "" : context.subject.marketType,
    quote: context.subject.quoteAsset,
    settlement: context.subject.settlementAsset,
    cash: context.subject.preferredCashAsset,
    numeraire: context.subject.economicNumeraire,
    timeframe: context.timeframe,
    workspace: context.workspace,
    detection: context.detectionId || "",
    outcome: context.outcomeId || "",
    wallet: context.walletId || "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

const SAVED_WORKSPACE_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
const SAVED_WORKSPACE_INDICATORS = new Set(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const SAVED_WORKSPACE_RAVEN_OVERLAYS = new Set(["structure", "pressure", "participation", "replay", "risk", "pressure-zone", "history-window", "breadth-line", "compression-band", "regime-marker", "liquidity-zone", "participant-shift"]);
const SAVED_WORKSPACE_DENSITIES = new Set(["compact", "comfortable"]);
const SAVED_WORKSPACE_PANELS = new Set(["chart", "raven", "book", "trade", "account"]);

function allowlistedCsv(values, allowlist) {
  const source = Array.isArray(values) ? values : String(values || "").split(",");
  return [...new Set(source.map((value) => String(value || "").trim()).filter((value) => allowlist.has(value)))];
}

export function savedMonitorHandoffHref(subjectValue = {}, workspaceValue = {}) {
  const subject = normalizeInstrumentSubject(subjectValue);
  const id = String(subject.id || "").trim();
  const exactIdentity = /^([a-z0-9-]+):pool:[^:]+$/.test(id)
    || /^hyperliquid:perp:[A-Za-z0-9._-]+$/.test(id)
    || /^(equity|etf):[a-z0-9.-]+:[a-z0-9.-]+$/i.test(id);
  if (!exactIdentity) return "";
  const url = new URL("https://app.ravenos.xyz/monitor/");
  url.searchParams.set("action", "save");
  url.searchParams.set("instrument_id", id);
  const values = {
    instrument_type: subject.instrumentType,
    identity_scope: subject.identityScope,
    asset_class: subject.assetClass,
    chain: subject.chain,
    venue: subject.venue,
    market: subject.marketType,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value && !["all", "unknown", "unselected"].includes(String(value).toLowerCase())) url.searchParams.set(key, value);
  }
  const timeframe = SAVED_WORKSPACE_TIMEFRAMES.has(workspaceValue.timeframe) ? workspaceValue.timeframe : "1h";
  const density = SAVED_WORKSPACE_DENSITIES.has(workspaceValue.density) ? workspaceValue.density : "comfortable";
  const panel = SAVED_WORKSPACE_PANELS.has(workspaceValue.selectedPanel || workspaceValue.selected_panel)
    ? (workspaceValue.selectedPanel || workspaceValue.selected_panel)
    : "chart";
  const indicators = allowlistedCsv(workspaceValue.indicators, SAVED_WORKSPACE_INDICATORS);
  const overlays = allowlistedCsv(workspaceValue.ravenOverlays || workspaceValue.raven_overlays, SAVED_WORKSPACE_RAVEN_OVERLAYS);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("indicators", indicators.join(","));
  if (overlays.length) url.searchParams.set("raven_overlays", overlays.join(","));
  url.searchParams.set("density", density);
  url.searchParams.set("panel", panel);
  return url.toString();
}

export function savedMonitorHandoffFromTerminalHref(href, workspace = {}) {
  try {
    const terminal = new URL(href, "https://ravenos.xyz");
    if (terminal.origin !== "https://ravenos.xyz" || terminal.pathname !== "/terminal/") return "";
    const context = contextFromSearch(terminal.search);
    return savedMonitorHandoffHref(context.subject, {
      timeframe: workspace.timeframe || context.timeframe,
      indicators: workspace.indicators,
      ravenOverlays: workspace.ravenOverlays || terminal.searchParams.get("raven_overlays"),
      density: workspace.density,
      selectedPanel: workspace.selectedPanel,
    });
  } catch {
    return "";
  }
}

function sameSubject(a, b) {
  return a?.id === b?.id && a?.type === b?.type && a?.chain === b?.chain && a?.venue === b?.venue;
}

export function createRavenOSContextStore(options = {}) {
  const windowRef = options.windowRef || (typeof window !== "undefined" ? window : null);
  const storageKey = options.storageKey || RAVENOS_CONTEXT_STORAGE_KEY;
  const listeners = new Set();
  let stored = {};
  if (windowRef?.localStorage) {
    try {
      const current = windowRef.localStorage.getItem(storageKey);
      const legacy = storageKey === RAVENOS_CONTEXT_STORAGE_KEY ? windowRef.localStorage.getItem(LEGACY_CONTEXT_STORAGE_KEY) : null;
      stored = JSON.parse(current || legacy || "{}");
    } catch { stored = {}; }
  }
  let state = contextFromSearch(windowRef?.location?.search || "", stored);

  function persist() {
    if (!windowRef?.localStorage) return;
    try { windowRef.localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage can be unavailable */ }
  }

  function notify() {
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot);
    windowRef?.document?.dispatchEvent(new windowRef.CustomEvent("ravenos:contextchange", { detail: snapshot }));
  }

  function updateUrl(mode = "replace") {
    if (!windowRef?.history || !windowRef?.location) return;
    const params = contextSearchParams(state, { search: windowRef.location.search });
    const query = params.toString();
    const url = `${windowRef.location.pathname}${query ? `?${query}` : ""}${windowRef.location.hash || ""}`;
    const method = mode === "push" ? "pushState" : "replaceState";
    windowRef.history[method]({ ravenosContext: true }, "", url);
  }

  function getState() {
    return normalizeContext(JSON.parse(JSON.stringify(state)));
  }

  function setContext(patch = {}, options = {}) {
    const previous = state;
    const next = normalizeContext({
      ...state,
      ...patch,
      subject: patch.subject ? { ...state.subject, ...patch.subject } : state.subject,
      history: state.history,
      updatedAt: new Date().toISOString(),
    });
    if (!sameSubject(previous.subject, next.subject) && previous.subject.id !== "unselected") {
      next.history = [
        { subject: previous.subject, timeframe: previous.timeframe, workspace: previous.workspace, leftAt: next.updatedAt },
        ...state.history.filter((item) => item?.subject?.id !== previous.subject.id),
      ].slice(0, 12);
    }
    state = next;
    persist();
    if (options.updateUrl !== false) updateUrl(options.historyMode || "replace");
    notify();
    return getState();
  }

  function clearSelection(options = {}) {
    const empty = defaultContext();
    return setContext({
      subject: empty.subject,
      detectionId: null,
      outcomeId: null,
    }, options);
  }

  function decorateHref(href) {
    if (!href || !windowRef?.location) return href;
    const target = new URL(href, windowRef.location.origin);
    if (target.origin !== windowRef.location.origin) return href;
    const explicit = new URLSearchParams(target.search);
    const contextual = contextSearchParams(state, { search: target.search });
    for (const [key, value] of explicit.entries()) contextual.set(key, value);
    target.search = contextual.toString();
    return `${target.pathname}${target.search}${target.hash}`;
  }

  function navigate(href) {
    if (!windowRef?.location) return;
    windowRef.location.assign(decorateHref(href));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function handleStorage(event) {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      state = normalizeContext(JSON.parse(event.newValue));
      notify();
    } catch { /* ignore malformed cross-tab state */ }
  }

  windowRef?.addEventListener?.("storage", handleStorage);
  persist();
  return { getState, setContext, setSelection: setContext, clearSelection, subscribe, decorateHref, navigate, updateUrl };
}

export const ravenOSContext = createRavenOSContextStore();

if (typeof window !== "undefined") {
  window.RavenOSContext = ravenOSContext;
}
