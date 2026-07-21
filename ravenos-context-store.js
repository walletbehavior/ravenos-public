export const RAVENOS_CONTEXT_SCHEMA = "ravenos.context.v1";
export const RAVENOS_CONTEXT_STORAGE_KEY = "ravenos:selected-context:v1";

const QUERY_FIELDS = Object.freeze({
  asset: ["subject", "label"],
  subject_id: ["subject", "id"],
  subject_type: ["subject", "type"],
  chain: ["subject", "chain"],
  venue: ["subject", "venue"],
  market: ["subject", "marketType"],
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
      chain: "all",
      venue: "all",
      marketType: "all",
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

function normalizeSubject(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const label = clean(row.label || row.symbol || row.id, "No market selected");
  return {
    id: clean(row.id || row.address || row.symbol || label, "unselected"),
    type: clean(row.type, "market").toLowerCase(),
    label,
    symbol: clean(row.symbol || row.label),
    chain: clean(row.chain, "all").toLowerCase(),
    venue: clean(row.venue, "all").toLowerCase(),
    marketType: clean(row.marketType || row.market_type, "all").toLowerCase(),
  };
}

export function normalizeContext(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const base = defaultContext();
  return {
    ...base,
    ...row,
    schemaVersion: RAVENOS_CONTEXT_SCHEMA,
    subject: normalizeSubject(row.subject || base.subject),
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
  context.subject = normalizeSubject(context.subject);
  return context;
}

export function contextSearchParams(contextValue, options = {}) {
  const context = normalizeContext(contextValue);
  const params = new URLSearchParams(options.search || "");
  const values = {
    asset: context.subject.label === "No market selected" ? "" : context.subject.label,
    subject_id: context.subject.id === "unselected" ? "" : context.subject.id,
    subject_type: context.subject.type,
    chain: context.subject.chain === "all" ? "" : context.subject.chain,
    venue: context.subject.venue === "all" ? "" : context.subject.venue,
    market: context.subject.marketType === "all" ? "" : context.subject.marketType,
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

function sameSubject(a, b) {
  return a?.id === b?.id && a?.type === b?.type && a?.chain === b?.chain && a?.venue === b?.venue;
}

export function createRavenOSContextStore(options = {}) {
  const windowRef = options.windowRef || (typeof window !== "undefined" ? window : null);
  const storageKey = options.storageKey || RAVENOS_CONTEXT_STORAGE_KEY;
  const listeners = new Set();
  let stored = {};
  if (windowRef?.localStorage) {
    try { stored = JSON.parse(windowRef.localStorage.getItem(storageKey) || "{}"); } catch { stored = {}; }
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
  return { getState, setContext, setSelection: setContext, subscribe, decorateHref, navigate, updateUrl };
}

export const ravenOSContext = createRavenOSContextStore();

if (typeof window !== "undefined") {
  window.RavenOSContext = ravenOSContext;
}
