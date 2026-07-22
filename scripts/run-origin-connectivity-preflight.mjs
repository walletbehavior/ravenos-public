import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_WORKER = "ravenos-public";
const PRODUCTION_BASE = "https://ravenos.xyz";
const RESTORED_ORIGIN_BASE = "https://ravenos-public-origin.ravenos.xyz/public/ravenos";
const DENIED_ORIGIN_BASE = "https://ravenos-public-origin.ravenos.xyz/public/ravenos-denied";
const secret = String(process.env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "");
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "");
const accountId = String(process.env.CLOUDFLARE_API_ACCOUNT_ID || "");

if (!process.version.startsWith("v22.")) throw new Error(`Node 22 is required; found ${process.version}`);
if (!secret) throw new Error("RAVENOS_PUBLIC_ORIGIN_TOKEN is not present in the server environment");
if (!apiToken || !accountId) throw new Error("Cloudflare deployment credentials are not present in the server environment");

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? resolve(args[outputIndex + 1]) : null;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetManifest = JSON.parse(readFileSync(join(repoRoot, ".deploy-public/ravenos_asset_manifest.json"), "utf8"));
const preflightAssetUrls = ["ravenos-route-app.js", "ravenos-shell.css"].map((logicalPath) => {
  const url = assetManifest?.assets?.[logicalPath]?.url;
  if (!url || !/^\/assets\/[A-Za-z0-9._-]+\.[0-9a-f]{16}\.(?:js|css)$/.test(url)) {
    throw new Error(`Immutable preflight asset is absent or malformed: ${logicalPath}`);
  }
  return url;
});
const require = createRequire(import.meta.url);
const wranglerRoot = dirname(require.resolve("wrangler/package.json"));
const wranglerBin = join(wranglerRoot, "bin", "wrangler.js");
const nonce = Date.now().toString(36).slice(-8);
const stagingWorker = `ravenos-origin-preflight-${nonce}`;
const routePrefix = `/__ravenos_origin_preflight_${nonce}`;
const routePattern = `ravenos.xyz${routePrefix}/*`;
const tempRoot = mkdtempSync(join(tmpdir(), "ravenos-origin-preflight-"));
chmodSync(tempRoot, 0o700);
const tempConfig = join(tempRoot, "wrangler.json");
const tempSecrets = join(tempRoot, "secrets.json");

function redact(value) {
  return String(value || "")
    .split(secret).join("[REDACTED_ORIGIN_TOKEN]")
    .split(apiToken).join("[REDACTED_CLOUDFLARE_TOKEN]");
}

function runWrangler(wranglerArgs) {
  const result = spawnSync(process.execPath, [wranglerBin, ...wranglerArgs], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = redact(result.stdout);
  const stderr = redact(result.stderr);
  if (result.status !== 0) {
    throw new Error(`wrangler ${wranglerArgs.slice(0, 2).join(" ")} failed (${result.status}): ${stderr || stdout}`);
  }
  return { stdout, stderr };
}

function productionStatus() {
  const { stdout } = runWrangler(["deployments", "status", "--name", PRODUCTION_WORKER, "--json"]);
  return JSON.parse(stdout);
}

async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Cloudflare API ${init.method || "GET"} ${path} failed (${response.status})`);
  }
  return payload.result;
}

async function zoneIdentity() {
  const zones = await cloudflare(`/zones?name=${encodeURIComponent("ravenos.xyz")}&account.id=${encodeURIComponent(accountId)}`);
  const zone = Array.isArray(zones) ? zones.find((row) => row.name === "ravenos.xyz") : null;
  if (!zone?.id) throw new Error("Unable to resolve the ravenos.xyz zone");
  return { id: zone.id, name: zone.name };
}

async function zoneRoutes(zoneId) {
  const routes = await cloudflare(`/zones/${zoneId}/workers/routes`);
  return (routes || []).map((row) => ({ id: row.id, pattern: row.pattern, script: row.script || null }));
}

function writeStagingConfig(originBase) {
  const config = {
    name: stagingWorker,
    main: resolve(repoRoot, "scripts/preflight-worker.mjs"),
    compatibility_date: "2026-06-23",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: false },
    assets: {
      binding: "ASSETS",
      directory: resolve(repoRoot, ".deploy-public"),
      run_worker_first: true,
    },
    routes: [{ pattern: routePattern, zone_name: "ravenos.xyz" }],
    vars: {
      RAVENOS_PREFLIGHT_ROUTE_PREFIX: routePrefix,
      RAVENOS_PUBLIC_ORIGIN_URL: originBase,
    },
  };
  writeFileSync(tempConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function deployStaging(originBase, message) {
  writeStagingConfig(originBase);
  const { stdout, stderr } = runWrangler([
    "deploy",
    "--config",
    tempConfig,
    "--secrets-file",
    tempSecrets,
    "--keep-vars",
    "--message",
    message,
  ]);
  const output = `${stdout}\n${stderr}`;
  const versionId = output.match(/Worker Version ID:\s*([0-9a-f-]{36})/i)?.[1]
    || output.match(/Version ID:\s*([0-9a-f-]{36})/i)?.[1]
    || null;
  return {
    worker: stagingWorker,
    version_id: versionId,
    route_pattern: routePattern,
    origin_mode: originBase === RESTORED_ORIGIN_BASE ? "restored_exact_allowlist" : "denied_outside_allowlist",
    bindings: [
      { name: "ASSETS", type: "assets" },
      { name: "RAVENOS_PREFLIGHT_ROUTE_PREFIX", type: "plain_text" },
      { name: "RAVENOS_PUBLIC_ORIGIN_URL", type: "plain_text" },
      { name: "RAVENOS_PUBLIC_ORIGIN_TOKEN", type: "secret_text" },
    ],
  };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function capture(path, { staging = false } = {}) {
  const requestPath = staging ? `${routePrefix}${path}` : path;
  const response = await fetch(new URL(requestPath, PRODUCTION_BASE), {
    headers: {
      accept: path.startsWith("/api/") ? "application/json" : "*/*",
      "cache-control": "no-cache",
      "user-agent": "RavenOS-Cloudflare-Preflight/1.0",
      "x-ravenos-preflight": nonce,
    },
    redirect: "error",
  });
  const text = await response.text();
  const headers = Object.fromEntries(response.headers.entries());
  const capturedText = JSON.stringify({ headers, text });
  if (capturedText.includes(secret)) throw new Error(`origin token leaked through ${path}`);
  if (capturedText.includes(apiToken)) throw new Error(`Cloudflare token leaked through ${path}`);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    path,
    request_path: requestPath,
    status: response.status,
    headers,
    bytes: Buffer.byteLength(text),
    body_sha256: sha256(text),
    json,
    secret_scan: "pass",
  };
}

async function captureUntilValid(path, validator, { attempts = 45, onAttempt = null } = {}) {
  let lastCapture = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastCapture = await capture(path, { staging: true });
    if (onAttempt) onAttempt(lastCapture, attempt);
    try {
      return { capture: lastCapture, check: validator(lastCapture) };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
    }
  }
  const detail = lastCapture ? ` last_status=${lastCapture.status} last_sha256=${lastCapture.body_sha256}` : "";
  throw new Error(`${lastError?.message || "staging validation failed"}${detail}`);
}

function summarizeCapture(captured) {
  return {
    path: captured.path,
    request_path: captured.request_path,
    status: captured.status,
    headers: captured.headers,
    bytes: captured.bytes,
    body_sha256: captured.body_sha256,
    secret_scan: captured.secret_scan,
  };
}

function validateDenied(captured) {
  const body = captured.json;
  if (
    captured.status !== 503
    || body?.error !== "opportunity_census_projection_unavailable"
    || body?.census !== null
    || body?.current_opportunity !== null
    || body?.selected_opportunity !== null
    || body?.delivery?.source !== "unavailable"
    || body?.historical_context?.current_data_substituted !== false
  ) throw new Error("Denied-origin staging route did not return the strict 503 unavailable contract");
  return {
    status: captured.status,
    error: body.error,
    delivery_source: body.delivery.source,
    freshness_state: body.delivery.freshness_state,
    rejection_reason: body.rejection_reason,
    rejected_source: body.delivery.rejected_source,
    current_data_substituted: body.historical_context.current_data_substituted,
  };
}

function validateOpportunity(captured) {
  const body = captured.json;
  const generatedMs = Date.parse(body?.generated_at || "");
  const ageSeconds = Number.isFinite(generatedMs) ? Math.max(0, Math.floor((Date.now() - generatedMs) / 1_000)) : null;
  if (
    captured.status !== 200
    || body?.ok !== true
    || body?.source_artifact !== "raven_opportunity_projection"
    || body?.census?.schema_version !== "ravenos_opportunity_census_public_v1"
    || body?.census?.source_state !== "current"
    || body?.delivery?.source !== "current_public_origin"
    || body?.delivery?.freshness_state !== "fresh"
    || body?.delivery?.fallback !== false
    || ageSeconds === null
    || ageSeconds > 3_600
  ) throw new Error("Restored-origin staging route did not return a fresh current Opportunity Census contract");
  return {
    status: captured.status,
    source_artifact: body.source_artifact,
    census_schema: body.census.schema_version,
    source_state: body.census.source_state,
    generated_at: body.generated_at,
    age_seconds: ageSeconds,
    delivery_source: body.delivery.source,
    freshness_state: body.delivery.freshness_state,
    fallback: body.delivery.fallback,
    selected_instrument_state: body.selection?.state || null,
    row_count: Array.isArray(body.census?.opportunities?.rows) ? body.census.opportunities.rows.length : null,
  };
}

function validateHealth(captured) {
  const body = captured.json;
  if (
    captured.status !== 200
    || body?.process_health?.state !== "operational"
    || body?.intelligence_freshness?.state !== "fresh"
    || body?.projection_health?.state !== "operational"
  ) throw new Error("Staging health did not report operational projection and fresh intelligence");
  return {
    status: captured.status,
    overall: body.status,
    process: body.process_health.state,
    market_data: body.market_data_health?.state || null,
    intelligence: body.intelligence_freshness.state,
    narrator: body.narrator_freshness?.state || null,
    projection: body.projection_health.state,
    publisher: body.publisher_health?.state || null,
  };
}

function healthObservation(captured) {
  const body = captured?.json || {};
  return {
    status: captured?.status ?? null,
    overall: body.status || null,
    process: body.process_health?.state || null,
    market_data: body.market_data_health?.state || null,
    intelligence: body.intelligence_freshness?.state || null,
    research: body.intelligence_freshness?.research?.state || null,
    narrator: body.narrator_freshness?.state || null,
    projection: body.projection_health?.state || null,
    publisher: body.publisher_health?.state || null,
    projection_reason: body.projection_health?.reason || null,
    intelligence_endpoints: body.intelligence_freshness?.core_endpoints || null,
    capture: summarizeCapture(captured),
  };
}

function opportunityObservation(captured) {
  const body = captured?.json || {};
  return {
    status: captured?.status ?? null,
    error: body.error || null,
    rejection_reason: body.rejection_reason || null,
    delivery_source: body.delivery?.source || null,
    rejected_source: body.delivery?.rejected_source || null,
    rejected_freshness_state: body.delivery?.rejected_freshness_state || null,
    delivery_reason: body.delivery?.reason || null,
    capture: summarizeCapture(captured),
  };
}

const report = {
  schema_version: "ravenos.origin_connectivity_preflight.v3",
  started_at: new Date().toISOString(),
  production_worker: PRODUCTION_WORKER,
  staging_worker: stagingWorker,
  staging_route: routePattern,
  mechanism: "ephemeral_exact_zone_route",
  production_traffic_shifted: false,
  secret_values_recorded: false,
};
let failed = null;
let zone = null;
let routesBefore = null;

writeFileSync(tempSecrets, `${JSON.stringify({ RAVENOS_PUBLIC_ORIGIN_TOKEN: secret })}\n`, { mode: 0o600 });

try {
  report.production_before = productionStatus();
  const baselineAsset = await capture("/ravenos_build.json");
  if (baselineAsset.status !== 200 || !baselineAsset.json?.public_build_id) {
    throw new Error("Unable to capture the stable production build identity");
  }
  report.stable_build = {
    public_build_id: baselineAsset.json.public_build_id,
    body_sha256: baselineAsset.body_sha256,
  };
  zone = await zoneIdentity();
  routesBefore = await zoneRoutes(zone.id);
  report.zone_routes_before = routesBefore;
  if (routesBefore.some((route) => route.pattern === routePattern || route.script === stagingWorker)) {
    throw new Error("The unique staging route or Worker already exists");
  }

  report.denied_deployment = deployStaging(
    DENIED_ORIGIN_BASE,
    "RavenOS staging preflight: intentional exact-route denial",
  );
  const routesDuringDenied = await zoneRoutes(zone.id);
  const stagingRoute = routesDuringDenied.find((route) => route.pattern === routePattern && route.script === stagingWorker);
  if (!stagingRoute) throw new Error("Wrangler did not install the exact staging route");
  report.staging_route_id = stagingRoute.id;
  const denied = await captureUntilValid("/api/opportunity", validateDenied);
  report.denied_capture = summarizeCapture(denied.capture);
  report.denied_check = denied.check;
  const deniedDiagnostic = await capture("/__origin_diagnostic", { staging: true });
  report.denied_origin_diagnostic = {
    capture: summarizeCapture(deniedDiagnostic),
    result: deniedDiagnostic.json,
  };

  report.restored_deployment = deployStaging(
    RESTORED_ORIGIN_BASE,
    "RavenOS staging preflight: exact protected route restored",
  );
  const restoredDiagnostic = await captureUntilValid("/__origin_diagnostic", (captured) => {
    if (captured.status !== 200 || captured.json?.status !== 200 || captured.json?.ok !== true) {
      throw new Error("Restored staging Worker could not reach the protected origin");
    }
    return captured.json;
  }, {
    attempts: 12,
    onAttempt(captured, attempt) {
      report.last_restored_origin_diagnostic = {
        attempt,
        capture: summarizeCapture(captured),
        result: captured.json,
      };
    },
  });
  report.restored_origin_diagnostic = restoredDiagnostic.check;
  const opportunity = await captureUntilValid("/api/opportunity?instrument=BTC-PERP", validateOpportunity, {
    onAttempt(captured, attempt) {
      report.last_opportunity_attempt = { attempt, ...opportunityObservation(captured) };
    },
  });
  report.opportunity_capture = summarizeCapture(opportunity.capture);
  report.opportunity_check = opportunity.check;
  const health = await captureUntilValid("/api/health", validateHealth, {
    onAttempt(captured, attempt) {
      report.last_health_attempt = { attempt, ...healthObservation(captured) };
    },
  });
  report.restored_captures = [summarizeCapture(health.capture), summarizeCapture(opportunity.capture)];
  report.health_check = health.check;

  const assetPaths = ["/", ...preflightAssetUrls, "/ravenos_build.json"];
  const assets = [];
  for (const path of assetPaths) assets.push(await capture(path, { staging: true }));
  if (assets.some((item) => item.status !== 200 || item.secret_scan !== "pass")) {
    throw new Error("A staging asset failed availability or secret scanning");
  }
  report.asset_scans = assets.map(summarizeCapture);
  report.no_leak = {
    response_count: 2 + assets.length,
    origin_token_absent: true,
    cloudflare_token_absent: true,
  };
} catch (error) {
  failed = redact(error?.stack || error?.message || String(error));
  report.failure = failed;
} finally {
  try {
    if (zone) {
      const routes = await zoneRoutes(zone.id);
      const stagingRoutes = routes.filter((route) => route.pattern === routePattern || route.script === stagingWorker);
      report.staging_routes_before_cleanup = stagingRoutes;
      for (const route of stagingRoutes) {
        await cloudflare(`/zones/${zone.id}/workers/routes/${route.id}`, { method: "DELETE" });
      }
      try {
        await cloudflare(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(stagingWorker)}`, { method: "DELETE" });
        report.staging_worker_deleted = true;
      } catch (error) {
        if (!String(error?.message || "").includes("(404)")) throw error;
        report.staging_worker_deleted = true;
      }
      const routesAfter = await zoneRoutes(zone.id);
      report.zone_routes_after = routesAfter;
      report.zone_routes_restored = JSON.stringify(routesAfter) === JSON.stringify(routesBefore);
      if (!report.zone_routes_restored) throw new Error("Zone route set was not restored exactly after staging preflight");
    }
  } catch (error) {
    failed = failed || redact(error?.stack || error?.message || String(error));
    report.failure = failed;
  }
  try {
    report.production_after = productionStatus();
    report.production_unchanged = JSON.stringify(report.production_before) === JSON.stringify(report.production_after);
    if (!report.production_unchanged) {
      failed = failed || "Production Worker deployment changed during staging preflight";
      report.failure = failed;
    }
  } catch (error) {
    failed = failed || redact(error?.stack || error?.message || String(error));
    report.failure = failed;
  }
  rmSync(tempRoot, { recursive: true, force: true });
  report.temporary_secret_file_removed = true;
  report.completed_at = new Date().toISOString();
  report.ok = !failed && report.production_unchanged === true && report.zone_routes_restored === true;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
}

if (!report.ok) process.exit(1);
