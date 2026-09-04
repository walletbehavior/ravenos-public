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
  SolanaWalletEventKinds,
  buildSolanaWalletProfile,
  normalizeSolanaWalletAddress,
} from "./customer_trade/solana_wallet_intelligence.mjs";
import {
  SOURCE_WALLET_CHAIN_EVENT_SCHEMA,
} from "./customer_trade/robinhood_wallet_event_adapter.mjs";
import { buildRobinhoodWalletProfile } from "./customer_trade/robinhood_wallet_profile.mjs";
import {
  RobinhoodTraderIntelligenceLimits,
  buildRobinhoodClusteredActivity,
  buildRobinhoodLeadLagRelationships,
  buildRobinhoodTraderActivity,
  normalizeRobinhoodTraderIntelligenceQuery,
} from "./customer_trade/robinhood_trader_intelligence.mjs";
import {
  RAVEN_COPY_DECISION_SCHEMA,
  RAVEN_COPY_EXIT_DECISION_SCHEMA,
  RAVEN_COPY_POLICY_SCHEMA,
  RAVEN_COPY_POSITION_SCHEMA,
  applyShadowCopyExitHistory,
  buildCopyabilityBySize,
  buildCopyabilitySnapshot,
  createRavenCopyDecision,
  createRavenCopyExitDecision,
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
import { resolveSourceWalletRpcPollActivation } from "./customer_trade/source_wallet_rpc_poll_scheduler.mjs";
import {
  SourceWalletCopyabilityLimits,
  buildSourceWalletCopyabilityMatrix,
  createSourceWalletCopyabilityPolicyReference,
  resolveSourceWalletCopyabilityActivation,
} from "./customer_trade/source_wallet_copyability.mjs";
import {
  SourceWalletCopyabilityCheckpointLimits,
  resolveSourceWalletCopyabilityCheckpointActivation,
} from "./customer_trade/source_wallet_copyability_checkpoints.mjs";
import { SourceWalletCopyCrowdingLimits } from "./customer_trade/source_wallet_copy_crowding.mjs";
import {
  publicSourceWalletBackfillJob,
  resolveSourceWalletBackfillActivation,
} from "./customer_trade/source_wallet_backfill.mjs";
import { SourceWalletWatchManifestLimits } from "./customer_trade/source_wallet_watch_manifest.mjs";
import {
  createSourceWalletId,
  normalizeSourceWalletChainIdentity,
  normalizeSourceWalletTransactionReference,
} from "./customer_trade/source_wallet_chain_identity.mjs";
import {
  EvmWalletLookupChains,
  inspectEvmWallet,
  resolveEvmWalletLookupRuntime,
} from "./customer_trade/evm_wallet_lookup.mjs";
import {
  SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA,
  SourceWalletResearchCohortLimits,
  resolveSourceWalletResearchCohortActivation,
} from "./customer_trade/source_wallet_research_cohort.mjs";

export const CUSTOMER_WALLET_COPY_SCHEMA = "ravenos.customer_wallet_copy.v1";
export const CUSTOMER_WALLET_COPY_ROUTE = "/api/v1/wallet-copy";

export const CustomerWalletCopyLimits = Object.freeze({
  maximum_watches_per_account: 25,
  maximum_history_transactions_per_request: 24,
  maximum_profile_events_per_snapshot: 2_000,
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
  maximum_exit_decisions_per_response: 100,
  maximum_mapped_positions_per_watch: 2_000,
  maximum_exit_history_per_position_view: 2_000,
  maximum_activity_page_size: 20,
  free_screener_page_size: 12,
  free_screener_maximum_page: 10,
});

const FREE_SCREENER_SORTS = new Set(["last_trade_desc", "trade_count_desc", "active_days_desc"]);

const APP_ORIGIN = "https://app.ravenos.xyz";
const textEncoder = new TextEncoder();
const WALLET_ACTIVITY_FILTER_KINDS = Object.freeze({
  all: null,
  trades: Object.freeze(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP", "SPLIT_ROUTE_SWAP"]),
  buys: Object.freeze(["SWAP_BUY"]),
  sells: Object.freeze(["SWAP_SELL"]),
  transfers: Object.freeze(["TRANSFER_IN", "TRANSFER_OUT", "AIRDROP", "INTERNAL_ACCOUNT_MOVEMENT"]),
  unresolved: Object.freeze(["AMBIGUOUS", "UNSUPPORTED", "FAILED_TRANSACTION"]),
  other: Object.freeze(SolanaWalletEventKinds.filter((kind) => !new Set([
    "SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP", "SPLIT_ROUTE_SWAP",
    "TRANSFER_IN", "TRANSFER_OUT", "AIRDROP", "INTERNAL_ACCOUNT_MOVEMENT",
    "AMBIGUOUS", "UNSUPPORTED", "FAILED_TRANSACTION",
  ]).has(kind))),
});
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
  copyability_score_desc: "cp.reference_score IS NULL ASC, cp.reference_score DESC, cp.reference_sample_count DESC, c.source_wallet_id ASC",
  copyability_sample_desc: "cp.reference_sample_count IS NULL ASC, cp.reference_sample_count DESC, cp.policy_pass_pct DESC, c.source_wallet_id ASC",
  entry_executable_desc: "cp.entry_executable_pct IS NULL ASC, cp.entry_executable_pct DESC, cp.reference_sample_count DESC, c.source_wallet_id ASC",
  exit_executable_desc: "cp.exit_executable_pct IS NULL ASC, cp.exit_executable_pct DESC, cp.reference_sample_count DESC, c.source_wallet_id ASC",
  policy_pass_desc: "cp.policy_pass_pct IS NULL ASC, cp.policy_pass_pct DESC, cp.reference_sample_count DESC, c.source_wallet_id ASC",
  round_trip_friction_asc: "cp.median_round_trip_friction_pct IS NULL ASC, cp.median_round_trip_friction_pct ASC, cp.reference_sample_count DESC, c.source_wallet_id ASC",
  follower_route_persistence_desc: "cp.follower_route_persistence_pct IS NULL ASC, cp.follower_route_persistence_pct DESC, cp.outcome_checkpoint_count DESC, c.source_wallet_id ASC",
  follower_return_desc: "cp.median_follower_return_pct IS NULL ASC, cp.median_follower_return_pct DESC, cp.outcome_checkpoint_count DESC, c.source_wallet_id ASC",
  follower_capture_desc: "cp.follower_capture_ratio_pct IS NULL ASC, cp.follower_capture_ratio_pct DESC, cp.follower_capture_sample_count DESC, c.source_wallet_id ASC",
  detected_liquidity_desc: "cp.median_detected_liquidity_usd IS NULL ASC, cp.median_detected_liquidity_usd DESC, cp.detection_context_sample_count DESC, c.source_wallet_id ASC",
  detected_market_cap_asc: "cp.median_detected_market_cap_usd IS NULL ASC, cp.median_detected_market_cap_usd ASC, cp.detection_context_sample_count DESC, c.source_wallet_id ASC",
  detected_pair_age_asc: "cp.median_detected_pair_age_seconds IS NULL ASC, cp.median_detected_pair_age_seconds ASC, cp.detection_context_sample_count DESC, c.source_wallet_id ASC",
  source_liquidity_footprint_asc: "cp.median_source_trade_liquidity_pct IS NULL ASC, cp.median_source_trade_liquidity_pct ASC, cp.detection_context_sample_count DESC, c.source_wallet_id ASC",
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
  return createSourceWalletId({ chain: "solana", network: "mainnet", address });
}

function supportedSourceWalletEvent(event) {
  return event?.schema_version === SOLANA_WALLET_EVENT_SCHEMA
    || event?.schema_version === SOURCE_WALLET_CHAIN_EVENT_SCHEMA;
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

function activityCursor(orderTime, eventId) {
  const time = Number(orderTime);
  if (!Number.isSafeInteger(time) || time < 0 || !/^swe_[a-f0-9]{40}$/.test(String(eventId || ""))) {
    throw new CustomerWalletCopyError("wallet_activity_cursor_invalid");
  }
  return `${time}~${eventId}`;
}

function parseActivityCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/^(0|[1-9]\d{0,12})~(swe_[a-f0-9]{40})$/);
  if (!match) throw new CustomerWalletCopyError("wallet_activity_cursor_invalid");
  const orderTime = Number(match[1]);
  if (!Number.isSafeInteger(orderTime)) throw new CustomerWalletCopyError("wallet_activity_cursor_invalid");
  return Object.freeze({ order_time: orderTime, event_id: match[2] });
}

function normalizeWalletActivityQuery(searchParams) {
  const allowed = new Set(["filter", "limit", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) throw new CustomerWalletCopyError("wallet_activity_query_invalid");
  }
  const filter = clean(searchParams.get("filter") || "all", 24).toLowerCase();
  if (!Object.hasOwn(WALLET_ACTIVITY_FILTER_KINDS, filter)) throw new CustomerWalletCopyError("wallet_activity_filter_invalid");
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? 12 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CustomerWalletCopyLimits.maximum_activity_page_size) {
    throw new CustomerWalletCopyError("wallet_activity_limit_invalid");
  }
  return Object.freeze({
    filter,
    kinds: WALLET_ACTIVITY_FILTER_KINDS[filter],
    limit,
    cursor: parseActivityCursor(searchParams.get("cursor")),
  });
}

function publicActivityAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  return Object.freeze({
    asset_id: clean(asset.asset_id, 160) || null,
    mint: clean(asset.mint, 44) || null,
    contract: clean(asset.contract, 42) || null,
    standard: clean(asset.standard || asset.token_standard, 40) || null,
    symbol: clean(asset.symbol, 32) || null,
    direction: new Set(["in", "out"]).has(asset.direction) ? asset.direction : null,
    delta_raw: /^-?(?:0|[1-9]\d*)$/.test(String(asset.delta_raw ?? asset.delta_base_units ?? ""))
      ? String(asset.delta_raw ?? asset.delta_base_units)
      : null,
    canonical_usdc: asset.canonical_usdc === true,
    decimals: Number.isSafeInteger(Number(asset.decimals)) ? Number(asset.decimals) : null,
    amount_base_units: /^(0|[1-9]\d*)$/.test(String(asset.amount_base_units ?? "")) ? String(asset.amount_base_units) : null,
    balance_before_base_units: /^(0|[1-9]\d*)$/.test(String(asset.balance_before_base_units ?? "")) ? String(asset.balance_before_base_units) : null,
    balance_after_base_units: /^(0|[1-9]\d*)$/.test(String(asset.balance_after_base_units ?? "")) ? String(asset.balance_after_base_units) : null,
  });
}

function publicSourceWalletActivityEvent(event, expectedSourceId) {
  if (!supportedSourceWalletEvent(event)) throw new CustomerWalletCopyError("stored_wallet_activity_event_invalid");
  if (!/^swe_[a-f0-9]{40}$/.test(String(event.event_id || ""))) throw new CustomerWalletCopyError("stored_wallet_activity_event_invalid");
  let identity;
  try {
    identity = normalizeSourceWalletChainIdentity({
      chain: event.source_wallet?.chain,
      network: event.source_wallet?.network,
      ...(event.source_wallet?.chain === "robinhood" ? { chain_id: event.source_wallet?.chain_id } : {}),
      address: event.source_wallet?.address,
    });
  } catch {
    throw new CustomerWalletCopyError("stored_wallet_activity_event_invalid");
  }
  if (identity.source_wallet_id !== expectedSourceId || !SolanaWalletEventKinds.includes(event.classification?.kind)) {
    throw new CustomerWalletCopyError("stored_wallet_activity_event_invalid");
  }
  const solana = identity.chain === "solana";
  const transactionReference = clean(
    solana ? event.chain_evidence?.signature : event.chain_evidence?.transaction_reference,
    100,
  );
  if (transactionReference.length < 64) throw new CustomerWalletCopyError("stored_wallet_activity_event_invalid");
  const reasons = Array.isArray(event.classification?.reasons)
    ? event.classification.reasons.map((reason) => clean(reason, 100)).filter(Boolean).slice(0, 8)
    : [];
  const programs = Array.isArray(event.route_evidence?.program_ids)
    ? event.route_evidence.program_ids.map((program) => clean(program, 44)).filter(Boolean).slice(0, 32)
    : [];
  const providers = Array.isArray(event.chain_evidence?.providers)
    ? event.chain_evidence.providers.map((provider) => clean(provider, 80)).filter(Boolean).slice(0, 4)
    : [];
  const sourceAsset = solana ? event.economic?.source_asset : event.economic?.source_assets?.[0];
  const destinationAsset = solana ? event.economic?.destination_asset : event.economic?.destination_assets?.[0];
  return Object.freeze({
    schema_version: "ravenos.wallet_activity_event.v1",
    event_id: event.event_id,
    source_wallet: Object.freeze({
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      vm_family: identity.vm_family,
      address: identity.address,
    }),
    chain_evidence: Object.freeze({
      transaction_reference: transactionReference,
      signature: solana ? transactionReference : null,
      slot: solana && Number.isSafeInteger(Number(event.chain_evidence?.slot)) ? Number(event.chain_evidence.slot) : null,
      block_number: !solana && Number.isSafeInteger(Number(event.chain_evidence?.block_number)) ? Number(event.chain_evidence.block_number) : null,
      block_hash: !solana ? clean(event.chain_evidence?.block_hash, 66) || null : null,
      block_time: solana ? event.chain_evidence?.block_time || null : null,
      finality: event.chain_evidence?.finality || null,
      provider: solana ? event.chain_evidence?.provider || null : providers.join(" + ") || null,
      evidence_reference: event.chain_evidence?.evidence_reference
        || (solana ? `solana:signature:${transactionReference}` : `eip155:4663:tx:${transactionReference}`),
    }),
    timing: Object.freeze({
      observation_mode: event.timing?.observation_mode || (solana ? null : "prospective_chain_observation"),
      raven_received_at: event.timing?.raven_received_at || event.timing?.detected_at || null,
      detection_delay_ms: Number.isFinite(Number(event.timing?.detection_delay_ms)) ? Number(event.timing.detection_delay_ms) : null,
      decode_latency_ms: Number.isFinite(Number(event.timing?.decode_latency_ms)) ? Number(event.timing.decode_latency_ms) : null,
    }),
    classification: Object.freeze({
      kind: event.classification?.kind || "UNSUPPORTED",
      confidence: event.classification?.confidence || "insufficient",
      reasons,
      ambiguous: event.classification?.ambiguous === true,
    }),
    economic: Object.freeze({
      source_asset: publicActivityAsset(sourceAsset),
      destination_asset: publicActivityAsset(destinationAsset),
      transaction_fee_lamports: Number.isSafeInteger(Number(event.economic?.transaction_fee_lamports)) ? Number(event.economic.transaction_fee_lamports) : null,
      wallet_paid_transaction_fee: event.economic?.wallet_paid_transaction_fee === true,
      cost_basis_state: event.economic?.cost_basis_state || "unresolved_non_settlement_basis",
    }),
    route_evidence: Object.freeze({
      program_ids: programs,
      swap_invocations: Number.isSafeInteger(Number(event.route_evidence?.swap_invocations)) ? Number(event.route_evidence.swap_invocations) : null,
      swap_route_observed: event.route_evidence?.swap_route_observed === true,
      route_shape: event.route_evidence?.route_shape || "not_proven",
    }),
    copy_signal: Object.freeze({
      eligible_buy_signal: event.copy_signal?.eligible_buy_signal === true,
      eligible_sell_signal: event.copy_signal?.eligible_sell_signal === true,
      reason: event.copy_signal?.reason || "event_is_not_an_exact_copy_trade_signal",
    }),
    evidence_hash: event.evidence_hash || null,
    evidence_boundary: Object.freeze({
      reconstructed_or_observed: event.classification?.observed === true ? "observed" : "reconstructed",
      provider_payload_included: false,
      transaction_material_included: false,
      subscriber_identity_included: false,
      current_balance_claimed: false,
    }),
  });
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
  if (!row || !/^wrs_[A-Za-z0-9_-]{16,96}$/.test(String(row.save_id || "")) || !/^sw_(?:sol|rh)_[a-f0-9]{40}$/.test(String(row.source_wallet_id || ""))) {
    throw new CustomerWalletCopyError("stored_wallet_research_save_invalid");
  }
  let identity;
  try {
    identity = normalizeSourceWalletChainIdentity({
      chain: row.chain,
      network: row.network,
      ...(row.chain === "robinhood" ? { chain_id: Number(row.chain_id || 4663) } : {}),
      address: row.address,
    });
  } catch {
    throw new CustomerWalletCopyError("stored_wallet_research_save_invalid");
  }
  if (identity.source_wallet_id !== row.source_wallet_id) throw new CustomerWalletCopyError("stored_wallet_research_save_invalid");
  return Object.freeze({
    save_id: row.save_id,
    list_name: normalizeResearchListName(row.list_name),
    label: normalizeLabel(row.label, identity.address),
    source_wallet_id: row.source_wallet_id,
    source_wallet: {
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      vm_family: identity.vm_family,
      address: identity.address,
    },
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
  const rpcPoll = resolveSourceWalletRpcPollActivation(env);
  const copyability = resolveSourceWalletCopyabilityActivation(env);
  const copyabilityCheckpoints = resolveSourceWalletCopyabilityCheckpointActivation(env);
  const backfill = resolveSourceWalletBackfillActivation(env);
  const researchCohort = resolveSourceWalletResearchCohortActivation(env);
  const evmWalletLookup = Object.freeze(Object.fromEntries(EvmWalletLookupChains.map((chain) => {
    const runtime = resolveEvmWalletLookupRuntime(env, chain);
    return [chain, Object.freeze({ enabled: runtime.enabled, state: runtime.state, chain_id: runtime.profile?.chain_id || null })];
  })));
  return Object.freeze({
    wallet_intelligence: entitlements && intelligence && routes,
    wallet_screener: entitlements && intelligence && routes && flag(env.RAVENOS_WALLET_SCREENER_ENABLED),
    shadow_copy: entitlements && intelligence && routes && shadow,
    manual_terminal_copy: entitlements && intelligence && routes && shadow,
    live_copy: false,
    live_copy_requested: flag(env.RAVENOS_LIVE_COPY_ENABLED),
    fee_collection: false,
    fee_collection_requested: flag(env.RAVENOS_COPY_FEE_COLLECTION_ENABLED),
    continuous_observer: observer.evaluator && rpcPoll.active,
    observer_transport: rpcPoll.active ? "bounded_rpc_poll" : observer.ingest ? "private_ingress" : null,
    observer_interval_seconds: rpcPoll.active ? 300 : null,
    shared_copyability_probes: copyability.evaluator,
    shared_copyability_probes_requested: copyability.requested,
    follower_outcome_checkpoints: copyabilityCheckpoints.evaluator,
    follower_outcome_checkpoints_requested: copyabilityCheckpoints.requested,
    research_cohort: researchCohort.manifest,
    research_cohort_requested: researchCohort.requested,
    observer_ingest: observer.ingest,
    deep_history: backfill.evaluator,
    deep_history_requested: backfill.requested,
    scheduler: rpcPoll.active || observer.evaluator || copyabilityCheckpoints.evaluator || backfill.evaluator,
    monitoring_mode: rpcPoll.active ? "bounded_rpc_poll" : observer.evaluator ? "shared_observer" : "manual_refresh",
    evm_wallet_lookup: evmWalletLookup,
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
    async upsertSourceWallet({
      source_wallet_id: sourceId,
      chain = "solana",
      network = "mainnet",
      chain_id: chainId = null,
      address,
      now,
      state = "requested",
      provider_scope: providerScope = null,
    }) {
      let identity;
      try {
        identity = normalizeSourceWalletChainIdentity({
          chain,
          network,
          ...(String(chain).toLowerCase() === "robinhood" ? { chain_id: chainId ?? 4663 } : {}),
          address,
        });
      } catch {
        throw new CustomerWalletCopyError("wallet_source_identity_invalid");
      }
      if (identity.source_wallet_id !== sourceId) throw new CustomerWalletCopyError("wallet_source_identity_mismatch");
      const scope = clean(providerScope || (identity.chain === "robinhood" ? "bounded_robinhood_observer" : "bounded_solana_rpc"), 80);
      if (!scope) throw new CustomerWalletCopyError("wallet_source_provider_scope_invalid");
      await db.prepare(`
        INSERT INTO ravenos_source_wallets (
          source_wallet_id, chain, network, chain_id, vm_family, address,
          observation_state, provider_scope, first_requested_at,
          last_observed_at, last_transaction_reference, last_block_number,
          last_signature, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
        ON CONFLICT(chain, network, address) DO UPDATE SET
          observation_state = excluded.observation_state,
          provider_scope = excluded.provider_scope,
          updated_at = excluded.updated_at
      `).bind(
        sourceId,
        identity.chain,
        identity.network,
        String(identity.chain_id),
        identity.vm_family,
        identity.address,
        state,
        scope,
        now,
        now,
      ).run();
      return db.prepare("SELECT * FROM ravenos_source_wallets WHERE source_wallet_id = ?").bind(sourceId).first();
    },
    async admitSourceWalletResearchCohort(admission, now) {
      if (admission?.schema_version !== SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA) {
        throw new CustomerWalletCopyError("wallet_research_cohort_admission_invalid");
      }
      const qualifiedAt = epoch(admission.qualified_at);
      if (qualifiedAt === null || !Number.isSafeInteger(Number(now)) || Number(now) < qualifiedAt) {
        throw new CustomerWalletCopyError("wallet_research_cohort_admission_invalid");
      }
      await db.prepare(`
        INSERT INTO ravenos_source_wallet_research_cohort (
          source_wallet_id, schema_version, admission_id, candidate_id, state,
          admission_basis, evidence_tier, priority_score,
          qualified_observation_count, distinct_mint_count, admission_json,
          first_qualified_at, last_qualified_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_wallet_id) DO UPDATE SET
          admission_id = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.admission_id ELSE admission_id END,
          candidate_id = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.candidate_id ELSE candidate_id END,
          state = 'active',
          admission_basis = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.admission_basis ELSE admission_basis END,
          evidence_tier = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.evidence_tier ELSE evidence_tier END,
          priority_score = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.priority_score ELSE priority_score END,
          qualified_observation_count = MAX(qualified_observation_count, excluded.qualified_observation_count),
          distinct_mint_count = MAX(distinct_mint_count, excluded.distinct_mint_count),
          admission_json = CASE WHEN excluded.last_qualified_at >= last_qualified_at THEN excluded.admission_json ELSE admission_json END,
          last_qualified_at = MAX(last_qualified_at, excluded.last_qualified_at),
          updated_at = MAX(updated_at, excluded.updated_at)
      `).bind(
        admission.source_wallet_id,
        admission.schema_version,
        admission.admission_id,
        admission.candidate_id,
        admission.admission_basis,
        admission.evidence_tier,
        admission.priority_score,
        admission.qualified_observation_count,
        admission.distinct_mint_count,
        JSON.stringify(admission),
        qualifiedAt,
        qualifiedAt,
        Number(now),
      ).run();
      return db.prepare(`
        SELECT source_wallet_id, state, evidence_tier, priority_score,
          qualified_observation_count, distinct_mint_count
        FROM ravenos_source_wallet_research_cohort
        WHERE source_wallet_id = ? LIMIT 1
      `).bind(admission.source_wallet_id).first();
    },
    async updateSourceCursor(sourceId, {
      state,
      last_observed_at: observedAt,
      last_signature: signature,
      last_transaction_reference: transactionReference = signature,
      last_block_number: blockNumber = null,
      now,
    }) {
      await db.prepare(`
        UPDATE ravenos_source_wallets SET
          observation_state = ?, last_observed_at = ?,
          last_transaction_reference = ?, last_block_number = ?,
          last_signature = CASE WHEN chain = 'solana' THEN ? ELSE NULL END,
          updated_at = ?
        WHERE source_wallet_id = ?
      `).bind(state, observedAt, transactionReference || null, blockNumber, signature || null, now, sourceId).run();
    },
    async recordEvents(sourceId, events, now) {
      const inserted = [];
      const eventParts = (event) => {
        if (!supportedSourceWalletEvent(event) || event.source_wallet_id !== sourceId) {
          throw new CustomerWalletCopyError("wallet_source_event_invalid");
        }
        const solana = event.schema_version === SOLANA_WALLET_EVENT_SCHEMA;
        const transactionReference = solana
          ? event.chain_evidence?.signature
          : event.chain_evidence?.transaction_reference;
        const providers = solana
          ? [event.chain_evidence?.provider]
          : event.chain_evidence?.providers;
        const provider = (Array.isArray(providers) ? providers : [])
          .map((value) => clean(value, 80))
          .filter(Boolean)
          .sort()
          .join("+")
          .slice(0, 80);
        if (!provider || !transactionReference) throw new CustomerWalletCopyError("wallet_source_event_invalid");
        return {
          solana,
          transactionReference,
          provider,
          eventTime: solana ? epoch(event.chain_evidence?.block_time) : null,
        };
      };
      const eventStatement = (event) => {
        const parts = eventParts(event);
        return db.prepare(`
          INSERT OR IGNORE INTO ravenos_source_wallet_events (
            event_id, schema_version, source_wallet_id, chain, network,
            transaction_reference, signature, slot, block_time,
            block_number, block_hash, chain_event_time, finality, classification,
            decode_version, evidence_hash, event_json, observed_at, retention_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          event.event_id,
          event.schema_version,
          sourceId,
          event.source_wallet.chain,
          event.source_wallet.network,
          parts.transactionReference,
          parts.solana ? event.chain_evidence.signature : null,
          parts.solana ? event.chain_evidence.slot : null,
          parts.solana ? parts.eventTime : null,
          parts.solana ? null : event.chain_evidence.block_number,
          parts.solana ? null : event.chain_evidence.block_hash,
          parts.eventTime,
          event.chain_evidence.finality,
          event.classification.kind,
          event.decode_version || 1,
          event.evidence_hash,
          JSON.stringify(event),
          now,
          now + CustomerWalletCopyLimits.public_event_retention_seconds,
        );
      };
      const finalityStatement = (event) => {
        const parts = eventParts(event);
        return db.prepare(`
          INSERT OR IGNORE INTO ravenos_source_wallet_event_finality_observations (
            finality_observation_id, event_id, finality, provider, observed_at
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(
          `swf_${digest([event.event_id, event.chain_evidence.finality, parts.provider])}`,
          event.event_id,
          event.chain_evidence.finality,
          parts.provider,
          now,
        );
      };
      if (typeof db.batch === "function" && events.length > 1) {
        for (let offset = 0; offset < events.length; offset += 40) {
          const rows = events.slice(offset, offset + 40);
          const statements = rows.flatMap((event) => [eventStatement(event), finalityStatement(event)]);
          const results = await db.batch(statements);
          rows.forEach((event, index) => {
            if (Number(results?.[index * 2]?.meta?.changes || 0) > 0) inserted.push(event.event_id);
          });
        }
        return inserted;
      }
      for (const event of events) {
        const result = await eventStatement(event).run();
        await finalityStatement(event).run();
        if (Number(result?.meta?.changes || 0) > 0) inserted.push(event.event_id);
      }
      return inserted;
    },
    async listSourceEvents(sourceId, limit = 500) {
      const bounded = Math.max(1, Math.min(2_000, Number(limit) || 500));
      const result = await db.prepare(`
        SELECT event_json FROM ravenos_source_wallet_events
        WHERE source_wallet_id = ?
        ORDER BY COALESCE(block_time, chain_event_time, observed_at) DESC, event_id DESC LIMIT ?
      `).bind(sourceId, bounded).all();
      return (result?.results || []).map((row) => parseJson(row.event_json)).filter(supportedSourceWalletEvent);
    },
    async recordSourceCopyabilityObservation(observation, now) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_copyability_observations (
          observation_id, source_wallet_id, source_event_id,
          standard_order_size_usdc, hypothetical_raven_fee_bps,
          policy_version, policy_hash, decision_state, reason_code,
          observation_json, observed_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        observation.observation_id,
        observation.source_wallet_id,
        observation.source_event_id,
        observation.standard_order_size_usdc,
        observation.hypothetical_raven_fee_bps,
        observation.policy_version,
        observation.policy_hash,
        observation.evaluation.decision.state,
        observation.evaluation.decision.reason_code,
        JSON.stringify(observation),
        now,
        now + SourceWalletCopyabilityLimits.observation_retention_seconds,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async listSourceCopyabilityObservationsForEvent(sourceId, sourceEventId) {
      const result = await db.prepare(`
        SELECT observation_json
        FROM ravenos_source_wallet_copyability_observations
        WHERE source_wallet_id = ? AND source_event_id = ?
        ORDER BY standard_order_size_usdc ASC, hypothetical_raven_fee_bps ASC, observation_id ASC
      `).bind(sourceId, sourceEventId).all();
      return (result?.results || []).map((row) => parseJson(row.observation_json)).filter(Boolean);
    },
    async listSourceCopyabilityObservations(sourceId, limit = SourceWalletCopyabilityLimits.maximum_observations_per_source_profile) {
      const bounded = Math.max(1, Math.min(SourceWalletCopyabilityLimits.maximum_observations_per_source_profile, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT observation_json
        FROM ravenos_source_wallet_copyability_observations
        WHERE source_wallet_id = ?
        ORDER BY observed_at DESC, source_event_id DESC, standard_order_size_usdc ASC, observation_id ASC
        LIMIT ?
      `).bind(sourceId, bounded).all();
      return (result?.results || []).map((row) => parseJson(row.observation_json)).filter(Boolean);
    },
    async listSourceCopyabilityCheckpoints(sourceId, limit = SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints) {
      const bounded = Math.max(1, Math.min(SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT checkpoint_json
        FROM ravenos_source_wallet_copyability_checkpoints
        WHERE source_wallet_id = ?
        ORDER BY evaluated_at DESC, horizon_seconds ASC,
          standard_order_size_usdc ASC, checkpoint_id ASC
        LIMIT ?
      `).bind(sourceId, bounded).all();
      return (result?.results || []).map((row) => parseJson(row.checkpoint_json)).filter(Boolean);
    },
    async listSourceCopyCrowdingObservations(sourceId, limit = SourceWalletCopyCrowdingLimits.maximum_public_observations) {
      const bounded = Math.max(1, Math.min(SourceWalletCopyCrowdingLimits.maximum_public_observations, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT observation_json
        FROM ravenos_source_wallet_copy_crowding_observations
        WHERE source_wallet_id = ?
        ORDER BY observed_at DESC, observation_id DESC
        LIMIT ?
      `).bind(sourceId, bounded).all();
      return (result?.results || []).map((row) => parseJson(row.observation_json)).filter(Boolean);
    },
    async refreshSourceCopyabilityProjection(sourceId, { fee_bps: feeBps, policy_reference: suppliedReference, now } = {}) {
      const reference = createSourceWalletCopyabilityPolicyReference({ fee_bps: feeBps });
      if (
        suppliedReference?.matrix_policy_hash !== reference.matrix_policy_hash
        || JSON.stringify(suppliedReference.policy_hashes) !== JSON.stringify(reference.policy_hashes)
      ) throw new CustomerWalletCopyError("wallet_copyability_policy_reference_invalid");
      const seconds = Number(now);
      if (!Number.isSafeInteger(seconds) || seconds < 0) throw new CustomerWalletCopyError("wallet_copyability_projection_time_invalid");
      const placeholders = reference.policy_hashes.map(() => "?").join(", ");
      const result = await db.prepare(`
        SELECT observation_json
        FROM ravenos_source_wallet_copyability_observations
        WHERE source_wallet_id = ? AND hypothetical_raven_fee_bps = ?
          AND policy_hash IN (${placeholders})
        ORDER BY observed_at DESC, source_event_id DESC,
          standard_order_size_usdc ASC, observation_id ASC
        LIMIT ?
      `).bind(
        sourceId,
        reference.hypothetical_raven_fee_bps,
        ...reference.policy_hashes,
        SourceWalletCopyabilityLimits.maximum_observations_per_source_profile,
      ).all();
      const observations = (result?.results || []).map((row) => parseJson(row.observation_json)).filter(Boolean);
      const checkpointResult = await db.prepare(`
        SELECT c.checkpoint_json
        FROM ravenos_source_wallet_copyability_checkpoints c
        JOIN ravenos_source_wallet_copyability_observations o
          ON o.observation_id = c.observation_id
        WHERE c.source_wallet_id = ? AND c.hypothetical_raven_fee_bps = ?
          AND o.policy_hash IN (${placeholders})
        ORDER BY c.evaluated_at DESC, c.horizon_seconds ASC,
          c.standard_order_size_usdc ASC, c.checkpoint_id ASC
        LIMIT ?
      `).bind(
        sourceId,
        reference.hypothetical_raven_fee_bps,
        ...reference.policy_hashes,
        SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints,
      ).all();
      const outcomeCheckpoints = (checkpointResult?.results || []).map((row) => parseJson(row.checkpoint_json)).filter(Boolean);
      const crowdingResult = await db.prepare(`
        SELECT observation_json
        FROM ravenos_source_wallet_copy_crowding_observations
        WHERE source_wallet_id = ? AND hypothetical_raven_fee_bps = ?
        ORDER BY observed_at DESC, observation_id DESC
        LIMIT ?
      `).bind(
        sourceId,
        reference.hypothetical_raven_fee_bps,
        SourceWalletCopyCrowdingLimits.maximum_public_observations,
      ).all();
      const crowdingObservations = (crowdingResult?.results || []).map((row) => parseJson(row.observation_json)).filter(Boolean);
      const matrix = buildSourceWalletCopyabilityMatrix(observations, {
        generated_at: new Date(seconds * 1_000).toISOString(),
        reference_fee_bps: reference.hypothetical_raven_fee_bps,
        outcome_checkpoints: outcomeCheckpoints,
        crowding_observations: crowdingObservations,
      });
      if (matrix.reference_matrix_policy_hash !== reference.matrix_policy_hash) {
        throw new CustomerWalletCopyError("wallet_copyability_projection_reference_mismatch");
      }
      const snapshot = matrix.snapshot;
      const components = snapshot?.components || {};
      const marketContext = matrix.detection_market_context || {};
      const outcomeReference = matrix.prospective_outcomes?.reference || {};
      await db.prepare(`
        INSERT INTO ravenos_source_wallet_copyability_current (
          source_wallet_id, hypothetical_raven_fee_bps, matrix_policy_hash,
          policy_version, reference_order_size_usdc, state,
          prospective_signal_count, probe_observation_count,
          reference_sample_count, reference_score, reference_confidence,
          entry_executable_pct, exit_executable_pct, policy_pass_pct,
          median_entry_degradation_bps, median_round_trip_friction_pct,
          detection_context_sample_count, detection_context_coverage_pct,
          detected_market_cap_coverage_pct, detected_liquidity_coverage_pct,
          detected_pair_age_coverage_pct, median_detected_market_cap_usd,
          median_detected_liquidity_usd, median_detected_pair_age_seconds,
          median_source_trade_liquidity_pct, median_market_context_delay_ms,
          outcome_checkpoint_count, outcome_reference_horizon_seconds,
          follower_route_persistence_pct, median_follower_return_pct,
          follower_win_rate_pct, follower_capture_sample_count,
          follower_capture_ratio_pct, follower_minus_source_return_pct,
          matrix_json, last_observed_at, updated_at
        ) VALUES (?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_wallet_id, hypothetical_raven_fee_bps, matrix_policy_hash) DO UPDATE SET
          policy_version = excluded.policy_version,
          state = excluded.state,
          prospective_signal_count = excluded.prospective_signal_count,
          probe_observation_count = excluded.probe_observation_count,
          reference_sample_count = excluded.reference_sample_count,
          reference_score = excluded.reference_score,
          reference_confidence = excluded.reference_confidence,
          entry_executable_pct = excluded.entry_executable_pct,
          exit_executable_pct = excluded.exit_executable_pct,
          policy_pass_pct = excluded.policy_pass_pct,
          median_entry_degradation_bps = excluded.median_entry_degradation_bps,
          median_round_trip_friction_pct = excluded.median_round_trip_friction_pct,
          detection_context_sample_count = excluded.detection_context_sample_count,
          detection_context_coverage_pct = excluded.detection_context_coverage_pct,
          detected_market_cap_coverage_pct = excluded.detected_market_cap_coverage_pct,
          detected_liquidity_coverage_pct = excluded.detected_liquidity_coverage_pct,
          detected_pair_age_coverage_pct = excluded.detected_pair_age_coverage_pct,
          median_detected_market_cap_usd = excluded.median_detected_market_cap_usd,
          median_detected_liquidity_usd = excluded.median_detected_liquidity_usd,
          median_detected_pair_age_seconds = excluded.median_detected_pair_age_seconds,
          median_source_trade_liquidity_pct = excluded.median_source_trade_liquidity_pct,
          median_market_context_delay_ms = excluded.median_market_context_delay_ms,
          outcome_checkpoint_count = excluded.outcome_checkpoint_count,
          outcome_reference_horizon_seconds = excluded.outcome_reference_horizon_seconds,
          follower_route_persistence_pct = excluded.follower_route_persistence_pct,
          median_follower_return_pct = excluded.median_follower_return_pct,
          follower_win_rate_pct = excluded.follower_win_rate_pct,
          follower_capture_sample_count = excluded.follower_capture_sample_count,
          follower_capture_ratio_pct = excluded.follower_capture_ratio_pct,
          follower_minus_source_return_pct = excluded.follower_minus_source_return_pct,
          matrix_json = excluded.matrix_json,
          last_observed_at = excluded.last_observed_at,
          updated_at = excluded.updated_at
      `).bind(
        sourceId,
        reference.hypothetical_raven_fee_bps,
        reference.matrix_policy_hash,
        reference.policy_version,
        matrix.state,
        matrix.prospective_signal_count,
        matrix.probe_observation_count,
        snapshot?.prospective_sample_count || 0,
        snapshot?.score ?? null,
        snapshot?.confidence || "insufficient",
        components.entry_executable_pct ?? null,
        components.exit_executable_pct ?? null,
        components.policy_pass_pct ?? null,
        components.median_entry_degradation_bps ?? null,
        components.median_round_trip_friction_pct ?? null,
        marketContext.context_observation_count ?? 0,
        marketContext.context_coverage_pct ?? null,
        marketContext.market_cap_coverage_pct ?? null,
        marketContext.liquidity_coverage_pct ?? null,
        marketContext.pair_age_coverage_pct ?? null,
        marketContext.median_detected_market_cap_usd ?? null,
        marketContext.median_detected_liquidity_usd ?? null,
        marketContext.median_detected_pair_age_seconds ?? null,
        marketContext.median_source_trade_liquidity_pct ?? null,
        marketContext.median_observation_delay_ms ?? null,
        outcomeReference.checkpoint_count ?? 0,
        matrix.prospective_outcomes?.reference_horizon_seconds || 3_600,
        outcomeReference.route_persistence_pct ?? null,
        outcomeReference.median_follower_return_pct ?? null,
        outcomeReference.follower_win_rate_pct ?? null,
        outcomeReference.follower_capture_sample_count ?? 0,
        outcomeReference.median_follower_capture_ratio_pct ?? null,
        outcomeReference.median_follower_minus_source_return_pct ?? null,
        JSON.stringify(matrix),
        epoch(matrix.last_observed_at),
        seconds,
      ).run();
      return matrix;
    },
    async listSourceEventPage(sourceId, { kinds = null, limit = 12, cursor = null } = {}) {
      const bounded = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_activity_page_size, Number(limit) || 12));
      const conditions = ["source_wallet_id = ?"];
      const bindings = [sourceId];
      if (Array.isArray(kinds) && kinds.length) {
        conditions.push(`classification IN (${kinds.map(() => "?").join(", ")})`);
        bindings.push(...kinds);
      }
      if (cursor) {
        conditions.push("(COALESCE(block_time, chain_event_time, observed_at) < ? OR (COALESCE(block_time, chain_event_time, observed_at) = ? AND event_id < ?))");
        bindings.push(cursor.order_time, cursor.order_time, cursor.event_id);
      }
      const where = conditions.join(" AND ");
      const result = await db.prepare(`
        SELECT event_id, event_json, COALESCE(block_time, chain_event_time, observed_at) AS order_time
        FROM ravenos_source_wallet_events
        WHERE ${where}
        ORDER BY COALESCE(block_time, chain_event_time, observed_at) DESC, event_id DESC LIMIT ?
      `).bind(...bindings, bounded + 1).all();
      const rows = result?.results || [];
      const visible = rows.slice(0, bounded);
      const countConditions = ["source_wallet_id = ?"];
      const countBindings = [sourceId];
      if (Array.isArray(kinds) && kinds.length) {
        countConditions.push(`classification IN (${kinds.map(() => "?").join(", ")})`);
        countBindings.push(...kinds);
      }
      const count = await db.prepare(`
        SELECT COUNT(*) AS total FROM ravenos_source_wallet_events
        WHERE ${countConditions.join(" AND ")}
      `).bind(...countBindings).first();
      const last = visible.at(-1);
      return Object.freeze({
        events: visible.map((row) => parseJson(row.event_json)).filter(supportedSourceWalletEvent),
        matching_event_count: Math.max(0, Number(count?.total || 0)),
        has_more: rows.length > bounded,
        next_cursor: rows.length > bounded && last ? activityCursor(last.order_time, last.event_id) : null,
      });
    },
    async listRobinhoodTraderActivity({ since_at: sinceAt, limit = 500 } = {}) {
      const since = epoch(sinceAt);
      if (since === null) throw new CustomerWalletCopyError("robinhood_trader_since_invalid");
      const bounded = Math.max(1, Math.min(
        RobinhoodTraderIntelligenceLimits.maximum_source_events,
        Number(limit) || 500,
      ));
      const result = await db.prepare(`
        SELECT e.event_json, c.reconstruction_confidence_pct AS profile_reconstruction_confidence_pct
        FROM ravenos_source_wallet_events e
        JOIN ravenos_source_wallets s ON s.source_wallet_id = e.source_wallet_id
        LEFT JOIN ravenos_source_wallet_current_profiles c ON c.source_wallet_id = e.source_wallet_id
        WHERE e.chain = 'robinhood'
          AND e.network = 'mainnet'
          AND s.chain = 'robinhood'
          AND s.network = 'mainnet'
          AND e.classification IN ('SWAP_BUY', 'SWAP_SELL', 'MULTIHOP_SWAP')
          AND COALESCE(e.chain_event_time, e.observed_at) >= ?
        ORDER BY COALESCE(e.chain_event_time, e.observed_at) DESC, e.event_id DESC
        LIMIT ?
      `).bind(since, bounded).all();
      return (result?.results || []).map((row) => ({
        event: parseJson(row.event_json),
        profile_reconstruction_confidence_pct: row.profile_reconstruction_confidence_pct,
      }));
    },
    async recordProfile(sourceId, profile, now) {
      const profileId = profileSnapshotId(sourceId, profile);
      const profileHash = digest([JSON.stringify(profile)]);
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_profiles (
          profile_snapshot_id, schema_version, source_wallet_id, profile_version, history_start_at, history_end_at,
          normalized_event_count, profile_json, generated_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        profileId,
        profile.schema_version,
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
    async listObserverWatchUniverse(limit = SourceWalletWatchManifestLimits.maximum_wallets, {
      include_research_cohort: includeResearchCohort = false,
      maximum_research_wallets: maximumResearchWallets = SourceWalletResearchCohortLimits.maximum_research_wallets,
    } = {}) {
      const bounded = Math.max(1, Math.min(SourceWalletWatchManifestLimits.maximum_wallets, Number(limit) || 1));
      const protectedResult = await db.prepare(`
        SELECT s.address
        FROM ravenos_source_wallets s
        WHERE s.chain = 'solana' AND s.network = 'mainnet' AND (
          EXISTS (
          SELECT 1 FROM ravenos_customer_wallet_copy_watches w
          WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
        ) OR EXISTS (
          SELECT 1 FROM ravenos_customer_wallet_research_saves r
          WHERE r.source_wallet_id = s.source_wallet_id
        ))
        ORDER BY
          CASE WHEN EXISTS (
            SELECT 1 FROM ravenos_customer_wallet_copy_watches w
            WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
          ) THEN 0 ELSE 1 END ASC,
          COALESCE(s.last_observed_at, 0) DESC,
          s.source_wallet_id ASC
        LIMIT ?
      `).bind(bounded + 1).all();
      const protectedRows = protectedResult?.results || [];
      if (protectedRows.length > bounded) throw new CustomerWalletCopyError("wallet_observer_universe_too_large");
      if (!includeResearchCohort || protectedRows.length >= bounded) return protectedRows.map((row) => row.address);
      const remaining = bounded - protectedRows.length;
      const researchLimit = Math.max(0, Math.min(
        SourceWalletResearchCohortLimits.maximum_research_wallets,
        Number(maximumResearchWallets) || 0,
        remaining,
      ));
      if (!researchLimit) return protectedRows.map((row) => row.address);
      const researchResult = await db.prepare(`
        SELECT s.address
        FROM ravenos_source_wallet_research_cohort c
        JOIN ravenos_source_wallets s ON s.source_wallet_id = c.source_wallet_id
        WHERE c.state = 'active'
          AND s.chain = 'solana' AND s.network = 'mainnet'
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_customer_wallet_copy_watches w
            WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_customer_wallet_research_saves r
            WHERE r.source_wallet_id = s.source_wallet_id
          )
        ORDER BY c.priority_score DESC, c.last_qualified_at DESC, c.source_wallet_id ASC
        LIMIT ?
      `).bind(researchLimit).all();
      return protectedRows.concat(researchResult?.results || []).map((row) => row.address);
    },
    async listObserverPollingUniverse(limit = 50) {
      const bounded = Math.max(1, Math.min(250, Number(limit) || 1));
      const result = await db.prepare(`
        SELECT s.address, s.last_signature AS cursor_signature,
          (
            SELECT e.slot
            FROM ravenos_source_wallet_events e
            WHERE e.source_wallet_id = s.source_wallet_id
              AND e.signature = s.last_signature
            ORDER BY e.observed_at DESC, e.event_id DESC
            LIMIT 1
          ) AS cursor_slot
        FROM ravenos_source_wallets s
        WHERE s.chain = 'solana' AND s.network = 'mainnet'
          AND EXISTS (
            SELECT 1 FROM ravenos_customer_wallet_copy_watches w
            WHERE w.source_wallet_id = s.source_wallet_id AND w.state = 'active'
          )
        ORDER BY COALESCE(s.last_observed_at, 0) DESC, s.source_wallet_id ASC
        LIMIT ?
      `).bind(bounded).all();
      return (result?.results || []).map((row) => ({
        address: row.address,
        cursor: row.cursor_signature && Number.isSafeInteger(Number(row.cursor_slot))
          ? { signature: row.cursor_signature, slot: Number(row.cursor_slot) }
          : null,
      }));
    },
    async screenSourceWallets(query) {
      const copyabilityReference = query.follower_reality_reference || createSourceWalletCopyabilityPolicyReference({ fee_bps: 10 });
      const conditions = ["s.network = ?"];
      const bindings = [query.network];
      if (query.chain !== "all") {
        conditions.unshift("s.chain = ?");
        bindings.unshift(query.chain);
      } else {
        conditions.unshift("s.chain IN ('solana', 'robinhood')");
      }
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
        LEFT JOIN ravenos_source_wallet_copyability_current cp
          ON cp.source_wallet_id = c.source_wallet_id
          AND cp.hypothetical_raven_fee_bps = ?
          AND cp.matrix_policy_hash = ?
        WHERE ${conditions.join(" AND ")}
      `;
      const scopedBindings = [
        copyabilityReference.hypothetical_raven_fee_bps,
        copyabilityReference.matrix_policy_hash,
        ...bindings,
      ];
      const totalRow = await db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...scopedBindings).first();
      const orderBy = WALLET_SCREENER_SORT_SQL[query.sort];
      if (!orderBy) throw new CustomerWalletCopyError("wallet_screener_sort_invalid");
      const result = await db.prepare(`
        SELECT s.chain, s.network, s.chain_id, s.vm_family, s.address, c.*,
          cp.state AS copyability_state,
          cp.reference_score AS copyability_score,
          cp.reference_sample_count AS copyability_sample_count,
          cp.prospective_signal_count AS prospective_signal_count,
          cp.entry_executable_pct AS entry_executable_pct,
          cp.exit_executable_pct AS exit_executable_pct,
          cp.policy_pass_pct AS policy_pass_pct,
          cp.median_entry_degradation_bps AS median_entry_degradation_bps,
          cp.median_round_trip_friction_pct AS median_round_trip_friction_pct,
          cp.outcome_checkpoint_count AS outcome_checkpoint_count,
          cp.outcome_reference_horizon_seconds AS outcome_reference_horizon_seconds,
          cp.follower_route_persistence_pct AS follower_route_persistence_pct,
          cp.median_follower_return_pct AS median_follower_return_pct,
          cp.follower_win_rate_pct AS follower_win_rate_pct,
          cp.follower_capture_sample_count AS follower_capture_sample_count,
          cp.follower_capture_ratio_pct AS follower_capture_ratio_pct,
          cp.follower_minus_source_return_pct AS follower_minus_source_return_pct,
          cp.detection_context_sample_count AS detection_context_sample_count,
          cp.detection_context_coverage_pct AS detection_context_coverage_pct,
          cp.detected_market_cap_coverage_pct AS detected_market_cap_coverage_pct,
          cp.detected_liquidity_coverage_pct AS detected_liquidity_coverage_pct,
          cp.detected_pair_age_coverage_pct AS detected_pair_age_coverage_pct,
          cp.median_detected_market_cap_usd AS median_detected_market_cap_usd,
          cp.median_detected_liquidity_usd AS median_detected_liquidity_usd,
          cp.median_detected_pair_age_seconds AS median_detected_pair_age_seconds,
          cp.median_source_trade_liquidity_pct AS median_source_trade_liquidity_pct,
          cp.median_market_context_delay_ms AS median_market_context_delay_ms,
          cp.hypothetical_raven_fee_bps AS copyability_fee_bps,
          cp.last_observed_at AS copyability_last_observed_at
        ${from}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).bind(...scopedBindings, query.page_size, query.offset).all();
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
        SELECT r.*, s.chain, s.network, s.chain_id, s.vm_family, s.address
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
        SELECT r.*, s.chain, s.network, s.chain_id, s.vm_family, s.address
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
    async listActiveWatchesForExitSource(sourceId, event, limit = CustomerWalletCopyLimits.maximum_observer_policies_per_job) {
      if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA || !event.copy_signal?.eligible_sell_signal) {
        throw new CustomerWalletCopyError("wallet_source_exit_event_invalid");
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
            SELECT 1 FROM ravenos_customer_shadow_copy_exit_decisions d
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
    async countPendingExitWatchesForSource(sourceId, event) {
      if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA || !event.copy_signal?.eligible_sell_signal) {
        throw new CustomerWalletCopyError("wallet_source_exit_event_invalid");
      }
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
            SELECT 1 FROM ravenos_customer_shadow_copy_exit_decisions d
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
    async listMappedPositionsForWatch(userId, watchIdentifier, assetMint) {
      const positionsResult = await db.prepare(`
        SELECT position_json FROM ravenos_customer_shadow_copy_positions
        WHERE user_id = ? AND watch_id = ? AND asset_mint = ?
        ORDER BY opened_at ASC, position_id ASC LIMIT ?
      `).bind(userId, watchIdentifier, assetMint, CustomerWalletCopyLimits.maximum_mapped_positions_per_watch + 1).all();
      const positionRows = positionsResult?.results || [];
      if (positionRows.length > CustomerWalletCopyLimits.maximum_mapped_positions_per_watch) {
        throw new CustomerWalletCopyError("shadow_copy_position_history_limit_exceeded");
      }
      const positions = positionRows
        .map((row) => parseJson(row.position_json))
        .filter((row) => row?.schema_version === RAVEN_COPY_POSITION_SCHEMA);
      if (!positions.length) return [];
      const exitsResult = await db.prepare(`
        SELECT DISTINCT d.exit_json, d.decided_at, d.exit_decision_id
        FROM ravenos_customer_shadow_copy_exit_decisions d
        JOIN ravenos_customer_shadow_copy_exit_allocations a ON a.exit_decision_id = d.exit_decision_id
        JOIN ravenos_customer_shadow_copy_positions p ON p.position_id = a.position_id
        WHERE d.user_id = ? AND d.watch_id = ? AND p.asset_mint = ?
        ORDER BY d.decided_at ASC, d.exit_decision_id ASC LIMIT ?
      `).bind(userId, watchIdentifier, assetMint, CustomerWalletCopyLimits.maximum_exit_history_per_position_view + 1).all();
      const exitRows = exitsResult?.results || [];
      if (exitRows.length > CustomerWalletCopyLimits.maximum_exit_history_per_position_view) {
        throw new CustomerWalletCopyError("shadow_copy_exit_history_limit_exceeded");
      }
      const exits = exitRows
        .map((row) => parseJson(row.exit_json))
        .filter((row) => row?.schema_version === RAVEN_COPY_EXIT_DECISION_SCHEMA);
      return positions.map((position) => applyShadowCopyExitHistory(position, exits))
        .filter((position) => position.state !== "SHADOW_CLOSED");
    },
    async recordExitDecision(userId, decision, now) {
      if (decision?.schema_version !== RAVEN_COPY_EXIT_DECISION_SCHEMA) throw new CustomerWalletCopyError("shadow_copy_exit_decision_invalid");
      if (typeof db.batch !== "function") throw new CustomerWalletCopyError("shadow_copy_exit_atomic_store_unavailable");
      const statements = [db.prepare(`
        INSERT OR IGNORE INTO ravenos_customer_shadow_copy_exit_decisions (
          exit_decision_id, user_id, watch_id, source_event_id, asset_mint,
          decision_state, reason_code, policy_version, policy_hash,
          source_event_at, decided_at, exit_json, live_execution_authorized,
          fee_collection_authorized, transaction_hash, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
      `).bind(
        decision.exit_decision_id,
        userId,
        decision.watch_id,
        decision.source_event_id,
        decision.asset.mint,
        decision.decision.state,
        decision.decision.reason_code,
        decision.policy.policy_version,
        decision.policy.policy_hash,
        epoch(decision.timing.source_chain_event_at),
        now,
        JSON.stringify(decision),
        now + CustomerWalletCopyLimits.customer_decision_retention_seconds,
      )];
      for (const allocation of decision.position_allocations || []) {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO ravenos_customer_shadow_copy_exit_allocations (
            allocation_id, exit_decision_id, position_id, quantity_base_units,
            applied, allocation_json, live_assets_held, transaction_hash, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
        `).bind(
          allocation.allocation_id,
          decision.exit_decision_id,
          allocation.position_id,
          allocation.quantity_base_units,
          allocation.applied ? 1 : 0,
          JSON.stringify(allocation),
          now,
        ));
      }
      const results = await db.batch(statements);
      return Number(results?.[0]?.meta?.changes || 0) > 0;
    },
    async listDecisions(userId, limit = CustomerWalletCopyLimits.maximum_decisions_per_response) {
      const result = await db.prepare(`
        SELECT decision_json FROM ravenos_customer_shadow_copy_decisions
        WHERE user_id = ? ORDER BY decided_at DESC, decision_id DESC LIMIT ?
      `).bind(userId, Math.min(CustomerWalletCopyLimits.maximum_decisions_per_response, limit)).all();
      return (result?.results || []).map((row) => parseJson(row.decision_json)).filter((row) => row?.schema_version === RAVEN_COPY_DECISION_SCHEMA);
    },
    async listExitDecisions(userId, limit = CustomerWalletCopyLimits.maximum_exit_decisions_per_response) {
      const result = await db.prepare(`
        SELECT exit_json FROM ravenos_customer_shadow_copy_exit_decisions
        WHERE user_id = ? ORDER BY decided_at DESC, exit_decision_id DESC LIMIT ?
      `).bind(userId, Math.min(CustomerWalletCopyLimits.maximum_exit_decisions_per_response, limit)).all();
      return (result?.results || []).map((row) => parseJson(row.exit_json)).filter((row) => row?.schema_version === RAVEN_COPY_EXIT_DECISION_SCHEMA);
    },
    async listPositions(userId, limit = CustomerWalletCopyLimits.maximum_positions_per_response) {
      const result = await db.prepare(`
        SELECT position_json FROM ravenos_customer_shadow_copy_positions
        WHERE user_id = ? ORDER BY updated_at DESC, position_id DESC LIMIT ?
      `).bind(userId, Math.min(CustomerWalletCopyLimits.maximum_positions_per_response, limit)).all();
      const positions = (result?.results || []).map((row) => parseJson(row.position_json)).filter((row) => row?.schema_version === RAVEN_COPY_POSITION_SCHEMA);
      if (!positions.length) return [];
      const exitsResult = await db.prepare(`
        SELECT DISTINCT d.exit_json, d.decided_at, d.exit_decision_id
        FROM ravenos_customer_shadow_copy_exit_decisions d
        JOIN ravenos_customer_shadow_copy_exit_allocations a ON a.exit_decision_id = d.exit_decision_id
        WHERE d.user_id = ?
          AND a.position_id IN (
            SELECT position_id FROM ravenos_customer_shadow_copy_positions
            WHERE user_id = ? ORDER BY updated_at DESC, position_id DESC LIMIT ?
          )
        ORDER BY d.decided_at ASC, d.exit_decision_id ASC LIMIT ?
      `).bind(
        userId,
        userId,
        Math.min(CustomerWalletCopyLimits.maximum_positions_per_response, limit),
        CustomerWalletCopyLimits.maximum_exit_history_per_position_view + 1,
      ).all();
      const exitRows = exitsResult?.results || [];
      if (exitRows.length > CustomerWalletCopyLimits.maximum_exit_history_per_position_view) {
        throw new CustomerWalletCopyError("shadow_copy_exit_history_limit_exceeded");
      }
      const exits = exitRows
        .map((row) => parseJson(row.exit_json))
        .filter((row) => row?.schema_version === RAVEN_COPY_EXIT_DECISION_SCHEMA);
      return positions.map((position) => applyShadowCopyExitHistory(position, exits));
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
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/robinhood/activity`) return { kind: "robinhood_activity", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/robinhood/clusters`) return { kind: "robinhood_clusters", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/robinhood/relationships`) return { kind: "robinhood_relationships", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/saved-wallets`) return { kind: "research_saves", methods: new Set(["GET", "POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/watches`) return { kind: "watches", methods: new Set(["GET", "POST"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/decisions`) return { kind: "decisions", methods: new Set(["GET"]) };
  if (pathname === `${CUSTOMER_WALLET_COPY_ROUTE}/positions`) return { kind: "positions", methods: new Set(["GET"]) };
  const sourceWalletEvents = pathname.match(/^\/api\/v1\/wallet-copy\/wallets\/(sw_(?:sol|rh)_[a-f0-9]{40})\/events$/);
  if (sourceWalletEvents) return { kind: "source_wallet_events", source_wallet_id: sourceWalletEvents[1], methods: new Set(["GET"]) };
  const sourceWallet = pathname.match(/^\/api\/v1\/wallet-copy\/wallets\/(sw_(?:sol|rh)_[a-f0-9]{40})$/);
  if (sourceWallet) return { kind: "source_wallet", source_wallet_id: sourceWallet[1], methods: new Set(["GET"]) };
  const researchSave = pathname.match(/^\/api\/v1\/wallet-copy\/saved-wallets\/(wrs_[A-Za-z0-9_-]{16,96})$/);
  if (researchSave) return { kind: "research_save", save_id: researchSave[1], methods: new Set(["DELETE"]) };
  const refresh = pathname.match(/^\/api\/v1\/wallet-copy\/watches\/(wcw_[A-Za-z0-9_-]{16,96})\/refresh$/);
  if (refresh) return { kind: "refresh", watch_id: refresh[1], methods: new Set(["POST"]) };
  const watch = pathname.match(/^\/api\/v1\/wallet-copy\/watches\/(wcw_[A-Za-z0-9_-]{16,96})$/);
  if (watch) return { kind: "watch", watch_id: watch[1], methods: new Set(["PATCH", "DELETE"]) };
  return null;
}

async function authorizeWalletWorkspace(request, env, deps, mutation) {
  const authorize = deps.authorizeRequest || authorizeCustomerApiRequest;
  const authorization = await authorize(request, env, deps.identity || {}, { require_csrf: mutation });
  if (authorization.response) return { authorization, response: authorization.response };
  let grants = [];
  let entitlementStoreAvailable = true;
  try {
    const entitlementStore = deps.entitlementStore || createD1CustomerEntitlementStore(env.RAVENOS_CUSTOMER_DB);
    grants = await entitlementStore.listOwnedGrants(authorization.principal.user_id);
  } catch {
    entitlementStoreAvailable = false;
  }
  const advancedAccess = entitlementStoreAvailable ? resolveCapabilityAccess({
    capability: "wallet.copy",
    user_id: authorization.principal.user_id,
    grants,
    now: authorization.now,
    flags: resolveEntitlementFeatureFlags(env),
  }) : Object.freeze({ capability: "wallet.copy", available: false, state: "entitlement_store_unavailable", revision: null });
  return { authorization, advancedAccess, response: null };
}

function walletAccessSummary(advancedAccess) {
  const pro = advancedAccess?.available === true;
  return Object.freeze({
    tier: pro ? "pro" : "free",
    basic_wallet_lookup: true,
    basic_wallet_screener: true,
    raven_copy_subscription_required: false,
    advanced_wallet_intelligence: pro,
    advanced_state: advancedAccess?.state || "unavailable",
  });
}

function basicWalletProfile(profile) {
  const coverage = profile?.coverage || {};
  const performance = profile?.source_performance || {};
  const behavior = profile?.behavior || {};
  const quality = profile?.data_quality || {};
  return Object.freeze({
    schema_version: profile?.schema_version || null,
    profile_version: profile?.profile_version || null,
    source_wallet: profile?.source_wallet || null,
    generated_at: profile?.generated_at || null,
    coverage: {
      first_observed_at: coverage.first_observed_at ?? null,
      last_observed_at: coverage.last_observed_at ?? null,
      transactions_observed: coverage.transactions_observed ?? null,
      transactions_reported_by_provider: coverage.transactions_reported_by_provider ?? null,
      normalized_events: coverage.normalized_events ?? null,
      token_transfers_observed: coverage.token_transfers_observed ?? null,
      token_transfers_reported_by_provider: coverage.token_transfers_reported_by_provider ?? null,
      trade_events: coverage.trade_events ?? null,
      ambiguous_events: coverage.ambiguous_events ?? null,
      failed_transactions: coverage.failed_transactions ?? null,
      known_cost_basis_pct: null,
      history_scope: coverage.history_scope ?? quality.history_scope ?? "bounded_partial_history",
      source_history_complete: coverage.source_history_complete === true,
      provider_history_exhausted: coverage.provider_history_exhausted === true,
    },
    source_performance: {
      state: performance.state || "insufficient_evidence",
      realized_pnl_usdc: performance.realized_pnl_usdc ?? null,
      realized_pnl_sol: performance.realized_pnl_sol ?? null,
      roi_pct: performance.roi_pct ?? null,
      win_rate_pct: performance.win_rate_pct ?? null,
      closed_lots: performance.closed_lots ?? null,
      closed_observations: performance.closed_observations ?? performance.closed_lots ?? null,
      profit_factor: null,
      windows: null,
      limitations: [
        ...(Array.isArray(performance.limitations) ? performance.limitations.slice(0, 3) : []),
        "Cohorts, behavior, profit quality, and deep evidence are available with Raven Pro.",
      ],
    },
    behavior: {
      active_days: behavior.active_days ?? null,
      trade_count: behavior.trade_count ?? null,
      first_trade_at: behavior.first_trade_at ?? null,
      last_trade_at: behavior.last_trade_at ?? null,
      tokens_traded: behavior.tokens_traded ?? null,
      token_assets_observed: behavior.token_assets_observed ?? null,
      buy_count: behavior.buy_count ?? null,
      sell_count: behavior.sell_count ?? null,
      median_hold_seconds: null,
      trade_rate_per_active_day: null,
    },
    provider_activity: profile?.provider_activity || null,
    provider_balance_summary: profile?.provider_balance_summary || null,
    research_thesis: null,
    profit_quality: null,
    positions: {
      known_cost_open_positions: [],
      known_cost_open_position_count: null,
      unresolved_cost_basis_event_count: null,
      provider_reported_token_balances: Array.isArray(profile?.positions?.provider_reported_token_balances)
        ? profile.positions.provider_reported_token_balances.slice(0, 20)
        : [],
      marked_values_available: profile?.positions?.marked_values_available === true,
      executable_values_available: false,
    },
    capital_observations: {
      current_balance_claimed: false,
      native: profile?.capital_observations?.native || null,
      canonical_usdc: profile?.capital_observations?.canonical_usdc || null,
      provider_reported_token_count: profile?.capital_observations?.provider_reported_token_count ?? null,
    },
    data_quality: {
      history_scope: quality.history_scope ?? coverage.history_scope ?? "bounded_partial_history",
      provider_history_exhausted: quality.provider_history_exhausted === true,
      history_complete: quality.history_complete === true,
      trade_decode_coverage_pct: null,
      transaction_context_coverage_pct: quality.transaction_context_coverage_pct ?? null,
    },
    evidence: {
      unknown_cost_basis_is_zero: false,
      transfers_treated_as_trades: false,
      airdrops_treated_as_profit: false,
      full_history_claimed: quality.history_complete === true,
    },
  });
}

function basicScreenerQueryAllowed(query) {
  const filters = query?.filters || {};
  return !query?.preset
    && (!Array.isArray(query?.requested_clauses) || query.requested_clauses.length === 0)
    && (!Array.isArray(query?.clauses) || query.clauses.length === 0)
    && FREE_SCREENER_SORTS.has(query?.sort)
    && Number(query?.page || 0) <= CustomerWalletCopyLimits.free_screener_maximum_page
    && Number(query?.page_size || 0) <= CustomerWalletCopyLimits.free_screener_page_size
    && filters.min_known_cost_basis_pct === null
    && filters.min_closed_lots === null
    && filters.min_win_rate_pct === null
    && filters.min_roi_pct === null
    && filters.performance_state === "any";
}

function basicScreenerResponse(response) {
  return Object.freeze({
    ...response,
    access: { tier: "free", advanced_wallet_intelligence: false },
    presets: [],
    rows: (response.rows || []).map((row) => ({
      schema_version: row.schema_version,
      source_wallet_id: row.source_wallet_id,
      source_wallet: row.source_wallet,
      profile: row.profile,
      source_performance: {
        state: row.source_performance?.state || "insufficient_evidence",
        realized_pnl: row.source_performance?.realized_pnl || { usdc: null, sol: null, combined: null, bases_combined: false },
        roi_pct: row.source_performance?.roi_pct ?? null,
        win_rate_pct: row.source_performance?.win_rate_pct ?? null,
        closed_lots: row.source_performance?.closed_lots ?? null,
      },
      behavior: {
        first_trade_at: row.behavior?.first_trade_at ?? null,
        last_trade_at: row.behavior?.last_trade_at ?? null,
        trade_count: row.behavior?.trade_count ?? null,
        active_days: row.behavior?.active_days ?? null,
        token_count: row.behavior?.token_count ?? null,
      },
      coverage: {
        source_history_complete: row.coverage?.source_history_complete === true,
        provider_history_exhausted: row.coverage?.provider_history_exhausted === true,
        chain_wide_coverage_claimed: false,
      },
      why_surfaced: (row.why_surfaced || []).filter((reason) => new Set(["last_trade_observed", "normalized_trade_history", "observed_active_days", "raven_indexed_exact_wallet"]).has(reason.code)),
      scope: row.scope,
    })),
    limitations: [
      ...(response.limitations || []).slice(0, 2),
      "Free screening includes activity and headline performance. Cohorts, behavior, profit quality, and advanced filters require Raven Pro.",
    ],
  });
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
      : code === "evm_wallet_not_found" ? 404
      : new Set(["wallet_copy_watch_quota_exceeded", "wallet_copy_watch_revision_conflict", "wallet_research_save_quota_exceeded", "wallet_research_list_quota_exceeded", "source_cursor_gap"]).has(code) ? 409
        : new Set(["wallet_copy_provider_unavailable", "wallet_copy_state_unavailable", "stored_wallet_copy_state_invalid", "stored_wallet_research_save_invalid", "stored_wallet_activity_event_invalid", "wallet_activity_store_unavailable", "shadow_copy_exit_atomic_store_unavailable", "shadow_copy_exit_history_limit_exceeded", "shadow_copy_position_history_limit_exceeded", "evm_wallet_lookup_disabled", "evm_wallet_lookup_misconfigured", "evm_wallet_provider_unavailable", "evm_wallet_provider_timeout", "evm_wallet_provider_response_invalid", "evm_wallet_provider_response_too_large"]).has(code) ? 503
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

function mergeProfileHistory(previous, incoming) {
  if (!previous && !incoming) return null;
  if (!previous) return incoming;
  if (!incoming) return previous;
  const maximumInteger = (left, right) => {
    const values = [Number(left), Number(right)].filter(Number.isSafeInteger);
    return values.length ? Math.max(...values) : null;
  };
  const providerExhausted = previous.provider_history_exhausted === true
    || previous.history_exhausted === true
    || incoming.provider_history_exhausted === true
    || incoming.history_exhausted === true;
  return {
    ...previous,
    ...incoming,
    provider: incoming.provider || previous.provider || null,
    history_limit: maximumInteger(previous.history_limit, incoming.history_limit),
    signatures_requested: maximumInteger(previous.signatures_requested, incoming.signatures_requested),
    transactions_decoded: maximumInteger(previous.transactions_decoded, incoming.transactions_decoded),
    history_exhausted: providerExhausted,
    provider_history_exhausted: providerExhausted,
    source_history_verified_complete: false,
    decode_partial: incoming.decode_partial === true,
  };
}

export async function persistSourceWalletProfile(store, sourceId, now, history = null) {
  const allEvents = await store.listSourceEvents(sourceId, CustomerWalletCopyLimits.maximum_profile_events_per_snapshot);
  if (!allEvents.length) return null;
  const schemaVersions = new Set(allEvents.map((event) => event?.schema_version));
  if (schemaVersions.size !== 1) throw new CustomerWalletCopyError("wallet_profile_chain_mixed");
  const previous = (await store.latestProfile(sourceId))?.data_quality || null;
  const retained = mergeProfileHistory(previous, history);
  const profileHistory = retained ? {
    ...retained,
    analysis_event_limit: CustomerWalletCopyLimits.maximum_profile_events_per_snapshot,
    analysis_events: allEvents.length,
    analysis_truncated: Number(retained.transactions_decoded || 0) > allEvents.length,
  } : {
    analysis_event_limit: CustomerWalletCopyLimits.maximum_profile_events_per_snapshot,
    analysis_events: allEvents.length,
    analysis_truncated: false,
  };
  const profile = schemaVersions.has(SOURCE_WALLET_CHAIN_EVENT_SCHEMA)
    ? buildRobinhoodWalletProfile(allEvents, {
      generated_at: new Date(now * 1_000).toISOString(),
      history: profileHistory,
    })
    : buildSolanaWalletProfile(allEvents, {
      generated_at: new Date(now * 1_000).toISOString(),
      history: profileHistory,
    });
  await store.recordProfile(sourceId, profile, now);
  return profile;
}

export async function ingestRobinhoodWalletEvents({
  store,
  events,
  now = Math.floor(Date.now() / 1_000),
  history = null,
} = {}) {
  const rows = Array.isArray(events) ? events : [];
  if (!store?.upsertSourceWallet || !store?.recordEvents || !store?.updateSourceCursor) {
    throw new CustomerWalletCopyError("wallet_observer_store_unavailable");
  }
  if (!rows.length || rows.length > CustomerWalletCopyLimits.maximum_profile_events_per_snapshot) {
    throw new CustomerWalletCopyError("robinhood_wallet_ingress_events_invalid");
  }
  const sourceIds = new Set(rows.map((event) => event?.source_wallet_id));
  if (sourceIds.size !== 1 || rows.some((event) => event?.schema_version !== SOURCE_WALLET_CHAIN_EVENT_SCHEMA)) {
    throw new CustomerWalletCopyError("robinhood_wallet_ingress_events_invalid");
  }
  const sourceId = rows[0].source_wallet_id;
  const source = rows[0].source_wallet;
  let identity;
  try {
    identity = normalizeSourceWalletChainIdentity({
      chain: source?.chain,
      network: source?.network,
      chain_id: source?.chain_id,
      address: source?.address,
    });
  } catch {
    throw new CustomerWalletCopyError("robinhood_wallet_ingress_identity_invalid");
  }
  const boundaryFields = ["live_copy", "transaction_construction", "signing", "broadcasting", "custody", "fee_collection"];
  const finalities = new Set(["pending", "processed", "confirmed", "safe", "finalized"]);
  const eventValid = (event) => {
    let transactionReference;
    try {
      transactionReference = normalizeSourceWalletTransactionReference({
        chain: "robinhood",
        network: "mainnet",
        transaction_reference: event.chain_evidence?.transaction_reference,
      });
    } catch {
      return false;
    }
    return (
      event.source_wallet_id === sourceId
      && event.source_wallet?.chain === identity.chain
      && event.source_wallet?.network === identity.network
      && String(event.source_wallet?.chain_id) === String(identity.chain_id)
      && event.source_wallet?.vm_family === identity.vm_family
      && event.source_wallet?.address === identity.address
      && /^swe_[a-f0-9]{40}$/.test(String(event.event_id || ""))
      && /^[a-f0-9]{40}$/.test(String(event.evidence_hash || ""))
      && Number.isSafeInteger(Number(event.decode_version))
      && Number(event.decode_version) >= 1
      && transactionReference === event.chain_evidence?.transaction_reference
      && Number.isSafeInteger(Number(event.chain_evidence?.block_number))
      && Number(event.chain_evidence.block_number) >= 0
      && /^0x[a-f0-9]{64}$/.test(String(event.chain_evidence?.block_hash || ""))
      && finalities.has(event.chain_evidence?.finality)
      && Array.isArray(event.chain_evidence?.providers)
      && event.chain_evidence.providers.length >= 1
      && boundaryFields.every((field) => event.execution_boundary?.[field] === false)
    );
  };
  if (
    identity.chain !== "robinhood"
    || identity.source_wallet_id !== sourceId
    || rows.some((event) => !eventValid(event))
  ) throw new CustomerWalletCopyError("robinhood_wallet_ingress_identity_invalid");
  await store.upsertSourceWallet({
    source_wallet_id: sourceId,
    chain: identity.chain,
    network: identity.network,
    chain_id: identity.chain_id,
    address: identity.address,
    now,
    state: "current",
    provider_scope: "bounded_robinhood_observer",
  });
  const insertedEventIds = await store.recordEvents(sourceId, rows, now);
  const newest = [...rows].sort((left, right) => (
    Number(right.chain_evidence?.block_number || 0) - Number(left.chain_evidence?.block_number || 0)
    || String(right.event_id).localeCompare(String(left.event_id))
  ))[0];
  await store.updateSourceCursor(sourceId, {
    state: "current",
    last_observed_at: now,
    last_signature: null,
    last_transaction_reference: newest.chain_evidence.transaction_reference,
    last_block_number: newest.chain_evidence.block_number,
    now,
  });
  const profile = await persistSourceWalletProfile(store, sourceId, now, history);
  return Object.freeze({
    schema_version: "ravenos.robinhood_wallet_ingress_result.v1",
    source_wallet_id: sourceId,
    received_event_count: rows.length,
    inserted_event_count: insertedEventIds.length,
    inserted_event_ids: Object.freeze([...insertedEventIds]),
    profile,
    shadow_decisions_created: 0,
    live_execution_authorized: false,
  });
}

async function prospectiveCopyabilityForSource(store, sourceId, now, referenceFeeBps = null) {
  const generatedAt = new Date(now * 1_000).toISOString();
  if (typeof store?.listSourceCopyabilityObservations !== "function") {
    return buildSourceWalletCopyabilityMatrix([], { generated_at: generatedAt, reference_fee_bps: referenceFeeBps });
  }
  const observations = await store.listSourceCopyabilityObservations(
    sourceId,
    SourceWalletCopyabilityLimits.maximum_observations_per_source_profile,
  );
  const outcomeCheckpoints = typeof store?.listSourceCopyabilityCheckpoints === "function"
    ? await store.listSourceCopyabilityCheckpoints(sourceId, SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints)
    : [];
  const crowdingObservations = typeof store?.listSourceCopyCrowdingObservations === "function"
    ? await store.listSourceCopyCrowdingObservations(sourceId, SourceWalletCopyCrowdingLimits.maximum_public_observations)
    : [];
  return buildSourceWalletCopyabilityMatrix(observations, {
    generated_at: generatedAt,
    reference_fee_bps: referenceFeeBps,
    outcome_checkpoints: outcomeCheckpoints,
    crowding_observations: crowdingObservations,
  });
}

async function inspectAddress({ address, store, provider, now, advanced_intelligence: advancedIntelligence = false, reference_fee_bps: referenceFeeBps = null }) {
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
  const prospectiveCopyability = advancedIntelligence
    ? await prospectiveCopyabilityForSource(store, sourceId, now, referenceFeeBps)
    : null;
  return { source_wallet_id: sourceId, profile, prospective_copyability: prospectiveCopyability, recent_events: events.slice(0, 12) };
}

async function sourceWalletActivityPage(store, sourceId, query) {
  if (typeof store?.listSourceEventPage !== "function") throw new CustomerWalletCopyError("wallet_activity_store_unavailable");
  const page = await store.listSourceEventPage(sourceId, query);
  const events = (Array.isArray(page?.events) ? page.events : []).map((event) => publicSourceWalletActivityEvent(event, sourceId));
  return Object.freeze({
    schema_version: "ravenos.wallet_activity_page.v1",
    filter: query.filter,
    events,
    pagination: Object.freeze({
      limit: query.limit,
      returned: events.length,
      matching_event_count: Math.max(0, Number(page?.matching_event_count || 0)),
      has_more: page?.has_more === true,
      next_cursor: page?.has_more === true ? page.next_cursor || null : null,
    }),
    scope: Object.freeze({
      evidence_mode: "retained_raven_index",
      provider_request_performed: false,
      history_complete_claimed: false,
      current_balance_claimed: false,
    }),
  });
}

async function enqueueDeepHistory(backfillStore, { address, demand_class: demandClass, now }) {
  if (!backfillStore?.enqueueJob) {
    return Object.freeze({ state: "not_enabled", signatures_indexed: 0, history_exhausted: false, history_complete_claimed: false });
  }
  try {
    return publicSourceWalletBackfillJob(await backfillStore.enqueueJob({
      address,
      provider: "configured_solana_rpc",
      demand_class: demandClass,
      now: now * 1_000,
    }));
  } catch {
    return Object.freeze({ state: "unavailable", signatures_indexed: 0, history_exhausted: false, history_complete_claimed: false });
  }
}

async function deepHistoryForSource(backfillStore, sourceId) {
  if (!backfillStore?.jobForSource) {
    return Object.freeze({ state: "not_enabled", signatures_indexed: 0, history_exhausted: false, history_complete_claimed: false });
  }
  try {
    return publicSourceWalletBackfillJob(await backfillStore.jobForSource(sourceId));
  } catch {
    return Object.freeze({ state: "unavailable", signatures_indexed: 0, history_exhausted: false, history_complete_claimed: false });
  }
}

function chainBackfillBoundary(chain) {
  return Object.freeze({
    state: "not_enabled",
    chain,
    reason: `${chain}_archive_backfill_not_connected`,
    signatures_indexed: 0,
    history_exhausted: false,
    history_complete_claimed: false,
  });
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

function unavailableExitQuoteEvidence(reason, { providerUnavailable = false } = {}) {
  return {
    asset_evidence: {
      identity_resolved: true,
      token_standard: "unavailable",
      token_standard_resolved: false,
      sell_simulation_state: "not_requested",
    },
    exit: {
      state: providerUnavailable ? "provider_unavailable" : "unavailable",
      provider: "jupiter",
      reason,
      exact_asset_identity: true,
    },
  };
}

function quoteCacheKey(provider, event, policy) {
  if (!policy.sizing.implemented) return `policy-only:${event.event_id}:${policy.sizing.kind}`;
  if (typeof provider?.quoteCopySignalCacheKey === "function") {
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
      evidence = typeof provider?.quoteCopySignal === "function"
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

function exitQuoteCacheKey(event, policy, quantityBaseUnits) {
  return `${event.event_id}:mapped_exit:${quantityBaseUnits}:${policy.execution_quality.maximum_price_impact_bps}`;
}

async function evaluateSourceExitWithStats({ event, watch, store, provider, userId, now, quoteCache = null, positions = null }) {
  const assetMint = event.economic?.source_asset?.mint;
  const mappedPositions = positions || (typeof store.listMappedPositionsForWatch === "function"
    ? await store.listMappedPositionsForWatch(userId, watch.watch_id, assetMint)
    : []);
  const draft = createRavenCopyExitDecision({
    watch_id: watch.watch_id,
    source_event: event,
    policy: watch.policy,
    positions: mappedPositions,
    ...unavailableExitQuoteEvidence("exit_quote_not_requested"),
  }, { now: now * 1_000 });
  let decision = draft;
  const quantityBaseUnits = draft.mapped_follower_exit.quantity_base_units;
  if (
    draft.decision.state !== "IGNORED_PRE_SUBSCRIPTION_INVENTORY"
    && draft.decision.state !== "POLICY_REJECTED"
    && draft.decision.reason_code !== "mapped_exit_below_atomic_unit"
    && BigInt(quantityBaseUnits) > 0n
  ) {
    let evidence;
    if (typeof provider?.quoteCopyExit !== "function") {
      evidence = unavailableExitQuoteEvidence("quote_provider_not_configured", { providerUnavailable: true });
    } else {
      const key = exitQuoteCacheKey(event, watch.policy, quantityBaseUnits);
      try {
        if (quoteCache) {
          if (!quoteCache.has(key)) {
            quoteCache.set(key, Promise.resolve().then(() => provider.quoteCopyExit({
              event,
              policy: watch.policy,
              quantity_base_units: quantityBaseUnits,
              now,
            })));
          }
          evidence = await quoteCache.get(key);
        } else {
          evidence = await provider.quoteCopyExit({ event, policy: watch.policy, quantity_base_units: quantityBaseUnits, now });
        }
      } catch {
        evidence = unavailableExitQuoteEvidence("quote_provider_unavailable", { providerUnavailable: true });
      }
    }
    decision = createRavenCopyExitDecision({
      watch_id: watch.watch_id,
      source_event: event,
      policy: watch.policy,
      positions: mappedPositions,
      ...evidence,
    }, { now: now * 1_000 });
  }
  const inserted = typeof store.recordExitDecision === "function"
    ? await store.recordExitDecision(userId, decision, now)
    : false;
  return {
    decision,
    recorded: inserted ? 1 : 0,
    positions_exited: decision.decision.state === "SHADOW_EXIT_EXECUTABLE" ? decision.position_allocations.length : 0,
  };
}

async function evaluateNewWalletEvents({ events, watch, store, provider, userId, now }) {
  const decisions = [];
  const exitDecisions = [];
  const quoteCache = new Map();
  const ordered = [...events].sort((left, right) => (
    Number(left.chain_evidence?.slot || 0) - Number(right.chain_evidence?.slot || 0)
    || String(left.chain_evidence?.signature || "").localeCompare(String(right.chain_evidence?.signature || ""))
  ));
  const eligibleSignals = ordered.filter((event) => event.copy_signal?.eligible_buy_signal || event.copy_signal?.eligible_sell_signal);
  const signals = eligibleSignals.slice(0, CustomerWalletCopyLimits.maximum_new_signals_per_refresh);
  for (const event of signals) {
    if (event.copy_signal?.eligible_buy_signal) {
      const result = await evaluateNewSignalsWithStats({ events: [event], watch, store, provider, userId, now, quoteCache });
      decisions.push(...result.decisions);
    } else if (event.copy_signal?.eligible_sell_signal) {
      const result = await evaluateSourceExitWithStats({ event, watch, store, provider, userId, now, quoteCache });
      exitDecisions.push(result.decision);
    }
  }
  const deferredSignalCount = Math.max(0, eligibleSignals.length - signals.length);
  return {
    decisions,
    exit_decisions: exitDecisions,
    deferred_signal_count: deferredSignalCount,
    cursor_event: deferredSignalCount ? signals.at(-1) : null,
  };
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
  const buySignal = event.copy_signal?.eligible_buy_signal === true;
  const sellSignal = event.copy_signal?.eligible_sell_signal === true;
  if (!buySignal && !sellSignal) {
    return Object.freeze({
      complete: true,
      subscriber_policy_count: 0,
      decision_count: 0,
      position_count: 0,
      position_exit_count: 0,
      quote_variant_count: 0,
      deferred_policy_count: 0,
      decision_completed_at: new Date(now * 1_000).toISOString(),
    });
  }
  if (sellSignal && !store?.listActiveWatchesForExitSource) throw new CustomerWalletCopyError("wallet_observer_exit_store_unavailable");
  const policyLimit = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_observer_policies_per_job, Number(maximumPolicies) || 1));
  const quoteVariantLimit = Math.max(1, Math.min(CustomerWalletCopyLimits.maximum_observer_quote_variants_per_job, Number(maximumQuoteVariants) || 1));
  const rows = sellSignal
    ? await store.listActiveWatchesForExitSource(sourceId, event, policyLimit)
    : await store.listActiveWatchesForSource(sourceId, event, policyLimit);
  const quoteCache = new Map();
  let evaluated = 0;
  let recorded = 0;
  let positions = 0;
  let positionExits = 0;
  let deferred = 0;
  for (const row of rows) {
    const watch = publicWatch(row);
    let mappedPositions = null;
    let key;
    if (sellSignal) {
      mappedPositions = typeof store.listMappedPositionsForWatch === "function"
        ? await store.listMappedPositionsForWatch(row.user_id, watch.watch_id, event.economic.source_asset.mint)
        : [];
      const draft = createRavenCopyExitDecision({
        watch_id: watch.watch_id,
        source_event: event,
        policy: watch.policy,
        positions: mappedPositions,
        ...unavailableExitQuoteEvidence("exit_quote_not_requested"),
      }, { now: now * 1_000 });
      const quoteRequired = !new Set(["IGNORED_PRE_SUBSCRIPTION_INVENTORY", "POLICY_REJECTED"]).has(draft.decision.state)
        && draft.decision.reason_code !== "mapped_exit_below_atomic_unit"
        && BigInt(draft.mapped_follower_exit.quantity_base_units) > 0n;
      key = quoteRequired ? exitQuoteCacheKey(event, watch.policy, draft.mapped_follower_exit.quantity_base_units) : null;
    } else {
      key = quoteCacheKey(provider, event, watch.policy);
    }
    if (key && !quoteCache.has(key) && quoteCache.size >= quoteVariantLimit) {
      deferred += 1;
      continue;
    }
    const result = sellSignal
      ? await evaluateSourceExitWithStats({
          event,
          watch,
          store,
          provider,
          userId: row.user_id,
          now,
          quoteCache,
          positions: mappedPositions,
        })
      : await evaluateNewSignalsWithStats({
          events: [event],
          watch,
          store,
          provider,
          userId: row.user_id,
          now,
          quoteCache,
        });
    if (!sellSignal && !result.decisions.length) throw new CustomerWalletCopyError("wallet_observer_decision_missing");
    evaluated += 1;
    recorded += result.recorded;
    positions += result.positions || 0;
    positionExits += result.positions_exited || 0;
    await store.advanceObservedWatchCursor(watch.watch_id, event, now);
  }
  const pending = sellSignal && typeof store.countPendingExitWatchesForSource === "function"
    ? await store.countPendingExitWatchesForSource(sourceId, event)
    : typeof store.countPendingWatchesForSource === "function"
      ? await store.countPendingWatchesForSource(sourceId, event)
      : deferred + (rows.length >= policyLimit ? 1 : 0);
  return Object.freeze({
    complete: pending === 0,
    subscriber_policy_count: evaluated,
    decision_count: recorded,
    position_count: positions,
    position_exit_count: positionExits,
    quote_variant_count: quoteCache.size,
    deferred_policy_count: pending,
    decision_completed_at: new Date().toISOString(),
  });
}

export async function routeCustomerWalletCopy(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const route = routeMatch(url.pathname);
  if (!route) return null;
  const queryRoutes = new Set(["source_wallet_events", "robinhood_activity", "robinhood_clusters", "robinhood_relationships"]);
  if (!sameOriginBoundary(request) || url.hash || (url.search && !queryRoutes.has(route.kind))) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, error: "request_not_allowed" }, { status: 403 });
  if (!route.methods.has(request.method)) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, error: "method_not_allowed" }, { status: 405, extra_headers: { allow: [...route.methods].join(", ") } });
  const mutation = request.method !== "GET";
  const authorized = await authorizeWalletWorkspace(request, env, deps, mutation);
  if (authorized.response) return authorized.response;
  const access = walletAccessSummary(authorized.advancedAccess);
  const activation = resolveWalletCopyActivation(env);
  if (!activation.wallet_intelligence) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "wallet_intelligence_disabled", activation }, { status: 503 }, authorized.authorization);
  if (new Set(["screener", "source_wallet", "source_wallet_events", "research_saves", "research_save", "robinhood_activity", "robinhood_clusters", "robinhood_relationships"]).has(route.kind) && !activation.wallet_screener) {
    return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "wallet_screener_disabled", activation }, { status: 503 }, authorized.authorization);
  }
  if (new Set(["watches", "watch", "refresh", "decisions", "positions"]).has(route.kind) && !activation.shadow_copy) {
    return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "server_disabled", error: "shadow_copy_disabled", activation }, { status: 503 }, authorized.authorization);
  }
  const userId = authorized.authorization.principal.user_id;
  const now = authorized.authorization.now;
  const store = deps.walletCopyStore || createD1CustomerWalletCopyStore(env.RAVENOS_CUSTOMER_DB);
  const backfillStore = activation.deep_history && access.advanced_wallet_intelligence
    ? deps.sourceWalletBackfillStore || null
    : null;
  try {
    const limited = await applyRateLimit(authorized.authorization, request, env, deps, route, mutation && route.kind !== "screener");
    if (!limited.allowed) return privateJson({ ok: false, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, state: "unavailable", error: "wallet_copy_rate_limited" }, { status: 429, extra_headers: { "retry-after": String(limited.retry_after_seconds) } }, authorized.authorization);

    if (route.kind === "summary") {
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: "available",
        access,
        legacy_advanced_capability: "wallet.copy",
        activation,
        limits: CustomerWalletCopyLimits,
        modes: ["WATCH", "SHADOW", "USER_REVIEWED_COPY"],
        copy_product: { subscription_required: false, execution_fees_separate: true },
        live_mode: activation.manual_terminal_copy ? "user_wallet_review" : "hard_disabled",
        execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false, transaction_material: false },
      }, {}, authorized.authorization);
    }

    if (route.kind === "inspect") {
      const body = exactObject(await parseBody(request), new Set(["address", "chain"]));
      const chain = clean(body.chain || "solana", 24).toLowerCase();
      if (chain !== "solana") {
        const result = await inspectEvmWallet({
          chain,
          address: body.address,
          env,
          fetchImpl: deps.fetchImpl || globalThis.fetch,
          cache: deps.evmWalletCache || (typeof caches !== "undefined" ? caches.default : null),
          now: new Date(now * 1_000).toISOString(),
        });
        return privateJson({
          ...result,
          access,
          profile: access.advanced_wallet_intelligence ? result.profile : basicWalletProfile(result.profile),
        }, {}, authorized.authorization);
      }
      const address = normalizeSolanaWalletAddress(body.address);
      const result = await inspectAddress({
        address,
        store,
        provider: requireProvider(deps),
        now,
        advanced_intelligence: access.advanced_wallet_intelligence,
        reference_fee_bps: env.RAVENOS_WALLET_COPYABILITY_FEE_BPS || null,
      });
      const deepHistory = await enqueueDeepHistory(backfillStore, { address, demand_class: "interactive_lookup", now });
      const activity = await sourceWalletActivityPage(store, result.source_wallet_id, normalizeWalletActivityQuery(new URLSearchParams()));
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: "available",
        access,
        ...result,
        profile: access.advanced_wallet_intelligence ? result.profile : basicWalletProfile(result.profile),
        prospective_copyability: access.advanced_wallet_intelligence ? result.prospective_copyability : null,
        recent_events: activity.events,
        activity,
        deep_history: access.advanced_wallet_intelligence ? deepHistory : { state: "pro_required", history_complete_claimed: false },
      }, {}, authorized.authorization);
    }

    if (route.kind === "screener") {
      const query = normalizeWalletScreenerRequest(await parseBody(request), {
        now,
        copyability_reference: access.advanced_wallet_intelligence ? createSourceWalletCopyabilityPolicyReference({
          fee_bps: env.RAVENOS_WALLET_COPYABILITY_FEE_BPS || 10,
        }) : null,
      });
      if (!access.advanced_wallet_intelligence && !basicScreenerQueryAllowed(query)) {
        return privateJson({
          ok: false,
          schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
          state: "pro_required",
          error: "advanced_wallet_intelligence_required",
          access,
        }, { status: 403 }, authorized.authorization);
      }
      const result = await store.screenSourceWallets(query);
      const response = buildWalletScreenerResponse({ query, rows: result.rows, total: result.total, now });
      return privateJson(access.advanced_wallet_intelligence
        ? { ...response, access }
        : basicScreenerResponse(response), {}, authorized.authorization);
    }

    if (new Set(["robinhood_activity", "robinhood_clusters", "robinhood_relationships"]).has(route.kind)) {
      if (route.kind === "robinhood_relationships" && !access.advanced_wallet_intelligence) {
        return privateJson({
          ok: false,
          schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
          state: "pro_required",
          error: "advanced_wallet_intelligence_required",
          access,
        }, { status: 403 }, authorized.authorization);
      }
      if (typeof store.listRobinhoodTraderActivity !== "function") {
        throw new CustomerWalletCopyError("robinhood_trader_store_unavailable");
      }
      const query = normalizeRobinhoodTraderIntelligenceQuery(url.searchParams, {
        now: new Date(now * 1_000).toISOString(),
      });
      const rows = await store.listRobinhoodTraderActivity({
        since_at: query.since_at,
        limit: RobinhoodTraderIntelligenceLimits.maximum_source_events,
      });
      const activity = buildRobinhoodTraderActivity(rows, {
        ...query,
        limit: route.kind === "robinhood_activity"
          ? query.limit
          : RobinhoodTraderIntelligenceLimits.maximum_source_events,
      });
      const intelligence = route.kind === "robinhood_activity"
        ? activity
        : route.kind === "robinhood_clusters"
          ? buildRobinhoodClusteredActivity(activity, query)
          : buildRobinhoodLeadLagRelationships(activity, query);
      return privateJson({
        ok: true,
        ...intelligence,
        access,
        product_boundary: {
          basic_activity_included: true,
          clustered_activity_included: true,
          lead_lag_requires_pro: true,
          copy_subscription_required: false,
          execution_fee_policy_reused: true,
        },
      }, {}, authorized.authorization);
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
      if (!/^sw_(?:sol|rh)_[a-f0-9]{40}$/.test(sourceId)) throw new CustomerWalletCopyError("wallet_source_id_invalid");
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
      const deepHistory = source.chain === "solana"
        ? await enqueueDeepHistory(backfillStore, { address: source.address, demand_class: "saved_research", now })
        : chainBackfillBoundary(source.chain);
      const created = !duplicate && row?.save_id === proposedSaveId;
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, created, save: publicResearchSave(row), deep_history: deepHistory }, { status: created ? 201 : 200 }, authorized.authorization);
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
      const activity = await sourceWalletActivityPage(store, route.source_wallet_id, normalizeWalletActivityQuery(new URLSearchParams()));
      const deepHistory = source.chain === "solana"
        ? await deepHistoryForSource(backfillStore, route.source_wallet_id)
        : chainBackfillBoundary(source.chain);
      const prospectiveCopyability = access.advanced_wallet_intelligence
        ? await prospectiveCopyabilityForSource(
          store,
          route.source_wallet_id,
          now,
          env.RAVENOS_WALLET_COPYABILITY_FEE_BPS || null,
        )
        : null;
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: "available",
        access,
        source_wallet_id: route.source_wallet_id,
        profile: access.advanced_wallet_intelligence ? profile : basicWalletProfile(profile),
        prospective_copyability: access.advanced_wallet_intelligence ? prospectiveCopyability : null,
        recent_events: activity.events,
        activity,
        deep_history: access.advanced_wallet_intelligence ? deepHistory : { state: "pro_required", history_complete_claimed: false },
        evidence_mode: "retained_raven_index",
        provider_request_performed: false,
      }, {}, authorized.authorization);
    }

    if (route.kind === "source_wallet_events") {
      const source = await store.getSourceWallet(route.source_wallet_id);
      if (!source) throw new CustomerWalletCopyError("wallet_source_not_found");
      const activity = await sourceWalletActivityPage(store, route.source_wallet_id, normalizeWalletActivityQuery(url.searchParams));
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: activity.events.length ? "available" : "empty",
        access,
        source_wallet_id: route.source_wallet_id,
        ...activity,
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
      const deepHistory = await enqueueDeepHistory(backfillStore, { address, demand_class: "customer_watch", now });
      return privateJson({ ok: true, schema_version: CUSTOMER_WALLET_COPY_SCHEMA, created: true, watch: publicWatch(row), deep_history: deepHistory }, { status: 201 }, authorized.authorization);
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
      const evaluated = initial
        ? { decisions: [], exit_decisions: [], deferred_signal_count: 0, cursor_event: null }
        : await evaluateNewWalletEvents({ events: newEvents, watch, store, provider, userId, now });
      const watchCursor = evaluated.cursor_event || newest;
      await store.advanceWatchCursor(userId, route.watch_id, { signature: watchCursor.chain_evidence.signature, slot: watchCursor.chain_evidence.slot, backfill_complete: true, now });
      const profile = await persistSourceWalletProfile(store, row.source_wallet_id, now, initial ? loaded : null);
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: initial ? "baseline_established" : "refreshed",
        historical_events_added: initial ? events.length : 0,
        prospective_events_observed: newEvents.length,
        prospective_signals_deferred: evaluated.deferred_signal_count,
        decisions: evaluated.decisions,
        exit_decisions: evaluated.exit_decisions,
        profile: access.advanced_wallet_intelligence ? profile : basicWalletProfile(profile),
        continuous_monitoring: activation.continuous_observer,
        next_step: evaluated.deferred_signal_count
          ? "Check again to continue the retained source-signal backlog."
          : activation.continuous_observer
            ? "Raven will keep monitoring this wallet. Manual checks remain available."
            : "Check again to look for newer source-wallet activity.",
      }, {}, authorized.authorization);
    }

    if (route.kind === "decisions") {
      const decisions = await store.listDecisions(userId);
      const exitDecisions = typeof store.listExitDecisions === "function" ? await store.listExitDecisions(userId) : [];
      const byWatch = new Map();
      for (const decision of decisions) {
        const rows = byWatch.get(decision.watch_id) || [];
        rows.push(decision);
        byWatch.set(decision.watch_id, rows);
      }
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_WALLET_COPY_SCHEMA,
        state: decisions.length || exitDecisions.length ? "available" : "empty",
        decisions,
        exit_decisions: exitDecisions,
        copyability: access.advanced_wallet_intelligence ? [...byWatch.entries()].map(([watchIdentifier, rows]) => ({
          watch_id: watchIdentifier,
          snapshot: buildCopyabilitySnapshot(rows, { generated_at: new Date(now * 1_000).toISOString() }),
          by_size: buildCopyabilityBySize(rows, { generated_at: new Date(now * 1_000).toISOString() }),
        })) : [],
        access,
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
  access_model: Object.freeze({
    authenticated_basic_wallet_intelligence: true,
    raven_copy_subscription_required: false,
    advanced_wallet_intelligence_capability: "wallet.copy",
  }),
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
    shared_copyability_probes: "RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED",
    follower_outcome_checkpoints: "RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED",
    deep_history: "RAVENOS_WALLET_BACKFILL_ENABLED",
  }),
  source_level_disabled: Object.freeze({ live_copy: true, signing: true, broadcasting: true, custody: true, fee_collection: true, live_execution_scheduler: true }),
});
