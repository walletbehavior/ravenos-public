import { randomUUID } from "node:crypto";

const RECENT_EVENT_LIMIT = 160;
const DEFAULT_RESPONSE_BUDGET_BYTES = 96 * 1024;
const DEFAULT_REQUEST_BUDGET_BYTES = 24 * 1024;

export const TerminalRouteBudgets = Object.freeze({
  status: Object.freeze({ timeout_ms: 4_500, max_request_bytes: 0, max_response_bytes: 48 * 1024 }),
  health: Object.freeze({ timeout_ms: 500, max_request_bytes: 0, max_response_bytes: 24 * 1024 }),
  trade_flags: Object.freeze({ timeout_ms: 500, max_request_bytes: 0, max_response_bytes: 16 * 1024 }),
  trade_market_preview: Object.freeze({ timeout_ms: 5_000, max_request_bytes: 8 * 1024, max_response_bytes: 32 * 1024 }),
  trade_order_plan: Object.freeze({ timeout_ms: 5_000, max_request_bytes: 12 * 1024, max_response_bytes: 40 * 1024 }),
  trade_spot_quote_preview: Object.freeze({ timeout_ms: 9_000, max_request_bytes: 12 * 1024, max_response_bytes: 48 * 1024 }),
  trade_account_snapshot: Object.freeze({ timeout_ms: 7_000, max_request_bytes: 4 * 1024, max_response_bytes: 96 * 1024 }),
  trade_account_scenario: Object.freeze({ timeout_ms: 7_000, max_request_bytes: 16 * 1024, max_response_bytes: 56 * 1024 }),
  trade_account_history: Object.freeze({ timeout_ms: 7_000, max_request_bytes: 4 * 1024, max_response_bytes: 96 * 1024 }),
  trade_quote: Object.freeze({ timeout_ms: 7_000, max_request_bytes: 24 * 1024, max_response_bytes: 64 * 1024 }),
  trade_inspect: Object.freeze({ timeout_ms: 7_000, max_request_bytes: 64 * 1024, max_response_bytes: 96 * 1024 }),
  trade_review_post: Object.freeze({ timeout_ms: 2_000, max_request_bytes: 96 * 1024, max_response_bytes: 96 * 1024 }),
  trade_review_get: Object.freeze({ timeout_ms: 1_500, max_request_bytes: 0, max_response_bytes: 96 * 1024 }),
  terminal_chart: Object.freeze({ timeout_ms: 5_000, max_request_bytes: 0, max_response_bytes: 96 * 1024 }),
  portfolio_governor_preview: Object.freeze({ timeout_ms: 12_000, max_request_bytes: 4 * 1024, max_response_bytes: 128 * 1024 }),
});

export const TerminalProviderLimits = Object.freeze({
  market_chart_data: Object.freeze({ concurrency: 6, max_queue: 24 }),
  hyperliquid_market_preview: Object.freeze({ concurrency: 6, max_queue: 24 }),
  hyperliquid_order_plan: Object.freeze({ concurrency: 6, max_queue: 24 }),
  hyperliquid_account_snapshot: Object.freeze({ concurrency: 4, max_queue: 12 }),
  hyperliquid_account_scenario: Object.freeze({ concurrency: 3, max_queue: 10 }),
  hyperliquid_account_history: Object.freeze({ concurrency: 2, max_queue: 8 }),
  jupiter_direct_quote: Object.freeze({ concurrency: 6, max_queue: 24 }),
  solana_spot_quote_preview: Object.freeze({ concurrency: 4, max_queue: 12 }),
  public_solana_holders: Object.freeze({ concurrency: 4, max_queue: 12 }),
  portfolio_solana_rpc: Object.freeze({ concurrency: 6, max_queue: 18 }),
  portfolio_jupiter_price: Object.freeze({ concurrency: 3, max_queue: 8 }),
  portfolio_jupiter_exit_value: Object.freeze({ concurrency: 4, max_queue: 12 }),
  transaction_construction: Object.freeze({ concurrency: 4, max_queue: 16 }),
});

const runtimeState = {
  routes: new Map(),
  providers: new Map(),
  chartUsage: new Map(),
  recentEvents: [],
  signingAttempts: 0,
};

export function recordCandleProviderUsage(usage = {}, { emit_structured_log = false } = {}) {
  const provider = sanitizeReasonCode(usage.provider || "unknown");
  const interval = sanitizeReasonCode(usage.interval || "unknown");
  const candleMode = sanitizeReasonCode(usage.candle_mode || "unknown");
  const key = `${provider}:${interval}:${candleMode}`;
  const metrics = runtimeState.chartUsage.get(key) || {
    provider,
    interval,
    candle_mode: candleMode,
    viewer_request_signals: 0,
    provider_requests: 0,
    cache_hits: 0,
    fallback_events: 0,
    last_source_interval: null,
    projected_cost_usd: null,
    projected_cost_state: "unavailable",
  };
  metrics.viewer_request_signals += Math.max(0, Number(usage.active_viewer_signal || 1));
  metrics.provider_requests += Math.max(0, Number(usage.provider_request_count || 0));
  if (usage.cache_hit) metrics.cache_hits += 1;
  if (usage.fallback_event) metrics.fallback_events += 1;
  metrics.last_source_interval = sanitizeReasonCode(usage.source_interval || usage.interval || "unknown");
  metrics.projected_cost_state = sanitizeReasonCode(usage.projected_cost_state || "unavailable");
  if (Number.isFinite(Number(usage.projected_cost_usd))) {
    metrics.projected_cost_usd = Number(((metrics.projected_cost_usd || 0) + Number(usage.projected_cost_usd)).toFixed(8));
  }
  runtimeState.chartUsage.set(key, metrics);
  if (runtimeState.chartUsage.size > 96) runtimeState.chartUsage.delete(runtimeState.chartUsage.keys().next().value);
  if (emit_structured_log) {
    console.log(JSON.stringify({
      event: "ravenos_chart_provider_usage",
      at: nowIso(),
      provider,
      pool: String(usage.pool || "").slice(0, 180),
      interval,
      source_interval: metrics.last_source_interval,
      cache_hit: Boolean(usage.cache_hit),
      candle_mode: candleMode,
      fallback_event: Boolean(usage.fallback_event),
      active_viewer_signal: Math.max(0, Number(usage.active_viewer_signal || 1)),
      provider_request_count: Math.max(0, Number(usage.provider_request_count || 0)),
      projected_cost_usd: Number.isFinite(Number(usage.projected_cost_usd)) ? Number(usage.projected_cost_usd) : null,
      projected_cost_state: metrics.projected_cost_state,
    }));
  }
}

const semaphores = new Map();
const inflight = new Map();

function pushRecentEvent(event) {
  runtimeState.recentEvents.push(event);
  if (runtimeState.recentEvents.length > RECENT_EVENT_LIMIT) {
    runtimeState.recentEvents.splice(0, runtimeState.recentEvents.length - RECENT_EVENT_LIMIT);
  }
}

function bumpMetric(map, key, field, amount = 1) {
  const entry = map.get(key) || {};
  entry[field] = Number(entry[field] || 0) + amount;
  map.set(key, entry);
  return entry;
}

function nowIso() {
  return new Date().toISOString();
}

function byteLengthUtf8(text = "") {
  return Buffer.byteLength(String(text), "utf8");
}

function routeBudget(route = "") {
  return TerminalRouteBudgets[route] || Object.freeze({
    timeout_ms: 2_000,
    max_request_bytes: DEFAULT_REQUEST_BUDGET_BYTES,
    max_response_bytes: DEFAULT_RESPONSE_BUDGET_BYTES,
  });
}

function providerLimit(component = "") {
  return TerminalProviderLimits[component] || Object.freeze({ concurrency: 4, max_queue: 16 });
}

export function createTerminalRuntimeError(code, message) {
  const error = new Error(String(message || code || "terminal_runtime_error"));
  error.code = String(code || "terminal_runtime_error");
  return error;
}

export function sanitizeReasonCode(value, fallback = "unknown") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  return text.replace(/[^a-z0-9_:-]+/g, "_").slice(0, 96) || fallback;
}

export function createTerminalRequestContext({
  request,
  route = "",
  buildId = "",
  schemaVersion = "",
  clientOperationType = "",
  providerComponent = "",
} = {}) {
  const url = request ? new URL(request.url) : null;
  return {
    request_id: request?.headers?.get?.("x-request-id") || randomUUID(),
    route: route || url?.pathname || "",
    build_id: String(buildId || ""),
    schema_version: String(schemaVersion || ""),
    client_operation_type: String(clientOperationType || ""),
    provider_component: String(providerComponent || ""),
    started_at: nowIso(),
    started_at_ms: Date.now(),
    method: request?.method || "GET",
  };
}

export function recordSigningAttempt(details = {}) {
  runtimeState.signingAttempts += 1;
  pushRecentEvent({
    kind: "signing_attempt",
    at: nowIso(),
    route: details.route || "",
    reason: sanitizeReasonCode(details.reason || "unexpected_signing_path"),
  });
}

export function recordProviderComponentEvent({
  component,
  category = "success",
  latency_ms = null,
  cache_hit = false,
  coalesced = false,
  rate_limited = false,
  reason_code = null,
} = {}) {
  const key = String(component || "unknown");
  const metrics = runtimeState.providers.get(key) || {
    requests: 0,
    success: 0,
    failure: 0,
    cache_hits: 0,
    coalesced: 0,
    rate_limited: 0,
    last_latency_ms: null,
    last_reason_code: null,
  };
  metrics.requests += 1;
  if (category === "success") metrics.success += 1;
  else metrics.failure += 1;
  if (cache_hit) metrics.cache_hits += 1;
  if (coalesced) metrics.coalesced += 1;
  if (rate_limited) metrics.rate_limited += 1;
  if (latency_ms != null) metrics.last_latency_ms = Number(latency_ms);
  if (reason_code) metrics.last_reason_code = sanitizeReasonCode(reason_code);
  runtimeState.providers.set(key, metrics);
  pushRecentEvent({
    kind: "provider",
    at: nowIso(),
    component: key,
    category: sanitizeReasonCode(category),
    latency_ms: latency_ms == null ? null : Number(latency_ms),
    cache_hit: Boolean(cache_hit),
    coalesced: Boolean(coalesced),
    rate_limited: Boolean(rate_limited),
    reason_code: reason_code ? sanitizeReasonCode(reason_code) : null,
  });
}

export function finishTerminalRequestContext(context, {
  status_code = 200,
  result_category = "ok",
  degraded_reason = null,
  response_bytes = null,
  provider_component = null,
} = {}) {
  const key = String(context?.route || "unknown");
  const metrics = runtimeState.routes.get(key) || {
    requests: 0,
    success: 0,
    failure: 0,
    degraded: 0,
    total_duration_ms: 0,
    last_duration_ms: null,
    last_status_code: null,
    last_result_category: null,
    max_response_bytes: 0,
  };
  const durationMs = Math.max(0, Date.now() - Number(context?.started_at_ms || Date.now()));
  metrics.requests += 1;
  metrics.total_duration_ms += durationMs;
  metrics.last_duration_ms = durationMs;
  metrics.last_status_code = Number(status_code || 0);
  metrics.last_result_category = sanitizeReasonCode(result_category || "unknown");
  if (status_code >= 200 && status_code < 400) metrics.success += 1;
  else metrics.failure += 1;
  if (metrics.last_result_category !== "ok") metrics.degraded += 1;
  if (response_bytes != null) metrics.max_response_bytes = Math.max(metrics.max_response_bytes || 0, Number(response_bytes));
  runtimeState.routes.set(key, metrics);
  pushRecentEvent({
    kind: "route",
    at: nowIso(),
    request_id: context?.request_id || "",
    route: key,
    status_code: Number(status_code || 0),
    result_category: metrics.last_result_category,
    degraded_reason: degraded_reason ? sanitizeReasonCode(degraded_reason) : null,
    duration_ms: durationMs,
    response_bytes: response_bytes == null ? null : Number(response_bytes),
    provider_component: provider_component || context?.provider_component || "",
  });
}

export function getTerminalDiagnosticsSummary() {
  const routes = Object.fromEntries(Array.from(runtimeState.routes.entries()).map(([route, value]) => [route, {
    ...value,
    average_duration_ms: value.requests ? Number((value.total_duration_ms / value.requests).toFixed(1)) : 0,
  }]));
  const providers = Object.fromEntries(runtimeState.providers.entries());
  const chartUsage = Object.fromEntries(runtimeState.chartUsage.entries());
  return {
    generated_at: nowIso(),
    signing_attempts: runtimeState.signingAttempts,
    routes,
    providers,
    chart_usage: chartUsage,
    recent_events: runtimeState.recentEvents.slice(-32),
  };
}

export async function parseBoundedJsonBody(request, {
  max_bytes = DEFAULT_REQUEST_BUDGET_BYTES,
  require_json_content_type = true,
} = {}) {
  const contentType = String(request.headers.get("content-type") || "");
  const contentTypeLower = contentType.toLowerCase();
  if (
    require_json_content_type
    && contentType
    && !contentTypeLower.includes("application/json")
    && !contentTypeLower.startsWith("text/plain")
  ) {
    throw createTerminalRuntimeError("unsupported_content_type", "application/json required");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (max_bytes > 0 && Number.isFinite(contentLength) && contentLength > max_bytes) {
    throw createTerminalRuntimeError("request_too_large", "request exceeds byte budget");
  }
  const raw = await request.text();
  if (max_bytes > 0 && byteLengthUtf8(raw) > max_bytes) {
    throw createTerminalRuntimeError("request_too_large", "request exceeds byte budget");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw createTerminalRuntimeError("invalid_json", "invalid json body");
  }
}

export function terminalApiSecurityHeaders() {
  return {
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "cross-origin-resource-policy": "same-origin",
    "cross-origin-opener-policy": "same-origin",
    "x-frame-options": "DENY",
  };
}

function terminalHtmlCsp() {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src https://www.tradingview-widget.com https://s.tradingview.com",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self' https://api.jup.ag https://api.hyperliquid.xyz wss://api.hyperliquid.xyz https://api.dexscreener.com",
  ].join("; ");
}

function atlasHtmlCsp() {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src https://www.tradingview-widget.com https://s.tradingview.com",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
  ].join("; ");
}

function accountHtmlCsp() {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
  ].join("; ");
}

export function applyAssetSecurityHeaders(response, pathname = "") {
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", "max-age=31536000");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("x-frame-options", "DENY");
  if (
    pathname === "/terminal/"
    || pathname === "/terminal"
    || pathname.endsWith("/terminal/index.html")
    || pathname === "/discover/"
    || pathname === "/discover"
    || pathname.endsWith("/discover/index.html")
  ) {
    headers.set("content-security-policy", terminalHtmlCsp());
  } else if (pathname === "/atlas/" || pathname === "/atlas" || pathname.endsWith("/atlas/index.html")) {
    headers.set("content-security-policy", atlasHtmlCsp());
  } else if (
    pathname === "/account/"
    || pathname === "/account"
    || pathname.endsWith("/account/index.html")
    || pathname === "/account/intelligence/"
    || pathname === "/account/intelligence"
    || pathname.endsWith("/account/intelligence/index.html")
    || pathname === "/monitor/"
    || pathname === "/monitor"
    || pathname.endsWith("/monitor/index.html")
    || pathname === "/community/"
    || pathname === "/community"
    || pathname.endsWith("/community/index.html")
    || pathname === "/community/profile/"
    || pathname === "/community/profile"
    || pathname.endsWith("/community/profile/index.html")
    || /^\/@[a-z][a-z0-9_]{2,23}\/?$/i.test(pathname)
  ) {
    headers.set("content-security-policy", accountHtmlCsp());
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function boundedJsonResponse(payload, init = {}, {
  max_bytes = DEFAULT_RESPONSE_BUDGET_BYTES,
  terminal_security = true,
  fallback_payload = null,
} = {}) {
  let body = payload;
  let status = Number(init.status || 200);
  let text = JSON.stringify(body);
  if (max_bytes > 0 && byteLengthUtf8(text) > max_bytes) {
    body = fallback_payload || {
      ok: false,
      error: "response_too_large",
      message: "Response exceeded the public size budget.",
    };
    status = Math.max(status, 503);
    text = JSON.stringify(body);
  }
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(terminal_security ? terminalApiSecurityHeaders() : {}),
    ...(init.headers || {}),
  });
  return new Response(text, { status, headers });
}

export async function withOperationBudget(fn, {
  timeout_ms,
  on_timeout,
} = {}) {
  if (!Number.isFinite(timeout_ms) || timeout_ms <= 0) return fn();
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          if (typeof on_timeout === "function") resolve(on_timeout());
          else reject(createTerminalRuntimeError("operation_timeout", "operation timed out"));
        }, timeout_ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function semaphoreFor(component) {
  const key = String(component || "unknown");
  if (semaphores.has(key)) return semaphores.get(key);
  const limit = providerLimit(key);
  const semaphore = {
    active: 0,
    queue: [],
    limit: Number(limit.concurrency || 4),
    max_queue: Number(limit.max_queue || 16),
  };
  semaphores.set(key, semaphore);
  return semaphore;
}

async function acquireSemaphore(component) {
  const state = semaphoreFor(component);
  if (state.active < state.limit) {
    state.active += 1;
    return;
  }
  if (state.queue.length >= state.max_queue) {
    throw createTerminalRuntimeError("provider_backpressure", "provider concurrency budget exhausted");
  }
  await new Promise((resolve) => state.queue.push(resolve));
  state.active += 1;
}

function releaseSemaphore(component) {
  const state = semaphoreFor(component);
  state.active = Math.max(0, state.active - 1);
  const next = state.queue.shift();
  if (next) next();
}

export async function runProviderOperation({
  component,
  operation_key = null,
  fn,
} = {}) {
  const normalizedComponent = String(component || "unknown");
  const coalesceKey = operation_key ? `${normalizedComponent}:${operation_key}` : null;
  if (coalesceKey && inflight.has(coalesceKey)) {
    recordProviderComponentEvent({
      component: normalizedComponent,
      category: "success",
      coalesced: true,
      reason_code: "coalesced",
    });
    return inflight.get(coalesceKey);
  }
  const run = (async () => {
    const startedAt = Date.now();
    let acquired = false;
    try {
      await acquireSemaphore(normalizedComponent);
      acquired = true;
      const out = await fn();
      recordProviderComponentEvent({
        component: normalizedComponent,
        category: "success",
        latency_ms: Date.now() - startedAt,
        cache_hit: Boolean(out?.from_cache),
      });
      return out;
    } catch (error) {
      recordProviderComponentEvent({
        component: normalizedComponent,
        category: "failure",
        latency_ms: Date.now() - startedAt,
        reason_code: error?.code || error?.message || "provider_failure",
        rate_limited: String(error?.code || "").includes("backpressure"),
      });
      throw error;
    } finally {
      if (acquired) releaseSemaphore(normalizedComponent);
    }
  })();
  if (coalesceKey) inflight.set(coalesceKey, run);
  try {
    return await run;
  } finally {
    if (coalesceKey) inflight.delete(coalesceKey);
  }
}

export function buildTerminalHealthProjection(rawSnapshot = null) {
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    return {
      schema_version: "customer_trade_terminal_health_snapshot.v1",
      generated_at: null,
      terminal_availability: "unknown",
      market_data_availability: "unknown",
      quote_availability: "unknown",
      review_availability: "unknown",
      component_health: [],
      public_warnings: ["terminal_health_snapshot_unavailable"],
      degraded_reasons: ["terminal_health_snapshot_unavailable"],
      recovery_state: [],
    };
  }
  const componentHealth = Array.isArray(rawSnapshot.components)
    ? rawSnapshot.components.map((component) => ({
      component: String(component?.component || ""),
      state: String(component?.state || "unknown"),
      last_success_at: component?.last_success_at || null,
      observation_age_seconds: Number.isFinite(Number(component?.observation_age_seconds))
        ? Number(component.observation_age_seconds)
        : null,
      quote_review_blocking: Boolean(component?.quote_review_blocking),
      informational_only: Boolean(component?.informational_only),
      degraded_reason: component?.degraded_reason ? String(component.degraded_reason) : null,
      warnings: Array.isArray(component?.warnings) ? component.warnings.map((value) => String(value)) : [],
    }))
    : [];
  return {
    schema_version: rawSnapshot.schema_version || "customer_trade_terminal_health_snapshot.v1",
    generated_at: rawSnapshot.generated_at || null,
    terminal_availability: rawSnapshot.terminal_availability || "unknown",
    market_data_availability: rawSnapshot.market_data_availability || "unknown",
    quote_availability: rawSnapshot.quote_availability || "unknown",
    review_availability: rawSnapshot.review_availability || "unknown",
    component_health: componentHealth,
    public_warnings: Array.isArray(rawSnapshot.public_warnings) ? rawSnapshot.public_warnings : [],
    degraded_reasons: Array.isArray(rawSnapshot.degraded_reasons) ? rawSnapshot.degraded_reasons : [],
    recovery_state: Array.isArray(rawSnapshot.recovery_state) ? rawSnapshot.recovery_state : [],
  };
}

export { routeBudget, byteLengthUtf8 };
