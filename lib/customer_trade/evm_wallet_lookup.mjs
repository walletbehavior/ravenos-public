import { createHash } from "node:crypto";

import { EVM_CHAIN_PROFILES, resolveEvmChainProfile } from "./evm_chain_profiles.mjs";
import { normalizeSourceWalletChainIdentity } from "./source_wallet_chain_identity.mjs";

export const EVM_WALLET_LOOKUP_SCHEMA = "ravenos.evm_wallet_lookup.v2";
export const EVM_WALLET_BASIC_PROFILE_SCHEMA = "ravenos.evm_wallet_basic_profile.v2";

const BLOCKSCOUT_API_ORIGIN = "https://api.blockscout.com";
const CACHE_NAMESPACE = "ravenos-evm-wallet-lookup-v2";
const CACHE_FRESH_SECONDS = 60;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TOKEN_ROWS = 50;
const MAX_TRANSFER_ROWS = 50;
const MAX_TRANSACTION_CONTEXT_CANDIDATES = 3;
const EVM_ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const EVM_TRANSACTION_RE = /^0x[a-f0-9]{64}$/;

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function fail(code, status = 502) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function clean(value, maximum = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
}

function unsignedInteger(value) {
  const text = String(value ?? "").trim();
  return /^(?:0|[1-9]\d*)$/.test(text) ? text : null;
}

function boundedInteger(value) {
  const text = unsignedInteger(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function finite(value, { minimum = -Infinity } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

function decimals(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
}

function decimalAmount(value, precision) {
  const raw = unsignedInteger(value);
  if (raw === null || !Number.isInteger(precision) || precision < 0 || precision > 255) return null;
  if (precision === 0) return raw;
  const padded = raw.padStart(precision + 1, "0");
  const whole = padded.slice(0, -precision);
  const fraction = padded.slice(-precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function addressHash(value) {
  const direct = clean(value?.hash ?? value, 42).toLowerCase();
  return EVM_ADDRESS_RE.test(direct) ? direct : null;
}

function providerUrl(profile, path, apiKey) {
  const url = new URL(`/${profile.chain_id}/api/v2/${path.replace(/^\/+/, "")}`, BLOCKSCOUT_API_ORIGIN);
  url.searchParams.set("apikey", apiKey);
  return url;
}

function cacheRequest(profile, identity) {
  return new Request(`https://${CACHE_NAMESPACE}.invalid/${profile.chain_id}/${identity.address}.json`, { method: "GET" });
}

function cachePayloadMatches(payload, profile, identity, nowMs) {
  const generatedMs = Date.parse(String(payload?.profile?.generated_at || ""));
  return payload?.ok === true
    && payload?.schema_version === EVM_WALLET_LOOKUP_SCHEMA
    && payload?.source_wallet_id === identity.source_wallet_id
    && payload?.profile?.source_wallet?.chain_id === profile.chain_id
    && payload?.profile?.source_wallet?.address === identity.address
    && payload?.source?.provider === "blockscout_pro_v2"
    && payload?.source?.api_key_exposed === false
    && Number.isFinite(generatedMs)
    && generatedMs <= nowMs + 300_000
    && nowMs - generatedMs <= CACHE_FRESH_SECONDS * 1_000;
}

async function readCache(cache, profile, identity, nowMs) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const response = await cache.match(cacheRequest(profile, identity));
    if (!response?.ok) return null;
    const payload = await response.json();
    if (!cachePayloadMatches(payload, profile, identity, nowMs)) return null;
    return freeze({ ...payload, source: { ...payload.source, delivery: "edge_cache_fresh" } });
  } catch {
    return null;
  }
}

async function writeCache(cache, profile, identity, payload) {
  if (!cache || typeof cache.put !== "function" || payload?.ok !== true) return;
  const body = JSON.stringify(payload);
  const response = new Response(body, {
    status: 200,
    headers: {
      "cache-control": `public, max-age=${CACHE_FRESH_SECONDS}`,
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
  try {
    await cache.put(cacheRequest(profile, identity), response);
  } catch {
    // Provider truth remains available when edge caching is unavailable.
  }
}

async function boundedFetch(url, { fetchImpl, timeoutMs = 6_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("evm_wallet_provider_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("evm_wallet_provider_response_too_large");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) fail("evm_wallet_provider_response_too_large");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("evm_wallet_provider_response_invalid");
    }
    if (!response.ok) fail(response.status === 404 ? "evm_wallet_not_found" : "evm_wallet_provider_unavailable", response.status === 404 ? 404 : 502);
    return payload;
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") fail("evm_wallet_provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function resolveEvmWalletLookupRuntime(env = {}, chain = "") {
  let profile = null;
  try {
    profile = resolveEvmChainProfile(chain);
  } catch {
    // Unsupported remains an explicit runtime state.
  }
  const apiKey = clean(env.BLOCKSCOUT_API_KEY, 256);
  const requested = String(env.RAVENOS_EVM_WALLET_LOOKUP_ENABLED || "") === "1";
  return freeze({
    requested,
    enabled: Boolean(profile && requested && apiKey),
    state: !profile ? "unsupported" : !requested ? "disabled" : !apiKey ? "misconfigured" : "configured",
    profile,
    api_key_configured: Boolean(apiKey),
    provider: "blockscout_pro_v2",
    maximum_token_rows: MAX_TOKEN_ROWS,
    maximum_transfer_rows: MAX_TRANSFER_ROWS,
  });
}

function tokenRows(payload, profile) {
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items || items.length > MAX_TOKEN_ROWS) fail("evm_wallet_provider_response_invalid");
  return items.map((row) => {
    const token = row?.token || row?.token_instance?.token || null;
    const contract = addressHash(token?.address_hash);
    const rawBalance = unsignedInteger(row?.value);
    const tokenDecimals = decimals(token?.decimals);
    if (!contract || rawBalance === null || tokenDecimals === null) return null;
    const amount = decimalAmount(rawBalance, tokenDecimals);
    const price = finite(token?.exchange_rate, { minimum: 0 });
    const numericAmount = amount === null ? null : finite(amount, { minimum: 0 });
    return freeze({
      asset_id: `${profile.canonical_chain_id}/erc20:${contract}`,
      contract,
      token_standard: clean(token?.type, 24).toUpperCase() || null,
      symbol: clean(token?.symbol, 24) || null,
      name: clean(token?.name, 100) || null,
      decimals: tokenDecimals,
      balance_raw: rawBalance,
      balance_display: amount,
      provider_mark_price_usd: price,
      provider_mark_value_usd: numericAmount !== null && price !== null ? Number((numericAmount * price).toFixed(6)) : null,
      price_authority: price === null ? "unavailable" : "blockscout_indexed_exchange_rate",
      executable_value_usd: null,
      cost_basis_usd: null,
      pnl_usd: null,
    });
  }).filter(Boolean);
}

function transferRows(payload, identity, profile, observedAt) {
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items || items.length > MAX_TRANSFER_ROWS) fail("evm_wallet_provider_response_invalid");
  return items.map((row) => {
    const transaction = clean(row?.transaction_hash, 66).toLowerCase();
    const blockHash = clean(row?.block_hash, 66).toLowerCase();
    const blockNumber = boundedInteger(row?.block_number);
    const from = addressHash(row?.from);
    const to = addressHash(row?.to);
    const token = row?.token || null;
    const contract = addressHash(token?.address_hash);
    const raw = unsignedInteger(row?.total?.value);
    const tokenDecimals = decimals(row?.total?.decimals ?? token?.decimals);
    const logIndex = boundedInteger(row?.log_index);
    if (!EVM_TRANSACTION_RE.test(transaction) || !EVM_TRANSACTION_RE.test(blockHash) || blockNumber === null || !from || !to || !contract || raw === null) return null;
    const inbound = to === identity.address;
    const outbound = from === identity.address;
    if (!inbound && !outbound) return null;
    const kind = inbound && outbound ? "INTERNAL_ACCOUNT_MOVEMENT" : inbound ? "TRANSFER_IN" : "TRANSFER_OUT";
    const amount = tokenDecimals === null ? null : decimalAmount(raw, tokenDecimals);
    const asset = freeze({
      asset_id: `${profile.canonical_chain_id}/erc20:${contract}`,
      contract,
      standard: clean(token?.type, 24).toLowerCase() || "erc20",
      symbol: clean(token?.symbol, 24) || null,
      direction: inbound ? "in" : "out",
      delta_raw: `${inbound ? "" : "-"}${raw}`,
      canonical_usdc: contract === profile.accounting_asset.address && profile.accounting_asset.circle_canonical_usdc === true,
      decimals: tokenDecimals,
      amount_base_units: raw,
      amount_display: amount,
    });
    const eventId = `swe_${digest([profile.chain_namespace, identity.address, transaction, logIndex, contract, kind])}`;
    return freeze({
      schema_version: "ravenos.wallet_activity_event.v1",
      event_id: eventId,
      source_wallet: {
        chain: identity.chain,
        network: identity.network,
        chain_id: identity.chain_id,
        vm_family: identity.vm_family,
        address: identity.address,
      },
      chain_evidence: {
        transaction_reference: transaction,
        signature: null,
        slot: null,
        block_number: blockNumber,
        block_hash: blockHash,
        block_time: timestamp(row?.timestamp),
        finality: "confirmed",
        provider: "Blockscout Pro",
        evidence_reference: `${profile.canonical_chain_id}:tx:${transaction}:log:${logIndex ?? "unknown"}`,
      },
      timing: {
        observation_mode: "bounded_indexed_transfer_lookup",
        raven_received_at: observedAt,
        detection_delay_ms: null,
        decode_latency_ms: null,
      },
      classification: {
        kind,
        confidence: "direct_transfer_participant",
        reasons: ["exact_wallet_transfer_participant", "transfer_is_not_assumed_to_be_a_trade"],
        ambiguous: kind === "INTERNAL_ACCOUNT_MOVEMENT",
      },
      economic: {
        source_asset: outbound ? asset : null,
        destination_asset: inbound ? asset : null,
        transaction_fee_lamports: null,
        wallet_paid_transaction_fee: false,
        cost_basis_state: "unresolved_transfer_context",
      },
      route_evidence: {
        program_ids: [],
        swap_invocations: null,
        swap_route_observed: false,
        route_shape: "not_proven_from_transfer_index",
      },
      copy_signal: {
        eligible_buy_signal: false,
        eligible_sell_signal: false,
        reason: "erc20_transfer_is_not_a_copy_trade_signal",
      },
      evidence_hash: digest(row),
      evidence_boundary: {
        reconstructed_or_observed: "provider_indexed",
        provider_payload_included: false,
        transaction_material_included: false,
        subscriber_identity_included: false,
        current_balance_claimed: false,
      },
    });
  }).filter(Boolean).sort((left, right) => Date.parse(right.chain_evidence.block_time || 0) - Date.parse(left.chain_evidence.block_time || 0));
}

function routeDecodeCandidateReferences(events) {
  const transactions = new Map();
  for (const event of events) {
    const reference = event.chain_evidence.transaction_reference;
    const row = transactions.get(reference) || { reference, inbound: new Set(), outbound: new Set(), observed_at: null };
    if (event.economic.destination_asset?.contract) row.inbound.add(event.economic.destination_asset.contract);
    if (event.economic.source_asset?.contract) row.outbound.add(event.economic.source_asset.contract);
    const eventTime = timestamp(event.chain_evidence.block_time);
    if (eventTime && (!row.observed_at || Date.parse(eventTime) > Date.parse(row.observed_at))) row.observed_at = eventTime;
    transactions.set(reference, row);
  }
  return [...transactions.values()]
    .filter((row) => row.inbound.size > 0
      && row.outbound.size > 0
      && [...row.inbound].some((contract) => !row.outbound.has(contract)))
    .sort((left, right) => Date.parse(right.observed_at || 0) - Date.parse(left.observed_at || 0))
    .map((row) => row.reference);
}

function candidateAssetRows(events, reference, direction) {
  const selected = new Map();
  for (const event of events) {
    if (event.chain_evidence.transaction_reference !== reference) continue;
    const asset = direction === "in" ? event.economic.destination_asset : event.economic.source_asset;
    if (!asset?.contract) continue;
    const key = `${asset.contract}:${asset.amount_base_units || "unknown"}:${event.event_id}`;
    selected.set(key, freeze({
      asset_id: asset.asset_id,
      contract: asset.contract,
      symbol: asset.symbol,
      decimals: asset.decimals,
      amount_base_units: asset.amount_base_units,
      amount_display: asset.amount_display,
      canonical_usdc: asset.canonical_usdc === true,
    }));
  }
  return [...selected.values()].slice(0, 8);
}

function transactionContextRow(payload, reference, events, identity, profile, observedAt) {
  const providerHash = clean(payload?.hash, 66).toLowerCase();
  if (providerHash !== reference) fail("evm_wallet_provider_transaction_identity_mismatch", 409);
  const providerStatus = clean(payload?.status, 32).toLowerCase() || "unknown";
  const providerFrom = addressHash(payload?.from);
  const providerTo = addressHash(payload?.to);
  const providerTypes = Array.isArray(payload?.transaction_types)
    ? payload.transaction_types.map((value) => clean(value, 48)).filter(Boolean).slice(0, 12)
    : [];
  const providerActions = Array.isArray(payload?.actions)
    ? payload.actions.map((action) => freeze({
      type: clean(action?.type, 48) || null,
      protocol: clean(action?.protocol, 80) || null,
    })).filter((action) => action.type || action.protocol).slice(0, 12)
    : [];
  const inboundAssets = candidateAssetRows(events, reference, "in");
  const outboundAssets = candidateAssetRows(events, reference, "out");
  const tokenTransfersOverflow = typeof payload?.token_transfers_overflow === "boolean"
    ? payload.token_transfers_overflow
    : null;
  const state = providerStatus === "error"
    ? "provider_reports_failed_transaction"
    : providerStatus !== "ok"
      ? "provider_transaction_status_unresolved"
      : providerFrom === null
        ? "provider_transaction_sender_unresolved"
        : providerFrom !== identity.address
          ? "wallet_participant_not_transaction_sender"
          : tokenTransfersOverflow !== false
            ? "provider_transfer_completeness_unresolved"
            : "swap_shaped_context_unverified";
  return freeze({
    schema_version: "ravenos.evm_transaction_context_candidate.v1",
    transaction_reference: reference,
    state,
    context_available: true,
    source_wallet: {
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      address: identity.address,
    },
    provider_transaction: {
      status: providerStatus,
      method: clean(payload?.method, 120) || null,
      from: providerFrom,
      to: providerTo,
      wallet_is_sender: providerFrom === identity.address,
      block_number: boundedInteger(payload?.block_number),
      timestamp: timestamp(payload?.timestamp),
      confirmations: boundedInteger(payload?.confirmations),
      transaction_types: providerTypes,
      action_labels: providerActions,
      token_transfers_overflow: tokenTransfersOverflow,
    },
    wallet_transfer_shape: {
      inbound_assets: inboundAssets,
      outbound_assets: outboundAssets,
      inbound_asset_count: inboundAssets.length,
      outbound_asset_count: outboundAssets.length,
      opposing_different_assets_observed: inboundAssets.length > 0 && outboundAssets.length > 0,
    },
    interpretation: {
      raven_trade_classification: "unresolved",
      provider_method_is_trade_proof: false,
      recognized_router_proven: false,
      complete_wallet_economic_delta_proven: false,
      trade_claimed: false,
      copy_signal_created: false,
      reason: "transaction_context_requires_router_or_trace_and_net_balance_proof",
    },
    evidence: {
      provider: "blockscout_pro_v2",
      chain_id: profile.chain_id,
      retrieved_at: observedAt,
      provider_response_digest: digest(payload),
      provider_payload_included: false,
      raw_input_included: false,
    },
  });
}

async function transactionContextCandidates({ references, events, identity, profile, apiKey, fetchImpl, observedAt }) {
  return Promise.all(references.slice(0, MAX_TRANSACTION_CONTEXT_CANDIDATES).map(async (reference) => {
    try {
      const payload = await boundedFetch(providerUrl(profile, `transactions/${encodeURIComponent(reference)}`, apiKey), { fetchImpl });
      return transactionContextRow(payload, reference, events, identity, profile, observedAt);
    } catch (error) {
      const code = new Set([
        "evm_wallet_not_found",
        "evm_wallet_provider_response_invalid",
        "evm_wallet_provider_response_too_large",
        "evm_wallet_provider_timeout",
        "evm_wallet_provider_transaction_identity_mismatch",
        "evm_wallet_provider_unavailable",
      ]).has(error?.code) ? error.code : "evm_wallet_provider_unavailable";
      return freeze({
        schema_version: "ravenos.evm_transaction_context_candidate.v1",
        transaction_reference: reference,
        state: "provider_context_unavailable",
        context_available: false,
        error: code,
        interpretation: {
          raven_trade_classification: "unresolved",
          trade_claimed: false,
          copy_signal_created: false,
          reason: "transaction_context_unavailable",
        },
        evidence: {
          provider: "blockscout_pro_v2",
          chain_id: profile.chain_id,
          retrieved_at: observedAt,
          provider_payload_included: false,
          raw_input_included: false,
        },
      });
    }
  }));
}

function basicProfile({
  identity,
  profile,
  info,
  counters,
  balances,
  events,
  observedAt,
  tokenWindowTruncated,
  transferWindowTruncated,
  candidateReferences,
  transactionContexts,
}) {
  const reportedTransactions = boundedInteger(counters?.transactions_count);
  const reportedTransfers = boundedInteger(counters?.token_transfers_count);
  const nativeRaw = unsignedInteger(info?.coin_balance);
  const nativeAmount = nativeRaw === null ? null : decimalAmount(nativeRaw, 18);
  const times = events.map((event) => Date.parse(event.chain_evidence.block_time || "")).filter(Number.isFinite);
  const activeDays = new Set(times.map((value) => new Date(value).toISOString().slice(0, 10))).size;
  const inboundTransfers = events.filter((event) => event.classification.kind === "TRANSFER_IN").length;
  const outboundTransfers = events.filter((event) => event.classification.kind === "TRANSFER_OUT").length;
  const internalMovements = events.filter((event) => event.classification.kind === "INTERNAL_ACCOUNT_MOVEMENT").length;
  const tokenContracts = new Set(events.flatMap((event) => [
    event.economic.source_asset?.contract,
    event.economic.destination_asset?.contract,
  ]).filter(Boolean));
  const routeDecodeCandidateTransactions = candidateReferences.length;
  const availableTransactionContexts = transactionContexts.filter((row) => row.context_available === true).length;
  const pricedBalances = balances.filter((row) => row.provider_mark_value_usd !== null);
  const visibleMarkedValue = Number(pricedBalances
    .reduce((total, row) => total + row.provider_mark_value_usd, 0)
    .toFixed(6));
  const largestVisibleBalance = pricedBalances
    .slice()
    .sort((left, right) => right.provider_mark_value_usd - left.provider_mark_value_usd)[0] || null;
  const largestVisibleWeight = largestVisibleBalance && visibleMarkedValue > 0
    ? Number(((largestVisibleBalance.provider_mark_value_usd / visibleMarkedValue) * 100).toFixed(2))
    : null;
  return freeze({
    schema_version: EVM_WALLET_BASIC_PROFILE_SCHEMA,
    profile_version: 1,
    source_wallet: {
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      vm_family: identity.vm_family,
      address: identity.address,
    },
    generated_at: observedAt,
    coverage: {
      first_observed_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
      last_observed_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
      transactions_observed: 0,
      transactions_reported_by_provider: reportedTransactions,
      normalized_events: events.length,
      token_transfers_observed: events.length,
      token_transfers_reported_by_provider: reportedTransfers,
      token_balance_window_truncated: tokenWindowTruncated,
      token_transfer_window_truncated: transferWindowTruncated,
      trade_events: null,
      known_cost_basis_pct: null,
      history_scope: "bounded_current_balances_and_recent_transfers",
      source_history_complete: false,
      provider_history_exhausted: false,
    },
    source_performance: {
      state: "insufficient_evidence",
      realized_pnl_usdc: null,
      realized_pnl_sol: null,
      roi_pct: null,
      win_rate_pct: null,
      closed_lots: null,
      closed_observations: null,
      profit_factor: null,
      windows: null,
      limitations: [
        "Recent transfers are not classified as trades.",
        "Cost basis and P&L require decoded swaps plus complete lot history.",
        "Provider marks are not executable liquidation quotes.",
      ],
    },
    behavior: {
      active_days: activeDays || null,
      trade_count: null,
      first_trade_at: null,
      last_trade_at: null,
      tokens_traded: null,
      token_assets_observed: balances.length,
      buy_count: null,
      sell_count: null,
      median_hold_seconds: null,
      trade_rate_per_active_day: null,
      classifications: Object.fromEntries([...new Set(events.map((event) => event.classification.kind))].map((kind) => [kind, events.filter((event) => event.classification.kind === kind).length])),
    },
    provider_activity: {
      state: events.length ? "transfer_activity_observed" : "no_transfer_rows_returned",
      observed_transfer_rows: events.length,
      inbound_transfer_rows: inboundTransfers,
      outbound_transfer_rows: outboundTransfers,
      internal_movement_rows: internalMovements,
      unique_token_contracts: tokenContracts.size,
      most_recent_transfer_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
      trade_activity_claimed: false,
      economic_flow_claimed: false,
      direction_is_transfer_direction_only: true,
      route_decode_candidate_transactions: routeDecodeCandidateTransactions,
      route_decode_candidate_definition: "opposing_different_token_transfers_in_one_transaction",
      route_decode_candidate_is_trade_claimed: false,
      transaction_context_candidate_limit: MAX_TRANSACTION_CONTEXT_CANDIDATES,
      transaction_context_candidates_requested: transactionContexts.length,
      transaction_context_candidates_available: availableTransactionContexts,
      transaction_context_candidates_unavailable: transactionContexts.length - availableTransactionContexts,
      raven_decoded_trade_transactions: 0,
      copy_eligible_transactions: 0,
    },
    provider_balance_summary: {
      visible_balance_rows: balances.length,
      visible_priced_rows: pricedBalances.length,
      visible_unpriced_rows: balances.length - pricedBalances.length,
      visible_provider_mark_value_usd: pricedBalances.length ? visibleMarkedValue : null,
      largest_visible_provider_mark_symbol: largestVisibleBalance?.symbol || null,
      largest_visible_provider_mark_weight_pct: largestVisibleWeight,
      visible_rows_only: true,
      all_assets_enumerated: tokenWindowTruncated ? false : null,
      executable_value_claimed: false,
      portfolio_value_claimed: false,
    },
    research_thesis: null,
    profit_quality: { state: "insufficient_evidence" },
    positions: {
      known_cost_open_positions: [],
      known_cost_open_position_count: 0,
      unresolved_cost_basis_event_count: events.length,
      provider_reported_token_balances: balances,
      marked_values_available: balances.some((row) => row.provider_mark_value_usd !== null),
      executable_values_available: false,
    },
    capital_observations: {
      scope: "blockscout_indexed_snapshot",
      current_balance_claimed: false,
      native: {
        symbol: profile.native_symbol,
        amount: nativeAmount,
        amount_raw: nativeRaw,
        observed_at: observedAt,
        state: nativeAmount === null ? "unavailable" : "provider_indexed",
      },
      canonical_usdc: { amount: null, observed_at: null, state: "not_aggregated" },
      provider_reported_token_count: balances.length,
    },
    data_quality: {
      history_scope: "bounded_current_balances_and_recent_transfers",
      history_complete: false,
      provider_history_exhausted: false,
      provider: "blockscout_pro_v2",
      trade_decode_coverage_pct: null,
      transaction_context_coverage_pct: routeDecodeCandidateTransactions
        ? Number(((availableTransactionContexts / routeDecodeCandidateTransactions) * 100).toFixed(1))
        : null,
      classification_coverage_pct: null,
      cost_basis_coverage_pct: null,
      reconstruction_confidence_pct: null,
      full_data_confidence_pct: null,
      analysis_events: events.length,
      analysis_scope: "recent_erc20_transfers_only",
    },
    evidence_boundary: {
      on_demand_provider_scan: true,
      provider_reported_balances: true,
      transfers_treated_as_trades: false,
      marked_value_treated_as_executable: false,
      unknown_cost_basis_is_zero: false,
      copy_signal_created: false,
    },
  });
}

export async function inspectEvmWallet({
  chain,
  address,
  env = {},
  fetchImpl = globalThis.fetch,
  cache = null,
  now = new Date().toISOString(),
} = {}) {
  const runtime = resolveEvmWalletLookupRuntime(env, chain);
  if (!runtime.enabled) fail(`evm_wallet_lookup_${runtime.state}`, runtime.state === "unsupported" ? 400 : 503);
  if (typeof fetchImpl !== "function") fail("evm_wallet_provider_unavailable");
  const identity = normalizeSourceWalletChainIdentity({
    chain: runtime.profile.chain_namespace,
    network: "mainnet",
    chain_id: runtime.profile.chain_id,
    address,
  });
  const observedAt = timestamp(now);
  if (!observedAt) fail("evm_wallet_lookup_time_invalid", 400);
  const nowMs = Date.parse(observedAt);
  const cached = await readCache(cache, runtime.profile, identity, nowMs);
  if (cached) return cached;
  const apiKey = clean(env.BLOCKSCOUT_API_KEY, 256);
  const encoded = encodeURIComponent(identity.address);
  const requests = [
    `addresses/${encoded}`,
    `addresses/${encoded}/counters`,
    `addresses/${encoded}/tokens?type=ERC-20`,
    `addresses/${encoded}/token-transfers?type=ERC-20`,
  ].map((path) => boundedFetch(providerUrl(runtime.profile, path, apiKey), { fetchImpl }));
  const [info, counters, tokensPayload, transfersPayload] = await Promise.all(requests);
  if (addressHash(info?.hash) !== identity.address) fail("evm_wallet_provider_identity_mismatch", 409);
  const balances = tokenRows(tokensPayload, runtime.profile);
  const events = transferRows(transfersPayload, identity, runtime.profile, observedAt);
  const tokenWindowTruncated = Boolean(tokensPayload?.next_page_params);
  const transferWindowTruncated = Boolean(transfersPayload?.next_page_params);
  const candidateReferences = routeDecodeCandidateReferences(events);
  const transactionContexts = await transactionContextCandidates({
    references: candidateReferences,
    events,
    identity,
    profile: runtime.profile,
    apiKey,
    fetchImpl,
    observedAt,
  });
  const profile = basicProfile({
    identity,
    profile: runtime.profile,
    info,
    counters,
    balances,
    events,
    observedAt,
    tokenWindowTruncated,
    transferWindowTruncated,
    candidateReferences,
    transactionContexts,
  });
  const result = freeze({
    ok: true,
    schema_version: EVM_WALLET_LOOKUP_SCHEMA,
    state: "available",
    source_wallet_id: identity.source_wallet_id,
    profile,
    recent_events: events.slice(0, 12),
    transaction_decode_candidates: transactionContexts,
    activity: {
      schema_version: "ravenos.wallet_activity_page.v1",
      filter: "all",
      events: events.slice(0, 12),
      pagination: {
        limit: 12,
        returned: Math.min(12, events.length),
        matching_event_count: events.length,
        has_more: false,
        next_cursor: null,
        provider_has_more: transferWindowTruncated,
      },
      scope: {
        evidence_mode: "bounded_blockscout_index",
        provider_request_performed: true,
        on_demand_only: true,
        history_complete_claimed: false,
        current_balance_claimed: false,
      },
    },
    prospective_copyability: null,
    deep_history: {
      state: "not_enabled",
      chain: identity.chain,
      reason: `${identity.chain}_decoded_archive_backfill_not_connected`,
      signatures_indexed: 0,
      history_exhausted: false,
      history_complete_claimed: false,
    },
    persistence: {
      state: "on_demand_only",
      saved_to_raven_index: false,
      copy_eligible: false,
    },
    source: {
      provider: runtime.provider,
      chain_id: runtime.profile.chain_id,
      request_count: 4 + transactionContexts.length,
      maximum_rows_per_collection: 50,
      maximum_transaction_context_candidates: MAX_TRANSACTION_CONTEXT_CANDIDATES,
      token_balance_window_truncated: tokenWindowTruncated,
      token_transfer_window_truncated: transferWindowTruncated,
      api_key_exposed: false,
      delivery: "provider_live",
    },
  });
  await writeCache(cache, runtime.profile, identity, result);
  return result;
}

export const EvmWalletLookupChains = freeze(Object.keys(EVM_CHAIN_PROFILES));
