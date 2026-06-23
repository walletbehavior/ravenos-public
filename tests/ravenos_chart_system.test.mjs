import assert from "node:assert/strict";
import fs from "node:fs";

const chart = fs.readFileSync("raven-price-chart.js", "utf8");
const overlays = fs.readFileSync("raven-chart-overlays.js", "utf8");
const terminal = fs.readFileSync("terminal/index.html", "utf8");

assert.match(chart, /CONTEXT_DEFAULT_TYPES/);
assert.match(chart, /perps: \["pressure-zone", "liquidity-zone", "history-window"\]/);
assert.match(chart, /degen: \["participant-shift", "history-window", "breadth-line"\]/);
assert.match(chart, /atlas: \["regime-marker", "breadth-line", "liquidity-zone"\]/);
assert.match(chart, /defaultActiveTypes/);
assert.match(chart, /RavenChartOverlayVisuals/);

assert.match(chart, /EVENT_GLYPHS/);
assert.doesNotMatch(chart, /text: compact \? "" : event\.label/);
assert.doesNotMatch(chart, /text: compact \? "" : overlay\.label/);
assert.match(chart, /axisLabelVisible: Boolean\(options\?\.showPriceLineLabels\)/);
assert.match(chart, /axisLabelVisible: false/);

assert.match(overlays, /visualLabel: "Pressure"/);
assert.match(overlays, /visualLabel: "Liquidity Attraction"/);
assert.match(overlays, /visualLabel: "Replay"/);
assert.match(overlays, /visualLabel: "Participation Expansion"/);
assert.match(overlays, /visualLabel: "Attention Velocity"/);
assert.match(overlays, /visualLabel: "Fresh Survival"/);

assert.match(terminal, /overlayContext: isPerpsMode\(\) \? "perps"/);
assert.match(terminal, /id="contextCoverage"/);
assert.doesNotMatch(terminal, /id="providerSource"/);
assert.doesNotMatch(terminal, /id="staleTimestamp"/);
