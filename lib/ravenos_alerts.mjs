export const ALERT_TYPES = {
  flow_score_crosses_threshold: "Flow score crosses threshold",
  pressure_score_crosses_threshold: "Pressure score crosses threshold",
  replay_similarity_crosses_threshold: "Replay similarity crosses threshold",
  liquidity_attraction_changes: "Liquidity attraction changes",
  structure_state_changes: "Structure state changes",
  risk_rating_changes: "Risk rating changes",
  watchlist_instrument_changes: "Token/watchlist instrument changes",
  perps_setup_family_appears: "Perps setup family appears",
  structure_tape_event_appears: "Structure Tape event appears",
  founder_experimental_structure_event: "Founder experimental structure event",
};

const FOUNDER_ALERT_TYPES = new Set(["founder_experimental_structure_event"]);

export function alertsDb(env = {}) {
  return env.RAVENOS_DB || env.DB || null;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function alertId(prefix = "alert") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeAlertInput(input = {}) {
  const alertType = String(input.alert_type || input.alertType || "").trim();
  return {
    id: String(input.id || alertId()).trim(),
    user_id: String(input.user_id || input.userId || input.wallet || "").trim(),
    instrument: String(input.instrument || "").trim(),
    market: String(input.market || "Market").trim(),
    alert_type: alertType,
    condition: String(input.condition || "crosses_above").trim(),
    threshold: input.threshold === "" || input.threshold == null ? null : Number(input.threshold),
    enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
  };
}

export function validateAlert(input = {}, entitlements = ["free"]) {
  const alert = normalizeAlertInput(input);
  const errors = [];
  if (!alert.user_id) errors.push("missing_user_id");
  if (!alert.instrument) errors.push("missing_instrument");
  if (!ALERT_TYPES[alert.alert_type]) errors.push("invalid_alert_type");
  if (alert.threshold != null && !Number.isFinite(alert.threshold)) errors.push("invalid_threshold");
  if (!entitlements.includes("pro") && !entitlements.includes("founder")) errors.push("pro_required");
  if (FOUNDER_ALERT_TYPES.has(alert.alert_type) && !entitlements.includes("founder")) errors.push("founder_required");
  return { ok: errors.length === 0, errors, alert };
}

export async function listAlerts(env, userId) {
  const db = alertsDb(env);
  if (!db) return [];
  const result = await db
    .prepare("SELECT * FROM alerts WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId)
    .all();
  return result?.results || [];
}

export async function createAlert(env, input, entitlements = ["free"]) {
  const db = alertsDb(env);
  if (!db) throw new Error("alerts_db_unavailable");
  const checked = validateAlert(input, entitlements);
  if (!checked.ok) {
    const error = new Error(checked.errors[0] || "invalid_alert");
    error.errors = checked.errors;
    throw error;
  }
  const ts = nowSec();
  const alert = checked.alert;
  await db
    .prepare(`
      INSERT INTO alerts (
        id, user_id, instrument, market, alert_type, condition, threshold, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(alert.id, alert.user_id, alert.instrument, alert.market, alert.alert_type, alert.condition, alert.threshold, alert.enabled, ts, ts)
    .run();
  return { ...alert, created_at: ts, updated_at: ts };
}

export async function updateAlert(env, userId, alertIdValue, patch = {}, entitlements = ["free"]) {
  const db = alertsDb(env);
  if (!db) throw new Error("alerts_db_unavailable");
  const existing = await db
    .prepare("SELECT * FROM alerts WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(alertIdValue, userId)
    .first();
  if (!existing) throw new Error("alert_not_found");
  const next = {
    ...existing,
    instrument: patch.instrument ?? existing.instrument,
    market: patch.market ?? existing.market,
    alert_type: patch.alert_type ?? patch.alertType ?? existing.alert_type,
    condition: patch.condition ?? existing.condition,
    threshold: patch.threshold === undefined ? existing.threshold : patch.threshold,
    enabled: patch.enabled === undefined ? existing.enabled : (patch.enabled ? 1 : 0),
  };
  const checked = validateAlert(next, entitlements);
  if (!checked.ok) {
    const error = new Error(checked.errors[0] || "invalid_alert");
    error.errors = checked.errors;
    throw error;
  }
  const ts = nowSec();
  await db
    .prepare(`
      UPDATE alerts SET instrument = ?, market = ?, alert_type = ?, condition = ?, threshold = ?, enabled = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `)
    .bind(next.instrument, next.market, next.alert_type, next.condition, next.threshold, next.enabled, ts, alertIdValue, userId)
    .run();
  return { ...next, updated_at: ts };
}

export async function deleteAlert(env, userId, alertIdValue) {
  const db = alertsDb(env);
  if (!db) throw new Error("alerts_db_unavailable");
  await db
    .prepare("DELETE FROM alerts WHERE id = ? AND user_id = ?")
    .bind(alertIdValue, userId)
    .run();
  return { ok: true };
}

export async function listAlertEvents(env, userId, limit = 50) {
  const db = alertsDb(env);
  if (!db) return [];
  const result = await db
    .prepare("SELECT * FROM alert_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, Math.max(1, Math.min(200, Number(limit) || 50)))
    .all();
  return result?.results || [];
}
