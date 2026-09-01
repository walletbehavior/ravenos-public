import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA } from "../lib/customer_trade/constant_k_nexus_discovery_coverage.mjs";

const SCRIPT = new URL("../scripts/generate-constant-k-nexus-discovery-manifest.mjs", import.meta.url);
const GENERATED = "2026-09-01T16:00:00.000Z";

test("manifest generator prints the full provider-neutral contract without changing live configuration", () => {
  const run = spawnSync(process.execPath, [SCRIPT.pathname, "--generated-at", GENERATED], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.schema_version, CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA);
  assert.equal(payload.provider, "constant_k");
  assert.equal(payload.filter_mode, "reviewed_swap_programs");
  assert.equal(payload.execution_boundary.live_copy, false);
  assert.equal(payload.execution_boundary.signing, false);
});

test("manifest generator writes one explicit atomic artifact and never fabricates provider acknowledgement", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-discovery-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "coverage-manifest.json");
  const run = spawnSync(process.execPath, [
    SCRIPT.pathname,
    "--generated-at", GENERATED,
    "--output", outputPath,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.manifest_id, manifest.manifest_id);
  assert.equal(summary.coverage_hash, manifest.coverage_hash);
  assert.equal(summary.provider_acknowledgement_created, false);
  assert.equal(summary.live_configuration_changed, false);
  assert.equal(statSync(outputPath).mode & 0o777, 0o640);
});

test("manifest generator rejects relative output paths and unknown arguments", () => {
  const relative = spawnSync(process.execPath, [SCRIPT.pathname, "--output", "coverage.json"], { encoding: "utf8" });
  assert.equal(relative.status, 1);
  assert.match(relative.stderr, /constant_k_discovery_manifest_output_invalid/);
  const unknown = spawnSync(process.execPath, [SCRIPT.pathname, "--activate"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /constant_k_discovery_manifest_argument_invalid/);
});
