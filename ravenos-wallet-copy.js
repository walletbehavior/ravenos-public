const API = "/api/v1/wallet-copy";
const page = document.querySelector(".copy-page");
const signIn = document.getElementById("copySignIn");
const unavailable = document.getElementById("copyUnavailable");
const workspace = document.getElementById("copyWorkspace");
const profileNode = document.getElementById("copyProfile");
const policyNode = document.getElementById("copyPolicy");
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_WRAPPED_NATIVE = "So11111111111111111111111111111111111111112";

const state = {
  csrf: "",
  activation: {},
  address: "",
  profile: null,
  events: [],
  watches: [],
  decisions: [],
  positions: [],
  copyability: [],
  screener: { page: 1, total_pages: 0, total: 0, wallets: [] },
};

function text(value, fallback = "—") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value ?? "");
}

function shortAddress(value) {
  const address = text(value, "Wallet");
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
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

function realizedPerformance(performance) {
  const values = [];
  if (performance.realized_pnl_usdc !== null && performance.realized_pnl_usdc !== undefined) {
    values.push(`${Number(performance.realized_pnl_usdc) >= 0 ? "+" : ""}${money(performance.realized_pnl_usdc)}`);
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

function readable(value) {
  return text(value).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(number);
}

function exactAssetAmount(endpoint) {
  if (!endpoint || !/^-?\d+$/.test(String(endpoint.amount_base_units ?? ""))) return "Unavailable";
  const decimals = Number(endpoint.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "Unavailable";
  let units = BigInt(endpoint.amount_base_units);
  const sign = units < 0n ? "-" : "";
  if (units < 0n) units = -units;
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 6);
  const mint = String(endpoint.mint || "");
  const asset = mint === SOLANA_USDC ? "USDC" : new Set([SOLANA_WRAPPED_NATIVE, "native_sol"]).has(mint) ? "SOL" : shortAddress(mint);
  return `${sign}${whole}${fraction ? `.${fraction}` : ""} ${asset}`;
}

async function api(url, init = {}) {
  const headers = { accept: "application/json", ...(init.headers || {}) };
  if (init.method && init.method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-ravenos-csrf"] = state.csrf;
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers });
  return { response, payload: await response.json().catch(() => null) };
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

function eventCard(event) {
  const card = document.createElement("article");
  card.className = "copy-event-card";
  const head = document.createElement("header");
  const kind = document.createElement("strong");
  const time = document.createElement("span");
  kind.textContent = readable(event.classification?.kind);
  time.textContent = when(event.chain_evidence?.block_time);
  head.append(kind, time);
  const details = document.createElement("dl");
  details.append(
    fact("Evidence", readable(event.classification?.confidence)),
    fact("Cost basis", readable(event.economic?.cost_basis_state)),
    fact("Paid", exactAssetAmount(event.economic?.source_asset)),
    fact("Received", exactAssetAmount(event.economic?.destination_asset)),
  );
  const signature = document.createElement("a");
  signature.href = `https://solscan.io/tx/${encodeURIComponent(event.chain_evidence?.signature || "")}`;
  signature.target = "_blank";
  signature.rel = "noopener noreferrer";
  signature.textContent = `View transaction · ${shortAddress(event.chain_evidence?.signature)}`;
  card.append(head, details, signature);
  return card;
}

function activeCopyability() {
  const watch = state.watches.find((row) => row.source_wallet?.address === state.address);
  return watch ? state.copyability.find((row) => row.watch_id === watch.watch_id) || null : null;
}

function renderFollowerReality() {
  const record = activeCopyability();
  const overall = record?.snapshot || null;
  const rail = Array.isArray(record?.by_size) ? record.by_size : [25, 100, 500, 1_000, 5_000].map((size) => ({ order_size_usdc: size, state: "insufficient_evidence", score: null, prospective_sample_count: 0, components: {} }));
  setText("copyFollowerHeadline", overall?.prospective_sample_count
    ? `${overall.prospective_sample_count} new-trade test${overall.prospective_sample_count === 1 ? "" : "s"} · ${overall.state === "available" ? `copyability ${overall.score}/100` : "score forming"}`
    : "Copy evidence starts after you shadow");
  const metrics = document.getElementById("copyFollowerMetrics");
  metrics.replaceChildren(
    fact("Executable copies", overall?.components?.policy_pass_pct === null || overall?.components?.policy_pass_pct === undefined ? "Not sampled" : pct(overall.components.policy_pass_pct)),
    fact("Entry available", overall?.components?.entry_executable_pct === null || overall?.components?.entry_executable_pct === undefined ? "Not sampled" : pct(overall.components.entry_executable_pct)),
    fact("Exit available", overall?.components?.exit_executable_pct === null || overall?.components?.exit_executable_pct === undefined ? "Not sampled" : pct(overall.components.exit_executable_pct)),
    fact("Entry degradation", overall?.components?.median_entry_degradation_bps === null || overall?.components?.median_entry_degradation_bps === undefined ? "Not sampled" : bpsAsPercent(overall.components.median_entry_degradation_bps)),
  );
  const capacity = document.getElementById("copyCapacityRail");
  capacity.replaceChildren(...rail.map((row) => {
    const item = document.createElement("div");
    const size = document.createElement("span");
    const result = document.createElement("strong");
    const sample = document.createElement("small");
    size.textContent = money(row.order_size_usdc).replace(".00", "");
    result.textContent = row.state === "available" && row.score !== null ? `${row.score}/100` : "Not sampled";
    sample.textContent = `${Number(row.prospective_sample_count || 0)} decision${Number(row.prospective_sample_count || 0) === 1 ? "" : "s"}`;
    item.append(size, result, sample);
    return item;
  }));
  setText("copyFollowerLimit", overall?.prospective_sample_count
    ? "Shadow tests include approved, skipped, unavailable, and unresolved trades. Historical source returns are never substituted."
    : "Historical source returns never become hypothetical follower fills.");
}

function renderProfile(payload) {
  state.profile = payload.profile;
  state.events = payload.recent_events || [];
  state.address = payload.profile?.source_wallet?.address || state.address;
  const profile = state.profile;
  profileNode.hidden = false;
  policyNode.hidden = true;
  setText("copyProfileAddress", shortAddress(state.address));
  setText("copyProfileCoverage", `${profile.coverage.transactions_observed} transactions · ${profile.coverage.trade_events} trade events · ${profile.coverage.known_cost_basis_pct === null ? "cost basis unresolved" : `${profile.coverage.known_cost_basis_pct.toFixed(1)}% known cost basis`}`);
  const performance = profile.source_performance;
  setText("copySourcePnl", realizedPerformance(performance));
  const sourceMetrics = document.getElementById("copySourceMetrics");
  sourceMetrics.replaceChildren(
    fact("ROI", pct(performance.roi_pct)),
    fact("Win rate", pct(performance.win_rate_pct)),
    fact("Closed lots", performance.closed_lots),
    fact("Median hold", profile.behavior.median_hold_seconds === null ? "Unavailable" : `${Math.round(profile.behavior.median_hold_seconds / 60)}m`),
    fact("Trades", profile.behavior.trade_count),
    fact("Tokens", profile.behavior.tokens_traded ?? "Unavailable"),
    fact("Active days", profile.behavior.active_days),
    fact("Known basis", pct(profile.coverage.known_cost_basis_pct)),
    fact("Avg buy", basisNotional(profile.behavior, "average")),
    fact("Total buys", basisNotional(profile.behavior, "total")),
    fact("Trade rate", profile.behavior.trade_rate_per_active_day === null || profile.behavior.trade_rate_per_active_day === undefined ? "Unavailable" : `${profile.behavior.trade_rate_per_active_day}/day`),
    fact("Last trade", when(profile.behavior.last_trade_at)),
  );
  renderFollowerReality();
  setText("copySourceLimits", performance.limitations?.join(" ") || "No material limitations reported.");
  setText("copyEventCount", `${state.events.length} event${state.events.length === 1 ? "" : "s"}`);
  const events = document.getElementById("copyRecentEvents");
  events.replaceChildren(...state.events.map(eventCard));
  profileNode.scrollIntoView({ behavior: "smooth", block: "start" });
}

function policyPayload() {
  const size = Number(document.getElementById("copyPolicySize").value);
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
    hypothetical_raven_fee_bps: Number(document.getElementById("copyPolicyFee").value),
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
  address.textContent = shortAddress(watch.source_wallet.address);
  main.append(stateLabel, title, address);
  const details = document.createElement("dl");
  details.append(
    fact("Order", `${money(watch.policy.sizing.fixed_usdc)} USDC`),
    fact("Round trip max", pct(watch.policy.execution_quality.maximum_round_trip_friction_pct)),
    fact("Last observed", when(watch.source_state.last_observed_at)),
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
    if ((result.payload.decisions || []).length) switchView("feed");
  });
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    await api(`${API}/watches/${encodeURIComponent(watch.watch_id)}`, { method: "DELETE", body: JSON.stringify({ confirm: "delete_wallet_watch" }) });
    await loadWorkspace();
  });
  actions.append(refresh, remove);
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
  evidence.title = "Hypothetical only. No fee was charged or collected.";
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
  detail.textContent = `Source ${shortAddress(position.source_wallet?.address)}`;
  main.append(stateLabel, title, detail);
  const facts = document.createElement("dl");
  facts.append(
    fact("Entry cost", money(position.entry_cost_usdc)),
    fact("Expected quantity", position.expected_quantity),
    fact("Opened", when(position.opened_at)),
  );
  card.append(main, facts);
  return card;
}

function screenerRequest() {
  const optionalNumber = (id) => {
    const value = document.getElementById(id).value;
    return value === "" ? null : Number(value);
  };
  return {
    filters: {
      active_within_hours: optionalNumber("copyScreenActive"),
      min_trade_count: optionalNumber("copyScreenTrades"),
      min_active_days: optionalNumber("copyScreenDays"),
      min_known_cost_basis_pct: optionalNumber("copyScreenBasis"),
      min_closed_lots: optionalNumber("copyScreenClosed"),
      min_win_rate_pct: optionalNumber("copyScreenWin"),
      min_roi_pct: optionalNumber("copyScreenRoi"),
      performance_state: document.getElementById("copyScreenEvidence").value,
    },
    sort: document.getElementById("copyScreenSort").value,
    page: state.screener.page,
    page_size: 12,
  };
}

async function loadStoredWallet(sourceWalletId, button) {
  if (button) { button.disabled = true; button.textContent = "Opening…"; }
  const result = await api(`${API}/wallets/${encodeURIComponent(sourceWalletId)}`);
  if (button) { button.disabled = false; button.textContent = "Open analysis"; }
  if (!result.response.ok) {
    state.profile = null;
    profileNode.hidden = true;
    setText("copyScreenerStatus", "That wallet analysis is unavailable. Raven did not substitute another wallet.");
    return;
  }
  renderProfile(result.payload);
}

function screenerCard(wallet) {
  const card = document.createElement("article");
  card.className = "copy-screener-card";
  const identity = document.createElement("div");
  const stateLabel = document.createElement("span");
  const address = document.createElement("strong");
  const observed = document.createElement("p");
  stateLabel.textContent = readable(wallet.source_performance?.state || "insufficient_evidence");
  address.textContent = shortAddress(wallet.source_wallet?.address);
  observed.textContent = `Last trade ${when(wallet.behavior?.last_trade_at || wallet.coverage?.last_observed_at)} · exact Solana address`;
  identity.append(stateLabel, address, observed);
  const metrics = document.createElement("dl");
  metrics.append(
    fact("Realized", realizedPerformance({
      realized_pnl_usdc: wallet.source_performance?.realized_pnl?.usdc,
      realized_pnl_sol: wallet.source_performance?.realized_pnl?.sol,
    })),
    fact("ROI", pct(wallet.source_performance?.roi_pct)),
    fact("Win rate", pct(wallet.source_performance?.win_rate_pct)),
    fact("Trades", wallet.behavior?.trade_count ?? 0),
    fact("Active days", wallet.behavior?.active_days ?? 0),
    fact("Known basis", pct(wallet.coverage?.known_cost_basis_pct)),
    fact("Closed lots", wallet.source_performance?.closed_lots ?? 0),
    fact("Follower", wallet.follower_reality?.state === "not_sampled" ? "Not sampled" : readable(wallet.follower_reality?.state)),
  );
  const why = document.createElement("div");
  why.className = "copy-screener-why";
  const whyLabel = document.createElement("strong");
  const whyText = document.createElement("p");
  whyLabel.textContent = "Why surfaced";
  whyText.textContent = Array.isArray(wallet.why_surfaced) && wallet.why_surfaced.length ? wallet.why_surfaced.map((reason) => reason.label).filter(Boolean).join(" · ") : "Matches the current evidence filters.";
  why.append(whyLabel, whyText);
  const analyze = document.createElement("button");
  analyze.type = "button";
  analyze.textContent = "Open analysis";
  analyze.addEventListener("click", () => loadStoredWallet(wallet.source_wallet_id, analyze));
  card.append(identity, metrics, why, analyze);
  return card;
}

function renderScreener(payload) {
  const wallets = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.wallets) ? payload.wallets : Array.isArray(payload.results) ? payload.results : [];
  state.screener = {
    page: Number(payload.pagination?.page || payload.page || state.screener.page || 1),
    total_pages: Number(payload.pagination?.total_pages || payload.total_pages || 0),
    total: Number(payload.pagination?.total_matching_rows || payload.pagination?.total || payload.total || wallets.length),
    wallets,
  };
  setText("copyScreenerCount", `${state.screener.total.toLocaleString()} indexed`);
  setText("copyScreenerStatus", wallets.length
    ? `Showing ${wallets.length} evidence-bound wallet${wallets.length === 1 ? "" : "s"}. Source performance and follower reality remain separate.`
    : "No wallet Raven has reviewed matches these filters. Analyzing an exact public address can add it to the index.");
  const host = document.getElementById("copyScreenerResults");
  host.replaceChildren(...(wallets.length ? wallets.map(screenerCard) : [empty("No matching wallet evidence", "Loosen the filters or inspect an exact public Solana address. Raven will not pad the results with guessed performance.")]));
  const pages = document.getElementById("copyScreenerPages");
  pages.hidden = state.screener.total_pages <= 1;
  setText("copyScreenPage", `Page ${state.screener.page} of ${Math.max(1, state.screener.total_pages)}`);
  document.getElementById("copyScreenPrevious").disabled = state.screener.page <= 1;
  document.getElementById("copyScreenNext").disabled = state.screener.page >= state.screener.total_pages;
}

async function loadScreener() {
  if (!state.activation.wallet_screener) return;
  setText("copyScreenerStatus", "Screening wallets Raven has reviewed…");
  const result = await api(`${API}/screener`, { method: "POST", body: JSON.stringify(screenerRequest()) });
  if (!result.response.ok) {
    setText("copyScreenerCount", "Unavailable");
    setText("copyScreenerStatus", "Wallet screening is unavailable right now. Exact-address inspection remains available.");
    document.getElementById("copyScreenerResults").replaceChildren(empty("Wallet screening unavailable", "Analyze an exact public address or try the screener again. Raven will not show stale results as current."));
    document.getElementById("copyScreenerPages").hidden = true;
    return;
  }
  renderScreener(result.payload);
}

function renderCollections() {
  setText("copyWatchCount", state.watches.length);
  setText("copyDecisionCount", state.decisions.length);
  setText("copyPositionCount", state.positions.length);
  const watches = document.getElementById("copyWatches");
  const decisions = document.getElementById("copyDecisions");
  const positions = document.getElementById("copyPositions");
  watches.replaceChildren(...(state.watches.length ? state.watches.map(watchCard) : [empty("No wallets shadowed yet", "Inspect a public Solana wallet, review the evidence, and choose the order Raven should test.")]));
  decisions.replaceChildren(...(state.decisions.length ? state.decisions.map(decisionCard) : [empty("No shadow decisions yet", "Run the first check, then check again after the source wallet makes a new trade.")]));
  positions.replaceChildren(...(state.positions.length ? state.positions.map(positionCard) : [empty("No shadow positions", "Only a new source buy that passes entry, exit, liquidity, speed, and your rules can appear here.")]));
}

async function loadWorkspace() {
  const [watches, decisions, positions] = await Promise.all([
    api(`${API}/watches`),
    api(`${API}/decisions`),
    api(`${API}/positions`),
  ]);
  state.watches = watches.response.ok ? watches.payload.watches || [] : [];
  state.decisions = decisions.response.ok ? decisions.payload.decisions || [] : [];
  state.positions = positions.response.ok ? positions.payload.positions || [] : [];
  state.copyability = decisions.response.ok ? decisions.payload.copyability || [] : [];
  renderCollections();
  if (state.profile) renderFollowerReality();
}

async function inspectWalletAddress(address, button) {
  state.address = String(address || "").trim();
  state.profile = null;
  state.events = [];
  profileNode.hidden = true;
  policyNode.hidden = true;
  button.disabled = true;
  button.textContent = "Analyzing…";
  setText("copySearchStatus", "Reviewing recent public activity and rebuilding the wallet’s trades…");
  const result = await api(`${API}/inspect`, { method: "POST", body: JSON.stringify({ address: state.address }) });
  button.disabled = false;
  button.textContent = "Analyze wallet";
  if (!result.response.ok) {
    setText("copySearchStatus", result.payload?.error === "wallet_history_unavailable" ? "No usable public history was available for this wallet." : "Raven could not inspect this wallet right now. Nothing was inferred.");
    return;
  }
  setText("copySearchStatus", "Analysis ready. Review the wallet’s results before starting a shadow test.");
  renderProfile(result.payload);
}

async function inspectWallet(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  await inspectWalletAddress(document.getElementById("copyWalletAddress").value, button);
}

async function savePolicy(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setText("copyPolicyStatus", "Saving your private shadow policy…");
  const result = await api(`${API}/watches`, {
    method: "POST",
    body: JSON.stringify({ address: state.address, label: document.getElementById("copyPolicyLabel").value, policy: policyPayload() }),
  });
  button.disabled = false;
  if (!result.response.ok) {
    setText("copyPolicyStatus", "This policy could not be saved. Review the values and try again.");
    return;
  }
  policyNode.hidden = true;
  await loadWorkspace();
  switchView("watching");
}

async function boot() {
  const requestedWallet = new URL(location.href).searchParams.get("wallet") || "";
  if (requestedWallet) document.getElementById("copyWalletAddress").value = requestedWallet.slice(0, 44);
  const returnTo = `/account/copy/${requestedWallet ? `?wallet=${encodeURIComponent(requestedWallet.slice(0, 44))}` : ""}`;
  document.querySelectorAll('input[name="return_to"]').forEach((input) => { input.value = returnTo; });
  const session = await api("/api/v1/auth/session");
  if (!session.response.ok || session.payload?.authenticated !== true) {
    page.dataset.copyState = "signed-out";
    signIn.hidden = false;
    setText("copyWorkspaceState", "Sign in required");
    return;
  }
  state.csrf = session.payload.csrf_token || "";
  setText("copyWorkspaceIdentity", session.payload.account?.email || session.payload.account?.display_name || "Signed in");
  const summary = await api(API);
  if (!summary.response.ok) {
    page.dataset.copyState = "unavailable";
    unavailable.hidden = false;
    setText("copyWorkspaceState", "Private beta");
    setText("copyUnavailableReason", summary.response.status === 403 ? "Raven Copy is part of RavenOS Pro and is not enabled for this account." : "Wallet intelligence is being held until its operating controls are ready. Discover and Terminal remain available.");
    return;
  }
  state.activation = summary.payload.activation || {};
  page.dataset.copyState = "active";
  workspace.hidden = false;
  setText("copyWorkspaceState", "Shadow workspace ready");
  await loadWorkspace();
  if (state.activation.wallet_screener) {
    document.getElementById("copyScreener").hidden = false;
    await loadScreener();
  }
  if (requestedWallet) {
    const button = document.querySelector('#copyWalletSearch button[type="submit"]');
    await inspectWalletAddress(requestedWallet, button);
  }
}

document.querySelectorAll("[data-copy-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.copyView)));
document.getElementById("copyWalletSearch").addEventListener("submit", inspectWallet);
document.getElementById("copyStartSetup").addEventListener("click", () => { policyNode.hidden = false; policyNode.scrollIntoView({ behavior: "smooth", block: "start" }); });
document.getElementById("copyCancelSetup").addEventListener("click", () => { policyNode.hidden = true; });
document.getElementById("copyPolicy").addEventListener("submit", savePolicy);
document.getElementById("copyScreenerFilters").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.screener.page = 1;
  await loadScreener();
});
document.getElementById("copyScreenReset").addEventListener("click", async () => {
  document.getElementById("copyScreenerFilters").reset();
  state.screener.page = 1;
  await loadScreener();
});
document.getElementById("copyScreenPrevious").addEventListener("click", async () => {
  state.screener.page = Math.max(1, state.screener.page - 1);
  await loadScreener();
});
document.getElementById("copyScreenNext").addEventListener("click", async () => {
  state.screener.page += 1;
  await loadScreener();
});

boot().catch(() => {
  page.dataset.copyState = "unavailable";
  unavailable.hidden = false;
  setText("copyWorkspaceState", "Unavailable");
  setText("copyUnavailableReason", "Raven Copy could not verify this session. No wallet data was loaded.");
});

window.RavenOSWalletCopy = Object.freeze({ schemaVersion: "ravenos.wallet_copy_surface.v1", liveCopy: false, signing: false, broadcasting: false, feeCollection: false });
