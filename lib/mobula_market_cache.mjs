import { randomUUID } from 'node:crypto';
import { fetchMobulaTrades, mobulaTradeIdentity, projectMobulaTrades } from './mobula_trades.mjs';

export const MobulaMarketPolicy = Object.freeze({
  daily_requests: 200, monthly_requests: 6000, request_gap_ms: 1500,
  refresh_ms: 60000, failure_backoff_ms: 300000, retained_ms: 600000,
});

export function mobulaMarketEnabled(env = {}) {
  return env.RAVENOS_MOBULA_TRADES_ENABLED === '1' && Boolean(String(env.MOBULA_API_KEY || '').trim())
    && Boolean(env.RAVENOS_CUSTOMER_DB?.prepare);
}

export function createMobulaMarketStore(db) {
  if (!db?.prepare) throw Error('mobula_cache_unavailable');
  return {
    async read(key) {
      const row = await db.prepare('SELECT body_json,observed_at FROM ravenos_mobula_market_cache WHERE market_key=?').bind(key).first();
      if (!row) return null;
      try { return { payload: JSON.parse(row.body_json), observedAt: row.observed_at }; } catch { return null; }
    },
    async claim(key, now) {
      const day = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
      const month = Date.parse(new Date(now).toISOString().slice(0, 7) + '-01T00:00:00Z');
      const id = randomUUID(), p = MobulaMarketPolicy;
      // A single SQLite statement arbitrates all isolates: one request per
      // market/minute, one provider request/1.5s, and daily/monthly ceilings.
      // Failed calls still consume the reserved credit; nothing refunds them.
      const result = await db.prepare(`INSERT INTO ravenos_mobula_market_requests
        (request_id,market_key,requested_at,status) SELECT ?,?,?,'reserved'
        WHERE NOT EXISTS (SELECT 1 FROM ravenos_mobula_market_requests WHERE requested_at>?)
        AND NOT EXISTS (SELECT 1 FROM ravenos_mobula_market_requests WHERE market_key=?
          AND requested_at>?-CASE WHEN status='failed' THEN ? ELSE ? END)
        AND NOT EXISTS (SELECT 1 FROM ravenos_mobula_market_requests WHERE
          (error_code='mobula_http_429' AND requested_at>?) OR
          (error_code IN ('mobula_http_401','mobula_http_403') AND requested_at>?))
        AND (SELECT COUNT(*) FROM ravenos_mobula_market_requests WHERE requested_at>=?)<?
        AND (SELECT COUNT(*) FROM ravenos_mobula_market_requests WHERE requested_at>=?)<?`)
        .bind(id,key,now,now-p.request_gap_ms,key,now,p.failure_backoff_ms,p.refresh_ms,
          now-60000,now-3600000,day,p.daily_requests,month,p.monthly_requests).run();
      if (result.meta?.changes) return { id };
      const totals = await db.prepare(`SELECT COUNT(*) AS monthly,
        SUM(CASE WHEN requested_at>=? THEN 1 ELSE 0 END) AS daily
        FROM ravenos_mobula_market_requests WHERE requested_at>=?`).bind(day,month).first();
      if (totals.monthly >= p.monthly_requests || totals.daily >= p.daily_requests) return { error: 'onchain_trade_budget_limited' };
      const failure = await db.prepare(`SELECT 1 FROM ravenos_mobula_market_requests WHERE
        (market_key=? AND status='failed' AND requested_at>?) OR
        (error_code='mobula_http_429' AND requested_at>?) OR
        (error_code IN ('mobula_http_401','mobula_http_403') AND requested_at>?) LIMIT 1`)
        .bind(key,now-p.failure_backoff_ms,now-60000,now-3600000).first();
      return { error: failure ? 'mobula_transport_unavailable' : 'onchain_trade_refresh_pending' };
    },
    async finish(id, error = null) {
      const code = error && /^mobula_[a-z0-9_]{1,60}$/.test(String(error.message)) ? error.message : error ? 'mobula_unavailable' : null;
      await db.prepare("UPDATE ravenos_mobula_market_requests SET status=?,error_code=? WHERE request_id=? AND status='reserved'")
        .bind(error ? 'failed' : 'ok', code, id).run();
    },
    async write(key, payload, now) {
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).byteLength > 512 * 1024) throw Error('mobula_cache_payload_too_large');
      await db.prepare(`INSERT INTO ravenos_mobula_market_cache VALUES (?,?,?)
        ON CONFLICT(market_key) DO UPDATE SET body_json=excluded.body_json,observed_at=excluded.observed_at
        WHERE excluded.observed_at>=ravenos_mobula_market_cache.observed_at`).bind(key,body,now).run();
      await db.prepare('DELETE FROM ravenos_mobula_market_cache WHERE observed_at<?').bind(now-86400000).run();
      await db.prepare('DELETE FROM ravenos_mobula_market_requests WHERE requested_at<?').bind(now-40*86400000).run();
    },
  };
}

function cachedProjection(entry, identity, now, delayed = false) {
  const p = entry?.payload, observedAt = entry?.observedAt;
  if (!p?.ok || p.source?.label !== 'Mobula' || p.source?.attribution_url !== 'https://mobula.io'
    || p.schema_version !== 'ravenos.onchain_pool_trades.v1' || !Number.isFinite(observedAt)
    || now-observedAt < 0 || now-observedAt > MobulaMarketPolicy.retained_ms
    || Object.keys(identity).some(key => p.identity?.[key] !== identity[key])) return null;
  const retained = delayed || now-observedAt > 120000;
  return { ...p,
    freshness: { ...p.freshness, state: !retained && now-Date.parse(p.freshness.latest_trade_at) <= 120000 ? 'live' : 'recent' },
    delivery: { state: retained ? 'retained' : 'current', source_observed_at: new Date(observedAt).toISOString(),
      refresh_after: new Date(Math.max(now+15000,observedAt+MobulaMarketPolicy.refresh_ms)).toISOString() },
  };
}

export async function loadMobulaMarketTrades(input, { env, store = null, fetchImpl = fetch, now = Date.now } = {}) {
  const identity = mobulaTradeIdentity(input);
  if (!identity) throw Error('onchain_trade_identity_invalid');
  if (!mobulaMarketEnabled(env)) throw Error('onchain_trade_provider_unavailable');
  const db = store || createMobulaMarketStore(env.RAVENOS_CUSTOMER_DB);
  const key = `${identity.chain}:${identity.pool_address}:${identity.token_address}:${identity.quote_token_address}`;
  const startedAt = now(), cached = await db.read(key);
  const current = cachedProjection(cached, identity, startedAt);
  if (current && startedAt-cached.observedAt < MobulaMarketPolicy.refresh_ms) return current;
  const reservation = await db.claim(key, startedAt);
  if (!reservation.id) {
    const retained = cachedProjection(cached || await db.read(key), identity, now(), true);
    if (retained) return retained;
    throw Error(reservation.error);
  }
  try {
    const provider = await fetchMobulaTrades(identity, env.MOBULA_API_KEY, { fetchImpl });
    const receivedAt = now();
    const projection = projectMobulaTrades(provider, identity, { now: receivedAt, observedAt: receivedAt });
    if (!projection.ok) throw Error(provider.data.length ? 'mobula_no_matching_recent_swaps' : 'mobula_not_indexed');
    await db.write(key, projection, receivedAt);
    await db.finish(reservation.id);
    return cachedProjection({ payload: projection, observedAt: receivedAt }, identity, receivedAt);
  } catch (error) {
    await db.finish(reservation.id, error);
    const retained = cachedProjection(cached, identity, now(), true);
    if (retained) return retained;
    throw error;
  }
}
