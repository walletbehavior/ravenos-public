import { ravenOSContext } from "/ravenos-context-store.js";

function publicLabel(value, fallback = "—") {
  const clean = String(value || "").trim();
  if (!clean || ["unknown", "none", "all", "unselected"].includes(clean.toLowerCase())) return fallback;
  return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderSelection(context) {
  const subject = context.subject || {};
  const selected = subject.id && subject.id !== "unselected";
  document.getElementById("portfolioSelected").textContent = selected ? subject.label : "Start with a market";
  document.getElementById("portfolioSelectedMeta").textContent = selected
    ? `${subject.label} is in focus. Review its current market before considering portfolio consequences.`
    : "Search any supported instrument to inspect its market and risk context.";
  const ledger = document.getElementById("portfolioSelectionLedger");
  const terminal = document.getElementById("portfolioOpenTerminal");
  ledger.hidden = !selected;
  terminal.hidden = !selected;
  if (!selected) return;
  document.getElementById("portfolioSelectionMarket").textContent = publicLabel(subject.marketType || subject.instrumentType, "Market");
  document.getElementById("portfolioSelectionVenue").textContent = publicLabel(subject.venue);
  document.getElementById("portfolioSelectionSettlement").textContent = publicLabel(subject.settlementAsset);
  document.getElementById("portfolioSelectionNumeraire").textContent = `${publicLabel(subject.economicNumeraire, "USDC")} equivalent`;
  terminal.href = ravenOSContext.decorateHref("/terminal/");
}

ravenOSContext.subscribe(renderSelection);
document.getElementById("portfolioSearchTrigger")?.addEventListener("click", () => {
  document.getElementById("rosCommandTrigger")?.click();
});
window.RavenOSShell?.setCapabilities?.({ market: "Market inspection", mode: "Portfolio preview", signing: "Unavailable", broadcast: "Unavailable", evidence: "No connected holdings" });
window.RavenOSShell?.setIntelligence?.({
  presentation: { status: false, context: false },
  subject: ravenOSContext.getState().subject,
  marketState: { label: "Portfolio connections closed", regime: "unavailable" },
  setupState: { state: "unavailable", confirmation: "no connected holdings" },
  thesis: "Portfolio connections are not open yet.",
  supportingEvidence: ["Market inspection remains available.", "Selecting a market is not treated as ownership."],
  contradictingEvidence: [],
  invalidation: [],
  timeHorizon: "not applicable",
  confidence: { label: "not applicable" },
  evidenceQuality: { state: "unavailable", lineageComplete: true },
  freshness: { state: "data_unavailable", observedAt: null },
  nextExpectedTransition: "Portfolio data will appear after secure, user-controlled connections launch.",
});
window.__RAVENOS_PORTFOLIO__ = Object.freeze({
  schemaVersion: "ravenos.portfolio_surface.v1",
  customerDataLoaded: false,
  connectorsAvailable: false,
  signingAvailable: false,
  getSelection: () => ravenOSContext.getState().subject,
});
