import assert from "node:assert/strict";
import {
  ALERT_TYPES,
  createAlert,
  listAlertEvents,
  listAlerts,
  updateAlert,
  validateAlert,
} from "../lib/ravenos_alerts.mjs";

function memoryDb() {
  const alerts = [];
  const events = [];
  return {
    alerts,
    events,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all: async () => {
              if (sql.includes("FROM alerts")) {
                return { results: alerts.filter((row) => row.user_id === params[0]).sort((a, b) => b.updated_at - a.updated_at) };
              }
              if (sql.includes("FROM alert_events")) {
                return { results: events.filter((row) => row.user_id === params[0]).slice(0, params[1] || 50) };
              }
              return { results: [] };
            },
            first: async () => {
              if (sql.includes("FROM alerts")) return alerts.find((row) => row.id === params[0] && row.user_id === params[1]) || null;
              return null;
            },
            run: async () => {
              if (sql.includes("INSERT INTO alerts")) {
                alerts.push({
                  id: params[0],
                  user_id: params[1],
                  instrument: params[2],
                  market: params[3],
                  alert_type: params[4],
                  condition: params[5],
                  threshold: params[6],
                  enabled: params[7],
                  created_at: params[8],
                  updated_at: params[9],
                });
              } else if (sql.includes("UPDATE alerts SET")) {
                const row = alerts.find((item) => item.id === params[7] && item.user_id === params[8]);
                if (row) {
                  Object.assign(row, {
                    instrument: params[0],
                    market: params[1],
                    alert_type: params[2],
                    condition: params[3],
                    threshold: params[4],
                    enabled: params[5],
                    updated_at: params[6],
                  });
                }
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

assert.ok(ALERT_TYPES.flow_score_crosses_threshold);

const freeCheck = validateAlert({
  user_id: "wallet-free",
  instrument: "SOL-PERP",
  alert_type: "pressure_score_crosses_threshold",
}, ["free"]);
assert.equal(freeCheck.ok, false);
assert.ok(freeCheck.errors.includes("pro_required"));

const founderCheck = validateAlert({
  user_id: "wallet-pro",
  instrument: "SOL-PERP",
  alert_type: "founder_experimental_structure_event",
}, ["free", "pro"]);
assert.equal(founderCheck.ok, false);
assert.ok(founderCheck.errors.includes("founder_required"));

const db = memoryDb();
const env = { RAVENOS_DB: db };
const created = await createAlert(env, {
  id: "alert_test",
  user_id: "wallet-pro",
  instrument: "SOL-PERP",
  market: "Perpetual Futures",
  alert_type: "pressure_score_crosses_threshold",
  condition: "crosses_above",
  threshold: 75,
}, ["free", "pro"]);
assert.equal(created.id, "alert_test");
assert.equal(created.enabled, 1);

const rows = await listAlerts(env, "wallet-pro");
assert.equal(rows.length, 1);
assert.equal(rows[0].instrument, "SOL-PERP");

const updated = await updateAlert(env, "wallet-pro", "alert_test", { enabled: false, threshold: 80 }, ["free", "pro"]);
assert.equal(updated.enabled, 0);
assert.equal(updated.threshold, 80);

await assert.rejects(
  () => updateAlert(env, "wallet-pro", "alert_test", { threshold: 90 }, ["free"]),
  /pro_required/,
);

assert.deepEqual(await listAlertEvents(env, "wallet-pro"), []);
