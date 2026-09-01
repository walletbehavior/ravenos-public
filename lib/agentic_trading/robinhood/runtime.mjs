const RPC_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

export const ROBINHOOD_CHAIN_NETWORKS = Object.freeze({
  mainnet: Object.freeze({
    network: "mainnet",
    chain_id: 4663,
    chain_id_hex: "0x1237",
    native_gas_asset: "ETH",
    native_asset_id: "eip155:4663/slip44:60",
    public_rpc_url: "https://rpc.mainnet.chain.robinhood.com",
    explorer_url: "https://robinhoodchain.blockscout.com",
  }),
  testnet: Object.freeze({
    network: "testnet",
    chain_id: 46630,
    chain_id_hex: "0xb626",
    native_gas_asset: "ETH",
    native_asset_id: "eip155:46630/slip44:60",
    public_rpc_url: "https://rpc.testnet.chain.robinhood.com",
    explorer_url: "https://explorer.testnet.chain.robinhood.com",
  }),
});

export const ROBINHOOD_READ_ONLY_RPC_METHODS = Object.freeze([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "net_version",
]);
const READ_ONLY_RPC_METHOD_SET = new Set(ROBINHOOD_READ_ONLY_RPC_METHODS);

export const RobinhoodProviderLimits = Object.freeze({
  maximum_response_bytes: RPC_RESPONSE_LIMIT_BYTES,
  request_timeout_ms: DEFAULT_REQUEST_TIMEOUT_MS,
  maximum_providers: 2,
  maximum_failover_attempts: 2,
  websocket_messages_per_connection: 10_000,
  reconnect_delays_ms: Object.freeze([1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000]),
});

const providerSecrets = new WeakMap();
const EVM_QUANTITY_RE = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

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

function clean(value, maximum = 256) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  if ((value === undefined || value === null || value === "") && fallback !== null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function flag(value) {
  return String(value || "") === "1";
}

function networkConfig(value) {
  const network = clean(value || "mainnet", 20).toLowerCase();
  const config = ROBINHOOD_CHAIN_NETWORKS[network];
  if (!config) fail("robinhood_network_unsupported");
  return config;
}

function allowedProviderHosts(env, network) {
  const defaults = new Set([
    new URL(network.public_rpc_url).hostname,
    network.network === "mainnet" ? "robinhood-mainnet.g.alchemy.com" : "robinhood-testnet.g.alchemy.com",
  ]);
  for (const host of clean(env.RAVENOS_ROBINHOOD_CHAIN_ALLOWED_RPC_HOSTS, 2_000).split(",")) {
    const normalized = host.trim().toLowerCase();
    if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) defaults.add(normalized);
  }
  return defaults;
}

function normalizeEndpoint(value, { field, protocols, allowedHosts }) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail(`${field}_invalid`);
  }
  if (!protocols.has(parsed.protocol) || parsed.username || parsed.password || parsed.hash) fail(`${field}_invalid`);
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(host) || host === "localhost" || /^[\d.:]+$/.test(host)) fail(`${field}_host_forbidden`);
  return parsed.toString();
}

function alchemyEndpoints(apiKey, network) {
  const key = String(apiKey || "").trim();
  if (!key) return { rpc: null, websocket: null };
  if (key.length > 512 || /[\s/?#]/.test(key)) fail("robinhood_alchemy_api_key_invalid");
  const prefix = network.network === "mainnet" ? "robinhood-mainnet" : "robinhood-testnet";
  return {
    rpc: `https://${prefix}.g.alchemy.com/v2/${key}`,
    websocket: `wss://${prefix}.g.alchemy.com/v2/${key}`,
  };
}

function providerDescriptor({ id, role, transport, endpoint, network }) {
  const parsed = new URL(endpoint);
  const descriptor = {
    provider_id: id,
    role,
    transport,
    chain_id: network.chain_id,
    endpoint_origin: parsed.origin,
    endpoint_host: parsed.hostname,
    credentials_exposed: false,
  };
  freeze(descriptor);
  providerSecrets.set(descriptor, endpoint);
  return descriptor;
}

function executionBoundary() {
  return freeze({
    transaction_construction: false,
    signing: false,
    broadcasting: false,
    live_execution: false,
    autonomous_bridging: false,
  });
}

export function resolveRobinhoodChainRuntime(env = {}, { network: requestedNetwork } = {}) {
  const network = networkConfig(requestedNetwork || env.RAVENOS_ROBINHOOD_CHAIN_NETWORK || "mainnet");
  const hosts = allowedProviderHosts(env, network);
  const generated = alchemyEndpoints(
    env.RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY || env.ALCHEMY_ROBINHOOD_API_KEY,
    network,
  );
  const primaryRpcValue = env.RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_RPC_URL || generated.rpc;
  const primaryWsValue = env.RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_WSS_URL || generated.websocket;
  const fallbackRpcValue = env.RAVENOS_ROBINHOOD_CHAIN_FALLBACK_RPC_URL || network.public_rpc_url;
  const rpcProviders = [];
  if (primaryRpcValue) {
    rpcProviders.push(providerDescriptor({
      id: "alchemy_rpc",
      role: "primary",
      transport: "https_json_rpc",
      endpoint: normalizeEndpoint(primaryRpcValue, {
        field: "robinhood_primary_rpc_url",
        protocols: new Set(["https:"]),
        allowedHosts: hosts,
      }),
      network,
    }));
  }
  rpcProviders.push(providerDescriptor({
    id: "official_public_rpc",
    role: primaryRpcValue ? "fallback" : "primary",
    transport: "https_json_rpc",
    endpoint: normalizeEndpoint(fallbackRpcValue, {
      field: "robinhood_fallback_rpc_url",
      protocols: new Set(["https:"]),
      allowedHosts: hosts,
    }),
    network,
  }));
  const websocket = primaryWsValue ? providerDescriptor({
    id: "alchemy_websocket",
    role: "primary",
    transport: "wss_json_rpc",
    endpoint: normalizeEndpoint(primaryWsValue, {
      field: "robinhood_primary_websocket_url",
      protocols: new Set(["wss:"]),
      allowedHosts: hosts,
    }),
    network,
  }) : null;
  const enabled = flag(env.RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED);
  return freeze({
    schema_version: "ravenos.agentic.robinhood_runtime.v1",
    enabled,
    state: enabled ? primaryRpcValue ? "configured_read_only" : "fallback_only_rate_limited" : "disabled",
    network: network.network,
    chain_id: network.chain_id,
    chain_id_hex: network.chain_id_hex,
    native_gas_asset: network.native_gas_asset,
    native_asset_id: network.native_asset_id,
    rpc_providers: rpcProviders,
    websocket,
    limits: {
      maximum_blocks_per_cycle: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_BLOCKS_PER_CYCLE, "robinhood_max_blocks_per_cycle", { minimum: 1, maximum: 100, fallback: 10 }),
      maximum_log_queries_per_cycle: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_LOG_QUERIES, "robinhood_max_log_queries", { minimum: 1, maximum: 256, fallback: 64 }),
      maximum_concurrency: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_CONCURRENCY, "robinhood_max_concurrency", { minimum: 1, maximum: 8, fallback: 4 }),
      maximum_reorg_depth: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_REORG_DEPTH, "robinhood_max_reorg_depth", { minimum: 1, maximum: 256, fallback: 64 }),
      head_lag_blocks: integer(env.RAVENOS_ROBINHOOD_CHAIN_HEAD_LAG_BLOCKS, "robinhood_head_lag_blocks", { minimum: 0, maximum: 128, fallback: 1 }),
      request_timeout_ms: integer(env.RAVENOS_ROBINHOOD_CHAIN_RPC_TIMEOUT_MS, "robinhood_rpc_timeout_ms", { minimum: 250, maximum: 30_000, fallback: DEFAULT_REQUEST_TIMEOUT_MS }),
      maximum_rpc_attempts_per_schedule: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_RPC_ATTEMPTS_PER_SCHEDULE, "robinhood_max_rpc_attempts_per_schedule", { minimum: 4, maximum: 512, fallback: 192 }),
      maximum_log_queries_per_schedule: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_LOG_QUERIES_PER_SCHEDULE, "robinhood_max_log_queries_per_schedule", { minimum: 1, maximum: 512, fallback: 128 }),
      maximum_response_bytes_per_schedule: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_RESPONSE_BYTES_PER_SCHEDULE, "robinhood_max_response_bytes_per_schedule", { minimum: 65_536, maximum: 32 * 1024 * 1024, fallback: 8 * 1024 * 1024 }),
      maximum_schedule_wall_time_ms: integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_SCHEDULE_WALL_TIME_MS, "robinhood_max_schedule_wall_time_ms", { minimum: 1_000, maximum: 120_000, fallback: 25_000 }),
    },
    finality_model: {
      ingestion_observation: "soft_confirmation",
      posted_to_ethereum: "unresolved_without_explicit_evidence",
      ethereum_finality: "unresolved_without_explicit_evidence",
      block_depth_is_full_finality: false,
    },
    storage_model: "derived_records_and_cursors_only",
    local_full_node_required: false,
    execution_boundary: executionBoundary(),
  });
}

function endpointFor(provider) {
  const endpoint = providerSecrets.get(provider);
  if (!endpoint) fail("robinhood_provider_descriptor_unknown");
  return endpoint;
}

function providerErrorCode(error) {
  const code = String(error?.code || error?.message || "").toLowerCase();
  if (code.includes("timeout") || code.includes("timedout") || code.includes("abort")) return "provider_timeout";
  if (code.includes("429") || code.includes("rate")) return "provider_rate_limited";
  if (code.includes("401") || code.includes("403") || code.includes("author")) return "provider_authorization_failed";
  if (code.includes("chain_id")) return "provider_chain_id_mismatch";
  if (code.includes("malformed") || code.includes("invalid")) return "provider_response_malformed";
  return "provider_unavailable";
}

async function boundedResponseText(response, maximumBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) fail("provider_response_too_large");
    return body;
  }
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel().catch(() => {});
      fail("provider_response_too_large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function boundedJsonRpcRequest(provider, method, params, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requestId = 1,
} = {}) {
  if (!READ_ONLY_RPC_METHOD_SET.has(method)) fail("robinhood_rpc_method_forbidden");
  if (typeof fetchImpl !== "function") fail("robinhood_rpc_fetch_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointFor(provider), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: controller.signal,
    });
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > RPC_RESPONSE_LIMIT_BYTES) fail("provider_response_too_large");
    const body = await boundedResponseText(response, RPC_RESPONSE_LIMIT_BYTES);
    if (!response.ok) fail(`provider_http_${response.status}`);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("provider_response_malformed");
    }
    if (!payload || payload.jsonrpc !== "2.0" || payload.id !== requestId || payload.error || !("result" in payload)) {
      fail(payload?.error ? "provider_rpc_error" : "provider_response_malformed", payload?.error || null);
    }
    return { result: payload.result, response_bytes: new TextEncoder().encode(body).byteLength };
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") fail("provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createRobinhoodRpcFailoverClient(runtime, {
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!runtime || !Array.isArray(runtime.rpc_providers) || !runtime.rpc_providers.length) fail("robinhood_runtime_invalid");
  const health = new Map(runtime.rpc_providers.map((provider) => [provider.provider_id, {
    attempts: 0,
    successes: 0,
    failures: 0,
    last_error: null,
    last_latency_ms: null,
    last_observed_at: null,
  }]));
  let requestId = 0;
  return freeze({
    async request(method, params = []) {
      let lastError = null;
      const attempts = [];
      for (const provider of runtime.rpc_providers.slice(0, RobinhoodProviderLimits.maximum_failover_attempts)) {
        const started = Number(now());
        const row = health.get(provider.provider_id);
        row.attempts += 1;
        try {
          const response = await boundedJsonRpcRequest(provider, method, params, {
            fetchImpl,
            timeoutMs: runtime.limits.request_timeout_ms,
            requestId: ++requestId,
          });
          const latency = Math.max(0, Number(now()) - started);
          Object.assign(row, {
            successes: row.successes + 1,
            last_error: null,
            last_latency_ms: latency,
            last_observed_at: new Date(Number(now())).toISOString(),
          });
          attempts.push({ provider_id: provider.provider_id, state: "success", latency_ms: latency });
          return freeze({
            result: response.result,
            response_bytes: response.response_bytes,
            provider_id: provider.provider_id,
            attempts,
          });
        } catch (error) {
          if (error?.code === "robinhood_rpc_method_forbidden") throw error;
          const code = providerErrorCode(error);
          const latency = Math.max(0, Number(now()) - started);
          Object.assign(row, {
            failures: row.failures + 1,
            last_error: code,
            last_latency_ms: latency,
            last_observed_at: new Date(Number(now())).toISOString(),
          });
          attempts.push({ provider_id: provider.provider_id, state: "failed", error: code, latency_ms: latency });
          lastError = error;
          if (code === "provider_chain_id_mismatch") break;
        }
      }
      const error = new Error("robinhood_rpc_all_providers_unavailable");
      error.code = "robinhood_rpc_all_providers_unavailable";
      error.cause = lastError;
      error.attempts = freeze(attempts);
      throw error;
    },
    healthSnapshot() {
      const providers = [...health.entries()].map(([provider_id, row]) => freeze({
        provider_id,
        state: row.successes > 0 ? row.failures > 0 ? "degraded" : "current" : row.failures > 0 ? "unavailable" : "idle",
        ...row,
      }));
      return freeze({
        schema_version: "ravenos.agentic.robinhood_provider_health.v1",
        state: providers.some((row) => row.state === "current") ? "current"
          : providers.some((row) => row.state === "degraded") ? "degraded"
            : providers.some((row) => row.state === "unavailable") ? "unavailable" : "idle",
        providers,
      });
    },
  });
}

export async function verifyRobinhoodRpcChain(client, runtime) {
  const response = await client.request("eth_chainId", []);
  const value = String(response.result || "").toLowerCase();
  if (!EVM_QUANTITY_RE.test(value) || BigInt(value) !== BigInt(runtime.chain_id)) fail("robinhood_provider_chain_id_mismatch");
  return freeze({
    chain_id: runtime.chain_id,
    provider_id: response.provider_id,
    verified: true,
    attempts: response.attempts,
    response_bytes: response.response_bytes,
  });
}

export function robinhoodReconnectDelayMs(attempt, { jitter_ratio: jitterRatio = 0, random = Math.random } = {}) {
  const index = Math.max(0, Math.min(RobinhoodProviderLimits.reconnect_delays_ms.length - 1, Number(attempt || 1) - 1));
  const base = RobinhoodProviderLimits.reconnect_delays_ms[index];
  const ratio = Math.max(0, Math.min(0.5, Number(jitterRatio) || 0));
  const sample = Math.max(0, Math.min(1, Number(random())));
  return Math.round(base * (1 - ratio + sample * ratio * 2));
}

export function robinhoodWebsocketEndpoint(runtime) {
  if (!runtime?.websocket) return null;
  return endpointFor(runtime.websocket);
}
