import { ravenOSContext } from "/ravenos-context-store.js";

function renderSelection(context) {
  const subject = context.subject || {};
  const selected = subject.id && subject.id !== "unselected";
  document.getElementById("portfolioSelected").textContent = selected ? subject.label : "No instrument selected";
  document.getElementById("portfolioSelectedMeta").textContent = selected
    ? `${subject.label} is in focus for market inspection. RavenOS does not treat that selection as a holding or position.`
    : "Use universal search to inspect a market. Selection does not imply ownership or a portfolio position.";
}

ravenOSContext.subscribe(renderSelection);
window.RavenOSShell?.setCapabilities?.({ market: "Public market context only", wallet: "No customer session", mode: "Portfolio unavailable", signing: "Sign off", broadcast: "Broadcast off", evidence: "No customer holdings" });
window.RavenOSShell?.setIntelligence?.({
  subject: ravenOSContext.getState().subject,
  marketState: { label: "No portfolio connected", regime: "unavailable" },
  setupState: { state: "unavailable", confirmation: "no customer data" },
  thesis: "RavenOS has no verified holdings, balances, or positions for this account.",
  supportingEvidence: ["No verified portfolio source is connected.", "Selecting a market is not treated as ownership."],
  contradictingEvidence: [],
  invalidation: [],
  timeHorizon: "not applicable",
  confidence: { label: "verified unavailable" },
  evidenceQuality: { state: "unavailable", lineageComplete: true },
  freshness: { state: "data_unavailable", observedAt: null },
  nextExpectedTransition: "Portfolio data will appear only after secure, user-controlled connections are available.",
});
window.__RAVENOS_PORTFOLIO__ = Object.freeze({
  schemaVersion: "ravenos.portfolio_surface.v1",
  customerDataLoaded: false,
  connectorsAvailable: false,
  signingAvailable: false,
  getSelection: () => ravenOSContext.getState().subject,
});
