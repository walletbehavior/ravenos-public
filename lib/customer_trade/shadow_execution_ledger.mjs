import { createHash, randomUUID } from "node:crypto";

export const SHADOW_ROUTE_OBSERVATION_SCHEMA = "ravenos.shadow_route_observation.v1";
export const SHADOW_ROUTE_CHECKPOINT_SCHEMA = "ravenos.shadow_route_checkpoint.v1";
export const SHADOW_ROUTE_READINESS_SCHEMA = "ravenos.shadow_route_readiness.v1";

export const ShadowRouteLedgerLimits = Object.freeze({
  sample_window_seconds: 300,
  retention_seconds: 30 * 24 * 60 * 60,
  summary_window_seconds: 24 * 60 * 60,
  maximum_summary_rows: 5_000,
  evaluator_batch_size: 8,
  evaluator_lease_seconds: 240,
  checkpoint_horizons_seconds: Object.freeze([300, 3_600, 14_400, 86_400, 604_800]),
});

const ROUTE_STATES = new Set([
  "buy_quoteable",
  "sell_quoteable",
  "exit_verified",
  "executable",
  "stale",
  "unrouteable",
  "restricted",
  "unsafe",
  "unavailable",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanText(value, field, maximum = 220, { optional = false, lower = false } = {}) {
  const clean = String(value ?? "").trim();
  if ((!optional && !clean) || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) fail(`${field}_invalid`);
  return lower ? clean.toLowerCase() : clean;
}

function finite(value, field, { optional = false, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function unix(value, field) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) fail(`${field}_invalid`);
  return Math.floor(ms / 1_000);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function amountBucket(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "unavailable";
  if (amount <= 25) return "usdc_0_25";
  if (amount <= 100) return "usdc_25_100";
  if (amount <= 1_000) return "usdc_100_1000";
  if (amount <= 10_000) return "usdc_1000_10000";
  return "usdc_10000_plus";
}

function optionalBoolean(value) {
  return value === true ? 1 : 0;
}

function limitationRows(shadowExecution = {}) {
  return [...new Set([
    ...(Array.isArray(shadowExecution?.round_trip?.unavailable_cost_components) ? shadowExecution.round_trip.unavailable_cost_components : []),
    ...(Array.isArray(shadowExecution?.refusal_reasons) ? shadowExecution.refusal_reasons : []),
  ].map((value) => cleanText(value, "limitation", 120, { optional: true, lower: true })).filter(Boolean))].slice(0, 16);
}

export function createShadowRouteObservation({
  instrument_id,
  chain_id,
  side = "buy",
  quote,
  shadow_execution,
  provider_latency_ms = null,
  slippage_bps,
  observed_at,
} = {}) {
  const instrumentId = cleanText(instrument_id, "instrument_id", 220);
  const chainId = cleanText(chain_id, "chain_id", 32, { lower: true });
  const direction = cleanText(side, "side", 8, { lower: true });
  if (!new Set(["buy", "sell"]).has(direction)) fail("side_invalid");
  if (!shadow_execution || shadow_execution.mode !== "shadow") fail("shadow_execution_required");
  if (shadow_execution.execution?.signing_available || shadow_execution.execution?.submission_available || shadow_execution.execution?.transaction_material_available) {
    fail("shadow_execution_authority_forbidden");
  }
  const request = shadow_execution.request || {};
  const entry = shadow_execution.entry_route || null;
  const exit = shadow_execution.exit_route || null;
  const roundTrip = shadow_execution.round_trip || {};
  const routeState = cleanText(shadow_execution.route_state || "unavailable", "route_state", 32, { lower: true });
  if (!ROUTE_STATES.has(routeState)) fail("route_state_invalid");
  const sourceAmount = finite(request.source_amount_usdc, "source_amount_usdc", { optional: true, minimum: 0.01, maximum: 1_000_000 });
  const observedAt = unix(observed_at || shadow_execution.observed_at, "observed_at");
  const quotedAt = unix(entry?.created_at || shadow_execution.observed_at, "quoted_at");
  const expiresAt = unix(entry?.expires_at, "expires_at");
  if (expiresAt <= quotedAt || observedAt < quotedAt) fail("observation_timing_invalid");
  const provider = cleanText(entry?.provider || quote?.provider || "unknown", "provider_id", 80, { lower: true });
  const amountBand = amountBucket(sourceAmount);
  const sampleWindow = Math.floor(observedAt / ShadowRouteLedgerLimits.sample_window_seconds);
  const sampleKey = digest([sampleWindow, instrumentId, direction, amountBand, provider, routeState, slippage_bps].join("|"));
  const observationId = `shr_${sampleKey.slice(0, 32)}`;
  const destinationBaseUnits = String(quote?.expected_output_amount_base_units || "").trim();
  if (destinationBaseUnits && !/^\d+$/.test(destinationBaseUnits)) fail("destination_amount_base_units_invalid");
  return Object.freeze({
    observation_id: observationId,
    schema_version: SHADOW_ROUTE_OBSERVATION_SCHEMA,
    sample_key: sampleKey,
    instrument_id: instrumentId,
    chain_id: chainId,
    side: direction,
    amount_bucket: amountBand,
    source_amount_usdc: sourceAmount,
    provider_id: provider,
    route_state: routeState,
    entry_state: cleanText(entry?.state || "unavailable", "entry_state", 32, { lower: true }),
    exit_state: cleanText(exit?.state || "unavailable", "exit_state", 32, { lower: true }),
    exit_verified: optionalBoolean(roundTrip.exit_verified),
    friction_complete: optionalBoolean(roundTrip.round_trip_friction_pct !== null && roundTrip.round_trip_friction_pct !== undefined),
    trade_available: optionalBoolean(roundTrip.trade_available),
    destination_asset_id: cleanText(entry?.destination_asset_id || request?.destination_asset?.address, "destination_asset_id", 220),
    destination_amount_base_units: destinationBaseUnits || null,
    expected_output: finite(entry?.expected_output, "expected_output", { optional: true, minimum: 0 }),
    minimum_output: finite(entry?.minimum_output, "minimum_output", { optional: true, minimum: 0 }),
    current_exit_usdc: finite(roundTrip.current_executable_liquidation_usdc, "current_exit_usdc", { optional: true, minimum: 0 }),
    minimum_exit_usdc: finite(roundTrip.minimum_executable_liquidation_usdc, "minimum_exit_usdc", { optional: true, minimum: 0 }),
    round_trip_friction_pct: finite(roundTrip.round_trip_friction_pct, "round_trip_friction_pct", { optional: true, minimum: -10_000, maximum: 100_000 }),
    slippage_bps: Math.trunc(finite(slippage_bps ?? request.maximum_slippage_bps, "slippage_bps", { minimum: 1, maximum: 3_000 })),
    provider_latency_ms: provider_latency_ms == null ? null : Math.trunc(finite(provider_latency_ms, "provider_latency_ms", { minimum: 0, maximum: 120_000 })),
    quoted_at: quotedAt,
    expires_at: expiresAt,
    observed_at: observedAt,
    limitations: limitationRows(shadow_execution),
    retention_expires_at: observedAt + ShadowRouteLedgerLimits.retention_seconds,
    privacy: Object.freeze({
      customer_id_stored: false,
      wallet_address_stored: false,
      network_address_stored: false,
      provider_payload_stored: false,
      transaction_material_stored: false,
      plan_prices_stored: false,
    }),
  });
}

export function createShadowRouteCheckpoint({ observation, horizon_seconds, result, evaluated_at } = {}) {
  const horizon = Math.trunc(finite(horizon_seconds, "horizon_seconds", { minimum: 1 }));
  if (!ShadowRouteLedgerLimits.checkpoint_horizons_seconds.includes(horizon)) fail("checkpoint_horizon_invalid");
  const observationId = cleanText(observation?.observation_id, "observation_id", 100);
  const evaluatedAt = unix(evaluated_at, "evaluated_at");
  if (evaluatedAt < Number(observation?.observed_at || 0) + horizon) fail("checkpoint_too_early");
  const available = result?.route_available === true;
  const exitValue = finite(result?.current_exit_usdc, "checkpoint_exit_usdc", { optional: true, minimum: 0 });
  const minimumExit = finite(result?.minimum_exit_usdc, "checkpoint_minimum_exit_usdc", { optional: true, minimum: 0 });
  const originalExit = finite(observation?.current_exit_usdc, "original_exit_usdc", { optional: true, minimum: 0 });
  const change = available && exitValue !== null && originalExit !== null && originalExit > 0
    ? ((exitValue - originalExit) / originalExit) * 100
    : null;
  const key = digest(`${observationId}|${horizon}`);
  return Object.freeze({
    checkpoint_id: `shc_${key.slice(0, 32)}`,
    schema_version: SHADOW_ROUTE_CHECKPOINT_SCHEMA,
    observation_id: observationId,
    horizon_seconds: horizon,
    state: cleanText(result?.state || (available ? "route_available" : "route_unavailable"), "checkpoint_state", 48, { lower: true }),
    route_available: available ? 1 : 0,
    current_exit_usdc: exitValue,
    minimum_exit_usdc: minimumExit,
    exit_value_change_pct: change,
    provider_latency_ms: result?.provider_latency_ms == null ? null : Math.trunc(finite(result.provider_latency_ms, "checkpoint_provider_latency_ms", { minimum: 0, maximum: 120_000 })),
    reason_code: cleanText(result?.reason_code, "checkpoint_reason_code", 96, { optional: true, lower: true }) || null,
    evaluated_at: evaluatedAt,
  });
}

function rowObservation(row = {}) {
  return {
    ...row,
    exit_verified: Number(row.exit_verified || 0),
    friction_complete: Number(row.friction_complete || 0),
    trade_available: Number(row.trade_available || 0),
    source_amount_usdc: row.source_amount_usdc == null ? null : Number(row.source_amount_usdc),
    current_exit_usdc: row.current_exit_usdc == null ? null : Number(row.current_exit_usdc),
    minimum_exit_usdc: row.minimum_exit_usdc == null ? null : Number(row.minimum_exit_usdc),
    provider_latency_ms: row.provider_latency_ms == null ? null : Number(row.provider_latency_ms),
    observed_at: Number(row.observed_at || 0),
    completed_horizons: String(row.completed_horizons || "").split(",").map(Number).filter(Number.isFinite),
  };
}

export function createD1ShadowExecutionLedgerStore(db) {
  if (!db?.prepare) fail("shadow_ledger_store_unavailable");
  // Newly migrated tables must not be discovered through a lagging read
  // replica. One first-primary session also gives each evaluator invocation a
  // coherent view of its lease, observations, and appended checkpoints.
  const ledgerDb = typeof db.withSession === "function" ? db.withSession("first-primary") : db;
  if (!ledgerDb?.prepare) fail("shadow_ledger_store_unavailable");
  return Object.freeze({
    async recordObservation(record) {
      const result = await ledgerDb.prepare(`
        INSERT OR IGNORE INTO ravenos_shadow_route_observations (
          observation_id, schema_version, sample_key, instrument_id, chain_id, side, amount_bucket, source_amount_usdc,
          provider_id, route_state, entry_state, exit_state, exit_verified, friction_complete, trade_available,
          destination_asset_id, destination_amount_base_units, expected_output, minimum_output, current_exit_usdc,
          minimum_exit_usdc, round_trip_friction_pct, slippage_bps, provider_latency_ms, quoted_at, expires_at,
          observed_at, limitations_json, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.observation_id, SHADOW_ROUTE_OBSERVATION_SCHEMA, record.sample_key, record.instrument_id, record.chain_id,
        record.side, record.amount_bucket, record.source_amount_usdc, record.provider_id, record.route_state,
        record.entry_state, record.exit_state, record.exit_verified, record.friction_complete, record.trade_available,
        record.destination_asset_id, record.destination_amount_base_units, record.expected_output, record.minimum_output,
        record.current_exit_usdc, record.minimum_exit_usdc, record.round_trip_friction_pct, record.slippage_bps,
        record.provider_latency_ms, record.quoted_at, record.expires_at, record.observed_at,
        JSON.stringify(record.limitations), record.retention_expires_at,
      ).run();
      return { inserted: Number(result?.meta?.changes || 0) > 0, observation_id: record.observation_id };
    },
    async recentObservations(since, limit = ShadowRouteLedgerLimits.maximum_summary_rows, now = Math.floor(Date.now() / 1_000)) {
      const result = await ledgerDb.prepare(`
        SELECT * FROM ravenos_shadow_route_observations
        WHERE observed_at >= ? AND retention_expires_at > ?
        ORDER BY observed_at DESC, observation_id ASC LIMIT ?
      `).bind(since, now, Math.min(ShadowRouteLedgerLimits.maximum_summary_rows, Math.max(1, Number(limit) || 1))).all();
      if (!Array.isArray(result?.results)) fail("shadow_observation_query_failed");
      return result.results.map(rowObservation);
    },
    async recentCheckpoints(since, limit = ShadowRouteLedgerLimits.maximum_summary_rows, now = Math.floor(Date.now() / 1_000)) {
      const result = await ledgerDb.prepare(`
        SELECT c.* FROM ravenos_shadow_route_checkpoints c
        JOIN ravenos_shadow_route_observations o ON o.observation_id = c.observation_id
        WHERE c.evaluated_at >= ? AND o.retention_expires_at > ?
        ORDER BY c.evaluated_at DESC, c.checkpoint_id ASC LIMIT ?
      `).bind(since, now, Math.min(ShadowRouteLedgerLimits.maximum_summary_rows, Math.max(1, Number(limit) || 1))).all();
      if (!Array.isArray(result?.results)) fail("shadow_checkpoint_query_failed");
      return result.results;
    },
    async dueObservations(now, limit = 80) {
      const result = await ledgerDb.prepare(`
        SELECT o.*, GROUP_CONCAT(c.horizon_seconds) AS completed_horizons
        FROM ravenos_shadow_route_observations o
        LEFT JOIN ravenos_shadow_route_checkpoints c ON c.observation_id = o.observation_id
        WHERE o.chain_id = 'solana' AND o.side = 'buy' AND o.exit_verified = 1
          AND o.destination_amount_base_units IS NOT NULL AND o.retention_expires_at > ?
        GROUP BY o.observation_id
        ORDER BY o.observed_at ASC, o.observation_id ASC LIMIT ?
      `).bind(now, Math.min(200, Math.max(1, Number(limit) || 1))).all();
      if (!Array.isArray(result?.results)) fail("shadow_due_query_failed");
      return result.results.map(rowObservation);
    },
    async insertCheckpoint(record) {
      const result = await ledgerDb.prepare(`
        INSERT OR IGNORE INTO ravenos_shadow_route_checkpoints (
          checkpoint_id, schema_version, observation_id, horizon_seconds, state, route_available,
          current_exit_usdc, minimum_exit_usdc, exit_value_change_pct, provider_latency_ms, reason_code, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.checkpoint_id, SHADOW_ROUTE_CHECKPOINT_SCHEMA, record.observation_id, record.horizon_seconds,
        record.state, record.route_available, record.current_exit_usdc, record.minimum_exit_usdc,
        record.exit_value_change_pct, record.provider_latency_ms, record.reason_code, record.evaluated_at,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async purgeExpired(now) {
      const result = await ledgerDb.prepare("DELETE FROM ravenos_shadow_route_observations WHERE retention_expires_at <= ?").bind(now).run();
      return Number(result?.meta?.changes || 0);
    },
    async acquireLease(token, now) {
      await ledgerDb.prepare(`INSERT OR IGNORE INTO ravenos_shadow_evaluator_lease (lease_key, lease_token, lease_expires_at, revision, updated_at) VALUES ('universal_shadow_v1', NULL, NULL, 1, ?)`)
        .bind(now).run();
      await ledgerDb.prepare(`
        UPDATE ravenos_shadow_evaluator_lease SET lease_token = ?, lease_expires_at = ?, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'universal_shadow_v1' AND (lease_token = ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).bind(token, now + ShadowRouteLedgerLimits.evaluator_lease_seconds, now, token, now).run();
      const row = await ledgerDb.prepare("SELECT lease_token FROM ravenos_shadow_evaluator_lease WHERE lease_key = 'universal_shadow_v1'").first();
      return row?.lease_token === token;
    },
    async releaseLease(token, now) {
      await ledgerDb.prepare(`
        UPDATE ravenos_shadow_evaluator_lease SET lease_token = NULL, lease_expires_at = NULL, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'universal_shadow_v1' AND lease_token = ?
      `).bind(now, token).run();
    },
  });
}

function median(values) {
  const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function percent(count, total) {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : null;
}

export function buildShadowRouteReadinessProjection(observations = [], checkpoints = [], { generated_at, window_seconds = ShadowRouteLedgerLimits.summary_window_seconds } = {}) {
  const rows = observations.map(rowObservation);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.chain_id}|${row.provider_id}|${row.amount_bucket}`;
    const group = groups.get(key) || { chain_id: row.chain_id, provider_id: row.provider_id, amount_bucket: row.amount_bucket, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const slices = [...groups.values()].map((group) => {
    const total = group.rows.length;
    const exitVerified = group.rows.filter((row) => row.exit_verified === 1).length;
    const frictionComplete = group.rows.filter((row) => row.friction_complete === 1).length;
    return {
      chain_id: group.chain_id,
      provider_id: group.provider_id,
      amount_bucket: group.amount_bucket,
      samples: total,
      exit_verified_pct: percent(exitVerified, total),
      friction_complete_pct: percent(frictionComplete, total),
      median_provider_latency_ms: median(group.rows.map((row) => row.provider_latency_ms)),
      median_current_exit_usdc: median(group.rows.map((row) => row.current_exit_usdc)),
    };
  }).sort((a, b) => b.samples - a.samples || a.chain_id.localeCompare(b.chain_id) || a.amount_bucket.localeCompare(b.amount_bucket));
  const checkpointRows = checkpoints.map((row) => ({
    horizon_seconds: Number(row.horizon_seconds),
    route_available: Number(row.route_available || 0),
    exit_value_change_pct: row.exit_value_change_pct == null ? null : Number(row.exit_value_change_pct),
  }));
  const maturity = ShadowRouteLedgerLimits.checkpoint_horizons_seconds.map((horizon) => {
    const current = checkpointRows.filter((row) => row.horizon_seconds === horizon);
    return {
      horizon_seconds: horizon,
      samples: current.length,
      route_persistence_pct: percent(current.filter((row) => row.route_available === 1).length, current.length),
      median_exit_value_change_pct: median(current.map((row) => row.exit_value_change_pct)),
    };
  });
  const total = rows.length;
  return Object.freeze({
    ok: true,
    schema_version: SHADOW_ROUTE_READINESS_SCHEMA,
    state: total ? "sampling" : "forming",
    generated_at: new Date(generated_at).toISOString(),
    window_seconds,
    observations: total,
    exact_markets: new Set(rows.map((row) => row.instrument_id)).size,
    entry_quote_pct: percent(rows.filter((row) => row.entry_state === "route_available").length, total),
    exit_verified_pct: percent(rows.filter((row) => row.exit_verified === 1).length, total),
    friction_complete_pct: percent(rows.filter((row) => row.friction_complete === 1).length, total),
    trade_available_pct: percent(rows.filter((row) => row.trade_available === 1).length, total),
    median_provider_latency_ms: median(rows.map((row) => row.provider_latency_ms)),
    slices: slices.slice(0, 40),
    maturity,
    privacy: {
      aggregate_only: true,
      customer_identity: false,
      wallet_addresses: false,
      network_addresses: false,
      provider_payloads: false,
      transaction_material: false,
    },
    execution: { signing_available: false, submission_available: false },
  });
}

export async function loadShadowRouteReadiness(store, { now = Math.floor(Date.now() / 1_000), window_seconds = ShadowRouteLedgerLimits.summary_window_seconds } = {}) {
  const since = now - window_seconds;
  // D1 session bookmarks advance in query order. Keep these reads sequential
  // so a first-primary session never races two statements against one
  // consistency token.
  const observations = await store.recentObservations(since, ShadowRouteLedgerLimits.maximum_summary_rows, now);
  const checkpoints = await store.recentCheckpoints(since, ShadowRouteLedgerLimits.maximum_summary_rows, now);
  return buildShadowRouteReadinessProjection(observations, checkpoints, { generated_at: now * 1_000, window_seconds });
}

function nextDueTask(row, now) {
  const completed = new Set(row.completed_horizons || []);
  return ShadowRouteLedgerLimits.checkpoint_horizons_seconds
    .filter((horizon) => !completed.has(horizon) && now >= row.observed_at + horizon)
    .map((horizon) => ({ observation: row, horizon_seconds: horizon }))[0] || null;
}

export async function runShadowRouteCheckpointEvaluator(store, {
  now = Math.floor(Date.now() / 1_000),
  reprice,
} = {}) {
  if (typeof reprice !== "function") fail("shadow_reprice_callback_required");
  const token = `lease_${randomUUID()}`;
  if (!(await store.acquireLease(token, now))) return { state: "lease_busy", considered: 0, checkpoints: 0, failures: 0 };
  let considered = 0;
  let checkpoints = 0;
  let failures = 0;
  let purged = 0;
  try {
    purged = await store.purgeExpired(now);
    const candidates = await store.dueObservations(now, 80);
    const tasks = candidates.map((row) => nextDueTask(row, now)).filter(Boolean).slice(0, ShadowRouteLedgerLimits.evaluator_batch_size);
    for (const task of tasks) {
      considered += 1;
      let result;
      try {
        result = await reprice(task.observation, task.horizon_seconds);
      } catch (error) {
        failures += 1;
        result = { route_available: false, state: "provider_unavailable", reason_code: error?.code || error?.message || "provider_unavailable" };
      }
      const checkpoint = createShadowRouteCheckpoint({
        observation: task.observation,
        horizon_seconds: task.horizon_seconds,
        result,
        evaluated_at: new Date(now * 1_000).toISOString(),
      });
      if (await store.insertCheckpoint(checkpoint)) checkpoints += 1;
    }
    return { state: "complete", considered, checkpoints, failures, purged };
  } finally {
    await store.releaseLease(token, now).catch(() => undefined);
  }
}

export function shadowLedgerEnabled(env = {}) {
  return String(env.RAVENOS_SHADOW_LEDGER_ENABLED || "").trim() === "1" && Boolean(env.RAVENOS_CUSTOMER_DB?.prepare);
}
