import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOnchainMarketState,
  onchainCandleFreshnessWindow,
} from "../lib/onchain_market_state.mjs";

test("short spot intervals retain a bounded candle freshness window", () => {
  assert.equal(onchainCandleFreshnessWindow(60), 600);
  assert.equal(onchainCandleFreshnessWindow(900), 1_800);
  assert.equal(onchainCandleFreshnessWindow(3_600), 7_200);
});

test("current provider delivery is not conflated with the newest candle timestamp", () => {
  const result = classifyOnchainMarketState({
    providerRequestSucceeded: true,
    lastCandleAgeSeconds: 1_320,
    intervalSeconds: 60,
    lastCandleClose: 0.012345,
    snapshotPrice: 0.012345,
    transactions24h: 384,
  });
  assert.equal(result.provider_delivery_state, "current");
  assert.equal(result.market_snapshot_state, "current");
  assert.equal(result.candle_recency_state, "delayed");
  assert.equal(result.market_activity_state, "no_recent_trades");
  assert.equal(result.chart_state, "current_no_recent_trades");
  assert.equal(result.operator_label, "No recent txns");
});

test("a changed exact-market snapshot exposes chart lag instead of claiming quiet trading", () => {
  const result = classifyOnchainMarketState({
    providerRequestSucceeded: true,
    lastCandleAgeSeconds: 1_320,
    intervalSeconds: 60,
    lastCandleClose: 1,
    snapshotPrice: 1.02,
    transactions24h: 384,
  });
  assert.equal(result.provider_delivery_state, "current");
  assert.equal(result.candle_recency_state, "delayed");
  assert.equal(result.market_activity_state, "activity_reported_chart_lagging");
  assert.equal(result.chart_state, "delayed");
  assert.equal(result.operator_label, "Chart delayed");
});

test("a pool with no reported transactions is labeled inactive rather than globally delayed", () => {
  const result = classifyOnchainMarketState({
    providerRequestSucceeded: true,
    lastCandleAgeSeconds: 86_400,
    intervalSeconds: 900,
    lastCandleClose: 2,
    snapshotPrice: 2,
    transactions24h: 0,
  });
  assert.equal(result.market_activity_state, "no_recent_trades");
  assert.equal(result.chart_state, "current_no_recent_trades");
  assert.equal(result.operator_label, "No recent txns");
});
