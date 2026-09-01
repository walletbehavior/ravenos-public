import { createHash, randomUUID } from "node:crypto";

import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
} from "./customer_identity.mjs";
import {
  createD1CustomerEntitlementStore,
  resolveCapabilityAccess,
  resolveEntitlementFeatureFlags,
} from "./customer_entitlements.mjs";
import {
  SOLANA_WALLET_EVENT_SCHEMA,
  SOLANA_WALLET_PROFILE_SCHEMA,
  buildSolanaWalletProfile,
  normalizeSolanaWalletAddress,
} from "./customer_trade/solana_wallet_intelligence.mjs";
import {
  RAVEN_COPY_DECISION_SCHEMA,
  RAVEN_COPY_POLICY_SCHEMA,
  RAVEN_COPY_POSITION_SCHEMA,
  buildCopyabilityBySize,
  buildCopyabilitySnapshot,
  createRavenCopyDecision,
  createRavenCopyPolicy,
  createShadowCopyPosition,
} from "./customer_trade/wallet_copy.mjs";
import {
  WalletScreenerFieldSqlColumns,
  WalletScreenerLimits,
  buildWalletScreenerResponse,
  normalizeWalletScreenerRequest,
} from "./customer_trade/wallet_screener.mjs";
import { resolveSourceWalletObserverActivation } from "./customer_trade/source_wallet_observer.mjs";
import { SourceWalletWatchManifestLimits } from "./customer_trade/source_wallet_watch_manifest.mjs";

export const CUSTOMER_WALLET_COPY_SCHEMA = "ravenos.customer_wallet_copy.v1";
export const CUSTOMER_WALLET_COPY_ROUTE = "/api/v1/wallet-copy";

export const CustomerWalletCopyLimits = Object.freeze({
  maximum_watches_per_account: 25,
  maximum_history_transactions_per_request: 24,
  maximum_new_signals_per_refresh: 3,
  maximum_decisions_per_response: 100,
  maximum_positions_per_response: 100,
  maximum_request_bytes: 16 * 1024,
  maximum_response_bytes: 256 * 1024,
  public_event_retention_seconds: 180 * 24 * 60 * 60,
  customer_decision_retention_seconds: 365 * 24 * 60 * 60,
  reads_per_15_minutes: 120,
  mutations_per_15_minutes: 30,
  provider_refreshes_per_15_minutes: 12,
  maximum_screener_page_size: WalletScreenerLimits.maximum_page_size,
  maximum_screener_page: WalletScreenerLimits.maximum_page,
  maximum_research_saves_per_account: 100,
  maximum_research_lists_per_account: 20,
  maximum_observer_policies_per_job: 250,
  maximum_observer_quote_variants_per_job: 4,
});

const APP_ORIGIN = "https://app.ravenos.xyz";
const textEncoder = new TextEncoder();
const WALLET_SCREENER_SORT_SQL = Object.freeze({
  last_trade_desc: "c.last_trade_at DESC, c.source_wallet_id ASC",
  trade_count_desc: "c.trade_count DESC, c.last_trade_at DESC, c.source_wallet_id ASC",
  active_days_desc: "c.active_days DESC, c.last_trade_at DESC, c.source_wallet_id ASC",
  known_cost_basis_desc: "c.known_cost_basis_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  closed_lots_desc: "c.closed_lots DESC, c.known_cost_basis_pct DESC, c.source_wallet_id ASC",
  win_rate_desc: "c.win_rate_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  roi_desc: "c.roi_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  realized_pnl_usdc_desc: "c.realized_pnl_usdc DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  realized_pnl_sol_desc: "c.realized_pnl_sol DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  profit_factor_desc: "c.profit_factor DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  average_trade_roi_desc: "c.average_trade_roi_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  median_trade_roi_desc: "c.median_trade_roi_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  profit_concentration_asc: "c.top_1_profit_concentration_pct IS NULL ASC, c.top_1_profit_concentration_pct ASC, c.closed_lots DESC, c.source_wallet_id ASC",
  weekly_consistency_desc: "c.weekly_profitable_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  reconstruction_confidence_desc: "c.reconstruction_confidence_pct DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  trade_rate_desc: "c.trade_rate_per_active_day DESC, c.last_trade_at DESC, c.source_wallet_id ASC",
  median_hold_asc: "c.median_hold_seconds IS NULL ASC, c.median_hold_seconds ASC, c.closed_lots DESC, c.source_wallet_id ASC",
  median_hold_desc: "c.median_hold_seconds DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  average_buy_usdc_desc: "c.average_buy_usdc DESC, c.closed_lots DESC, c.source_wallet_id ASC",
  maximum_drawdown_usdc_asc: "c.maximum_drawdown_usdc IS NULL ASC, c.maximum_drawdown_usdc ASC, c.closed_lots DESC, c.source_wallet_id ASC",
  maximum_drawdown_sol_asc: "c.maximum_drawdown_sol IS NULL ASC, c.maximum_drawdown_sol ASC, c.closed_lots DESC, c.source_wallet_id ASC",
});

class CustomerWalletCopyError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = "CustomerWalletCopyError";
    this.code = code;
    this.details = details;
  }
}

function flag(value) {
  return String(value || "") === "1";
}

function clean(value, maximum = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function epoch(isoValue) {
  const parsed = Date.parse(String(isoValue || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function iso(seconds) {
  return Number.isSafeInteger(Number(seconds)) ? new Date(Number(seconds) * 1_000).toISOString() : null;
}

function parseJson(value, fallback = null) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sourceWalletId(address) {
  return `sw_sol_${digest(["solana", "mainnet", address])}`;
}

function profileSnapshotId(sourceId, profile) {
  return `swp_${digest([sourceId, profile.generated_at, String(profile.profile_version), JSON.stringify(profile)])}`;
}

function watchId(userId, address, policyHash, now) {
  return `wcw_${digest([userId, address, policyHash, String(now), randomUUID()])}`;
}

function researchSaveId(userId, sourceId, listName, now) {
  return `wrs_${digest([userId, sourceId, listName, String(now), randomUUID()])}`;
}

function privateHeaders(source = null, extra = {}) {
  const headers = new Headers(source || undefined);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  const vary = String(headers.get("vary") || "").split(",").map((value) => value.trim()).filter(Boolean);
  headers.set("vary", [...new Set([...vary, "Cookie", "Origin"])].join(", "));
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function privateJson(payload, { status = 200, headers = null, extra_headers: extraHeaders = {} } = {}, authorization = null) {
  const body = JSON.stringify(payload);
  if (textEncoder.encode(body).byteLength > CustomerWalletCopyLimits.maximum_response_bytes) {
    return new Response(JSON.stringify({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "unavailable", error: "wallet_copy_response_too_large" }), {
      status: 503,
      headers: privateHeaders(authorization?.response_headers),
    });
  }
  return new Response(body, { status, headers: privateHeaders(headers || authorization?.response_headers, extraHeaders) });
}

function sameOriginBoundary(request) {
  try {
    if (new URL(request.url).origin !== APP_ORIGIN) return false;
    const site = clean(request.headers.get("sec-fetch-site"), 32).toLowerCase();
    if (site && site !== "same-origin") return false;
    const origin = clean(request.headers.get("origin"), 300);
    if (origin && origin !== APP_ORIGIN) return false;
    const referer = clean(request.headers.get("referer"), 400);
    if (!origin && referer && new URL(referer).origin !== APP_ORIGIN) return false;
    return true;
  } catch {
    return false;
  }
}

async function parseBody(request) {
  const contentType = clean(request.headers.get("content-type"), 100).toLowerCase();
  if (!contentType.startsWith("application/json")) throw new CustomerWalletCopyError("wallet_copy_request_invalid");
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > CustomerWalletCopyLimits.maximum_request_bytes) throw new CustomerWalletCopyError("wallet_copy_request_too_large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > CustomerWalletCopyLimits.maximum_request_bytes) throw new CustomerWalletCopyError("wallet_copy_request_too_large");
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object_required");
    return parsed;
  } catch {
    throw new CustomerWalletCopyError("wallet_copy_request_invalid");
  }
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.has(key))) {
    throw new CustomerWalletCopyError("wallet_copy_request_invalid");
  }
  return value;
}

function normalizeLabel(value, address) {
  const label = clean(value, 80) || `Wallet ${address.slice(0, 4)}…${address.slice(-4)}`;
  if (!label) throw new CustomerWalletCopyError("wallet_copy_label_invalid");
  return label;
}

function normalizeResearchListName(value) {
  const listName = clean(value || "Research", 48);
  if (!listName) throw new CustomerWalletCopyError("wallet_research_list_name_invalid");
  return listName;
}

function publicResearchSave(row) {
  if (!row || !/^wrs_[A-Za-z0-9_-]{16,96}$/.test(String(row.save_id || "")) || !/^sw_sol_[a-f0-9]{40}$/.test(String(row.source_wallet_id || ""))) {
    throw new CustomerWalletCopyError("stored_wallet_research_save_invalid");
  }
  const address = normalizeSolanaWalletAddress(row.address);
  return Object.freeze({
    save_id: row.save_id,
    list_name: normalizeResearchListName(row.list_name),
    label: normalizeLabel(row.label, address),
    source_wallet_id: row.source_wallet_id,
    source_wallet: { chain: "solana", network: "mainnet", address },
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    revision: Number(row.revision || 1),
    shadow_monitoring_started: false,
    execution_authorized: false,
  });
}

export function resolveWalletCopyActivation(env = {}) {
  const entitlements = flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE);
  const intelligence = flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED);
  const routes = flag(env.RAVENOS_WALLET_COPY_ROUTES_ENABLED);
  const shadow = flag(env.RAVENOS_SHADOW_COPY_ENABLED);
  const observer = resolveSourceWalletObserverActivation(env);
  return Object.freeze({
    wallet_intelligence: entitlements && intelligence && routes,
    wallet_screener: entitlements && intelligence && routes && flag(env.RAVENOS_WALLET_SCREENER_ENABLED),
    shadow_copy: entitlements && intelligence && routes && shadow,
    live_copy: false,
    live_copy_requested: flag(env.RAVENOS_LIVE_COPY_ENABLED),
    fee_collection: false,
    fee_collection_requested: flag(env.RAVENOS_COPY_FEE_COLLECTION_ENABLED),
    continuous_observer: observer.evaluator,
    observer_ingest: observer.ingest,
    scheduler: observer.evaluator,
    monitoring_mode: observer.evaluator ? "shared_observer" : "manual_refresh",
  });
}

export function createD1CustomerWalletCopyStore(db) {
  if (!db?.prepare) throw new Error("customer_wallet_copy_store_unavailable");
  const getWatchOwned = async (userId, watchIdentifier) => db.prepare(`
    SELECT w.*, s.address, s.observation_state, s.last_observed_at, s.last_signature
    FROM ravenos_customer_wallet_copy_watches w
    JOIN ravenos_source_wallets s ON s.source_wallet_id = w.source_wallet_id
    WHERE w.user_id = ? AND w.watch_id = ? LIMIT 1
  `).bind(userId, watchIdentifier).first();
  return Object.freeze({
    async upsertSourceWallet({ source_wallet_id: sourceId, address, now, state = "requested", provider_scope: providerScope = "bounded_solana_rpc" }) {
      await db.prepare(`
        INSERT INTO ravenos_source_wallets (
          source_wallet_id, chain, network, address, observation_state, provider_scope,
          first_requested_at, last_observed_at, last_signature, updated_at
        ) VALUES (?, 'solana', 'mainnet', ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(chain, network, address) DO UPDATE SET
          observation_state = excluded.observation_state,
          provider_scope = excluded.provider_scope,
          updated_at = excluded.updated_at
      `).bind(sourceId, address, state, providerScope, now, now).run();
      return db.prepare("SELECT * FROM ravenos_source_wallets WHERE chain = 'solana' AND network = 'mainnet' AND address = ?").bind(address).first();
    },
    async updateSourceCursor(sourceId, { state, last_observed_at: observedAt, last_signature: signature, now }) {
      await db.prepare(`
        UPDATE ravenos_source_wallets SET observation_state = ?, last_observed_at = ?, last_signature = ?, updated_at = ?
        WHERE source_wallet_id = ?
      `).bind(state, observedAt, signature || null, now, sourceId).run();
    },
    async recordEvents(sourceId, events, now) {
      const inserted = [];
      for (const event of events) {
        const result = await db.prepare(`
          INSERT OR IGNORE INTO ravenos_source_wallet_events (
            event_id, source_wallet_id, signature, slot, block_time, finality, classification,
            decode_version, evidence_hash, event_json, observed_at, retention_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          event.event_id,
          sourceId,
          event.chain_evidence.signature,
          event.chain_evidence.slot,
          epoch(event.chain_evidence.block_time),
          event.chain_evidence.finality,
          event.classification.kind,
          event.decode_version,
          event.evidence_hash,
          JSON.stringify(event),
          now,
          now + CustomerWalletCopyLimits.public_event_retention_seconds,
        ).run();
        await db.prepare(`
          INSERT OR IGNORE INTO ravenos_source_wallet_event_finality_observations (
            finality_observation_id, event_id, finality, provider, observed_at
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(
          `swf_${digest([event.event_id, event.chain_evidence.finality])}`,
          event.event_id,
          event.chain_evidence.finality,
          event.chain_evidence.provider,
          now,
        ).run();
        if (Number(result?.meta?.changes || 0) > 0) inserted.push(event.event_id);
      }
      return inserted;
    },
    async listSourceEvents(sourceId, limit = 500) {
      const bounded = Math.max(1, Math.min(2_000, Number(limit) || 500));
      const result = await db.prepare(`
        SELECT event_json FROM ravenos_source_wallet_events
        WHERE source_wallet_id = ?
        ORDER BY COALESCE(block_time, observed_at) DESC, event_id DESC LIMIT ?
      `).bind(sourceId, bounded).all();
      return (result?.results || []).map((row) => parseJson(row.event_json)).filter((row) => row?.schema_version === SOLANA_WALLET_EVENT_SCHEMA);
    },
    async recordProfile(sourceId, profile, now) {
      const profileId = profileSnapshotId(sourceId, profile);
      const profileHash = digest([JSON.stringify(profile)]);
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_profiles (
          profile_snapshot_id, source_wallet_id, profile_version, history_start_at, history_end_at,
          normalized_event_count, profile_json, generated_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        profileId,
        sourceId,
        profile.profile_version,
        epoch(profile.coverage.first_observed_at),
        epoch(profile.coverage.last_observed_at),
        profile.coverage.normalized_events,
        JSON.stringify(profile),
        now,
        now + CustomerWalletCopyLimits.public_event_retention_seconds,
      ).run();
      await db.prepare(`
        INSERT INTO ravenos_source_wallet_current_profiles (
          source_wallet_id, profile_snapshot_id, profile_version, generated_at,
          first_trade_at, last_trade_at, trade_count, active_days, token_count,
          known_cost_basis_pct, performance_state, realized_pnl_usdc,
          realized_pnl_sol, roi_pct, win_rate_pct, closed_lots,
          median_hold_seconds, profile_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_wallet_id) DO UPDATE SET
          profile_snapshot_id = excluded.profile_snapshot_id,
          profile_version = excluded.profile_version,
          generated_at = excluded.generated_at,
          first_trade_at = excluded.first_trade_at,
          last_trade_at = excluded.last_trade_at,
          trade_count = excluded.trade_count,
          active_days = excluded.active_days,
          token_count = excluded.token_count,
          known_cost_basis_pct = excluded.known_cost_basis_pct,
          performance_state = excluded.performance_state,
          realized_pnl_usdc = excluded.realized_pnl_usdc,
          realized_pnl_sol = excluded.realized_pnl_sol,
          roi_pct = excluded.roi_pct,
          win_rate_pct = excluded.win_rate_pct,
          closed_lots = excluded.closed_lots,
          median_hold_seconds = excluded.median_hold_seconds,
          profile_hash = excluded.profile_hash,
          updated_at = excluded.updated_at
        WHERE excluded.generated_at > ravenos_source_wallet_current_profiles.generated_at
          OR (
            excluded.generated_at = ravenos_source_wallet_current_profiles.generated_at
            AND excluded.profile_snapshot_id > ravenos_source_wallet_current_profiles.profile_snapshot_id
          )
      `).bind(
        sourceId,
        profileId,
        profile.profile_version,
        now,
        epoch(profile.behavior?.first_trade_at || profile.coverage?.first_observed_at),
        epoch(profile.behavior?.last_trade_at || profile.coverage?.last_observed_at),
        Number(profile.behavior?.trade_count || 0),
        Number(profile.behavior?.active_days || 0),
        Number(profile.behavior?.tokens_traded || 0),
        profile.coverage?.known_cost_basis_pct ?? null,
        new Set(["available", "partial"]).has(profile.source_performance?.state) ? profile.source_performance.state : "insufficient_evidence",
        profile.source_performance?.realized_pnl_usdc ?? null,
        profile.source_performance?.realized_pnl_sol ?? null,
        profile.source_performance?.roi_pct ?? null,
        profile.source_performance?.win_rate_pct ?? null,
        Number(profile.source_performance?.closed_lots || 0),
        profile.behavior?.median_hold_seconds ?? null,
        profileHash,
        now,
      ).run();
      const basisRows = profile.source_performance?.by_basis || {};
      const activeBases = ["usdc", "sol"].filter((key) => Number(basisRows[key]?.count || 0) > 0);
      const headline = activeBases.length === 1 ? basisRows[activeBases[0]] : null;
      const capital = profile.capital_observations || {};
      await db.prepare(`
        UPDATE ravenos_source_wallet_current_profiles SET
          profit_factor = ?, average_trade_roi_pct = ?, median_trade_roi_pct = ?,
          top_1_profit_concentration_pct = ?, top_5_profit_concentration_pct = ?,
          profitable_observations = ?, weekly_profitable_pct = ?,
          maximum_drawdown_usdc = ?, maximum_drawdown_sol = ?,
          trade_rate_per_active_day = ?, repeat_token_rate_pct = ?, mechanical_pattern_state = ?,
          buy_count = ?, sell_count = ?, average_buy_usdc = ?, median_buy_usdc = ?,
          average_buy_sol = ?, median_buy_sol = ?, open_known_cost_positions = ?,
          reconstruction_confidence_pct = ?, trade_decode_coverage_pct = ?, classification_coverage_pct = ?,
          provider_history_exhausted = ?, source_history_complete = ?,
          last_observed_sol_balance = ?, last_observed_sol_at = ?,
          last_observed_usdc_balance = ?, last_observed_usdc_at = ?
        WHERE source_wallet_id = ? AND profile_snapshot_id = ?
      `).bind(
        headline?.profit_factor ?? null,
        headline?.average_trade_roi_pct ?? null,
        headline?.median_trade_roi_pct ?? null,
        headline?.top_1_profit_concentration_pct ?? null,
        headline?.top_5_profit_concentration_pct ?? null,
        headline?.winning_observations ?? null,
        headline?.weekly_consistency?.profitable_period_pct ?? null,
        basisRows.usdc?.maximum_realized_drawdown ?? null,
        basisRows.sol?.maximum_realized_drawdown ?? null,
        profile.behavior?.trade_rate_per_active_day ?? null,
        profile.behavior?.repeat_token_rate_pct ?? null,
        profile.behavior?.mechanical_pattern_evidence?.state ?? null,
        profile.behavior?.buy_count ?? null,
        profile.behavior?.sell_count ?? null,
        profile.behavior?.buy_notional_by_basis?.usdc?.average ?? null,
        profile.behavior?.buy_notional_by_basis?.usdc?.median ?? null,
        profile.behavior?.buy_notional_by_basis?.sol?.average ?? null,
        profile.behavior?.buy_notional_by_basis?.sol?.median ?? null,
        profile.positions?.known_cost_open_position_count ?? null,
        profile.data_quality?.reconstruction_confidence_pct ?? null,
        profile.data_quality?.trade_decode_coverage_pct ?? null,
        profile.data_quality?.classification_coverage_pct ?? null,
        profile.data_quality?.provider_history_exhausted ? 1 : 0,
        profile.data_quality?.history_complete ? 1 : 0,
        capital.sol?.amount ?? null,
        epoch(capital.sol?.observed_at),
        capital.canonical_usdc?.amount ?? null,
        epoch(capital.canonical_usdc?.observed_at),
        sourceId,
        profileId,
      ).run();
      return profileId;
    },
    async latestProfile(sourceId) {
      const row = await db.prepare(`
        SELECT profile_json FROM ravenos_source_wallet_profiles
        WHERE source_wallet_id = ? ORDER BY generated_at DESC, profile_snapshot_id DESC LIMIT 1
      `).bind(sourceId).first();
      return parseJson(row?.profile_json);
    },
    async getSourceWallet(sourceId) {
      return db.prepare(`
        SELECT s.*, c.profile_snapshot_id, c.profile_version, c.generated_at AS profile_generated_at
        FROM ravenos_source_wallets s
        LEFT JOIN ravenos_source_wallet_current_profiles c ON c.source_wallet_id = s.source_wallet_id
        WHERE s.source_wallet_id = ? LIMIT 1
      `).bind(sourceId).first();
    },
    async listObserverWatchUniverse(limit = SourceWalletWatchManifestLimits.maximum_wallets) {
      const bounded = Math.max(1, Math.min(SourceWalletWatchManifestLimits.maximum_wallets, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT s.address
        FROM ravenos_source_wallets s
        WHERE EXISTS (
          SELECT 1 FROM ravenos_customer_wallet_copy_watches w
          WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
        ) OR EXISTS (
          SELECT 1 FROM ravenos_customer_wallet_research_saves r
          WHERE r.source_wallet_id = s.source_wallet_id
        )
        ORDER BY
          CASE WHEN EXISTS (
            SELECT 1 FROM ravenos_customer_wallet_copy_watches w
            WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
          ) THEN 0 ELSE 1 END ASC,
          COALESCE(s.last_observed_at, 0) DESC,
          s.source_wallet_id ASC
        LIMIT ?
      `).bind(bounded + 1).all();
      const rows = result?.results || [];
      if (rows.length > bounded) throw new CustomerWalletCopyError("wallet_observer_universe_too_large");
      return rows.map((row) => row.address);
    },
    async screenSourceWallets(query) {
      const conditions = ["s.chain = 'solana'", "s.network = 'mainnet'"];
      const bindings = [];
      const minimum = (column, value) => {
        if (value === null) return;
        conditions.push(`${column} IS NOT NULL AND ${column} >= ?`);
        bindings.push(value);
      };
      minimum("c.last_trade_at", query.filters.active_since_at);
      minimum("c.trade_count", query.filters.min_trade_count);
      minimum("c.active_days", query.filters.min_active_days);
      minimum("c.known_cost_basis_pct", query.filters.min_known_cost_basis_pct);
      minimum("c.closed_lots", query.filters.min_closed_lots);
      minimum("c.win_rate_pct", query.filters.min_win_rate_pct);
      minimum("c.roi_pct", query.filters.min_roi_pct);
      if (query.filters.performance_state !== "any") {
        conditions.push("c.performance_state = ?");
        bindings.push(query.filters.performance_state);
      }
      for (const clause of query.clauses || []) {
        const column = WalletScreenerFieldSqlColumns[clause.field];
        if (!column) throw new CustomerWalletCopyError("wallet_screener_clause_field_invalid");
        if (clause.operator === "available") {
          conditions.push(`${column} IS NOT NULL`);
          continue;
        }
        if (clause.operator === "unavailable") {
          conditions.push(`${column} IS NULL`);
          continue;
        }
        if (clause.operator === "between") {
          conditions.push(`${column} BETWEEN ? AND ?`);
          bindings.push(clause.value[0], clause.value[1]);
          continue;
        }
        if (clause.operator === "in" || clause.operator === "not_in") {
          const placeholders = clause.value.map(() => "?").join(", ");
          conditions.push(`${column} ${clause.operator === "in" ? "IN" : "NOT IN"} (${placeholders})`);
          bindings.push(...clause.value);
          continue;
        }
        const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=" }[clause.operator];
        if (!operator) throw new CustomerWalletCopyError("wallet_screener_clause_operator_invalid");
        conditions.push(`${column} ${operator} ?`);
        bindings.push(clause.value);
      }
      const from = `
        FROM ravenos_source_wallet_current_profiles c
        JOIN ravenos_source_wallets s ON s.source_wallet_id = c.source_wallet_id
        WHERE ${conditions.join(" AND ")}
      `;
      const totalRow = await db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...bindings).first();
      const orderBy = WALLET_SCREENER_SORT_SQL[query.sort];
      if (!orderBy) throw new CustomerWalletCopyError("wallet_screener_sort_invalid");
      const result = await db.prepare(`
        SELECT s.address, c.* ${from}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).bind(...bindings, query.page_size, query.offset).all();
      return { rows: result?.results || [], total: Number(totalRow?.count || 0) };
    },
    async countResearchSaves(userId) {
      const row = await db.prepare("SELECT COUNT(*) AS count FROM ravenos_customer_wallet_research_saves WHERE user_id = ?").bind(userId).first();
      return Number(row?.count || 0);
    },
    async countResearchLists(userId) {
      const row = await db.prepare("SELECT COUNT(DISTINCT list_name) AS count FROM ravenos_customer_wallet_research_saves WHERE user_id = ?").bind(userId).first();
      return Number(row?.count || 0);
    },
    async listResearchSaves(userId) {
      const result = await db.prepare(`
        SELECT r.*, s.address
        FROM ravenos_customer_wallet_research_saves r
        JOIN ravenos_source_wallets s ON s.source_wallet_id = r.source_wallet_id
        WHERE r.user_id = ?
        ORDER BY r.list_name COLLATE NOCASE ASC, r.updated_at DESC, r.save_id ASC
        LIMIT ?
      `).bind(userId, CustomerWalletCopyLimits.maximum_research_saves_per_account).all();
      return result?.results || [];
    },
    async saveResearchWallet({ save_id: saveId, user_id: userId, source_wallet_id: sourceId, list_name: listName, label, now }) {
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_customer_wallet_research_saves (
          save_id, user_id, source_wallet_id, list_name, label, created_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(saveId, userId, sourceId, listName, label, now, now).run();
      return db.prepare(`
        SELECT r.*, s.address
        FROM ravenos_customer_wallet_research_saves r
        JOIN ravenos_source_wallets s ON s.source_wallet_id = r.source_wallet_id
        WHERE r.user_id = ? AND r.source_wallet_id = ? AND r.list_name = ? LIMIT 1
      `).bind(userId, sourceId, listName).first();
    },
    async deleteResearchSave(userId, saveId) {
      const result = await db.prepare("DELETE FROM ravenos_customer_wallet_research_saves WHERE user_id = ? AND save_id = ?").bind(userId, saveId).run();
      return Number(result?.meta?.changes || 0);
    },
    async countWatches(userId) {
      const row = await db.prepare("SELECT COUNT(*) AS count FROM ravenos_customer_wallet_copy_watches WHERE user_id = ?").bind(userId).first();
      return Number(row?.count || 0);
    },
    async createWatch(record) {
      await db.prepare(`
        INSERT INTO ravenos_customer_wallet_copy_watches (
          watch_id, user_id, source_wallet_id, label, state, copy_mode, policy_version,
          policy_hash, policy_json, cursor_signature, cursor_slot, backfill_complete,
          created_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL, 0, ?, ?, 1)
      `).bind(
        record.watch_id,
        record.user_id,
        record.source_wallet_id,
        record.label,
        record.policy.mode,
        record.policy.policy_version,
        record.policy.policy_hash,
        JSON.stringify(record.policy),
        record.now,
        record.now,
      ).run();
      return getWatchOwned(record.user_id, record.watch_id);
    },
    async listWatches(userId) {
      const result = await db.prepare(`
        SELECT w.*, s.address, s.observation_state, s.last_observed_at, s.last_signature
        FROM ravenos_customer_wallet_copy_watches w
        JOIN ravenos_source_wallets s ON s.source_wallet_id = w.source_wallet_id
        WHERE w.user_id = ? ORDER BY w.updated_at DESC, w.watch_id ASC LIMIT ?
      `).bind(userId, CustomerWalletCopyLimits.maximum_watches_per_account).all();
      return result?.results || [];
    },
    async listActiveWatchesForSource(sourceId, event, limit = CustomerWalletCopyLimits.maximum_observer_policies_per_job) {
      if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA || event.source_wallet?.address === undefined) {
        throw new CustomerWalletCopyError("wallet_source_event_invalid");
      }
      const bounded = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_observer_policies_per_job, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT w.*, s.address, s.observation_state, s.last_observed_at, s.last_signature
        FROM ravenos_customer_wallet_copy_watches w
        JOIN ravenos_source_wallets s ON s.source_wallet_id = w.source_wallet_id
        WHERE w.source_wallet_id = ?
          AND w.state = 'active'
          AND w.backfill_complete = 1
          AND w.cursor_slot IS NOT NULL
          AND (
            w.cursor_slot < ?
            OR (w.cursor_slot = ? AND COALESCE(w.cursor_signature, '') != ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_customer_shadow_copy_decisions d
            WHERE d.watch_id = w.watch_id AND d.source_event_id = ?
          )
        ORDER BY w.watch_id ASC
        LIMIT ?
      `).bind(
        sourceId,
        event.chain_evidence.slot,
        event.chain_evidence.slot,
        event.chain_evidence.signature,
        event.event_id,
        bounded,
      ).all();
      return result?.results || [];
    },
    async countPendingWatchesForSource(sourceId, event) {
      if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA) throw new CustomerWalletCopyError("wallet_source_event_invalid");
      const row = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM ravenos_customer_wallet_copy_watches w
        WHERE w.source_wallet_id = ?
          AND w.state = 'active'
          AND w.backfill_complete = 1
          AND w.cursor_slot IS NOT NULL
          AND (
            w.cursor_slot < ?
            OR (w.cursor_slot = ? AND COALESCE(w.cursor_signature, '') != ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_customer_shadow_copy_decisions d
            WHERE d.watch_id = w.watch_id AND d.source_event_id = ?
          )
      `).bind(
        sourceId,
        event.chain_evidence.slot,
        event.chain_evidence.slot,
        event.chain_evidence.signature,
        event.event_id,
      ).first();
      return Number(row?.count || 0);
    },
    getWatchOwned,
    async updateWatch(userId, watchIdentifier, { state, label, policy, expected_revision: expectedRevision, now }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_wallet_copy_watches SET
          state = ?, label = ?, copy_mode = ?, policy_version = ?, policy_hash = ?, policy_json = ?,
          revision = revision + 1, updated_at = ?
        WHERE user_id = ? AND watch_id = ? AND revision = ?
      `).bind(state, label, policy.mode, policy.policy_version, policy.policy_hash, JSON.stringify(policy), now, userId, watchIdentifier, expectedRevision).run();
      return Number(result?.meta?.changes || 0) > 0 ? getWatchOwned(userId, watchIdentifier) : null;
    },
    async advanceWatchCursor(userId, watchIdentifier, { signature, slot, backfill_complete: backfillComplete, now }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_wallet_copy_watches SET
          cursor_signature = ?, cursor_slot = ?, backfill_complete = ?, revision = revision + 1, updated_at = ?
        WHERE user_id = ? AND watch_id = ?
      `).bind(signature || null, slot ?? null, backfillComplete ? 1 : 0, now, userId, watchIdentifier).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async advanceObservedWatchCursor(watchIdentifier, event, now) {
      if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA) throw new CustomerWalletCopyError("wallet_source_event_invalid");
      const result = await db.prepare(`
        UPDATE ravenos_customer_wallet_copy_watches SET
          cursor_signature = ?, cursor_slot = ?, revision = revision + 1, updated_at = ?
        WHERE watch_id = ? AND state = 'active' AND backfill_complete = 1
          AND (
            cursor_slot IS NULL
            OR cursor_slot < ?
            OR (cursor_slot = ? AND COALESCE(cursor_signature, '') != ?)
          )
      `).bind(
        event.chain_evidence.signature,
        event.chain_evidence.slot,
        now,
        watchIdentifier,
        event.chain_evidence.slot,
        event.chain_evidence.slot,
        event.chain_evidence.signature,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async deleteWatch(userId, watchIdentifier) {
      const result = await db.prepare("DELETE FROM ravenos_customer_wallet_copy_watches WHERE user_id = ? AND watch_id = ?").bind(userId, watchIdentifier).run();
      return Number(result?.meta?.changes || 0);
    },
    async recordDecision(userId, decision, now) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_customer_shadow_copy_decisions (
          decision_id, user_id, watch_id, source_event_id, decision_state, reason_code,
          policy_version, policy_hash, source_event_at, decided_at, decision_json,
          live_execution_authorized, fee_collection_authorized, transaction_hash, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
      `).bind(
        decision.decision_id,
        userId,
        decision.watch_id,
        decision.source_event_id,
        decision.decision.state,
        decision.decision.reason_code,
        decision.policy.policy_version,
        decision.policy.policy_hash,
        epoch(decision.timing.source_chain_event_at),
        now,
        JSON.stringify(decision),
        now + CustomerWalletCopyLimits.customer_decision_retention_seconds,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async recordPosition(userId, position, now) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_customer_shadow_copy_positions (
          position_id, user_id, watch_id, source_event_id, opening_decision_id,
          asset_mint, state, position_json, opened_at, updated_at,
          live_assets_held, transaction_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `).bind(
        position.position_id,
        userId,
        position.watch_id,
        position.source_event_id,
        position.opening_decision_id,
        position.destination_asset.mint,
        position.state,
        JSON.stringify(position),
        epoch(position.opened_at) ?? now,
        now,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async listDecisions(userId, limit = CustomerWalletCopyLimits.maximum_decisions_per_response) {
      const result = await db.prepare(`
        SELECT decision_json FROM ravenos_customer_shadow_copy_decisions
        WHERE user_id = ? ORDER BY decided_at DESC, decision_id DESC LIMIT ?
      `).bind(userId, Math.min(CustomerWalletCopyLimits.maximum_decisions_per_response, limit)).all();
      return (result?.results || []).map((row) => parseJson(row.decision_json)).filter((row) => row?.schema_version === RAVEN_COPY_DECISION_SCHEMA);
    },
    async listPositions(userId, limit = CustomerWalletCopyLimits.maximum_positions_per_response) {
      const result = await db.prepare(`
        SELECT position_json FROM ravenos_customer_shadow_copy_positions
        WHERE user_id = ? ORDER BY updated_at DESC, position_id DESC LIMIT ?
      `).bind(userId, Math.min(CustomerWalletCopyLimits.maximum_positions_per_response, limit)).all();
      return (result?.results || []).map((row) => parseJson(row.position_json)).filter((row) => row?.schema_version === RAVEN_COPY_POSITION_SCHEMA);
    },
  });
}

function publicWatch(row) {
  const policy = parseJson(row.policy_json);
  if (policy?.schema_version !== RAVEN_COPY_POLICY_SCHEMA) throw new CustomerWalletCopyError("stored_wallet_copy_state_invalid");
  return Object.freeze({
    watch_id: row.watch_id,
    source_wallet_id: row.source_wallet_id,
    source_wallet: { chain: "solana", network: "mainnet", address: row.address },
    label: row.label,
    state: row.state,
    copy_mode: row.copy_mode,
    policy,
    backfill_complete: Number(row.backfill_complete) === 1,
    cursor: { signature: row.cursor_signature || null, slot: row.cursor_slot === null ? null : Number(row.cursor_slot) },
    source_state: { state: row.observation_state, last_observed_at: iso(row.last_observed_at), last_signature: row.last_signature || null },
    revision: Number(row.revision),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

function routeMatch(pathname) {
  if (pathname === CUSTOMER_WALLET_COPY_ROUTE) return { kind: "summary", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/inspect`) return { kind: "inspect", methods: new Set(["POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/screener`) return { kind: "screener", methods: new Set(["POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/saved-wallets`) return { kind: "research_saves", methods: new Set(["GET", "POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/watches`) return { kind: "watches", methods: new Set(["GET", "POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/decisions`) return { kind: "decisions", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/positions`) return { kind: "positions", methods: new Set(["GET"]) };
  const sourceWallet = pathname.match(/^\/api\/v1\/wallet-copy\/wallets\/(sw_sol_[a-f0-9]{40})$/);
  if (sourceWallet) return { kind: "source_wallet", source_wallet_id: sourceWallet[1], methods: new Set(["GET"]) };
  const researchSave = pathname.match(/^\/api\/v1\/wallet-copy\/saved-wallets\/(wrs_[A-Za-z0-9_-]{16,96})$/);
  if (researchSave) return { kind: "research_save", save_id: researchSave[1], methods: new Set(["DELETE"]) };
  const refresh = pathname.match(/^\/api\/v1\/wallet-copy\/watches\/(wcw_[A-Za-z0-9_-]{16,96})\/refresh$/);
  if (refresh) return { kind: "refresh", watch_id: refresh[1], methods: new Set(["POST"]) };
  const watch = pathname.match(/^\/api\/v1\/wallet-copy\/watches\/(wcw_[A-Za-z0-9_-]{16,96})$/);
  if (watch) return { kind: "watch", watch_id: watch[1], methods: new Set(["PATCH", "DELETE"]) };
  return null;
}

async function authorizeCapability(request, env, deps, mutation) {
  const authorize = deps.authorizeRequest || authorizeCustomerApiRequest;
  const authorization = await authorize(request, env, deps.identity || {}, { require_csrf: mutation });
  if (authorization.response) return { authorization, response: authorization.response };
  let grants;
  try {
    const entitlementStore = deps.entitlementStore || createD1CustomerEntitlementStore(env.RAVENOS_CUSTOMER_DB);
    grants = await entitlementStore.listOwnedGrants(authorization.principal.user_id);
  } catch {
    return { authorization, response: privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "unavailable", error: "entitlement_store_unavailable" }, { status: 503 }, authorization) };
  }
  const access = resolveCapabilityAccess({
    capability: "wallet.copy",
    user_id: authorization.principal.user_id,
    grants,
    now: authorization.now,
    flags: resolveEntitlementFeatureFlags(env),
  });
  if (!access.available) {
    const status = new Set(["not_granted", "expired", "revoked", "suspended", "not_yet_active"]).has(access.state) ? 403 : 503;
    return { authorization, access, response: privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: access.state, error: status === 403 ? "capability_not_authorized" : "capability_unavailable" }, { status }, authorization) };
  }
  return { authorization, access, response: null };
}

async function applyRateLimit(authorization, request, env, deps, route, mutation) {
  const consume = deps.consumeRateLimit || consumeCustomerRateLimit;
  const provider = new Set(["inspect", "refresh"]).has(route.kind);
  return consume({
    store: authorization.store,
    env,
    request,
    action: "customer_wallet_copy",
    scope: route.kind,
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: 15 * 60,
    limit: provider ? CustomerWalletCopyLimits.provider_refreshes_per_15_minutes : mutation ? CustomerWalletCopyLimits.mutations_per_15_minutes : CustomerWalletCopyLimits.reads_per_15_minutes,
    include_network: mutation,
  });
}

function responseError(error, authorization = null) {
  const moduleCode = clean(error?.code, 100);
  const screenerValidation = /^(?:wallet_screener_[a-z0-9_]+|active_within_hours_invalid|min_(?:trade_count|active_days|known_cost_basis_pct|closed_lots|win_rate_pct|roi_pct)_invalid|performance_state_invalid)$/i.test(moduleCode);
  const code = error instanceof CustomerWalletCopyError || screenerValidation ? moduleCode : "wallet_copy_state_unavailable";
  const status = code === "wallet_copy_request_too_large" ? 413
    : new Set(["wallet_copy_watch_not_found", "wallet_source_not_found", "wallet_profile_not_found"]).has(code) ? 404
      : new Set(["wallet_copy_watch_quota_exceeded", "wallet_copy_watch_revision_conflict", "wallet_research_save_quota_exceeded", "wallet_research_list_quota_exceeded", "source_cursor_gap"]).has(code) ? 409
        : new Set(["wallet_copy_provider_unavailable", "wallet_copy_state_unavailable", "stored_wallet_copy_state_invalid", "stored_wallet_research_save_invalid"]).has(code) ? 503
          : 400;
  return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "unavailable", error: code }, { status }, authorization);
}

function requireProvider(deps) {
  if (!deps.walletProvider || typeof deps.walletProvider.loadHistory !== "function") throw new CustomerWalletCopyError("wallet_copy_provider_unavailable");
  return deps.walletProvider;
}

function validateHistory(result, address) {
  const events = Array.isArray(result?.events) ? result.events : [];
  if (!events.length) throw new CustomerWalletCopyError("wallet_history_unavailable");
  if (events.length > CustomerWalletCopyLimits.maximum_history_transactions_per_request) throw new CustomerWalletCopyError("wallet_history_response_unbounded");
  for (const event of events) {
    if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA || event.source_wallet?.address !== address) throw new CustomerWalletCopyError("wallet_history_identity_mismatch");
  }
  return events;
}

export async function persistSourceWalletProfile(store, sourceId, now, history = null) {
  const allEvents = await store.listSourceEvents(sourceId, 500);
  if (!allEvents.length) return null;
  const retained = history || (await store.latestProfile(sourceId))?.data_quality || null;
  const profile = buildSolanaWalletProfile(allEvents, {
    generated_at: new Date(now * 1_000).toISOString(),
    history: retained,
  });
  await store.recordProfile(sourceId, profile, now);
  return profile;
}

async function inspectAddress({ address, store, provider, now }) {
  const sourceId = sourceWalletId(address);
  await store.upsertSourceWallet({ source_wallet_id: sourceId, address, now, state: "requested" });
  const loaded = await provider.loadHistory({
    address,
    limit: CustomerWalletCopyLimits.maximum_history_transactions_per_request,
    observation_mode: "historical_backfill",
    now,
  }).catch(() => null);
  const events = validateHistory(loaded, address);
  await store.recordEvents(sourceId, events, now);
  const latest = events[0];
  await store.updateSourceCursor(sourceId, {
    state: "backfilled",
    last_observed_at: now,
    last_signature: latest.chain_evidence.signature,
    now,
  });
  const profile = await persistSourceWalletProfile(store, sourceId, now, loaded);
  return { source_wallet_id: sourceId, profile, recent_events: events.slice(0, 12) };
}

function unavailableQuoteEvidence(reason) {
  return {
    source_notional_usdc: null,
    source_notional_basis: "unavailable",
    liquidity_usd: null,
    asset_evidence: { identity_resolved: true },
    entry: { state: "provider_unavailable", provider: "jupiter", reason, exact_asset_identity: true },
    exit: { state: "unavailable", provider: "jupiter", reason: "reverse_exit_not_requested", exact_asset_identity: true },
  };
}

function quoteCacheKey(provider, event, policy) {
  if (!policy.sizing.implemented) return `policy-only:${event.event_id}:${policy.sizing.kind}`;
  if (typeof provider.quoteCopySignalCacheKey === "function") {
    const provided = clean(provider.quoteCopySignalCacheKey({ event, policy }), 240);
    if (provided) return provided;
  }
  return `${event.event_id}:fixed_usdc:${policy.sizing.fixed_usdc}`;
}

async function quoteSignalEvidence({ event, policy, provider, now, quoteCache }) {
  if (!policy.sizing.implemented) return unavailableQuoteEvidence("sizing_mode_not_implemented");
  const key = quoteCacheKey(provider, event, policy);
  if (!quoteCache) return provider.quoteCopySignal({ event, policy, now });
  if (!quoteCache.has(key)) {
    quoteCache.set(key, Promise.resolve().then(() => provider.quoteCopySignal({ event, policy, now })));
  }
  return quoteCache.get(key);
}

async function evaluateNewSignalsWithStats({ events, watch, store, provider, userId, now, quoteCache = null }) {
  const policy = watch.policy;
  const decisions = [];
  let recorded = 0;
  let positions = 0;
  const eligible = events.filter((event) => event.copy_signal?.eligible_buy_signal).slice(0, CustomerWalletCopyLimits.maximum_new_signals_per_refresh);
  for (const event of eligible) {
    let evidence;
    try {
      evidence = typeof provider.quoteCopySignal === "function"
        ? await quoteSignalEvidence({ event, policy, provider, now, quoteCache })
        : unavailableQuoteEvidence("quote_provider_not_configured");
    } catch {
      evidence = unavailableQuoteEvidence("quote_provider_unavailable");
    }
    const decision = createRavenCopyDecision({
      watch_id: watch.watch_id,
      source_event: event,
      policy,
      ...evidence,
    }, { now: now * 1_000 });
    const inserted = await store.recordDecision(userId, decision, now);
    if (inserted) recorded += 1;
    if (inserted && decision.decision.state === "SHADOW_EXECUTABLE") {
      if (await store.recordPosition(userId, createShadowCopyPosition(decision), now)) positions += 1;
    }
    decisions.push(decision);
  }
  return { decisions, recorded, positions };
}

async function evaluateNewSignals(input) {
  return (await evaluateNewSignalsWithStats(input)).decisions;
}

export async function fanOutObservedWalletEvent({
  event,
  source_wallet_id: sourceId,
  store,
  provider,
  now = Math.floor(Date.now() / 1_000),
  maximum_policies: maximumPolicies = CustomerWalletCopyLimits.maximum_observer_policies_per_job,
  maximum_quote_variants: maximumQuoteVariants = CustomerWalletCopyLimits.maximum_observer_quote_variants_per_job,
} = {}) {
  if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA) throw new CustomerWalletCopyError("wallet_source_event_invalid");
  if (!/^sw_sol_[a-f0-9]{40}$/.test(String(sourceId || ""))) throw new CustomerWalletCopyError("wallet_source_id_invalid");
  if (sourceWalletId(event.source_wallet.address) !== sourceId) throw new CustomerWalletCopyError("wallet_source_event_identity_mismatch");
  if (!store?.listActiveWatchesForSource || !store?.advanceObservedWatchCursor) throw new CustomerWalletCopyError("wallet_observer_store_unavailable");
  if (!provider || typeof provider.quoteCopySignal !== "function") throw new CustomerWalletCopyError("wallet_copy_provider_unavailable");
  if (!event.copy_signal?.eligible_buy_signal) {
    return Object.freeze({
      complete: true,
      subscriber_policy_count: 0,
      decision_count: 0,
      position_count: 0,
      quote_variant_count: 0,
      deferred_policy_count: 0,
      decision_completed_at: new Date(now * 1_000).toISOString(),
    });
  }
  const policyLimit = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_observer_policies_per_job, Number(maximumPolicies) || 1));
  const quoteVariantLimit = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_observer_quote_variants_per_job, Number(maximumQuoteVariants) || 1));
  const rows = await store.listActiveWatchesForSource(sourceId, event, policyLimit);
  const quoteCache = new Map();
  let evaluated = 0;
  let recorded = 0;
  let positions = 0;
  let deferred = 0;
  for (const row of rows) {
    const watch = publicWatch(row);
    const key = quoteCacheKey(provider, event, watch.policy);
    if (!quoteCache.has(key) && quoteCache.size >= quoteVariantLimit) {
      deferred += 1;
      continue;
    }
    const result = await evaluateNewSignalsWithStats({
      events: [event],
      watch,
      store,
      provider,
      userId: row.user_id,
      now,
      quoteCache,
    });
    if (!result.decisions.length) throw new CustomerWalletCopyError("wallet_observer_decision_missing");
    evaluated += 1;
    recorded += result.recorded;
    positions += result.positions;
    await store.advanceObservedWatchCursor(watch.watch_id, event, now);
  }
  const pending = typeof store.countPendingWatchesForSource === "function"
    ? await store.countPendingWatchesForSource(sourceId, event)
    : deferred + (rows.length >= policyLimit ? 1 : 0);
  return Object.freeze({
    complete: pending === 0,
    subscriber_policy_count: evaluated,
    decision_count: recorded,
    position_count: positions,
    quote_variant_count: quoteCache.size,
    deferred_policy_count: pending,
    decision_completed_at: new Date().toISOString(),
  });
}

export async function routeCustomerWalletCopy(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const route = routeMatch(url.pathname);
  if (!route) return null;
  if (!sameOriginBoundary(request) || url.search || url.hash) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, error: "request_not_allowed" }, { status: 403 });
  if (!route.methods.has(request.method)) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, error: "method_not_allowed" }, { status: 405, extra_headers: { allow: [...route.methods].join(", ") } });
  const mutation = request.method !== "GET";
  const authorized = await authorizeCapability(request, env, deps, mutation);
  if (authorized.response) return authorized.response;
  const activation = resolveWalletCopyActivation(env);
  if (!activation.wallet_intelligence) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "wallet_intelligence_disabled", activation }, { status: 503 }, authorized.authorization);
  if (new Set(["screener", "source_wallet", "research_saves", "research_save"]).has(route.kind) && !activation.wallet_screener) {
    return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "wallet_screener_disabled", activation }, { status: 503 }, authorized.authorization);
  }
  if (new Set(["watches", "watch", "refresh", "decisions", "positions"]).has(route.kind) && !activation.shadow_copy) {
    return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "shadow_copy_disabled", activation }, { status: 503 }, authorized.authorization);
  }
  const userId = authorized.authorization.principal.user_id;
  const now = authorized.authorization.now;
  const store = deps.walletCopyStore || createD1CustomerWalletCopyStore(env.RAVENOS_CUSTOMER_DB);
  try {
    const limited = await applyRateLimit(authorized.authorization, request, env, deps, route, mutation && route.kind !== "screener");
    if (!limited.allowed) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "unavailable", error: "wallet_copy_rate_limited" }, { status: 429, extra_headers: { "retry-after": String(limited.retry_after_seconds) } }, authorized.authorization);

    if (route.kind === "summary") {
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: "available",
        capability: "wallet.copy",
        activation,
        limits: CustomerWalletCopyLimits,
        modes: ["WATCH", "SHADOW"],
        live_mode: "hard_disabled",
        execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false, transaction_material: false },
      }, {}, authorized.authorization);
    }

    if (route.kind === "inspect") {
      const body = exactObject(await parseBody(request), new Set(["address"]));
      const address = normalizeSolanaWalletAddress(body.address);
      const result = await inspectAddress({ address, store, provider: requireProvider(deps), now });
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "available", ...result }, {}, authorized.authorization);
    }

    if (route.kind === "screener") {
      const query = normalizeWalletScreenerRequest(await parseBody(request), { now });
      const result = await store.screenSourceWallets(query);
      return privateJson(buildWalletScreenerResponse({ query, rows: result.rows, total: result.total, now }), {}, authorized.authorization);
    }

    if (route.kind === "research_saves" && request.method === "GET") {
      const rows = await store.listResearchSaves(userId);
      const saves = rows.map(publicResearchSave);
      const listsByKey = new Map();
      for (const save of saves) {
        const key = save.list_name.toLowerCase();
        const existingList = listsByKey.get(key);
        if (existingList) existingList.count += 1;
        else listsByKey.set(key, { name: save.list_name, count: 1 });
      }
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: saves.length ? "available" : "empty",
        saves,
        lists: [...listsByKey.values()],
        limits: {
          maximum_saves: CustomerWalletCopyLimits.maximum_research_saves_per_account,
          maximum_lists: CustomerWalletCopyLimits.maximum_research_lists_per_account,
        },
      }, {}, authorized.authorization);
    }

    if (route.kind === "research_saves" && request.method === "POST") {
      const body = exactObject(await parseBody(request), new Set(["source_wallet_id", "list_name", "label"]));
      const sourceId = String(body.source_wallet_id || "");
      if (!/^sw_sol_[a-f0-9]{40}$/.test(sourceId)) throw new CustomerWalletCopyError("wallet_source_id_invalid");
      const source = await store.getSourceWallet(sourceId);
      if (!source) throw new CustomerWalletCopyError("wallet_source_not_found");
      const listName = normalizeResearchListName(body.list_name);
      const existing = await store.listResearchSaves(userId);
      const listKey = listName.toLowerCase();
      const existingListKeys = new Set(existing.map((row) => row.list_name.toLowerCase()));
      const duplicate = existing.find((row) => row.source_wallet_id === sourceId && row.list_name.toLowerCase() === listKey);
      if (!duplicate && existing.length >= CustomerWalletCopyLimits.maximum_research_saves_per_account) throw new CustomerWalletCopyError("wallet_research_save_quota_exceeded");
      if (!duplicate && !existingListKeys.has(listKey) && existingListKeys.size >= CustomerWalletCopyLimits.maximum_research_lists_per_account) {
        throw new CustomerWalletCopyError("wallet_research_list_quota_exceeded");
      }
      const proposedSaveId = researchSaveId(userId, sourceId, listName, now);
      const row = await store.saveResearchWallet({
        save_id: proposedSaveId,
        user_id: userId,
        source_wallet_id: sourceId,
        list_name: listName,
        label: normalizeLabel(body.label, source.address),
        now,
      });
      const created = !duplicate && row?.save_id === proposedSaveId;
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, created, save: publicResearchSave(row) }, { status: created ? 201 : 200 }, authorized.authorization);
    }

    if (route.kind === "research_save") {
      const body = exactObject(await parseBody(request), new Set(["confirm"]));
      if (body.confirm !== "delete_saved_wallet") throw new CustomerWalletCopyError("wallet_research_delete_confirmation_required");
      const deleted = await store.deleteResearchSave(userId, route.save_id);
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, deleted: deleted > 0 }, {}, authorized.authorization);
    }

    if (route.kind === "source_wallet") {
      const source = await store.getSourceWallet(route.source_wallet_id);
      if (!source) throw new CustomerWalletCopyError("wallet_source_not_found");
      const profile = await store.latestProfile(route.source_wallet_id);
      if (!profile || profile.source_wallet?.address !== source.address) throw new CustomerWalletCopyError("wallet_profile_not_found");
      const events = await store.listSourceEvents(route.source_wallet_id, 12);
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: "available",
        source_wallet_id: route.source_wallet_id,
        profile,
        recent_events: events.slice(0, 12),
        evidence_mode: "retained_raven_index",
        provider_request_performed: false,
      }, {}, authorized.authorization);
    }

    if (route.kind === "watches" && request.method === "GET") {
      const rows = await store.listWatches(userId);
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: rows.length ? "available" : "empty", watches: rows.map(publicWatch), limits: { maximum: CustomerWalletCopyLimits.maximum_watches_per_account, remaining: Math.max(0, CustomerWalletCopyLimits.maximum_watches_per_account - rows.length) } }, {}, authorized.authorization);
    }

    if (route.kind === "watches" && request.method === "POST") {
      const body = exactObject(await parseBody(request), new Set(["address", "label", "policy"]));
      const address = normalizeSolanaWalletAddress(body.address);
      const policy = createRavenCopyPolicy(body.policy || {});
      if (await store.countWatches(userId) >= CustomerWalletCopyLimits.maximum_watches_per_account) throw new CustomerWalletCopyError("wallet_copy_watch_quota_exceeded");
      const sourceId = sourceWalletId(address);
      await store.upsertSourceWallet({ source_wallet_id: sourceId, address, now, state: "requested" });
      const row = await store.createWatch({
        watch_id: watchId(userId, address, policy.policy_hash, now),
        user_id: userId,
        source_wallet_id: sourceId,
        label: normalizeLabel(body.label, address),
        policy,
        now,
      });
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, created: true, watch: publicWatch(row) }, { status: 201 }, authorized.authorization);
    }

    if (route.kind === "watch" && request.method === "PATCH") {
      const currentRow = await store.getWatchOwned(userId, route.watch_id);
      if (!currentRow) throw new CustomerWalletCopyError("wallet_copy_watch_not_found");
      const current = publicWatch(currentRow);
      const body = exactObject(await parseBody(request), new Set(["state", "label", "policy", "expected_revision"]));
      const expectedRevision = Number(body.expected_revision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new CustomerWalletCopyError("wallet_copy_watch_revision_invalid");
      const state = clean(body.state || current.state, 16).toLowerCase();
      if (!new Set(["active", "paused"]).has(state)) throw new CustomerWalletCopyError("wallet_copy_watch_state_invalid");
      const policy = body.policy === undefined ? current.policy : createRavenCopyPolicy({ ...body.policy, policy_version: current.policy.policy_version + 1 });
      const updated = await store.updateWatch(userId, route.watch_id, {
        state,
        label: normalizeLabel(body.label || current.label, current.source_wallet.address),
        policy,
        expected_revision: expectedRevision,
        now,
      });
      if (!updated) throw new CustomerWalletCopyError("wallet_copy_watch_revision_conflict");
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, watch: publicWatch(updated) }, {}, authorized.authorization);
    }

    if (route.kind === "watch" && request.method === "DELETE") {
      const body = exactObject(await parseBody(request), new Set(["confirm"]));
      if (body.confirm !== "delete_wallet_watch") throw new CustomerWalletCopyError("wallet_copy_delete_confirmation_required");
      const deleted = await store.deleteWatch(userId, route.watch_id);
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, deleted: deleted > 0 }, {}, authorized.authorization);
    }

    if (route.kind === "refresh") {
      const body = exactObject(await parseBody(request), new Set([]));
      if (Object.keys(body).length) throw new CustomerWalletCopyError("wallet_copy_request_invalid");
      const row = await store.getWatchOwned(userId, route.watch_id);
      if (!row) throw new CustomerWalletCopyError("wallet_copy_watch_not_found");
      const watch = publicWatch(row);
      if (watch.state !== "active") throw new CustomerWalletCopyError("wallet_copy_watch_paused");
      const provider = requireProvider(deps);
      const initial = !watch.backfill_complete || !watch.cursor.signature;
      const loaded = await provider.loadHistory({
        address: watch.source_wallet.address,
        limit: CustomerWalletCopyLimits.maximum_history_transactions_per_request,
        observation_mode: initial ? "historical_backfill" : "prospective",
        now,
      }).catch(() => null);
      const events = validateHistory(loaded, watch.source_wallet.address);
      let newEvents = [];
      if (!initial) {
        const cursorIndex = events.findIndex((event) => event.chain_evidence.signature === watch.cursor.signature);
        if (cursorIndex < 0) throw new CustomerWalletCopyError("source_cursor_gap");
        newEvents = events.slice(0, cursorIndex);
      }
      await store.recordEvents(row.source_wallet_id, events, now);
      const newest = events[0];
      await store.updateSourceCursor(row.source_wallet_id, { state: "current", last_observed_at: now, last_signature: newest.chain_evidence.signature, now });
      const decisions = initial ? [] : await evaluateNewSignals({ events: newEvents, watch, store, provider, userId, now });
      await store.advanceWatchCursor(userId, route.watch_id, { signature: newest.chain_evidence.signature, slot: newest.chain_evidence.slot, backfill_complete: true, now });
      const profile = await persistSourceWalletProfile(store, row.source_wallet_id, now, initial ? loaded : null);
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: initial ? "baseline_established" : "refreshed",
        historical_events_added: initial ? events.length : 0,
        prospective_events_observed: newEvents.length,
        decisions,
        profile,
        continuous_monitoring: false,
        next_step: "Check again to look for newer source-wallet activity.",
      }, {}, authorized.authorization);
    }

    if (route.kind === "decisions") {
      const decisions = await store.listDecisions(userId);
      const byWatch = new Map();
      for (const decision of decisions) {
        const rows = byWatch.get(decision.watch_id) || [];
        rows.push(decision);
        byWatch.set(decision.watch_id, rows);
      }
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: decisions.length ? "available" : "empty",
        decisions,
        copyability: [...byWatch.entries()].map(([watchIdentifier, rows]) => ({
          watch_id: watchIdentifier,
          snapshot: buildCopyabilitySnapshot(rows, { generated_at: new Date(now * 1_000).toISOString() }),
          by_size: buildCopyabilityBySize(rows, { generated_at: new Date(now * 1_000).toISOString() }),
        })),
      }, {}, authorized.authorization);
    }

    const positions = await store.listPositions(userId);
    return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: positions.length ? "available" : "empty", positions, live_assets_held: false }, {}, authorized.authorization);
  } catch (error) {
    return responseError(error, authorized.authorization);
  }
}

export const CustomerWalletCopyContract = Object.freeze({
  schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
  route: CUSTOMER_WALLET_COPY_ROUTE,
  capability: "wallet.copy",
  limits: CustomerWalletCopyLimits,
  flags: Object.freeze({
    intelligence: "RAVENOS_WALLET_INTELLIGENCE_ENABLED",
    routes: "RAVENOS_WALLET_COPY_ROUTES_ENABLED",
    screener: "RAVENOS_WALLET_SCREENER_ENABLED",
    shadow: "RAVENOS_SHADOW_COPY_ENABLED",
    live: "RAVENOS_LIVE_COPY_ENABLED",
    fee_collection: "RAVENOS_COPY_FEE_COLLECTION_ENABLED",
    observer: "RAVENOS_WALLET_OBSERVER_ENABLED",
    observer_evaluator: "RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED",
  }),
  source_level_disabled: Object.freeze({ live_copy: true, signing: true, broadcasting: true, custody: true, fee_collection: true, live_execution_scheduler: true }),
});
