export const ROBINHOOD_STOCK_TOKEN_REGISTRY_SCHEMA = "ravenos.robinhood_stock_token_registry.v1";
export const ROBINHOOD_STOCK_TOKEN_REGISTRY_URL = "https://api.robinhood.com/rhj/assets";

const MAX_RESPONSE_BYTES = 512 * 1024;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function address(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!EVM_ADDRESS_RE.test(normalized) || /^0x0{40}$/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) fail("robinhood_stock_registry_response_too_large");
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) fail("robinhood_stock_registry_response_too_large");
  try {
    return JSON.parse(raw);
  } catch {
    fail("robinhood_stock_registry_invalid_json");
  }
}

export async function inspectRobinhoodStockToken(tokenAddress, {
  chain_id: chainId = 4663,
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = 4_000,
  now = Date.now,
} = {}) {
  const token = address(tokenAddress, "robinhood_token_address");
  if (chainId !== 4663 || typeof fetchImpl !== "function") fail("robinhood_stock_registry_configuration_invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(8_000, Number(timeoutMs) || 4_000)));
  let response;
  try {
    response = await fetchImpl(ROBINHOOD_STOCK_TOKEN_REGISTRY_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    fail(error?.name === "AbortError" ? "robinhood_stock_registry_timeout" : "robinhood_stock_registry_unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok) fail("robinhood_stock_registry_http_error", { status: Number(response?.status || 0) });
  const payload = await boundedJson(response);
  if (!Array.isArray(payload?.assets)) fail("robinhood_stock_registry_malformed");
  const matches = [];
  for (const asset of payload.assets) {
    if (!Array.isArray(asset?.deployments)) fail("robinhood_stock_registry_malformed");
    for (const deployment of asset.deployments) {
      if (Number(deployment?.chainId) !== chainId) continue;
      let contract;
      try {
        contract = address(deployment?.contractAddress, "robinhood_stock_contract");
      } catch {
        fail("robinhood_stock_registry_malformed");
      }
      if (contract === token) matches.push({
        id: String(asset?.id || "").slice(0, 80),
        symbol: String(asset?.tokenSymbol || "").slice(0, 32),
        status: String(asset?.status || "").slice(0, 64),
      });
    }
  }
  if (matches.length > 1) fail("robinhood_stock_registry_identity_ambiguous");
  const matched = matches[0] || null;
  return Object.freeze({
    schema_version: ROBINHOOD_STOCK_TOKEN_REGISTRY_SCHEMA,
    chain_id: chainId,
    token_address: token,
    checked_at: new Date(Number(now())).toISOString(),
    exact_registry_match: Boolean(matched),
    restricted_stock_token: Boolean(matched),
    registry_asset: matched ? Object.freeze(matched) : null,
    source: ROBINHOOD_STOCK_TOKEN_REGISTRY_URL,
    evidence_state: "current_exact_contract_registry_check",
  });
}
