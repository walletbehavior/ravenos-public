#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHyperliquidPerps } from "../lib/ravenos_perps_intelligence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.resolve(APP_ROOT, process.env.PERPS_V2_FORWARD_CONFIG_PATH || "data/runtime/perps_v2_forward_paper_config.json");
const REPORT_PATH = path.resolve(APP_ROOT, process.env.PERPS_V2_FORWARD_REPORT_PATH || "data/runtime/perps_v2_forward_paper_report.json");
const SUMMARY_PATH = path.resolve(APP_ROOT, process.env.PERPS_V2_FORWARD_SUMMARY_PATH || "data/runtime/perps_v2_forward_paper_summary.md");
const BACKTEST_PATH = path.resolve(APP_ROOT, process.env.RAVEN_PERPS_V2_BACKTEST_PATH || "data/runtime/raven_perps_intelligence_v2_backtest.json");
const INFO_URL = process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info";

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
const OUTCOME_WINDOWS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  return Number((value * 100).toFixed(4));
}

function readJson(file, fallback = {}) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return payload && typeof payload === "object" ? payload : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmp, file);
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

async function fetchLivePerps() {
  const raw = await postInfo({ type: "metaAndAssetCtxs" });
  const rows = normalizeHyperliquidPerps(raw, { now: new Date() });
  return new Map(rows.map((row) => [`${row.symbol}-PERP`, row]));
}

async function fetchCandles(coin, interval, startTime, endTime) {
  const raw = await postInfo({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } });
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

function parseLane(lane) {
  const [setup_family, direction, symbol] = String(lane || "").split(":");
  return { setup_family, direction, symbol };
}

function latestObservationAgeMs(observations, lane, nowMs) {
  const rows = observations.filter((row) => row.lane === lane);
  if (!rows.length) return Infinity;
  const latest = rows.reduce((max, row) => Math.max(max, Date.parse(row.timestamp) || 0), 0);
  return nowMs - latest;
}

function observationKey(lane, timestamp) {
  return `${lane}:${timestamp}`;
}

function hasPendingWindows(observation) {
  return Object.keys(OUTCOME_WINDOWS).some((windowName) => observation.outcomes?.[windowName]?.status !== "observed");
}

function hasOpenObservationForLane(observations, lane) {
  return observations.some((row) => row.lane === lane && row.status !== "blocked_missing_live_context" && hasPendingWindows(row));
}

function dedupeObservations(observations) {
  const seen = new Set();
  const out = [];
  for (const observation of observations) {
    const key = observation.observation_key || observationKey(observation.lane, observation.timestamp);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ observation_key: key, ...observation });
  }
  return out;
}

function liveSnapshotFor(row) {
  const replay = Array.isArray(row?.replayMatches) && row.replayMatches[0] ? row.replayMatches[0] : {};
  const liquidity = row?.liquidityAttraction || {};
  const conditions = row?.outcomeConditions || {};
  return {
    pressure_score: num(row?.pressureScore ?? row?.flowScore),
    replay_similarity: num(replay.similarity),
    liquidity_attraction: {
      score: num(liquidity.score),
      state: liquidity.state || "Unknown",
      nearest_cluster: num(liquidity.nearestCluster),
      distance_percent: num(liquidity.distancePercent),
      attraction_strength: num(liquidity.attractionStrength),
    },
    pressure_composition: Array.isArray(row?.pressureComposition) ? row.pressureComposition : [],
    supporting_conditions: Array.isArray(conditions.supporting) ? conditions.supporting : [],
    breaking_conditions: Array.isArray(conditions.breaking) ? conditions.breaking : [],
  };
}

function createObservation({ lane, config, liveRow, now }) {
  const parsed = parseLane(lane);
  const entry = num(liveRow?.markPx || liveRow?.lastPrice);
  return {
    ...SAFETY_FLAGS,
    observation_key: observationKey(lane, new Date(now).toISOString()),
    lane,
    setup_family: parsed.setup_family,
    direction: parsed.direction,
    symbol: parsed.symbol,
    interval: config.entry_interval || "1h",
    timestamp: new Date(now).toISOString(),
    entry_reference: entry,
    entry_source: liveRow ? "hyperliquid_mark" : "missing_live_row",
    status: liveRow ? "tracking_forward_outcomes" : "blocked_missing_live_context",
    blockers: liveRow ? ["insufficient_forward_sample_blocked"] : ["missing_live_context", "insufficient_forward_sample_blocked"],
    outcomes: {},
    mae_pct: null,
    mfe_pct: null,
    net_after_assumed_fees_slippage_pct: null,
    ...liveSnapshotFor(liveRow || {}),
  };
}

function outcomeForWindow(observation, candles, windowMs, feeSlippagePct) {
  const entryTs = Date.parse(observation.timestamp);
  const entry = num(observation.entry_reference);
  if (!entryTs || entry <= 0) return { status: "pending", reason: "missing_entry" };
  const cutoff = entryTs + windowMs;
  const now = Date.now();
  if (now < cutoff) {
    return { status: "pending", reason: "window_not_elapsed", available_at: new Date(cutoff).toISOString() };
  }
  const windowCandles = candles.filter((row) => row.time >= entryTs && row.time <= cutoff);
  if (!windowCandles.length) return { status: "pending", reason: "no_candles" };
  const last = windowCandles[windowCandles.length - 1];
  let mfe = 0;
  let mae = 0;
  for (const candle of windowCandles) {
    const favorable = observation.direction === "short" ? (entry / candle.low) - 1 : (candle.high / entry) - 1;
    const adverse = observation.direction === "short" ? (entry / candle.high) - 1 : (candle.low / entry) - 1;
    mfe = Math.max(mfe, favorable);
    mae = Math.min(mae, adverse);
  }
  const gross = observation.direction === "short" ? (entry / last.close) - 1 : (last.close / entry) - 1;
  const net = gross - feeSlippagePct;
  return {
    status: "observed",
    close_time: new Date(last.time).toISOString(),
    close_reference: last.close,
    gross_pct: pct(gross),
    net_after_assumed_fees_slippage_pct: pct(net),
    mfe_pct: pct(mfe),
    mae_pct: pct(mae),
  };
}

function aggregateObservation(observation) {
  const observed = Object.values(observation.outcomes || {}).filter((row) => row?.status === "observed");
  if (!observed.length) return observation;
  return {
    ...observation,
    mae_pct: Math.min(...observed.map((row) => num(row.mae_pct))),
    mfe_pct: Math.max(...observed.map((row) => num(row.mfe_pct))),
    net_after_assumed_fees_slippage_pct: num(observed[observed.length - 1].net_after_assumed_fees_slippage_pct),
  };
}

async function updateObservationOutcomes(observations, config) {
  const bySymbol = new Map();
  const fee = num(config.assumed_fee_slippage_pct, 0.0008);
  for (const observation of observations) {
    if (!observation.entry_reference || observation.status === "blocked_missing_live_context") continue;
    const missing = Object.keys(OUTCOME_WINDOWS).filter((windowName) => observation.outcomes?.[windowName]?.status !== "observed");
    if (!missing.length) continue;
    if (!bySymbol.has(observation.symbol)) {
      const start = (Date.parse(observation.timestamp) || Date.now()) - 15 * 60 * 1000;
      const end = Date.now();
      const coin = String(observation.symbol || "").replace(/-PERP$/, "");
      try {
        bySymbol.set(observation.symbol, await fetchCandles(coin, "15m", start, end));
        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch (error) {
        bySymbol.set(observation.symbol, []);
        observation.blockers = Array.from(new Set([...(observation.blockers || []), "provider_candle_fetch_failed"]));
        observation.provider_error = error instanceof Error ? error.message : String(error);
      }
    }
    const candles = bySymbol.get(observation.symbol) || [];
    observation.outcomes ||= {};
    for (const [windowName, windowMs] of Object.entries(OUTCOME_WINDOWS)) {
      if (observation.outcomes[windowName]?.status === "observed") continue;
      observation.outcomes[windowName] = outcomeForWindow(observation, candles, windowMs, fee);
    }
  }
  return observations.map(aggregateObservation);
}

function summaryStats(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { count: 0, avg: 0, wins: 0, losses: 0, profit_factor: 0 };
  const wins = clean.filter((value) => value > 0);
  const losses = clean.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    count: clean.length,
    avg: Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(4)),
    wins: wins.length,
    losses: losses.length,
    win_rate: Number((wins.length / clean.length).toFixed(4)),
    profit_factor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : grossWin > 0 ? 999 : 0,
  };
}

function buildTables(observations, config, backtest) {
  const lanes = config.validated_lanes || [];
  const minSamples = num(config.promotion_review_criteria?.minimum_forward_samples_per_lane, 50);
  const ranked_lane_table = lanes.map((lane) => {
    const rows = observations.filter((row) => row.lane === lane);
    const window12 = rows.map((row) => num(row.outcomes?.["12h"]?.net_after_assumed_fees_slippage_pct, NaN));
    const window4 = rows.map((row) => num(row.outcomes?.["4h"]?.net_after_assumed_fees_slippage_pct, NaN));
    const stats = summaryStats(window12.filter(Number.isFinite).length ? window12 : window4);
    const backtestLane = (backtest.consistent_lanes || []).find((row) => row.lane === lane) || {};
    const blockers = [];
    if (stats.count < minSamples) blockers.push("insufficient_forward_sample_blocked");
    if (stats.count && stats.avg <= 0) blockers.push("non_positive_forward_avg_net");
    if (stats.count && stats.profit_factor <= num(config.promotion_review_criteria?.profit_factor_min, 1.2)) blockers.push("profit_factor_below_future_review_threshold");
    return {
      lane,
      forward_samples: stats.count,
      avg_net_after_assumed_fees_slippage_pct: stats.avg,
      win_rate: stats.win_rate || 0,
      profit_factor: stats.profit_factor,
      backtest_avg_net_pct: num(backtestLane.avgNetReturnPct),
      backtest_profit_factor: num(backtestLane.profitFactor),
      blockers,
      recommendation: blockers.length ? "continue_diagnostics" : "future_review_candidate",
    };
  }).sort((a, b) => (b.forward_samples - a.forward_samples) || (b.backtest_profit_factor - a.backtest_profit_factor));

  const blocked_lane_table = [
    { lane: "broad_long_reclaim_lanes", blocker: "broad_long_reclaim_lanes_blocked", reason: "Broad long/reclaim lanes did not validate.", recommendation: "reject_for_now" },
    { lane: "broad_15m_lanes", blocker: "broad_15m_lanes_blocked", reason: "15m broad families did not validate.", recommendation: "reject_for_now" },
    { lane: "unvalidated_families", blocker: "unvalidated_family_blocked", reason: "Families outside the config are not eligible for v2 forward tracking.", recommendation: "reject_for_now" },
    ...ranked_lane_table.filter((row) => row.blockers.length).map((row) => ({
      lane: row.lane,
      blocker: row.blockers.join(","),
      reason: "Lane has not met future-review sample or quality thresholds.",
      recommendation: row.recommendation,
    })),
  ];

  const sample_sufficiency_table = ranked_lane_table.map((row) => ({
    lane: row.lane,
    forward_samples: row.forward_samples,
    required_forward_samples: minSamples,
    sufficient: row.forward_samples >= minSamples,
  }));

  return { ranked_lane_table, blocked_lane_table, sample_sufficiency_table };
}

function recommendationFor(tables) {
  const totalSamples = tables.sample_sufficiency_table.reduce((sum, row) => sum + row.forward_samples, 0);
  if (!totalSamples) return "continue";
  if (tables.ranked_lane_table.some((row) => row.forward_samples >= 10 && row.avg_net_after_assumed_fees_slippage_pct > 0 && row.profit_factor > 1.2)) return "expand diagnostics";
  return "continue";
}

function buildMonitoringSummary({ observations, previousObservations, newObservations, tables }) {
  const openObservations = observations.filter((row) => row.status !== "blocked_missing_live_context" && hasPendingWindows(row)).length;
  const blockedObservations = observations.filter((row) => (row.blockers || []).length || row.status === "blocked_missing_live_context").length;
  const previousByKey = new Map(previousObservations.map((row) => [row.observation_key || observationKey(row.lane, row.timestamp), row]));
  const matured = Object.fromEntries(Object.keys(OUTCOME_WINDOWS).map((windowName) => [`matured_${windowName}`, 0]));

  for (const observation of observations) {
    const key = observation.observation_key || observationKey(observation.lane, observation.timestamp);
    const previous = previousByKey.get(key);
    for (const windowName of Object.keys(OUTCOME_WINDOWS)) {
      const nowObserved = observation.outcomes?.[windowName]?.status === "observed";
      const wasObserved = previous?.outcomes?.[windowName]?.status === "observed";
      if (nowObserved && !wasObserved) matured[`matured_${windowName}`] += 1;
    }
  }

  const provisional = tables.ranked_lane_table
    .filter((row) => row.forward_samples > 0)
    .sort((a, b) => b.avg_net_after_assumed_fees_slippage_pct - a.avg_net_after_assumed_fees_slippage_pct);

  return {
    open_observations: openObservations,
    ...matured,
    new_observations: newObservations.length,
    blocked_observations: blockedObservations,
    insufficient_sample: tables.sample_sufficiency_table.filter((row) => !row.sufficient).length,
    pending_windows: observations.reduce((sum, row) => sum + Object.keys(OUTCOME_WINDOWS).filter((windowName) => row.outcomes?.[windowName]?.status !== "observed").length, 0),
    no_promotion_allowed: true,
    best_provisional_lanes: provisional.slice(0, 5),
    worst_provisional_lanes: provisional.slice(-5).reverse(),
  };
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((col) => col.label).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((col) => String(row[col.key] ?? "")).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

function writeSummary(report) {
  const ranked = report.ranked_lane_table.slice(0, 12);
  const blocked = report.blocked_lane_table.slice(0, 14);
  const samples = report.sample_sufficiency_table;
  const monitor = report.monitoring_summary || {};
  const md = [
    "# Perps v2 Forward Paper Summary",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "Safety: diagnostic/paper only. Live execution, promotion, sizing, caps, and mirrors are disabled.",
    "",
    `Recommendation: ${report.recommendation}`,
    "",
    "## Monitor Status",
    markdownTable([monitor], [
      { key: "open_observations", label: "Open" },
      { key: "matured_15m", label: "15m Matured" },
      { key: "matured_1h", label: "1h Matured" },
      { key: "matured_4h", label: "4h Matured" },
      { key: "matured_12h", label: "12h Matured" },
      { key: "new_observations", label: "New" },
      { key: "blocked_observations", label: "Blocked" },
      { key: "pending_windows", label: "Pending Windows" },
      { key: "no_promotion_allowed", label: "Promotion Disabled" },
    ]),
    "",
    "## Ranked Lane Table",
    markdownTable(ranked, [
      { key: "lane", label: "Lane" },
      { key: "forward_samples", label: "Samples" },
      { key: "avg_net_after_assumed_fees_slippage_pct", label: "Avg Net %" },
      { key: "profit_factor", label: "PF" },
      { key: "backtest_profit_factor", label: "Backtest PF" },
      { key: "recommendation", label: "Recommendation" },
    ]),
    "",
    "## Blocked Lane Table",
    markdownTable(blocked, [
      { key: "lane", label: "Lane" },
      { key: "blocker", label: "Blocker" },
      { key: "recommendation", label: "Recommendation" },
    ]),
    "",
    "## Sample Sufficiency",
    markdownTable(samples, [
      { key: "lane", label: "Lane" },
      { key: "forward_samples", label: "Samples" },
      { key: "required_forward_samples", label: "Required" },
      { key: "sufficient", label: "Sufficient" },
    ]),
    "",
    "No live trade recommendations are generated by this artifact.",
    "All lanes remain insufficient sample until they meet the configured future-review threshold.",
    "Pending windows are measurement state only and do not permit promotion.",
    "",
  ].join("\n");
  fs.writeFileSync(SUMMARY_PATH, md);
}

export async function buildPerpsV2ForwardPaperTracker({ write = true } = {}) {
  const config = readJson(CONFIG_PATH, {});
  const previous = readJson(REPORT_PATH, {});
  const backtest = readJson(BACKTEST_PATH, {});
  const now = Date.now();
  const minCreateIntervalMs = num(process.env.PERPS_V2_FORWARD_CREATE_INTERVAL_MIN, 60) * 60 * 1000;
  const previousObservations = dedupeObservations(Array.isArray(previous.observations) ? previous.observations : []);
  const observations = await updateObservationOutcomes(previousObservations, config);
  const liveRows = await fetchLivePerps();
  const newObservations = [];

  for (const lane of config.validated_lanes || []) {
    if (hasOpenObservationForLane(observations, lane)) continue;
    if (latestObservationAgeMs(observations, lane, now) < minCreateIntervalMs) continue;
    const parsed = parseLane(lane);
    const observation = createObservation({
      lane,
      config,
      liveRow: liveRows.get(parsed.symbol),
      now,
    });
    observations.push(observation);
    newObservations.push(observation);
  }

  const updatedObservations = dedupeObservations(observations);
  const tables = buildTables(updatedObservations, config, backtest);
  const monitoringSummary = buildMonitoringSummary({
    observations: updatedObservations,
    previousObservations,
    newObservations,
    tables,
  });
  const report = {
    schema_version: "perps_v2_forward_paper_report.v1",
    generated_at: new Date(now).toISOString(),
    provider: config.provider || "Hyperliquid",
    market: config.market || "perpetual_futures",
    ...SAFETY_FLAGS,
    config_path: path.relative(APP_ROOT, CONFIG_PATH),
    backtest_path: path.relative(APP_ROOT, BACKTEST_PATH),
    validated_lanes: config.validated_lanes || [],
    diagnostic_15m_symbol_lanes: config.diagnostic_15m_symbol_lanes || [],
    promotion_review_criteria: config.promotion_review_criteria || {},
    blockers: config.blockers || [],
    observations: updatedObservations,
    ...tables,
    monitoring_summary: monitoringSummary,
    recommendation: recommendationFor(tables),
  };

  if (write) {
    writeJson(REPORT_PATH, report);
    writeSummary(report);
  }
  return report;
}

async function main() {
  const report = await buildPerpsV2ForwardPaperTracker({ write: true });
  console.log(JSON.stringify({
    report: path.relative(APP_ROOT, REPORT_PATH),
    summary: path.relative(APP_ROOT, SUMMARY_PATH),
    generated_at: report.generated_at,
    observations: report.observations.length,
    open_observations: report.monitoring_summary.open_observations,
    matured_15m: report.monitoring_summary.matured_15m,
    matured_1h: report.monitoring_summary.matured_1h,
    matured_4h: report.monitoring_summary.matured_4h,
    matured_12h: report.monitoring_summary.matured_12h,
    new_observations: report.monitoring_summary.new_observations,
    blocked_observations: report.monitoring_summary.blocked_observations,
    insufficient_sample: report.monitoring_summary.insufficient_sample,
    pending_windows: report.monitoring_summary.pending_windows,
    no_promotion_allowed: report.monitoring_summary.no_promotion_allowed,
    best_provisional_lanes: report.monitoring_summary.best_provisional_lanes,
    worst_provisional_lanes: report.monitoring_summary.worst_provisional_lanes,
    recommendation: report.recommendation,
    ranked_lane_table: report.ranked_lane_table,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
