import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRadarFieldCatalog,
  buildRobinhoodAgentRadarProjection,
} from "../lib/agentic_trading/robinhood/agent_radar.mjs";

const TOKEN = `0x${"11".repeat(20)}`;
const BLOCK_HASH = `0x${"aa".repeat(32)}`;
const NOW = "2026-09-01T22:00:00.000Z";

function evidence(reference, overrides = {}) {
  return {
    provider: "alchemy_rpc",
    source_type: "blockchain_state",
    reference,
    chain_id: 4663,
    block_number: 51_000_000,
    block_hash: BLOCK_HASH,
    transaction_hash: null,
    finality: "soft_confirmation",
    observed_at: "2026-09-01T21:59:30.000Z",
    retrieved_at: "2026-09-01T21:59:31.000Z",
    fresh_until: "2026-09-01T22:05:00.000Z",
    verified: true,
    ...overrides,
  };
}

function fact(dimension, key, value, reference = `urn:evidence:${key}`, overrides = {}) {
  return {
    dimension,
    key,
    value,
    evidence: [evidence(reference)],
    contradictions: [],
    ...overrides,
  };
}

function claim(dimension, key, value) {
  return {
    dimension,
    key,
    value,
    claimed_by: "token manifest",
    source_reference: "https://example.invalid/untrusted-manifest.json",
    observed_at: "2026-09-01T21:58:00.000Z",
  };
}

function projection(overrides = {}) {
  return buildRobinhoodAgentRadarProjection({
    chain_id: 4663,
    network: "mainnet",
    token_contract: TOKEN,
    generated_at: NOW,
    facts: [fact("identity", "token_contract", TOKEN)],
    claims: [],
    unknowns: [],
    warnings: [],
    ...overrides,
  });
}

test("Agent Radar keeps token evidence, agent claims, and unknown activity separate", () => {
  const result = projection({
    claims: [
      claim("identity", "agent_identity", "Autonomous alpha agent"),
      claim("agent_utility", "endpoint_availability", true),
      claim("agent_utility", "fees_revenue", { amount_usd: 1_000_000 }),
    ],
  });
  assert.equal(result.activity_assessment.state, "CLAIMED_ACTIVITY_NOT_VERIFIED");
  assert.equal(result.dimensions.agent_utility.facts.length, 0);
  assert.equal(result.dimensions.agent_utility.claims.length, 2);
  assert.equal(result.dimensions.agent_utility.claims[0].untrusted_external_text, true);
  assert.equal(result.dimensions.agent_utility.unknowns.find((row) => row.key === "endpoint_availability").reason, "Claim present without independent verification.");
  assert.equal(result.profitability_assessment, "unknown");
  assert.equal(result.safety_assessment, "not_provided");
  assert.equal(JSON.stringify(result).includes('"score"'), false);
  assert.equal(result.limitations.includes("Token volume is not agent revenue or profitability."), true);
});

test("current verified attributable activity produces an evidence-linked assessment, not a safety score", () => {
  const result = projection({
    facts: [
      fact("identity", "token_contract", TOKEN),
      fact("agent_utility", "endpoint_availability", true, "urn:evidence:endpoint", {
        evidence: [evidence("urn:evidence:endpoint", { source_type: "endpoint_probe", chain_id: null, block_number: null, block_hash: null, finality: "not_applicable" })],
      }),
      fact("agent_utility", "onchain_actions", { count: 14 }, "urn:evidence:actions"),
    ],
  });
  assert.equal(result.activity_assessment.state, "VERIFIED_ACTIVITY_OBSERVED");
  assert.deepEqual(result.activity_assessment.evidence_references, ["urn:evidence:actions"]);
  assert.equal(result.dimensions.agent_utility.state, "partial");
  assert.equal(result.execution_boundary.live_execution, false);
  assert.match(result.projection_hash, /^[a-f0-9]{64}$/);
});

test("stale or contradictory activity evidence does not become verified current activity", () => {
  const stale = projection({
    facts: [
      fact("identity", "token_contract", TOKEN),
      fact("agent_utility", "task_completions", 10, "urn:evidence:stale", {
        evidence: [evidence("urn:evidence:stale", { fresh_until: "2026-09-01T21:00:00.000Z" })],
      }),
    ],
  });
  assert.equal(stale.activity_assessment.state, "TOKEN_EVIDENCE_ONLY");
  assert.equal(stale.stale_fact_count, 1);

  const contradictory = projection({
    facts: [
      fact("identity", "token_contract", TOKEN),
      fact("agent_utility", "trading_actions", 3, "urn:evidence:contradictory", {
        contradictions: ["Independent provider returned no attributable actions for the same window."],
      }),
    ],
  });
  assert.equal(contradictory.activity_assessment.state, "TOKEN_EVIDENCE_ONLY");
  assert.equal(contradictory.contradictory_fact_count, 1);
});

test("verified contract capabilities become exact warnings and never a safe/unsafe label", () => {
  const result = projection({
    facts: [
      fact("identity", "token_contract", TOKEN),
      fact("contract_control", "proxy_upgradeability", true, "urn:evidence:proxy"),
      fact("contract_control", "mint_authority", { authority: `0x${"22".repeat(20)}` }, "urn:evidence:mint"),
      fact("contract_control", "sell_simulation", "failed", "urn:evidence:sell"),
    ],
  });
  assert.deepEqual(result.warnings.map((row) => row.code), [
    "MINT_AUTHORITY_OBSERVED",
    "SELL_SIMULATION_FAILED",
    "UPGRADEABILITY_OBSERVED",
  ]);
  assert.equal(result.safety_assessment, "not_provided");
  assert.equal(JSON.stringify(result).toLowerCase().includes('"safe"'), false);
});

test("market volume cannot manufacture verified agent revenue or profitability", () => {
  const result = projection({
    facts: [
      fact("identity", "token_contract", TOKEN),
      fact("liquidity_market_quality", "volume_quality", { observed_volume_usd: 750_000 }, "urn:evidence:volume"),
    ],
    claims: [claim("agent_utility", "fees_revenue", { amount_usd: 50_000 })],
  });
  assert.equal(result.activity_assessment.state, "CLAIMED_ACTIVITY_NOT_VERIFIED");
  assert.equal(result.profitability_assessment, "unknown");
  assert.equal(result.dimensions.agent_utility.facts.some((row) => row.key === "fees_revenue"), false);
});

test("projection hashing is stable across fact order and all missing fields remain explicit", () => {
  const rows = [
    fact("identity", "token_contract", TOKEN),
    fact("contract_control", "source_verification", true, "urn:evidence:source"),
  ];
  const left = projection({ facts: rows });
  const right = projection({ facts: [...rows].reverse() });
  assert.equal(left.projection_hash, right.projection_hash);
  const expectedFields = Object.values(AgentRadarFieldCatalog).reduce((sum, fields) => sum + fields.length, 0);
  const represented = Object.values(left.dimensions).reduce((sum, dimension) => sum + dimension.facts.length + dimension.unknowns.length, 0);
  assert.equal(represented, expectedFields);
});

test("unsupported chains, arbitrary fields, unverified facts, and cross-chain evidence fail closed", () => {
  assert.throws(() => buildRobinhoodAgentRadarProjection({
    chain_id: 1, network: "mainnet", token_contract: TOKEN, generated_at: NOW,
  }), /agent_radar_chain_unsupported/);
  assert.throws(() => projection({ facts: [fact("identity", "safe_score", 99)] }), /agent_radar_field_invalid/);
  assert.throws(() => projection({ facts: [fact("identity", "token_contract", TOKEN, "urn:evidence:unverified", {
    evidence: [evidence("urn:evidence:unverified", { verified: false })],
  })] }), /agent_radar_fact_unverified/);
  assert.throws(() => projection({ facts: [fact("identity", "token_contract", TOKEN, "urn:evidence:wrong-chain", {
    evidence: [evidence("urn:evidence:wrong-chain", { chain_id: 1 })],
  })] }), /agent_radar_evidence_chain_mismatch/);
  assert.throws(() => projection({ facts: [fact("identity", "token_contract", `0x${"33".repeat(20)}`)] }), /agent_radar_token_identity_mismatch/);
});
