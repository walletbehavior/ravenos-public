import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyAssetSecurityHeaders } from "../lib/customer_trade/terminal_runtime.mjs";
import {
  TradingViewAdapterVersion,
  resolveTradingViewChart,
  resolveTradingViewSymbol,
} from "../ravenos-tradingview-adapter.js";

test("TradingView visual context resolves only explicit exact Atlas identities", () => {
  const aapl = resolveTradingViewChart({ entity_id: "equity:us:AAPL", symbol: "AAPL", name: "Apple Inc." });
  assert.equal(aapl.schema_version, TradingViewAdapterVersion);
  assert.equal(aapl.tradingview_symbol, "NASDAQ:AAPL");
  assert.equal(aapl.visual_context_only, true);
  assert.deepEqual(aapl.price_axis, {
    side: "right",
    auto_scale: "visible_range",
    precision: "instrument_native",
  });
  assert.equal(resolveTradingViewChart({ entity_id: "equity:us:AAPL", symbol: "MSFT" }), null);
  assert.equal(resolveTradingViewChart({ entity_id: "equity:us:UNKNOWN", symbol: "UNKNOWN" }), null);
  assert.equal(resolveTradingViewSymbol("NASDAQ:AAPL").entity_id, "equity:us:AAPL");
  assert.equal(resolveTradingViewSymbol("NASDAQ:UNKNOWN"), null);
  assert.equal(resolveTradingViewSymbol("javascript:alert(1)"), null);
});

test("an arbitrary U.S. listing resolves only after one exact RavenOS instrument match", () => {
  const entity = { entity_id: "equity:us:MSFT", symbol: "MSFT", name: "Microsoft Corporation" };
  const exactInstrument = {
    schema_version: "ravenos.instrument.v1",
    instrument_id: "equity:nasdaq:msft",
    symbol: "MSFT",
    instrument_type: "equity",
    identity_scope: "exact_instrument",
    venue: "nasdaq",
  };
  assert.equal(resolveTradingViewChart(entity), null);
  assert.equal(resolveTradingViewChart(entity, { exactInstrument }).tradingview_symbol, "NASDAQ:MSFT");
  assert.equal(resolveTradingViewChart(entity, { exactInstrument: { ...exactInstrument, venue: "unknown" } }), null);
  assert.equal(resolveTradingViewChart(entity, { exactInstrument: { ...exactInstrument, symbol: "AAPL" } }), null);
  assert.equal(resolveTradingViewChart(entity, { exactInstrument: { ...exactInstrument, instrument_id: "equity:nasdaq:aapl" } }), null);
  assert.equal(resolveTradingViewChart(
    { entity_id: "equity:us:AAPL", symbol: "AAPL", name: "Apple Inc." },
    { exactInstrument: { ...exactInstrument, symbol: "AAPL", instrument_id: "equity:nyse:aapl", venue: "nasdaq" } },
  ), null);
});

test("TradingView code is isolated from the RavenOS application origin", () => {
  const adapter = readFileSync("ravenos-tradingview-adapter.js", "utf8");
  assert.match(adapter, /https:\/\/www\.tradingview-widget\.com\/embed-widget\/advanced-chart\//);
  assert.match(adapter, /sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(adapter, /innerHTML|document\.write|localStorage|sessionStorage|cookie/i);

  const atlas = applyAssetSecurityHeaders(new Response("atlas"), "/atlas/");
  const atlasCsp = atlas.headers.get("content-security-policy") || "";
  assert.match(atlasCsp, /script-src 'self'/);
  assert.match(atlasCsp, /frame-src https:\/\/www\.tradingview-widget\.com https:\/\/s\.tradingview\.com/);
  assert(!atlasCsp.includes("s3.tradingview.com"));
  const terminal = applyAssetSecurityHeaders(new Response("terminal"), "/terminal/");
  const terminalCsp = terminal.headers.get("content-security-policy") || "";
  assert.match(terminalCsp, /script-src 'self'/);
  assert.match(terminalCsp, /frame-src https:\/\/www\.tradingview-widget\.com https:\/\/s\.tradingview\.com/);
  assert(!terminalCsp.includes("s3.tradingview.com"));
  assert.equal(atlas.headers.get("x-frame-options"), "DENY");
  assert.equal(terminal.headers.get("x-frame-options"), "DENY");
});
