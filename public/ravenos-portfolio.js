import { ravenOSContext } from "/ravenos-context-store.js";

const accountState = {
  snapshot: null,
  generation: 0,
};

function publicLabel(value, fallback = "—") {
  const clean = String(value || "").trim();
  if (!clean || ["unknown", "none", "all", "unselected"].includes(clean.toLowerCase())) return fallback;
  return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  const number = finite(value);
  if (number === null) return "—";
  const magnitude = Math.abs(number);
  const maximumFractionDigits = magnitude >= 1000 ? 0 : magnitude >= 10 ? 2 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(number);
}

function formatNumber(value) {
  const number = finite(value);
  if (number === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(number) < 10 ? 4 : 2 }).format(number);
}

function formatPercent(value) {
  const number = finite(value);
  if (number === null) return "";
  return `${number >= 0 ? "+" : ""}${(number * 100).toFixed(2)}%`;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function renderSelection(context) {
  const subject = context.subject || {};
  const selected = subject.id && subject.id !== "unselected";
  document.getElementById("portfolioSelected").textContent = selected ? subject.label : "Choose a market";
  document.getElementById("portfolioSelectedMeta").textContent = selected
    ? `${subject.label} is ready for charting, Raven context, and order planning in the terminal.`
    : "Use global search to bring any supported market into the Raven terminal.";
  const ledger = document.getElementById("portfolioSelectionLedger");
  const terminal = document.getElementById("portfolioOpenTerminal");
  ledger.hidden = !selected;
  terminal.hidden = !selected;
  if (!selected) return;
  document.getElementById("portfolioSelectionMarket").textContent = publicLabel(subject.marketType || subject.instrumentType, "Market");
  document.getElementById("portfolioSelectionVenue").textContent = publicLabel(subject.venue);
  document.getElementById("portfolioSelectionSettlement").textContent = publicLabel(subject.settlementAsset);
  document.getElementById("portfolioSelectionNumeraire").textContent = publicLabel(subject.economicNumeraire, "USDC");
  terminal.href = ravenOSContext.decorateHref("/terminal/");
}

function positionNode(position) {
  const row = document.createElement("a");
  row.className = "portfolio-position-row";
  row.dataset.side = position.side;
  const market = String(position.market || "").trim();
  const asset = `${market}-PERP`;
  row.href = `/terminal/?asset=${encodeURIComponent(asset)}&instrument_id=${encodeURIComponent(`hyperliquid:perp:${market}`)}`;
  row.setAttribute("aria-label", `Open ${market} perpetual in Terminal`);
  const side = document.createElement("strong");
  side.textContent = `${position.market} · ${position.side}`;
  const size = document.createElement("span");
  size.textContent = `${formatNumber(position.size)}${finite(position.leverage) !== null ? ` · ${formatNumber(position.leverage)}×` : ""}`;
  const entry = document.createElement("span");
  entry.textContent = formatMoney(position.entry_price);
  const pnl = document.createElement("span");
  pnl.textContent = `${formatMoney(position.unrealized_pnl_usdc)} ${formatPercent(position.return_on_equity)}`.trim();
  const pnlValue = finite(position.unrealized_pnl_usdc);
  if (pnlValue !== null) pnl.className = pnlValue >= 0 ? "portfolio-positive" : "portfolio-negative";
  const liquidation = document.createElement("span");
  liquidation.textContent = finite(position.liquidation_price) === null ? "No liq. price" : formatMoney(position.liquidation_price);
  row.append(side, size, entry, pnl, liquidation);
  return row;
}

function renderAccount(snapshot) {
  accountState.snapshot = snapshot;
  const results = document.getElementById("portfolioAccountResults");
  results.hidden = false;
  document.getElementById("portfolioObservedAddress").textContent = shortAddress(snapshot.account?.address);
  document.getElementById("portfolioObservedAddress").title = snapshot.account?.address || "";
  document.getElementById("portfolioObservedAt").textContent = "Current venue state";
  document.getElementById("portfolioAccountEquity").textContent = formatMoney(snapshot.summary?.account_value_usdc);
  document.getElementById("portfolioAccountWithdrawable").textContent = formatMoney(snapshot.summary?.withdrawable_usdc);
  document.getElementById("portfolioAccountMargin").textContent = formatMoney(snapshot.summary?.margin_used_usdc);
  document.getElementById("portfolioAccountExposure").textContent = formatMoney(snapshot.summary?.position_notional_usdc);

  const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  document.getElementById("portfolioPositionCount").textContent = `${positions.length} ${positions.length === 1 ? "position" : "positions"}`;
  const list = document.getElementById("portfolioPositionList");
  list.replaceChildren();
  if (!positions.length) {
    const empty = document.createElement("div");
    empty.className = "portfolio-position-empty";
    empty.textContent = "No open perpetual positions on this account.";
    list.append(empty);
    return;
  }
  const columns = document.createElement("div");
  columns.className = "portfolio-position-columns";
  ["Market", "Size / leverage", "Entry", "Unrealized P&L", "Liquidation"].forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    columns.append(span);
  });
  list.append(columns, ...positions.map(positionNode));
}

async function loadAccount(address) {
  const status = document.getElementById("portfolioAccountStatus");
  const submit = document.querySelector("#portfolioAccountForm button[type='submit']");
  const normalized = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    status.dataset.tone = "error";
    status.textContent = "Enter a complete 0x Hyperliquid address.";
    return;
  }
  const generation = ++accountState.generation;
  submit.disabled = true;
  status.dataset.tone = "";
  status.textContent = "Loading current equity, positions, orders, and fills…";
  try {
    const response = await fetch("/api/trade/account-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address: normalized }),
    });
    const payload = await response.json().catch(() => null);
    if (generation !== accountState.generation) return;
    if (!response.ok || !payload?.ok) throw new Error("account_load_failed");
    renderAccount(payload);
    status.textContent = "Current venue data · address retained only in this tab";
  } catch {
    if (generation !== accountState.generation) return;
    status.dataset.tone = "error";
    status.textContent = "That account could not be loaded right now. Try again.";
  } finally {
    if (generation === accountState.generation) submit.disabled = false;
  }
}

ravenOSContext.subscribe(renderSelection);
document.getElementById("portfolioSearchTrigger")?.addEventListener("click", () => {
  document.getElementById("rosCommandTrigger")?.click();
});
document.getElementById("portfolioAccountForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  loadAccount(document.getElementById("portfolioAccountAddress")?.value);
});

window.RavenOSShell?.setCapabilities?.({ market: "Global search", mode: "Public account view", evidence: "Current venue data" });
window.__RAVENOS_PORTFOLIO__ = Object.freeze({
  schemaVersion: "ravenos.portfolio_surface.v2",
  customerDataLoaded: false,
  connectorsAvailable: false,
  publicAccountObservationAvailable: true,
  signingAvailable: false,
  getSelection: () => ravenOSContext.getState().subject,
  getObservedAccount: () => accountState.snapshot,
});
