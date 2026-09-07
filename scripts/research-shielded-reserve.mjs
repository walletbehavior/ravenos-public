import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { agenticContractHash } from "../lib/agentic_trading/hashing.mjs";
import { SHIELDED_FLAGS, createShieldedIntent } from "../lib/customer_trade/shielded_reserve.mjs";
import { NearIntentsShieldedProvider, amountForUsd, resolveShieldedAsset } from "../lib/customer_trade/shielded_route_providers.mjs";

export const MATRIX_SIZES_USD = [25, 100, 500, 1000, 5000, 10000, 50000];
export const MATRIX_DEPLOY = ["solana_usdc", "solana_sol", "base_usdc", "base_eth", "robinhood_usdc", "arbitrum_usdc", "ethereum_usdc", "avalanche_usdc", "hyperliquid_usdc"];
export const MATRIX_RETURN = ["solana_usdc", "base_usdc", "robinhood_usdc", "arbitrum_usdc", "ethereum_usdc"];

export function appendResearchRecord(path, row) {
  let previous = null;
  if (existsSync(path)) {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const { record_hash, ...core } = JSON.parse(line);
      if (core.previous_hash !== previous || agenticContractHash(core) !== record_hash) throw new Error("research_journal_integrity_invalid");
      previous = record_hash;
    }
  }
  const core = { ...row, previous_hash: previous };
  const record = { ...core, record_hash: agenticContractHash(core) };
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

export function summarizeMatrix(rows) {
  const median = values => {
    const sorted = values.map(BigInt).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2n).toString();
  };
  const summarize = selected => {
    const good = selected.filter(r => r.result.available);
    return { requested: selected.length, quoted: good.length,
      failures: Object.fromEntries([...new Set(selected.filter(r => !r.result.available).map(r => r.result.reason))].map(reason => [reason, selected.filter(r => r.result.reason === reason).length])),
      median_friction_ppm: median(good.map(r => r.result.all_in_marked_friction_ppm)),
      median_quote_latency_ms: median(good.map(r => r.result.quote_latency_ms)),
      median_estimated_settlement_seconds: median(good.map(r => r.result.estimated_settlement_seconds)) };
  };
  const routes = [...new Set(rows.map(r => r.route))];
  return { measured_at: new Date().toISOString(), ...summarize(rows), routes: Object.fromEntries(routes.map(route => [route, summarize(rows.filter(r => r.route === route))])),
    note: "Requested includes explicit unsupported paths. Quote estimates are not settlement observations. Negative marked friction is possible from pricing differences; it is not guaranteed profit." };
}

export async function runShieldedMatrix(outputDirectory) {
  const output = resolve(outputDirectory); mkdirSync(output, { recursive: true });
  const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0,8)}`;
  const env = Object.fromEntries(SHIELDED_FLAGS.map(k => [k, "1"]));
  const provider = new NearIntentsShieldedProvider({ env });
  const catalog = await provider.tokens();
  writeFileSync(join(output, `${runId}-catalog.json`), JSON.stringify({ run_id: runId, observed_at: new Date().toISOString(), catalog }, null, 2), { flag: "wx", mode: 0o600 });
  const journal = join(output, "routes.jsonl"), rows = [];
  const quote = async (action, source, destination, size, amountOverride, purpose = "matrix") => {
    const asset = resolveShieldedAsset(catalog, action === "SHIELDED_SEND" ? destination : source);
    let result;
    if (!asset || !resolveShieldedAsset(catalog, destination)) result = { available: false, provider: provider.id, reason: "unsupported_chain_or_asset", actual_provider_request: false };
    else {
      const intent = createShieldedIntent({ action, source, destination,
        amount_atomic: amountOverride || amountForUsd(asset, (BigInt(size) * 1000000n).toString()),
        maximum_delay_seconds: 86400, maximum_friction_bps: 10000,
        expires_at: new Date(Date.now() + 3_600_000).toISOString() });
      result = { ...await provider.quote(intent, catalog), actual_provider_request: true };
    }
    const row = appendResearchRecord(journal, { run_id: runId, observed_at: new Date().toISOString(), purpose, route: `${source}->${destination}`, requested_usd: String(size), action, result });
    rows.push(row);
    process.stdout.write(`${rows.length} ${row.route} $${size} ${result.available ? "quoted" : result.reason}\n`);
    return result;
  };
  const jobs = [];
  for (const size of MATRIX_SIZES_USD) {
    for (const destination of MATRIX_DEPLOY) jobs.push(() => quote("SHIELDED_DEPLOY", "zec", destination, size));
    for (const source of MATRIX_RETURN) jobs.push(() => quote("SHIELDED_RETURN", source, "zec", size));
  }
  let cursor = 0;
  await Promise.all([0, 1].map(async () => { while (cursor < jobs.length) await jobs[cursor++](); }));
  const comparisons = [];
  for (const size of MATRIX_SIZES_USD) {
    const direct = await quote("STANDARD_COMPARE", "base_usdc", "solana_usdc", size, null, "comparison_standard");
    const intoZec = await quote("SHIELDED_RETURN", "base_usdc", "zec", size, null, "comparison_leg_1");
    const outOfZec = intoZec.available ? await quote("SHIELDED_DEPLOY", "zec", "solana_usdc", size, intoZec.amount_out_atomic, "comparison_leg_2") : null;
    const valid = direct.available && intoZec.available && outOfZec?.available;
    const comparison = { run_id: runId, requested_usd: String(size), direct, into_zec: intoZec, out_of_zec: outOfZec,
      comparable: !!valid,
      two_leg_friction_ppm: valid ? ((BigInt(intoZec.input_usd_micros) - BigInt(outOfZec.output_usd_micros)) * 1000000n / BigInt(intoZec.input_usd_micros)).toString() : null,
      two_leg_provider_estimate_seconds: valid ? intoZec.estimated_settlement_seconds + outOfZec.estimated_settlement_seconds : null,
      additional_incoming_spendability_policy_seconds: 750,
      caveats: ["Sequential independent quotes; not an atomic route or executable reservation.", "Second leg uses first leg expected output, not guaranteed minimum.", "External shielded wallet receipt/spend and confirmation wait not executed.", "Zcash incoming spendability can add about 10 blocks; check current wallet policy.", "Correlated amounts and timing remain; no unlinkability proof."] };
    appendResearchRecord(join(output, "comparisons.jsonl"), comparison); comparisons.push(comparison);
  }
  for (const destination of ["solana_usdc", "base_usdc"]) await quote("SHIELDED_SEND", "zec", destination, 500, null, "send_exact_output");
  const summary = { run_id: runId, ...summarizeMatrix(rows), comparisons: comparisons.map(({ direct, into_zec, out_of_zec, ...rest }) => rest) };
  writeFileSync(join(output, `${runId}-summary.json`), JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
  return { output, run_id: runId, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Usage: node scripts/research-shielded-reserve.mjs <private-output-directory>");
  const result = await runShieldedMatrix(destination);
  process.stdout.write(JSON.stringify({ output: result.output, run_id: result.run_id, requested: result.summary.requested, quoted: result.summary.quoted }) + "\n");
}
