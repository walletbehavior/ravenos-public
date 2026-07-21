import {
  RavenDataStateLabels,
  adaptLegacyNarrator,
  createIntelligenceRecord,
  createTerminalIntelligence,
  renderIntelligence,
} from "/ravenos-intelligence-contract.js";
import { ravenOSContext } from "/ravenos-context-store.js";

const NAV_ITEMS = Object.freeze([
  { label: "Brief", href: "/brief/", match: ["home", "brief"] },
  { label: "Opportunities", href: "/opportunity/", match: ["opportunity"] },
  { label: "Perps", href: "/perps/", match: ["perps"] },
  { label: "Terminal", href: "/terminal/", match: ["terminal"] },
  { label: "Behavior", href: "/behavior/", match: ["behavior"] },
  { label: "Outcomes", href: "/outcomes/", match: ["outcomes", "claims"] },
  { label: "Replay", href: "/replay/", match: ["replay", "memory"] },
  { label: "Markets", href: "/chains/solana/", match: ["chain-solana", "chain-base", "chain-ethereum", "atlas"] },
  { label: "Research", href: "/research/", match: ["research"] },
]);

const MOBILE_NAV = Object.freeze([
  { label: "Brief", href: "/brief/" },
  { label: "Opportunities", href: "/opportunity/" },
  { label: "Perps", href: "/perps/" },
  { label: "Terminal", href: "/terminal/" },
  { label: "Outcomes", href: "/outcomes/" },
]);

function currentSlug() {
  const configured = document.getElementById("ravenosRouteConfig");
  if (configured) {
    try { return JSON.parse(configured.textContent || "{}").slug || ""; } catch { /* use path */ }
  }
  const segment = location.pathname.split("/").filter(Boolean)[0];
  return segment || "terminal";
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

function stateClass(value) {
  return String(value || "data_unavailable").toLowerCase().replaceAll(" ", "_");
}

function safeMetric(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function createShellMarkup(slug) {
  const primaryNav = NAV_ITEMS.map((item) => {
    const active = item.match.includes(slug) ? " active" : "";
    return `<a class="ros-nav-item${active}" href="${ravenOSContext.decorateHref(item.href)}" data-ros-context-link data-ros-base-href="${item.href}" data-ros-nav="${item.label.toLowerCase()}">${item.label}</a>`;
  }).join("");
  const mobileNav = MOBILE_NAV.map((item) => {
    const active = location.pathname === item.href || (item.href === "/terminal/" && location.pathname === "/terminal/") ? " active" : "";
    return `<a class="ros-mobile-nav-item${active}" href="${ravenOSContext.decorateHref(item.href)}" data-ros-context-link data-ros-base-href="${item.href}">${item.label}</a>`;
  }).join("");
  return `
    <header class="ros-topbar" data-ros-shell>
      <a class="ros-brand" href="${ravenOSContext.decorateHref("/brief/")}" data-ros-context-link data-ros-base-href="/brief/" aria-label="RavenOS Brief">
        <strong>RavenOS</strong><span>Evidence terminal</span>
      </a>
      <select class="ros-workspace-select" id="rosWorkspace" aria-label="Workspace">
        <option value="market-monitor">Market Monitor</option>
        <option value="opportunity-review">Opportunity Review</option>
        <option value="outcome-review">Outcome Review</option>
        <option value="research-lab">Research Lab</option>
      </select>
      <button class="ros-command-trigger" id="rosCommandTrigger" type="button" aria-haspopup="dialog" aria-controls="rosCommandPalette">
        <span>Search markets, behavior, evidence, outcomes</span><kbd>Ctrl K</kbd>
      </button>
      <div class="ros-global-selectors">
        <select id="rosChain" aria-label="Chain selector">
          <option value="all">All chains</option><option value="solana">Solana</option><option value="base">Base</option><option value="ethereum">Ethereum</option><option value="hyperliquid">Hyperliquid</option>
        </select>
        <select id="rosMarketType" aria-label="Market type selector">
          <option value="all">All markets</option><option value="spot">Spot</option><option value="perp">Perps</option>
        </select>
        <select id="rosTimeframe" aria-label="Timeframe selector">
          <option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option><option value="1w">1w</option>
        </select>
      </div>
      <div class="ros-capability-status" id="rosCapabilityStatus" aria-label="Terminal capability status">
        <span data-ros-capability="market">Data unavailable</span>
        <span data-ros-capability="wallet">No session</span>
        <span data-ros-capability="mode">Preview</span>
        <span data-ros-capability="signing">Sign off</span>
        <span data-ros-capability="broadcast">Broadcast off</span>
        <span data-ros-capability="evidence">Evidence pending</span>
      </div>
      <button class="ros-context-trigger" id="rosContextTrigger" type="button" aria-controls="rosContextRail" aria-expanded="false">Intelligence</button>
      <div class="ros-freshness" id="rosFreshness"><span class="ros-state-dot"></span><strong>Data unavailable</strong><time>No timestamp</time></div>
    </header>
    <nav class="ros-left-nav" aria-label="RavenOS workspace navigation">${primaryNav}<button class="ros-nav-item ros-nav-command" type="button" data-ros-command>Commands</button></nav>
    <aside class="ros-context-rail" id="rosContextRail" aria-label="Contextual intelligence">
      <header class="ros-context-header"><div><span>Selected context</span><strong id="rosContextSubject">No market selected</strong><small id="rosContextMeta">All markets</small></div><button id="rosContextClose" type="button" aria-label="Close intelligence">Close</button></header>
      <section class="ros-context-section"><span>Market state</span><strong id="rosMarketState">Data unavailable</strong><p id="rosThesis">No current thesis is available for this context.</p></section>
      <section class="ros-context-section ros-context-grid"><div><span>Setup</span><strong id="rosSetupState">Unqualified</strong></div><div><span>Horizon</span><strong id="rosHorizon">Not specified</strong></div><div><span>Confidence</span><strong id="rosConfidence">Unrated</strong></div><div><span>Evidence</span><strong id="rosEvidenceQuality">Unknown</strong></div></section>
      <section class="ros-context-section"><span>Confirmation</span><ul id="rosSupportingEvidence"><li>No confirming evidence is currently available.</li></ul></section>
      <section class="ros-context-section"><span>Invalidation</span><ul id="rosContradictingEvidence"><li>No explicit invalidation is currently available.</li></ul></section>
      <section class="ros-context-section"><span>Next expected transition</span><p id="rosNextTransition">No transition is currently declared.</p></section>
      <footer class="ros-context-footer"><button type="button" data-ros-context-action="replay">Open Replay</button><button type="button" data-ros-context-action="outcomes">Open Outcomes</button></footer>
    </aside>
    <div class="ros-activity-strip" aria-live="polite"><span id="rosActivityState">Data unavailable</span><strong id="rosActivitySubject">No market selected</strong><span id="rosActivityDetail">Waiting for a timestamped market update</span></div>
    <nav class="ros-mobile-nav" aria-label="Mobile primary navigation">${mobileNav}</nav>
    <dialog class="ros-command-palette" id="rosCommandPalette" aria-label="RavenOS command palette">
      <form method="dialog" class="ros-command-head"><label for="rosCommandInput">Command or search</label><button value="cancel" aria-label="Close command palette">Close</button></form>
      <input id="rosCommandInput" type="search" autocomplete="off" placeholder="Go to a market, workflow, or evidence surface" />
      <div class="ros-command-results" id="rosCommandResults"></div>
    </dialog>`;
}

function setList(id, values, fallback) {
  const host = document.getElementById(id);
  if (!host) return;
  host.replaceChildren();
  const items = values.length ? values : [fallback];
  for (const value of items.slice(0, 4)) {
    const li = document.createElement("li");
    li.textContent = value.label || String(value);
    host.append(li);
  }
}

function selectValue(id, value) {
  const element = document.getElementById(id);
  if (!element || !value) return;
  if ([...element.options].some((option) => option.value === value)) element.value = value;
}

function syncTerminalSelect(id, value) {
  const element = document.getElementById(id);
  if (!element || !value || ![...element.options].some((option) => option.value === value)) return false;
  if (element.value === value) return true;
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function routeCommands() {
  return [
    ...NAV_ITEMS.map((item) => ({ label: `Open ${item.label}`, detail: item.href, href: item.href })),
    { label: "Solana markets", detail: "Chain market context", href: "/chains/solana/" },
    { label: "Base markets", detail: "Chain market context", href: "/chains/base/" },
    { label: "Ethereum markets", detail: "Chain market context", href: "/chains/ethereum/" },
    { label: "Current evidence", detail: "Inspect supporting and contradicting evidence", action: "context" },
  ];
}

export function mountRavenOSShell(options = {}) {
  if (window.RavenOSShell?.mounted) return window.RavenOSShell;
  const slug = options.slug || currentSlug();
  const isTerminal = location.pathname.startsWith("/terminal/") || location.pathname.startsWith("/perps/");
  document.body.classList.add("ros-shell-active", isTerminal ? "ros-shell-terminal" : "ros-shell-route");
  document.body.insertAdjacentHTML("afterbegin", createShellMarkup(slug));

  let intelligence = createIntelligenceRecord({ subject: ravenOSContext.getState().subject });
  const palette = document.getElementById("rosCommandPalette");
  const commandInput = document.getElementById("rosCommandInput");
  const commandResults = document.getElementById("rosCommandResults");

  function renderContext(context = ravenOSContext.getState()) {
    document.getElementById("rosContextSubject").textContent = context.subject.label;
    document.getElementById("rosContextMeta").textContent = [context.subject.chain, context.subject.venue, context.subject.marketType].filter((value) => value && value !== "all").join(" / ") || "All markets";
    document.getElementById("rosActivitySubject").textContent = context.subject.label;
    selectValue("rosWorkspace", context.workspace);
    selectValue("rosChain", context.subject.chain);
    selectValue("rosMarketType", context.subject.marketType);
    selectValue("rosTimeframe", context.timeframe);
    const marketsLink = document.querySelector('[data-ros-nav="markets"]');
    if (marketsLink && ["solana", "base", "ethereum"].includes(context.subject.chain)) {
      marketsLink.dataset.rosBaseHref = `/chains/${context.subject.chain}/`;
    }
    document.querySelectorAll("[data-ros-context-link]").forEach((link) => {
      link.setAttribute("href", ravenOSContext.decorateHref(link.dataset.rosBaseHref || link.getAttribute("href")));
    });
  }

  function setIntelligence(next) {
    intelligence = next?.schemaVersion ? next : createIntelligenceRecord(next || {}, { subject: ravenOSContext.getState().subject });
    const freshness = intelligence.freshness;
    const freshnessHost = document.getElementById("rosFreshness");
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
    document.getElementById("rosActivityState").textContent = freshness.label;
    document.getElementById("rosActivityState").className = `state-${stateClass(freshness.state)}`;
    document.getElementById("rosActivityDetail").textContent = freshness.observedAt
      ? `${intelligence.marketState.label} | ${formatObservedAt(freshness.observedAt)}`
      : "Waiting for a timestamped market update";
    return intelligence;
  }

  function setCapabilities(next = {}) {
    const defaults = {
      market: "Data unavailable",
      wallet: "No session",
      mode: "Preview",
      signing: "Sign off",
      broadcast: "Broadcast off",
      evidence: "Evidence pending",
    };
    const state = { ...defaults, ...next };
    Object.entries(state).forEach(([key, value]) => {
      const field = document.querySelector(`[data-ros-capability="${key}"]`);
      if (field) field.textContent = safeMetric(value);
    });
    const host = document.getElementById("rosCapabilityStatus");
    if (host) host.dataset.marketState = state.market.toLowerCase().replaceAll(" ", "_");
    return state;
  }

  function openContext() {
    document.body.classList.add("ros-context-open");
    document.getElementById("rosContextTrigger").setAttribute("aria-expanded", "true");
  }

  function closeContext() {
    document.body.classList.remove("ros-context-open");
    document.getElementById("rosContextTrigger").setAttribute("aria-expanded", "false");
  }

  function renderCommands(query = "") {
    const normalized = query.trim().toLowerCase();
    const commands = routeCommands().filter((command) => !normalized || `${command.label} ${command.detail}`.toLowerCase().includes(normalized));
    commandResults.replaceChildren();
    for (const command of commands) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<strong></strong><span></span>`;
      button.querySelector("strong").textContent = command.label;
      button.querySelector("span").textContent = command.detail;
      button.addEventListener("click", () => {
        palette.close();
        if (command.action === "context") openContext();
        else ravenOSContext.navigate(command.href);
      });
      commandResults.append(button);
    }
    if (!commands.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matching workspace command. Use Terminal market lookup for symbols and contracts.";
      commandResults.append(empty);
    }
  }

  function openPalette() {
    renderCommands();
    if (!palette.open) palette.showModal();
    requestAnimationFrame(() => commandInput.focus());
  }

  document.getElementById("rosCommandTrigger").addEventListener("click", openPalette);
  document.querySelector("[data-ros-command]").addEventListener("click", openPalette);
  commandInput.addEventListener("input", () => renderCommands(commandInput.value));
  document.getElementById("rosContextTrigger").addEventListener("click", () => document.body.classList.contains("ros-context-open") ? closeContext() : openContext());
  document.getElementById("rosContextClose").addEventListener("click", closeContext);
  document.querySelector('[data-ros-context-action="replay"]').addEventListener("click", () => ravenOSContext.navigate("/replay/"));
  document.querySelector('[data-ros-context-action="outcomes"]').addEventListener("click", () => ravenOSContext.navigate("/outcomes/"));
  document.addEventListener("keydown", (event) => {
    const commandKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    const slashKey = event.key === "/" && !event.target.closest("input, textarea, select, [contenteditable='true']");
    if (commandKey || slashKey) {
      event.preventDefault();
      openPalette();
    }
    if (event.key === "Escape") closeContext();
  });

  document.getElementById("rosWorkspace").addEventListener("change", (event) => ravenOSContext.setContext({ workspace: event.target.value }));
  document.getElementById("rosChain").addEventListener("change", (event) => {
    const chain = event.target.value;
    ravenOSContext.setContext({ subject: { ...ravenOSContext.getState().subject, chain, venue: chain === "hyperliquid" ? "hyperliquid" : ravenOSContext.getState().subject.venue } });
    syncTerminalSelect("venueSelect", chain);
  });
  document.getElementById("rosMarketType").addEventListener("change", (event) => {
    const marketType = event.target.value;
    ravenOSContext.setContext({ subject: { ...ravenOSContext.getState().subject, marketType } });
    syncTerminalSelect("terminalModeSelect", marketType === "perp" ? "perps" : marketType === "spot" ? "spot" : marketType);
  });
  document.getElementById("rosTimeframe").addEventListener("change", (event) => {
    ravenOSContext.setContext({ timeframe: event.target.value });
    syncTerminalSelect("timeframeSelect", event.target.value);
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
  const api = {
    mounted: true,
    setIntelligence,
    setCapabilities,
    adaptLegacyNarrator: (payload, context = {}) => setIntelligence(adaptLegacyNarrator(payload, { ...context, subject: ravenOSContext.getState().subject })),
    openCommandPalette: openPalette,
    openContext,
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
