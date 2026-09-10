import { ravenOSContext } from "./ravenos-context-store.js";
import { matchesMarketScope } from "./ravenos-market-scope.js";
import { enhanceDesk } from "./ravenos-desk-tools.js";
// Presentation preferences contain public market identities only, never account or order state.
export const DESK_STORAGE_KEY = "ravenos.terminal.desk.v1";
const EVM = /^0x[0-9a-f]{40}$/i;
const POOL = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function deskPercentFromBps(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "Not reported";
  const percent = Number(value) / 100;
  return `${percent !== 0 && Math.abs(percent) < 0.01 ? percent.toFixed(4) : percent.toFixed(2)}%`;
}
export function deskFeeLabel(actual, configured) {
  if (actual === null || actual === undefined || actual === "" || !Number.isFinite(Number(actual)) || Number(actual) < 0) return "Fee unavailable";
  if (Number(actual) === 0) return Number(configured) > 0
    ? `No fee in preview · listed rate ${deskPercentFromBps(configured)}` : "No fee in preview";
  return `${deskPercentFromBps(actual)} included in quote`;
}
export function deskMarket(input) {
  if (!input || typeof input !== "object") return null;
  const label = String(input.label || "").replace(/[\u0000-\u001f]/g, "").slice(0, 48);
  if (!label) return null;
  if (input.lane === "perps" && /^[A-Z0-9._-]{1,30}-PERP$/.test(input.asset || "")) {
    return { key: `hyperliquid:perp:${input.asset}`, lane: "perps", asset: input.asset, label, chain: "Hyperliquid" };
  }
  if (input.lane === "equity" && /^(equity|etf):[a-z0-9._-]{1,32}:[a-z0-9._-]{1,32}$/i.test(input.instrumentId || "") && /^[A-Z0-9._-]{1,32}$/.test(input.asset || "")) {
    return { key: input.instrumentId.toLowerCase(), lane: "equity", instrumentId: input.instrumentId.toLowerCase(), asset: input.asset, label, chain: "Listed market" };
  }
  const chain = String(input.chain || "").toLowerCase();
  if (input.lane !== "spot" || !["solana", "robinhood", "base", "bsc", "ethereum"].includes(chain)) return null;
  const tokenPattern = chain === "solana" ? SOL : EVM;
  const poolPattern = chain === "solana" ? SOL : POOL;
  if (!poolPattern.test(input.pool || "") || !tokenPattern.test(input.token || "") || !tokenPattern.test(input.quote || "")) return null;
  const address = value => chain === "solana" ? value : value.toLowerCase();
  const pool = address(input.pool), token = address(input.token), quote = address(input.quote);
  return { key: `${chain}:${pool}:${token}:${quote}`, lane: "spot", label, chain, pool, token, quote };
}
export function deskPreferences(input) {
  const seen = new Set();
  return {
    layout: ["balanced", "analysis", "focus"].includes(input?.layout) ? input.layout : "balanced",
    rail: input?.rail !== false,
    pinned: Array.isArray(input?.pinned) ? input.pinned.filter(x => typeof x === "string" && x.length < 240).slice(0, 20) : [],
    markets: (Array.isArray(input?.markets) ? input.markets.slice(0, 100) : []).map(deskMarket).filter(row => row && !seen.has(row.key) && seen.add(row.key)).slice(0, 20),
    dataHeight: Math.max(180, Math.min(600, Number(input?.dataHeight) || 300)),
  };
}
export function createTerminalDesk({ openMarket, inspectPane, resizeChart }) {
  const root = document.querySelector(".terminal-live");
  if (!root) return null;
  let stored;
  try { stored = JSON.parse(localStorage.getItem(DESK_STORAGE_KEY)); } catch { /* Unavailable storage uses session defaults. */ }
  const prefs = deskPreferences(stored);
  let active = null, pending = false, lastRender = "", tools = null;
  root.classList.add("terminal-desk");
  root.dataset.deskDock = prefs.layout === "analysis" ? "raven" : "trade";
  root.dataset.deskData = "none";
  const toolbar = document.createElement("div");
  toolbar.className = "desk-toolbar";
  toolbar.innerHTML = `<button type="button" id="deskMarketsToggle" aria-controls="deskMarkets" aria-expanded="true">☷ <span>Markets</span></button><span class="desk-title">Trading desk</span><div class="desk-toolbar-end"><label class="desk-layout-label"><span class="sr-only">Workspace layout</span><select id="deskLayout" aria-label="Workspace layout"><option value="balanced">Balanced</option><option value="analysis">Analysis</option><option value="focus">Chart focus</option></select></label><details id="deskMarketInfo" class="desk-info"><summary>Market info</summary><div class="desk-info-body"></div></details></div>`;
  root.prepend(toolbar);
  const info = toolbar.querySelector(".desk-info-body");
  const extraFacts = document.createElement('dl'); extraFacts.className = 'desk-mobile-extra-facts';
  info.append(extraFacts);
  toolbar.querySelector('#deskMarketInfo').addEventListener('toggle', event => {
    if (!event.currentTarget.open) return;
    extraFacts.replaceChildren();
    for (const id of ['terminalMetric5Cell', 'terminalMetric6Cell']) {
      const source = document.getElementById(id); if (!source || source.hidden) continue;
      const label = document.createElement('dt'), value = document.createElement('dd');
      label.textContent = source.querySelector('span')?.textContent || '';
      value.textContent = source.querySelector('strong')?.textContent || '';
      extraFacts.append(label, value);
    }
  });
  const controls = root.querySelector(".terminal-controls");
  const instrument = root.querySelector(".terminal-instrument");
  instrument.prepend(document.getElementById("terminalInstrumentTrigger"));
  document.getElementById("terminalInstrumentTrigger").prepend(document.getElementById("terminalInstrumentImage"));
  toolbar.querySelector(".desk-title").after(document.getElementById("terminalLaunchBadge"));
  const wallet = document.getElementById("terminalWalletConnect");
  toolbar.querySelector(".desk-toolbar-end").append(wallet);
  for (const selector of [".terminal-operator-head", ".terminal-actions", "#terminalChainCoverage", "#terminalMarketEvidence"]) {
    const element = root.querySelector(selector);
    if (element) info.append(element);
  }
  controls.classList.add("desk-legacy-controls");
  info.append(document.getElementById("terminalSourceDetail"));
  const workspace = root.querySelector(".terminal-workspace");
  const rail = document.createElement("aside");
  rail.id = "deskMarkets";
  rail.className = "desk-markets";
  rail.setAttribute("aria-label", "Recent and pinned markets");
  rail.innerHTML = `<header><strong>Markets</strong><button type="button" id="deskAddMarket" aria-label="Search markets">+</button></header><div class="desk-market-mode"><span>Recent &amp; pinned</span><button type="button" id="deskClearMarkets">Clear recent</button></div><div id="deskMarketRows"></div><div class="desk-rail-note">Saved on this browser</div><div id="deskMarketMessage" role="status"></div>`;
  workspace.prepend(rail);
  const data = document.createElement("section");
  data.className = "desk-data-panel";
  data.setAttribute("aria-label", "Market activity and account data");
  const handle = document.createElement("div");
  handle.className = "desk-data-resize";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Resize market data panel");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-valuemin", "180");
  handle.setAttribute("aria-valuemax", "600");
  info.append(document.getElementById("terminalMarketTools"));
  data.append(handle, root.querySelector(".terminal-pane-nav"));
  for (const id of ["terminalSpotActivitySection", "terminalAnatomySection", "terminalMarketRail", "terminalAccountDock"]) data.append(document.getElementById(id));
  workspace.append(data);
  const dock = root.querySelector(".terminal-intelligence");
  const dockNav = document.createElement("nav");
  dockNav.className = "desk-dock-nav";
  dockNav.setAttribute("aria-label", "Desk tools");
  dockNav.innerHTML = `<button type="button" data-desk-tab="trade" aria-pressed="true">Trade review</button><button type="button" data-desk-tab="raven" aria-pressed="false">Raven research</button>`;
  dock.prepend(dockNav);
  const research = document.createElement("div");
  research.className = "desk-unavailable-actions";
  research.innerHTML = `<button type="button" data-desk-action="holders">Inspect holders</button><button type="button" data-desk-action="raven">Open Raven research</button>`;
  document.getElementById("terminalSpotAdapterNotice").append(research);
  const save = () => { try { localStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(prefs)); } catch { /* Browsing remains usable without persistence. */ } };
  function apply() {
    root.dataset.deskLayout = prefs.layout;
    root.dataset.deskRail = String(prefs.rail);
    root.style.setProperty("--desk-data-height", `${prefs.dataHeight}px`);
    toolbar.querySelector("#deskMarketsToggle").setAttribute("aria-expanded", String(prefs.rail));
    toolbar.querySelector("#deskLayout").value = prefs.layout;
    handle.setAttribute("aria-valuenow", String(prefs.dataHeight));
    requestAnimationFrame(() => resizeChart?.());
  }
  function render() {
    const signature = JSON.stringify([prefs.markets, prefs.pinned, active?.key, ravenOSContext.getState().marketScope, pending, tools?.signature()]);
    if (signature === lastRender) return;
    lastRender = signature;
    const rows = document.getElementById("deskMarketRows");
    const focusedKey = document.activeElement?.closest(".desk-market-row")?.dataset.key;
    const focusedPin = document.activeElement?.classList.contains("desk-market-pin");
    rows.replaceChildren();
    const sorted = prefs.markets.filter(market => matchesMarketScope(market, ravenOSContext.getState().marketScope)).sort((a, b) => Number(prefs.pinned.includes(b.key)) - Number(prefs.pinned.includes(a.key)));
    const ordered = tools?.ordered(sorted) || sorted;
    for (const market of ordered) {
      const row = document.createElement("div");
      row.className = "desk-market-row";
      row.dataset.key = market.key;
      row.dataset.active = String(market.key === active?.key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "desk-market-open";
      button.disabled = pending;
      button.setAttribute("aria-current", market.key === active?.key ? "true" : "false");
      const title = document.createElement("strong"), subtitle = document.createElement("span");
      title.textContent = market.label;
      subtitle.textContent = market.chain === "bsc" ? "BNB Chain" : market.chain.charAt(0).toUpperCase() + market.chain.slice(1);
      button.append(title, subtitle);
      button.addEventListener("click", async () => {
        pending = true; render();
        document.getElementById("deskMarketMessage").textContent = "Loading market…";
        try { await openMarket(market); document.getElementById("deskMarketMessage").textContent = ""; }
        catch { document.getElementById("deskMarketMessage").textContent = "Market unavailable. Try again."; }
        finally { pending = false; render(); }
        if (matchMedia("(max-width: 820px)").matches) { prefs.rail = false; apply(); }
      });
      const pin = document.createElement("button");
      const pinned = prefs.pinned.includes(market.key);
      pin.type = "button"; pin.className = "desk-market-pin"; pin.textContent = pinned ? "★" : "☆";
      pin.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${market.label}`);
      pin.setAttribute("aria-pressed", String(pinned));
      pin.addEventListener("click", () => { prefs.pinned = pinned ? prefs.pinned.filter(key => key !== market.key) : [...prefs.pinned, market.key].slice(-20); save(); render(); });
      row.append(button, pin); tools?.decorate(row, market); rows.append(row);
    }
    if (focusedKey) [...rows.children].find(row => row.dataset.key === focusedKey)?.querySelector(focusedPin ? ".desk-market-pin" : ".desk-market-open")?.focus();
    if (!ordered.length) rows.textContent = "No markets in this list. Search a market or add the selected market using Manage lists.";
  }
  toolbar.querySelector("#deskMarketsToggle").addEventListener("click", () => { prefs.rail = !prefs.rail; save(); apply(); });
  toolbar.querySelector("#deskLayout").addEventListener("change", event => { prefs.layout = event.target.value; save(); apply(); if (prefs.layout === "analysis") inspectPane("raven"); });
  document.getElementById("deskAddMarket").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.getElementById("deskClearMarkets").addEventListener("click", () => { prefs.markets = prefs.markets.filter(row => prefs.pinned.includes(row.key) || row.key === active?.key || tools?.retains(row.key)); save(); render(); });
  for (const button of root.querySelectorAll("[data-desk-tab], [data-desk-action]")) button.addEventListener("click", () => inspectPane(button.dataset.deskTab || button.dataset.deskAction));
  document.addEventListener("pointerdown", event => { const disclosure = document.getElementById("deskMarketInfo"); if (!disclosure.contains(event.target) && !document.getElementById("terminalProjectLinksPopover")?.contains(event.target)) disclosure.open = false; });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (document.getElementById("terminalProjectLinksPopover")?.hidden === false) return;
      const disclosure = document.getElementById("deskMarketInfo");
      if (disclosure.open) { disclosure.open = false; disclosure.querySelector("summary").focus(); }
      if (matchMedia("(max-width: 820px)").matches && prefs.rail) { prefs.rail = false; apply(); toolbar.querySelector("#deskMarketsToggle").focus(); }
    }
  });
  handle.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); prefs.dataHeight = event.key === "Home" ? 180 : event.key === "End" ? 600 : Math.max(180, Math.min(600, prefs.dataHeight + (event.key === "ArrowUp" ? 20 : -20))); apply(); save();
  });
  let drag = null;
  handle.addEventListener("pointerdown", event => { drag = { y: event.clientY, height: prefs.dataHeight }; handle.setPointerCapture(event.pointerId); });
  handle.addEventListener("pointermove", event => { if (!drag) return; prefs.dataHeight = Math.max(180, Math.min(600, drag.height + drag.y - event.clientY)); apply(); });
  handle.addEventListener("pointerup", () => { drag = null; save(); });
  handle.addEventListener("pointercancel", () => { drag = null; });
  const narrow = matchMedia("(max-width: 1180px)");
  narrow.addEventListener("change", event => { if (event.matches) { prefs.rail = false; apply(); } });
  document.getElementById("deskMarketInfo").addEventListener("toggle", event => {
    if (event.target.open && narrow.matches) { prefs.rail = false; apply(); }
  });
  document.getElementById("deskMarketRows").addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !event.target.matches(".desk-market-open")) return;
    const buttons = [...rail.querySelectorAll(".desk-market-open:not(:disabled)")];
    const index = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  });
  const paneNav = root.querySelector(".terminal-pane-nav");
  const paneHelp = document.createElement("span");
  paneHelp.id = "deskPaneKeyboardHelp";
  paneHelp.className = "sr-only";
  paneHelp.textContent = "Use left and right arrows to move between panels. Press Enter to open a panel.";
  paneNav.append(paneHelp);
  paneNav.setAttribute("aria-describedby", paneHelp.id);
  paneNav.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !event.target.matches("[data-terminal-pane-button]")) return;
    const buttons = [...paneNav.querySelectorAll("[data-terminal-pane-button]")].filter(button => !button.hidden && !button.disabled && button.getClientRects().length);
    const index = buttons.indexOf(event.target);
    if (index < 0 || !buttons.length) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus({ preventScroll: true });
    buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  tools = enhanceDesk({root,toolbar,rail,dock,prefs,save,apply,render,openMarket,inspectPane});
  if (narrow.matches) prefs.rail = false;
  apply(); render();
  return {
    attachChart(workspace) {
      const host = document.createElement("div");
      host.className = "desk-chart-read-host";
      dockNav.after(host);
      workspace.setReadHost(host);
      tools.attach(workspace);
      host.querySelector(".rpw-quick-read")?.classList.add("desk-chart-read");
    },
    update(input) {
      const market = deskMarket(input);
      active = market;
      if (market && prefs.markets[0]?.key !== market.key) {
        const others = prefs.markets.filter(row => row.key !== market.key);
        prefs.markets = [market, ...others.filter(row => prefs.pinned.includes(row.key) || tools?.retains(row.key)), ...others.filter(row => !prefs.pinned.includes(row.key) && !tools?.retains(row.key))].slice(0, 20);
        save();
      }
      tools.update(market);
      for (const button of dockNav.querySelectorAll("button")) {
        button.hidden = root.querySelector(`[data-terminal-pane-button="${button.dataset.deskTab}"]`)?.hidden === true;
      }
      if (dockNav.querySelector(`[data-desk-tab="${root.dataset.deskDock}"]`)?.hidden) root.dataset.deskDock = root.dataset.deskDock === "trade" ? "raven" : "trade";
      for (const button of dockNav.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.deskTab === root.dataset.deskDock));
      render();
    },
    pane(pane) {
      if (["chart", "trade", "raven"].includes(pane)) root.dataset.deskDock = pane === "chart" ? "trade" : pane;
      root.dataset.deskData = pane === 'chart_activity' ? 'activity' : ["activity", "holders", "book", "account"].includes(pane) ? pane : "none";
      for (const button of dockNav.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.deskTab === root.dataset.deskDock));
      // Focus layout expands only on a deliberate panel action.
      if (pane !== "chart" && prefs.layout === "focus") { prefs.layout = "balanced"; apply(); save(); }
      requestAnimationFrame(() => resizeChart?.());
    },
  };
}
