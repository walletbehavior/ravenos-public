import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../ravenos-price-workspace.js", import.meta.url), "utf8");
const priceChart = readFileSync(new URL("../raven-price-chart.js", import.meta.url), "utf8");
const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const landingRuntime = readFileSync(new URL("../ravenos-landing.js", import.meta.url), "utf8");
const atlas = readFileSync(new URL("../ravenos-atlas.js", import.meta.url), "utf8");
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
  assert.match(workspace, /Current candles are not available for this market/);
  assert.match(workspace, /data-rpw-focus/);
  assert.match(workspace, /Limited history/);
  assert.match(workspace, /payload\.instrument\?\.identity_scope/);
  assert.match(workspace, /exactRavenAnnotations\(payload\.raven_annotations, instrument\)/);
  assert.match(workspace, /value\.instrument_id !== instrument\.canonical_id/);
  assert.match(workspace, /events: \[\], overlays: \[\], visibleOverlayTypes: \[\]/);
  assert.match(workspace, /new CustomEvent\("ravenos:priceworkspace", \{ detail: \{ \.\.\.this\.state \} \}\)/);
  assert.match(workspace, /acceptProviderTransition/);
  assert.match(workspace, /chart_provider_transition_pool_mismatch/);
  assert.match(workspace, /validateExpectedInstrument/);
  assert.match(workspace, /\["base", "bsc", "ethereum"/);
  assert.match(workspace, /different exact market than the one selected/);
  assert.match(workspace, /onMarkerSelect/);
  assert.match(workspace, /visibilitychange/);
  assert.match(workspace, /paused_hidden/);
  assert.match(workspace, /this\.startLive\(this\.lastLiveRequest, this\.lastLivePayload\)/);
  assert.match(workspace, /initialVisibleBars/);
  assert.match(workspace, /historyBatchLimit/);
  assert.match(workspace, /data-rpw-timeframe-select/);
  assert.match(workspace, /data-rpw-read-detail/);
  assert.doesNotMatch(workspace, /data-rpw-range=/);
  assert.match(workspace, /ravenos\.chart_read\.v1/);
  assert.match(workspace, /provider_candles_only/);
  assert.match(workspace, /onChartReadChange/);
  assert.match(workspace, /ravenos:chartread/);
  assert.match(workspace, /longScore >= 4/);
  assert.match(workspace, /shortScore >= 4/);
});

test("Terminal uses PriceWorkspace by default and exposes no unresolved build token", () => {
  assert.match(terminal, /ravenos-price-workspace\.js/);
  assert.match(terminal, /ravenos-terminal-live\.js/);
  assert.match(terminalRuntime, /RavenOSPriceWorkspace\?\.create/);
  assert.doesNotMatch(`${terminal}\n${terminalRuntime}`, /Local structure fallback|feature_flag_off|RAVENOS_LIGHTWEIGHT_CHART_SPIKE|samplePrices|perpsInputVector|replayMatches|pressureComposition/);
  assert.doesNotMatch(terminal, /v=__RAVENOS_BUILD_ID__/);
  assert.match(terminal, /data-ravenos-build-id[^>]*>pending/);
  assert.match(terminalRuntime, /No fallback market state was generated/);
  assert.match(terminalRuntime, /renderSourceDetails/);
  assert.match(terminalRuntime, /renderMarketAnatomy/);
  assert.match(terminalRuntime, /renderMarkerDetail/);
  assert.match(terminalRuntime, /setPlanOverlayActive/);
  assert.match(terminalRuntime, /qualifiedPlanData/);
  assert.match(terminalRuntime, /captureChartViewport/);
  assert.match(terminalRuntime, /showFullMarkerEvidence/);
  assert.match(terminalRuntime, /focusTerminalRaven/);
  assert.match(terminal, /id="terminalChartPlanStrip"/);
  assert.match(terminal, /id="terminalChartMarkerInspector"/);
  assert.match(terminal, /id="terminalRavenActionStatus"/);
  assert.doesNotMatch(terminalRuntime.match(/const SAVED_RAVEN_OVERLAYS[^;]+;/)?.[0] || "", /plan-entry|plan-target|plan-risk/);
  assert.match(terminal, /id="terminalAlphaSection"/);
  assert.match(terminal, /id="terminalAlphaStack"/);
  assert.match(terminalRuntime, /ravenos\.alpha_layers\.v1/);
  assert.match(terminalRuntime, /privacy\?\.addresses_removed === true/);
  assert.match(terminalRuntime, /independence_adjusted === true/);
  assert.match(terminalRuntime, /cleanAlphaCard/);
  assert.match(terminalRuntime, /unknown\|unavailable\|insufficient\|missing\|not projected\|checking\|resolving/i);
  assert.match(terminalRuntime, /Load a public address to add account-specific exposure to the desk/);
  assert.match(terminalRuntime, /publicAccountObservationAvailable|publicAccountViewAvailable/);
  assert.doesNotMatch(terminal, /Synthetic fallback/);
  assert.match(terminal, /Lightweight Charts™ by TradingView/);
  assert.doesNotMatch(terminal, /ravenos-terminal-trade|ravenos-access/);
});

test("all native RavenOS chart surfaces use the shared price or series renderer", () => {
  assert.match(landing, /ravenos-price-workspace\.css/);
  assert.match(landing, /raven-price-chart\.js/);
  assert.doesNotMatch(landing, /<canvas[^>]+id="landingChart"/);
  assert.match(landingRuntime, /createPriceWorkspace/);
  assert.match(landingRuntime, /expectedCanonicalId/);
  assert.doesNotMatch(landingRuntime, /getContext\("2d"\)|fillRect|drawChart/);
  assert.match(priceChart, /function RavenPriceChart/);
  assert.match(priceChart, /function RavenSeriesChart/);
  assert.match(priceChart, /TrackingModeExitMode/);
  assert.match(priceChart, /defaultVisiblePriceScaleId: "right"/);
  assert.match(priceChart, /rightPriceScale:\s*\{[\s\S]*?visible: true,[\s\S]*?autoScale: true/);
  assert.match(priceChart, /priceScaleId: "right"/);
  assert.match(priceChart, /minMove: scaleContract\.min_move/);
  assert.match(priceChart, /auto_scale: "visible_range"/);
  for (const indicator of ["bb20", "rsi14", "macd"]) {
    assert.match(priceChart, new RegExp(`\\b${indicator}\\b`));
  }
  assert.match(priceChart, /paneIndex/);
  assert.match(priceChart, /setVisibleTimeRange/);
  assert.match(priceChart, /setVisibleBars/);
  assert.match(workspace, /instrument: this\.state\.instrument/);
  assert.match(atlas, /window\.RavenSeriesChart/);
  assert.doesNotMatch(atlas, /LightweightCharts\.createChart/);
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
  assert.match(worker, /token_orientation: "selected_token_usd"/);
  assert.match(worker, /coingecko_token_identity_mismatch/);
  assert.match(worker, /coingecko_quote_identity_mismatch/);
});
