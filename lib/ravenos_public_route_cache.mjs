export const PUBLIC_ROUTE_RESPONSE_CACHE_POLICY = Object.freeze({
  schema_version: "ravenos.public_route_response_cache.v1",
  cache_revision: "2",
  routes: Object.freeze({
    "/api/health": Object.freeze({ ttl_seconds: 30 }),
    "/api/opportunity": Object.freeze({ ttl_seconds: 30 }),
  }),
});

const INTERNAL_STORED_AT = "x-ravenos-response-cache-stored-at";
const INTERNAL_ORIGINAL_CACHE_CONTROL = "x-ravenos-response-cache-original-control";

function cleanReleaseId(env = {}) {
  const value = String(env.RAVENOS_RELEASE_ID || env.RAVENOS_PUBLIC_BUILD_ID || "unversioned")
    .trim()
    .slice(0, 160);
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : "unversioned";
}

function cacheDescriptor(request, env = {}) {
  if (String(env.RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED || "") !== "1") return null;
  if (request?.method !== "GET") return null;
  if (request.headers.get("authorization") || request.headers.get("cookie")) return null;
  const url = new URL(request.url);
  const policy = PUBLIC_ROUTE_RESPONSE_CACHE_POLICY.routes[url.pathname];
  if (!policy || url.search) return null;
  const releaseId = cleanReleaseId(env);
  const hostname = String(url.hostname || "unknown").toLowerCase();
  const key = new Request(
    `https://public-response-cache.ravenos.invalid/${PUBLIC_ROUTE_RESPONSE_CACHE_POLICY.cache_revision}/${encodeURIComponent(releaseId)}/${encodeURIComponent(hostname)}/${encodeURIComponent(url.pathname)}.json`,
    { method: "GET" },
  );
  return { key, policy };
}

function restoredResponse(response, state) {
  const headers = new Headers(response.headers);
  const originalCacheControl = headers.get(INTERNAL_ORIGINAL_CACHE_CONTROL);
  if (originalCacheControl) headers.set("cache-control", originalCacheControl);
  else headers.delete("cache-control");
  headers.delete(INTERNAL_STORED_AT);
  headers.delete(INTERNAL_ORIGINAL_CACHE_CONTROL);
  headers.set("x-ravenos-response-cache", state);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function storedAtMs(response) {
  const parsed = Date.parse(String(response?.headers?.get(INTERNAL_STORED_AT) || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readPublicRouteResponseCache({
  request,
  env = {},
  cache = globalThis.caches?.default || null,
  nowMs = Date.now(),
} = {}) {
  const descriptor = cacheDescriptor(request, env);
  if (!descriptor) return null;
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const response = await cache.match(descriptor.key);
    if (!response?.ok) return null;
    const storedAt = storedAtMs(response);
    if (
      storedAt === null
      || storedAt > nowMs + 300_000
      || nowMs - storedAt > descriptor.policy.ttl_seconds * 1_000
    ) return null;
    return restoredResponse(response, "edge_hit");
  } catch {
    return null;
  }
}

export function storePublicRouteResponseCache({
  request,
  env = {},
  response,
  executionContext = null,
  cache = globalThis.caches?.default || null,
  nowMs = Date.now(),
} = {}) {
  const descriptor = cacheDescriptor(request, env);
  const contentType = String(response?.headers?.get("content-type") || "").toLowerCase();
  if (
    !descriptor
    || !response?.ok
    || !contentType.includes("application/json")
    || response.headers.has("set-cookie")
  ) return response;

  const headers = new Headers(response.headers);
  headers.set(INTERNAL_STORED_AT, new Date(nowMs).toISOString());
  headers.set(INTERNAL_ORIGINAL_CACHE_CONTROL, headers.get("cache-control") || "no-store");
  headers.set("cache-control", `public, max-age=${descriptor.policy.ttl_seconds}`);
  const stored = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  if (cache && typeof cache.put === "function") {
    const work = cache.put(descriptor.key, stored.clone()).catch(() => undefined);
    if (executionContext?.waitUntil) executionContext.waitUntil(work);
  }
  return response;
}

export function resetPublicRouteResponseCacheForTests() {
  // Kept as a stable test hook; the runtime cache is now exclusively Cache API backed.
}

export const __testing = Object.freeze({ cacheDescriptor });
