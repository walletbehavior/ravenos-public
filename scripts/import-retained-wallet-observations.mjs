#!/usr/bin/env node
// Reuse retained public stream evidence through the existing discovery ledger.
// No RPC, history hydration, copy enrollment, or financial execution occurs here.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";
import { discoverConstantKNexusWalletCandidates } from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";
import { createSourceWalletDiscoveryBatch } from "../lib/customer_trade/source_wallet_discovery_ingress_protocol.mjs";
import { createD1SourceWalletDiscoveryStore } from "../lib/customer_trade/source_wallet_discovery_admission.mjs";

export function prepareRetainedWalletImport(events) {
  const discovery = discoverConstantKNexusWalletCandidates({ events });
  const digest = createHash("sha256").update(JSON.stringify(discovery.observations)).digest("hex");
  // Stable archive time makes rerunning the same import a receipt replay.
  const sentAt = discovery.observations.map(row => row.provider_observed_at).sort().at(-1);
  const batches = [];
  for (let i = 0; i < discovery.observations.length; i += 50) {
    batches.push(createSourceWalletDiscoveryBatch({ observations: discovery.observations.slice(i, i + 50),
      sent_at: sentAt, receiver_checkpoint_reference: `ckr_${digest}` }));
  }
  return { source_sha256: digest, counts: discovery.counts, batches,
    boundary: { provider_requests: 0, history_hydration: false, performance_claimed: false, copyability_claimed: false, execution: false } };
}

export function remoteDiscoveryDb({ api, accountId, databaseId }) {
  const path = `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  return { prepare(sql) {
    const statement = (params = []) => {
      const execute = async () => {
        const result = await api(path, { method: "POST", body: JSON.stringify({ sql, params }) });
        if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true) throw new Error("retained_import_query_failed");
        return result[0];
      };
      return { bind: (...values) => statement(values), run: execute, all: execute,
        first: async () => (await execute()).results?.[0] || null };
    };
    return statement();
  } };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args.slice(1).some(value => value !== "--apply")) throw new Error("usage_import_retained_wallet_observations_input_jsonl_optional_apply");
  const input = resolve(args[0]);
  if (statSync(input).size > 16 * 1024 * 1024) throw new Error("retained_import_input_exceeds_16mb");
  const events = readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const prepared = prepareRetainedWalletImport(events);
  const receipts = [];
  if (args.includes("--apply")) {
    const root = resolve(new URL("..", import.meta.url).pathname);
    const env = cloudflareReleaseEnv(root);
    const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
    const database = config.d1_databases.find(row => row.binding === "RAVENOS_CUSTOMER_DB");
    if (!database?.database_id) throw new Error("retained_import_database_missing");
    const api = async (path, init = {}) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init,
        signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" } });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(`retained_import_cloudflare_${response.status}`);
      return body.result;
    };
    // Importing observations must not unexpectedly start a paid hydration sweep.
    const settings = await api(`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(config.name)}/settings`);
    const bindings = settings?.bindings || [];
    if (bindings.some(row => row.name === "RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED" && row.text === "1")) {
      throw new Error("retained_import_requires_discovery_hydration_disabled");
    }
    const store = createD1SourceWalletDiscoveryStore(remoteDiscoveryDb({ api, accountId: env.CLOUDFLARE_ACCOUNT_ID, databaseId: database.database_id }));
    for (const batch of prepared.batches) {
      receipts.push(await store.ingestBatch(batch, {
        body_sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex"), key_id: "operator_retained_archive_v1" }));
    }
  }
  const report = { source_sha256: prepared.source_sha256, counts: prepared.counts, boundary: prepared.boundary,
    applied: args.includes("--apply"), receipts };
  writeFileSync(`${input}.import-report.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error.message || "retained_import_failed").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 120)); process.exitCode = 1; });
}
