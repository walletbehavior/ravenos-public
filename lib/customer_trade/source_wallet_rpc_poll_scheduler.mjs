import {
  SourceWalletTransportLimits,
  runRpcPollSourceWalletAdapter,
} from "./source_wallet_transports.mjs";

export const SOURCE_WALLET_RPC_POLL_RUN_SCHEMA = "ravenos.source_wallet_rpc_poll_run.v1";

export const SourceWalletRpcPollLimits = Object.freeze({
  maximum_wallets: 50,
  page_size: 100,
  maximum_pages: 4,
  concurrency: 8,
});

function flag(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return parsed;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export function resolveSourceWalletRpcPollActivation(env = {}) {
  const requested = flag(env.RAVENOS_WALLET_RPC_POLL_ENABLED);
  const observer = flag(env.RAVENOS_WALLET_OBSERVER_ENABLED);
  const evaluator = flag(env.RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED);
  const intelligence = flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED);
  const shadow = flag(env.RAVENOS_SHADOW_COPY_ENABLED);
  return freeze({
    implemented: true,
    requested,
    active: requested && observer && evaluator && intelligence && shadow,
    transport: "rpc_poll",
    live_copy: false,
    signing: false,
    broadcasting: false,
    custody: false,
  });
}

export async function runScheduledSourceWalletRpcPoll({
  store,
  fetch_signatures: fetchSignatures,
  ingest_delivery: ingestDelivery,
  env = {},
  now = () => new Date(),
} = {}) {
  const activation = resolveSourceWalletRpcPollActivation(env);
  if (!activation.active) return freeze({
    schema_version: SOURCE_WALLET_RPC_POLL_RUN_SCHEMA,
    state: "disabled",
    activation,
    execution_boundary: { live_copy: false, signing: false, broadcasting: false, custody: false },
  });
  if (!store?.listObserverPollingUniverse || typeof fetchSignatures !== "function" || typeof ingestDelivery !== "function") {
    const error = new Error("source_wallet_rpc_poll_dependencies_unavailable");
    error.code = "source_wallet_rpc_poll_dependencies_unavailable";
    throw error;
  }
  const maximumWallets = boundedInteger(
    env.RAVENOS_WALLET_RPC_POLL_MAXIMUM_WALLETS,
    SourceWalletRpcPollLimits.maximum_wallets,
    1,
    SourceWalletTransportLimits.maximum_watches_per_run,
    "source_wallet_rpc_poll_maximum_wallets_invalid",
  );
  const watches = await store.listObserverPollingUniverse(maximumWallets);
  if (!Array.isArray(watches)) {
    const error = new Error("source_wallet_rpc_poll_universe_invalid");
    error.code = "source_wallet_rpc_poll_universe_invalid";
    throw error;
  }
  const baselined = watches.filter((row) => row?.cursor?.signature && Number.isSafeInteger(Number(row?.cursor?.slot)));
  const skippedUnbaselined = watches.length - baselined.length;
  if (!baselined.length) return freeze({
    schema_version: SOURCE_WALLET_RPC_POLL_RUN_SCHEMA,
    state: watches.length ? "baseline_required" : "idle",
    activation,
    counts: { requested_wallets: watches.length, baselined_wallets: 0, skipped_unbaselined: skippedUnbaselined },
    execution_boundary: { live_copy: false, signing: false, broadcasting: false, custody: false },
  });
  const run = await runRpcPollSourceWalletAdapter({
    watches: baselined,
    fetch_signatures: fetchSignatures,
    ingest_delivery: ingestDelivery,
    provider: "configured_solana_rpc",
    now,
    page_size: SourceWalletRpcPollLimits.page_size,
    maximum_pages: SourceWalletRpcPollLimits.maximum_pages,
    concurrency: SourceWalletRpcPollLimits.concurrency,
    commitment: "confirmed",
  });
  return freeze({
    schema_version: SOURCE_WALLET_RPC_POLL_RUN_SCHEMA,
    state: run.health.state,
    activation,
    counts: {
      requested_wallets: watches.length,
      baselined_wallets: baselined.length,
      skipped_unbaselined: skippedUnbaselined,
      references_received: run.health.counts.references_received,
      deliveries_ingested: run.health.counts.deliveries_ingested,
      gap_wallets: run.health.counts.gap_wallets,
    },
    transport_run: run,
    execution_boundary: { live_copy: false, signing: false, broadcasting: false, custody: false },
  });
}

