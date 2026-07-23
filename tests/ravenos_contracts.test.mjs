import test from "node:test";
import assert from "node:assert/strict";

import {
  RavenDataStates,
  adaptLegacyNarrator,
  customerFacingText,
  createIntelligenceRecord,
  createTerminalIntelligence,
  renderIntelligence,
  resolveDataState,
} from "../ravenos-intelligence-contract.js";
import {
  RAVENOS_CONTEXT_SCHEMA,
  contextFromSearch,
  createRavenOSContextStore,
} from "../ravenos-context-store.js";
import { scanHighRiskText } from "../scripts/validate-public-no-leak.mjs";

function createWindowFixture(search = "") {
  const values = new Map();
  const historyCalls = [];
  const listeners = new Map();
  const windowRef = {
    location: {
      origin: "https://ravenos.xyz",
      pathname: "/terminal/",
      search,
      hash: "",
      assigned: null,
      assign(value) { this.assigned = value; },
    },
    history: {
      replaceState(_state, _title, value) { historyCalls.push({ mode: "replace", value }); },
      pushState(_state, _title, value) { historyCalls.push({ mode: "push", value }); },
    },
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
    },
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  return { windowRef, historyCalls, values, listeners };
}

test("declared fresh data becomes delayed when its timestamp is old", () => {
  const freshness = resolveDataState({
    declaredState: "fresh",
    observedAt: "2026-07-04T14:41:26Z",
    nowMs: Date.parse("2026-07-18T00:00:00Z"),
  });
  assert.equal(freshness.state, RavenDataStates.DELAYED);
  assert.equal(freshness.label, "Delayed");
  assert.ok(freshness.ageSeconds > 1_000_000);
});

test("historical and simulated states are not relabeled as live", () => {
  const historical = resolveDataState({ declaredState: "historical", observedAt: "2026-07-18T00:00:00Z" });
  const simulated = resolveDataState({ declaredState: "simulated", observedAt: "2026-07-18T00:00:00Z" });
  assert.equal(historical.state, RavenDataStates.HISTORICAL);
  assert.equal(simulated.state, RavenDataStates.SIMULATED);
});

test("a bounded operator label may clarify which intelligence layer is unavailable", () => {
  const record = createIntelligenceRecord({
    subject: { id: "equity:us:AAPL", label: "AAPL" },
    freshness: { state: "unavailable", label: "Raven unavailable" },
  });
  assert.equal(record.freshness.state, RavenDataStates.DATA_UNAVAILABLE);
  assert.equal(record.freshness.label, "Raven unavailable");
});

test("legacy implementation language is normalized for customer renderings", () => {
  assert.equal(customerFacingText("Solana Live Activity"), "Solana market activity");
  assert.equal(customerFacingText("The closest comparable has sample depth is public-safe."), "The closest prior case has sample depth is available.");
});

test("legacy narrator payload maps into one structured intelligence contract", () => {
  const record = adaptLegacyNarrator({
    generated_at: "2026-07-04T14:41:26Z",
    headline: "Participation expanded while liquidity remained stable.",
    current_read: "Participation accelerated without a matching deterioration in depth.",
    supporting_evidence: ["Participation increased"],
    weakening_evidence: ["Second regime is not represented"],
    what_would_change_ravens_mind: ["Depth deteriorates before confirmation"],
    research_status: "research observation",
    confidence: { label: "medium", score: 0.51 },
    evidence_completeness: { label: "partial", score: 0.62 },
    freshness: { status: "fresh", latest_observed_at: "2026-07-04T14:41:26Z" },
  }, {
    subject: { id: "sol", label: "SOL-PERP", chain: "hyperliquid", marketType: "perp" },
    evidenceRole: "live_market_context",
  }, { nowMs: Date.parse("2026-07-18T00:00:00Z") });

  assert.equal(record.schemaVersion, "ravenos.intelligence.v1");
  assert.equal(record.subject.label, "SOL-PERP");
  assert.equal(record.freshness.state, RavenDataStates.DELAYED);
  assert.equal(record.supportingEvidence[0].label, "Participation increased");
  assert.match(renderIntelligence(record, "riskWarning"), /Second regime/);
});

test("terminal facts preserve market, evidence, invalidation, and source state", () => {
  const record = createTerminalIntelligence({
    subject: { id: "sol", label: "SOL-PERP", chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
    marketState: "Funding pressure elevated",
    setupState: "awaiting confirmation",
    participation: "Broad",
    liquidity: "Stable depth",
    risk: "Elevated",
    pressure: "Crowded longs",
    invalidation: ["Open interest falls without price continuation"],
    observedAt: "2026-07-18T00:00:00Z",
    dataState: "live",
    sourceReferences: ["Hyperliquid"],
  }, { nowMs: Date.parse("2026-07-18T00:00:30Z") });

  assert.equal(record.freshness.state, RavenDataStates.LIVE);
  assert.equal(record.subject.marketType, "perp");
  assert.ok(record.supportingEvidence.some((row) => row.label.includes("Crowded longs")));
  assert.ok(record.contradictingEvidence.some((row) => row.label.includes("Elevated")));
  assert.equal(record.invalidation[0].label, "Open interest falls without price continuation");
});

test("selected context is normalized from URL and persists cash and actual settlement separately", () => {
  const parsed = contextFromSearch("?asset=JUP&subject_id=crypto%3Apool%3Aethereum%3Auniswap%3A0xpool&chain=ethereum&market=spot&quote=WETH&settlement=WETH&cash=USDC&timeframe=4h&workspace=opportunity-review");
  assert.equal(parsed.schemaVersion, RAVENOS_CONTEXT_SCHEMA);
  assert.equal(parsed.subject.label, "JUP");
  assert.equal(parsed.subject.chain, "ethereum");
  assert.equal(parsed.subject.quoteAsset, "WETH");
  assert.equal(parsed.subject.settlementAsset, "WETH");
  assert.equal(parsed.subject.preferredCashAsset, "USDC");
  assert.equal(parsed.timeframe, "4h");

  const fixture = createWindowFixture("?asset=JUP&chain=ethereum&market=spot&quote=WETH&settlement=WETH&cash=USDC");
  const store = createRavenOSContextStore({ windowRef: fixture.windowRef });
  store.setSelection({
    subject: {
      id: "crypto:pool:ethereum:uniswap:0xpool",
      label: "JUP",
      chain: "ethereum",
      venue: "uniswap",
      marketType: "spot",
      instrumentType: "exact_pool",
      quoteAsset: { symbol: "WETH" },
      settlementAsset: { symbol: "WETH" },
      preferredCashAsset: { symbol: "USDC" },
    },
    timeframe: "1h",
  });
  const href = store.decorateHref("/outcomes/");
  assert.match(href, /^\/outcomes\/\?/);
  assert.match(href, /asset=JUP/);
  assert.match(href, /chain=ethereum/);
  assert.match(href, /quote=WETH/);
  assert.match(href, /settlement=WETH/);
  assert.match(href, /cash=USDC/);
  assert.ok(fixture.historyCalls.at(-1).value.includes("cash=USDC"));
  assert.match(store.decorateHref("/terminal/?workspace=watchlist"), /workspace=watchlist/);
});

test("a new market-search intent clears prior exact identity before navigation", () => {
  const fixture = createWindowFixture("?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&market=perp");
  const store = createRavenOSContextStore({ windowRef: fixture.windowRef });
  assert.equal(store.getState().subject.id, "hyperliquid:perp:SOL");

  store.clearSelection({ updateUrl: false });

  assert.equal(store.getState().subject.id, "unselected");
  assert.equal(store.getState().subject.identityScope, "unselected");
  const href = store.decorateHref("/terminal/?market=crypto_spot&instrument_type=exact_pool&search=JUP");
  assert.match(href, /market=crypto_spot/);
  assert.match(href, /search=JUP/);
  assert.doesNotMatch(href, /instrument_id=hyperliquid/);
});

test("missing evidence remains explicit in the intelligence contract", () => {
  const record = createIntelligenceRecord({
    subject: { label: "Unknown market" },
    evidenceQuality: { state: "insufficient", missingFields: ["liquidity", "direction"] },
  });
  assert.deepEqual(record.evidenceQuality.missingFields, ["liquidity", "direction"]);
  assert.equal(record.supportingEvidence.length, 0);
  assert.match(renderIntelligence(record, "chartAnnotation"), /No confirming evidence/);
});

test("public build gate rejects known synthetic Terminal payload signatures", () => {
  for (const payload of [
    "const samplePrices = [1, 2, 3]",
    "Raven Paper Candidates",
    "May 2026 compression",
    "smart-wallet-distribution",
  ]) {
    assert.ok(
      scanHighRiskText(payload, "terminal.js").some((finding) => finding.term === "synthetic_terminal_payload"),
      `expected synthetic Terminal payload finding for ${payload}`,
    );
  }
  assert.deepEqual(scanHighRiskText("No synthetic fallback is used.", "terminal.js"), []);
});
