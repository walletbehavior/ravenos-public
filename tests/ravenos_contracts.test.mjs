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

test("selected context is normalized from URL and persists across route links", () => {
  const parsed = contextFromSearch("?asset=SOL-PERP&subject_id=sol&chain=hyperliquid&market=perp&timeframe=4h&workspace=opportunity-review");
  assert.equal(parsed.schemaVersion, RAVENOS_CONTEXT_SCHEMA);
  assert.equal(parsed.subject.label, "SOL-PERP");
  assert.equal(parsed.subject.chain, "hyperliquid");
  assert.equal(parsed.timeframe, "4h");

  const fixture = createWindowFixture("?asset=SOL-PERP&chain=hyperliquid&market=perp");
  const store = createRavenOSContextStore({ windowRef: fixture.windowRef });
  store.setSelection({
    subject: { id: "btc", label: "BTC-PERP", chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
    timeframe: "1h",
  });
  const href = store.decorateHref("/outcomes/");
  assert.match(href, /^\/outcomes\/\?/);
  assert.match(href, /asset=BTC-PERP/);
  assert.match(href, /chain=hyperliquid/);
  assert.ok(fixture.historyCalls.at(-1).value.includes("asset=BTC-PERP"));
  assert.match(store.decorateHref("/terminal/?workspace=watchlist"), /workspace=watchlist/);
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
