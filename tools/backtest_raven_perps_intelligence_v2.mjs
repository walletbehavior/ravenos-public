#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clamp,
  normalizeHyperliquidPerps,
  pressureStateFromScore,
} from "../lib/ravenos_perps_intelligence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.resolve(APP_ROOT, process.env.RAVEN_PERPS_V2_BACKTEST_PATH || "data/runtime/raven_perps_intelligence_v2_backtest.json");
const INFO_URL = process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  return Number((value * 100).toFixed(4));
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function quantile(values, q) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  return clean[Math.round((clean.length - 1) * clamp(q, 0, 1))];
}

function sma(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxDrawdown(returns) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const ret of returns) {
    equity += ret;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return maxDd;
}

async function postInfo(body) {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid ${body.type} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function normalizeCandle(row) {
  const open = num(row.o);
  const high = num(row.h);
  const low = num(row.l);
  const close = num(row.c);
  const volume = num(row.v);
  return {
    time: num(row.t),
    closeTime: num(row.T),
    open,
    high,
    low,
    close,
    volume,
    trades: num(row.n),
  };
}

async function fetchCandles(coin, interval, startTime, endTime) {
  const raw = await postInfo({
    type: "candleSnapshot",
    req: { coin, interval, startTime, endTime },
  });
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCandle).filter((row) => row.time && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

function candleFeatures(candles, index) {
  const current = candles[index];
  const prev = candles[index - 1];
  const window6 = candles.slice(Math.max(0, index - 6), index);
  const window12 = candles.slice(Math.max(0, index - 12), index);
  const window24 = candles.slice(Math.max(0, index - 24), index);
  const closes6 = window6.map((row) => row.close);
  const closes12 = window12.map((row) => row.close);
  const closes24 = window24.map((row) => row.close);
  const volumes24 = window24.map((row) => row.volume);
  const highs12 = window12.map((row) => row.high);
  const lows12 = window12.map((row) => row.low);
  const highs24 = window24.map((row) => row.high);
  const lows24 = window24.map((row) => row.low);
  const priorHigh12 = Math.max(...highs12, 0);
  const priorLow12 = Math.min(...lows12.filter((value) => value > 0));
  const high24 = Math.max(...highs24, 0);
  const low24 = Math.min(...lows24.filter((value) => value > 0));
  const momentum3 = index >= 3 ? (current.close / candles[index - 3].close) - 1 : 0;
  const momentum6 = index >= 6 ? (current.close / candles[index - 6].close) - 1 : 0;
  const trend24 = index >= 24 ? (current.close / candles[index - 24].close) - 1 : 0;
  const currentRet = prev ? (current.close / prev.close) - 1 : 0;
  const absReturns6 = [];
  const absReturns24 = [];
  for (let i = Math.max(1, index - 24); i <= index; i += 1) {
    const ret = Math.abs((candles[i].close / candles[i - 1].close) - 1);
    absReturns24.push(ret);
    if (i > index - 6) absReturns6.push(ret);
  }
  const avgAbs6 = sma(absReturns6);
  const avgAbs24 = sma(absReturns24);
  const range6 = closes6.length ? (Math.max(...closes6) - Math.min(...closes6)) / current.close : 0;
  const range24 = closes24.length ? (Math.max(...closes24) - Math.min(...closes24)) / current.close : 0;
  const compressionRatio = range24 > 0 ? range6 / range24 : 1;
  const volumeMedian = median(volumes24);
  const volumeRatio = volumeMedian > 0 ? current.volume / volumeMedian : 1;
  const position24 = high24 > low24 ? (current.close - low24) / (high24 - low24) : 0.5;
  const upperWick = current.high > current.low ? (current.high - Math.max(current.open, current.close)) / (current.high - current.low) : 0;
  const lowerWick = current.high > current.low ? (Math.min(current.open, current.close) - current.low) / (current.high - current.low) : 0;
  const pressureScore = Math.round(clamp(
    Math.abs(momentum6) * 1200
      + Math.abs(currentRet) * 1800
      + Math.min(volumeRatio, 3) * 14
      + Math.max(0, 1 - compressionRatio) * 22
      + Math.abs(position24 - 0.5) * 28,
    0,
    100,
  ));
  return {
    avgAbs6,
    avgAbs24,
    compressionRatio,
    currentRet,
    high24,
    low24,
    lowerWick,
    momentum3,
    momentum6,
    position24,
    pressureScore,
    pressureState: pressureStateFromScore(pressureScore),
    priorHigh12,
    priorLow12: Number.isFinite(priorLow12) ? priorLow12 : 0,
    sma6: sma(closes6),
    sma12: sma(closes12),
    sma24: sma(closes24),
    trend24,
    upperWick,
    volumeRatio,
  };
}

function setupCandidates(candles, index, liveRow) {
  const candle = candles[index];
  const f = candleFeatures(candles, index);
  const liveSmart = (liveRow.pressureComposition || []).find((item) => item.name === "Smart Money") || {};
  const liveRetail = (liveRow.pressureComposition || []).find((item) => item.name === "Retail") || {};
  const smartBias = num(liveSmart.contribution) >= 28 && liveSmart.direction !== "contracting";
  const retailCrowding = num(liveRetail.contribution) >= 38 && liveRetail.direction === "expanding";
  const livePressure = num(liveRow.pressureScore);
  const setups = [];

  if (
    f.trend24 > 0.002
    && f.momentum3 > 0.0015
    && candle.close > f.priorHigh12
    && f.volumeRatio >= 1.05
    && f.pressureScore <= 88
  ) {
    setups.push({
      family: "constructive_expansion",
      direction: "long",
      confidence: clamp(48 + f.pressureScore * 0.25 + Math.min(f.volumeRatio, 2.5) * 9 + (smartBias ? 8 : 0), 0, 100),
      evidence: ["prior range expansion", "volume expansion", smartBias ? "smart-money pressure contribution supportive" : "participant pressure mixed"],
    });
  }

  if (
    f.trend24 < -0.002
    && f.momentum3 < -0.0015
    && candle.close < f.priorLow12
    && f.volumeRatio >= 1.05
    && f.pressureScore <= 88
  ) {
    setups.push({
      family: "downside_continuation",
      direction: "short",
      confidence: clamp(48 + f.pressureScore * 0.25 + Math.min(f.volumeRatio, 2.5) * 9, 0, 100),
      evidence: ["prior range breakdown", "volume expansion", "pressure continuing"],
    });
  }

  if (
    f.position24 >= 0.78
    && f.upperWick >= 0.35
    && f.momentum3 < 0
    && (retailCrowding || livePressure >= 74 || f.pressureScore >= 70)
  ) {
    setups.push({
      family: "crowded_upside_exhaustion",
      direction: "short",
      confidence: clamp(50 + f.pressureScore * 0.28 + f.upperWick * 20 + (retailCrowding ? 8 : 0), 0, 100),
      evidence: ["upper-range rejection", "crowding sensitivity", retailCrowding ? "retail pressure contribution elevated" : "pressure elevated"],
    });
  }

  if (
    f.position24 <= 0.22
    && f.lowerWick >= 0.35
    && f.momentum3 > 0
    && (smartBias || livePressure <= 55 || f.pressureScore >= 58)
  ) {
    setups.push({
      family: "pressure_reset_reclaim",
      direction: "long",
      confidence: clamp(48 + f.pressureScore * 0.22 + f.lowerWick * 22 + (smartBias ? 8 : 0), 0, 100),
      evidence: ["lower-range reclaim", "pressure reset", smartBias ? "smart-money pressure contribution visible" : "participant pressure stabilizing"],
    });
  }

  if (
    f.compressionRatio <= 0.42
    && f.volumeRatio >= 1.15
    && Math.abs(f.momentum3) >= 0.002
  ) {
    setups.push({
      family: "compression_release",
      direction: f.momentum3 > 0 ? "long" : "short",
      confidence: clamp(46 + (1 - f.compressionRatio) * 24 + Math.min(f.volumeRatio, 2.5) * 9, 0, 100),
      evidence: ["compressed range", "participation expansion", "directional release"],
    });
  }

  return setups.map((setup) => ({
    ...setup,
    entryTime: candle.time,
    entryPrice: candle.close,
    features: f,
  }));
}

function simulateTrade(candles, index, setup, options) {
  const entry = candles[index].close;
  const horizon = options.horizon;
  const stop = options.stopPct;
  const target = options.targetPct;
  const leverage = options.leverage;
  const cost = options.roundTripCostPct;
  const endIndex = Math.min(candles.length - 1, index + horizon);
  let mfe = 0;
  let mae = 0;
  let exitIndex = endIndex;
  let exitReason = "time";
  let grossRet = 0;

  for (let i = index + 1; i <= endIndex; i += 1) {
    const row = candles[i];
    const highRet = setup.direction === "long" ? (row.high / entry) - 1 : (entry / row.low) - 1;
    const lowRet = setup.direction === "long" ? (row.low / entry) - 1 : (entry / row.high) - 1;
    mfe = Math.max(mfe, highRet);
    mae = Math.min(mae, lowRet);

    // Hourly candles do not give path order, so use stop-first accounting.
    if (lowRet <= -stop) {
      grossRet = -stop;
      exitIndex = i;
      exitReason = "stop";
      break;
    }
    if (highRet >= target) {
      grossRet = target;
      exitIndex = i;
      exitReason = "target";
      break;
    }
  }

  if (exitReason === "time") {
    const exit = candles[endIndex].close;
    grossRet = setup.direction === "long" ? (exit / entry) - 1 : (entry / exit) - 1;
  }
  const netRet = grossRet - cost;
  return {
    symbol: setup.symbol,
    family: setup.family,
    direction: setup.direction,
    confidence: Number(setup.confidence.toFixed(2)),
    entryTime: new Date(setup.entryTime).toISOString(),
    exitTime: new Date(candles[exitIndex].time).toISOString(),
    entryPrice: entry,
    exitPrice: candles[exitIndex].close,
    exitReason,
    grossReturnPct: pct(grossRet),
    netReturnPct: pct(netRet),
    leveragedNetReturnPct: pct(netRet * leverage),
    mfePct: pct(mfe),
    maePct: pct(mae),
    holdHours: exitIndex - index,
    evidence: setup.evidence,
    pressureScore: setup.features.pressureScore,
    pressureState: setup.features.pressureState,
    volumeRatio: Number(setup.features.volumeRatio.toFixed(4)),
    compressionRatio: Number(setup.features.compressionRatio.toFixed(4)),
  };
}

function summarizeTrades(trades) {
  const returns = trades.map((trade) => trade.netReturnPct / 100);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netReturnPct, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Number((wins.length / trades.length).toFixed(4)) : 0,
    avgNetReturnPct: trades.length ? Number((trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length).toFixed(4)) : 0,
    medianNetReturnPct: Number(median(trades.map((trade) => trade.netReturnPct)).toFixed(4)),
    p25NetReturnPct: Number(quantile(trades.map((trade) => trade.netReturnPct), 0.25).toFixed(4)),
    p75NetReturnPct: Number(quantile(trades.map((trade) => trade.netReturnPct), 0.75).toFixed(4)),
    totalNetReturnPct: Number(trades.reduce((sum, trade) => sum + trade.netReturnPct, 0).toFixed(4)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : grossWin > 0 ? 999 : 0,
    maxDrawdownPct: pct(maxDrawdown(returns)),
    avgMfePct: trades.length ? Number((trades.reduce((sum, trade) => sum + trade.mfePct, 0) / trades.length).toFixed(4)) : 0,
    avgMaePct: trades.length ? Number((trades.reduce((sum, trade) => sum + trade.maePct, 0) / trades.length).toFixed(4)) : 0,
  };
}

function consistencyScore(row) {
  if (!row.trades) return 0;
  const sampleScore = Math.min(1, row.trades / 40);
  const expectancyScore = Math.max(0, row.avgNetReturnPct) * 2.5;
  const pfScore = Math.max(0, row.profitFactor - 1) * 0.9;
  const drawdownPenalty = Math.min(1.2, Math.abs(row.maxDrawdownPct) / Math.max(10, Math.abs(row.totalNetReturnPct) + 1));
  return Number(((expectancyScore + pfScore + row.winRate * 0.45) * sampleScore - drawdownPenalty * 0.18).toFixed(4));
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function rankedGroups(trades, keyName, keyFn) {
  return [...groupBy(trades, keyFn).entries()]
    .map(([key, rows]) => {
      const row = { [keyName]: key, ...summarizeTrades(rows) };
      row.consistencyScore = consistencyScore(row);
      return row;
    })
    .sort((a, b) => (b.consistencyScore - a.consistencyScore) || (b.avgNetReturnPct - a.avgNetReturnPct) || (b.trades - a.trades));
}

function parseArgs(argv) {
  const args = {
    days: 7,
    interval: "1h",
    limit: 60,
    horizon: 8,
    stopPct: 0.012,
    targetPct: 0.028,
    leverage: 5,
    roundTripCostPct: 0.0008,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      i += 1;
      if (["days", "limit", "horizon", "stopPct", "targetPct", "leverage", "roundTripCostPct"].includes(key)) args[key] = Number(next);
      else args[key] = next;
    }
  }
  return args;
}

function intervalHours(interval) {
  const text = String(interval || "1h").trim().toLowerCase();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (text.endsWith("m")) return value / 60;
  if (text.endsWith("h")) return value;
  if (text.endsWith("d")) return value * 24;
  return 1;
}

export async function runBacktest(options = {}) {
  const now = Date.now();
  const args = { ...parseArgs([]), ...options };
  const candleHours = intervalHours(args.interval);
  const startTime = now - args.days * 24 * 60 * 60 * 1000;
  const metaPayload = await postInfo({ type: "metaAndAssetCtxs" });
  const liveRows = normalizeHyperliquidPerps(metaPayload, { now: new Date(now) })
    .sort((a, b) => num(b.dayNtlVlm) - num(a.dayNtlVlm))
    .slice(0, args.limit);

  const allTrades = [];
  const symbolErrors = [];
  for (const liveRow of liveRows) {
    const coin = String(liveRow.symbol || "").toUpperCase();
    try {
      const candles = await fetchCandles(coin, args.interval, startTime, now);
      if (candles.length < 36) {
        symbolErrors.push({ symbol: `${coin}-PERP`, reason: "insufficient_candles", candles: candles.length });
        continue;
      }
      for (let i = 24; i < candles.length - args.horizon; i += 1) {
        const setups = setupCandidates(candles, i, liveRow);
        for (const setup of setups) {
          const trade = simulateTrade(candles, i, { ...setup, symbol: `${coin}-PERP` }, args);
          trade.holdHours = Number((trade.holdHours * candleHours).toFixed(4));
          allTrades.push(trade);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 90));
    } catch (error) {
      symbolErrors.push({ symbol: `${coin}-PERP`, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const bySetup = rankedGroups(allTrades, "setup", (trade) => `${trade.family}:${trade.direction}`);
  const bySymbol = rankedGroups(allTrades, "symbol", (trade) => trade.symbol);
  const bySetupSymbol = rankedGroups(allTrades, "lane", (trade) => `${trade.family}:${trade.direction}:${trade.symbol}`);
  const byExitReason = rankedGroups(allTrades, "exitReason", (trade) => trade.exitReason);
  const consistentSetups = bySetup.filter((row) => row.trades >= 20 && row.avgNetReturnPct > 0 && row.profitFactor >= 1.05);
  const consistentLanes = bySetupSymbol.filter((row) => row.trades >= 8 && row.avgNetReturnPct > 0 && row.profitFactor >= 1.15).slice(0, 40);
  const candidateTrades = allTrades
    .filter((trade) => (
      consistentSetups.some((setup) => setup.setup === `${trade.family}:${trade.direction}`)
      || consistentLanes.some((lane) => lane.lane === `${trade.family}:${trade.direction}:${trade.symbol}`)
    ))
    .sort((a, b) => b.netReturnPct - a.netReturnPct)
    .slice(0, 80);

  return {
    schema_version: "raven_perps_intelligence_v2_backtest.v1",
    generated_at: new Date(now).toISOString(),
    provider: "Hyperliquid",
    market: "perpetual_futures",
    interval: args.interval,
    lookback_days: args.days,
    symbols_requested: args.limit,
    symbols_processed: liveRows.length - symbolErrors.length,
    diagnostic_only: true,
    paper_only: true,
    affects_live: false,
    affects_sizing: false,
    affects_caps: false,
    affects_mirrors: false,
    affects_promotion: false,
    assumptions: {
      execution: "entry_at_hourly_close",
      path_order: "stop_first_inside_hourly_candle",
      round_trip_cost_pct: args.roundTripCostPct,
      leverage_for_return_on_margin: args.leverage,
      stop_pct: args.stopPct,
      target_pct: args.targetPct,
      hold_horizon_candles: args.horizon,
      hold_horizon_hours: Number((args.horizon * candleHours).toFixed(4)),
      candle_interval_hours: candleHours,
      historical_v2_inputs: "candles plus current Hyperliquid pressure snapshot; no historical orders generated",
    },
    summary: summarizeTrades(allTrades),
    consistent_setups: consistentSetups,
    consistent_lanes: consistentLanes,
    by_setup: bySetup,
    by_symbol: bySymbol.slice(0, 40),
    by_setup_symbol: bySetupSymbol.slice(0, 80),
    by_exit_reason: byExitReason,
    top_candidate_trades: candidateTrades,
    symbol_errors: symbolErrors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await runBacktest(args);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(APP_ROOT, OUT_PATH),
    generated_at: payload.generated_at,
    summary: payload.summary,
    consistent_setups: payload.consistent_setups.slice(0, 8),
    symbol_errors: payload.symbol_errors.length,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
