import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const terminal = fs.readFileSync("terminal/index.html", "utf8");
const timeframesSource = fs.readFileSync("raven-chart-timeframes.js", "utf8");
const overlaysSource = fs.readFileSync("raven-chart-overlays.js", "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(timeframesSource, context);
vm.runInContext(overlaysSource, context);

const pattern = [
  { open: 162.1, high: 166.4, low: 159.8, close: 165.2, volume: 1420000 },
  { open: 165.2, high: 168.3, low: 163.6, close: 164.1, volume: 1180000 },
  { open: 164.1, high: 171.2, low: 162.4, close: 170.6, volume: 1910000 },
  { open: 170.6, high: 174.9, low: 168.8, close: 173.4, volume: 2260000 },
  { open: 173.4, high: 174.1, low: 167.6, close: 169.2, volume: 1680000 },
  { open: 169.2, high: 176.7, low: 168.9, close: 176.2, volume: 2440000 },
  { open: 176.2, high: 183.1, low: 175.5, close: 181.8, volume: 2840000 },
  { open: 181.8, high: 184.6, low: 178.2, close: 180.4, volume: 2380000 },
  { open: 180.4, high: 189.5, low: 179.8, close: 188.6, volume: 3160000 },
  { open: 188.6, high: 191.3, low: 183.4, close: 185.8, volume: 2910000 },
  { open: 185.8, high: 194.2, low: 184.7, close: 192.9, volume: 3370000 },
  { open: 192.9, high: 198.7, low: 190.6, close: 196.4, volume: 3520000 },
];

const { makeTimeframeCandles, chartKey, candleWindow } = context.window.RavenChartTimeframes;
const { getOverlays } = context.window.RavenChartOverlays;

const candles15m = makeTimeframeCandles(pattern, "15m", 64280);
const candles1h = makeTimeframeCandles(pattern, "1h", 64280);
const candles4h = makeTimeframeCandles(pattern, "4h", 64280);

const window15m = candleWindow(candles15m);
const window1h = candleWindow(candles1h);
const window4h = candleWindow(candles4h);

assert.notEqual(window15m.count, window1h.count);
assert.notEqual(window1h.count, window4h.count);
assert.notEqual(window15m.first, window1h.first);
assert.notEqual(window1h.first, window4h.first);
assert.equal(window15m.last, window1h.last);
assert.equal(window1h.last, window4h.last);

const key15m = chartKey({ instrument: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "15m", coverage: "Sample" });
const key1h = chartKey({ instrument: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "1h", coverage: "Sample" });
const key4h = chartKey({ instrument: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "4h", coverage: "Sample" });
assert.notEqual(key15m, key1h);
assert.notEqual(key1h, key4h);

const overlays15m = getOverlays({ symbol: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "15m", coverage: "Sample", candles: candles15m, tier: "free" });
const overlays1h = getOverlays({ symbol: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "1h", coverage: "Sample", candles: candles1h, tier: "free" });
const overlays4h = getOverlays({ symbol: "BTC-PERP", market: "perp", mode: "perps_intelligence", timeframe: "4h", coverage: "Sample", candles: candles4h, tier: "free" });

const signature = (items) => items.map((overlay) => overlay.type).join("|");
assert.notEqual(overlays15m.length, overlays1h.length);
assert.notEqual(overlays1h.length, overlays4h.length);
assert.notEqual(signature(overlays15m), signature(overlays1h));
assert.notEqual(signature(overlays1h), signature(overlays4h));
assert.ok(overlays15m.every((overlay) => overlay.id.includes("15m") || overlay.metadata?.timeframe === "15m"));
assert.ok(overlays1h.every((overlay) => overlay.id.includes("1h") || overlay.metadata?.timeframe === "1h"));
assert.ok(overlays4h.every((overlay) => overlay.id.includes("4h") || overlay.metadata?.timeframe === "4h"));

assert.match(terminal, /selectedChartState/);
assert.match(terminal, /RavenChartTimeframes\?\.makeTimeframeCandles/);
assert.match(terminal, /RavenChartTimeframes\?\.chartKey/);
assert.match(terminal, /timeframe: state\.timeframe/);
assert.match(terminal, /chartHost\.dataset\.chartKey = state\.key/);
assert.match(terminal, /id="chartDebug"/);
