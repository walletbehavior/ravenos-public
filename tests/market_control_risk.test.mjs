import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKET_CONTROL_RISK_SCHEMA,
  MarketControlRiskContract,
  buildMarketControlRiskProjection,
} from "../lib/market_control_risk.mjs";

const IDENTITY = Object.freeze({
  chain: "solana",
  pool_address: "E29yccZjfL3J3ukV4N6dsLnyJ5HrA5tj69Fo6ofRoyu2",
  token_address: "2BN1fCP2kEzVaYDcDfkHKzj313pALetn8TNzqyQFQ83F",
  quote_token_address: "So11111111111111111111111111111111111111112",
});

function holders({ top10 = 13.14, largest = 1.72, mint = "disabled", freeze = "disabled" } = {}) {
  return {
    ok: true,
    safe_public: true,
    schema_version: "ravenos.onchain_holder_list.v2",
    state: "available",
    identity: IDENTITY,
    observed_at: "2026-08-28T08:53:45.895Z",
    summary: { top_10_supply_pct: 92, top_10_wallet_supply_pct: top10 },
    token_controls: { source: "solana_mint_account", state: "available", mint_authority: mint, freeze_authority: freeze },
    holders: [
      { supply_share_pct: 76.85, excluded_from_wallet_concentration: true },
      { supply_share_pct: largest, excluded_from_wallet_concentration: false },
    ],
  };
}

function profile({ verified = false, honeypot = "unknown", providerDeveloperPct = 100 } = {}) {
  return {
    schema_version: "ravenos.onchain_market_profile.v1",
    identity: { state: "exact", ...IDENTITY },
    fetched_at: "2026-08-28T08:53:40.000Z",
    token: { gt_verified: verified },
    token_controls: {
      honeypot,
      developer_address: "9NzkUptLDcPev9AkbX8ToruqAwpD3KXHWbzcHr4NYJLM",
      developer_holding_pct: providerDeveloperPct,
    },
  };
}

function developerHolding(percentage = 0) {
  return {
    schema_version: "ravenos.solana_owner_holding.v1",
    state: "available",
    identity: IDENTITY,
    observed_at: "2026-08-28T08:53:44.000Z",
    supply_share_pct: percentage,
  };
}

test("pool-inclusive and unverified provider percentages never become false rug flags", () => {
  const projection = buildMarketControlRiskProjection({
    identity: IDENTITY,
    holder_projection: holders(),
    market_profile: profile(),
    developer_holding: developerHolding(0),
    market_snapshot: {
      pairAgeMs: 75 * 60_000,
      volume24h: 4_400_000,
      marketCap: 125_400,
      liquidityUsd: 194_700,
    },
    observed_at: "2026-08-28T08:54:00.000Z",
  });
  assert.equal(projection.schema_version, MARKET_CONTROL_RISK_SCHEMA);
  assert.equal(projection.level, "high");
  assert.equal(projection.title, "High market-integrity risk");
  assert.match(projection.summary, /24h volume is 35\.1×/);
  assert.match(projection.summary, /top-10 wallet concentration is 13\.1% after excluding the exact pool/i);
  assert.equal(projection.risk_factors.some((row) => row.id.includes("concentration")), false);
  assert.equal(projection.risk_factors.some((row) => row.id.includes("developer_holding")), false);
  assert.equal(projection.risk_factors.some((row) => row.id === "extreme_turnover"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "very_new_pool"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "metadata_unverified"), true);
  assert.equal(projection.mitigating_checks.some((row) => row.id === "developer_holding_bounded"), true);
  assert.equal(projection.interpretation.scam_or_rug_determination, false);
  assert.equal(projection.interpretation.safe_controls_mean_safe_token, false);
  assert.equal(JSON.stringify(projection).includes("developer_holding_pct"), false);
  assert.equal(MarketControlRiskContract.numeric_rug_probability_published, false);
});

test("active mint controls and independently measured developer exposure produce severe control risk", () => {
  const projection = buildMarketControlRiskProjection({
    identity: IDENTITY,
    holder_projection: holders({ top10: 62, largest: 24, mint: "enabled", freeze: "enabled" }),
    market_profile: profile({ verified: true, honeypot: "flagged", providerDeveloperPct: 0 }),
    developer_holding: developerHolding(31),
    market_snapshot: { pairAgeMs: 4 * 86_400_000, volume24h: 90_000, marketCap: 500_000 },
  });
  assert.equal(projection.level, "severe");
  assert.equal(projection.title, "Severe control risk");
  assert.equal(projection.risk_factors.some((row) => row.id === "mint_authority_active"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "freeze_authority_active"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "honeypot_flag"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "developer_holding_critical"), true);
  assert.equal(projection.risk_factors.some((row) => row.id === "top_10_wallet_concentration_high"), true);
});

test("missing control dimensions remain explicit and exact identities fail closed", () => {
  const forming = buildMarketControlRiskProjection({ identity: IDENTITY });
  assert.equal(forming.state, "forming");
  assert.equal(forming.level, "forming");
  assert.ok(forming.unmeasured.includes("Bundled-launch concentration"));
  assert.throws(() => buildMarketControlRiskProjection({
    identity: IDENTITY,
    holder_projection: { ...holders(), identity: { ...IDENTITY, pool_address: "different-pool" } },
  }), /holder_identity_mismatch/);
});
