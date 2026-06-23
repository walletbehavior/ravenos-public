#!/usr/bin/env node
import { buildPerpsV2ForwardPaperTracker } from "./perps_v2_forward_paper_tracker.mjs";

const intervalMs = Math.max(60_000, Number(process.env.PERPS_V2_FORWARD_PAPER_INTERVAL_SEC || "900") * 1000);

function compact(report) {
  return {
    generated_at: report.generated_at,
    observations: report.observations?.length || 0,
    open_observations: report.monitoring_summary?.open_observations || 0,
    matured_15m: report.monitoring_summary?.matured_15m || 0,
    matured_1h: report.monitoring_summary?.matured_1h || 0,
    matured_4h: report.monitoring_summary?.matured_4h || 0,
    matured_12h: report.monitoring_summary?.matured_12h || 0,
    new_observations: report.monitoring_summary?.new_observations || 0,
    blocked_observations: report.monitoring_summary?.blocked_observations || 0,
    no_promotion_allowed: report.monitoring_summary?.no_promotion_allowed === true,
    recommendation: report.recommendation,
  };
}

async function runOnce() {
  const report = await buildPerpsV2ForwardPaperTracker({ write: true });
  console.log(JSON.stringify(compact(report)));
}

async function main() {
  console.log(JSON.stringify({
    event: "perps_v2_forward_paper_sidecar_start",
    interval_sec: Math.round(intervalMs / 1000),
    diagnostic_only: true,
    paper_only: true,
    affects_live: false,
    live_execution_enabled: false,
    promotion_allowed: false,
  }));
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error(JSON.stringify({
        event: "perps_v2_forward_paper_sidecar_error",
        error: error instanceof Error ? error.message : String(error),
        diagnostic_only: true,
        paper_only: true,
        affects_live: false,
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main();
