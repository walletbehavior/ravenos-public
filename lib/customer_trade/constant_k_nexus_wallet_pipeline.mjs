import {
  runConstantKNexusWalletReceiverCycle,
} from "./constant_k_nexus_wallet_receiver.mjs";
import {
  buildSourceWalletWatchManifest,
  normalizeSourceWalletWatchManifestAck,
  summarizeSourceWalletWatchManifest,
} from "./source_wallet_watch_manifest.mjs";

export const CONSTANT_K_NEXUS_WALLET_PIPELINE_SCHEMA = "ravenos.constant_k_nexus_wallet_pipeline.v1";

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

export async function runConstantKNexusWalletPipelineCycle({
  load_watch_universe: loadWatchUniverse,
  sync_watch_manifest: syncWatchManifest,
  load_checkpoint: loadCheckpoint,
  save_checkpoint: saveCheckpoint,
  read_batch: readBatch,
  ingest_delivery: ingestDelivery,
  now = () => new Date(),
} = {}) {
  if (typeof loadWatchUniverse !== "function") fail("constant_k_pipeline_watch_store_unavailable");
  if (typeof syncWatchManifest !== "function") fail("constant_k_pipeline_manifest_sync_unavailable");
  if (typeof loadCheckpoint !== "function" || typeof saveCheckpoint !== "function") fail("constant_k_pipeline_checkpoint_store_unavailable");
  if (typeof readBatch !== "function" || typeof ingestDelivery !== "function") fail("constant_k_pipeline_receiver_unavailable");
  const generatedAt = (typeof now === "function" ? now() : now) || new Date();
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : new Date(generatedAt).toISOString();
  const rows = await loadWatchUniverse();
  const manifest = buildSourceWalletWatchManifest(rows, { generated_at: generatedAtIso });
  const ack = normalizeSourceWalletWatchManifestAck(await syncWatchManifest(manifest), manifest);
  const checkpoint = await loadCheckpoint();
  const watches = manifest.shards.flatMap((shard) => shard.addresses);
  const receiver = await runConstantKNexusWalletReceiverCycle({
    watches,
    checkpoint,
    read_batch: readBatch,
    ingest_delivery: ingestDelivery,
    save_checkpoint: saveCheckpoint,
    now: () => generatedAtIso,
  });
  return freeze({
    schema_version: CONSTANT_K_NEXUS_WALLET_PIPELINE_SCHEMA,
    generated_at: generatedAtIso,
    state: receiver.state,
    manifest: summarizeSourceWalletWatchManifest(manifest),
    coverage: {
      state: ack.coverage_state,
      activated_at: ack.activated_at,
      exact_manifest_confirmed: true,
    },
    receiver,
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}
