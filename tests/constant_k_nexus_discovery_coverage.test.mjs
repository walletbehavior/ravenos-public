import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA,
  CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA,
  ConstantKNexusDiscoveryCoverageContract,
  createConstantKNexusDiscoveryCoverageAcknowledgement,
  createConstantKNexusDiscoveryCoverageManifest,
  normalizeConstantKNexusDiscoveryCoverageAcknowledgement,
  normalizeConstantKNexusDiscoveryCoverageManifest,
} from "../lib/customer_trade/constant_k_nexus_discovery_coverage.mjs";
import { SOLANA_SWAP_PROGRAM_REGISTRY } from "../lib/customer_trade/solana_program_registry.mjs";

const GENERATED = "2026-09-01T16:00:00.000Z";
const ACTIVATED = "2026-09-01T15:58:00.000Z";
const VERIFIED = "2026-09-01T16:00:00.000Z";
const EXPIRES = "2026-09-01T16:10:00.000Z";

function manifest() {
  return createConstantKNexusDiscoveryCoverageManifest({ generated_at: GENERATED });
}

function acknowledgement(inputManifest = manifest(), overrides = {}) {
  return {
    ...createConstantKNexusDiscoveryCoverageAcknowledgement({
      manifest: inputManifest,
      activated_at: ACTIVATED,
      verified_at: VERIFIED,
      expires_at: EXPIRES,
    }),
    ...overrides,
  };
}

test("reviewed-program discovery manifest is deterministic and exact", () => {
  const first = manifest();
  const later = createConstantKNexusDiscoveryCoverageManifest({ generated_at: "2026-09-01T16:01:00.000Z" });
  assert.equal(first.schema_version, CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA);
  assert.equal(first.coverage_hash, later.coverage_hash);
  assert.equal(first.manifest_id, later.manifest_id);
  assert.equal(first.program_count, SOLANA_SWAP_PROGRAM_REGISTRY.length);
  assert.deepEqual(
    new Set(first.transaction_filter.account_include),
    new Set(SOLANA_SWAP_PROGRAM_REGISTRY.map((row) => row.program_id)),
  );
  assert.equal(first.transaction_filter.account_include_match, "any");
  assert.equal(first.transaction_filter.vote, false);
  assert.equal(first.transaction_filter.failed, false);
  assert.equal(first.evidence_boundary.chain_wide_coverage_claimed, false);
  assert.equal(first.evidence_boundary.all_dex_programs_claimed, false);
  assert.equal(first.execution_boundary.live_copy, false);
  assert.equal(first.execution_boundary.signing, false);
  assert.equal(normalizeConstantKNexusDiscoveryCoverageManifest(first).coverage_hash, first.coverage_hash);
});

test("any program or transaction-filter change invalidates the Raven-reviewed manifest", () => {
  const changedProgram = structuredClone(manifest());
  changedProgram.programs[0].program_id = changedProgram.programs[1].program_id;
  assert.throws(
    () => normalizeConstantKNexusDiscoveryCoverageManifest(changedProgram),
    /constant_k_discovery_coverage_manifest_mismatch/,
  );
  const changedFilter = structuredClone(manifest());
  changedFilter.transaction_filter.failed = true;
  assert.throws(
    () => normalizeConstantKNexusDiscoveryCoverageManifest(changedFilter),
    /constant_k_discovery_coverage_manifest_mismatch/,
  );
});

test("receiver-facing provider acknowledgement is exact, short-lived, and sanitized", () => {
  const coverageManifest = manifest();
  const ack = acknowledgement(coverageManifest);
  const summary = normalizeConstantKNexusDiscoveryCoverageAcknowledgement(ack, coverageManifest, {
    now: new Date("2026-09-01T16:05:00.000Z"),
  });
  assert.equal(ack.schema_version, CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA);
  assert.equal(summary.state, "provider_acknowledged");
  assert.equal(summary.coverage_hash, coverageManifest.coverage_hash);
  assert.equal(summary.program_count, SOLANA_SWAP_PROGRAM_REGISTRY.length);
  assert.equal(summary.program_ids_included, false);
  assert.equal(summary.chain_wide_coverage_claimed, false);
  assert.equal(summary.execution_authority, false);
});

test("stale, future, wrong-mode, and overlong provider acknowledgements fail closed", () => {
  const coverageManifest = manifest();
  assert.throws(() => normalizeConstantKNexusDiscoveryCoverageAcknowledgement(
    acknowledgement(coverageManifest),
    coverageManifest,
    { now: new Date(EXPIRES) },
  ), /constant_k_discovery_coverage_ack_expired/);
  assert.throws(() => normalizeConstantKNexusDiscoveryCoverageAcknowledgement(
    acknowledgement(coverageManifest, { verified_at: "2026-09-01T16:06:00.000Z", expires_at: "2026-09-01T16:10:00.000Z" }),
    coverageManifest,
    { now: new Date("2026-09-01T16:05:00.000Z") },
  ), /constant_k_discovery_coverage_ack_future/);
  assert.throws(() => normalizeConstantKNexusDiscoveryCoverageAcknowledgement(
    acknowledgement(coverageManifest, { active_filter_mode: "identity_backed" }),
    coverageManifest,
    { now: new Date("2026-09-01T16:05:00.000Z") },
  ), /constant_k_discovery_coverage_not_active/);
  assert.throws(() => createConstantKNexusDiscoveryCoverageAcknowledgement({
    manifest: coverageManifest,
    activated_at: ACTIVATED,
    verified_at: VERIFIED,
    expires_at: "2026-09-01T16:30:00.000Z",
  }), /constant_k_discovery_coverage_ack_window_invalid/);
});

test("coverage contract grants discovery transport only and no wallet or execution claim", () => {
  assert.equal(ConstantKNexusDiscoveryCoverageContract.short_lived_provider_ack_required, true);
  assert.equal(ConstantKNexusDiscoveryCoverageContract.receiver_reads_before_acknowledgement, false);
  assert.equal(ConstantKNexusDiscoveryCoverageContract.chain_wide_coverage_claimed, false);
  assert.equal(ConstantKNexusDiscoveryCoverageContract.live_copy, false);
  assert.equal(ConstantKNexusDiscoveryCoverageContract.signing, false);
  assert.equal(ConstantKNexusDiscoveryCoverageContract.custody, false);
});
