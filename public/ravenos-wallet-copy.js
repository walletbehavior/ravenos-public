const API = "/api/v1/wallet-copy";
import { getPreference, setPreference } from "./ravenos-preferences.js";
import { readAccountSession } from './ravenos-account-session.js';
import { currentTradingSettings, loadTradingSettings, openTradingSettings, subscribeTradingSettings } from './ravenos-trading-settings.js';

const page = document.querySelector(".copy-page");
let embeddedActive = page?.dataset.embedded !== 'true';
let embeddedUrl = page?.dataset.embeddedUrl || location.href;
const walletLocationHref = () => page?.dataset.embedded === 'true' ? embeddedUrl : location.href;
let walletBootPromise = null;
const signIn = document.getElementById("copySignIn");
const unavailable = document.getElementById("copyUnavailable");
const workspace = document.getElementById("copyWorkspace");
const profileNode = document.getElementById("copyProfile");
const policyNode = document.getElementById("copyPolicy");
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_WRAPPED_NATIVE = "So11111111111111111111111111111111111111112";

const state = {
  csrf: "",
  session_expired: false,
  activation: {},
  product: {},
  access: { tier: "free", advanced_wallet_intelligence: false },
  inspect_chain: "solana",
  profile_request: 0,
  activity_request: 0,
  saved_request: 0,
  saved_loaded: false,
  policy_source: null,
  address: "",
  source_wallet_id: null,
  profile: null,
  deep_history: null,
  deep_poll_token: 0,
  deep_poll_attempts: 0,
  deep_poll_timer: null,
  events: [],
  activity: { filter: "all", next_cursor: null, has_more: false, provider_has_more: false, matching_event_count: 0, loading: false, on_demand_only: false },
  on_demand_events: [],
  watches: [],
  decisions: [],
  exit_decisions: [],
  positions: [],
  saved: [],
  screener_request: 0,
  screener: { chain: getPreference("walletChain", "all"), page: 1, total_pages: 0, total: 0, wallets: [], preset: null, view: null },
  groups: { selected: null, cards: new Map() },
  robinhood_intelligence: { activity: [] },
};

const FREE_SCREENER_SORTS = new Set(["last_trade_desc", "trade_count_desc", "active_days_desc"]);

function applyAccess(access = {}) {
  if (state.session_expired) return;
  state.access = {
    tier: access.advanced_wallet_intelligence === true ? "pro" : "free",
    advanced_wallet_intelligence: access.advanced_wallet_intelligence === true,
  };
  page.dataset.accessTier = state.access.tier;
  const pro = state.access.advanced_wallet_intelligence;
  setText("copyAccessLabel", pro ? "Raven Pro active" : "Included with every account");
  setText("copyAccessHeadline", pro ? "Full Wallet Intelligence + Raven Copy" : "Wallet lookup + Raven Copy");
  setText("copyAccessDetail", pro
    ? "Wallet profiles, trading history and saved lists are unlocked."
    : "Headline wallet screening and Raven Copy are free. Advanced wallet profiles require Pro.");
  setText("copyScreenerHeadline", pro ? "Find your next wallet to follow." : "Find active wallets.");
  if (!pro) {
    state.screener.preset = null;
    document.querySelectorAll("[data-screen-preset]").forEach((button) => button.setAttribute("aria-pressed", "false"));
    const sort = document.getElementById("copyScreenSort");
    [...sort.options].forEach((option) => { option.hidden = !FREE_SCREENER_SORTS.has(option.value); });
    if (!FREE_SCREENER_SORTS.has(sort.value)) sort.value = "last_trade_desc";
    document.getElementById("copyScreenEvidence").value = "any";
  }
}

function text(value, fallback = "—") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value ?? "");
}

function walletAddress(value) { return text(value, "Wallet"); }

function shortAddress(value) {
  const address = text(value, "Wallet");
  return address;
}

function chainLabel(chain) {
  return ({
    all: "All indexed chains",
    solana: "Solana",
    robinhood: "Robinhood Chain",
    bsc: "BNB Chain",
    base: "Base",
    ethereum: "Ethereum",
  })[chain] || "Unsupported chain";
}

const LOCAL_ACTIVITY_FILTERS = Object.freeze({
  all: null,
  trades: new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP", "SPLIT_ROUTE_SWAP"]),
  buys: new Set(["SWAP_BUY"]),
  sells: new Set(["SWAP_SELL"]),
  transfers: new Set(["TRANSFER_IN", "TRANSFER_OUT", "AIRDROP", "INTERNAL_ACCOUNT_MOVEMENT"]),
  unresolved: new Set(["AMBIGUOUS", "UNSUPPORTED", "FAILED_TRANSACTION"]),
});

function robinhoodTerminalHref(tokenAddress) {
  const address = String(tokenAddress || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
  const url = new URL("/terminal/", location.origin);
  url.searchParams.set("chain", "robinhood");
  url.searchParams.set("chain_id", "4663");
  url.searchParams.set("market", "spot");
  url.searchParams.set("token_address", address);
  url.searchParams.set("asset", address);
  return `${url.pathname}${url.search}`;
}

function money(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(number) < 10 ? 2 : 0 }).format(number);
}

function pct(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : "Unavailable";
}

function signedPct(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(2)}%` : "Unavailable";
}

function realizedPerformance(performance, { precise = false } = {}) {
  const values = [];
  if (performance.realized_pnl_usdc !== null && performance.realized_pnl_usdc !== undefined) {
    const value = precise ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(performance.realized_pnl_usdc)) : money(performance.realized_pnl_usdc);
    values.push(`${Number(performance.realized_pnl_usdc) >= 0 ? "+" : ""}${value}`);
  }
  if (performance.realized_pnl_sol !== null && performance.realized_pnl_sol !== undefined && Number.isFinite(Number(performance.realized_pnl_sol))) {
    const amount = Number(performance.realized_pnl_sol);
    values.push(`${amount >= 0 ? "+" : ""}${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`);
  }
  return values.length ? `${values.join(" · ")} realized` : "Insufficient evidence";
}

function basisNotional(behavior, field) {
  const values = [];
  const usdc = behavior?.buy_notional_by_basis?.usdc?.[field];
  const sol = behavior?.buy_notional_by_basis?.sol?.[field];
  if (usdc !== null && usdc !== undefined) values.push(money(usdc));
  if (sol !== null && sol !== undefined && Number.isFinite(Number(sol))) values.push(`${Number(sol).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`);
  return values.length ? values.join(" · ") : "Unavailable";
}

function bpsAsPercent(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number) ? `${(number / 100).toFixed(2)}%` : "Unavailable";
}

function when(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function duration(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unavailable";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
}

function humanDuration(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "Unavailable";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Number((seconds / 3_600).toFixed(seconds < 7_200 ? 1 : 0))}h`;
  return `${Number((seconds / 86_400).toFixed(seconds < 172_800 ? 1 : 0))}d`;
}

function decimal(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}` : "Unavailable";
}

function realizedPair(pair) {
  return realizedPerformance({ realized_pnl_usdc: pair?.usdc, realized_pnl_sol: pair?.sol });
}

function readable(value) {
  return text(value).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(number);
}

function exactAssetAmount(endpoint) {
  if (!endpoint) return "Unavailable";
  if (!/^-?\d+$/.test(String(endpoint.amount_base_units ?? ""))) {
    const raw = String(endpoint.delta_raw ?? "");
    if (!/^-?\d+$/.test(raw)) return "Unavailable";
    const identity = endpoint.symbol || endpoint.contract || endpoint.asset_id;
    return `${raw} raw units · ${shortAddress(identity)}`;
  }
  const decimals = Number(endpoint.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "Unavailable";
  let units = BigInt(endpoint.amount_base_units);
  const sign = units < 0n ? "-" : "";
  if (units < 0n) units = -units;
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 6);
  const identity = String(endpoint.mint || endpoint.contract || endpoint.asset_id || "");
  const asset = endpoint.symbol || state.profile?.token_metadata?.rows?.find(token => token.mint === identity)?.symbol
    || (identity === SOLANA_USDC ? "USDC" : new Set([SOLANA_WRAPPED_NATIVE, "native_sol"]).has(identity) ? "SOL" : shortAddress(identity));
  return `${sign}${whole}${fraction ? `.${fraction}` : ""} ${asset}`;
}

async function api(url, init = {}) {
  const headers = { accept: "application/json", ...(init.headers || {}) };
  if (init.method && init.method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-ravenos-csrf"] = state.csrf;
  }
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) recoverWalletSession();
    return { response, payload };
  } catch {
    return { response: { ok: false, status: 0 }, payload: { error: "network_unavailable" } };
  }
}

function walletReturnTo() {
  const url = new URL(walletLocationHref());
  const address = state.address || document.getElementById("copyWalletAddress").value.trim();
  if (address) {
    url.searchParams.set("wallet", address.slice(0, 44));
    // Inspection and screener can intentionally be on different chains.
    url.searchParams.set("inspect_chain", state.inspect_chain);
  }
  return `/account/copy/${url.search}`;
}

function recoverWalletSession() {
  document.querySelectorAll('input[name="return_to"]').forEach(input => { input.value = walletReturnTo(); });
  if (state.session_expired) return;
  state.session_expired = true;
  state.screener_request += 1;
  state.groups.cards.clear();
  state.csrf = "";
  state.deep_poll_token += 1;
  clearTimeout(state.deep_poll_timer);
  state.access = { tier: "free", advanced_wallet_intelligence: false };
  page.dataset.accessTier = "free";
  page.dataset.copyState = "signed-out";
  workspace.hidden = true;
  profileNode.hidden = true;
  policyNode.hidden = true;
  unavailable.hidden = true;
  signIn.hidden = false;
  setText("copyWorkspaceState", "Sign in again");
  setText("copyWorkspaceIdentity", "Session expired");
  setText("copyAccessLabel", "Sign in required");
  setText("copyAuthStatus", "Your session expired. Sign in again to reopen the selected wallet. Your filters and saved research are preserved.");
  setText("copyAuthWallet", state.address ? `${chainLabel(state.inspect_chain)} · ${state.address}` : "");
  signIn.scrollIntoView({ behavior: "smooth", block: "start" });
}

function inspectionFeedback(button, message) {
  setText("copySearchStatus", message);
  const card = button?.closest(".copy-seen-wallet, .copy-screener-card");
  if (!card) return;
  let status = card.querySelector(".copy-card-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "copy-card-status";
    status.setAttribute("role", "status");
    card.append(status);
  }
  status.textContent = message;
}

async function submitAuthStart(form) {
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById("copyAuthStatus");
  if (button) button.disabled = true;
  if (status) {
    status.dataset.tone = "";
    status.textContent = "Opening secure sign-in…";
  }
  try {
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/v1/auth/start", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => null);
    const target = new URL(payload?.authorization_url || "");
    if (!response.ok || target.protocol !== "https:" || target.hostname !== "api.workos.com") throw new Error("authorization_unavailable");
    window.location.assign(target.toString());
  } catch {
    if (button) button.disabled = false;
    if (status) {
      status.dataset.tone = "error";
      status.textContent = "Secure sign-in could not be opened. Try again.";
    }
  }
}

function bindAuthStartForms() {
  document.querySelectorAll("[data-auth-start]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthStart(form);
  }));
}

function fact(label, value) {
  const row = document.createElement("div");
  const key = document.createElement("dt");
  const content = document.createElement("dd");
  key.textContent = label;
  content.textContent = text(value);
  row.append(key, content);
  return row;
}

function empty(title, detail) {
  const node = document.createElement("div");
  node.className = "copy-empty";
  const strong = document.createElement("strong");
  const copy = document.createElement("p");
  strong.textContent = title;
  copy.textContent = detail;
  node.append(strong, copy);
  return node;
}

function findingItems(items, fallback) {
  const findings = Array.isArray(items) ? items.filter((item) => item && typeof item.label === "string" && item.label.trim()).slice(0, 3) : [];
  return (findings.length ? findings.map((item) => item.label) : [fallback]).map((label) => {
    const row = document.createElement("li");
    row.textContent = label;
    return row;
  });
}

function eventCard(event) {
  const card = document.createElement("article");
  card.className = "copy-event-card";
  card.dataset.activityKind = event.classification?.kind || "UNSUPPORTED";
  const head = document.createElement("header");
  const kind = document.createElement("strong");
  const time = document.createElement("span");
  kind.textContent = readable(event.classification?.kind);
  time.textContent = when(event.chain_evidence?.block_time || event.timing?.raven_received_at);
  head.append(kind, time);
  const details = document.createElement("dl");
  details.append(
    fact("Cost basis", readable(event.economic?.cost_basis_state)),
    fact("Paid", exactAssetAmount(event.economic?.source_asset)),
    fact("Received", exactAssetAmount(event.economic?.destination_asset)),
  );
  const transactionReference = event.chain_evidence?.transaction_reference || event.chain_evidence?.signature;
  const transaction = event.source_wallet?.chain === "solana" ? document.createElement("a") : document.createElement("span");
  transaction.className = "copy-event-transaction";
  if (event.source_wallet?.chain === "solana") {
    transaction.href = `https://solscan.io/tx/${encodeURIComponent(transactionReference || "")}`;
    transaction.target = "_blank";
    transaction.rel = "noopener noreferrer";
    transaction.textContent = `View transaction · ${shortAddress(transactionReference)}`;
  } else {
    transaction.textContent = `Transaction · ${shortAddress(transactionReference)}`;
  }
  card.append(head, details, transaction);
  return card;
}

function renderWalletActivity(activity, { append = false } = {}) {
  const incoming = Array.isArray(activity?.events) ? activity.events : [];
  const filter = String(activity?.filter || state.activity.filter || "all");
  const onDemandOnly = activity?.scope?.on_demand_only === true || state.activity.on_demand_only === true;
  if (onDemandOnly && filter === "all" && incoming.length) state.on_demand_events = [...incoming];
  const prior = append && filter === state.activity.filter ? state.events : [];
  const seen = new Set(prior.map((event) => event.event_id));
  const merged = [...prior, ...incoming.filter((event) => !seen.has(event.event_id))];
  state.events = merged;
  state.activity = {
    filter,
    next_cursor: activity?.pagination?.next_cursor || null,
    has_more: activity?.pagination?.has_more === true,
    provider_has_more: activity?.pagination?.provider_has_more === true,
    matching_event_count: Math.max(0, Number(activity?.pagination?.matching_event_count ?? merged.length)),
    loading: false,
    on_demand_only: onDemandOnly,
  };
  const filterNode = document.getElementById("copyActivityFilter");
  filterNode.value = filter;
  filterNode.disabled = false;
  const host = document.getElementById("copyRecentEvents");
  host.replaceChildren(...(merged.length ? merged.map(eventCard) : [empty("No matching activity", "Unavailable ≠ zero.")]));
  const total = state.activity.matching_event_count;
  setText("copyEventCount", `${merged.length.toLocaleString()} of ${total.toLocaleString()} retained`);
  setText("copyActivityStatus", state.activity.has_more
    ? "Older evidence available."
    : state.activity.provider_has_more
      ? "Bounded provider window shown. More transfers may exist."
    : total
      ? "End of retained index."
      : "No retained evidence matches this filter.");
  const more = document.getElementById("copyActivityMore");
  more.hidden = !state.activity.has_more;
  more.disabled = false;
  more.textContent = "Load older";
}

async function loadWalletActivity({ append = false } = {}) {
  if (!state.source_wallet_id || state.activity.loading) return;
  const filterNode = document.getElementById("copyActivityFilter");
  const filter = filterNode.value || "all";
  if (state.activity.on_demand_only) {
    const allowed = LOCAL_ACTIVITY_FILTERS[filter];
    const events = filter === "other"
      ? state.on_demand_events.filter((event) => !new Set([...LOCAL_ACTIVITY_FILTERS.trades, ...LOCAL_ACTIVITY_FILTERS.transfers, ...LOCAL_ACTIVITY_FILTERS.unresolved]).has(event.classification?.kind))
      : allowed
        ? state.on_demand_events.filter((event) => allowed.has(event.classification?.kind))
        : state.on_demand_events;
    renderWalletActivity({
      filter,
      events,
      pagination: { matching_event_count: events.length, has_more: false, next_cursor: null },
      scope: { on_demand_only: true },
    });
    return;
  }
  const cursor = append && filter === state.activity.filter ? state.activity.next_cursor : null;
  state.activity.loading = true;
  filterNode.disabled = true;
  const more = document.getElementById("copyActivityMore");
  more.disabled = true;
  more.textContent = append ? "Loading…" : "Filtering…";
  setText("copyActivityStatus", append ? "Loading older…" : "Filtering…");
  const params = new URLSearchParams({ filter, limit: "12" });
  if (cursor) params.set("cursor", cursor);
  const sourceId = state.source_wallet_id, profileRequest = state.profile_request, activityRequest = ++state.activity_request;
  const result = await api(`${API}/wallets/${encodeURIComponent(sourceId)}/events?${params}`);
  if (sourceId !== state.source_wallet_id || profileRequest !== state.profile_request || activityRequest !== state.activity_request) return;
  if (!result.response.ok) {
    state.activity.loading = false;
    filterNode.disabled = false;
    more.disabled = false;
    more.textContent = "Try again";
    setText("copyActivityStatus", "Page unavailable. Missing ≠ zero.");
    return;
  }
  renderWalletActivity(result.payload, { append });
}

function renderDeepHistory(history) {
  state.deep_history = history || null;
  const node = document.getElementById("copyDeepHistory");
  const active = history && !new Set(["not_enabled", "not_queued"]).has(history.state);
  node.hidden = !active;
  if (!active) return;
  const signatures = Math.max(0, Number(history.signatures_indexed || 0));
  const maximum = Math.max(1, Number(history.maximum_signatures || 10_000));
  const gaps = Math.max(0, Number(history.unresolved_references || 0));
  const progress = !gaps && (history.state === "complete" || history.state === "bounded_partial")
    ? 100
    : Math.min(99, (signatures / maximum) * 100);
  const labels = {
    queued: [signatures ? "Indexing older activity" : "Deep history queued", "Shared history updates in batches. This page checks Raven’s cache."],
    leased: ["Indexing older activity", "Normalizing provider evidence."],
    retry_wait: ["History retry queued", "Cursor preserved."],
    complete: history.chain && history.chain !== "solana" ? ["30-day indexed window processed", "Receipt-backed activity is saved. Unsupported internal transfers and unknown costs remain excluded."] : ["Provider history exhausted", "Oldest available page reached."],
    bounded_partial: [`${maximum.toLocaleString()}-event window retained`, "Older activity may exist. Stored activity remains available without a fresh provider lookup."],
    dead_letter: ["History needs operator review", "Evidence gap preserved."],
    unavailable: ["Deep history unavailable", "Current evidence remains visible."],
  };
  const [headline, detail] = gaps && history.state === "bounded_partial"
    ? ["History retained with gaps", `${gaps.toLocaleString()} transaction receipts remain unresolved. Verified activity is available; complete cost basis is not established.`]
    : labels[history.state] || ["History state forming", "Evidence boundary preserved."];
  setText("copyDeepHistoryHeadline", headline);
  setText("copyDeepHistoryDetail", gaps && history.state !== "bounded_partial" ? `${detail} ${gaps.toLocaleString()} transaction receipts awaiting verification; other history continues indexing.` : detail);
  const progressNode = document.getElementById("copyDeepHistoryProgress");
  progressNode.value = progress;
  progressNode.textContent = `${Math.round(progress)}%`;
  setText("copyDeepHistoryCount", `${compactNumber(signatures)} transaction references · ${compactNumber(history.transactions_decoded || 0)} decoded · ${compactNumber(history.pages_indexed || 0)} pages`);
}

function deepHistoryPending(history) {
  return new Set(["queued", "leased", "retry_wait"]).has(history?.state);
}

function scheduleDeepHistoryPoll(token) {
  if (!embeddedActive || !state.activation.wallet_screener || !deepHistoryPending(state.deep_history) || !state.source_wallet_id || state.deep_poll_attempts >= 12) return;
  clearTimeout(state.deep_poll_timer);
  const delay = [15_000, 30_000, 60_000][state.deep_poll_attempts] || 120_000;
  state.deep_poll_timer = window.setTimeout(async () => {
    if (!embeddedActive || token !== state.deep_poll_token || !state.source_wallet_id) return;
    if (document.hidden) { scheduleDeepHistoryPoll(token); return; }
    state.deep_poll_attempts += 1;
    const result = await api(`${API}/wallets/${encodeURIComponent(state.source_wallet_id)}`);
    if (token !== state.deep_poll_token) return;
    if (result.response.ok) renderProfile(result.payload, { scroll: false, from_poll: true });
    else scheduleDeepHistoryPoll(token);
  }, delay);
}

function recordTable(headers, rows, emptyLabel) {
  if (!rows.length) return empty(emptyLabel, "Only retained evidence is shown.");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  headers.forEach(label => { const th = document.createElement("th"); th.scope = "col"; th.textContent = label; head.append(th); });
  thead.append(head);
  const body = document.createElement("tbody");
  rows.forEach(values => {
    const row = document.createElement("tr");
    values.forEach((value, index) => {
      const cell = document.createElement("td"); cell.dataset.label = headers[index];
      if (value instanceof Node) cell.append(value); else cell.textContent = text(value);
      row.append(cell);
    });
    body.append(row);
  });
  table.append(thead, body); return table;
}

function recordToken(identity, symbol) {
  const node = document.createElement("div"); node.className = "copy-record-token";
  if (symbol) { const name = document.createElement("strong"); name.textContent = symbol; node.append(name); }
  const contract = document.createElement("code"); contract.textContent = identity || "Identity unavailable"; node.append(contract);
  return node;
}

function recordUsd(value, price = false) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",...(price ? {maximumSignificantDigits:6} : {minimumFractionDigits:2,maximumFractionDigits:Math.abs(Number(value)) < .01 && Number(value) !== 0 ? 8 : 2})}).format(Number(value));
}

function recordPnl(pair) {
  return Object.keys(state.profile?.trading_record?.basis_labels || {usdc:"USDC",sol:"SOL"}).flatMap(basis => {
    const value = pair?.[basis];
    if (value == null || !Number.isFinite(Number(value))) return [];
    const number = Number(value);
    return [`${number >= 0 ? "+" : ""}${number.toLocaleString("en-US", {minimumFractionDigits: basis === "usdc" ? 2 : 0, maximumFractionDigits: basis === "usdc" ? 6 : 9})} ${state.profile?.trading_record?.basis_labels?.[basis] || basis.toUpperCase()}`];
  }).join(" · ") || "Not reconstructed";
}

function recordBasis(row, key) {
  const values = Object.keys(state.profile?.trading_record?.basis_labels || {usdc:"USDC",sol:"SOL"}).flatMap(basis => row?.[basis]?.[key] == null ? [] : [`${row[basis][key]} ${state.profile?.trading_record?.basis_labels?.[basis] || basis.toUpperCase()}`]);
  return values.join(" · ") || "—";
}

function renderHoldingsPager(host, loaded) {
  const pagination = state.profile?.holdings_page;
  if (!pagination || pagination.total <= loaded) return;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = `${loaded} of ${pagination.total} token balances loaded from this scan.`;
  host.append(status);
  if (!pagination.has_more || !pagination.next_cursor) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Load more holdings";
  button.addEventListener("click", async () => {
    const sourceId = state.source_wallet_id;
    const cursor = pagination.next_cursor;
    button.disabled = true;
    button.textContent = "Loading holdings…";
    const result = await api(`${API}/wallets/${encodeURIComponent(sourceId)}/holdings?cursor=${encodeURIComponent(cursor)}`);
    if (state.source_wallet_id !== sourceId || state.profile?.holdings_page?.next_cursor !== cursor) return;
    button.disabled = false;
    button.textContent = "Load more holdings";
    if (!result.response.ok) {
      status.textContent = result.payload?.error === "wallet_holdings_snapshot_changed"
        ? "A newer balance scan is available. Refresh analysis to load its holdings."
        : "More holdings could not load. Your current results are still available; try again.";
      return;
    }
    if (result.payload?.source_wallet_id !== sourceId || result.payload?.pagination?.snapshot !== pagination.snapshot
      || !Array.isArray(result.payload?.tokens)) {
      status.textContent = "The balance scan changed. Refresh analysis to continue.";
      return;
    }
    const profile = state.profile;
    const snapshot = profile.holdings_snapshot;
    const marks = result.payload.mark_unavailable || [];
    if (snapshot) {
      snapshot.tokens = [...(snapshot.tokens || []), ...result.payload.tokens];
      if (snapshot.mark_coverage) snapshot.mark_coverage.unavailable = [...(snapshot.mark_coverage.unavailable || []), ...marks];
    } else {
      profile.positions.provider_reported_token_balances = [...(profile.positions.provider_reported_token_balances || []), ...result.payload.tokens];
      if (profile.mark_coverage) profile.mark_coverage.unavailable = [...(profile.mark_coverage.unavailable || []), ...marks];
    }
    profile.holdings_page = { ...result.payload.pagination, offset: 0, returned: loaded + result.payload.tokens.length };
    renderWalletRecord();
  });
  host.append(button);
}

function renderWalletRecord() {
  const profile = state.profile;
  if (!profile) return;
  const performance = profile.source_performance || {};
  const period = document.getElementById("copyOverviewPeriod").value;
  const record = profile.trading_record;
  const selected = record?.periods?.[period] || performance.windows?.[period];
  const all = period === "all_available";
  const row = selected || (all ? {
    realized_pnl: performance.realized_pnl_by_basis || { usdc: performance.realized_pnl_usdc, sol: performance.realized_pnl_sol },
    roi_pct: performance.roi_pct, win_rate_pct: performance.win_rate_pct,
    buy_count: profile.behavior?.buy_count, sell_count: profile.behavior?.sell_count,
    average_hold_seconds: profile.behavior?.average_hold_seconds,
    observations: performance.closed_observations ?? performance.closed_lots,
    buy_notional_by_basis: profile.behavior?.buy_notional_by_basis,
    sell_notional_by_basis: profile.behavior?.sell_notional_by_basis,
  } : {});
  const native = profile.capital_observations?.native || profile.capital_observations?.sol;
  const snapshot = profile.holdings_snapshot;
  const nativeAmount = snapshot?.native?.amount ?? native?.amount;
  const nativeSymbol = native?.symbol || (profile.source_wallet.chain === "bsc" ? "BNB" : profile.source_wallet.chain === "solana" ? "SOL" : "ETH");
  const markedValue = (snapshot?.provider_balance_summary || profile.provider_balance_summary)?.visible_provider_mark_value_usd;
  const usd = record?.usd?.periods?.[period];
  const unrealized=record?.usd?.unrealized_summary||record?.unrealized_summary;
  const markSummary=snapshot?.provider_balance_summary||profile.provider_balance_summary;
  const metrics = [
    fact("Realized P&L · settlement", recordPnl(row.realized_pnl)),
    ...(record?.usd ? [fact("Realized P&L · USD reference", recordUsd(usd?.realized_pnl?.usd)),fact("Historical USD coverage", `${record.usd.priced_trades} / ${record.usd.eligible_trades} retained trades`),fact("Observed network fees · USD reference",recordUsd(usd?.observed_network_fee_usd))] : []),
    fact("Return on matched cost", pct(row.roi_pct)),
    fact("Win rate · matched sells", pct(row.win_rate_pct)),
    fact("Buys / sells", `${row.buy_count ?? "—"} / ${row.sell_count ?? "—"}`),
    fact("Average hold · matched sells", humanDuration(row.average_hold_seconds)),
    fact("Matched sells", row.observations ?? "—"),
    fact("Native balance · last observed", nativeAmount == null ? "—" : `${decimal(nativeAmount)} ${nativeSymbol}`),
    fact("Visible token value · provider marks", markedValue == null ? "—" : money(markedValue)),
    fact("Token pricing coverage",Number.isInteger(markSummary?.visible_priced_rows)&&Number.isInteger(markSummary?.visible_unpriced_rows)?`${markSummary.visible_priced_rows} priced · ${markSummary.visible_unpriced_rows} unpriced`:"Not available"),
    fact(unrealized?.value_usd != null ? "Unrealized · priced known-cost holdings" : "Unrealized P&L", unrealized?.value_usd != null ? `${recordUsd(unrealized.value_usd)} · ${unrealized.covered_tokens}/${unrealized.visible_holdings} tokens` : "Needs cost + current valuation"),
    fact("Average buy size", recordBasis(row.buy_notional_by_basis, "average")),
    fact("Total buy cost", recordBasis(row.buy_notional_by_basis, "total")),
    fact("Total sell proceeds", recordBasis(row.sell_notional_by_basis, "total")),
  ];
  document.getElementById("copyOverviewMetrics").replaceChildren(...metrics);
  const decoded = profile.coverage?.trade_events != null;
  const fxScope = record?.usd ? " USD values use historical five-minute native-asset price references and canonical USDC equivalents; network fees remain separate. " : " ";
  const balanceObservedAt = Object.hasOwn(profile, "balances_observed_at") ? profile.balances_observed_at : profile.generated_at;
  const balanceScope = balanceObservedAt ? `Balances observed ${when(balanceObservedAt)}.` : "Balances have not been indexed.";
  const historyGaps = Number(profile.durable_history?.unresolved_references || 0);
  const gapScope = historyGaps ? `${historyGaps.toLocaleString()} transaction receipts remain unresolved; history and cost basis are incomplete. ` : "";
  setText("copyOverviewScope", `${chainLabel(profile.source_wallet.chain)} · ${balanceScope} ${gapScope}${fxScope}${decoded ? "Results cover retained decoded activity; matched cost only, network fees separate. Settlement currencies stay separate." : "Transfer history is available; swaps and cost basis are not reconstructed yet."} ${selected || all ? "" : "This snapshot has no period breakdown. "}Retained activity: ${when(profile.coverage?.first_observed_at || profile.behavior?.first_trade_at)} → ${when(profile.coverage?.last_observed_at || profile.behavior?.last_trade_at)}; not wallet age. Missing values are not zero.`);
  const distribution = document.getElementById("copyOutcomeDistribution");
  distribution.replaceChildren();
  if (selected?.distribution?.length && selected.observations > 0) {
    const title = document.createElement("strong"); title.textContent = "Matched sell return distribution"; distribution.append(title);
    const items = document.createElement("div");
    selected.distribution.forEach(bucket => {
      const item = document.createElement("div"); const label = document.createElement("span"); const value = document.createElement("strong"); const bar = document.createElement("meter");
      label.textContent = bucket.label; value.textContent = bucket.count; bar.min = 0; bar.max = selected.observations; bar.value = bucket.count; bar.setAttribute("aria-label", `${bucket.label}: ${bucket.count} matched sells`);
      item.append(label, value, bar); items.append(item);
    });
    distribution.append(items);
  }
  const balances = snapshot ? snapshot.tokens || [] : profile.positions?.provider_reported_token_balances || [];
  const symbolFor = mint => mint === SOLANA_USDC ? "USDC" : balances.find(token => (token.mint || token.contract) === mint)?.symbol || profile.token_metadata?.rows?.find(token => token.mint === mint)?.symbol;
  const holdingRows = [...balances].sort((a,b) => (b.provider_mark_value_usd ?? -1) - (a.provider_mark_value_usd ?? -1)).map(token => [
    recordToken(token.mint || token.contract, token.symbol || symbolFor(token.mint)),
    token.balance_display ?? "—",
    (()=>{
      const mark=document.createElement("span"),reason=(snapshot?.mark_coverage||profile.mark_coverage)?.unavailable?.find(row=>row.contract===(token.mint||token.contract))?.reason;
      const reasons={thin_liquidity:"Low liquidity",inactive_market:"Inactive market",conflicting_pools:"Conflicting prices",no_qualified_market:"No reliable mark",provider_unavailable:"Mark unavailable"};
      mark.textContent=token.provider_mark_price_usd==null?(reasons[reason]||"—"):recordUsd(token.provider_mark_price_usd,true);
      if(token.mark_observed_at){mark.title=`${readable(token.price_authority||token.mark_source)} · observed ${when(token.mark_observed_at)}${token.mark_evidence?` · Pool liquidity ${money(token.mark_evidence.liquidity_usd)} · indicative, not an exit quote${token.mark_evidence.position_exceeds_ten_percent_of_pool?" · Holding exceeds 10% of reference pool liquidity":""}`:""}`;mark.setAttribute("aria-label",`${mark.textContent}, ${mark.title}`);}return mark;
    })(),
    recordUsd(token.provider_mark_value_usd),
    (()=>{const row=(record?.usd?.tokens||record?.tokens)?.find(row=>row.mint===(token.mint||token.contract));return row?.unrealized_pnl_usd==null?"Not reconstructed":recordUsd(row.unrealized_pnl_usd);})(),
  ]);
  document.getElementById("copyHoldingsTable").replaceChildren(recordTable(["Token / contract", "Balance", "Mark price", "Marked value", "Unrealized P&L"], holdingRows, "No token balances in this snapshot"));
  renderHoldingsPager(document.getElementById("copyHoldingsTable"), balances.length);
  const query = document.getElementById("copyTokenSearch").value.trim().toLowerCase();
  const tokens = record?.tokens || [];
  const tokenRows = tokens.filter(token => `${token.mint} ${symbolFor(token.mint) || ""}`.toLowerCase().includes(query)).map(token => [
    recordToken(token.mint, symbolFor(token.mint)), `${token.buy_count} / ${token.sell_count}`,
    recordBasis(token.by_basis, "matched_cost"), recordBasis(token.by_basis, "matched_proceeds"),
    recordBasis(token.by_basis, "realized_pnl"), recordBasis(token.by_basis, "remaining_cost"), when(token.last_trade_at),
  ]);
  document.getElementById("copyTokenTable").replaceChildren(recordTable(["Token / contract", "Buys / sells", "Matched cost", "Matched proceeds", "Realized P&L", "Known open cost", "Last trade"], tokenRows, tokens.length ? "No tokens match this filter" : "Token cost records not reconstructed yet"));
  setText("copyTokenScope", record ? `${tokenRows.length} shown · ${record.token_count} tokens with decoded trading activity. All retained time; period control above applies to the overview. Transfers and unknown starting inventory are excluded from profit. ${record.tokens_truncated ? "Limited to the 100 most recently traded tokens." : ""}` : "This snapshot does not contain per-token cost records. Refresh analysis to use retained history where available.");
}

function renderProfile(payload, { scroll = true, from_poll: fromPoll = false } = {}) {
  if (state.session_expired) return;
  if (!fromPoll) {
    clearTimeout(state.deep_poll_timer);
    state.deep_poll_token += 1;
    state.deep_poll_attempts = 0;
  }
  if (!fromPoll) state.policy_source = null;
  const previousHoldings = state.profile?.source_wallet?.address === payload.profile?.source_wallet?.address
    && state.profile?.source_wallet?.chain === payload.profile?.source_wallet?.chain ? state.profile?.holdings_snapshot : null;
  state.profile = fromPoll && previousHoldings ? { ...payload.profile, holdings_snapshot: previousHoldings, holdings_page: state.profile.holdings_page } : payload.profile;
  state.address = payload.profile?.source_wallet?.address || state.address;
  state.source_wallet_id = payload.source_wallet_id || state.source_wallet_id;
  if (payload.cached_summary && state.source_wallet_id) {
    for (const card of document.querySelectorAll(".copy-seen-wallet[data-source-wallet-id]")) {
      if (card.dataset.sourceWalletId !== state.source_wallet_id) continue;
      const previousMetrics = card.querySelector(".copy-card-metrics");
      const nextMetrics = observedCardMetrics(payload.cached_summary);
      if (previousMetrics) previousMetrics.replaceWith(nextMetrics);
      else if (!nextMetrics.hidden) card.append(nextMetrics);
      const status = card.querySelector(".copy-card-status");
      if (status) status.textContent = "Cached analysis updated.";
      const open = card.querySelector(".copy-seen-actions button:last-child");
      if (open) open.textContent = "Open cached";
    }
  }
  const profile = state.profile;
  const profileChain = profile?.source_wallet?.chain || "solana";
  if (!fromPoll) {
    document.getElementById("copyWalletChain").value = profileChain;
    setInspectChain(profileChain, { announce: false });
    document.getElementById("copyWalletAddress").value = state.address;
  }
  const onDemandOnly = payload.persistence?.state === "on_demand_only";
  profileNode.hidden = false;
  if (!fromPoll) policyNode.hidden = true;
  const shadowButton = document.getElementById("copyStartSetup");
  const shadowAvailable = state.activation.shadow_copy === true && profileChain === "solana";
  shadowButton.disabled = !shadowAvailable;
  shadowButton.textContent = shadowAvailable ? "Copy this wallet" : state.activation.shadow_copy ? "Copy unavailable on this chain" : "Raven Copy opening soon";
  shadowButton.title = shadowAvailable
    ? "Create a Raven Copy policy"
    : state.activation.shadow_copy ? "Copy setup is available for Solana wallets." : "Copy setup is not available yet.";
  const saveButton = document.getElementById("copySaveProfile");
  saveButton.disabled = false;
  saveButton.dataset.action = onDemandOnly ? "refresh" : "save";
  saveButton.dataset.idleLabel = onDemandOnly ? "Refresh scan" : "Save wallet";
  saveButton.textContent = saveButton.dataset.idleLabel;
  saveButton.title = onDemandOnly ? "Refresh this bounded on-demand provider scan." : "Save this wallet to a research list.";
  document.getElementById("copyProfileProGate").hidden = state.access.advanced_wallet_intelligence;
  renderDeepHistory(payload.deep_history);
  setText("copyProfileAddress", walletAddress(state.address));
  const explorers = {solana: "https://solscan.io/account/", base: "https://basescan.org/address/", ethereum: "https://etherscan.io/address/", bsc: "https://bscscan.com/address/", robinhood: "https://robinhoodchain.blockscout.com/address/"};
  const explorer = document.getElementById("copyProfileExplorer");
  explorer.href = `${explorers[profileChain]}${encodeURIComponent(state.address)}`;
  explorer.hidden = !explorers[profileChain];
  if (!fromPoll) {
    setText("copyProfileCopyAddress", "Copy address");
    document.getElementById("copyRavenEvidence").open = profileChain === "solana";
    document.getElementById("copyOverviewPeriod").value = getPreference("walletPeriod", profile.trading_record || profile.source_performance?.windows ? "d30" : "all_available");
    document.getElementById("copyTokenSearch").value = "";
  }
  renderWalletRecord();
  const historyLabel = profile.data_quality?.provider_history_exhausted ? "provider window exhausted" : "bounded partial history";
  const reportedTransactions = profile.coverage.transactions_reported_by_provider;
  const transactionLabel = reportedTransactions != null ? `${reportedTransactions} tx reported` : profile.schema_version === "ravenos.evm_wallet_basic_profile.v2" ? `${profile.coverage.token_transfers_observed ?? "Unknown"} transfers observed` : `${profile.coverage.transactions_observed ?? "Unknown"} tx observed`;
  const tradeLabel = profile.coverage.trade_events === null || profile.coverage.trade_events === undefined ? "trades not decoded" : `${profile.coverage.trade_events} trades`;
  setText("copyProfileCoverage", `${transactionLabel} · ${tradeLabel} · ${historyLabel}`);
  const groupCard = state.groups.cards.get(`${profile.source_wallet?.chain}:${profile.source_wallet?.address}`);
  const summary = groupCard && Date.now()-groupCard.received_at<120000 ? groupCard.card : profile.public_summary;
  const thesisNode = document.getElementById('copyProfileThesis');
  thesisNode.hidden = !summary;
  if (summary) {
    setText('copyThesisState', {current:'Current',recent:'Recent',historical:'Historical',limited:'Limited history'}[summary.data_status] || 'Limited history');
    setText('copyThesisHeadline', summary.categories.join(' · ') || 'Wallet profile');
    setText('copyThesisSummary', summary.summary);
    for (const id of ['copyThesisStrengths','copyThesisWatchouts','copyThesisNext']) {
      const node = document.getElementById(id); if (node) { node.replaceChildren(); node.parentElement.hidden = true; }
    }
  }
  const performance = profile.source_performance;
  setText("copySourcePnl", profile.trading_record ? recordPnl(performance.realized_pnl_by_basis || {usdc:performance.realized_pnl_usdc,sol:performance.realized_pnl_sol}) : realizedPerformance(performance));
  const sourceMetrics = document.getElementById("copySourceMetrics");
  const basicMetrics = profileChain === "solana" || profile.trading_record ? [
    fact("ROI", pct(performance.roi_pct)),
    fact("Win rate", pct(performance.win_rate_pct)),
    fact("Closed observations", performance.closed_observations ?? performance.closed_lots),
    fact("Trades", profile.behavior.trade_count),
    fact("Tokens", profile.behavior.tokens_traded ?? "Unavailable"),
    fact("Active days", profile.behavior.active_days),
    fact("Last trade", when(profile.behavior.last_trade_at)),
  ] : [
    fact("Trades", "Not decoded"),
    fact("Inbound transfers", profile.provider_activity?.inbound_transfer_rows ?? "Unavailable"),
    fact("Recent transfers", profile.coverage.token_transfers_observed ?? "Unavailable"),
    fact("Provider tx count", profile.coverage.transactions_reported_by_provider ?? "Unavailable"),
    fact("Tokens held", profile.behavior.token_assets_observed ?? "Unavailable"),
    fact("Active days in window", profile.behavior.active_days),
    fact("Last transfer", when(profile.coverage.last_observed_at)),
  ];
  const advancedMetrics = [
    fact("Median hold", humanDuration(profile.behavior.median_hold_seconds)),
    fact("Avg buy", basisNotional(profile.behavior, "average")),
    fact("Total buys", basisNotional(profile.behavior, "total")),
    fact("Trade rate", profile.behavior.trade_rate_per_active_day === null || profile.behavior.trade_rate_per_active_day === undefined ? "Unavailable" : `${profile.behavior.trade_rate_per_active_day}/day`),
  ];
  sourceMetrics.replaceChildren(...basicMetrics, ...(state.access.advanced_wallet_intelligence ? advancedMetrics : []));
  const windows = document.getElementById("copyPerformanceWindows");
  const windowRows = [["24H", performance.windows?.h24], ["7D", performance.windows?.d7], ["30D", performance.windows?.d30], ["90D", performance.windows?.d90], ["All observed", performance.windows?.all_available]];
  windows.replaceChildren(...windowRows.map(([label, row]) => {
    const item = document.createElement("div");
    const name = document.createElement("span");
    const result = document.createElement("strong");
    const sample = document.createElement("small");
    name.textContent = label;
    result.textContent = row?.state === "available" ? realizedPair(row.realized_pnl) : "Unavailable";
    sample.textContent = `${Number(row?.observations || 0)} closed observation${Number(row?.observations || 0) === 1 ? "" : "s"}`;
    item.append(name, result, sample);
    return item;
  }));
  for (const id of ['copyProfitQuality', 'copyEvidenceMetrics']) {
    const node = document.getElementById(id); if (node) { node.replaceChildren(); node.closest('article').hidden = true; }
  }
  document.getElementById('copyBehaviorMetrics').replaceChildren(
    fact('Median hold', humanDuration(profile.behavior?.median_hold_seconds)),
    fact('Trades', profile.behavior?.trade_count ?? 'Unavailable'),
    fact('Active days', profile.behavior?.active_days ?? 'Unavailable'),
    fact('Latest trade', when(profile.behavior?.last_trade_at)),
  );
  setText('copyBehaviorLimit', 'Activity covers the available history.');
  const capital = profile.capital_observations || {};
  const openPositions = Array.isArray(profile.positions?.known_cost_open_positions) ? profile.positions.known_cost_open_positions : [];
  const providerBalances = Array.isArray(profile.positions?.provider_reported_token_balances) ? profile.positions.provider_reported_token_balances : [];
  const native = capital.native || capital.sol || null;
  const nativeSymbol = native?.symbol || (profileChain === "solana" ? "SOL" : "Native");
  const providerBalance = profile.provider_balance_summary || {};
  setText("copyHoldingsScope", profile.generated_at ? `${chainLabel(profileChain)} · scan ${when(profile.generated_at)}` : `${chainLabel(profileChain)} · retained observations`);
  const snapshot = profile.holdings_snapshot;
  const holdings = [];
  if (snapshot) {
    setText("copyHoldingsScope", `${chainLabel(profileChain)} · ${snapshot.state === "available" ? "Confirmed scan" : "Partial scan"} ${when(snapshot.observed_at)}`);
    if (profile.token_metadata?.rows?.length) {
      const observed = profile.token_metadata.rows.map(row => row.observed_at).filter(Boolean).sort()[0];
      setText("copyHoldingsScope", `${chainLabel(profileChain)} · Balances ${when(snapshot.observed_at)} · Token metadata ${when(observed)}. Cached indicative marks, not exit quotes.`);
    }
    if (snapshot.native) holdings.push(fact("SOL", `${decimal(snapshot.native.amount)} SOL`));
    for (const token of snapshot.tokens || []) if (token.mint === SOLANA_USDC) holdings.push(fact("USDC", `${token.balance_display} USDC`));
    if (snapshot.state !== "available") holdings.push(empty("Some balances unavailable", "One or more token programs could not be read."));
    if (!holdings.length && snapshot.state === "available") holdings.push(empty("No balances observed", "Confirmed native and token-account scan."));
  }
  if (!snapshot && native?.amount !== null && native?.amount !== undefined) holdings.push(fact(`Last observed ${nativeSymbol}`, `${decimal(native.amount)} ${nativeSymbol} · ${when(native.observed_at)}`));
  if (!snapshot && capital.canonical_usdc?.amount !== null && capital.canonical_usdc?.amount !== undefined) holdings.push(fact("Last observed USDC", `${money(capital.canonical_usdc.amount)} · ${when(capital.canonical_usdc.observed_at)}`));

  document.getElementById("copyWalletBalances").replaceChildren(...(holdings.length ? holdings : [empty("Balances unavailable", "This scan does not establish current holdings. Missing balances do not mean an empty wallet.")]));
  const capitalMetrics = [
    fact(`Last observed ${nativeSymbol}`, native?.amount === null || native?.amount === undefined ? "Unavailable" : `${decimal(native.amount)} ${nativeSymbol}`),
    fact(`${nativeSymbol} observed`, when(native?.observed_at)),
    fact("Last observed USDC", capital.canonical_usdc?.amount === null || capital.canonical_usdc?.amount === undefined ? "Unavailable" : money(capital.canonical_usdc.amount)),
    fact("USDC observed", when(capital.canonical_usdc?.observed_at)),
    fact("Known-cost open", profile.positions?.known_cost_open_position_count ?? "Unavailable"),
    fact("Indexed tokens", capital.provider_reported_token_count ?? "Unavailable"),
  ];
  if (profileChain !== "solana") capitalMetrics.push(
    fact("Visible provider mark", providerBalance.visible_provider_mark_value_usd === null || providerBalance.visible_provider_mark_value_usd === undefined ? "Unavailable" : money(providerBalance.visible_provider_mark_value_usd)),
    fact("Priced token rows", providerBalance.visible_priced_rows ?? "Unavailable"),
    fact("Unpriced token rows", providerBalance.visible_unpriced_rows ?? "Unavailable"),
    fact("Largest visible weight", providerBalance.largest_visible_provider_mark_weight_pct === null || providerBalance.largest_visible_provider_mark_weight_pct === undefined ? "Unavailable" : `${pct(providerBalance.largest_visible_provider_mark_weight_pct)} · ${providerBalance.largest_visible_provider_mark_symbol || "token"}`),
  );
  document.getElementById("copyCapitalMetrics").replaceChildren(...capitalMetrics);
  const openHost = document.getElementById("copyOpenPositions");
  const positionRows = openPositions.length ? openPositions.slice(0, 8).map((position) => ({
    identity: position.mint,
    detail: `${position.lot_count} known-cost lot${position.lot_count === 1 ? "" : "s"} · ${decimal(position.remaining_cost)} ${String(position.basis || "").toUpperCase()} · mark unavailable`,
  })) : providerBalances.slice(0, 12).map((position) => ({
    identity: position.symbol || position.contract,
    detail: `${decimal(position.balance_display)} held · ${position.provider_mark_price_usd === null ? "mark unavailable" : `${money(position.provider_mark_price_usd)} provider mark`} · basis unavailable`,
  }));
  openHost.replaceChildren(...(positionRows.length ? positionRows.map((position) => {
    const row = document.createElement("div");
    const identity = document.createElement("strong");
    const detail = document.createElement("span");
    identity.textContent = position.identity?.startsWith?.("0x") ? shortAddress(position.identity) : text(position.identity);
    detail.textContent = position.detail;
    row.append(identity, detail);
    return row;
  }) : [empty("No known-cost open positions", "Unknown inventory excluded.")]));
  setText("copySourceLimits", performance.limitations?.join(" ") || "No material limitations reported.");
  if (!fromPoll || !state.events.length) {
    renderWalletActivity(payload.activity || {
      filter: "all",
      events: payload.recent_events || [],
      pagination: {
        matching_event_count: (payload.recent_events || []).length,
        has_more: false,
        next_cursor: null,
      },
    });
  }
  scheduleDeepHistoryPoll(state.deep_poll_token);
  if (scroll) profileNode.scrollIntoView({ behavior: "smooth", block: "start" });
}

function exitStrategyOptions(select, selected = '') {
  if (!select) return;
  select.replaceChildren(new Option('No exit strategy', ''));
  for (const strategy of currentTradingSettings()?.settings.strategies || []) {
    select.add(new Option(`${strategy.name} · ${strategy.rules.length} rules`, strategy.id));
  }
  select.value = selected;
  if (select.selectedIndex < 0) select.value = '';
}

function policyPayload() {
  const size = Number(document.getElementById("copyPolicySize").value);
  const feeBps = state.product.standard_execution_fee_bps;
  if (!Number.isSafeInteger(feeBps) || feeBps <= 0) throw new Error("Current Copy fee policy unavailable. Refresh this page.");
  return {
    mode: "RAVEN_COPY",
    sizing: { kind: "FIXED_USDC", fixed_usdc: size },
    allocation: {
      total_strategy_usdc: Math.max(1_000, size),
      maximum_per_trade_usdc: size,
      minimum_per_trade_usdc: Math.min(25, size),
      maximum_token_exposure_usdc: Math.max(500, size),
      maximum_daily_notional_usdc: Math.max(1_000, size * 10),
    },
    execution_quality: {
      maximum_detection_delay_ms: Math.round(Number(document.getElementById("copyPolicyDelay").value) * 1_000),
      maximum_round_trip_friction_pct: Number(document.getElementById("copyPolicyFriction").value),
      minimum_liquidity_usd: Number(document.getElementById("copyPolicyLiquidity").value),
      require_executable_exit: document.getElementById("copyRequireExit").checked,
      allowed_chains: ["solana"],
    },
    safeguards: {
      skip_failed_sell_simulation: document.getElementById("copySkipFailedSell").checked,
      skip_freeze_authority_when_evidenced: document.getElementById("copySkipFreeze").checked,
    },
    funding_assumption: "PREPOSITIONED_SOLANA_USDC_SHADOW",
    hypothetical_raven_fee_bps: feeBps,
    exit_strategy: currentTradingSettings()?.settings.strategies.find(row => row.id === document.getElementById('copyPolicyExitStrategy')?.value) || null,
  };
}

function switchView(view) {
  document.querySelectorAll("[data-copy-view]").forEach((button) => {
    const active = button.dataset.copyView === view;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-copy-panel]").forEach((panel) => { panel.hidden = panel.dataset.copyPanel !== view; });
}

function watchCard(watch) {
  const card = document.createElement("article");
  card.className = "copy-card";
  card.dataset.watchId = watch.watch_id;
  const main = document.createElement("div");
  main.className = "copy-card-main";
  const stateLabel = document.createElement("span");
  const title = document.createElement("strong");
  const address = document.createElement("p");
  stateLabel.textContent = watch.backfill_complete ? "Ready for new trades" : "First check needed";
  title.textContent = watch.label;
  address.textContent = walletAddress(watch.source_wallet.address);
  main.append(stateLabel, title, address);
  const details = document.createElement("dl");
  details.append(
    fact("Order", `${money(watch.policy.sizing.fixed_usdc)} USDC`),
    fact("Round trip max", pct(watch.policy.execution_quality.maximum_round_trip_friction_pct)),
    fact("Last observed", when(watch.source_state.last_observed_at)),
    fact('Exit strategy', watch.policy.exit_strategy ? `${watch.policy.exit_strategy.name} · v${watch.policy.exit_strategy.version}` : 'None'),
  );
  const actions = document.createElement("div");
  actions.className = "copy-watch-actions";
  const refresh = document.createElement("button");
  const remove = document.createElement("button");
  refresh.type = remove.type = "button";
  refresh.textContent = watch.backfill_complete ? "Check for trades" : "Build baseline";
  remove.textContent = "Remove";
  remove.dataset.action = "delete";
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    refresh.textContent = watch.backfill_complete ? "Checking…" : "Loading history…";
    const result = await api(`${API}/watches/${encodeURIComponent(watch.watch_id)}/refresh`, { method: "POST", body: "{}" });
    if (!result.response.ok) {
      refresh.disabled = false;
      refresh.textContent = result.payload?.error === "source_cursor_gap" ? "History gap · retry later" : "Try again";
      return;
    }
    await loadWorkspace();
    if ((result.payload.decisions || []).length || (result.payload.exit_decisions || []).length) switchView("feed");
  });
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    await api(`${API}/watches/${encodeURIComponent(watch.watch_id)}`, { method: "DELETE", body: JSON.stringify({ confirm: "delete_wallet_watch" }) });
    await loadWorkspace();
  });
  const strategyLabel = document.createElement('label'), strategySelect = document.createElement('select');
  strategyLabel.textContent = 'Exit strategy'; strategySelect.setAttribute('aria-label', `Exit strategy for ${watch.label}`);
  exitStrategyOptions(strategySelect, watch.policy.exit_strategy?.id);
  strategyLabel.append(strategySelect);
  const apply = document.createElement('button'), note = document.createElement('p');
  apply.type = 'button'; apply.textContent = 'Apply strategy'; note.setAttribute('aria-live', 'polite');
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      const strategy = currentTradingSettings()?.settings.strategies.find(row => row.id === strategySelect.value) || null;
      const result = await api(`${API}/watches/${encodeURIComponent(watch.watch_id)}`, { method: 'PATCH', body: JSON.stringify({
        expected_revision: watch.revision, policy: { ...watch.policy, exit_strategy: strategy } }) });
      if (!result.response.ok) { note.textContent = 'The wallet or strategy changed. Refresh and try again.'; return; }
      await loadWorkspace();
    } catch { note.textContent = 'The strategy could not be applied. Try again.'; }
    finally { apply.disabled = false; }
  });
  actions.append(strategyLabel, apply, refresh, remove, note);
  card.append(main, details, actions);
  return card;
}

function decisionCard(decision) {
  const card = document.createElement("article");
  card.className = "copy-card";
  card.dataset.decisionState = decision.decision.state;
  const main = document.createElement("div");
  main.className = "copy-card-main";
  const stateLabel = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("p");
  stateLabel.textContent = readable(decision.decision.state);
  title.textContent = shortAddress(decision.destination_asset?.mint);
  detail.textContent = readable(decision.decision.reason_code);
  main.append(stateLabel, title, detail);
  const facts = document.createElement("dl");
  facts.append(
    fact("Source time", when(decision.timing.source_chain_event_at)),
    fact("Detection", duration(decision.timing.detection_delay_ms)),
    fact("Follower order", money(decision.follower_reality.follower_order_usdc)),
    fact("Entry vs source", bpsAsPercent(decision.follower_reality.entry_degradation_bps)),
    fact("Current exit", money(decision.follower_reality.current_executable_exit_usdc)),
    fact("Round trip", pct(decision.follower_reality.round_trip_friction_including_raven_pct)),
  );
  const actions = document.createElement("div");
  actions.className = "copy-watch-actions";
  const evidence = document.createElement("button");
  evidence.type = "button";
  evidence.textContent = `Hypothetical Raven fee · ${bpsAsPercent(decision.hypothetical_raven_fee.scenario_bps)}`;
  evidence.title = "Not collected.";
  actions.append(evidence);
  const handoff = decision.terminal_handoff || {};
  if (decision.decision.state === "SHADOW_EXECUTABLE" && handoff.state === "user_review_available") {
    const review = document.createElement("a");
    const url = new URL("/terminal/", location.origin);
    url.searchParams.set("chain", handoff.chain);
    url.searchParams.set("market", "spot");
    url.searchParams.set("instrument_type", "exact_pool");
    url.searchParams.set("instrument_scope", "exact_pool");
    url.searchParams.set("instrument_id", handoff.instrument_id);
    url.searchParams.set("pair_address", handoff.pair_address);
    url.searchParams.set("token_address", handoff.token_address);
    url.searchParams.set("quote_address", handoff.quote_address);
    url.searchParams.set("panel", "trade");
    url.searchParams.set("copy_review", "1");
    url.searchParams.set("copy_decision_id", decision.decision_id);
    url.searchParams.set("copy_amount_usdc", String(handoff.amount_usdc));
    review.href = `${url.pathname}${url.search}`;
    review.textContent = "Review copy in Terminal";
    review.title = "Loads a fresh quote. Your wallet must confirm the transaction.";
    actions.append(review);
  }
  card.append(main, facts, actions);
  return card;
}

function exitDecisionCard(decision) {
  const card = document.createElement("article");
  card.className = "copy-card";
  card.dataset.decisionState = decision.decision.state;
  const main = document.createElement("div");
  main.className = "copy-card-main";
  const stateLabel = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("p");
  stateLabel.textContent = `Source sell · ${readable(decision.decision.state)}`;
  title.textContent = shortAddress(decision.asset?.mint);
  detail.textContent = readable(decision.decision.reason_code);
  main.append(stateLabel, title, detail);
  const mappedAmount = exactAssetAmount({
    ...decision.asset,
    amount_base_units: decision.mapped_follower_exit?.quantity_base_units,
  });
  const facts = document.createElement("dl");
  facts.append(
    fact("Source time", when(decision.timing?.source_chain_event_at)),
    fact("Detection", duration(decision.timing?.detection_delay_ms)),
    fact("Observed sold", bpsAsPercent(decision.source_sell?.fraction_bps)),
    fact("Mapped exit", mappedAmount),
    fact("Expected USDC", money(decision.mapped_follower_exit?.gross_expected_usdc)),
    fact("Minimum USDC", money(decision.mapped_follower_exit?.minimum_expected_usdc)),
  );
  const actions = document.createElement("div");
  actions.className = "copy-watch-actions";
  const evidence = document.createElement("button");
  evidence.type = "button";
  const count = Number(decision.mapped_follower_exit?.position_count || 0);
  evidence.textContent = count
    ? `${count} Raven lot${count === 1 ? "" : "s"} mapped · no funds moved`
    : "No Raven-created lot changed";
  evidence.title = decision.hypothetical_raven_fee?.fee_usdc === null
    ? "No fee calculated."
    : `Hypothetical fee ${money(decision.hypothetical_raven_fee.fee_usdc)} · not collected.`;
  actions.append(evidence);
  card.append(main, facts, actions);
  return card;
}

function positionCard(position) {
  const card = document.createElement("article");
  card.className = "copy-card";
  const main = document.createElement("div");
  main.className = "copy-card-main";
  const stateLabel = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("p");
  stateLabel.textContent = readable(position.state);
  title.textContent = shortAddress(position.destination_asset?.mint);
  detail.textContent = `Source ${walletAddress(position.source_wallet?.address)}`;
  main.append(stateLabel, title, detail);
  const facts = document.createElement("dl");
  const remaining = exactAssetAmount({
    ...position.destination_asset,
    amount_base_units: position.remaining_quantity_base_units,
  });
  facts.append(
    fact("Entry cost", money(position.entry_cost_usdc)),
    fact("Remaining", remaining),
    fact("Source exits", position.exit_count ?? 0),
    fact("Realized exit", money(position.gross_realized_exit_usdc)),
    fact("Opened", when(position.opened_at)),
  );
  card.append(main, facts);
  return card;
}

function observedRequest() {
  const advanced = state.access.advanced_wallet_intelligence && state.activation.wallet_market_evidence;
  return { signal: advanced ? document.getElementById("copyObservedSignal").value : "any",
    sort: advanced ? document.getElementById("copyObservedSort").value : "priority",
    source: document.getElementById("copyObservedSource").value,
    history: document.getElementById("copyObservedHistory").value,
    active_within_hours: document.getElementById("copyObservedActive").value ? Number(document.getElementById("copyObservedActive").value) : null };
}

function screenerRequest() {
  if (state.screener.view === "observed") return {
    view: "observed", observed: observedRequest(), chain: state.screener.chain, network: "mainnet",
    page: state.screener.page, page_size: 12,
  };
  const optionalNumber = (id) => {
    const value = document.getElementById(id).value;
    return value === "" ? null : Number(value);
  };
  const clauses = [];
  const clause = (field, operator, id) => {
    const value = optionalNumber(id);
    if (value !== null) clauses.push({ field, operator, value });
  };
  clause("profit_factor", "gte", "copyScreenProfitFactor");
  if (state.access.advanced_wallet_intelligence) document.querySelectorAll("[data-discovery-field]").forEach((input) => {
    if (input.value !== "") clauses.push({ field: input.dataset.discoveryField, operator: input.dataset.discoveryOperator, value: Number(input.value) });
  });
  const holdMinimum = optionalNumber("copyScreenHoldMin");
  const holdMaximum = optionalNumber("copyScreenHoldMax");
  if (holdMinimum !== null && holdMaximum !== null) clauses.push({ field: "median_hold_seconds", operator: "between", value: [holdMinimum, holdMaximum] });
  else if (holdMinimum !== null) clauses.push({ field: "median_hold_seconds", operator: "gte", value: holdMinimum });
  else if (holdMaximum !== null) clauses.push({ field: "median_hold_seconds", operator: "lte", value: holdMaximum });
  return {
    chain: state.screener.chain,
    view: state.screener.view || "combined",
    observed: state.screener.view === "analyzed" ? {} : observedRequest(),
    network: "mainnet",
    filters: {
      active_within_hours: optionalNumber("copyScreenActive"),
      min_trade_count: optionalNumber("copyScreenTrades"),
      min_active_days: optionalNumber("copyScreenDays"),
      min_closed_lots: optionalNumber("copyScreenClosed"),
      min_win_rate_pct: optionalNumber("copyScreenWin"),
      min_roi_pct: optionalNumber("copyScreenRoi"),
      performance_state: document.getElementById("copyScreenEvidence").value,
    },
    clauses,
    preset: state.screener.preset,
    sort: document.getElementById("copyScreenSort").value,
    page: state.screener.page,
    page_size: 12,
  };
}

function syncScreenerUrl() {
  const url = new URL(walletLocationHref());
  const fields = {
    chain: state.screener.chain === "all" ? null : state.screener.chain,
    wallets: state.screener.view,
    obs_signal: document.getElementById("copyObservedSignal").value,
    obs_history: document.getElementById("copyObservedHistory").value,
    obs_active: document.getElementById("copyObservedActive").value,
    obs_sort: document.getElementById("copyObservedSort").value,
    obs_source: document.getElementById("copyObservedSource").value,
    screen: state.screener.preset,
    active: document.getElementById("copyScreenActive").value,
    trades: document.getElementById("copyScreenTrades").value,
    days: document.getElementById("copyScreenDays").value,
    evidence: document.getElementById("copyScreenEvidence").value,
    sort: document.getElementById("copyScreenSort").value,
    closed: document.getElementById("copyScreenClosed").value,
    win: document.getElementById("copyScreenWin").value,
    roi: document.getElementById("copyScreenRoi").value,
    pf: document.getElementById("copyScreenProfitFactor").value,
    hold_min: document.getElementById("copyScreenHoldMin").value,
    hold_max: document.getElementById("copyScreenHoldMax").value,
  };
  document.querySelectorAll("[data-discovery-key]").forEach((input) => { fields[`df_${input.dataset.discoveryKey}`] = input.value; });
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "" || (key.startsWith("obs_") && ["any", "recent"].includes(value)) || (key === "evidence" && value === "any") || (key === "sort" && value === "last_trade_desc")) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value).slice(0, 64));
  }
  if (page.dataset.embedded === 'true') embeddedUrl = url.href;
  else history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function hydrateScreenerFromUrl() {
  const params = new URL(walletLocationHref()).searchParams;
  const view = params.get("wallets");
  if (["observed", "analyzed", "groups"].includes(view)) state.screener.view = view;
  else if (params.has("screen") || params.has("sort") || [...params.keys()].some(key => key.startsWith("df_"))) state.screener.view = "analyzed";
  for (const [key, id] of Object.entries({obs_signal:"copyObservedSignal",obs_history:"copyObservedHistory",obs_active:"copyObservedActive",obs_sort:"copyObservedSort",obs_source:"copyObservedSource"})) {
    const value = params.get(key), input = document.getElementById(id);
    if (value !== null && [...input.options].some(option => option.value === value)) {
      if (["obs_signal", "obs_sort"].includes(key) && !(state.access.advanced_wallet_intelligence && state.activation.wallet_market_evidence)) continue;
      input.value = value; state.screener.view ??= "observed";
    }
  }
  const chain = params.get("chain");
  if (new Set(["all", "solana", "robinhood", "base", "ethereum", "bsc"]).has(chain)) state.screener.chain = chain;
  if (state.access.advanced_wallet_intelligence) document.querySelectorAll("[data-discovery-key]").forEach((input) => { input.value = (params.get(`df_${input.dataset.discoveryKey}`) || "").slice(0, 64); });
  const preset = params.get("screen");
  if (preset && [...document.querySelectorAll("[data-screen-preset]")].some((button) => button.dataset.screenPreset === preset)) state.screener.preset = preset;
  const mappings = {
    active: "copyScreenActive", trades: "copyScreenTrades", days: "copyScreenDays",
    evidence: "copyScreenEvidence", sort: "copyScreenSort", closed: "copyScreenClosed", win: "copyScreenWin",
    roi: "copyScreenRoi", pf: "copyScreenProfitFactor", hold_min: "copyScreenHoldMin", hold_max: "copyScreenHoldMax",
  };
  for (const [parameter, id] of Object.entries(mappings)) {
    const value = params.get(parameter);
    const input = document.getElementById(id);
    if (value === null || !input) continue;
    state.screener.view ??= "analyzed";
    if (input.tagName === "SELECT" && ![...input.options].some((option) => option.value === value)) continue;
    input.value = value.slice(0, 64);
  }
  document.querySelectorAll("[data-screen-preset]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.screenPreset === state.screener.preset)));
  document.querySelectorAll("[data-screen-chain]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.screenChain === state.screener.chain)));
}

async function loadStoredWallet(sourceWalletId, button) {
  const requestId = ++state.profile_request;
  state.activity_request += 1;
  state.source_wallet_id = null;
  state.profile = null;
  state.deep_history = null;
  state.events = [];
  state.activity = { filter: "all", next_cursor: null, has_more: false, provider_has_more: false, matching_event_count: 0, loading: false, on_demand_only: false };
  state.on_demand_events = [];
  document.getElementById("copyActivityFilter").disabled = false;
  state.policy_source = null;
  state.deep_poll_token += 1;
  policyNode.hidden = true;
  profileNode.hidden = true;
  const idleLabel = button?.textContent || "Open analysis";
  if (button) { button.disabled = true; button.textContent = "Opening…"; }
  inspectionFeedback(button, "Opening cached analysis…");
  const url = `${API}/wallets/${encodeURIComponent(sourceWalletId)}`;
  const retryable = result => result.response.status === 0 || [500, 502, 503, 504].includes(result.response.status);
  let result = await api(url);
  if (retryable(result) && requestId === state.profile_request && !state.session_expired) {
    inspectionFeedback(button, "Connection interrupted. Retrying cached analysis…");
    // One safe GET retry; never start a fresh history scan for a failed read.
    result = await api(url);
  }
  if (button) { button.disabled = false; button.textContent = idleLabel; }
  if (requestId !== state.profile_request) return;
  if (!result.response.ok || !result.payload?.profile) {
    state.profile = null;
    profileNode.hidden = true;
    if (!state.session_expired) {
      const message = result.response.status === 404
        ? "This cached profile is no longer available. Use Analyze wallet above to check this address again."
        : result.response.status === 429
          ? "Too many requests. Wait a moment, then open this analysis again."
          : result.response.status === 403
            ? "This analysis is not available with your current access. Check your account and try again."
            : `The analysis could not load. Tap ${idleLabel} to retry the cached profile.`;
      inspectionFeedback(button, message);
    }
    // Only a missing profile permits callers to offer a new inspection.
    return result.response.status === 404 ? false : undefined;
  }
  button?.closest(".copy-seen-wallet, .copy-screener-card")?.querySelector(".copy-card-status")?.remove();
  renderProfile(result.payload);
  setText("copySearchStatus", `Stored analysis · ${when(result.payload.freshness?.observed_at || result.payload.profile?.generated_at)}. No provider refresh requested.`);
  profileNode.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function savedResearchRow(save) {
  const row = document.createElement("article");
  const identity = document.createElement("div");
  const list = document.createElement("span");
  const label = document.createElement("strong");
  const address = document.createElement("small");
  list.textContent = save.list_name;
  const short = walletAddress(save.source_wallet?.address);
  const legacyDefault = `${short.slice(0, 6)}…${short.slice(-6)}`;
  label.textContent = !save.label || save.label === legacyDefault ? short : save.label;
  address.textContent = label.textContent === short ? `${chainLabel(save.source_wallet?.chain)} · exact wallet` : `${short} · ${chainLabel(save.source_wallet?.chain)}`;
  identity.append(list, label, address);
  const actions = document.createElement("div");
  const open = document.createElement("button");
  const remove = document.createElement("button");
  open.type = remove.type = "button";
  open.textContent = save.analysis?.state === "not_analyzed" ? "Analyze wallet" : "Open cached";
  remove.textContent = "Remove";
  open.addEventListener("click", async () => {
    setInspectChain(save.source_wallet.chain, { announce: false });
    document.getElementById("copyWalletAddress").value = save.source_wallet.address;
    if (open.textContent === "Analyze wallet") {
      await inspectWalletAddress(save.source_wallet.address, open);
      if (!profileNode.hidden) profileNode.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (await loadStoredWallet(save.source_wallet_id, open) === false) open.textContent = "Analyze wallet";
  });
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    const result = await api(`${API}/saved-wallets/${encodeURIComponent(save.save_id)}`, { method: "DELETE", body: JSON.stringify({ confirm: "delete_saved_wallet" }) });
    remove.disabled = false;
    if (!result.response.ok) { setText("copySavedStatus", "Could not remove this wallet. Your saved list is unchanged."); return; }
    state.saved_request += 1;
    state.saved = state.saved.filter(item => item.save_id !== save.save_id);
    renderSavedResearch();
    setText("copySavedStatus", "Wallet removed from this list.");
  });
  actions.append(open, remove);
  row.append(identity, actions);
  return row;
}

function renderSavedResearch() {
  setText("copySavedCount", state.saved_loaded ? `${state.saved.length} saved` : "Saved wallets");
  setText("copySavedShortcut", state.saved_loaded ? `Saved wallets (${state.saved.length}) ↓` : "Saved wallets ↓");
  const host = document.getElementById("copySavedWallets");
  if (!state.saved.length) {
    const message = document.createElement("p");
    message.textContent = "No saved wallets.";
    host.replaceChildren(message);
    return;
  }
  const chain = document.getElementById("copySavedChain").value, search = document.getElementById("copySavedSearch").value.trim().toLowerCase();
  const matches = state.saved.filter(save => (chain === "all" || save.source_wallet.chain === chain)
    && [save.label, save.list_name, save.source_wallet.address].some(value => String(value).toLowerCase().includes(search)));
  host.replaceChildren(...matches.map(savedResearchRow));
  if (!matches.length) { const message = document.createElement("div"); message.textContent = "No saved wallets match these filters."; host.append(message); }
}

async function loadSavedResearch() {
  const requestId = ++state.saved_request;
  const result = await api(`${API}/saved-wallets`);
  if (requestId !== state.saved_request) return;
  if (!result.response.ok || !Array.isArray(result.payload?.saves)) {
    setText("copySavedStatus", state.saved_loaded ? "Refresh unavailable. Your last loaded list is still shown." : "Saved wallets are unavailable. Retry to load your list.");
    return;
  }
  state.saved = result.payload.saves;
  state.saved_loaded = true;
  setText("copySavedStatus", "Private research lists · saving does not start Copy.");
  renderSavedResearch();
}

async function saveResearchWallet(sourceWalletId, label, button) {
  if (!sourceWalletId) return;
  const listName = document.getElementById("copySaveListName").value.trim() || "Research";
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  const result = await api(`${API}/saved-wallets`, {
    method: "POST",
    body: JSON.stringify({ source_wallet_id: sourceWalletId, list_name: listName, label }),
  });
  if (button) { button.disabled = false; button.textContent = result.response.ok ? "Saved" : "Try again"; }
  if (result.response.ok) await loadSavedResearch();
}

function robinhoodActivityRow(event) {
  const row = document.createElement("div");
  row.className = "copy-rh-row";
  row.dataset.action = event.action || "swap";
  const action = document.createElement("span");
  const identity = document.createElement("div");
  const token = document.createElement("strong");
  const detail = document.createElement("small");
  const save = document.createElement("button");
  action.textContent = String(event.action || "swap").toUpperCase();
  token.textContent = event.token?.symbol || shortAddress(event.token?.contract || event.token?.asset_id);
  detail.textContent = `${walletAddress(event.trader?.address)} · ${when(event.observed_at)}`;
  save.type = "button";
  save.textContent = "Watch";
  save.addEventListener("click", () => saveResearchWallet(event.trader?.source_wallet_id, walletAddress(event.trader?.address), save));
  identity.append(token, detail);
  row.append(action, identity, save);
  return row;
}

function renderRobinhoodIntelligence() {
  const section = document.getElementById("copyRobinhoodIntelligence");
  const visible = state.screener.chain === "robinhood";
  section.hidden = !visible;
  if (!visible) return;
  const activity = state.robinhood_intelligence.activity;
  const render = (id, rows, mapper, headline, detail) => {
    const host = document.getElementById(id);
    if (!rows.length) {
      host.replaceChildren(empty(headline, detail));
      return;
    }
    const list = document.createElement("div");
    list.className = "copy-rh-list";
    list.append(...rows.map(mapper));
    host.replaceChildren(list);
  };
  render("copyRhActivity", activity, robinhoodActivityRow, "No qualifying activity", "The bounded RH index has no matching event in this window.");
  setText("copyRhStatus", activity.length
    ? `${activity.length} recent normalized events · indexed wallets only`
    : "RH index is available; qualifying activity is forming.");
}

async function loadRobinhoodIntelligence() {
  const section = document.getElementById("copyRobinhoodIntelligence");
  if (state.screener.chain !== "robinhood") {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  setText("copyRhStatus", "Loading indexed RH activity…");
  const activity = await api(`${API}/robinhood/activity?hours=24&limit=12&action=all`);
  state.robinhood_intelligence = { activity: activity.response.ok && Array.isArray(activity.payload?.events) ? activity.payload.events : [] };
  renderRobinhoodIntelligence();
}

function screenerCard(wallet, { groupMember = false } = {}) {
  const card = document.createElement('article'); card.className = 'copy-screener-card';
  const identity = document.createElement('div'), address = document.createElement('strong'), observed = document.createElement('p');
  const summary = wallet.public_summary;
  address.textContent = `${walletAddress(wallet.source_wallet.address)} · ${chainLabel(wallet.source_wallet.chain)}`;
  address.title = wallet.source_wallet.address;
  observed.textContent = wallet.behavior?.last_trade_at ? `Last trade ${when(wallet.behavior.last_trade_at)}` : 'Open wallet for its latest trading history.';
  identity.append(address, observed);
  const metrics = document.createElement('dl');
  metrics.append(...walletActivityFacts(wallet.cached_summary));
  const pnl = realizedPerformance({realized_pnl_usdc:wallet.source_performance?.realized_pnl?.usdc, realized_pnl_sol:wallet.source_performance?.realized_pnl?.sol}, {precise:true});
  if (pnl !== 'Insufficient evidence') metrics.append(fact('Realized P&L', pnl));
  if (wallet.source_performance?.win_rate_pct != null) metrics.append(fact('Win rate', pct(wallet.source_performance.win_rate_pct)));
  if (wallet.behavior?.trade_count != null) metrics.append(fact('Trades', wallet.behavior.trade_count));
  if (wallet.behavior?.median_hold_seconds != null) metrics.append(fact('Median hold', humanDuration(wallet.behavior.median_hold_seconds)));
  metrics.hidden = !metrics.childElementCount;
  const description = document.createElement('div'); description.className = 'copy-screener-thesis';
  const labels = document.createElement('strong'), detail = document.createElement('p'), freshness = document.createElement('span');
  labels.textContent = summary?.categories?.join(' · ') || 'Wallet profile';
  detail.textContent = summary?.summary || 'The available history is still being reviewed.';
  freshness.textContent = {current:'Current',recent:'Recent',historical:'Historical',limited:'Limited history'}[summary?.data_status] || 'Limited history';
  description.append(freshness, labels, detail);
  const actions = document.createElement('div'); actions.className = 'copy-screener-card-actions';
  const open = document.createElement('button'), save = document.createElement('button'), copy = document.createElement('button');
  open.type = save.type = copy.type = 'button'; open.textContent = 'View wallet'; save.textContent = 'Save'; copy.textContent = 'Copy';
  const inspect = async button => {
    state.address = wallet.source_wallet.address; document.getElementById('copyWalletAddress').value = state.address;
    setInspectChain(wallet.source_wallet.chain, {announce:false});
    const loaded = await loadStoredWallet(wallet.source_wallet_id, button);
    if (loaded === false && groupMember) {
      await inspectWalletAddress(wallet.source_wallet.address,button);
      if (!profileNode.hidden) profileNode.scrollIntoView({behavior:'smooth',block:'start'});
    }
    return loaded;
  };
  open.addEventListener('click', () => inspect(open));
  save.addEventListener('click', () => saveResearchWallet(wallet.source_wallet_id,walletAddress(wallet.source_wallet.address),save));
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try { await inspect(copy); if (state.profile?.source_wallet?.address === wallet.source_wallet.address && state.profile?.source_wallet?.chain === wallet.source_wallet.chain) document.getElementById('copyStartSetup').click(); }
    finally { copy.disabled = false; copy.textContent = 'Copy'; }
  });
  actions.append(open);
  if (!groupMember) actions.append(save);
  if (wallet.source_wallet.chain === 'solana' && state.activation.shadow_copy && summary?.actions?.includes('open_copy_setup')) actions.append(copy);
  if (groupMember && !wallet.behavior) metrics.hidden = true;
  card.append(identity, metrics, description, actions); return card;
}

function sampledUsd(micros) {
  if (!/^\d{1,19}$/.test(String(micros || ""))) return "USD mark unavailable";
  const units = BigInt(micros), cents = (units % 1000000n / 10000n).toString().padStart(2, "0");
  return "$" + (units / 1000000n).toLocaleString("en-US") + "." + cents;
}

function walletActivityFacts(summary) {
  const seconds = summary?.age?.seconds_lower_bound;
  const knownAge = Number.isSafeInteger(seconds) && seconds >= 0;
  const age = !knownAge ? "Not indexed" : seconds < 3600 ? "<1h observed"
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h+`
    : `${Math.floor(seconds / 86400).toLocaleString()}d+`;
  const ageFact = fact("Wallet age", age);
  ageFact.title = knownAge ? `Activity observed since ${when(summary.age.first_observed_at)}. Lower bound; wallet creation date is not known.`
    : "No retained on-chain activity date yet. The date Raven discovered this address is not wallet age.";
  return [...(knownAge ? [ageFact] : []), ...[["1d", "d1"], ["7d", "d7"], ["30d", "d30"]].filter(([,key]) => Number.isSafeInteger(summary?.transactions?.[key]) && summary.transactions[key] >= 0).map(([label,key]) => {
    const count = summary?.transactions?.[key];
    const row = fact(`Transactions · ${label}`, Number.isSafeInteger(count) && count >= 0 ? `${count.toLocaleString()} seen` : "Not indexed");
    row.title = `Unique retained transactions in the last ${label}, including failures. Partial history; not a count of trades or a complete chain total.${summary?.as_of ? ` As of ${when(summary.as_of)}.` : ""}`;
    return row;
  })];
}

function observedCardMetrics(summary) {
  const metrics = document.createElement("dl");
  metrics.className = "copy-observed-facts copy-card-metrics";
  const pnlValue = realizedPerformance({ realized_pnl_usdc: summary?.pnl?.usdc, realized_pnl_sol: summary?.pnl?.sol }, { precise: true });
  const pnl = fact("Realized P&L", pnlValue);
  pnl.title = `Reconstructed closed positions with known cost basis. USDC and SOL are separate.${summary?.pnl?.as_of ? ` Analysis ${when(summary.pnl.as_of)}.` : ""} Partial history is not lifetime P&L.`;
  metrics.append(...walletActivityFacts(summary));
  if (pnlValue !== "Insufficient evidence") metrics.append(pnl);
  if (summary?.transactions?.last_observed_at) metrics.append(fact("Latest transaction", when(summary.transactions.last_observed_at)));
  if (!metrics.childElementCount) { metrics.hidden = true; return metrics; }
  const coverage = fact("Coverage", "Cached history · age is a lower bound · counts and P&L cover retained activity.");
  coverage.className = "copy-card-coverage";
  metrics.append(coverage);
  return metrics;
}

function seenWalletCard(wallet) {
  const card = document.createElement("article"); card.className = "copy-seen-wallet";
  const identity = document.createElement("div"), address = document.createElement("strong"), detail = document.createElement("p");
  address.textContent = `${walletAddress(wallet.source_wallet.address)} · ${chainLabel(wallet.source_wallet.chain)}`;
  address.title = wallet.source_wallet.address;
  detail.textContent = `Observed ${when(wallet.last_observed_at)} · ${wallet.history_available ? "bounded history cached" : "history not analyzed"}`;
  identity.append(address, detail);
  const actions = document.createElement("div"); actions.className = "copy-seen-actions";
  const save = document.createElement("button"); save.type = "button"; save.textContent = "Save";
  save.addEventListener("click", () => saveResearchWallet(wallet.source_wallet_id, walletAddress(wallet.source_wallet.address), save));
  const inspect = document.createElement("button"); inspect.type = "button"; inspect.textContent = wallet.history_available ? "Open cached" : "Inspect wallet";
  inspect.addEventListener("click", async () => {
    state.address = wallet.source_wallet.address;
    setInspectChain(wallet.source_wallet.chain, { announce: false });
    document.getElementById("copyWalletAddress").value = wallet.source_wallet.address;
    if (inspect.textContent === "Open cached") {
      if (await loadStoredWallet(wallet.source_wallet_id, inspect) === false) inspect.textContent = "Inspect wallet";
      return;
    }
    await inspectWalletAddress(wallet.source_wallet.address, inspect);
    if (!profileNode.hidden) profileNode.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  actions.append(save, inspect);
  card.dataset.sourceWalletId = wallet.source_wallet_id;
  card.append(identity, actions);
  const summary=wallet.cached_summary;
  if (summary?.age?.seconds_lower_bound != null || summary?.transactions?.d30 != null || summary?.pnl?.usdc != null || summary?.pnl?.sol != null) card.append(observedCardMetrics(summary));
  return card;
}

function renderScreener(payload) {
  document.getElementById('copyGroupPanel').hidden = true;
  const wallets = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.wallets) ? payload.wallets : Array.isArray(payload.results) ? payload.results : [];
  const seenWallets = payload.seen_wallets?.rows || [];
  const seenTotal = Number(payload.seen_wallets?.total || 0);
  const pageSize = Number(payload.pagination?.page_size || 12);
  const view = state.screener.view || (wallets.length ? "analyzed" : seenTotal > 0 ? "observed" : "analyzed");
  const observed = view === "observed";
  state.screener = {
    chain: payload.scope?.chain || state.screener.chain,
    page: Number(payload.pagination?.page || payload.page || state.screener.page || 1),
    total_pages: Math.min(Number(payload.pagination?.maximum_page || 25), observed ? Math.ceil(seenTotal / pageSize) : Number(payload.pagination?.total_pages || payload.total_pages || 0)),
    total: Number(payload.pagination?.total_matching_rows || payload.pagination?.total || payload.total || wallets.length),
    wallets,
    preset: state.screener.preset,
    view,
  };
  document.querySelectorAll("[data-wallet-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.walletView === view)));
  document.getElementById("copyScreenerFilters").hidden = observed;
  document.getElementById("copyPresetRail").hidden = observed;
  const scopeLabel = chainLabel(state.screener.chain);
  const coverage = payload.index_coverage;
  const chains = (coverage?.chains || []).filter((row) => state.screener.chain === "all" || row.chain === state.screener.chain);
  const indexed = chains.reduce((total, row) => total + Number(row.indexed_wallets || 0), 0);
  const seen = chains.reduce((total, row) => total + Number(row.seen_wallets || 0), 0);
  const indexEmpty = Array.isArray(coverage?.chains) && indexed === 0;
  setText("copyScreenerCount", observed ? `${seenTotal.toLocaleString()} observed` : `${state.screener.total.toLocaleString()} match${state.screener.total === 1 ? "" : "es"}`);
  setText("copyScreenerCoverage", coverage
    ? `${seen.toLocaleString()} wallets discovered by Raven in ${scopeLabel} · ${indexed.toLocaleString()} analyzed profiles. Browse the available profiles or inspect a wallet for more history.`
    : "Browse wallets across supported chains, or look up an address.");
  setText("copyScreenerStatus", observed
    ? `${seenTotal.toLocaleString()} observed in ${scopeLabel}. Choose a wallet to analyze.`
    : wallets.length
    ? `${wallets.length} ${scopeLabel} wallet${wallets.length === 1 ? "" : "s"} · available trading history`
      : indexEmpty ? "Wallet profiles are still being indexed."
      : `No matching wallet in ${scopeLabel}.`);
  const host = document.getElementById("copyScreenerResults");
  host.hidden = observed;
  host.replaceChildren(...(wallets.length ? wallets.map(screenerCard) : [empty(indexEmpty ? "No completed profiles yet" : "No matching wallets", indexEmpty
    ? "Profiles for this chain are being prepared. You can inspect a wallet address now."
    : "Adjust the filters or inspect a wallet address.")]));
  if(!observed && !wallets.length && seen > 0) {
    const browse=document.createElement("button");browse.type="button";browse.className="raven-button";
    browse.textContent=`Browse ${seen.toLocaleString()} discovered wallets`;
    browse.addEventListener("click",()=>document.querySelector('[data-wallet-view="observed"]')?.click());
    const note=document.createElement("p");
    note.textContent="Browse cached addresses while deeper profiles are built. Your analysis filters stay saved.";
    host.append(note,browse);
  }
  const seenSection = document.getElementById("copySeenWallets");
  seenSection.hidden = !observed;
  setText("copySeenCount", `${seenTotal.toLocaleString()} observed`);
  const marketEvidence = payload.seen_wallets?.market_evidence_enabled === true;
  document.querySelectorAll("[data-observed-advanced]").forEach(node => { node.hidden = !(marketEvidence && state.access.advanced_wallet_intelligence); });
  document.getElementById("copyObservedScope").hidden = !marketEvidence;
  document.getElementById("copySeenResults").replaceChildren(...(seenWallets.length ? seenWallets.map(seenWalletCard)
    : [empty("No retained observations match", "Adjust the observed-wallet filters, choose another chain or inspect an address. Browsing does not start a wallet-history lookup.")]));
  const pages = document.getElementById("copyScreenerPages");
  pages.hidden = state.screener.total_pages <= 1;
  setText("copyScreenPage", `Page ${state.screener.page} of ${Math.max(1, state.screener.total_pages)}`);
  document.getElementById("copyScreenPrevious").disabled = state.screener.page <= 1;
  document.getElementById("copyScreenNext").disabled = state.screener.page >= state.screener.total_pages;
}

async function loadScreener() {
  if (!state.activation.wallet_screener) return;
  const requestId = ++state.screener_request;
  if (state.activation.wallet_groups) {
    setText('copyScreenerCount','Loading');setText('copyScreenerStatus','Loading wallet groups…');
    document.getElementById('copyScreenerResults').replaceChildren();
    document.getElementById('copyGroupPanel').hidden=true;
    document.getElementById('copySeenWallets').hidden=true;
    document.getElementById('copyScreenerPages').hidden=true;
    const params = new URLSearchParams({chain:state.screener.chain,page:String(state.screener.view === 'groups' ? state.screener.page : 1),page_size:'12',history:document.getElementById('copyGroupHistory').value});
    if (state.groups.selected && state.screener.view === 'groups') params.set('group_id',state.groups.selected);
    const grouped = await api(`${API}/groups?${params}`);
    if (requestId !== state.screener_request) return;
    const populated = grouped.response.ok && grouped.payload?.groups?.length > 0;
    document.getElementById('copyWalletGroupsTab').hidden = !populated && state.screener.view !== 'groups';
    if (populated && (!state.screener.view || state.screener.view === 'groups')) {
      state.screener.view = 'groups'; renderWalletGroupPage(grouped.payload); return;
    }
    if (state.screener.view === 'groups' && !grouped.response.ok) {
      setText('copyScreenerCount','Unavailable');
      setText('copyScreenerStatus','Wallet groups could not refresh. Retry or browse wallet history.');
      document.getElementById('copyScreenerResults').replaceChildren();
      document.getElementById('copyScreenerResults').hidden=false;
      document.getElementById('copyScreenerFilters').hidden=true;
      document.getElementById('copyPresetRail').hidden=true;
      document.getElementById('copyScreenerPages').hidden = true;
      const retry=document.createElement('button');retry.type='button';retry.textContent='Retry wallet groups';
      retry.addEventListener('click',()=>void loadScreener());document.getElementById('copyScreenerResults').append(retry);
      return;
    }
    if (state.screener.view === 'groups') { state.screener.view = null;state.screener.page = 1;state.groups.selected = null;document.getElementById('copyWalletGroupsTab').hidden = true; }
  } else {
    document.getElementById('copyWalletGroupsTab').hidden=true;
    if (state.screener.view === 'groups') state.screener.view = null;
  }
  const scopeLabel = chainLabel(state.screener.chain);
  setText("copyScreenerStatus", `Screening ${scopeLabel}…`);
  setText("copyScreenerCount", "Loading");
  setText("copyScreenerCoverage", `Loading Raven’s cached ${scopeLabel} wallet index…`);
  document.getElementById("copyScreenerResults").replaceChildren();
  document.getElementById("copySeenWallets").hidden = true;
  document.getElementById("copyScreenerPages").hidden = true;
  document.getElementById("copyScreenerFilters").hidden = state.screener.view === 'observed';
  document.getElementById("copyPresetRail").hidden = state.screener.view === 'observed';
  const result = await api(`${API}/screener`, { method: "POST", body: JSON.stringify(screenerRequest()) });
  if (requestId !== state.screener_request) return;
  if (!result.response.ok) {
    setText("copyScreenerCount", "Unavailable");
    setText("copyScreenerCoverage", `The ${scopeLabel} wallet index could not be loaded. Retry to check current coverage.`);
    setText("copyScreenerStatus", "Screener unavailable. Address lookup remains available.");
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'raven-button'; retry.textContent = 'Retry wallet screener';
    retry.addEventListener('click', () => void loadScreener());
    document.getElementById("copyScreenerResults").replaceChildren(empty("Screener unavailable", "Try again or inspect an address."), retry);
    document.getElementById("copyScreenerResults").hidden = false;
    document.getElementById("copySeenWallets").hidden = true;
    document.getElementById("copyScreenerPages").hidden = true;
    return;
  }
  renderScreener(result.payload);
}

function renderWalletGroupPage(payload) {
  const groups=payload.groups, selected=groups.find(group=>group.group_id===payload.selected_group_id);
  state.groups.selected=selected?.group_id || null;
  state.groups.cards.clear();
  for (const row of payload.rows || []) state.groups.cards.set(`${row.source_wallet.chain}:${row.source_wallet.address}`,{card:row.public_summary,received_at:Date.now()});
  state.screener.page=payload.pagination.page;state.screener.total_pages=payload.pagination.total_pages;state.screener.total=payload.pagination.total;
  document.querySelectorAll('[data-wallet-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.walletView==='groups')));
  document.getElementById('copyGroupPanel').hidden=false;
  for(const id of ['copyScreenerFilters','copyPresetRail','copySeenWallets']) document.getElementById(id).hidden=true;
  const host=document.getElementById('copyScreenerResults');host.hidden=false;
  setText('copyScreenerCount',`${payload.pagination.total.toLocaleString()} wallets`);
  setText('copyScreenerCoverage','Explore wallets by trading style. Open a wallet for its trading history or choose Copy to set up your own rules.');
  setText('copyScreenerStatus',selected ? `${selected.title} · ${chainLabel(selected.chain)}` : 'This group changed. Choose an available group.');
  const buttons=groups.map(group=>{
    const button=document.createElement('button');button.type='button';
    button.textContent=`${group.title} · ${chainLabel(group.chain)} (${group.count.toLocaleString()})`;
    button.setAttribute('aria-pressed',String(group.group_id===state.groups.selected));
    button.addEventListener('click',()=>{state.groups.selected=group.group_id;state.screener.page=1;void loadScreener();});return button;
  });
  document.getElementById('copyGroupChoices').replaceChildren(...buttons);
  host.replaceChildren(...(payload.rows || []).map(row=>screenerCard(row,{groupMember:true})));
  document.getElementById('copyScreenerPages').hidden=payload.pagination.total_pages<=1;
  setText('copyScreenPage',`Page ${payload.pagination.page} of ${Math.max(1,payload.pagination.total_pages)}`);
  document.getElementById('copyScreenPrevious').disabled=!payload.pagination.has_previous;
  document.getElementById('copyScreenNext').disabled=!payload.pagination.has_next;
}

function renderCollections() {
  setText("copyWatchCount", state.watches.length);
  const feed = [
    ...state.decisions.map((row) => ({ row, card: decisionCard, at: row.timing?.policy_decided_at })),
    ...state.exit_decisions.map((row) => ({ row, card: exitDecisionCard, at: row.timing?.policy_decided_at })),
  ].sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0));
  setText("copyDecisionCount", feed.length);
  setText("copyPositionCount", state.positions.length);
  const watches = document.getElementById("copyWatches");
  const decisions = document.getElementById("copyDecisions");
  const positions = document.getElementById("copyPositions");
  watches.replaceChildren(...(state.watches.length ? state.watches.map(watchCard) : [empty("No wallets shadowed", "Inspect a wallet to begin.")]));
  decisions.replaceChildren(...(feed.length ? feed.map((item) => item.card(item.row)) : [empty("No shadow decisions", "Approvals and refusals appear here.")]));
  positions.replaceChildren(...(state.positions.length ? state.positions.map(positionCard) : [empty("No shadow positions", "Qualified buys appear here.")]));
}

async function loadWorkspace() {
  const [watches, decisions, positions] = await Promise.all([
    api(`${API}/watches`),
    api(`${API}/decisions`),
    api(`${API}/positions`),
  ]);
  state.watches = watches.response.ok ? watches.payload.watches || [] : [];
  state.decisions = decisions.response.ok ? decisions.payload.decisions || [] : [];
  state.exit_decisions = decisions.response.ok ? decisions.payload.exit_decisions || [] : [];
  state.positions = positions.response.ok ? positions.payload.positions || [] : [];
  renderCollections();
}

async function inspectWalletAddress(address, button, { refresh = false } = {}) {
  const requestId = ++state.profile_request;
  const requestedAddress = String(address || "").trim();
  const sameWallet = state.profile?.source_wallet?.chain === state.inspect_chain
    && (state.inspect_chain === "solana" ? state.profile.source_wallet.address === requestedAddress
      : state.profile.source_wallet.address.toLowerCase() === requestedAddress.toLowerCase());
  state.activity_request += 1;
  if (!sameWallet) {
    state.source_wallet_id = null;
    state.profile = null;
    state.deep_history = null;
    state.events = [];
    state.activity = { filter: "all", next_cursor: null, has_more: false, provider_has_more: false, matching_event_count: 0, loading: false, on_demand_only: false };
    state.on_demand_events = [];
  }
  document.getElementById("copyActivityFilter").disabled = false;
  state.policy_source = null;
  state.deep_poll_token += 1;
  clearTimeout(state.deep_poll_timer);
  state.address = requestedAddress;
  profileNode.hidden = !sameWallet;
  policyNode.hidden = true;
  const idleLabel = button.dataset.idleLabel || button.textContent || "Analyze wallet";
  button.disabled = true;
  button.textContent = "Analyzing…";
  inspectionFeedback(button, "Checking Raven’s stored observations…");
  const result = await api(`${API}/inspect`, { method: "POST", body: JSON.stringify({ address: state.address, chain: state.inspect_chain, ...(refresh ? { refresh: true } : {}) }) });
  button.disabled = false;
  button.textContent = idleLabel;
  if (requestId !== state.profile_request) return;
  if (!result.response.ok) {
    if (!state.session_expired) {
      const reasons = {
        wallet_analysis_in_progress: "Raven is already analyzing this wallet. Try again shortly to reuse that scan.",
        wallet_history_unavailable: "Wallet history is temporarily unavailable. Try again shortly.",
        wallet_copy_response_too_large: "This wallet's analysis is too large to display. Its stored history is retained.",
        wallet_copy_rate_limited: "The lookup limit was reached. Wait a few minutes before refreshing.",
      };
      inspectionFeedback(button, `${reasons[result.payload?.error] || "Wallet inspection could not finish. Try again shortly."}${sameWallet ? " Your previous analysis remains available." : ""}`);
    }
    return;
  }
  setText("copySearchStatus", result.payload?.provider_request_performed === false
    ? `Stored analysis · ${when(result.payload.freshness?.observed_at)}. ${result.payload.refresh_state === "provider_unavailable" ? "Refresh unavailable; previous evidence retained." : "Shared scan reused."}`
    : result.payload?.persistence?.state === "on_demand_only" ? "On-demand evidence ready. Trade P&L is not inferred." : "Analysis ready.");
  inspectionFeedback(button, document.getElementById("copySearchStatus").textContent);
  renderProfile(result.payload);
}

async function inspectWallet(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  await inspectWalletAddress(document.getElementById("copyWalletAddress").value, button);
}

function setInspectChain(chain, { announce = true } = {}) {
  const allowed = new Set(["solana", "robinhood", "bsc", "base", "ethereum"]);
  state.inspect_chain = allowed.has(chain) ? chain : "solana";
  document.getElementById("copyWalletChain").value = state.inspect_chain;
  const address = document.getElementById("copyWalletAddress");
  const evm = state.inspect_chain !== "solana";
  address.maxLength = evm ? 42 : 44;
  address.placeholder = evm ? "0x…" : "7Kx…9qP";
  if (announce) setText("copySearchStatus", `${chainLabel(state.inspect_chain)} wallet lookup.`);
}

async function savePolicy(event) {
  event.preventDefault();
  const source = state.policy_source;
  if (!source || source.chain !== "solana" || source.address !== state.profile?.source_wallet?.address || source.address !== state.address || !state.activation.shadow_copy) {
    setText("copyPolicyStatus", "Inspect the source wallet again before saving a copy policy.");
    return;
  }
  let policy;
  try { policy = policyPayload(); }
  catch { setText("copyPolicyStatus", "Current fee policy unavailable. Refresh this page."); return; }
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setText("copyPolicyStatus", "Saving policy…");
  const result = await api(`${API}/watches`, {
    method: "POST",
    body: JSON.stringify({ address: source.address, label: document.getElementById("copyPolicyLabel").value, policy }),
  });
  button.disabled = false;
  if (!result.response.ok) {
    setText("copyPolicyStatus", "Policy not saved. Check values.");
    return;
  }
  policyNode.hidden = true;
  await loadWorkspace();
  switchView("watching");
}

async function boot(checkedSession) {
  const requestedUrl = new URL(walletLocationHref());
  const requestedWallet = requestedUrl.searchParams.get("wallet") || "";
  const requestedChain = requestedUrl.searchParams.get("inspect_chain") || requestedUrl.searchParams.get("chain") || "solana";
  const safeRequestedChain = new Set(["solana", "robinhood", "bsc", "base", "ethereum"]).has(requestedChain) ? requestedChain : "solana";
  document.getElementById("copyWalletChain").value = safeRequestedChain;
  setInspectChain(document.getElementById("copyWalletChain").value);
  if (requestedWallet) document.getElementById("copyWalletAddress").value = requestedWallet.slice(0, 44);
  state.address = requestedWallet.slice(0, 44);
  document.querySelectorAll('input[name="return_to"]').forEach(input => { input.value = walletReturnTo(); });
  const session = checkedSession || await readAccountSession();
  if (session.state === 'unavailable') {
    if (state.session_expired) return;
    page.dataset.copyState = "unavailable";
    unavailable.hidden = false;
    setText("copyWorkspaceState", "Account service unavailable");
    setText("copyUnavailableReason", "Your session could not be checked. Please try again shortly. Your account and saved research are unchanged.");
    return;
  }
  if (session.state === 'signed_out') {
    page.dataset.copyState = "signed-out";
    signIn.hidden = false;
    setText("copyWorkspaceState", "Sign in required");
    return;
  }
  state.csrf = session.payload.csrf_token || "";
  await loadTradingSettings().catch(() => {});
  const username = String(session.payload.account?.username || "").trim().toLowerCase();
  setText("copyWorkspaceIdentity", /^[a-z][a-z0-9_]{2,23}$/.test(username) ? `@${username}` : "Signed in");
  const summary = await api(API);
  if (!summary.response.ok) {
    if (state.session_expired) return;
    page.dataset.copyState = "unavailable";
    unavailable.hidden = false;
    setText("copyWorkspaceState", "Unavailable");
    setText("copyUnavailableReason", "Wallet Intelligence is temporarily unavailable.");
    return;
  }
  applyAccess(summary.payload.access || {});
  state.activation = summary.payload.activation || {};
  state.product = summary.payload.copy_product || {};
  const feeBps = state.product.standard_execution_fee_bps;
  setText("copyPolicyFee", Number.isSafeInteger(feeBps) ? `${(feeBps / 100).toFixed(2)}% · simulated in Shadow` : "Current fee unavailable");
  setText("copyPolicyCashback", Number.isSafeInteger(state.product.pro_cashback_percent)
    ? `No additional Copy surcharge. Active Pro members receive ${state.product.pro_cashback_percent}% of confirmed Raven fees back. Shadow results exclude cashback and earn no rewards.`
    : "Same fee as Terminal. No additional Copy surcharge.");
  page.dataset.copyState = "active";
  workspace.hidden = false;
  setText("copyWorkspaceState", state.access.advanced_wallet_intelligence ? "Pro intelligence ready" : "Wallet tools ready");
  setText("copyWatchingDescription", state.activation.continuous_observer
    ? "Watched wallets update automatically."
    : state.activation.shadow_copy ? "Check wallets, then review approved copies in Terminal." : "Free access · activation pending.");
  setText("copyWatchingBadge", state.activation.continuous_observer ? "Monitoring" : state.activation.shadow_copy ? "Shadow + manual review" : "Opening soon");
  if (state.activation.shadow_copy) await loadWorkspace();
  if (state.activation.wallet_screener) {
    document.getElementById("copyScreener").hidden = false;
    hydrateScreenerFromUrl();
    await Promise.all([loadScreener(), loadSavedResearch(), loadRobinhoodIntelligence()]);
  }
  if (state.session_expired) return;
  if (requestedWallet) {
    const button = document.querySelector('#copyWalletSearch button[type="submit"]');
    await inspectWalletAddress(requestedWallet, button);
    if (requestedUrl.searchParams.get("intent") === "copy") {
      const setup=document.getElementById("copyStartSetup");
      if (!setup.disabled) setup.click(); else setup.scrollIntoView({block:"center"});
    }
  }
  if (requestedUrl.searchParams.get("view") === "watching") switchView("watching");
}

bindAuthStartForms();
document.querySelectorAll("[data-copy-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.copyView)));
document.querySelector('.copy-profile-nav a[href="#copyRavenEvidence"]')?.addEventListener("click", () => {
  document.getElementById("copyRavenEvidence").open = true;
});
document.getElementById("copyWalletSearch").addEventListener("submit", inspectWallet);
document.getElementById("copyWalletChain").addEventListener("change", (event) => setInspectChain(event.currentTarget.value));
document.getElementById("copyRefreshHistoryStatus").addEventListener("click", async (event) => {
  const sourceId = state.source_wallet_id;
  if (!sourceId) return;
  const button = event.currentTarget;
  const token = ++state.deep_poll_token;
  clearTimeout(state.deep_poll_timer);
  state.deep_poll_attempts = 0;
  button.disabled = true;
  try {
    const result = await api(`${API}/wallets/${encodeURIComponent(sourceId)}`);
    if (token !== state.deep_poll_token || sourceId !== state.source_wallet_id) return;
    if (result.response.ok) renderProfile(result.payload, { scroll: false, from_poll: true });
    else setText("copyDeepHistoryDetail", "History status unavailable. Retained evidence is unchanged.");
  } catch {
    if (token === state.deep_poll_token) setText("copyDeepHistoryDetail", "History status unavailable. Try again shortly.");
  } finally { button.disabled = false; }
});
document.getElementById("copyRefreshProfile").addEventListener("click", (event) => inspectWalletAddress(state.address, event.currentTarget, { refresh: true }));
document.getElementById("copySaveProfile").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.dataset.action === "refresh") {
    await inspectWalletAddress(state.address, button, { refresh: true });
    return;
  }
  await saveResearchWallet(state.source_wallet_id, walletAddress(state.address), button);
});
document.getElementById("copyStartSetup").addEventListener("click", () => {
  const source = state.profile?.source_wallet;
  if (!source || source.chain !== "solana" || !state.activation.shadow_copy) return;
  state.policy_source = { chain: source.chain, address: source.address };
  exitStrategyOptions(document.getElementById('copyPolicyExitStrategy'), currentTradingSettings()?.settings.selected_strategy_id);
  setText("copyPolicySource", `${chainLabel(source.chain)} · ${source.address}`);
  setText("copyPolicyStatus", "");
  policyNode.hidden = false;
  policyNode.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("copyPolicyLabel").focus({ preventScroll: true });
});
document.getElementById("copyCancelSetup").addEventListener("click", () => { policyNode.hidden = true; });
document.getElementById("copyPolicy").addEventListener("submit", savePolicy);
document.getElementById('copyManageStrategies')?.addEventListener('click', () => {
  void openTradingSettings({ tab: 'strategies', chain: 'solana', symbol: 'SOL' });
});
subscribeTradingSettings(() => {
  const select = document.getElementById('copyPolicyExitStrategy');
  exitStrategyOptions(select, select?.value);
  document.querySelectorAll('[data-watch-id] select').forEach(select => exitStrategyOptions(select, select.value));
});
document.querySelectorAll("[data-wallet-view]").forEach(button => button.addEventListener("click", async () => {
  if (button.dataset.walletView === state.screener.view) return;
  state.screener.view = button.dataset.walletView;
  state.screener.page = 1;
  syncScreenerUrl();
  await loadScreener();
}));
document.getElementById("copyObservedFilters").addEventListener("submit", async event => {
  event.preventDefault(); state.screener.page = 1; state.screener.view = "observed"; syncScreenerUrl(); await loadScreener();
});
document.getElementById("copyObservedReset").addEventListener("click", async () => {
  document.getElementById("copyObservedFilters").reset(); state.screener.page = 1; syncScreenerUrl(); await loadScreener();
});
document.getElementById("copyScreenerFilters").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.screener.page = 1;
  syncScreenerUrl();
  await loadScreener();
});
document.getElementById("copyScreenReset").addEventListener("click", async () => {
  document.getElementById("copyScreenerFilters").reset();
  state.screener.preset = null;
  document.querySelectorAll("[data-screen-preset]").forEach((button) => button.setAttribute("aria-pressed", "false"));
  state.screener.page = 1;
  syncScreenerUrl();
  await loadScreener();
});
document.querySelectorAll("[data-screen-preset]").forEach((button) => button.addEventListener("click", async () => {
  state.screener.preset = state.screener.preset === button.dataset.screenPreset ? null : button.dataset.screenPreset;
  document.querySelectorAll("[data-screen-preset]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate.dataset.screenPreset === state.screener.preset)));
  if (state.screener.preset === "swing_trades") document.getElementById("copyScreenActive").value = "168";
  state.screener.page = 1;
  syncScreenerUrl();
  await Promise.all([loadScreener(), loadRobinhoodIntelligence()]);
}));
document.querySelectorAll("[data-screen-chain]").forEach((button) => button.addEventListener("click", async () => {
  const chain = button.dataset.screenChain;
  if (!new Set(["all", "solana", "robinhood", "base", "ethereum", "bsc"]).has(chain) || chain === state.screener.chain) return;
  state.screener.chain = chain;
  state.groups.selected = null;
  setPreference("walletChain", chain);
  state.screener.page = 1;
  document.querySelectorAll("[data-screen-chain]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate.dataset.screenChain === chain)));
  syncScreenerUrl();
  await Promise.all([loadScreener(), loadRobinhoodIntelligence()]);
}));
document.getElementById('copyGroupHistory').addEventListener('change',()=>{state.groups.selected=null;state.screener.page=1;void loadScreener();});
document.getElementById("copyScreenPrevious").addEventListener("click", async () => {
  state.screener.page = Math.max(1, state.screener.page - 1);
  await loadScreener();
});
document.getElementById("copyScreenNext").addEventListener("click", async () => {
  state.screener.page += 1;
  await loadScreener();
});
document.getElementById("copyActivityFilter").addEventListener("change", () => loadWalletActivity({ append: false }));
document.getElementById("copyActivityMore").addEventListener("click", () => loadWalletActivity({ append: true }));

function startWalletWorkspace(checkedSession) { return boot(checkedSession).catch(() => {
  page.dataset.copyState = "unavailable";
  unavailable.hidden = false;
  setText("copyWorkspaceState", "Unavailable");
  setText("copyUnavailableReason", "Raven Copy could not verify this session. No wallet data was loaded.");
}); }
if (page.dataset.embedded !== 'true') walletBootPromise = startWalletWorkspace();
export async function openEmbeddedIntelligence(href) {
  embeddedActive = true; embeddedUrl = href;
  if (!walletBootPromise) { walletBootPromise = startWalletWorkspace(); await walletBootPromise; return; }
  await walletBootPromise;
  const session = await readAccountSession();
  if (session.state === 'unavailable') {
    state.deep_poll_token += 1; clearTimeout(state.deep_poll_timer);
    workspace.hidden = true; signIn.hidden = true; unavailable.hidden = false;
    page.dataset.copyState = 'unavailable';
    setText('copyWorkspaceState', 'Account check unavailable');
    setText('copyUnavailableReason', 'Your account could not be checked. Reopen Wallet Intelligence to retry.');
    return;
  }
  if (session.state === 'signed_out') { recoverWalletSession(); return; }
  if (state.session_expired || !state.csrf || state.csrf !== session.payload.csrf_token || !unavailable.hidden) {
    state.session_expired = false; signIn.hidden = true; unavailable.hidden = true;
    walletBootPromise = startWalletWorkspace(session); await walletBootPromise; return;
  }
  const request = new URL(href), wallet = request.searchParams.get('wallet');
  const chain = request.searchParams.get('inspect_chain') || request.searchParams.get('chain') || 'solana';
  if (wallet && new Set(['solana','robinhood','bsc','base','ethereum']).has(chain)) {
    document.getElementById('copyWalletChain').value = chain; setInspectChain(chain);
    document.getElementById('copyWalletAddress').value = wallet.slice(0, 44);
    await inspectWalletAddress(wallet.slice(0, 44), document.querySelector('#copyWalletSearch button[type="submit"]'));
  } else scheduleDeepHistoryPoll(state.deep_poll_token);
}
export function suspendEmbeddedIntelligence() {
  embeddedActive = false; clearTimeout(state.deep_poll_timer); state.deep_poll_token += 1;
}

window.RavenOSWalletCopy = Object.freeze({
  schemaVersion: "ravenos.wallet_copy_surface.v1",
  accessModel: Object.freeze({ authenticatedBasics: true, copySubscriptionRequired: false, advancedIntelligence: "raven_pro" }),
  liveCopy: false,
  manualCopy: true,
  signing: false,
  broadcasting: false,
  feeCollection: false,
});

for (const id of ["copySavedChain", "copySavedSearch"]) document.getElementById(id).addEventListener("input", renderSavedResearch);
document.getElementById("copySavedRetry").addEventListener("click", loadSavedResearch);

// Period changes and token filtering operate entirely on the current cached snapshot.
document.getElementById("copyOverviewPeriod").addEventListener("change", event => {
  setPreference("walletPeriod", event.currentTarget.value);
  renderWalletRecord();
});
document.getElementById("copyTokenSearch").addEventListener("input", renderWalletRecord);
document.getElementById("copyProfileCopyAddress").addEventListener("click", async event => {
  if (!state.address) return;
  const button = event.currentTarget;
  try { await navigator.clipboard.writeText(state.address); button.textContent = "Address copied"; }
  catch { button.textContent = "Select address to copy"; }
});
