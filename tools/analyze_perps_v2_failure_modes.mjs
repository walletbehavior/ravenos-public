#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const SWEEP_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_all_setup_7d_sweep.json");
const CANDIDATES_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_candidate_lanes.json");
const TRADES_PATH = path.resolve(APP_ROOT, "data/perp_sim/perp_trades.jsonl");
const MARKS_PATH = path.resolve(APP_ROOT, "data/perp_sim/perp_marks.jsonl");
const OUT_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_failure_mode_analysis.json");
const MD_PATH = path.resolve(APP_ROOT, "data/runtime/perps_v2_failure_mode_analysis.md");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function weighted(rows, valueKey = "avg_net_after_fees_slippage_pct") {
  const count = rows.reduce((sum, row) => sum + num(row.count), 0);
  if (!count) return 0;
  return Number((rows.reduce((sum, row) => sum + num(row[valueKey]) * num(row.count), 0) / count).toFixed(4));
}

function parseKey(row) {
  const parts = String(row.key || "").split(":");
  return {
    setup_family: parts[0] || "unknown",
    direction: parts[1] || "unknown",
    symbol: parts.length >= 4 && parts[2]?.endsWith("-PERP") ? parts[2] : "",
    timeframe: parts.find((part) => ["15m", "1h", "4h", "12h", "24h"].includes(part)) || "",
    dimension: parts[parts.length - 1] || "unknown",
  };
}

function reduceDimension(rows, label) {
  const groups = new Map();
  for (const row of rows || []) {
    if (num(row.count) < 20) continue;
    const key = parseKey(row).dimension;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, items]) => ({
    dimension: label,
    value: key,
    groups: items.length,
    count: items.reduce((sum, row) => sum + num(row.count), 0),
    weighted_avg_net_pct: weighted(items),
    positive_group_rate: Number((items.filter((row) => num(row.avg_net_after_fees_slippage_pct) > 0).length / items.length).toFixed(4)),
    candidate_group_rate: Number((items.filter((row) => ["discovery_candidate", "provisional_candidate", "forward_track_candidate"].includes(row.classification)).length / items.length).toFixed(4)),
  })).sort((a, b) => b.weighted_avg_net_pct - a.weighted_avg_net_pct);
}

function topBottom(rows, minCount = 50) {
  const usable = (rows || []).filter((row) => num(row.count) >= minCount);
  return {
    positive: [...usable].sort((a, b) => num(b.avg_net_after_fees_slippage_pct) - num(a.avg_net_after_fees_slippage_pct)).slice(0, 20),
    negative: [...usable].sort((a, b) => num(a.avg_net_after_fees_slippage_pct) - num(b.avg_net_after_fees_slippage_pct)).slice(0, 20),
  };
}

function classifyTrade(row) {
  const pnl = num(row.realized_pnl_usd ?? row.pnl_usd);
  const pnlPct = num(row.realized_pnl_pct ?? row.pnl_pct);
  if (Math.abs(pnl) < 0.25 && Math.abs(pnlPct) < 0.001) return "flat";
  if (pnl > 0 || pnlPct > 0) return "positive";
  return "negative";
}

function summarizeTradeRows(rows) {
  const n = rows.length;
  const pnl = rows.map((row) => num(row.realized_pnl_usd ?? row.pnl_usd));
  const mfe = rows.map((row) => num(row.mfe_pct));
  const mae = rows.map((row) => num(row.mae_pct));
  return {
    count: n,
    pnl_usd: Number(pnl.reduce((sum, value) => sum + value, 0).toFixed(4)),
    avg_pnl_usd: n ? Number((pnl.reduce((sum, value) => sum + value, 0) / n).toFixed(4)) : 0,
    avg_mfe_pct: n ? Number((mfe.reduce((sum, value) => sum + value, 0) / n).toFixed(6)) : 0,
    avg_mae_pct: n ? Number((mae.reduce((sum, value) => sum + value, 0) / n).toFixed(6)) : 0,
    flat_rate: n ? Number((rows.filter((row) => classifyTrade(row) === "flat").length / n).toFixed(4)) : 0,
    positive_rate: n ? Number((rows.filter((row) => classifyTrade(row) === "positive").length / n).toFixed(4)) : 0,
  };
}

function groupTrades(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, ...summarizeTradeRows(items) }))
    .sort((a, b) => b.avg_pnl_usd - a.avg_pnl_usd);
}

function analyzeActualTrades() {
  const trades = readJsonl(TRADES_PATH);
  const exits = trades.filter((row) => row.event === "close" || row.status === "closed");
  const marks = readJsonl(MARKS_PATH);
  const firstTs = Math.min(...trades.map((row) => num(row.ts, Infinity)).filter(Number.isFinite));
  const lastTs = Math.max(...trades.map((row) => num(row.ts)).filter(Number.isFinite));
  const fallbackMarks = marks.filter((row) => row.fallback_used || String(row.source || "").startsWith("fallback"));
  const flatMarks = marks.filter((row) => Math.abs(num(row.pnl_usd)) < 0.01 && Math.abs(num(row.mfe_usd)) < 0.01 && Math.abs(num(row.mae_usd)) < 0.01);
  return {
    source: path.relative(APP_ROOT, TRADES_PATH),
    mark_source: path.relative(APP_ROOT, MARKS_PATH),
    trade_events: trades.length,
    exit_like_rows: exits.length,
    first_ts: Number.isFinite(firstTs) ? new Date(firstTs * 1000).toISOString() : null,
    last_ts: Number.isFinite(lastTs) ? new Date(lastTs * 1000).toISOString() : null,
    summary: summarizeTradeRows(exits),
    by_symbol: groupTrades(exits, (row) => row.symbol || "unknown").slice(0, 30),
    by_strategy: groupTrades(exits, (row) => row.strategy || row.strategy_family || "unknown").slice(0, 30),
    by_pattern: groupTrades(exits, (row) => row.minimal_pattern_label || row.primary_pattern_label || row.pattern_type || "unknown").slice(0, 30),
    by_exit_reason: groupTrades(exits, (row) => row.exit_reason || row.reason || "unknown").slice(0, 30),
    mark_quality: {
      marks: marks.length,
      fallback_marks: fallbackMarks.length,
      fallback_rate: marks.length ? Number((fallbackMarks.length / marks.length).toFixed(4)) : 0,
      flat_marks: flatMarks.length,
      flat_mark_rate: marks.length ? Number((flatMarks.length / marks.length).toFixed(4)) : 0,
    },
  };
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map((col) => col.label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((col) => String(row[col.key] ?? "")).join(" | ")} |`),
  ].join("\n");
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeMarkdown(payload) {
  const lines = [
    "# Perps v2 Failure Mode Analysis",
    "",
    `Generated: ${payload.generated_at}`,
    "",
    "Purpose: explain why broad families failed while specific lanes succeeded. This is not optimization and does not create live rules.",
    "",
    "## Top Positive Predictors",
    markdownTable(payload.top_positive_predictors.slice(0, 20), [
      { key: "dimension", label: "Dimension" },
      { key: "value", label: "Value" },
      { key: "count", label: "Count" },
      { key: "weighted_avg_net_pct", label: "Weighted Avg Net %" },
      { key: "positive_group_rate", label: "Positive Group Rate" },
      { key: "candidate_group_rate", label: "Candidate Group Rate" },
    ]),
    "",
    "## Top Negative Predictors",
    markdownTable(payload.top_negative_predictors.slice(0, 20), [
      { key: "dimension", label: "Dimension" },
      { key: "value", label: "Value" },
      { key: "count", label: "Count" },
      { key: "weighted_avg_net_pct", label: "Weighted Avg Net %" },
      { key: "positive_group_rate", label: "Positive Group Rate" },
      { key: "candidate_group_rate", label: "Candidate Group Rate" },
    ]),
    "",
    "## Lane Clustering",
    markdownTable(payload.lane_clustering.top_positive.slice(0, 20), [
      { key: "key", label: "Lane" },
      { key: "classification", label: "Class" },
      { key: "count", label: "Count" },
      { key: "avg_net_after_fees_slippage_pct", label: "Avg Net %" },
      { key: "profit_factor", label: "PF" },
      { key: "best_symbol", label: "Best" },
      { key: "worst_symbol", label: "Worst" },
    ]),
    "",
    "## Regime Clustering",
    markdownTable(payload.regime_clustering.slice(0, 20), [
      { key: "dimension", label: "Dimension" },
      { key: "value", label: "Regime" },
      { key: "count", label: "Count" },
      { key: "weighted_avg_net_pct", label: "Weighted Avg Net %" },
      { key: "candidate_group_rate", label: "Candidate Group Rate" },
    ]),
    "",
    "## Actual PerpSim Trade Flatness",
    "",
    `Available trade window: ${payload.actual_trade_analysis.first_ts || "unknown"} to ${payload.actual_trade_analysis.last_ts || "unknown"}.`,
    "",
    markdownTable([payload.actual_trade_analysis.summary], [
      { key: "count", label: "Exit Rows" },
      { key: "pnl_usd", label: "PnL USD" },
      { key: "avg_pnl_usd", label: "Avg PnL" },
      { key: "flat_rate", label: "Flat Rate" },
      { key: "positive_rate", label: "Positive Rate" },
      { key: "avg_mfe_pct", label: "Avg MFE %" },
      { key: "avg_mae_pct", label: "Avg MAE %" },
    ]),
    "",
    "Mark quality:",
    "",
    markdownTable([payload.actual_trade_analysis.mark_quality], [
      { key: "marks", label: "Marks" },
      { key: "fallback_rate", label: "Fallback Rate" },
      { key: "flat_mark_rate", label: "Flat Mark Rate" },
    ]),
    "",
    "No live trade recommendations are generated.",
    "",
  ];
  fs.writeFileSync(MD_PATH, lines.join("\n"));
}

export function runAnalysis() {
  const sweep = readJson(SWEEP_PATH, {});
  const candidates = readJson(CANDIDATES_PATH, {});
  const dimensions = [
    ...reduceDimension(sweep.grouped_by_pressure_state, "pressure_state"),
    ...reduceDimension(sweep.grouped_by_replay_similarity_band, "replay_similarity_band"),
    ...reduceDimension(sweep.grouped_by_liquidity_attraction_band, "liquidity_attraction_band"),
    ...reduceDimension(sweep.grouped_by_participant_composition, "pressure_composition"),
    ...reduceDimension(sweep.grouped_by_market_regime, "market_regime"),
  ];
  const laneCluster = topBottom(sweep.grouped_by_symbol, 20);
  const familyCluster = topBottom(sweep.grouped_by_setup_family, 50);
  const payload = {
    schema_version: "perps_v2_failure_mode_analysis.v1",
    generated_at: new Date().toISOString(),
    diagnostic_only: true,
    paper_only: true,
    affects_live: false,
    live_execution_enabled: false,
    promotion_allowed: false,
    sweep_source: path.relative(APP_ROOT, SWEEP_PATH),
    candidate_source: path.relative(APP_ROOT, CANDIDATES_PATH),
    top_positive_predictors: [...dimensions].sort((a, b) => b.weighted_avg_net_pct - a.weighted_avg_net_pct).slice(0, 50),
    top_negative_predictors: [...dimensions].sort((a, b) => a.weighted_avg_net_pct - b.weighted_avg_net_pct).slice(0, 50),
    lane_clustering: {
      top_positive: laneCluster.positive,
      top_negative: laneCluster.negative,
      candidate_lanes: candidates.candidate_lanes || [],
    },
    family_clustering: {
      top_positive: familyCluster.positive,
      top_negative: familyCluster.negative,
    },
    regime_clustering: reduceDimension(sweep.grouped_by_market_regime, "market_regime"),
    symbol_clustering: topBottom(sweep.grouped_by_symbol, 20),
    explanatory_findings: {
      replay_similarity: reduceDimension(sweep.grouped_by_replay_similarity_band, "replay_similarity_band"),
      liquidity_attraction: reduceDimension(sweep.grouped_by_liquidity_attraction_band, "liquidity_attraction_band"),
      pressure_composition: reduceDimension(sweep.grouped_by_participant_composition, "pressure_composition"),
      pressure_state: reduceDimension(sweep.grouped_by_pressure_state, "pressure_state"),
      note: "Funding, OI velocity, market cap category, and symbol category are not fully separable in the current sweep artifact; add those as explicit sweep dimensions before drawing strong conclusions from them.",
    },
    actual_trade_analysis: analyzeActualTrades(),
  };
  writeJson(OUT_PATH, payload);
  writeMarkdown(payload);
  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = runAnalysis();
  console.log(JSON.stringify({
    analysis: path.relative(APP_ROOT, OUT_PATH),
    summary: path.relative(APP_ROOT, MD_PATH),
    top_positive_predictors: payload.top_positive_predictors.slice(0, 10),
    top_negative_predictors: payload.top_negative_predictors.slice(0, 10),
    actual_trade_summary: payload.actual_trade_analysis.summary,
    mark_quality: payload.actual_trade_analysis.mark_quality,
  }, null, 2));
}
