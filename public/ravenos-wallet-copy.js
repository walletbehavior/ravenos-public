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
  source_wallet_id: null,
  profile: null,
  deep_history: null,
  deep_poll_token: 0,
  deep_poll_attempts: 0,
  events: [],
  activity: { filter: "all", next_cursor: null, has_more: false, matching_event_count: 0, loading: false },
  watches: [],
  decisions: [],
  exit_decisions: [],
  positions: [],
  copyability: [],
  saved: [],
  screener: { page: 1, total_pages: 0, total: 0, wallets: [], preset: null },
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

function humanDuration(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "Unavailable";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(seconds < 7_200 ? 1 : 0)}h`;
  return `${(seconds / 86_400).toFixed(seconds < 172_800 ? 1 : 0)}d`;
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
  time.textContent = when(event.chain_evidence?.block_time);
  head.append(kind, time);
  const details = document.createElement("dl");
  details.append(
    fact("Evidence", readable(event.classification?.confidence)),
    fact("Cost basis", readable(event.economic?.cost_basis_state)),
    fact("Paid", exactAssetAmount(event.economic?.source_asset)),
    fact("Received", exactAssetAmount(event.economic?.destination_asset)),
  );
  const evidence = document.createElement("p");
  const provider = readable(event.chain_evidence?.provider || "provider unavailable");
  const finality = readable(event.chain_evidence?.finality || "finality unavailable");
  evidence.textContent = `${provider} · ${finality}${event.chain_evidence?.slot === null || event.chain_evidence?.slot === undefined ? "" : ` · slot ${event.chain_evidence.slot}`}`;
  const disclosure = document.createElement("details");
  disclosure.className = "copy-event-evidence";
  const summary = document.createElement("summary");
  summary.textContent = "Evidence details";
  const proof = document.createElement("dl");
  const reasons = Array.isArray(event.classification?.reasons) ? event.classification.reasons.map(readable).join(" · ") : "Unavailable";
  const programs = Array.isArray(event.route_evidence?.program_ids) ? event.route_evidence.program_ids.map(shortAddress).join(" · ") : "Unavailable";
  proof.append(
    fact("Classification basis", reasons || "Unavailable"),
    fact("Observation", readable(event.timing?.observation_mode)),
    fact("Route", readable(event.route_evidence?.route_shape)),
    fact("Programs", programs || "Unavailable"),
    fact("Network fee", event.economic?.transaction_fee_lamports === null || event.economic?.transaction_fee_lamports === undefined ? "Unavailable" : `${Number(event.economic.transaction_fee_lamports).toLocaleString()} lamports`),
    fact("Detection", duration(event.timing?.detection_delay_ms)),
  );
  disclosure.append(summary, proof);
  const signature = document.createElement("a");
  signature.href = `https://solscan.io/tx/${encodeURIComponent(event.chain_evidence?.signature || "")}`;
  signature.target = "_blank";
  signature.rel = "noopener noreferrer";
  signature.textContent = `View transaction · ${shortAddress(event.chain_evidence?.signature)}`;
  card.append(head, details, evidence, disclosure, signature);
  return card;
}

function renderWalletActivity(activity, { append = false } = {}) {
  const incoming = Array.isArray(activity?.events) ? activity.events : [];
  const filter = String(activity?.filter || state.activity.filter || "all");
  const prior = append && filter === state.activity.filter ? state.events : [];
  const seen = new Set(prior.map((event) => event.event_id));
  const merged = [...prior, ...incoming.filter((event) => !seen.has(event.event_id))];
  state.events = merged;
  state.activity = {
    filter,
    next_cursor: activity?.pagination?.next_cursor || null,
    has_more: activity?.pagination?.has_more === true,
    matching_event_count: Math.max(0, Number(activity?.pagination?.matching_event_count ?? merged.length)),
    loading: false,
  };
  const filterNode = document.getElementById("copyActivityFilter");
  filterNode.value = filter;
  filterNode.disabled = false;
  const host = document.getElementById("copyRecentEvents");
  host.replaceChildren(...(merged.length ? merged.map(eventCard) : [empty("No matching activity", "Nothing in Raven’s retained evidence matches this filter. Unavailable events are not converted into zero activity.")]));
  const total = state.activity.matching_event_count;
  setText("copyEventCount", `${merged.length.toLocaleString()} of ${total.toLocaleString()} retained`);
  setText("copyActivityStatus", state.activity.has_more
    ? "Older retained evidence is available. Loading it does not make another Solana provider request."
    : total
      ? "End of the retained Raven index for this filter. This is not a lifetime-history claim."
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
  const cursor = append && filter === state.activity.filter ? state.activity.next_cursor : null;
  state.activity.loading = true;
  filterNode.disabled = true;
  const more = document.getElementById("copyActivityMore");
  more.disabled = true;
  more.textContent = append ? "Loading…" : "Filtering…";
  setText("copyActivityStatus", append ? "Loading the next retained page…" : "Filtering retained wallet evidence…");
  const params = new URLSearchParams({ filter, limit: "12" });
  if (cursor) params.set("cursor", cursor);
  const result = await api(`${API}/wallets/${encodeURIComponent(state.source_wallet_id)}/events?${params}`);
  if (!result.response.ok) {
    state.activity.loading = false;
    filterNode.disabled = false;
    more.disabled = false;
    more.textContent = "Try again";
    setText("copyActivityStatus", "Raven could not read this retained page. No missing activity was treated as zero.");
    return;
  }
  renderWalletActivity(result.payload, { append });
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

function renderDeepHistory(history) {
  state.deep_history = history || null;
  const node = document.getElementById("copyDeepHistory");
  const active = history && !new Set(["not_enabled", "not_queued"]).has(history.state);
  node.hidden = !active;
  if (!active) return;
  const signatures = Math.max(0, Number(history.signatures_indexed || 0));
  const maximum = Math.max(1, Number(history.maximum_signatures || 10_000));
  const progress = history.state === "complete" || history.state === "bounded_partial"
    ? 100
    : Math.min(99, (signatures / maximum) * 100);
  const labels = {
    queued: ["Deep history queued", "Raven will rebuild older activity once and reuse it for every researcher and follower."],
    leased: ["Indexing older activity", "A bounded provider page is being normalized into Raven's shared wallet evidence."],
    retry_wait: ["History retry queued", "The current page did not complete cleanly, so Raven kept the cursor in place and will retry it."],
    complete: ["Provider history exhausted", "The indexed provider window reached its oldest available page. Raven still does not call this verified lifetime history."],
    bounded_partial: ["10,000-signature window indexed", "The safety ceiling was reached. Older activity may exist and remains outside this profile."],
    dead_letter: ["History needs operator review", "Raven stopped at an invalid or repeatedly unavailable page instead of skipping over an evidence gap."],
    unavailable: ["Deep history unavailable", "Immediate evidence remains visible, but no deeper completeness claim is being made."],
  };
  const [headline, detail] = labels[history.state] || ["History state forming", "Raven is preserving the current evidence boundary."];
  setText("copyDeepHistoryHeadline", headline);
  setText("copyDeepHistoryDetail", detail);
  const progressNode = document.getElementById("copyDeepHistoryProgress");
  progressNode.value = progress;
  progressNode.textContent = `${Math.round(progress)}%`;
  setText("copyDeepHistoryCount", `${compactNumber(signatures)} signatures · ${compactNumber(history.transactions_decoded || 0)} decoded · ${compactNumber(history.pages_indexed || 0)} pages`);
}

function deepHistoryPending(history) {
  return new Set(["queued", "leased", "retry_wait"]).has(history?.state);
}

function scheduleDeepHistoryPoll(token) {
  if (!state.activation.wallet_screener || !deepHistoryPending(state.deep_history) || !state.source_wallet_id || state.deep_poll_attempts >= 12) return;
  state.deep_poll_attempts += 1;
  window.setTimeout(async () => {
    if (token !== state.deep_poll_token || !state.source_wallet_id) return;
    const result = await api(`${API}/wallets/${encodeURIComponent(state.source_wallet_id)}`);
    if (token !== state.deep_poll_token) return;
    if (result.response.ok) renderProfile(result.payload, { scroll: false, from_poll: true });
    else scheduleDeepHistoryPoll(token);
  }, 10_000);
}

function renderProfile(payload, { scroll = true, from_poll: fromPoll = false } = {}) {
  if (!fromPoll) {
    state.deep_poll_token += 1;
    state.deep_poll_attempts = 0;
  }
  state.profile = payload.profile;
  state.address = payload.profile?.source_wallet?.address || state.address;
  state.source_wallet_id = payload.source_wallet_id || state.source_wallet_id;
  const profile = state.profile;
  profileNode.hidden = false;
  policyNode.hidden = true;
  renderDeepHistory(payload.deep_history);
  setText("copyProfileAddress", shortAddress(state.address));
  const historyLabel = profile.data_quality?.provider_history_exhausted ? "provider window exhausted" : "bounded partial history";
  setText("copyProfileCoverage", `${profile.coverage.transactions_observed} transactions · ${profile.coverage.trade_events} trade events · ${profile.coverage.known_cost_basis_pct === null ? "cost basis unresolved" : `${profile.coverage.known_cost_basis_pct.toFixed(1)}% known cost basis`} · ${historyLabel}`);
  const thesis = profile.research_thesis;
  const thesisNode = document.getElementById("copyProfileThesis");
  thesisNode.hidden = !thesis;
  if (thesis) {
    thesisNode.dataset.thesisState = text(thesis.state, "insufficient_evidence");
    setText("copyThesisState", thesis.evidence_strength?.label || readable(thesis.state));
    setText("copyThesisHeadline", thesis.headline || "Source record still forming");
    setText("copyThesisSummary", thesis.summary || "Raven needs more known-cost closes before characterizing this wallet.");
    document.getElementById("copyThesisStrengths").replaceChildren(...findingItems(thesis.strengths, "No durable source strength is established yet."));
    document.getElementById("copyThesisWatchouts").replaceChildren(...findingItems(thesis.watchouts, "No additional watch-out is supported by the retained evidence."));
    document.getElementById("copyThesisNext").replaceChildren(...findingItems(thesis.next_evidence, "Continue prospective observation without rewriting prior evidence."));
  }
  const performance = profile.source_performance;
  setText("copySourcePnl", realizedPerformance(performance));
  const sourceMetrics = document.getElementById("copySourceMetrics");
  sourceMetrics.replaceChildren(
    fact("ROI", pct(performance.roi_pct)),
    fact("Win rate", pct(performance.win_rate_pct)),
    fact("Profit factor", decimal(performance.profit_factor)),
    fact("Closed observations", performance.closed_observations ?? performance.closed_lots),
    fact("Median hold", humanDuration(profile.behavior.median_hold_seconds)),
    fact("Trades", profile.behavior.trade_count),
    fact("Tokens", profile.behavior.tokens_traded ?? "Unavailable"),
    fact("Active days", profile.behavior.active_days),
    fact("Known basis", pct(profile.coverage.known_cost_basis_pct)),
    fact("Avg buy", basisNotional(profile.behavior, "average")),
    fact("Total buys", basisNotional(profile.behavior, "total")),
    fact("Trade rate", profile.behavior.trade_rate_per_active_day === null || profile.behavior.trade_rate_per_active_day === undefined ? "Unavailable" : `${profile.behavior.trade_rate_per_active_day}/day`),
    fact("Last trade", when(profile.behavior.last_trade_at)),
  );
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
  const usdcQuality = profile.profit_quality?.by_basis?.usdc || {};
  const solQuality = profile.profit_quality?.by_basis?.sol || {};
  document.getElementById("copyProfitQuality").replaceChildren(
    fact("Top-1 · USDC", pct(usdcQuality.top_1_profit_concentration_pct)),
    fact("Top-1 · SOL", pct(solQuality.top_1_profit_concentration_pct)),
    fact("Top-5 · USDC", pct(usdcQuality.top_5_profit_concentration_pct)),
    fact("Top-5 · SOL", pct(solQuality.top_5_profit_concentration_pct)),
    fact("Profitable closes · USDC", usdcQuality.profitable_observations ?? "Unavailable"),
    fact("Profitable closes · SOL", solQuality.profitable_observations ?? "Unavailable"),
    fact("Profitable weeks · USDC", pct(usdcQuality.weekly_consistency?.profitable_period_pct)),
    fact("Profitable weeks · SOL", pct(solQuality.weekly_consistency?.profitable_period_pct)),
  );
  const patterns = profile.behavior?.mechanical_pattern_evidence || {};
  document.getElementById("copyBehaviorMetrics").replaceChildren(
    fact("Median hold", humanDuration(profile.behavior?.median_hold_seconds)),
    fact("Trade rate", profile.behavior?.trade_rate_per_active_day === null || profile.behavior?.trade_rate_per_active_day === undefined ? "Unavailable" : `${decimal(profile.behavior.trade_rate_per_active_day)}/day`),
    fact("Repeat-token rate", pct(profile.behavior?.repeat_token_rate_pct)),
    fact("Tokens with an exit", pct(profile.behavior?.observed_token_exit_coverage_pct ?? profile.behavior?.observed_trade_completion_pct)),
    fact("Scaled in", pct(profile.behavior?.scaled_into_token_pct)),
    fact("Scaled out", pct(profile.behavior?.scaled_out_token_pct)),
    fact("Mechanical patterns", readable(patterns.state || "insufficient_evidence")),
    fact("Rapid intervals", pct(patterns.rapid_under_30_seconds_pct)),
  );
  const quality = profile.data_quality || {};
  document.getElementById("copyEvidenceMetrics").replaceChildren(
    fact("History scope", readable(quality.history_scope || "bounded_partial_history")),
    fact("Provider window", quality.provider_history_exhausted ? "Exhausted" : "More history may exist"),
    fact("Cost basis", pct(quality.cost_basis_coverage_pct ?? profile.coverage?.known_cost_basis_pct)),
    fact("Transaction decode", pct(quality.trade_decode_coverage_pct)),
    fact("Classification", pct(quality.classification_coverage_pct)),
    fact("Reconstruction", pct(quality.reconstruction_confidence_pct)),
    fact("Profile events", quality.analysis_events === null || quality.analysis_events === undefined ? "Unavailable" : compactNumber(quality.analysis_events)),
    fact("Analysis scope", readable(quality.analysis_scope || "all_retained_normalized_events")),
    fact("Historical pricing", pct(quality.historical_price_evidence_coverage_pct)),
    fact("Full confidence", pct(quality.full_data_confidence_pct)),
  );
  setText("copyEvidenceLimit", quality.analysis_truncated
    ? `Raven indexed more history than this snapshot can safely analyze at once. These metrics use the most recent ${compactNumber(quality.analysis_events)} normalized events; older evidence remains retained. Full confidence still requires contemporaneous price and liquidity evidence.`
    : "Full confidence remains unavailable without contemporaneous historical price and liquidity evidence.");
  const capital = profile.capital_observations || {};
  const openPositions = Array.isArray(profile.positions?.known_cost_open_positions) ? profile.positions.known_cost_open_positions : [];
  document.getElementById("copyCapitalMetrics").replaceChildren(
    fact("Last observed SOL", capital.sol?.amount === null || capital.sol?.amount === undefined ? "Unavailable" : `${decimal(capital.sol.amount)} SOL`),
    fact("SOL observed", when(capital.sol?.observed_at)),
    fact("Last observed USDC", capital.canonical_usdc?.amount === null || capital.canonical_usdc?.amount === undefined ? "Unavailable" : money(capital.canonical_usdc.amount)),
    fact("USDC observed", when(capital.canonical_usdc?.observed_at)),
    fact("Known-cost open", profile.positions?.known_cost_open_position_count ?? "Unavailable"),
    fact("Unresolved basis events", profile.positions?.unresolved_cost_basis_event_count ?? "Unavailable"),
  );
  const openHost = document.getElementById("copyOpenPositions");
  openHost.replaceChildren(...(openPositions.length ? openPositions.slice(0, 8).map((position) => {
    const row = document.createElement("div");
    const identity = document.createElement("strong");
    const detail = document.createElement("span");
    identity.textContent = shortAddress(position.mint);
    detail.textContent = `${position.lot_count} known-cost lot${position.lot_count === 1 ? "" : "s"} · ${decimal(position.remaining_cost)} ${String(position.basis || "").toUpperCase()} · mark unavailable`;
    row.append(identity, detail);
    return row;
  }) : [empty("No known-cost open positions", "Unknown inventory is not converted into a zero-cost position or a marked gain.")]));
  renderFollowerReality();
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
    if ((result.payload.decisions || []).length || (result.payload.exit_decisions || []).length) switchView("feed");
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
    ? "No fee was calculated or collected."
    : `Hypothetical Raven fee ${money(decision.hypothetical_raven_fee.fee_usdc)}. Nothing was collected.`;
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

function screenerRequest() {
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
  clause("top_1_profit_concentration_pct", "lte", "copyScreenTopOne");
  clause("reconstruction_confidence_pct", "gte", "copyScreenReconstruction");
  const holdMinimum = optionalNumber("copyScreenHoldMin");
  const holdMaximum = optionalNumber("copyScreenHoldMax");
  if (holdMinimum !== null && holdMaximum !== null) clauses.push({ field: "median_hold_seconds", operator: "between", value: [holdMinimum, holdMaximum] });
  else if (holdMinimum !== null) clauses.push({ field: "median_hold_seconds", operator: "gte", value: holdMinimum });
  else if (holdMaximum !== null) clauses.push({ field: "median_hold_seconds", operator: "lte", value: holdMaximum });
  const mechanical = document.getElementById("copyScreenMechanical").value;
  if (mechanical) clauses.push({ field: "mechanical_pattern_state", operator: "eq", value: mechanical });
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
    clauses,
    preset: state.screener.preset,
    sort: document.getElementById("copyScreenSort").value,
    page: state.screener.page,
    page_size: 12,
  };
}

function syncScreenerUrl() {
  const url = new URL(location.href);
  const fields = {
    screen: state.screener.preset,
    active: document.getElementById("copyScreenActive").value,
    trades: document.getElementById("copyScreenTrades").value,
    days: document.getElementById("copyScreenDays").value,
    basis: document.getElementById("copyScreenBasis").value,
    evidence: document.getElementById("copyScreenEvidence").value,
    sort: document.getElementById("copyScreenSort").value,
    closed: document.getElementById("copyScreenClosed").value,
    win: document.getElementById("copyScreenWin").value,
    roi: document.getElementById("copyScreenRoi").value,
    pf: document.getElementById("copyScreenProfitFactor").value,
    top1: document.getElementById("copyScreenTopOne").value,
    recon: document.getElementById("copyScreenReconstruction").value,
    hold_min: document.getElementById("copyScreenHoldMin").value,
    hold_max: document.getElementById("copyScreenHoldMax").value,
    pattern: document.getElementById("copyScreenMechanical").value,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "" || (key === "evidence" && value === "any") || (key === "sort" && value === "last_trade_desc")) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value).slice(0, 64));
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function hydrateScreenerFromUrl() {
  const params = new URL(location.href).searchParams;
  const preset = params.get("screen");
  if (preset && [...document.querySelectorAll("[data-screen-preset]")].some((button) => button.dataset.screenPreset === preset)) state.screener.preset = preset;
  const mappings = {
    active: "copyScreenActive", trades: "copyScreenTrades", days: "copyScreenDays", basis: "copyScreenBasis",
    evidence: "copyScreenEvidence", sort: "copyScreenSort", closed: "copyScreenClosed", win: "copyScreenWin",
    roi: "copyScreenRoi", pf: "copyScreenProfitFactor", top1: "copyScreenTopOne", recon: "copyScreenReconstruction",
    hold_min: "copyScreenHoldMin", hold_max: "copyScreenHoldMax", pattern: "copyScreenMechanical",
  };
  for (const [parameter, id] of Object.entries(mappings)) {
    const value = params.get(parameter);
    const input = document.getElementById(id);
    if (value === null || !input) continue;
    if (input.tagName === "SELECT" && ![...input.options].some((option) => option.value === value)) continue;
    input.value = value.slice(0, 64);
  }
  document.querySelectorAll("[data-screen-preset]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.screenPreset === state.screener.preset)));
}

async function loadStoredWallet(sourceWalletId, button) {
  const idleLabel = button?.textContent || "Open analysis";
  if (button) { button.disabled = true; button.textContent = "Opening…"; }
  const result = await api(`${API}/wallets/${encodeURIComponent(sourceWalletId)}`);
  if (button) { button.disabled = false; button.textContent = idleLabel; }
  if (!result.response.ok) {
    state.profile = null;
    profileNode.hidden = true;
    setText("copyScreenerStatus", "That wallet analysis is unavailable. Raven did not substitute another wallet.");
    return;
  }
  renderProfile(result.payload);
}

function savedResearchRow(save) {
  const row = document.createElement("article");
  const identity = document.createElement("div");
  const list = document.createElement("span");
  const label = document.createElement("strong");
  const address = document.createElement("small");
  list.textContent = save.list_name;
  label.textContent = save.label;
  const short = shortAddress(save.source_wallet?.address);
  address.textContent = save.label === short ? "Solana · exact wallet" : short;
  identity.append(list, label, address);
  const actions = document.createElement("div");
  const open = document.createElement("button");
  const remove = document.createElement("button");
  open.type = remove.type = "button";
  open.textContent = "Open";
  remove.textContent = "Remove";
  open.addEventListener("click", () => loadStoredWallet(save.source_wallet_id, open));
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    await api(`${API}/saved-wallets/${encodeURIComponent(save.save_id)}`, { method: "DELETE", body: JSON.stringify({ confirm: "delete_saved_wallet" }) });
    await loadSavedResearch();
  });
  actions.append(open, remove);
  row.append(identity, actions);
  return row;
}

function renderSavedResearch() {
  setText("copySavedCount", `${state.saved.length} saved`);
  const host = document.getElementById("copySavedWallets");
  if (!state.saved.length) {
    const message = document.createElement("p");
    message.textContent = "No saved research wallets yet. Saving does not start monitoring or copying.";
    host.replaceChildren(message);
    return;
  }
  host.replaceChildren(...state.saved.map(savedResearchRow));
}

async function loadSavedResearch() {
  const result = await api(`${API}/saved-wallets`);
  state.saved = result.response.ok && Array.isArray(result.payload?.saves) ? result.payload.saves : [];
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

function screenerCard(wallet) {
  const card = document.createElement("article");
  card.className = "copy-screener-card";
  const identity = document.createElement("div");
  const stateLabel = document.createElement("span");
  const address = document.createElement("strong");
  const observed = document.createElement("p");
  const thesis = wallet.research_thesis;
  stateLabel.textContent = thesis?.evidence_strength?.label || readable(wallet.source_performance?.state || "insufficient_evidence");
  address.textContent = shortAddress(wallet.source_wallet?.address);
  observed.textContent = `Last trade ${when(wallet.behavior?.last_trade_at || wallet.coverage?.last_observed_at)} · exact Solana address`;
  identity.append(stateLabel, address, observed);
  const metrics = document.createElement("dl");
  metrics.append(
    fact("Realized", realizedPerformance({
      realized_pnl_usdc: wallet.source_performance?.realized_pnl?.usdc,
      realized_pnl_sol: wallet.source_performance?.realized_pnl?.sol,
    })),
    fact("Profit factor", decimal(wallet.source_performance?.profit_factor)),
    fact("Top-1 profit", pct(wallet.profit_quality?.top_1_profit_concentration_pct)),
    fact("Reconstruction", pct(wallet.coverage?.reconstruction_confidence_pct)),
    fact("Win rate", pct(wallet.source_performance?.win_rate_pct)),
    fact("Trades", wallet.behavior?.trade_count ?? 0),
    fact("Median hold", humanDuration(wallet.behavior?.median_hold_seconds)),
    fact("Known basis", pct(wallet.coverage?.known_cost_basis_pct)),
    fact("Follower", wallet.follower_reality?.state === "not_sampled" ? "Not sampled" : readable(wallet.follower_reality?.state)),
  );
  const why = document.createElement("div");
  why.className = "copy-screener-thesis";
  why.dataset.edgeState = text(thesis?.source_edge?.state, "unavailable");
  const whyLabel = document.createElement("span");
  const whyHeadline = document.createElement("strong");
  const whyText = document.createElement("p");
  whyLabel.textContent = thesis ? "Raven thesis" : "Why surfaced";
  whyHeadline.textContent = thesis?.headline || "Evidence match";
  const firstWatchout = Array.isArray(thesis?.watchouts) ? thesis.watchouts.find((item) => item?.label)?.label : null;
  whyText.textContent = thesis?.summary
    ? `${thesis.summary}${firstWatchout ? ` Watch: ${firstWatchout}` : ""}`
    : Array.isArray(wallet.why_surfaced) && wallet.why_surfaced.length
      ? wallet.why_surfaced.map((reason) => reason.label).filter(Boolean).join(" · ")
      : "Matches the current evidence filters.";
  why.append(whyLabel, whyHeadline, whyText);
  const actions = document.createElement("div");
  actions.className = "copy-screener-card-actions";
  const save = document.createElement("button");
  const analyze = document.createElement("button");
  save.type = "button";
  analyze.type = "button";
  save.textContent = "Save";
  analyze.textContent = "Open analysis";
  save.addEventListener("click", () => saveResearchWallet(wallet.source_wallet_id, shortAddress(wallet.source_wallet?.address), save));
  analyze.addEventListener("click", () => loadStoredWallet(wallet.source_wallet_id, analyze));
  actions.append(save, analyze);
  card.append(identity, metrics, why, actions);
  return card;
}

function renderScreener(payload) {
  const wallets = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.wallets) ? payload.wallets : Array.isArray(payload.results) ? payload.results : [];
  state.screener = {
    page: Number(payload.pagination?.page || payload.page || state.screener.page || 1),
    total_pages: Number(payload.pagination?.total_pages || payload.total_pages || 0),
    total: Number(payload.pagination?.total_matching_rows || payload.pagination?.total || payload.total || wallets.length),
    wallets,
    preset: state.screener.preset,
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
  const feed = [
    ...state.decisions.map((row) => ({ row, card: decisionCard, at: row.timing?.policy_decided_at })),
    ...state.exit_decisions.map((row) => ({ row, card: exitDecisionCard, at: row.timing?.policy_decided_at })),
  ].sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0));
  setText("copyDecisionCount", feed.length);
  setText("copyPositionCount", state.positions.length);
  const watches = document.getElementById("copyWatches");
  const decisions = document.getElementById("copyDecisions");
  const positions = document.getElementById("copyPositions");
  watches.replaceChildren(...(state.watches.length ? state.watches.map(watchCard) : [empty("No wallets shadowed yet", "Inspect a public Solana wallet, review the evidence, and choose the order Raven should test.")]));
  decisions.replaceChildren(...(feed.length ? feed.map((item) => item.card(item.row)) : [empty("No shadow decisions yet", "Raven will keep approved buys, skipped buys, mapped sells, and unavailable exits in one complete record.")]));
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
  state.exit_decisions = decisions.response.ok ? decisions.payload.exit_decisions || [] : [];
  state.positions = positions.response.ok ? positions.payload.positions || [] : [];
  state.copyability = decisions.response.ok ? decisions.payload.copyability || [] : [];
  renderCollections();
  if (state.profile) renderFollowerReality();
}

async function inspectWalletAddress(address, button) {
  state.address = String(address || "").trim();
  state.source_wallet_id = null;
  state.profile = null;
  state.deep_history = null;
  state.events = [];
  state.activity = { filter: "all", next_cursor: null, has_more: false, matching_event_count: 0, loading: false };
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
  setText("copyWorkspaceState", state.activation.continuous_observer ? "Nexus Shadow ready" : "Shadow workspace ready");
  setText("copyWatchingDescription", state.activation.continuous_observer
    ? "Nexus watches each exact source once, then Raven evaluates every private policy against the same prospective event. Manual checks remain available as a fallback."
    : "Checks are manual during this private beta. The first check learns where the wallet stands; later checks evaluate only genuinely new trades.");
  setText("copyWatchingBadge", state.activation.continuous_observer ? "Nexus observing" : "Live copy off");
  await loadWorkspace();
  if (state.activation.wallet_screener) {
    document.getElementById("copyScreener").hidden = false;
    hydrateScreenerFromUrl();
    await Promise.all([loadScreener(), loadSavedResearch()]);
  }
  if (requestedWallet) {
    const button = document.querySelector('#copyWalletSearch button[type="submit"]');
    await inspectWalletAddress(requestedWallet, button);
  }
}

document.querySelectorAll("[data-copy-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.copyView)));
document.getElementById("copyWalletSearch").addEventListener("submit", inspectWallet);
document.getElementById("copySaveProfile").addEventListener("click", (event) => saveResearchWallet(state.source_wallet_id, shortAddress(state.address), event.currentTarget));
document.getElementById("copyStartSetup").addEventListener("click", () => { policyNode.hidden = false; policyNode.scrollIntoView({ behavior: "smooth", block: "start" }); });
document.getElementById("copyCancelSetup").addEventListener("click", () => { policyNode.hidden = true; });
document.getElementById("copyPolicy").addEventListener("submit", savePolicy);
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
  if (state.screener.preset === "active_swing") document.getElementById("copyScreenActive").value = "168";
  state.screener.page = 1;
  syncScreenerUrl();
  await loadScreener();
}));
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

boot().catch(() => {
  page.dataset.copyState = "unavailable";
  unavailable.hidden = false;
  setText("copyWorkspaceState", "Unavailable");
  setText("copyUnavailableReason", "Raven Copy could not verify this session. No wallet data was loaded.");
});

window.RavenOSWalletCopy = Object.freeze({ schemaVersion: "ravenos.wallet_copy_surface.v1", liveCopy: false, signing: false, broadcasting: false, feeCollection: false });
