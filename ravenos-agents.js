const $ = (id) => document.getElementById(id);

const developmentFixture = Object.freeze({
  ok: true,
  schema_version: "ravenos.agentic.workspace.v1",
  demonstration_data: true,
  environment: "paper",
  live_execution_enabled: false,
  agents: [{
    agent_id: "agt_demo_basis_guard",
    name: "SOL Basis Guard",
    strategy_type: "spot_perp_hedge",
    state: "paper",
    autonomy: "policy_gated",
    daily_pnl: "+$18.42",
    drawdown: "−0.8%",
    next_run: "Event driven",
    data_health: "Current",
    warnings: 1,
    venues: ["Solana", "Hyperliquid"],
    capital: [
      { venue: "Solana · Jupiter", available: "1,250 USDC", reserved: "100 USDC", gas: "0.08 SOL", state: "ready" },
      { venue: "Hyperliquid · Perps", available: "900 USDC", reserved: "42 USDC", gas: "Venue settled", state: "ready" },
    ],
    plan: {
      plan_id: "plan_demo_partial",
      state: "partially_executed",
      purpose: "Delta-neutral SOL exposure",
      legs: [
        { leg_id: "spot", venue: "Solana · Jupiter", action: "Buy SOL", notional: "100 USDC", state: "filled", detail: "Executable route · fee and impact included" },
        { leg_id: "hedge", venue: "Hyperliquid · Perps", action: "Short SOL-PERP", notional: "100 USDC", state: "expired", detail: "Quote expired before placement" },
      ],
    },
    policy: {
      result: "block",
      rules: [
        { name: "Spot leg", result: "Allow", detail: "Local capital and quote current" },
        { name: "Hedge leg", result: "Block", detail: "Quote expired" },
        { name: "Combined exposure", result: "Indeterminate", detail: "Unhedged SOL remains" },
      ],
    },
    events: [
      { at: "12:00:00", type: "Plan", detail: "Two venue legs approved for paper preview" },
      { at: "12:00:01", type: "Paper fill", detail: "Solana spot leg filled" },
      { at: "12:00:03", type: "Blocked", detail: "Hyperliquid hedge quote expired" },
      { at: "12:00:04", type: "Reconcile", detail: "Plan remains partial; no retry or unwind" },
    ],
  }],
  radar: {
    freshness_state: "development fixture",
    entries: [{
      entity_id: "radar_demo_agent",
      name: "Example agent claim",
      chain: "Robinhood Chain",
      verification: "Partial",
      endpoint: "Unverified",
      activity: "Observed",
      liquidity: "Unknown",
      facts: ["Contract identity observed", "Two onchain actions observed"],
      claims: ["Project metadata describes an autonomous agent"],
      unknowns: ["Endpoint ownership", "Task completion", "Revenue attribution", "Creator-linked holdings"],
    }],
  },
});

const state = { payload: null, selectedAgent: null, view: "agents", csrf: "", transitioning: false, creating: false };

function clean(value, fallback = "Unavailable") {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : fallback;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = clean(text);
  return node;
}

function setStatus(kind, label, message) {
  const root = $("agentsStatus");
  root.dataset.state = kind;
  root.replaceChildren(element("span", "", label), element("strong", "", message));
}

function metric(label, value) {
  const row = element("div");
  row.append(element("dt", "", label), element("dd", "", value));
  return row;
}

function configCard(label, value, detail = "") {
  const card = element("div", "agent-config-card");
  card.append(element("span", "", label), element("strong", "", value));
  if (detail) card.append(element("small", "", detail));
  return card;
}

function renderAgentList() {
  const list = $("agentsList");
  list.replaceChildren();
  const agents = Array.isArray(state.payload?.agents) ? state.payload.agents.slice(0, 50) : [];
  $("agentsCount").textContent = String(agents.length);
  for (const agent of agents) {
    const button = element("button", `agent-list-row${agent.agent_id === state.selectedAgent?.agent_id ? " active" : ""}`);
    button.type = "button";
    button.append(element("strong", "", agent.name), element("span", "", (agent.venues || []).join(" · ")));
    const status = element("em", "", `${agent.state} · ${agent.data_health}`);
    button.append(status);
    button.addEventListener("click", () => { state.selectedAgent = agent; renderAgentList(); renderAgent(); });
    list.append(button);
  }
}

function renderAgent() {
  const agent = state.selectedAgent;
  if (!agent) {
    $("agentName").textContent = "No paper agents";
    $("agentState").textContent = "Empty";
    $("agentMetrics").replaceChildren();
    $("agentConfiguration").replaceChildren();
    $("agentCapital").replaceChildren();
    $("agentPlan").replaceChildren();
    $("agentPolicy").replaceChildren();
    $("agentEvents").replaceChildren();
    $("agentValidate").disabled = true;
    $("agentStart").disabled = true;
    $("agentPause").disabled = true;
    $("agentKill").disabled = true;
    return;
  }
  $("agentStrategy").textContent = clean(agent.strategy_type, "Typed strategy").replaceAll("_", " ");
  $("agentName").textContent = clean(agent.name);
  $("agentState").textContent = clean(agent.state, "Draft");
  $("agentMetrics").replaceChildren(
    metric("Autonomy", agent.autonomy),
    metric("Environment", state.payload.environment),
    metric("Daily P&L", agent.daily_pnl),
    metric("Drawdown", agent.drawdown),
    metric("Next", agent.next_run),
    metric("Warnings", agent.warnings),
  );

  const config = agent.configuration || {};
  const instruments = Array.isArray(config.instruments) ? config.instruments : [];
  $("agentConfiguration").replaceChildren(
    configCard("Markets", instruments.map((row) => row.display_symbol).filter(Boolean).join(" + ") || "Unavailable", instruments.map((row) => row.venue).filter(Boolean).join(" · ")),
    configCard("Per leg", config.notional_usdc ? `${config.notional_usdc} USDC` : "Unavailable", config.cadence || "Not scheduled"),
    configCard("Basis", Number.isFinite(config.entry_basis_bps) ? `${config.entry_basis_bps} bps in` : "Unavailable", Number.isFinite(config.exit_basis_bps) ? `${config.exit_basis_bps} bps out` : "Exit unavailable"),
    configCard("Policy", config.user_policy_adopted ? "Adopted" : "Unresolved", config.specification_hash ? `Spec ${config.specification_hash.slice(0, 10)}` : "No immutable spec"),
  );

  const capital = $("agentCapital");
  capital.replaceChildren();
  for (const row of Array.isArray(agent.capital) ? agent.capital : []) {
    const card = element("div", "capital-card");
    card.append(element("span", "", row.venue), element("strong", "", row.available), element("small", "", `Reserved ${clean(row.reserved)} · Gas ${clean(row.gas)}`));
    capital.append(card);
  }

  const plan = agent.plan || {};
  $("agentPlanState").textContent = clean(plan.state, "No plan").replaceAll("_", " ");
  const planRoot = $("agentPlan");
  planRoot.replaceChildren();
  for (const leg of Array.isArray(plan.legs) ? plan.legs : []) {
    const card = element("div", "plan-leg");
    card.dataset.state = clean(leg.state, "unknown").toLowerCase();
    card.append(element("span", "", `${leg.venue} · ${leg.state}`), element("strong", "", `${leg.action} · ${leg.notional}`), element("small", "", leg.detail));
    planRoot.append(card);
  }

  const policy = agent.policy || {};
  const policyResult = clean(policy.result, "indeterminate").toLowerCase();
  $("agentPolicyResult").textContent = policyResult;
  document.querySelector(".agent-policy-section").dataset.result = policyResult;
  const policyRoot = $("agentPolicy");
  policyRoot.replaceChildren();
  for (const rule of Array.isArray(policy.rules) ? policy.rules : []) {
    const card = element("div", "policy-rule");
    card.append(element("span", "", `${rule.result} · ${rule.name}`), element("small", "", rule.detail));
    policyRoot.append(card);
  }

  const events = $("agentEvents");
  events.replaceChildren();
  for (const event of Array.isArray(agent.events) ? agent.events : []) {
    const row = element("li");
    row.append(element("time", "", event.at), element("span", "", event.type), element("strong", "", event.detail));
    events.append(row);
  }
  const mutable = state.payload?.demonstration_data !== true && !state.transitioning;
  const lifecycle = clean(agent.state, "draft").toLowerCase();
  $("agentValidate").disabled = !mutable || lifecycle !== "draft";
  $("agentStart").textContent = new Set(["paper_paused", "paused"]).has(lifecycle) ? "Resume paper" : "Start paper";
  $("agentStart").disabled = !mutable || !new Set(["validated", "paper_paused", "paused"]).has(lifecycle);
  $("agentPause").disabled = !mutable || !new Set(["paper", "paper_accepted"]).has(lifecycle);
  $("agentKill").disabled = !mutable || new Set(["killed", "expired", "failed"]).has(lifecycle);
}

function renderRadar() {
  const radar = state.payload?.radar || {};
  $("radarFreshness").textContent = clean(radar.freshness_state, "Unavailable");
  const grid = $("radarGrid");
  grid.replaceChildren();
  const entries = Array.isArray(radar.entries) ? radar.entries.slice(0, 100) : [];
  if (!entries.length) {
    const empty = element("div", "radar-card");
    empty.append(
      element("span", "", radar.partial_failure === true ? "Partial failure" : "No indexed evidence"),
      element("strong", "", radar.partial_failure === true ? "Radar unavailable" : "Registry watch is empty"),
    );
    grid.append(empty);
    $("radarDetail").hidden = true;
    return;
  }
  for (const entry of entries) {
    const card = element("button", "radar-card");
    card.type = "button";
    card.append(element("span", "", `${entry.chain} · ${entry.verification}`), element("strong", "", entry.name));
    const metrics = element("dl");
    metrics.append(metric("Activity", entry.activity), metric("Endpoint", entry.endpoint), metric("Liquidity", entry.liquidity));
    card.append(metrics);
    card.addEventListener("click", () => renderRadarDetail(entry));
    grid.append(card);
  }
  renderRadarDetail(entries[0]);
}

function factSection(title, values) {
  const section = element("section");
  section.append(element("h3", "", title));
  const list = element("ul");
  for (const value of Array.isArray(values) ? values : []) list.append(element("li", "", value));
  section.append(list);
  return section;
}

function renderRadarDetail(entry) {
  const root = $("radarDetail");
  root.hidden = false;
  root.replaceChildren(element("h2", "", entry.name));
  const facts = element("div", "radar-facts");
  facts.append(
    factSection("Verified facts", entry.facts),
    factSection("Project claims", entry.claims),
    factSection("Unknowns", entry.unknowns),
    factSection("Warnings", entry.warnings),
  );
  root.append(facts);
}

function selectView(view) {
  state.view = view === "radar" ? "radar" : "agents";
  document.querySelectorAll("[data-agent-view]").forEach((button) => button.classList.toggle("active", button.dataset.agentView === state.view));
  $("agentsWorkspace").hidden = state.view !== "agents" || !state.payload;
  $("radarWorkspace").hidden = state.view !== "radar" || !state.payload;
}

async function loadWorkspace() {
  const fixtureRequested = new URLSearchParams(location.search).get("fixture") === "two-venue";
  const localFixtureAllowed = fixtureRequested && ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (localFixtureAllowed) return developmentFixture;
  const response = await fetch("/api/v1/agents/workspace", { credentials: "include", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(clean(payload?.error, response.status === 401 ? "authentication_required" : "workspace_unavailable"));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadSession() {
  const response = await fetch("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.authenticated) state.csrf = clean(payload.csrf_token, "");
  return payload;
}

async function transitionAgent(action) {
  const agent = state.selectedAgent;
  if (!agent || state.payload?.demonstration_data === true || state.transitioning) return;
  if (action === "kill" && !globalThis.confirm(`Kill ${clean(agent.name)}? This cannot place an unwind.`)) return;
  state.transitioning = true;
  renderAgent();
  const labels = { kill: "Killing", pause: "Pausing", validate: "Validating", "start-paper": "Starting", "resume-paper": "Resuming" };
  setStatus("loading", labels[action] || "Updating", "Recording owner request");
  try {
    if (!state.csrf) await loadSession();
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(agent.agent_id)}/${action}`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(clean(result?.error, "transition_failed"));
    const selectedId = agent.agent_id;
    state.payload = await loadWorkspace();
    state.selectedAgent = state.payload.agents?.find((row) => row.agent_id === selectedId) || state.payload.agents?.[0] || null;
    const finished = { kill: "Killed", pause: "Paused", validate: "Validated", "start-paper": "Paper active", "resume-paper": "Paper resumed" };
    setStatus("ready", "Paper ready", `${finished[action] || "Updated"} · no order submitted`);
    renderAgentList();
  } catch {
    setStatus("error", "Unavailable", "No state changed");
  } finally {
    state.transitioning = false;
    renderAgent();
  }
}

function openComposer() {
  if (state.payload?.demonstration_data === true || state.creating) return;
  $("agentFormError").textContent = "";
  $("agentComposer").showModal();
}

function closeComposer() {
  if (!state.creating) $("agentComposer").close();
}

async function createDraft(event) {
  event.preventDefault();
  if (state.creating || state.payload?.demonstration_data === true) return;
  const composerForm = event.currentTarget;
  state.creating = true;
  $("agentFormError").textContent = "";
  setStatus("loading", "Creating", "Sealing paper policy");
  const form = new FormData(composerForm);
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = {
    schema_version: "ravenos.agentic.paper_agent_draft_request.v1",
    idempotency_key: idempotencyKey,
    name: form.get("name"),
    template: "solana_hyperliquid_sol_hedge",
    notional_usdc: form.get("notional_usdc"),
    solana_capital_usdc: form.get("solana_capital_usdc"),
    hyperliquid_capital_usdc: form.get("hyperliquid_capital_usdc"),
    cadence_minutes: Number(form.get("cadence_minutes")),
    basis_entry_bps: Number(form.get("basis_entry_bps")),
    basis_exit_bps: Number(form.get("basis_exit_bps")),
    max_slippage_bps: Number(form.get("max_slippage_bps")),
    max_price_impact_bps: Number(form.get("max_price_impact_bps")),
    adopt_policy: form.get("adopt_policy") === "on",
  };
  try {
    if (!state.csrf) await loadSession();
    const response = await fetch("/api/v1/agents/drafts", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(clean(result?.error, "draft_creation_failed"));
    state.payload = await loadWorkspace();
    state.selectedAgent = state.payload.agents?.find((row) => row.agent_id === result.agent_id) || state.payload.agents?.[0] || null;
    $("agentComposer").close();
    composerForm.reset();
    setStatus("ready", "Draft ready", "Review and validate");
    renderAgentList();
    renderAgent();
  } catch (error) {
    $("agentFormError").textContent = clean(error?.message, "Draft unavailable").replaceAll("_", " ");
    setStatus("error", "Unavailable", "Draft not created");
  } finally {
    state.creating = false;
  }
}

document.querySelectorAll("[data-agent-view]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.agentView)));
$("agentNew").addEventListener("click", openComposer);
$("agentComposerClose").addEventListener("click", closeComposer);
$("agentComposerCancel").addEventListener("click", closeComposer);
$("agentComposerForm").addEventListener("submit", createDraft);
$("agentValidate").addEventListener("click", () => transitionAgent("validate"));
$("agentStart").addEventListener("click", () => transitionAgent(new Set(["paper_paused", "paused"]).has(clean(state.selectedAgent?.state, "").toLowerCase()) ? "resume-paper" : "start-paper"));
$("agentPause").addEventListener("click", () => transitionAgent("pause"));
$("agentKill").addEventListener("click", () => transitionAgent("kill"));

try {
  await loadSession();
  state.payload = await loadWorkspace();
  state.selectedAgent = state.payload.agents?.[0] || null;
  const fixture = state.payload.demonstration_data === true;
  setStatus("ready", fixture ? "Development fixture" : "Paper ready", fixture ? "No live data or orders" : "Live execution disabled");
  renderAgentList();
  renderAgent();
  renderRadar();
  selectView("agents");
} catch (error) {
  const login = error.status === 401;
  setStatus("error", login ? "Login required" : "Unavailable", login ? "Open your RavenOS account" : "Paper workspace is not enabled");
  $("agentsWorkspace").hidden = true;
  $("radarWorkspace").hidden = true;
}
