import { createHash } from "node:crypto";

import { SOLANA_SWAP_PROGRAM_REGISTRY } from "./solana_program_registry.mjs";

export const CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA = "ravenos.constant_k_nexus_discovery_coverage_manifest.v1";
export const CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA = "ravenos.constant_k_nexus_discovery_coverage_ack.v1";

export const ConstantKNexusDiscoveryCoverageLimits = Object.freeze({
  provider: "constant_k",
  filter_mode: "reviewed_swap_programs",
  commitment: "confirmed",
  maximum_ack_validity_ms: 15 * 60 * 1_000,
  maximum_future_clock_skew_ms: 30 * 1_000,
  minimum_reviewed_programs: 8,
  maximum_reviewed_programs: 64,
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function digest(value, length = 40) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function programRows() {
  const rows = SOLANA_SWAP_PROGRAM_REGISTRY.map((row) => freeze({
    key: row.key,
    label: row.label,
    program_id: row.program_id,
    review_evidence: row.evidence,
  })).sort((left, right) => left.key.localeCompare(right.key));
  if (rows.length < ConstantKNexusDiscoveryCoverageLimits.minimum_reviewed_programs
    || rows.length > ConstantKNexusDiscoveryCoverageLimits.maximum_reviewed_programs) {
    fail("constant_k_discovery_coverage_program_count_invalid");
  }
  if (new Set(rows.map((row) => row.program_id)).size !== rows.length) {
    fail("constant_k_discovery_coverage_program_duplicate");
  }
  return freeze(rows);
}

function coverageCore() {
  const programs = programRows();
  return freeze({
    manifest_version: 1,
    provider: ConstantKNexusDiscoveryCoverageLimits.provider,
    chain: "solana",
    network: "mainnet",
    filter_mode: ConstantKNexusDiscoveryCoverageLimits.filter_mode,
    commitment: ConstantKNexusDiscoveryCoverageLimits.commitment,
    transaction_filter: {
      filter_id: "ravenos_reviewed_swap_programs_v1",
      vote: false,
      failed: false,
      account_include_match: "any",
      account_include: programs.map((row) => row.program_id),
      account_required: [],
      account_exclude: [],
    },
    programs,
  });
}

export function createConstantKNexusDiscoveryCoverageManifest({
  generated_at: generatedAt = new Date().toISOString(),
} = {}) {
  const core = coverageCore();
  const coverageHash = digest(stableJson(core), 64);
  return freeze({
    schema_version: CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA,
    generated_at: timestamp(generatedAt, "constant_k_discovery_coverage_generated_at"),
    manifest_id: `ckdc_${coverageHash.slice(0, 40)}`,
    coverage_hash: coverageHash,
    program_count: core.programs.length,
    ...core,
    evidence_boundary: {
      exact_listed_program_transaction_filter_required: true,
      all_solana_transactions_claimed: false,
      chain_wide_coverage_claimed: false,
      all_dex_programs_claimed: false,
      normalized_trade_claimed: false,
      candidate_profitability_claimed: false,
      candidate_copyability_claimed: false,
    },
    privacy: {
      public_program_ids_only: true,
      wallet_addresses_included: false,
      signatures_included: false,
      subscriber_identity_included: false,
      policy_included: false,
      signer_material_included: false,
    },
    execution_boundary: {
      discovery_transport_only: true,
      transaction_construction: false,
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}

export function normalizeConstantKNexusDiscoveryCoverageManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.schema_version !== CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA) {
    fail("constant_k_discovery_coverage_manifest_invalid");
  }
  const canonical = createConstantKNexusDiscoveryCoverageManifest({ generated_at: input.generated_at });
  for (const field of ["manifest_id", "coverage_hash", "program_count", "provider", "chain", "network", "filter_mode", "commitment"]) {
    if (input[field] !== canonical[field]) fail("constant_k_discovery_coverage_manifest_mismatch");
  }
  if (stableJson(input.programs) !== stableJson(canonical.programs)
    || stableJson(input.transaction_filter) !== stableJson(canonical.transaction_filter)) {
    fail("constant_k_discovery_coverage_manifest_mismatch");
  }
  return canonical;
}

export function createConstantKNexusDiscoveryCoverageAcknowledgement({
  manifest: inputManifest,
  activated_at: activatedAt,
  verified_at: verifiedAt,
  expires_at: expiresAt,
} = {}) {
  const manifest = normalizeConstantKNexusDiscoveryCoverageManifest(inputManifest);
  const activated = timestamp(activatedAt, "constant_k_discovery_coverage_activated_at");
  const verified = timestamp(verifiedAt, "constant_k_discovery_coverage_verified_at");
  const expires = timestamp(expiresAt, "constant_k_discovery_coverage_expires_at");
  if (Date.parse(activated) > Date.parse(verified)
    || Date.parse(expires) <= Date.parse(verified)
    || Date.parse(expires) - Date.parse(verified) > ConstantKNexusDiscoveryCoverageLimits.maximum_ack_validity_ms) {
    fail("constant_k_discovery_coverage_ack_window_invalid");
  }
  return freeze({
    schema_version: CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA,
    acknowledgement_version: 1,
    provider: manifest.provider,
    coverage_state: "current",
    active_filter_mode: manifest.filter_mode,
    active_manifest_id: manifest.manifest_id,
    active_coverage_hash: manifest.coverage_hash,
    active_program_count: manifest.program_count,
    transaction_filter_count: 1,
    activated_at: activated,
    verified_at: verified,
    expires_at: expires,
    exact_listed_program_filter_active: true,
    raw_provider_payload_included: false,
    wallet_addresses_included: false,
    signatures_included: false,
    subscriber_identity_included: false,
    execution_authority: false,
  });
}

export function normalizeConstantKNexusDiscoveryCoverageAcknowledgement(input, inputManifest, {
  now = new Date(),
} = {}) {
  const manifest = normalizeConstantKNexusDiscoveryCoverageManifest(inputManifest);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.schema_version !== CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA) {
    fail("constant_k_discovery_coverage_ack_invalid");
  }
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) fail("constant_k_discovery_coverage_clock_invalid");
  const canonical = createConstantKNexusDiscoveryCoverageAcknowledgement({
    manifest,
    activated_at: input.activated_at,
    verified_at: input.verified_at,
    expires_at: input.expires_at,
  });
  for (const field of [
    "provider",
    "coverage_state",
    "active_filter_mode",
    "active_manifest_id",
    "active_coverage_hash",
    "active_program_count",
    "transaction_filter_count",
    "exact_listed_program_filter_active",
  ]) {
    if (input[field] !== canonical[field]) fail("constant_k_discovery_coverage_not_active");
  }
  if (Date.parse(canonical.verified_at) > current.getTime() + ConstantKNexusDiscoveryCoverageLimits.maximum_future_clock_skew_ms) {
    fail("constant_k_discovery_coverage_ack_future");
  }
  if (Date.parse(canonical.expires_at) <= current.getTime()) fail("constant_k_discovery_coverage_ack_expired");
  return freeze({
    schema_version: "ravenos.constant_k_nexus_discovery_coverage_summary.v1",
    state: "provider_acknowledged",
    provider: canonical.provider,
    filter_mode: canonical.active_filter_mode,
    manifest_id: canonical.active_manifest_id,
    coverage_hash: canonical.active_coverage_hash,
    program_count: canonical.active_program_count,
    activated_at: canonical.activated_at,
    verified_at: canonical.verified_at,
    expires_at: canonical.expires_at,
    exact_listed_program_transaction_filter_active: true,
    program_ids_included: false,
    wallet_addresses_included: false,
    signatures_included: false,
    chain_wide_coverage_claimed: false,
    all_dex_programs_claimed: false,
    execution_authority: false,
  });
}

export const ConstantKNexusDiscoveryCoverageContract = Object.freeze({
  manifest_schema_version: CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_MANIFEST_SCHEMA,
  acknowledgement_schema_version: CONSTANT_K_NEXUS_DISCOVERY_COVERAGE_ACK_SCHEMA,
  provider: ConstantKNexusDiscoveryCoverageLimits.provider,
  filter_mode: ConstantKNexusDiscoveryCoverageLimits.filter_mode,
  reviewed_program_count: SOLANA_SWAP_PROGRAM_REGISTRY.length,
  short_lived_provider_ack_required: true,
  receiver_reads_before_acknowledgement: false,
  chain_wide_coverage_claimed: false,
  all_dex_programs_claimed: false,
  live_copy: false,
  signing: false,
  broadcasting: false,
  custody: false,
  fee_collection: false,
});
