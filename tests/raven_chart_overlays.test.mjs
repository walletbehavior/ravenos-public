import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../raven-chart-overlays.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context, { filename: "raven-chart-overlays.js" });
const { deriveTechnicalAnalysis } = context.window.RavenChartOverlays;

const START = Date.UTC(2026, 7, 1, 0, 0, 0) / 1_000;
const STEP = 15 * 60;

function closedAt(rows) {
  return new Date((rows.at(-1).time + STEP + 1) * 1_000).toISOString();
}

function oscillatingCandles(count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.04 + Math.sin(index / 4) * 7;
    const open = close - Math.cos(index / 3) * 0.8;
    return {
      time: START + index * STEP,
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      quote_volume: 1_000 + (index % 9) * 40,
    };
  });
}

function accumulationCandles() {
  return Array.from({ length: 80 }, (_, index) => {
    if (index < 56) {
      const close = 100 + Math.sin(index / 2) * 9;
      return {
        time: START + index * STEP,
        open: close - Math.cos(index) * 1.5,
        high: close + 3,
        low: close - 3,
        close,
        quote_volume: 800 + (index % 7) * 60,
      };
    }
    const close = 102 + (index % 4) * 0.04;
    return {
      time: START + index * STEP,
      open: close - 0.18,
      high: 103.2,
      low: 99.2,
      close,
      quote_volume: 1_400 + (index % 5) * 50,
    };
  });
}

function derive(candles, overrides = {}) {
  return deriveTechnicalAnalysis({
    candles,
    timeframe: "15m",
    instrumentId: "solana:pool:exact-a",
    source: "Exact-pool OHLCV",
    sourceState: "provider_backed",
    observedAt: closedAt(candles),
    ...overrides,
  });
}

test("closed exact-market candles produce bounded MACD and Fibonacci marks", () => {
  const result = derive(oscillatingCandles());
  assert.equal(result.schema_version, "ravenos.technical_overlay.v1");
  assert.equal(result.state, "available");
  assert.equal(result.evidence_scope, "closed_exact_market_candles");
  assert(result.overlays.some((row) => row.type === "technical-macd-crossover"));
  assert.equal(result.overlays.filter((row) => row.type === "technical-macd-crossover").length <= 3, true);
  assert.equal(result.overlays.filter((row) => row.type === "technical-fibonacci-level").length, 3);
  for (const row of result.overlays) {
    assert.equal(row.instrument_id, "solana:pool:exact-a");
    assert.equal(row.research_only, true);
    assert.equal(row.actionable, false);
    assert.equal(row.execution_authority, false);
    assert.equal(row.metadata.evidence_scope, "closed_exact_market_candles");
  }
});

test("accumulation-shaped ranges require volume and never claim wallet intent", () => {
  const candles = accumulationCandles();
  const result = derive(candles);
  const zone = result.overlays.find((row) => row.type === "technical-accumulation-zone");
  assert(zone, "expected a qualified accumulation-shaped range");
  assert.equal(zone.metadata.wallet_accumulation_claimed, false);
  assert.equal(result.public_safety.wallet_accumulation_claimed, false);
  assert.match(zone.summary, /not proof of wallet accumulation/i);

  const withoutVolume = candles.map(({ quote_volume, ...row }) => row);
  const unavailable = derive(withoutVolume);
  assert.equal(unavailable.overlays.some((row) => row.type === "technical-accumulation-zone"), false);
});

test("the forming candle is excluded and unavailable sources fail closed", () => {
  const candles = oscillatingCandles();
  const forming = {
    time: candles.at(-1).time + STEP,
    open: 2,
    high: 500,
    low: 1,
    close: 450,
    quote_volume: 9_999_999,
  };
  const result = derive([...candles, forming], {
    observedAt: new Date((forming.time + 30) * 1_000).toISOString(),
  });
  assert.equal(result.closed_candle_count, candles.length);
  assert.equal(result.overlays.some((row) => Number(row.time) === forming.time), false);

  const unavailable = derive(candles, { sourceState: "unavailable" });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.overlays.length, 0);
});

test("a monthly candle stays forming until the next calendar month", () => {
  const candles = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 3 + index, 1));
    const close = 80 + index;
    return {
      time: date.getTime() / 1_000,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      quote_volume: 1_000 + index * 10,
    };
  });
  const forming = derive(candles, {
    timeframe: "1M",
    observedAt: "2026-09-30T23:59:59Z",
  });
  assert.equal(forming.closed_candle_count, 29);

  const closed = derive(candles, {
    timeframe: "1M",
    observedAt: "2026-10-01T00:00:01Z",
  });
  assert.equal(closed.closed_candle_count, 30);
});

test("technical mark identity is exact-instrument scoped", () => {
  const candles = oscillatingCandles();
  const first = derive(candles, { instrumentId: "base:pool:0xaaa" });
  const second = derive(candles, { instrumentId: "base:pool:0xbbb" });
  assert.notEqual(first.overlays[0].id, second.overlays[0].id);
  assert.equal(first.overlays.every((row) => row.instrument_id === "base:pool:0xaaa"), true);
  assert.equal(second.overlays.every((row) => row.instrument_id === "base:pool:0xbbb"), true);
});
