import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../ravenos-price-workspace.js", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../terminal/index.html", import.meta.url), "utf8");
const terminalRuntime = readFileSync(new URL("../ravenos-terminal-live.js", import.meta.url), "utf8");
const overlays = readFileSync(new URL("../raven-chart-overlays.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");

test("PriceWorkspace declares provenance states and never generates fallback candles", () => {
  assert.match(workspace, /ravenos\.price_workspace\.v1/);
  for (const state of ["live", "delayed", "demo", "historical", "simulated", "paper", "data_unavailable"]) {
    assert.match(workspace, new RegExp(`\\b${state}\\b`));
  }
  assert.doesNotMatch(workspace, /Math\.sin|Math\.cos|local_fallback|structure_proxy/);
  assert.match(workspace, /Provider-backed candles are unavailable|No provider-backed candles/);
  assert.match(workspace, /data-rpw-focus/);
  assert.match(workspace, /Limited history/);
  assert.match(workspace, /payload\.instrument\?\.identity_scope/);
  assert.match(workspace, /new CustomEvent\("ravenos:priceworkspace", \{ detail: \{ \.\.\.this\.state \} \}\)/);
});

test("Terminal uses PriceWorkspace by default and exposes no unresolved build token", () => {
  assert.match(terminal, /ravenos-price-workspace\.js/);
  assert.match(terminal, /ravenos-terminal-live\.js/);
  assert.match(terminalRuntime, /RavenOSPriceWorkspace\?\.create/);
  assert.doesNotMatch(`${terminal}\n${terminalRuntime}`, /Local structure fallback|feature_flag_off|RAVENOS_LIGHTWEIGHT_CHART_SPIKE|samplePrices|perpsInputVector|replayMatches|pressureComposition/);
  assert.doesNotMatch(terminal, /v=__RAVENOS_BUILD_ID__/);
  assert.match(terminal, /data-ravenos-build-id[^>]*>pending/);
  assert.match(terminalRuntime, /No fallback market state was generated/);
  assert.doesNotMatch(terminal, /Synthetic fallback/);
  assert.doesNotMatch(terminal, /ravenos-terminal-trade|ravenos-access/);
});

test("chart annotations require exact identity, timestamp, and lineage", () => {
  assert.match(overlays, /identityMatches/);
  assert.match(overlays, /lineagePresent/);
  assert.match(overlays, /exact_event_time/);
  assert.doesNotMatch(overlays, /seedFor|chart_heuristic|Math\.sin|Math\.cos/);
});

test("Worker supports exact-pool OHLCV with explicit provider lineage", () => {
  assert.match(worker, /fetchGeckoPoolCandles/);
  assert.match(worker, /Exact-pool OHLCV/);
  assert.match(worker, /pair_address/);
  assert.match(worker, /token_address/);
  assert.match(worker, /price_currency: "usd"/);
  assert.match(worker, /token_orientation: "base"/);
});
