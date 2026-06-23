export const WATCHLIST_LIMITS = {
  free: { watchlists: 1, itemsPerWatchlist: 5 },
  pro: { watchlists: 100, itemsPerWatchlist: 1000 },
  founder: { watchlists: 200, itemsPerWatchlist: 2000 },
  atlas: { watchlists: 1, itemsPerWatchlist: 5 },
};

export function watchlistsDb(env = {}) {
  return env.RAVENOS_DB || env.DB || null;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function watchlistId(prefix = "watchlist") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function accessBand(entitlements = ["free"]) {
  if (entitlements.includes("founder")) return "founder";
  if (entitlements.includes("pro")) return "pro";
  return "free";
}

export function watchlistLimits(entitlements = ["free"]) {
  return WATCHLIST_LIMITS[accessBand(entitlements)] || WATCHLIST_LIMITS.free;
}

export function normalizeWatchlistInput(input = {}) {
  return {
    id: String(input.id || watchlistId()).trim(),
    user_id: String(input.user_id || input.userId || input.wallet || "").trim(),
    name: String(input.name || "Primary Watchlist").trim().slice(0, 80),
  };
}

export function normalizeWatchlistItemInput(input = {}) {
  return {
    id: String(input.id || watchlistId("watchitem")).trim(),
    watchlist_id: String(input.watchlist_id || input.watchlistId || "").trim(),
    user_id: String(input.user_id || input.userId || input.wallet || "").trim(),
    instrument: String(input.instrument || input.asset || "").trim().slice(0, 80),
    market: String(input.market || "Market").trim().slice(0, 80),
    price: numericOrNull(input.price ?? input.lastPrice),
    flow_score: numericOrNull(input.flow_score ?? input.flowScore),
    pressure_score: numericOrNull(input.pressure_score ?? input.pressureScore),
    replay_similarity: numericOrNull(input.replay_similarity ?? input.replaySimilarity),
    risk: String(input.risk || input.riskRating || "Unrated").trim().slice(0, 40),
    coverage: String(input.coverage || "Preview").trim().slice(0, 40),
    provider: String(input.provider || input.source || "").trim().slice(0, 80),
    source_payload: input.source_payload || input.sourcePayload || null,
  };
}

function numericOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function listWatchlists(env, userId) {
  const db = watchlistsDb(env);
  if (!db) return [];
  const lists = await db
    .prepare("SELECT * FROM watchlists WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId)
    .all();
  const rows = lists?.results || [];
  const withItems = [];
  for (const row of rows) {
    const items = await listWatchlistItems(env, userId, row.id);
    withItems.push({ ...row, items });
  }
  return withItems;
}

export async function listWatchlistItems(env, userId, watchlistIdValue) {
  const db = watchlistsDb(env);
  if (!db) return [];
  const result = await db
    .prepare("SELECT * FROM watchlist_items WHERE user_id = ? AND watchlist_id = ? ORDER BY updated_at DESC")
    .bind(userId, watchlistIdValue)
    .all();
  return result?.results || [];
}

async function countRows(env, sql, ...params) {
  const db = watchlistsDb(env);
  const row = await db.prepare(sql).bind(...params).first();
  return Number(row?.count || row?.COUNT || row?.["COUNT(*)"] || 0);
}

export async function createWatchlist(env, input, entitlements = ["free"]) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  const row = normalizeWatchlistInput(input);
  if (!row.user_id) throw new Error("missing_user_id");
  if (!row.name) throw new Error("missing_name");
  const limits = watchlistLimits(entitlements);
  const currentCount = await countRows(env, "SELECT COUNT(*) AS count FROM watchlists WHERE user_id = ?", row.user_id);
  if (currentCount >= limits.watchlists) throw new Error("watchlist_limit_reached");
  const ts = nowSec();
  await db
    .prepare("INSERT INTO watchlists (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.name, ts, ts)
    .run();
  return { ...row, created_at: ts, updated_at: ts, items: [] };
}

export async function getOrCreateDefaultWatchlist(env, userId, entitlements = ["free"]) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  const existing = await db
    .prepare("SELECT * FROM watchlists WHERE user_id = ? ORDER BY created_at ASC LIMIT 1")
    .bind(userId)
    .first();
  if (existing) return existing;
  return createWatchlist(env, { user_id: userId, name: "Primary Watchlist" }, entitlements);
}

export async function updateWatchlist(env, userId, watchlistIdValue, patch = {}) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  const name = String(patch.name || "").trim().slice(0, 80);
  if (!name) throw new Error("missing_name");
  const ts = nowSec();
  await db
    .prepare("UPDATE watchlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(name, ts, watchlistIdValue, userId)
    .run();
  return { id: watchlistIdValue, user_id: userId, name, updated_at: ts };
}

export async function deleteWatchlist(env, userId, watchlistIdValue) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  await db.prepare("DELETE FROM watchlist_items WHERE watchlist_id = ? AND user_id = ?").bind(watchlistIdValue, userId).run();
  await db.prepare("DELETE FROM watchlists WHERE id = ? AND user_id = ?").bind(watchlistIdValue, userId).run();
  return { ok: true };
}

export async function addWatchlistItem(env, input, entitlements = ["free"]) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  const item = normalizeWatchlistItemInput(input);
  if (!item.user_id) throw new Error("missing_user_id");
  if (!item.instrument) throw new Error("missing_instrument");
  if (!item.watchlist_id) {
    const list = await getOrCreateDefaultWatchlist(env, item.user_id, entitlements);
    item.watchlist_id = list.id;
  }
  const limits = watchlistLimits(entitlements);
  const currentCount = await countRows(env, "SELECT COUNT(*) AS count FROM watchlist_items WHERE user_id = ? AND watchlist_id = ?", item.user_id, item.watchlist_id);
  if (currentCount >= limits.itemsPerWatchlist) throw new Error("watchlist_item_limit_reached");
  const ts = nowSec();
  await db
    .prepare(`
      INSERT INTO watchlist_items (
        id, watchlist_id, user_id, instrument, market, price, flow_score, pressure_score,
        replay_similarity, risk, coverage, provider, source_payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watchlist_id, instrument, market) DO UPDATE SET
        price = excluded.price,
        flow_score = excluded.flow_score,
        pressure_score = excluded.pressure_score,
        replay_similarity = excluded.replay_similarity,
        risk = excluded.risk,
        coverage = excluded.coverage,
        provider = excluded.provider,
        source_payload = excluded.source_payload,
        updated_at = excluded.updated_at
    `)
    .bind(
      item.id,
      item.watchlist_id,
      item.user_id,
      item.instrument,
      item.market,
      item.price,
      item.flow_score,
      item.pressure_score,
      item.replay_similarity,
      item.risk,
      item.coverage,
      item.provider,
      item.source_payload ? JSON.stringify(item.source_payload) : null,
      ts,
      ts,
    )
    .run();
  await db.prepare("UPDATE watchlists SET updated_at = ? WHERE id = ? AND user_id = ?").bind(ts, item.watchlist_id, item.user_id).run();
  return { ...item, created_at: ts, updated_at: ts };
}

export async function deleteWatchlistItem(env, userId, itemIdValue) {
  const db = watchlistsDb(env);
  if (!db) throw new Error("watchlists_db_unavailable");
  await db.prepare("DELETE FROM watchlist_items WHERE id = ? AND user_id = ?").bind(itemIdValue, userId).run();
  return { ok: true };
}
