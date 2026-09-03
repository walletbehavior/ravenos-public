const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const READ_ONLY_METHODS = new Set([
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
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "net_version",
]);

export const EVM_READ_ONLY_RPC_METHODS = Object.freeze([...READ_ONLY_METHODS]);

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

function normalizeProvider(provider, index) {
  const providerId = String(provider?.provider_id || `rpc_${index + 1}`).trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(providerId)) fail("evm_rpc_provider_id_invalid");
  let endpoint;
  try {
    endpoint = new URL(String(provider?.url || ""));
  } catch {
    fail("evm_rpc_url_invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) fail("evm_rpc_url_invalid");
  if (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1") {
    fail("evm_rpc_host_forbidden");
  }
  return freeze({
    provider_id: providerId,
    endpoint: endpoint.toString(),
    endpoint_origin: endpoint.origin,
    credentials_exposed: false,
  });
}

async function boundedText(response, maximumBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) fail("evm_rpc_response_too_large");
    return text;
  }
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel().catch(() => {});
      fail("evm_rpc_response_too_large");
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

function providerError(error) {
  const raw = String(error?.code || error?.message || "").toLowerCase();
  if (/timeout|abort/.test(raw)) return "evm_rpc_timeout";
  if (/429|rate/.test(raw)) return "evm_rpc_rate_limited";
  if (/401|403|author/.test(raw)) return "evm_rpc_authorization_failed";
  if (/chain_id/.test(raw)) return "evm_rpc_chain_id_mismatch";
  if (/malformed|invalid/.test(raw)) return "evm_rpc_response_malformed";
  return "evm_rpc_unavailable";
}

export function createReadOnlyEvmRpcClient({
  chain_id: chainId,
  chain_namespace: chainNamespace,
  providers,
  timeout_ms: timeoutMs = DEFAULT_TIMEOUT_MS,
  maximum_response_bytes: maximumResponseBytes = MAX_RESPONSE_BYTES,
} = {}, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(Number(chainId)) || Number(chainId) <= 0) fail("evm_rpc_chain_id_invalid");
  const namespace = String(chainNamespace || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(namespace)) fail("evm_rpc_chain_namespace_invalid");
  const normalizedProviders = (Array.isArray(providers) ? providers : []).slice(0, 2).map(normalizeProvider);
  if (!normalizedProviders.length) fail("evm_rpc_provider_required");
  const boundedTimeout = Number(timeoutMs);
  const boundedMaximum = Number(maximumResponseBytes);
  if (!Number.isSafeInteger(boundedTimeout) || boundedTimeout < 250 || boundedTimeout > 15_000) fail("evm_rpc_timeout_invalid");
  if (!Number.isSafeInteger(boundedMaximum) || boundedMaximum < 16_384 || boundedMaximum > MAX_RESPONSE_BYTES) fail("evm_rpc_response_limit_invalid");
  if (typeof fetchImpl !== "function") fail("evm_rpc_fetch_unavailable");
  const health = new Map(normalizedProviders.map((provider) => [provider.provider_id, {
    attempts: 0,
    successes: 0,
    failures: 0,
    last_error: null,
    last_latency_ms: null,
  }]));
  let requestId = 0;

  return freeze({
    chain_id: Number(chainId),
    chain_namespace: namespace,
    providers: normalizedProviders.map(({ endpoint: _endpoint, ...publicProvider }) => publicProvider),
    async request(method, params = []) {
      if (!READ_ONLY_METHODS.has(method)) fail("evm_rpc_method_forbidden");
      let lastError = null;
      const attempts = [];
      for (const provider of normalizedProviders) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), boundedTimeout);
        const startedAt = Number(now());
        const row = health.get(provider.provider_id);
        row.attempts += 1;
        try {
          const id = ++requestId;
          const response = await fetchImpl(provider.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            signal: controller.signal,
          });
          const declaredLength = Number(response.headers?.get?.("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > boundedMaximum) fail("evm_rpc_response_too_large");
          const text = await boundedText(response, boundedMaximum);
          if (!response.ok) fail(`evm_rpc_http_${response.status}`);
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            fail("evm_rpc_response_malformed");
          }
          if (!payload || payload.jsonrpc !== "2.0" || payload.id !== id || payload.error || !("result" in payload)) {
            fail(payload?.error ? "evm_rpc_provider_error" : "evm_rpc_response_malformed", payload?.error || null);
          }
          const latency = Math.max(0, Number(now()) - startedAt);
          Object.assign(row, { successes: row.successes + 1, last_error: null, last_latency_ms: latency });
          attempts.push({ provider_id: provider.provider_id, state: "success", latency_ms: latency });
          return freeze({
            result: payload.result,
            provider_id: provider.provider_id,
            response_bytes: new TextEncoder().encode(text).byteLength,
            attempts,
          });
        } catch (error) {
          const code = controller.signal.aborted || error?.name === "AbortError" ? "evm_rpc_timeout" : providerError(error);
          const latency = Math.max(0, Number(now()) - startedAt);
          Object.assign(row, { failures: row.failures + 1, last_error: code, last_latency_ms: latency });
          attempts.push({ provider_id: provider.provider_id, state: "failed", error: code, latency_ms: latency });
          lastError = error;
          if (code === "evm_rpc_chain_id_mismatch") break;
        } finally {
          clearTimeout(timer);
        }
      }
      const error = new Error("evm_rpc_all_providers_unavailable");
      error.code = "evm_rpc_all_providers_unavailable";
      error.cause = lastError;
      error.attempts = freeze(attempts);
      throw error;
    },
    healthSnapshot() {
      return freeze({
        chain_id: Number(chainId),
        chain_namespace: namespace,
        providers: [...health.entries()].map(([provider_id, row]) => ({ provider_id, ...row })),
      });
    },
  });
}

export async function verifyReadOnlyEvmRpcChain(client, expectedChainId) {
  const response = await client.request("eth_chainId", []);
  const raw = String(response.result || "").trim().toLowerCase();
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(raw) || BigInt(raw) !== BigInt(expectedChainId)) {
    fail("evm_rpc_chain_id_mismatch", { expected_chain_id: Number(expectedChainId), observed_chain_id: raw || null });
  }
  return freeze({
    chain_id: Number(expectedChainId),
    canonical_chain_id: `eip155:${Number(expectedChainId)}`,
    provider_id: response.provider_id,
    verified: true,
    response_bytes: response.response_bytes,
    attempts: response.attempts,
  });
}

export async function readEvmFinalityEvidence(client) {
  const [latestResponse, finalizedResponse] = await Promise.all([
    client.request("eth_getBlockByNumber", ["latest", false]),
    client.request("eth_getBlockByNumber", ["finalized", false]),
  ]);
  const latest = latestResponse.result;
  const finalized = finalizedResponse.result;
  if (!latest?.number || !latest?.hash || !finalized?.number || !finalized?.hash) fail("evm_rpc_finality_unavailable");
  const latestNumber = BigInt(latest.number);
  const finalizedNumber = BigInt(finalized.number);
  if (finalizedNumber > latestNumber) fail("evm_rpc_finality_invalid");
  return freeze({
    latest_block: latestNumber.toString(),
    latest_block_hash: String(latest.hash).toLowerCase(),
    finalized_block: finalizedNumber.toString(),
    finalized_block_hash: String(finalized.hash).toLowerCase(),
    finality_state: "provider_finalized_tag",
    provider_id: finalizedResponse.provider_id,
  });
}
