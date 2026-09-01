import { createHash } from "node:crypto";

import {
  SourceWalletTransportLimits,
  normalizeSourceWalletWatchUniverse,
} from "./source_wallet_transports.mjs";

export const SOURCE_WALLET_WATCH_MANIFEST_SCHEMA = "ravenos.source_wallet_watch_manifest.v1";
export const SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA = "ravenos.source_wallet_watch_manifest_ack.v1";

export const SourceWalletWatchManifestLimits = Object.freeze({
  maximum_wallets: SourceWalletTransportLimits.maximum_stream_watches_per_run,
  logical_buckets: 64,
  maximum_accounts_per_filter: 900,
});

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
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

function digest(value, length = 40) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function bucketFor(address) {
  return Number.parseInt(digest(address, 8), 16) % SourceWalletWatchManifestLimits.logical_buckets;
}

export function buildSourceWalletWatchManifest(rows = [], {
  generated_at: generatedAt = new Date().toISOString(),
} = {}) {
  const universe = normalizeSourceWalletWatchUniverse(rows, {
    maximum_watches: SourceWalletWatchManifestLimits.maximum_wallets,
  });
  const addresses = universe.map((row) => row.source_wallet.address).sort();
  const buckets = Array.from({ length: SourceWalletWatchManifestLimits.logical_buckets }, () => []);
  for (const address of addresses) buckets[bucketFor(address)].push(address);
  const shards = [];
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    const values = buckets[bucket].sort();
    for (let offset = 0; offset < values.length; offset += SourceWalletWatchManifestLimits.maximum_accounts_per_filter) {
      const part = Math.floor(offset / SourceWalletWatchManifestLimits.maximum_accounts_per_filter);
      const shardAddresses = values.slice(offset, offset + SourceWalletWatchManifestLimits.maximum_accounts_per_filter);
      const shardHash = digest(shardAddresses.join("|"));
      shards.push(freeze({
        shard_id: `constant_k_wallets_${String(bucket).padStart(2, "0")}_${String(part).padStart(2, "0")}`,
        shard_hash: shardHash,
        wallet_count: shardAddresses.length,
        addresses: freeze(shardAddresses),
      }));
    }
  }
  const manifestHash = digest(addresses.join("|"));
  return freeze({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_SCHEMA,
    generated_at: timestamp(generatedAt, "source_wallet_manifest_generated_at"),
    manifest_hash: manifestHash,
    wallet_count: addresses.length,
    shard_count: shards.length,
    logical_bucket_count: SourceWalletWatchManifestLimits.logical_buckets,
    maximum_accounts_per_filter: SourceWalletWatchManifestLimits.maximum_accounts_per_filter,
    shards: freeze(shards.sort((left, right) => left.shard_id.localeCompare(right.shard_id))),
    privacy: {
      public_wallet_addresses_only: true,
      subscriber_identity_included: false,
      policy_included: false,
      follower_count_included: false,
      signer_material_included: false,
    },
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
    },
  });
}

export function summarizeSourceWalletWatchManifest(manifest) {
  if (manifest?.schema_version !== SOURCE_WALLET_WATCH_MANIFEST_SCHEMA) fail("source_wallet_manifest_invalid");
  return freeze({
    schema_version: "ravenos.source_wallet_watch_manifest_summary.v1",
    generated_at: timestamp(manifest.generated_at, "source_wallet_manifest_generated_at"),
    manifest_hash: String(manifest.manifest_hash || ""),
    wallet_count: Number(manifest.wallet_count || 0),
    shard_count: Number(manifest.shard_count || 0),
    maximum_accounts_per_filter: Number(manifest.maximum_accounts_per_filter || 0),
    addresses_included: false,
    subscriber_identity_included: false,
    execution_authority: false,
  });
}

export function normalizeSourceWalletWatchManifestAck(input, manifest) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("source_wallet_manifest_ack_invalid");
  if (input.schema_version !== SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA) fail("source_wallet_manifest_ack_invalid");
  if (manifest?.schema_version !== SOURCE_WALLET_WATCH_MANIFEST_SCHEMA) fail("source_wallet_manifest_invalid");
  const activeHash = String(input.active_manifest_hash || "");
  const state = String(input.coverage_state || "").toLowerCase();
  if (activeHash !== manifest.manifest_hash || state !== "current") fail("source_wallet_manifest_not_active");
  if (Number(input.wallet_count) !== manifest.wallet_count || Number(input.shard_count) !== manifest.shard_count) {
    fail("source_wallet_manifest_ack_mismatch");
  }
  return freeze({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: activeHash,
    coverage_state: state,
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: timestamp(input.activated_at, "source_wallet_manifest_activated_at"),
    raw_provider_payload_included: false,
    subscriber_identity_included: false,
  });
}
