import { createHash, randomBytes } from "node:crypto";

import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";

import { normalizeHyperliquidAddress } from "./hyperliquid_account_snapshot.mjs";

export const HYPERLIQUID_LIVE_TICKET_SCHEMA = "ravenos.hyperliquid_live_ticket.v1";
export const HYPERLIQUID_BUILDER_APPROVAL_SCHEMA = "ravenos.hyperliquid_builder_approval.v1";
export const CUSTOMER_LIVE_EXECUTION_RESULT_SCHEMA = "ravenos.customer_live_execution_result.v1";

const MAX_TICKET_AGE_MS = 10_000;
const MAX_IMPACT_BPS = 500;
const SUPPORTED_ORDER_TYPES = new Set(["market", "limit"]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function finite(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function integer(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function clean(value, maximum = 160) {
  return String(value ?? "").trim().slice(0, maximum);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function ticketId() {
  return `lex_${randomBytes(18).toString("base64url")}`;
}

function approvalId() {
  return `lba_${randomBytes(18).toString("base64url")}`;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return { millis: parsed, iso: new Date(parsed).toISOString() };
}

function maximumMarketPrice(scenario, side, impactBps, szDecimals) {
  const reference = scenario.market_reference || {};
  const base = side === "long"
    ? finite(reference.best_ask, "best_ask") * (1 + impactBps / 10_000)
    : finite(reference.best_bid, "best_bid") * (1 - impactBps / 10_000);
  if (!(base > 0)) fail("market_price_guard_invalid");
  return formatPrice(base, szDecimals, "perp");
}

function executionBlockers(scenario) {
  const blockers = Array.isArray(scenario?.review?.blockers) ? scenario.review.blockers.map(String) : [];
  return blockers.filter((reason) => reason !== "venue_margin_settings_change_required");
}

function normalizedBuilderFeePolicy(value = {}) {
  if (value?.enabled !== true) {
    return Object.freeze({
      enabled: false,
      access_tier: clean(value?.access_tier || "free", 16).toLowerCase(),
      fee_bps: 0,
      fee_parameter_value: 0,
      fee_recipient: "",
      fee_token: "USDC",
    });
  }
  if (clean(value.provider, 32).toLowerCase() !== "hyperliquid"
    || clean(value.trade_type, 32).toLowerCase() !== "perpetual"
    || clean(value.fee_kind, 32).toLowerCase() !== "builder_fee"
    || clean(value.fee_parameter_unit, 48).toLowerCase() !== "tenths_of_a_basis_point") {
    fail("builder_fee_policy_invalid");
  }
  const recipient = normalizeHyperliquidAddress(value.fee_recipient);
  if (!recipient) fail("builder_fee_recipient_invalid");
  const feeBps = integer(value.fee_bps, "builder_fee_bps", 1, 10);
  const feeParameterValue = integer(value.fee_parameter_value, "builder_fee_parameter", 1, 100);
  if (feeParameterValue !== feeBps * 10) fail("builder_fee_parameter_mismatch");
  return Object.freeze({
    enabled: true,
    access_tier: clean(value.access_tier || "free", 16).toLowerCase(),
    fee_bps: feeBps,
    fee_parameter_value: feeParameterValue,
    fee_recipient: recipient,
    fee_token: "USDC",
  });
}

function feePercentString(feeBps) {
  return `${Number(feeBps / 100).toFixed(2)}%`;
}

export function createHyperliquidBuilderApproval(input = {}, { now = Date.now(), ttlMs = 60_000 } = {}) {
  const walletAddress = normalizeHyperliquidAddress(input.wallet_address);
  if (!walletAddress) fail("wallet_account_identity_mismatch");
  const policy = normalizedBuilderFeePolicy(input.fee_policy);
  if (!policy.enabled) fail("builder_fee_collection_disabled");
  const approvedFeeParameterValue = integer(
    input.approved_fee_parameter_value ?? 0,
    "approved_builder_fee_parameter",
    0,
    100,
  );
  if (approvedFeeParameterValue >= policy.fee_parameter_value) fail("builder_fee_already_approved");
  const expiresAtMs = now + Math.max(10_000, Math.min(120_000, Number(ttlMs) || 60_000));
  const action = Object.freeze({
    builder: policy.fee_recipient,
    maxFeeRate: feePercentString(policy.fee_bps),
  });
  const binding = Object.freeze({
    wallet_address: walletAddress,
    fee_parameter_value: policy.fee_parameter_value,
    approved_fee_parameter_value: approvedFeeParameterValue,
    expires_at: new Date(expiresAtMs).toISOString(),
    action,
  });
  return Object.freeze({
    ok: true,
    schema_version: HYPERLIQUID_BUILDER_APPROVAL_SCHEMA,
    approval_id: approvalId(),
    state: "awaiting_main_wallet_approval",
    created_at: new Date(now).toISOString(),
    expires_at: binding.expires_at,
    wallet_address: walletAddress,
    action,
    action_hash: hash(action),
    binding_hash: hash(binding),
    fee: Object.freeze({
      raven_fee_enabled: true,
      raven_fee_bps: policy.fee_bps,
      fee_percent: feePercentString(policy.fee_bps),
      fee_token: "USDC",
      builder_address: policy.fee_recipient,
      required_fee_parameter_value: policy.fee_parameter_value,
      currently_approved_fee_parameter_value: approvedFeeParameterValue,
      venue_approval_required: true,
      approval_changes_order_authority: false,
    }),
    execution_boundary: Object.freeze({
      main_wallet_signature_required: true,
      signing_location: "connected_browser_wallet",
      order_submission_included: false,
      server_signing: false,
      private_key_received: false,
      custody: false,
    }),
  });
}

export function createHyperliquidLiveTicket(input = {}, { now = Date.now(), ttlMs = MAX_TICKET_AGE_MS } = {}) {
  const scenario = input.scenario && typeof input.scenario === "object" ? input.scenario : {};
  if (scenario.ok !== true || !new Set(["account_scenario_available", "account_scenario_blocked"]).has(scenario.state)) {
    fail("account_scenario_required");
  }
  const blockers = executionBlockers(scenario);
  if (blockers.length) fail("account_scenario_blocked", { blockers });
  const walletAddress = normalizeHyperliquidAddress(input.wallet_address);
  if (!walletAddress || normalizeHyperliquidAddress(scenario.account_context?.address) !== walletAddress) {
    fail("wallet_account_identity_mismatch");
  }
  const accountObserved = timestamp(scenario.account_context?.observed_at, "account_observed_at");
  if (now - accountObserved.millis > 12_000 || accountObserved.millis - now > 5_000) fail("account_snapshot_stale");
  const scenarioExpiry = timestamp(scenario.expires_at, "scenario_expiry");
  if (scenarioExpiry.millis <= now + 1_000) fail("account_scenario_expired");

  const market = input.market && typeof input.market === "object" ? input.market : {};
  const instrumentId = clean(scenario.instrument?.instrument_id);
  const coin = clean(scenario.instrument?.exact_market_id, 40).toUpperCase();
  if (!coin || instrumentId !== `hyperliquid:perp:${coin}` || clean(market.instrument_id) !== instrumentId) {
    fail("exact_instrument_identity_mismatch");
  }
  const assetIndex = integer(market.asset_index, "asset_index", 0, 100_000);
  const szDecimals = integer(market.sz_decimals, "sz_decimals", 0, 12);
  const side = clean(scenario.intent?.side, 16).toLowerCase();
  if (!new Set(["long", "short"]).has(side)) fail("side_invalid");
  const orderType = clean(scenario.intent?.order_type, 16).toLowerCase();
  if (!SUPPORTED_ORDER_TYPES.has(orderType)) fail("live_order_type_not_supported");
  if (scenario.risk_bracket?.configured) fail("live_bracket_not_supported");
  const reduceOnly = scenario.intent?.reduce_only === true;
  const notionalUsdc = finite(scenario.intent?.requested_notional_usdc, "notional_usdc");
  const maximumNotionalUsdc = finite(input.maximum_notional_usdc, "maximum_notional_usdc");
  if (!(notionalUsdc >= 10) || notionalUsdc > maximumNotionalUsdc) fail("live_notional_out_of_bounds");
  const leverage = integer(scenario.intent?.leverage, "leverage", 1, integer(market.max_leverage, "maximum_leverage", 1, 100));
  const marginMode = clean(scenario.intent?.margin_mode, 16).toLowerCase();
  if (!new Set(["cross", "isolated"]).has(marginMode)) fail("margin_mode_invalid");
  const impactBps = integer(input.max_impact_bps, "max_impact_bps", 1, MAX_IMPACT_BPS);
  const rawSize = finite(scenario.intent?.planned_base_size, "planned_base_size");
  const size = formatSize(rawSize, szDecimals);
  if (!(Number(size) > 0)) fail("formatted_size_below_minimum");
  const price = orderType === "market"
    ? maximumMarketPrice(scenario, side, impactBps, szDecimals)
    : formatPrice(finite(scenario.intent?.limit_price, "limit_price"), szDecimals, "perp");
  const tif = orderType === "market"
    ? "FrontendMarket"
    : ({ gtc: "Gtc", ioc: "Ioc", alo: "Alo" })[clean(scenario.intent?.time_in_force, 8).toLowerCase()];
  if (!tif) fail("time_in_force_invalid");

  const feePolicy = normalizedBuilderFeePolicy(input.fee_policy);
  const approvedFeeParameterValue = integer(
    input.approved_fee_parameter_value ?? 0,
    "approved_builder_fee_parameter",
    0,
    100,
  );
  if (feePolicy.enabled && approvedFeeParameterValue < feePolicy.fee_parameter_value) {
    fail("builder_fee_approval_required", {
      required_fee_parameter_value: feePolicy.fee_parameter_value,
      approved_fee_parameter_value: approvedFeeParameterValue,
    });
  }
  const builder = feePolicy.enabled
    ? Object.freeze({ b: feePolicy.fee_recipient, f: feePolicy.fee_parameter_value })
    : null;
  const estimatedFeeUsdc = feePolicy.enabled
    ? Number((notionalUsdc * feePolicy.fee_bps / 10_000).toFixed(6))
    : 0;

  const action = Object.freeze({
    orders: Object.freeze([Object.freeze({
      a: assetIndex,
      b: side === "long",
      p: price,
      s: size,
      r: reduceOnly,
      t: Object.freeze({ limit: Object.freeze({ tif }) }),
    })]),
    grouping: "na",
    ...(builder ? { builder } : {}),
  });
  const settingsChangeRequired = !reduceOnly && (
    scenario.venue_settings?.settings_change_required === true
    || !scenario.account_context?.current_position
  );
  const expiresAtMs = Math.min(scenarioExpiry.millis, now + Math.max(2_000, Math.min(MAX_TICKET_AGE_MS, ttlMs)));
  const binding = Object.freeze({
    wallet_address: walletAddress,
    scenario_id: clean(scenario.scenario_id),
    instrument_id: instrumentId,
    exact_market_id: coin,
    asset_index: assetIndex,
    side,
    order_type: orderType,
    notional_usdc: notionalUsdc,
    size,
    price,
    reduce_only: reduceOnly,
    leverage,
    margin_mode: marginMode,
    max_impact_bps: impactBps,
    expires_at: new Date(expiresAtMs).toISOString(),
    action,
    fee: Object.freeze({
      raven_fee_enabled: feePolicy.enabled,
      raven_fee_bps: feePolicy.fee_bps,
      estimated_raven_fee_usdc: estimatedFeeUsdc,
      fee_token: "USDC",
      fee_basis: "filled_order_notional",
      collection_method: feePolicy.enabled ? "hyperliquid_builder_code" : "none",
      builder_address: feePolicy.fee_recipient || null,
      builder_fee_parameter_value: feePolicy.fee_parameter_value,
    }),
  });

  return Object.freeze({
    ok: true,
    schema_version: HYPERLIQUID_LIVE_TICKET_SCHEMA,
    ticket_id: ticketId(),
    state: "awaiting_wallet_signature",
    created_at: new Date(now).toISOString(),
    expires_at: binding.expires_at,
    wallet_address: walletAddress,
    instrument: Object.freeze({
      instrument_id: instrumentId,
      exact_market_id: coin,
      asset_index: assetIndex,
      sz_decimals: szDecimals,
      venue: "hyperliquid",
    }),
    reviewed_order: Object.freeze({
      side,
      order_type: orderType,
      notional_usdc: notionalUsdc,
      base_size: size,
      limit_or_guard_price: price,
      time_in_force: tif,
      reduce_only: reduceOnly,
      maximum_impact_bps: impactBps,
      leverage,
      margin_mode: marginMode,
    }),
    pre_actions: Object.freeze({
      update_leverage: Object.freeze({
        required: settingsChangeRequired,
        asset: assetIndex,
        isCross: marginMode === "cross",
        leverage,
      }),
    }),
    action,
    action_hash: hash(action),
    binding_hash: hash(binding),
    fee: binding.fee,
    execution_boundary: Object.freeze({
      wallet_confirmation_required: true,
      signing_location: "connected_browser_wallet",
      submission_path: "wallet_signed_direct_to_hyperliquid",
      server_signing: false,
      private_key_received: false,
      custody: false,
      arbitrary_action_allowed: false,
    }),
  });
}

function normalizedOrderStatus(value) {
  const status = value?.response?.data?.statuses?.[0];
  if (status?.filled) return {
    state: "filled",
    oid: integer(status.filled.oid, "filled_order_id"),
    fill: Object.freeze({
      oid: integer(status.filled.oid, "filled_order_id"),
      total_size: clean(status.filled.totalSz, 80) || null,
      average_price: clean(status.filled.avgPx, 80) || null,
    }),
  };
  if (status?.resting) return { state: "resting", oid: integer(status.resting.oid, "resting_order_id"), fill: null };
  if (status === "waitingForFill") return { state: "waiting_for_fill", oid: null, fill: null };
  if (status === "waitingForTrigger") return { state: "waiting_for_trigger", oid: null, fill: null };
  if (status?.error) return { state: "rejected", oid: null, fill: null, reason: clean(status.error, 240) };
  fail("hyperliquid_order_response_invalid");
}

export function normalizeHyperliquidClientExecutionReport(input = {}, expected = {}) {
  const ticketIdValue = clean(input.ticket_id, 100);
  if (!ticketIdValue.startsWith("lex_") || ticketIdValue !== clean(expected.ticket_id, 100)) fail("execution_ticket_identity_mismatch");
  const walletAddress = normalizeHyperliquidAddress(input.wallet_address);
  if (!walletAddress || walletAddress !== normalizeHyperliquidAddress(expected.wallet_address)) fail("execution_wallet_identity_mismatch");
  if (clean(input.action_hash, 80) !== clean(expected.action_hash, 80)) fail("execution_action_hash_mismatch");
  const normalized = normalizedOrderStatus(input.provider_response);
  return Object.freeze({
    schema_version: CUSTOMER_LIVE_EXECUTION_RESULT_SCHEMA,
    ticket_id: ticketIdValue,
    venue: "hyperliquid",
    wallet_address: walletAddress,
    state: normalized.state,
    provider_order_id: normalized.oid,
    fill: normalized.fill,
    rejection_reason: normalized.reason || null,
    evidence_state: "client_reported_pending_provider_reconciliation",
    transaction_hash: null,
  });
}

export function createD1CustomerLiveExecutionStore(db) {
  if (!db?.prepare) fail("live_execution_store_unavailable");
  return Object.freeze({
    async createTicket({ ticket, user_id: userId, now_seconds: nowSeconds }) {
      await db.prepare(`
        INSERT INTO ravenos_customer_live_execution_intents
          (execution_id, schema_version, user_id, venue, chain_namespace, wallet_address, exact_market_id,
           side, order_type, notional_usdc, raven_fee_bps, expected_raven_fee_usdc, observed_raven_fee_usdc,
           fee_token, fee_recipient, fee_collection_method, fee_collection_status,
           state, prepared_payload_hash, provider_request_id,
           prepared_json, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'hyperliquid', 'hyperliquid', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?,
                'awaiting_wallet_signature', ?, NULL, ?, ?, ?, ?)
      `).bind(
        ticket.ticket_id,
        HYPERLIQUID_LIVE_TICKET_SCHEMA,
        userId,
        ticket.wallet_address,
        ticket.instrument.exact_market_id,
        ticket.reviewed_order.side,
        ticket.reviewed_order.order_type,
        ticket.reviewed_order.notional_usdc,
        ticket.fee.raven_fee_bps,
        ticket.fee.estimated_raven_fee_usdc,
        ticket.fee.raven_fee_enabled ? "USDC" : null,
        ticket.fee.builder_address,
        ticket.fee.collection_method,
        ticket.fee.raven_fee_enabled ? "expected" : "disabled",
        ticket.action_hash,
        JSON.stringify(ticket),
        Math.floor(Date.parse(ticket.expires_at) / 1000),
        nowSeconds,
        nowSeconds,
      ).run();
      await this.appendEvent({
        execution_id: ticket.ticket_id,
        state: "awaiting_wallet_signature",
        evidence: { action_hash: ticket.action_hash, binding_hash: ticket.binding_hash },
        now_seconds: nowSeconds,
      });
      return ticket;
    },
    async findTicket(executionId, userId) {
      const row = await db.prepare(`
        SELECT execution_id, user_id, venue, chain_namespace, wallet_address, exact_market_id, state,
               raven_fee_bps, expected_raven_fee_usdc, observed_raven_fee_usdc, fee_token, fee_recipient,
               fee_collection_method, fee_collection_status, prepared_payload_hash, provider_request_id,
               prepared_json, expires_at, created_at, updated_at
        FROM ravenos_customer_live_execution_intents
        WHERE execution_id = ? AND user_id = ?
      `).bind(clean(executionId, 100), clean(userId, 160)).first();
      if (!row) return null;
      return Object.freeze({ ...row, prepared: JSON.parse(row.prepared_json) });
    },
    async recordClientReport({ record, user_id: userId, now_seconds: nowSeconds }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = ?, provider_request_id = ?, updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND state = 'awaiting_wallet_signature' AND expires_at >= ?
      `).bind(
        record.state === "rejected" ? "rejected" : "client_reported",
        record.provider_order_id === null ? null : String(record.provider_order_id),
        nowSeconds,
        record.ticket_id,
        userId,
        nowSeconds,
      ).run();
      if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) fail("execution_ticket_not_reportable");
      await this.appendEvent({ execution_id: record.ticket_id, state: record.state, evidence: record, now_seconds: nowSeconds });
      return record;
    },
    async reconcile({ execution_id: executionId, user_id: userId, state, evidence, now_seconds: nowSeconds }) {
      const nextState = new Set(["provider_confirmed", "provider_rejected", "indeterminate"]).has(state) ? state : "indeterminate";
      const observedFee = Number(evidence?.fee_collection?.observed_raven_fee_usdc);
      const feeStatus = clean(evidence?.fee_collection?.state, 24);
      const normalizedFeeStatus = new Set(["expected", "observed", "failed", "indeterminate"]).has(feeStatus)
        ? feeStatus
        : null;
      await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = ?, observed_raven_fee_usdc = COALESCE(?, observed_raven_fee_usdc),
            fee_collection_status = COALESCE(?, fee_collection_status), updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND state IN ('client_reported', 'reconciliation_pending')
      `).bind(
        nextState,
        Number.isFinite(observedFee) && observedFee >= 0 ? observedFee : null,
        normalizedFeeStatus,
        nowSeconds,
        executionId,
        userId,
      ).run();
      await this.appendEvent({ execution_id: executionId, state: nextState, evidence, now_seconds: nowSeconds });
      return Object.freeze({ state: nextState, evidence });
    },
    async appendEvent({ execution_id: executionId, state, evidence, now_seconds: nowSeconds }) {
      const eventId = `lee_${randomBytes(18).toString("base64url")}`;
      await db.prepare(`
        INSERT INTO ravenos_customer_live_execution_events
          (event_id, execution_id, state, evidence_json, observed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(eventId, executionId, clean(state, 40), JSON.stringify(evidence || {}), nowSeconds).run();
    },
  });
}
