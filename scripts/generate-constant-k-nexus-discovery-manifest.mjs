#!/usr/bin/env node

import {
  chmodSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { createConstantKNexusDiscoveryCoverageManifest } from "../lib/customer_trade/constant_k_nexus_discovery_coverage.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanError(error) {
  return String(error?.code || error?.message || "constant_k_discovery_manifest_generation_failed")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 100);
}

function argumentsFrom(values) {
  const output = { output_path: null, generated_at: new Date().toISOString() };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--output") {
      const value = String(values[index + 1] || "").trim();
      if (!value || !isAbsolute(value) || value.includes("\u0000")) fail("constant_k_discovery_manifest_output_invalid");
      output.output_path = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--generated-at") {
      const value = String(values[index + 1] || "").trim();
      if (!Number.isFinite(Date.parse(value))) fail("constant_k_discovery_manifest_generated_at_invalid");
      output.generated_at = new Date(value).toISOString();
      index += 1;
      continue;
    }
    fail("constant_k_discovery_manifest_argument_invalid");
  }
  return Object.freeze(output);
}

function atomicWrite(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, payload, { mode: 0o640, flag: "w" });
  chmodSync(temporary, 0o640);
  renameSync(temporary, path);
}

export function generateConstantKNexusDiscoveryManifest(argumentsList = [], {
  stdout = process.stdout,
} = {}) {
  const settings = argumentsFrom(argumentsList);
  const manifest = createConstantKNexusDiscoveryCoverageManifest({ generated_at: settings.generated_at });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!settings.output_path) {
    stdout.write(serialized);
    return manifest;
  }
  atomicWrite(settings.output_path, serialized);
  stdout.write(`${JSON.stringify({
    ok: true,
    schema_version: manifest.schema_version,
    manifest_id: manifest.manifest_id,
    coverage_hash: manifest.coverage_hash,
    program_count: manifest.program_count,
    output_path: settings.output_path,
    provider_acknowledgement_created: false,
    live_configuration_changed: false,
  })}\n`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateConstantKNexusDiscoveryManifest(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: cleanError(error) })}\n`);
    process.exitCode = 1;
  }
}
