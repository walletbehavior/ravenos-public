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
  if (value === null || value === undefined || value === "") return null;
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

function holdingValue(value, fallback = "Unavailable") {
  return value === "—" || value === "" ? fallback : value;
}

function positionMarkPrice(position) {
  for (const candidate of [position.mark_price, position.current_price, position.live_price]) {
    const price = finite(candidate);
    if (price !== null) return price;
  }
  const notional = finite(position.mark_notional_usdc);
  const size = finite(position.size);
  return notional !== null && size !== null && Math.abs(size) > 0 ? notional / Math.abs(size) : null;
}

function positionCell(label, value, detail, { tone = "", state = "available" } = {}) {
  const cell = document.createElement("span");
  cell.className = "portfolio-position-cell";
  cell.dataset.label = label;
  cell.dataset.state = state;
  if (tone) cell.dataset.tone = tone;
  const primary = document.createElement("strong");
  primary.textContent = value;
  const secondary = document.createElement("small");
  secondary.textContent = detail;
  cell.append(primary, secondary);
  return cell;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function observedLabel(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Current account snapshot";
  return `Updated ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed)}`;
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
  const identity = document.createElement("span");
  identity.className = "portfolio-position-identity";
  const symbol = document.createElement("strong");
  symbol.textContent = `${position.market || "Unresolved"} · ${publicLabel(position.side, "Position")}`;
  const side = document.createElement("small");
  side.textContent = "Hyperliquid perpetual";
  identity.append(symbol, side);

  const amount = finite(position.size);
  const leverage = finite(position.leverage);
  const markPrice = positionMarkPrice(position);
  const entryPrice = finite(position.entry_price);
  const pnlValue = finite(position.unrealized_pnl_usdc);
  const returnValue = finite(position.return_on_equity);

  row.append(
    identity,
    positionCell("Amount", amount === null ? "Unavailable" : formatNumber(Math.abs(amount)), leverage === null ? "Position size" : `${formatNumber(leverage)}× leverage`, { state: amount === null ? "unavailable" : "available" }),
    positionCell("Supply", "N/A", "Perpetual contract", { state: "not-applicable" }),
    positionCell("Current price", holdingValue(formatMoney(markPrice)), markPrice === null ? "No current mark" : "Marked", { state: markPrice === null ? "unavailable" : "marked" }),
    positionCell("Avg entry", holdingValue(formatMoney(entryPrice)), entryPrice === null ? "Cost basis unavailable" : "Average entry", { state: entryPrice === null ? "unavailable" : "available" }),
    positionCell("Current P&L", pnlValue === null ? "Unavailable" : formatMoney(pnlValue), returnValue === null ? "Unrealized" : `${formatPercent(returnValue)} unrealized`, { tone: pnlValue === null ? "" : pnlValue >= 0 ? "positive" : "negative", state: pnlValue === null ? "unavailable" : "marked" }),
  );
  return row;
}

function renderAccount(snapshot) {
  accountState.snapshot = snapshot;
  const results = document.getElementById("portfolioAccountResults");
  results.hidden = false;
  const summary = document.querySelector(".portfolio-account-summary");
  if (summary) summary.hidden = snapshot.state === "empty";
  document.getElementById("portfolioObservedAddress").textContent = shortAddress(snapshot.account?.address);
  document.getElementById("portfolioObservedAddress").title = snapshot.account?.address || "";
  document.getElementById("portfolioObservedAt").textContent = observedLabel(snapshot.observed_at);
  document.getElementById("portfolioAccountEquity").textContent = formatMoney(snapshot.summary?.account_value_usdc);
  document.getElementById("portfolioAccountWithdrawable").textContent = formatMoney(snapshot.summary?.withdrawable_usdc);
  const marginUse = finite(snapshot.summary?.margin_utilization_ratio);
  document.getElementById("portfolioAccountMargin").textContent = `${formatMoney(snapshot.summary?.margin_used_usdc)}${marginUse === null ? "" : ` · ${(marginUse * 100).toFixed(1)}%`}`;
  document.getElementById("portfolioAccountExposure").textContent = formatMoney(snapshot.summary?.position_notional_usdc);
  document.getElementById("portfolioAccountMaintenance").textContent = formatMoney(snapshot.summary?.maintenance_margin_usdc);
  const accountLeverage = finite(snapshot.summary?.account_leverage);
  document.getElementById("portfolioAccountLeverage").textContent = accountLeverage === null ? "—" : `${formatNumber(accountLeverage)}×`;

  const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  document.getElementById("portfolioPositionCount").textContent = `${positions.length} ${positions.length === 1 ? "position" : "positions"}`;
  const list = document.getElementById("portfolioPositionList");
  list.replaceChildren();
  if (!positions.length) {
    const empty = document.createElement("div");
    empty.className = "portfolio-position-empty";
    empty.textContent = snapshot.state === "empty"
      ? "No balances, margin, positions, orders, or recent fills were returned for this address."
      : "No open perpetual positions on this account.";
    list.append(empty);
    return;
  }
  const columns = document.createElement("div");
  columns.className = "portfolio-position-columns";
  ["Token", "Amount", "% supply", "Current price", "Avg entry", "Current P&L"].forEach((label) => {
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
  status.textContent = "Loading collateral, margin risk, and open exposure…";
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
    status.textContent = "Current public account snapshot · address retained only in this tab";
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
