#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeHyperliquidPerps,
  pressureStateFromScore,
} from "../lib/ravenos_perps_intelligence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const INFO_URL = process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info";
const OUT_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_all_setup_7d_sweep.json");
const SUMMARY_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_all_setup_7d_summary.md");
const CANDIDATES_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_candidate_lanes.json");

const SAFETY_FLAGS = {
  diagnostic_only: true,
  paper_only: true,
  affects_live: false,
  affects_sizing: false,
  affects_caps: false,
  affects_mirrors: false,
  affects_promotion: false,
  live_execution_enabled: false,
  promotion_allowed: false,
};
const WINDOWS = { "15m": 1, "1h": 4, "4h": 16, "12h": 48, "24h": 96 };
const FEE_SLIPPAGE = Number(process.env.PERPS_V2_SWEEP_FEE_SLIPPAGE_PCT || "0.0008");
const MAX_SYMBOLS = Number(process.env.PERPS_V2_SWEEP_SYMBOL_LIMIT || "260");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value)));
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

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

async function postInfo(body) {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Hyperliquid ${body.type} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function fetchCandles(coin, startTime, endTime) {
  const raw = await postInfo({ type: "candleSnapshot", req: { coin, interval: "15m", startTime, endTime } });
  return (Array.isArray(raw) ? raw : [])
    .map((row) => ({
      time: num(row.t),
      open: num(row.o),
      high: num(row.h),
      low: num(row.l),
      close: num(row.c),
      volume: num(row.v),
    }))
    .filter((row) => row.time && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

function sma(values) {
  return mean(values);
}

function features(candles, i, liveRow) {
  const current = candles[i];
  const prev = candles[i - 1] || current;
  const slice = (n) => candles.slice(Math.max(0, i - n), i);
  const c6 = slice(6);
  const c12 = slice(12);
  const c24 = slice(24);
  const c96 = slice(96);
  const closes = (rows) => rows.map((row) => row.close);
  const volumes = c96.map((row) => row.volume);
  const high12 = Math.max(...c12.map((row) => row.high), 0);
  const low12 = Math.min(...c12.map((row) => row.low).filter((value) => value > 0));
  const high96 = Math.max(...c96.map((row) => row.high), 0);
  const low96 = Math.min(...c96.map((row) => row.low).filter((value) => value > 0));
  const ret1 = (current.close / prev.close) - 1;
  const ret4 = i >= 4 ? (current.close / candles[i - 4].close) - 1 : 0;
  const ret16 = i >= 16 ? (current.close / candles[i - 16].close) - 1 : 0;
  const ret96 = i >= 96 ? (current.close / candles[i - 96].close) - 1 : 0;
  const absReturns24 = [];
  const absReturns96 = [];
  for (let j = Math.max(1, i - 96); j <= i; j += 1) {
    const ret = Math.abs((candles[j].close / candles[j - 1].close) - 1);
    absReturns96.push(ret);
    if (j > i - 24) absReturns24.push(ret);
  }
  const range24 = c24.length ? (Math.max(...closes(c24)) - Math.min(...closes(c24))) / current.close : 0;
  const range96 = c96.length ? (Math.max(...closes(c96)) - Math.min(...closes(c96))) / current.close : 0;
  const compression = range96 > 0 ? range24 / range96 : 1;
  const volumeRatio = median(volumes) > 0 ? current.volume / median(volumes) : 1;
  const position = high96 > low96 ? (current.close - low96) / (high96 - low96) : 0.5;
  const wickRange = Math.max(current.high - current.low, current.close * 0.0001);
  const upperWick = (current.high - Math.max(current.open, current.close)) / wickRange;
  const lowerWick = (Math.min(current.open, current.close) - current.low) / wickRange;
  const pressureScore = Math.round(clamp(
    Math.abs(ret16) * 950
    + Math.abs(ret4) * 1250
    + Math.min(volumeRatio, 3) * 12
    + Math.max(0, 1 - compression) * 24
    + Math.abs(position - 0.5) * 30,
  ));
  const replaySimilarity = num(liveRow?.replayMatches?.[0]?.similarity, clamp(45 + pressureScore * 0.45, 35, 95));
  const liquidityScore = num(liveRow?.liquidityAttraction?.score, clamp(pressureScore * 0.7 + Math.min(volumeRatio, 2.5) * 12));
  const composition = Array.isArray(liveRow?.pressureComposition) ? liveRow.pressureComposition : [];
  const leadParticipant = [...composition].sort((a, b) => num(b.contribution) - num(a.contribution))[0]?.name || "Unknown";
  return {
    avgAbs24: mean(absReturns24),
    avgAbs96: mean(absReturns96),
    compression,
    current,
    high12,
    high96,
    leadParticipant,
    liquidityScore,
    low12: Number.isFinite(low12) ? low12 : 0,
    low96: Number.isFinite(low96) ? low96 : 0,
    lowerWick,
    position,
    pressureScore,
    pressureState: pressureStateFromScore(pressureScore),
    ret1,
    ret4,
    ret16,
    ret96,
    replaySimilarity,
    sma24: sma(closes(c24)),
    sma96: sma(closes(c96)),
    upperWick,
    volumeRatio,
  };
}

function replayBand(value) {
  if (value >= 80) return "80_100";
  if (value >= 65) return "65_80";
  if (value >= 50) return "50_65";
  return "under_50";
}

function liquidityBand(value) {
  if (value >= 82) return "extreme";
  if (value >= 66) return "strong";
  if (value >= 45) return "moderate";
  return "weak";
}

function regime(f) {
  if (f.compression <= 0.42) return "compressed";
  if (f.avgAbs24 > f.avgAbs96 * 1.35) return "vol_expanding";
  if (f.ret96 > 0.03) return "uptrend";
  if (f.ret96 < -0.03) return "downtrend";
  return "balanced";
}

function setupSignals(f) {
  const signals = [];
  const add = (setup_family, direction, condition, strength = 50) => {
    if (condition) signals.push({ setup_family, direction, strength: Math.round(clamp(strength)) });
  };
  add("compression_release", "long", f.compression <= 0.48 && f.ret4 > 0.002 && f.volumeRatio >= 1.05, 55 + f.volumeRatio * 8);
  add("compression_release", "short", f.compression <= 0.48 && f.ret4 < -0.002 && f.volumeRatio >= 1.05, 55 + f.volumeRatio * 8);
  add("crowded_upside_exhaustion", "short", f.position >= 0.78 && f.upperWick >= 0.32 && f.ret4 < 0, 58 + f.upperWick * 22);
  add("long_reclaim", "long", f.position <= 0.28 && f.lowerWick >= 0.28 && f.ret4 > 0, 52 + f.lowerWick * 18);
  add("short_reclaim", "short", f.position >= 0.72 && f.upperWick >= 0.28 && f.ret4 < 0, 52 + f.upperWick * 18);
  add("pressure_expansion", "long", f.pressureScore >= 68 && f.ret4 > 0.002 && f.volumeRatio >= 1.1, f.pressureScore);
  add("pressure_expansion", "short", f.pressureScore >= 68 && f.ret4 < -0.002 && f.volumeRatio >= 1.1, f.pressureScore);
  add("pressure_collapse", "long", f.pressureScore <= 42 && f.ret4 > 0.001, 100 - f.pressureScore);
  add("pressure_collapse", "short", f.pressureScore <= 42 && f.ret4 < -0.001, 100 - f.pressureScore);
  add("liquidity_attraction", "long", f.liquidityScore >= 66 && f.position <= 0.35 && f.ret4 > 0, f.liquidityScore);
  add("liquidity_attraction", "short", f.liquidityScore >= 66 && f.position >= 0.65 && f.ret4 < 0, f.liquidityScore);
  add("liquidation_cluster_approach", "long", f.liquidityScore >= 80 && f.ret16 < -0.01 && f.lowerWick >= 0.18, f.liquidityScore);
  add("liquidation_cluster_approach", "short", f.liquidityScore >= 80 && f.ret16 > 0.01 && f.upperWick >= 0.18, f.liquidityScore);
  add("smart_money_conflict", "neutral", f.leadParticipant === "Smart Money" && Math.abs(f.ret16) < 0.006 && f.pressureScore >= 55, f.pressureScore);
  add("retail_chase", "short", f.leadParticipant === "Retail" && f.ret16 > 0.012 && f.volumeRatio >= 1.2, 60 + f.volumeRatio * 7);
  add("retail_chase", "long", f.leadParticipant === "Retail" && f.ret16 < -0.012 && f.volumeRatio >= 1.2, 60 + f.volumeRatio * 7);
  add("participant_rotation", "neutral", f.volumeRatio >= 1.35 && Math.abs(f.ret4) < 0.004, 55 + f.volumeRatio * 9);
  add("replay_similarity_high", "long", f.replaySimilarity >= 80 && f.ret4 > 0.001, f.replaySimilarity);
  add("replay_similarity_high", "short", f.replaySimilarity >= 80 && f.ret4 < -0.001, f.replaySimilarity);
  add("replay_similarity_failure", "short", f.replaySimilarity >= 70 && f.position >= 0.75 && f.ret4 < 0, f.replaySimilarity);
  add("replay_similarity_failure", "long", f.replaySimilarity >= 70 && f.position <= 0.25 && f.ret4 > 0, f.replaySimilarity);
  add("funding_oi_divergence", "long", f.pressureScore >= 55 && f.volumeRatio < 0.85 && f.ret16 > 0, f.pressureScore);
  add("funding_oi_divergence", "short", f.pressureScore >= 55 && f.volumeRatio < 0.85 && f.ret16 < 0, f.pressureScore);
  add("oi_expansion", "long", f.pressureScore >= 60 && f.ret16 > 0.006, f.pressureScore);
  add("oi_expansion", "short", f.pressureScore >= 60 && f.ret16 < -0.006, f.pressureScore);
  add("oi_contraction", "neutral", f.pressureScore <= 45 && f.volumeRatio < 0.9, 100 - f.pressureScore);
  add("basis_dislocation", "long", Math.abs(f.ret1) >= 0.01 && f.lowerWick >= 0.2, Math.abs(f.ret1) * 1800);
  add("basis_dislocation", "short", Math.abs(f.ret1) >= 0.01 && f.upperWick >= 0.2, Math.abs(f.ret1) * 1800);
  add("volatility_squeeze", "neutral", f.compression <= 0.38 && f.volumeRatio < 1.2, 65 + (1 - f.compression) * 20);
  add("volatility_expansion", "long", f.avgAbs24 > f.avgAbs96 * 1.35 && f.ret4 > 0.002, 62 + f.avgAbs24 * 1000);
  add("volatility_expansion", "short", f.avgAbs24 > f.avgAbs96 * 1.35 && f.ret4 < -0.002, 62 + f.avgAbs24 * 1000);
  return signals;
}

function outcome(candles, i, direction, horizon) {
  const entry = candles[i].close;
  const end = Math.min(candles.length - 1, i + horizon);
  if (end <= i || entry <= 0) return null;
  const final = candles[end].close;
  let mfe = 0;
  let mae = 0;
  for (let j = i + 1; j <= end; j += 1) {
    const c = candles[j];
    if (direction === "neutral") {
      const up = (c.high / entry) - 1;
      const down = (entry / c.low) - 1;
      mfe = Math.max(mfe, up, down);
      mae = Math.min(mae, -Math.min(up, down));
    } else {
      const favorable = direction === "short" ? (entry / c.low) - 1 : (c.high / entry) - 1;
      const adverse = direction === "short" ? (entry / c.high) - 1 : (c.low / entry) - 1;
      mfe = Math.max(mfe, favorable);
      mae = Math.min(mae, adverse);
    }
  }
  const gross = direction === "neutral" ? Math.abs((final / entry) - 1) : direction === "short" ? (entry / final) - 1 : (final / entry) - 1;
  return { net: gross - FEE_SLIPPAGE, mfe, mae };
}

function maxDrawdown(values) {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    dd = Math.min(dd, equity - peak);
  }
  return dd;
}

function summarize(rows) {
  const nets = rows.map((row) => row.net).filter(Number.isFinite);
  const wins = nets.filter((value) => value > 0);
  const losses = nets.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const bySymbol = new Map();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol).push(row.net);
  }
  const symbolSummaries = [...bySymbol.entries()].map(([symbol, values]) => ({ symbol, avg: mean(values), count: values.length }));
  symbolSummaries.sort((a, b) => b.avg - a.avg);
  const largest = Math.max(...nets.map((value) => Math.abs(value)), 0);
  const totalAbs = nets.reduce((sum, value) => sum + Math.abs(value), 0);
  return {
    count: nets.length,
    avg_net_after_fees_slippage_pct: pct(mean(nets)),
    median_net_pct: pct(median(nets)),
    win_rate: nets.length ? Number((wins.length / nets.length).toFixed(4)) : 0,
    profit_factor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : grossWin > 0 ? 999 : 0,
    avg_mae_pct: pct(mean(rows.map((row) => row.mae))),
    avg_mfe_pct: pct(mean(rows.map((row) => row.mfe))),
    drawdown_pct: pct(maxDrawdown(nets)),
    best_symbol: symbolSummaries[0]?.symbol || "",
    worst_symbol: symbolSummaries[symbolSummaries.length - 1]?.symbol || "",
    outlier_dependency: totalAbs > 0 ? Number((largest / totalAbs).toFixed(4)) : 0,
  };
}

function classify(summary) {
  if (summary.count < 20) return "insufficient_sample";
  if (summary.avg_net_after_fees_slippage_pct <= 0 || summary.profit_factor <= 1.15 || summary.outlier_dependency >= 0.45) return "reject";
  if (summary.count >= 50 && summary.profit_factor > 1.2) return "provisional_candidate";
  return "discovery_candidate";
}

function groupKey(row, mode) {
  if (mode === "family") return `${row.setup_family}:${row.direction}:${row.timeframe}`;
  if (mode === "symbol") return `${row.setup_family}:${row.direction}:${row.symbol}:${row.timeframe}`;
  if (mode === "pressure") return `${row.setup_family}:${row.direction}:${row.timeframe}:${row.pressure_state}`;
  if (mode === "replay") return `${row.setup_family}:${row.direction}:${row.timeframe}:${row.replay_similarity_band}`;
  if (mode === "liquidity") return `${row.setup_family}:${row.direction}:${row.timeframe}:${row.liquidity_attraction_band}`;
  if (mode === "participant") return `${row.setup_family}:${row.direction}:${row.timeframe}:${row.participant_composition}`;
  if (mode === "regime") return `${row.setup_family}:${row.direction}:${row.timeframe}:${row.market_regime}`;
  return `${row.setup_family}:${row.direction}:${row.timeframe}`;
}

function grouped(events, mode) {
  const groups = new Map();
  for (const row of events) {
    const key = groupKey(row, mode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const summary = summarize(rows);
    return { key, classification: classify(summary), sample_sufficiency: summary.count >= 50 ? "sufficient" : summary.count >= 20 ? "discovery_only" : "insufficient_sample", ...summary };
  }).sort((a, b) => (b.avg_net_after_fees_slippage_pct - a.avg_net_after_fees_slippage_pct) || (b.count - a.count));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map((col) => col.label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((col) => String(row[col.key] ?? "")).join(" | ")} |`),
  ].join("\n");
}

function writeSummary(payload, candidates) {
  const lines = [
    "# Perps v2 All-Setup 7d Sweep",
    "",
    `Generated: ${payload.generated_at}`,
    "",
    "Diagnostic research only. No forward-paper lane is modified by this sweep. No promotion or live execution is allowed.",
    "",
    "## Top Family Results",
    markdownTable(payload.grouped_by_setup_family.slice(0, 20), [
      { key: "key", label: "Lane" },
      { key: "classification", label: "Class" },
      { key: "count", label: "Count" },
      { key: "avg_net_after_fees_slippage_pct", label: "Avg Net %" },
      { key: "win_rate", label: "Win Rate" },
      { key: "profit_factor", label: "PF" },
      { key: "best_symbol", label: "Best Symbol" },
      { key: "worst_symbol", label: "Worst Symbol" },
    ]),
    "",
    "## Candidate Lanes",
    markdownTable(candidates.candidate_lanes.slice(0, 30), [
      { key: "key", label: "Lane" },
      { key: "classification", label: "Class" },
      { key: "count", label: "Count" },
      { key: "avg_net_after_fees_slippage_pct", label: "Avg Net %" },
      { key: "profit_factor", label: "PF" },
      { key: "sample_sufficiency", label: "Sample" },
    ]),
    "",
    "## Workflow Boundaries",
    "",
    "- Backtest discovery: historical structure/outcome research used to find candidate lanes.",
    "- Forward paper tracking: live diagnostic observation of approved lanes without execution.",
    "- Promotion review: future gated review requiring sample sufficiency, stability, and risk checks.",
    "- Live execution: separate canary/live rail process; this sweep does not enable it.",
    "",
    "No trade recommendations are generated.",
    "",
  ];
  fs.writeFileSync(SUMMARY_PATH, lines.join("\n"));
}

export async function runAllSetupSweep() {
  const now = Date.now();
  const startTime = now - 7 * 24 * 60 * 60 * 1000;
  const meta = await postInfo({ type: "metaAndAssetCtxs" });
  const liveRows = normalizeHyperliquidPerps(meta, { now: new Date(now) })
    .sort((a, b) => num(b.dayNtlVlm) - num(a.dayNtlVlm))
    .slice(0, MAX_SYMBOLS);
  const events = [];
  const errors = [];

  for (const liveRow of liveRows) {
    const coin = String(liveRow.symbol || "").toUpperCase();
    try {
      const candles = await fetchCandles(coin, startTime, now);
      if (candles.length < 120) {
        errors.push({ symbol: `${coin}-PERP`, reason: "insufficient_candles", candles: candles.length });
        continue;
      }
      for (let i = 96; i < candles.length - WINDOWS["24h"]; i += 1) {
        const f = features(candles, i, liveRow);
        const signals = setupSignals(f);
        for (const signal of signals) {
          for (const [timeframe, horizon] of Object.entries(WINDOWS)) {
            const out = outcome(candles, i, signal.direction, horizon);
            if (!out) continue;
            events.push({
              symbol: `${coin}-PERP`,
              setup_family: signal.setup_family,
              direction: signal.direction,
              timeframe,
              time: new Date(candles[i].time).toISOString(),
              net: out.net,
              mfe: out.mfe,
              mae: out.mae,
              pressure_state: f.pressureState,
              replay_similarity_band: replayBand(f.replaySimilarity),
              liquidity_attraction_band: liquidityBand(f.liquidityScore),
              participant_composition: f.leadParticipant,
              market_regime: regime(f),
              strength: signal.strength,
            });
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 65));
    } catch (error) {
      errors.push({ symbol: `${coin}-PERP`, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const groupedByFamily = grouped(events, "family");
  const groupedBySymbol = grouped(events, "symbol");
  const groupedByPressure = grouped(events, "pressure");
  const groupedByReplay = grouped(events, "replay");
  const groupedByLiquidity = grouped(events, "liquidity");
  const groupedByParticipant = grouped(events, "participant");
  const groupedByRegime = grouped(events, "regime");
  const candidateLanes = groupedBySymbol
    .filter((row) => ["discovery_candidate", "provisional_candidate"].includes(row.classification))
    .map((row) => ({
      ...row,
      classification: row.classification === "provisional_candidate" && row.count >= 50 ? "forward_track_candidate" : row.classification,
      auto_add_to_forward_paper: false,
    }));

  const payload = {
    schema_version: "perps_v2_all_setup_7d_sweep.v1",
    generated_at: new Date(now).toISOString(),
    provider: "Hyperliquid",
    interval: "15m",
    lookback_days: 7,
    symbols_requested: liveRows.length,
    symbols_processed: liveRows.length - errors.length,
    event_count: events.length,
    ...SAFETY_FLAGS,
    approved_forward_paper_lanes_unchanged: true,
    candidate_rules: {
      discovery_min_samples: 20,
      provisional_min_samples: 50,
      discovery_profit_factor_min: 1.15,
      provisional_profit_factor_min: 1.2,
      positive_avg_net_required: true,
      outlier_dependency_max: 0.45,
    },
    grouped_by_setup_family: groupedByFamily,
    grouped_by_symbol: groupedBySymbol.slice(0, 2500),
    grouped_by_pressure_state: groupedByPressure.slice(0, 1200),
    grouped_by_replay_similarity_band: groupedByReplay.slice(0, 1200),
    grouped_by_liquidity_attraction_band: groupedByLiquidity.slice(0, 1200),
    grouped_by_participant_composition: groupedByParticipant.slice(0, 1200),
    grouped_by_market_regime: groupedByRegime.slice(0, 1200),
    errors,
  };
  const candidates = {
    schema_version: "perps_v2_candidate_lanes.v1",
    generated_at: payload.generated_at,
    ...SAFETY_FLAGS,
    auto_add_to_forward_paper: false,
    approved_forward_paper_lanes_unchanged: true,
    candidate_lanes: candidateLanes.slice(0, 300),
  };
  writeJson(OUT_PATH, payload);
  writeJson(CANDIDATES_PATH, candidates);
  writeSummary(payload, candidates);
  return { payload, candidates };
}

async function main() {
  const { payload, candidates } = await runAllSetupSweep();
  console.log(JSON.stringify({
    sweep: path.relative(APP_ROOT, OUT_PATH),
    summary: path.relative(APP_ROOT, SUMMARY_PATH),
    candidates: path.relative(APP_ROOT, CANDIDATES_PATH),
    generated_at: payload.generated_at,
    symbols_processed: payload.symbols_processed,
    event_count: payload.event_count,
    candidate_lanes: candidates.candidate_lanes.length,
    top_candidates: candidates.candidate_lanes.slice(0, 12),
    errors: payload.errors.length,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
