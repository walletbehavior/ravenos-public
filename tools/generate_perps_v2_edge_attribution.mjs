#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const SWEEP = path.resolve(APP_ROOT, "data/runtime/perps_v2_all_setup_7d_sweep.json");
const CANDIDATES = path.resolve(APP_ROOT, "data/runtime/perps_v2_candidate_lanes.json");
const FAILURE = path.resolve(APP_ROOT, "data/runtime/perps_v2_failure_mode_analysis.json");
const FORWARD = path.resolve(APP_ROOT, "data/runtime/perps_v2_forward_paper_report.json");
const TRADES = path.resolve(APP_ROOT, "data/perp_sim/perp_trades.jsonl");
const EDGE_OUT = path.resolve(APP_ROOT, "data/runtime/perps_v2_edge_attribution_report.json");
const EDGE_MD = path.resolve(APP_ROOT, "data/runtime/perps_v2_edge_attribution_summary.md");
const FLAT_OUT = path.resolve(APP_ROOT, "data/runtime/perps_v2_perpsim_flatness_report.json");
const PLAN_OUT = path.resolve(APP_ROOT, "data/runtime/perps_v2_candidate_promotion_plan.json");

const SAFETY = {
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

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\n+/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function parseLaneKey(key) {
  const parts = String(key || "").split(":");
  return {
    setup_family: parts[0] || "unknown",
    direction: parts[1] || "unknown",
    symbol: parts.find((part) => part.endsWith("-PERP")) || "",
    timeframe: parts.find((part) => ["15m", "1h", "4h", "12h", "24h"].includes(part)) || "",
  };
}

function scoreLane(row) {
  let score = 0;
  score += Math.max(0, num(row.avg_net_after_fees_slippage_pct)) * 8;
  score += Math.max(0, num(row.profit_factor) - 1) * 8;
  score += Math.min(2, num(row.count) / 50) * 4;
  score -= Math.max(0, num(row.outlier_dependency) - 0.22) * 20;
  score -= Math.max(0, Math.abs(num(row.avg_mae_pct)) - Math.abs(num(row.avg_mfe_pct))) * 0.2;
  return Number(score.toFixed(4));
}

function planStatus(row) {
  if (num(row.count) < 20) return "needs_more_sample";
  if (num(row.avg_net_after_fees_slippage_pct) <= 0 || num(row.profit_factor) < 1.15 || num(row.outlier_dependency) >= 0.45) return "reject";
  if (num(row.count) < 50) return "watch";
  if (num(row.profit_factor) >= 1.2 && num(row.outlier_dependency) < 0.22 && Math.abs(num(row.avg_mae_pct)) <= Math.max(10, Math.abs(num(row.avg_mfe_pct)))) {
    return scoreLane(row) >= 35 ? "high_priority_forward_track" : "forward_track_candidate";
  }
  return "watch";
}

function summarize(values) {
  const rows = values.filter(Boolean);
  const count = rows.length;
  const pnl = rows.map((row) => num(row.realized_pnl_usd));
  const mfe = rows.map((row) => num(row.mfe_pct));
  const mae = rows.map((row) => num(row.mae_pct));
  return {
    count,
    pnl_usd: Number(pnl.reduce((sum, value) => sum + value, 0).toFixed(4)),
    avg_pnl_usd: count ? Number((pnl.reduce((sum, value) => sum + value, 0) / count).toFixed(4)) : 0,
    avg_mfe_pct: count ? Number((mfe.reduce((sum, value) => sum + value, 0) / count).toFixed(6)) : 0,
    avg_mae_pct: count ? Number((mae.reduce((sum, value) => sum + value, 0) / count).toFixed(6)) : 0,
    flat_rate: count ? Number((rows.filter((row) => Math.abs(num(row.realized_pnl_usd)) < 0.25).length / count).toFixed(4)) : 0,
    positive_rate: count ? Number((rows.filter((row) => num(row.realized_pnl_usd) > 0).length / count).toFixed(4)) : 0,
  };
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, ...summarize(items) })).sort((a, b) => b.avg_pnl_usd - a.avg_pnl_usd);
}

function table(rows, columns) {
  return [
    `| ${columns.map((c) => c.label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((c) => String(row[c.key] ?? "")).join(" | ")} |`),
  ].join("\n");
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function run() {
  const sweep = readJson(SWEEP);
  const candidates = readJson(CANDIDATES);
  const failure = readJson(FAILURE);
  const forward = readJson(FORWARD);
  const generated_at = new Date().toISOString();

  const familyRows = sweep.grouped_by_setup_family || [];
  const symbolRows = sweep.grouped_by_symbol || [];
  const planRows = (candidates.candidate_lanes || []).map((row) => {
    const parsed = parseLaneKey(row.key);
    return {
      ...row,
      ...parsed,
      edge_score: scoreLane(row),
      status: planStatus(row),
      rationale: [
        num(row.avg_net_after_fees_slippage_pct) > 0 ? "positive_avg_net" : "non_positive_avg_net",
        num(row.profit_factor) >= 1.2 ? "profit_factor_preferred" : "profit_factor_watch",
        num(row.count) >= 50 ? "sample_sufficient" : "needs_more_sample",
        num(row.outlier_dependency) < 0.22 ? "not_outlier_dependent" : "outlier_dependency_watch",
      ],
      auto_add_to_forward_paper: false,
    };
  }).sort((a, b) => b.edge_score - a.edge_score);

  const edge = {
    schema_version: "perps_v2_edge_attribution_report.v1",
    generated_at,
    ...SAFETY,
    source_files: {
      sweep: path.relative(APP_ROOT, SWEEP),
      candidates: path.relative(APP_ROOT, CANDIDATES),
      failure_mode_analysis: path.relative(APP_ROOT, FAILURE),
      forward_paper_report: path.relative(APP_ROOT, FORWARD),
    },
    strongest_positive_predictors: failure.top_positive_predictors || [],
    strongest_negative_predictors: failure.top_negative_predictors || [],
    feature_interactions: [
      {
        interaction: "compressed_regime + exhausted_or_constructive_pressure",
        read: "Compression worked when pressure was not already crowded. Broad families failed when this filter was ignored.",
      },
      {
        interaction: "moderate_liquidity_attraction + realistic_forward_window",
        read: "Moderate liquidity attraction outperformed weak/extreme buckets; 12h/24h windows captured more MFE than 1h windows.",
      },
      {
        interaction: "specific_symbol + setup_family",
        read: "Positive lanes were highly symbol-sensitive. Family-level averages were diluted by symbols with opposite behavior.",
      },
      {
        interaction: "crowded_pressure + broad_direction",
        read: "Crowded and elevated pressure states were the weakest aggregate predictors and should be treated as context, not permission.",
      },
    ],
    symbol_clusters: {
      positive: (failure.symbol_clustering?.top_positive || []).slice(0, 30),
      negative: (failure.symbol_clustering?.top_negative || []).slice(0, 30),
    },
    setup_clusters: {
      positive: (failure.family_clustering?.top_positive || []).slice(0, 30),
      negative: (failure.family_clustering?.top_negative || []).slice(0, 30),
    },
    regime_clusters: failure.regime_clustering || [],
    lane_clusters: {
      candidate: planRows.filter((row) => ["high_priority_forward_track", "forward_track_candidate", "watch"].includes(row.status)).slice(0, 100),
      reject: planRows.filter((row) => row.status === "reject").slice(0, 100),
    },
    caveats: [
      "Neutral/structure-only lanes measure movement quality, not directional execution edge.",
      "Funding/OI velocity and market-cap buckets need explicit live fields before high-confidence attribution.",
      "Provider candle gaps reduced coverage from the expected full Hyperliquid universe.",
    ],
  };

  const trades = readJsonl(TRADES);
  const closed = trades.filter((row) => row.event === "close" || row.status === "closed");
  const stopped = closed.filter((row) => String(row.reason || row.exit_reason) === "stop");
  const flat = closed.filter((row) => Math.abs(num(row.realized_pnl_usd)) < 0.25);
  const winners = closed.filter((row) => num(row.realized_pnl_usd) > 0.25);
  const existingSymbols = new Set(closed.map((row) => row.symbol));
  const missed = planRows.filter((row) => row.status === "high_priority_forward_track" && !existingSymbols.has(row.symbol)).slice(0, 30);
  const flatness = {
    schema_version: "perps_v2_perpsim_flatness_report.v1",
    generated_at,
    ...SAFETY,
    trade_source: path.relative(APP_ROOT, TRADES),
    closed_trade_summary: summarize(closed),
    top_causes_of_flatness: [
      {
        cause: "broad_family_dilution",
        evidence: "Sweep shows family-level direction is weak unless filtered by symbol/regime/window.",
      },
      {
        cause: "wrong_holding_window",
        evidence: "Many strong sweep lanes need 12h/24h; PerpSim exits often timed out or stopped before broad MFE capture.",
      },
      {
        cause: "wrong_symbol_concentration",
        evidence: `Closed PerpSim symbols were ${[...existingSymbols].join(", ") || "none"}, while many candidate lanes cluster elsewhere.`,
      },
      {
        cause: "exits_too_early_or_flat_target_logging",
        evidence: `${flat.length} closed rows were effectively flat; target rows in local artifacts include zero-PnL closes.`,
      },
      {
        cause: "mae_before_mfe_path_risk",
        evidence: `Stop exits averaged ${summarize(stopped).avg_mae_pct} MAE with positive MFE still present in some stopped trades.`,
      },
    ],
    by_symbol: groupBy(closed, (row) => row.symbol || "unknown"),
    by_exit_reason: groupBy(closed, (row) => row.reason || row.exit_reason || "unknown"),
    should_have_been_blocked_examples: [
      ...stopped.slice(0, 8).map((row) => ({
        symbol: row.symbol,
        reason: row.reason || row.exit_reason,
        realized_pnl_usd: num(row.realized_pnl_usd),
        mfe_pct: num(row.mfe_pct),
        mae_pct: num(row.mae_pct),
        blocker: "stop_exit_or_mae_path_risk",
      })),
      ...flat.slice(0, 8).map((row) => ({
        symbol: row.symbol,
        reason: row.reason || row.exit_reason,
        realized_pnl_usd: num(row.realized_pnl_usd),
        mfe_pct: num(row.mfe_pct),
        mae_pct: num(row.mae_pct),
        blocker: "flat_capture_or_target_logging",
      })),
    ].slice(0, 12),
    should_have_been_allowed_examples: winners.slice(0, 12).map((row) => ({
      symbol: row.symbol,
      reason: row.reason || row.exit_reason,
      realized_pnl_usd: num(row.realized_pnl_usd),
      mfe_pct: num(row.mfe_pct),
      mae_pct: num(row.mae_pct),
      read: "positive_closed_paper_outcome",
    })),
    missed_positive_lanes: missed,
  };

  const plan = {
    schema_version: "perps_v2_candidate_promotion_plan.v1",
    generated_at,
    ...SAFETY,
    auto_promote: false,
    approved_forward_paper_lanes_unchanged: true,
    classifications: {
      high_priority_forward_track: planRows.filter((row) => row.status === "high_priority_forward_track"),
      forward_track_candidate: planRows.filter((row) => row.status === "forward_track_candidate"),
      watch: planRows.filter((row) => row.status === "watch"),
      needs_more_sample: planRows.filter((row) => row.status === "needs_more_sample"),
      reject: planRows.filter((row) => row.status === "reject"),
    },
    current_forward_paper: {
      ranked_lane_table: forward.ranked_lane_table || [],
      monitoring_summary: forward.monitoring_summary || {},
    },
  };

  const md = [
    "# Perps v2 Edge Attribution",
    "",
    `Generated: ${generated_at}`,
    "",
    "Diagnostic research only. No live rules, no promotion, no execution changes.",
    "",
    "## Strongest Positive Predictors",
    table(edge.strongest_positive_predictors.slice(0, 12), [
      { key: "dimension", label: "Dimension" },
      { key: "value", label: "Value" },
      { key: "weighted_avg_net_pct", label: "Avg Net %" },
      { key: "candidate_group_rate", label: "Candidate Rate" },
    ]),
    "",
    "## Strongest Negative Predictors",
    table(edge.strongest_negative_predictors.slice(0, 12), [
      { key: "dimension", label: "Dimension" },
      { key: "value", label: "Value" },
      { key: "weighted_avg_net_pct", label: "Avg Net %" },
      { key: "candidate_group_rate", label: "Candidate Rate" },
    ]),
    "",
    "## High Priority Forward-Track Research Candidates",
    table(plan.classifications.high_priority_forward_track.slice(0, 20), [
      { key: "key", label: "Lane" },
      { key: "count", label: "Count" },
      { key: "avg_net_after_fees_slippage_pct", label: "Avg Net %" },
      { key: "profit_factor", label: "PF" },
      { key: "edge_score", label: "Edge Score" },
    ]),
    "",
    "## Flatness Diagnosis",
    table(flatness.top_causes_of_flatness, [
      { key: "cause", label: "Cause" },
      { key: "evidence", label: "Evidence" },
    ]),
    "",
    "No trade recommendations are generated.",
    "",
  ].join("\n");

  writeJson(EDGE_OUT, edge);
  writeJson(FLAT_OUT, flatness);
  writeJson(PLAN_OUT, plan);
  fs.writeFileSync(EDGE_MD, md);

  console.log(JSON.stringify({
    edge_report: path.relative(APP_ROOT, EDGE_OUT),
    edge_summary: path.relative(APP_ROOT, EDGE_MD),
    flatness_report: path.relative(APP_ROOT, FLAT_OUT),
    promotion_plan: path.relative(APP_ROOT, PLAN_OUT),
    high_priority_forward_track: plan.classifications.high_priority_forward_track.length,
    forward_track_candidate: plan.classifications.forward_track_candidate.length,
    watch: plan.classifications.watch.length,
    needs_more_sample: plan.classifications.needs_more_sample.length,
    reject: plan.classifications.reject.length,
  }, null, 2));
}

run();
