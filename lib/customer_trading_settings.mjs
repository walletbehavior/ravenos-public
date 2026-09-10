import { authorizeCustomerApiRequest, consumeCustomerRateLimit } from './customer_identity.mjs';
import { boundedJsonResponse, parseBoundedJsonBody } from './customer_trade/terminal_runtime.mjs';
import { defaultTradingSettings, normalizeTradingSettings, TRADING_SETTINGS_SCHEMA } from '../ravenos-trading-strategy.js';

export const CUSTOMER_TRADING_SETTINGS_ROUTE = '/api/v1/trading-settings';
export function createTradingSettingsStore(db) {
  return {
    get: userId => db.prepare('SELECT revision,settings_json,updated_at FROM ravenos_customer_trading_settings WHERE user_id=?').bind(userId).first(),
    save: (userId, settings, revision, now) => db.prepare(`INSERT INTO ravenos_customer_trading_settings
      (user_id,revision,settings_json,created_at,updated_at) SELECT ?,1,?,?,? WHERE ?=0
      ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,revision=revision+1,updated_at=excluded.updated_at
      WHERE revision=? RETURNING revision,settings_json,updated_at`).bind(userId, JSON.stringify(settings), now, now, revision, revision).first(),
    update: (userId, settings, revision, now) => db.prepare(`UPDATE ravenos_customer_trading_settings SET settings_json=?,revision=revision+1,updated_at=?
      WHERE user_id=? AND revision=? RETURNING revision,settings_json,updated_at`).bind(JSON.stringify(settings), now, userId, revision).first(),
  };
}
function json(body, status = 200, authorization) {
  const headers = { 'cache-control': 'private, no-store', vary: 'Cookie' };
  const cookie = authorization?.response_headers?.get('set-cookie');
  if (cookie) headers['set-cookie'] = cookie;
  return boundedJsonResponse(body, { status, headers }, { max_bytes: 48 * 1024,
    fallback_payload: { ok: false, error: 'trading_settings_response_invalid' } });
}
function storedSettings(row) {
  try { return normalizeTradingSettings(JSON.parse(row.settings_json)); }
  catch { throw Error('trading_settings_store_invalid'); }
}
function view(row) {
  return { revision: row?.revision || 0, settings: row ? storedSettings(row) : defaultTradingSettings(),
    updated_at: row ? new Date(row.updated_at * 1000).toISOString() : null, order_activation: false };
}
export async function routeCustomerTradingSettings(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname !== CUSTOMER_TRADING_SETTINGS_ROUTE) return null;
  if (!['GET', 'PUT'].includes(request.method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (url.search || (request.headers.has('origin') && request.headers.get('origin') !== url.origin)
    || !['', 'same-origin', 'none'].includes(request.headers.get('sec-fetch-site') || '')) return json({ ok: false, error: 'request_not_allowed' }, 403);
  const auth = await authorizeCustomerApiRequest(request, env, deps, { require_csrf: request.method !== 'GET' });
  if (auth.response) return auth.response;
  const store = deps.settingsStore || createTradingSettingsStore(env.RAVENOS_CUSTOMER_DB);
  const userId = auth.principal.user_id;
  try {
    const rate = await consumeCustomerRateLimit({ store: auth.store, env, request, action: 'customer_trading_settings',
      scope: request.method, subject: userId, now: auth.now, window_seconds: 900, limit: request.method === 'GET' ? 120 : 40 });
    if (!rate.allowed) return json({ ok: false, error: 'trading_settings_rate_limited' }, 429, auth);
    if (request.method === 'GET') return json({ ok: true, schema_version: TRADING_SETTINGS_SCHEMA, ...view(await store.get(userId)) }, 200, auth);
    const body = await parseBoundedJsonBody(request, { max_bytes: 32 * 1024, stream_bounded: true });
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['settings', 'expected_revision'].includes(key)) || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) {
      return json({ ok: false, error: 'trading_settings_request_invalid' }, 400, auth);
    }
    const settings = normalizeTradingSettings(body.settings);
    const prior = await store.get(userId);
    if ((prior?.revision || 0) !== body.expected_revision) return json({ ok: false, error: 'trading_settings_revision_conflict' }, 409, auth);
    // A library edit creates a new version; existing watches retain their copied policy.
    const oldStrategies = new Map((prior ? storedSettings(prior).strategies : []).map(row => [row.id, row]));
    for (const strategy of settings.strategies) {
      const old = oldStrategies.get(strategy.id);
      strategy.version = !old ? 1 : JSON.stringify({ ...old, version: 0 }) === JSON.stringify({ ...strategy, version: 0 }) ? old.version : old.version + 1;
      if (strategy.version > 1000000) return json({ ok: false, error: 'strategy_version_invalid' }, 400, auth);
    }
    const row = body.expected_revision === 0 ? await store.save(userId, settings, 0, auth.now) : await store.update(userId, settings, body.expected_revision, auth.now);
    if (!row) return json({ ok: false, error: 'trading_settings_revision_conflict' }, 409, auth);
    return json({ ok: true, schema_version: TRADING_SETTINGS_SCHEMA, ...view(row) }, 200, auth);
  } catch (error) {
    const code = String(error?.code || error?.message || '');
    if (/^(strategy_|quick_|trading_settings_(invalid|slippage_invalid)|request_too_large|request_invalid|invalid_json|unsupported_content_type)/.test(code)) return json({ ok: false, error: code }, code === 'request_too_large' ? 413 : 400, auth);
    return json({ ok: false, error: 'trading_settings_unavailable' }, 503, auth);
  }
}
