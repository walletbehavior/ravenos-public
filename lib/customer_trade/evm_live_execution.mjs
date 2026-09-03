import { createHash, randomBytes } from "node:crypto";

import {
  assertEvmZeroXQuoteFresh,
  EVM_ZERO_X_UNSIGNED_QUOTE_SCHEMA,
} from "./evm_zero_x_live_execution.mjs";
import {
  EVM_NATIVE_TOKEN_ADDRESS,
  evmChainProfileForOrder,
  resolveEvmChainProfile,
} from "./evm_chain_profiles.mjs";

export const EVM_LIVE_TICKET_SCHEMA = "ravenos.evm_live_ticket.v1";
export const EVM_LIVE_CLIENT_REPORT_SCHEMA = "ravenos.evm_live_client_report.v1";
export const EVM_LIVE_RECONCILIATION_SCHEMA = "ravenos.evm_live_reconciliation.v1";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
const HEX_QUANTITY_RE = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const NATIVE_EVM_ASSET = EVM_NATIVE_TOKEN_ADDRESS;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_TICKET_TTL_MS = 10_000;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function digest(value, field) {
  const normalized = clean(value, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function clean(value, maximum = 180) {
  return String(value ?? "").trim().slice(0, maximum);
}

function address(value, field, { native = false } = {}) {
  const normalized = clean(value, 42).toLowerCase();
  if (!ADDRESS_RE.test(normalized) || normalized === ZERO_ADDRESS || (!native && normalized === NATIVE_EVM_ASSET)) fail(`${field}_invalid`);
  return normalized;
}

function integerString(value, field, { positive = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(normalized) || (positive && normalized === "0")) fail(`${field}_invalid`);
  return BigInt(normalized).toString();
}

function timestamp(value, field) {
  const millis = Date.parse(String(value || ""));
  if (!Number.isFinite(millis)) fail(`${field}_invalid`);
  return { millis, iso: new Date(millis).toISOString() };
}

function quoteIdentity(quote, field, profile) {
  if (quote?.schema_version !== EVM_ZERO_X_UNSIGNED_QUOTE_SCHEMA
    || quote.profile_id !== profile.profile_id
    || quote.chain_namespace !== profile.chain_namespace
    || quote.chain_id !== profile.chain_id
    || quote.canonical_chain_id !== profile.canonical_chain_id
    || quote.ok !== true
    || quote.provider !== "0x_swap_api_v2") fail(`${field}_invalid`);
  const expiresAt = timestamp(quote.expires_at, `${field}_expiry`);
  const binding = quote.exact_binding || {};
  return freeze({
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    provider_quote_id: clean(quote.provider_quote_id, 160),
    quote_hash: digest(quote.quote_hash, `${field}_quote_hash`),
    request_hash: digest(quote.request_hash, `${field}_request_hash`),
    block_number: integerString(quote.block_number, `${field}_block`, { positive: true }),
    expires_at: expiresAt.iso,
    expires_at_ms: expiresAt.millis,
    taker: address(binding.taker, `${field}_taker`),
    sell_token: address(binding.sell_token, `${field}_sell_token`, { native: true }),
    buy_token: address(binding.buy_token, `${field}_buy_token`, { native: true }),
    sell_amount_base_units: integerString(binding.sell_amount_base_units, `${field}_sell_amount`, { positive: true }),
    buy_amount_base_units: integerString(binding.buy_amount_base_units, `${field}_buy_amount`, { positive: true }),
    minimum_buy_amount_base_units: integerString(binding.minimum_buy_amount_base_units, `${field}_minimum_buy`, { positive: true }),
  });
}

function exactMarket(value = {}, profile) {
  const poolAddress = address(value.pool_address, "evm_pool_address");
  const tokenAddress = address(value.token_address, "evm_token_address");
  const quoteAddress = address(value.quote_address, "evm_quote_address");
  const instrumentId = clean(value.instrument_id, 180);
  if (instrumentId !== `${profile.exact_market_prefix}${poolAddress}`) fail("evm_exact_market_identity_mismatch");
  const side = clean(value.side, 8).toLowerCase();
  if (!new Set(["buy", "sell"]).has(side)) fail("evm_side_invalid");
  return freeze({
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    instrument_id: instrumentId,
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_address: quoteAddress,
    symbol: clean(value.symbol || "TOKEN", 32),
    quote_symbol: clean(value.quote_symbol || "", 32),
    side,
  });
}

function feeFromQuote(quote, accountingAsset) {
  const fee = quote?.fee || {};
  if (typeof fee.enabled !== "boolean") fail("evm_fee_evidence_invalid");
  if (!fee.enabled) {
    if (Number(fee.fee_bps) !== 0 || String(fee.amount) !== "0" || fee.token !== null || fee.recipient !== null) {
      fail("evm_fee_evidence_invalid");
    }
    return freeze({
      enabled: false,
      fee_bps: 0,
      token: null,
      recipient: null,
      expected_amount_base_units: "0",
      accounting_amount_base_units: "0",
      collection_method: "none",
      collection_state: "disabled",
    });
  }
  const feeBps = Number(fee.fee_bps);
  if (!Number.isSafeInteger(feeBps) || feeBps < 1 || feeBps > 1_000) fail("evm_fee_bps_invalid");
  const token = address(fee.token, "evm_fee_token", { native: true });
  const recipient = address(fee.recipient, "evm_fee_recipient");
  const amount = integerString(fee.amount, "evm_fee_amount", { positive: true });
  return freeze({
    enabled: true,
    fee_bps: feeBps,
    token,
    recipient,
    expected_amount_base_units: amount,
    accounting_amount_base_units: token === accountingAsset ? amount : null,
    collection_method: "zero_x_integrator_fee",
    collection_state: "provider_quote_bound_expected",
  });
}

function noTransactionMaterial(value) {
  const serialized = JSON.stringify(value || {});
  if (/\"(?:data|unsigned_transaction|calldata|signed_transaction|private_key|signature)\"\s*:/i.test(serialized)) {
    fail("persisted_ticket_contains_transaction_material");
  }
}

export function createEvmLiveTicket(input = {}, { profile: profileSelector, now = Date.now(), ttl_ms: ttlMs = 8_000 } = {}) {
  let profile;
  try {
    profile = evmChainProfileForOrder(input.entry_quote || {}, profileSelector || input.exact_market?.profile_id);
  } catch (error) {
    fail(error?.code || "evm_chain_profile_not_supported");
  }
  assertEvmZeroXQuoteFresh(input.entry_quote, { profile, now });
  const market = exactMarket(input.exact_market, profile);
  const entry = quoteIdentity(input.entry_quote, "evm_entry_quote", profile);
  if (entry.expires_at_ms <= now + 1_000) fail("evm_entry_quote_expired");
  const walletAddress = address(input.wallet_address, "evm_wallet_address");
  if (entry.taker !== walletAddress) fail("evm_entry_wallet_mismatch");
  const accounting = freeze({
    asset_address: address(input.accounting?.asset_address, "evm_accounting_asset"),
    symbol: clean(input.accounting?.symbol, 16).toUpperCase(),
    decimals: Number(input.accounting?.decimals),
    representation: profile.accounting_asset.representation,
    issuer: profile.accounting_asset.issuer,
    circle_canonical_usdc: profile.accounting_asset.circle_canonical_usdc,
    notional_base_units: integerString(input.accounting?.notional_base_units, "evm_accounting_notional", { positive: true }),
    maximum_notional_base_units: integerString(input.accounting?.maximum_notional_base_units, "evm_accounting_maximum", { positive: true }),
  });
  if (
    accounting.asset_address !== profile.accounting_asset.address
    || accounting.symbol !== profile.accounting_asset.symbol
    || accounting.decimals !== profile.accounting_asset.decimals
  ) fail("evm_accounting_asset_not_supported");
  if (BigInt(accounting.notional_base_units) > BigInt(accounting.maximum_notional_base_units)) fail("evm_live_notional_out_of_bounds");
  if (entry.sell_token !== address(input.entry_quote?.exact_binding?.sell_token, "evm_entry_sell_token", { native: true })) {
    fail("evm_entry_identity_mismatch");
  }
  if (market.side === "buy" && entry.buy_token !== market.token_address) fail("evm_entry_identity_mismatch");
  if (market.side === "sell" && entry.sell_token !== market.token_address) fail("evm_entry_identity_mismatch");
  if (input.entry_quote?.wallet_handoff_eligible !== true || input.entry_quote?.state !== "awaiting_wallet_signature" || !input.entry_quote?.unsigned_transaction) {
    fail("evm_entry_not_wallet_handoff_eligible");
  }
  const reviewedTransactionHash = digest(input.entry_quote.reviewed_transaction_hash, "evm_reviewed_transaction_hash");
  const fee = feeFromQuote(input.entry_quote, accounting.asset_address);

  let exitProof = null;
  if (market.side === "buy") {
    const exit = quoteIdentity(input.exit_quote, "evm_exit_quote", profile);
    if (exit.expires_at_ms <= now + 1_000) fail("evm_exit_quote_expired");
    if (exit.taker !== walletAddress
      || exit.sell_token !== market.token_address
      || exit.buy_token !== accounting.asset_address
      || BigInt(exit.sell_amount_base_units) > BigInt(entry.buy_amount_base_units)
      || BigInt(exit.sell_amount_base_units) < BigInt(entry.minimum_buy_amount_base_units)) {
      fail("evm_exit_quote_identity_mismatch");
    }
    const blockers = Array.isArray(input.exit_quote?.blockers) ? input.exit_quote.blockers.map(String) : [];
    if (blockers.some((reason) => !new Set(["allowance_required", "insufficient_balance"]).has(reason))
      || input.exit_quote?.provider_issues?.simulation_incomplete === true
      || (input.exit_quote?.provider_issues?.invalid_sources || []).length) {
      fail("evm_exit_quote_unresolved");
    }
    exitProof = freeze({
      verified: true,
      provider: "0x_swap_api_v2",
      quote_hash: exit.quote_hash,
      provider_quote_id: exit.provider_quote_id,
      sell_token: exit.sell_token,
      buy_token: exit.buy_token,
      sell_amount_base_units: exit.sell_amount_base_units,
      expected_accounting_amount_base_units: exit.buy_amount_base_units,
      minimum_accounting_amount_base_units: exit.minimum_buy_amount_base_units,
      observed_at: clean(input.exit_quote.observed_at, 40),
      expires_at: exit.expires_at,
      current_wallet_blockers: freeze(blockers),
      blocker_semantics: blockers.length ? "future_position_not_currently_owned_or_approved" : "none",
    });
  }

  const transaction = { ...input.entry_quote.unsigned_transaction };
  const expiresAtMs = Math.min(
    entry.expires_at_ms,
    exitProof ? Date.parse(exitProof.expires_at) : Number.POSITIVE_INFINITY,
    now + Math.max(2_000, Math.min(MAX_TICKET_TTL_MS, Number(ttlMs) || 8_000)),
  );
  if (expiresAtMs <= now + 1_000) fail("evm_live_ticket_expired");
  const ticketId = `lex_${randomBytes(18).toString("base64url")}`;
  const createdAt = new Date(now).toISOString();
  const nonce = randomBytes(18).toString("base64url");
  const reviewedOrder = freeze({
    side: market.side,
    order_type: "market",
    sell_token: entry.sell_token,
    buy_token: entry.buy_token,
    sell_amount_base_units: entry.sell_amount_base_units,
    expected_buy_amount_base_units: entry.buy_amount_base_units,
    minimum_buy_amount_base_units: entry.minimum_buy_amount_base_units,
    accounting_asset_address: accounting.asset_address,
    accounting_asset_symbol: accounting.symbol,
    notional_accounting_base_units: accounting.notional_base_units,
  });
  const provider = freeze({
    venue: "zero_x",
    quote_id: entry.provider_quote_id,
    quote_hash: entry.quote_hash,
    block_number: entry.block_number,
  });
  const binding = {
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    wallet_address: walletAddress,
    exact_market: market,
    reviewed_order: reviewedOrder,
    provider,
    reviewed_transaction_hash: reviewedTransactionHash,
    accounting,
    fee,
    exit_proof: exitProof,
    created_at: createdAt,
    expires_at: new Date(expiresAtMs).toISOString(),
    nonce,
  };
  const ticket = freeze({
    ok: true,
    schema_version: EVM_LIVE_TICKET_SCHEMA,
    ticket_id: ticketId,
    state: "awaiting_wallet_signature",
    created_at: createdAt,
    expires_at: binding.expires_at,
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    wallet_chain_id_hex: profile.wallet_chain_id_hex,
    native_symbol: profile.native_symbol,
    wallet_address: walletAddress,
    exact_market: market,
    reviewed_order: reviewedOrder,
    provider,
    transaction: freeze({
      reviewed_transaction_hash: reviewedTransactionHash,
      to: address(transaction.to, "evm_transaction_to"),
      maximum_gas: integerString(transaction.gas, "evm_transaction_gas", { positive: true }),
      quoted_gas_price: transaction.gas_price === undefined
        ? null
        : integerString(transaction.gas_price, "evm_transaction_gas_price"),
      quoted_maximum_fee_per_gas: transaction.max_fee_per_gas === undefined
        ? null
        : integerString(transaction.max_fee_per_gas, "evm_transaction_max_fee_per_gas"),
      quoted_maximum_priority_fee_per_gas: transaction.max_priority_fee_per_gas === undefined
        ? null
        : integerString(transaction.max_priority_fee_per_gas, "evm_transaction_max_priority_fee_per_gas"),
      value: integerString(transaction.value, "evm_transaction_value"),
      input_data_sha256: createHash("sha256").update(String(transaction.data)).digest("hex"),
    }),
    accounting,
    fee,
    exit_proof: exitProof,
    binding_hash: hash(binding),
    execution_boundary: freeze({
      wallet_signature_required: true,
      signing_location: "connected_customer_wallet",
      submission_path: "wallet_direct_to_evm_chain",
      server_signing: false,
      private_key_received: false,
      custody: false,
      arbitrary_transaction_submission: false,
      exact_reviewed_transaction_only: true,
      autonomous_execution: false,
    }),
  });
  noTransactionMaterial(ticket);
  return freeze({ ticket, unsigned_transaction: transaction });
}

export function normalizeEvmClientExecutionReport(input = {}, expected = {}) {
  if (expected?.schema_version !== EVM_LIVE_TICKET_SCHEMA) fail("evm_live_ticket_invalid");
  const profile = resolveEvmChainProfile(expected.profile_id);
  if (
    expected.chain_namespace !== profile.chain_namespace
    || expected.chain_id !== profile.chain_id
    || expected.canonical_chain_id !== profile.canonical_chain_id
  ) fail("evm_live_ticket_chain_mismatch");
  const ticketId = clean(input.ticket_id, 100);
  if (ticketId !== expected.ticket_id || !ticketId.startsWith("lex_")) fail("evm_execution_ticket_mismatch");
  const walletAddress = address(input.wallet_address, "evm_execution_wallet");
  if (walletAddress !== expected.wallet_address) fail("evm_execution_wallet_mismatch");
  const reviewedHash = clean(input.reviewed_transaction_hash, 64).toLowerCase();
  if (reviewedHash !== expected.transaction?.reviewed_transaction_hash) fail("evm_execution_reviewed_transaction_mismatch");
  const transactionHash = clean(input.transaction_hash, 66).toLowerCase();
  if (!TX_HASH_RE.test(transactionHash) || /^0x0{64}$/.test(transactionHash)) fail("evm_execution_transaction_hash_invalid");
  return freeze({
    schema_version: EVM_LIVE_CLIENT_REPORT_SCHEMA,
    ticket_id: ticketId,
    venue: "zero_x",
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    wallet_address: walletAddress,
    reviewed_transaction_hash: reviewedHash,
    transaction_hash: transactionHash,
    state: "client_reported",
    evidence_state: "client_reported_pending_chain_reconciliation",
  });
}

function hexQuantity(value, field) {
  const normalized = clean(value, 80).toLowerCase();
  if (!HEX_QUANTITY_RE.test(normalized)) fail(`${field}_invalid`);
  return BigInt(normalized);
}

function logAddressTopic(value, field) {
  const normalized = clean(value, 66).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) fail(`${field}_invalid`);
  return `0x${normalized.slice(-40)}`;
}

function logAmountWord(value, field) {
  const normalized = clean(value, 66).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) fail(`${field}_invalid`);
  return BigInt(normalized);
}

function sumTransfers(logs, { token, from = null, to = null }) {
  if (token === NATIVE_EVM_ASSET) return null;
  let total = 0n;
  for (const log of Array.isArray(logs) ? logs : []) {
    if (clean(log?.address, 42).toLowerCase() !== token) continue;
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (clean(topics[0], 66).toLowerCase() !== TRANSFER_TOPIC || topics.length < 3) continue;
    let observedFrom;
    let observedTo;
    observedFrom = logAddressTopic(topics[1], "evm_transfer_from");
    observedTo = logAddressTopic(topics[2], "evm_transfer_to");
    if (from && observedFrom !== from) continue;
    if (to && observedTo !== to) continue;
    total += logAmountWord(log.data, "evm_transfer_amount");
  }
  return total;
}

export async function reconcileEvmExecution(input = {}, { rpc_client: rpcClient, now = Date.now(), minimum_confirmations: minimumConfirmations = 1 } = {}) {
  const ticket = input.ticket || {};
  const report = input.client_report || {};
  if (ticket.schema_version !== EVM_LIVE_TICKET_SCHEMA || report.schema_version !== EVM_LIVE_CLIENT_REPORT_SCHEMA) {
    fail("evm_reconciliation_input_invalid");
  }
  const profile = resolveEvmChainProfile(ticket.profile_id);
  if (
    ticket.chain_namespace !== profile.chain_namespace
    || ticket.chain_id !== profile.chain_id
    || ticket.canonical_chain_id !== profile.canonical_chain_id
    || report.profile_id !== profile.profile_id
    || report.chain_namespace !== profile.chain_namespace
    || report.chain_id !== profile.chain_id
    || report.canonical_chain_id !== profile.canonical_chain_id
  ) fail("evm_reconciliation_chain_mismatch");
  if (ticket.ticket_id !== report.ticket_id || ticket.wallet_address !== report.wallet_address) fail("evm_reconciliation_identity_mismatch");
  if (!rpcClient?.request) fail("evm_reconciliation_rpc_unavailable");
  const transactionHash = report.transaction_hash;
  const [transactionResult, receiptResult, headResult] = await Promise.all([
    rpcClient.request("eth_getTransactionByHash", [transactionHash]),
    rpcClient.request("eth_getTransactionReceipt", [transactionHash]),
    rpcClient.request("eth_blockNumber", []),
  ]);
  const transaction = transactionResult.result;
  const receipt = receiptResult.result;
  if (!transaction || !receipt) {
    return freeze({
      schema_version: EVM_LIVE_RECONCILIATION_SCHEMA,
      state: "indeterminate",
      transaction_hash: transactionHash,
      observed_at: new Date(now).toISOString(),
      evidence: { reason: "transaction_not_observed_yet", transaction_observed: Boolean(transaction), receipt_observed: Boolean(receipt) },
    });
  }
  const txFrom = address(transaction.from, "evm_chain_transaction_from");
  const txTo = address(transaction.to, "evm_chain_transaction_to");
  const inputData = clean(transaction.input || transaction.data, 131_074).toLowerCase();
  if (clean(transaction.hash, 66).toLowerCase() !== transactionHash
    || txFrom !== ticket.wallet_address
    || txTo !== ticket.transaction.to
    || createHash("sha256").update(inputData).digest("hex") !== ticket.transaction.input_data_sha256
    || hexQuantity(transaction.value, "evm_chain_transaction_value") !== BigInt(ticket.transaction.value)
    || hexQuantity(transaction.gas, "evm_chain_transaction_gas") > BigInt(ticket.transaction.maximum_gas)) {
    fail("evm_chain_transaction_binding_mismatch");
  }
  const receiptHash = clean(receipt.transactionHash, 66).toLowerCase();
  if (receiptHash !== transactionHash
    || address(receipt.from, "evm_receipt_from") !== ticket.wallet_address
    || address(receipt.to, "evm_receipt_to") !== ticket.transaction.to) {
    fail("evm_chain_receipt_binding_mismatch");
  }
  const status = hexQuantity(receipt.status, "evm_receipt_status");
  if (status === 0n) {
    return freeze({
      schema_version: EVM_LIVE_RECONCILIATION_SCHEMA,
      state: "provider_rejected",
      transaction_hash: transactionHash,
      observed_at: new Date(now).toISOString(),
      evidence: { reason: "transaction_reverted", block_number: receipt.blockNumber || null, fee_collection: { state: "failed", observed_amount_base_units: "0" } },
    });
  }
  if (status !== 1n) fail("evm_receipt_status_invalid");
  const receiptBlock = hexQuantity(receipt.blockNumber, "evm_receipt_block");
  const headBlock = hexQuantity(headResult.result, "evm_head_block");
  if (headBlock < receiptBlock) fail("evm_receipt_ahead_of_chain");
  const confirmations = headBlock - receiptBlock + 1n;
  const canonicalBlockResult = await rpcClient.request("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const canonicalHash = clean(canonicalBlockResult.result?.hash, 66).toLowerCase();
  const receiptBlockHash = clean(receipt.blockHash, 66).toLowerCase();
  if (!TX_HASH_RE.test(canonicalHash) || canonicalHash !== receiptBlockHash) {
    return freeze({
      schema_version: EVM_LIVE_RECONCILIATION_SCHEMA,
      state: "indeterminate",
      transaction_hash: transactionHash,
      observed_at: new Date(now).toISOString(),
      evidence: { reason: "canonical_block_unresolved", receipt_block_hash: receiptBlockHash, canonical_block_hash: canonicalHash || null },
    });
  }
  const requiredConfirmations = BigInt(Math.max(1, Math.min(64, Number(minimumConfirmations) || 1)));
  if (confirmations < requiredConfirmations) {
    return freeze({
      schema_version: EVM_LIVE_RECONCILIATION_SCHEMA,
      state: "indeterminate",
      transaction_hash: transactionHash,
      observed_at: new Date(now).toISOString(),
      evidence: { reason: "confirmation_depth_pending", confirmations: confirmations.toString(), required_confirmations: requiredConfirmations.toString() },
    });
  }

  const wallet = ticket.wallet_address;
  const reviewed = ticket.reviewed_order;
  const sellDebit = reviewed.sell_token === NATIVE_EVM_ASSET
    ? BigInt(ticket.transaction.value)
    : sumTransfers(receipt.logs, { token: reviewed.sell_token, from: wallet });
  const buyCredit = reviewed.buy_token === NATIVE_EVM_ASSET
    ? null
    : sumTransfers(receipt.logs, { token: reviewed.buy_token, to: wallet });
  const economicReasons = [];
  if (sellDebit !== null && sellDebit < BigInt(reviewed.sell_amount_base_units)) economicReasons.push("sell_debit_below_reviewed_amount");
  if (buyCredit !== null && buyCredit < BigInt(reviewed.minimum_buy_amount_base_units)) economicReasons.push("buy_credit_below_minimum");
  if (buyCredit === null) economicReasons.push("native_buy_credit_requires_trace_or_balance_delta");

  let feeCollection;
  if (!ticket.fee.enabled) {
    feeCollection = { state: "disabled", token: null, expected_amount_base_units: "0", observed_amount_base_units: "0" };
  } else if (ticket.fee.token === NATIVE_EVM_ASSET) {
    feeCollection = {
      state: "expected",
      token: NATIVE_EVM_ASSET,
      expected_amount_base_units: ticket.fee.expected_amount_base_units,
      observed_amount_base_units: null,
      reason: "native_internal_transfer_not_provable_from_standard_receipt",
    };
  } else {
    const observedFee = sumTransfers(receipt.logs, { token: ticket.fee.token, to: ticket.fee.recipient });
    feeCollection = {
      state: observedFee === BigInt(ticket.fee.expected_amount_base_units) ? "observed" : "indeterminate",
      token: ticket.fee.token,
      expected_amount_base_units: ticket.fee.expected_amount_base_units,
      observed_amount_base_units: observedFee.toString(),
      reason: observedFee === BigInt(ticket.fee.expected_amount_base_units) ? null : "fee_transfer_amount_mismatch",
    };
  }
  const gasUsed = hexQuantity(receipt.gasUsed, "evm_receipt_gas_used");
  const effectiveGasPrice = hexQuantity(receipt.effectiveGasPrice || transaction.gasPrice || "0x0", "evm_receipt_effective_gas_price");
  const economicResultVerified = economicReasons.length === 0;
  return freeze({
    schema_version: EVM_LIVE_RECONCILIATION_SCHEMA,
    state: economicResultVerified ? "provider_confirmed" : "indeterminate",
    transaction_hash: transactionHash,
    observed_at: new Date(now).toISOString(),
    evidence: {
      provider: transactionResult.provider_id,
      profile_id: profile.profile_id,
      chain_namespace: profile.chain_namespace,
      chain_id: profile.chain_id,
      canonical_chain_id: profile.canonical_chain_id,
      block_number: receiptBlock.toString(),
      block_hash: receiptBlockHash,
      confirmations: confirmations.toString(),
      finality_state: "canonical_confirmation",
      finalized: false,
      finality_claim: "confirmation_depth_only",
      economic_result_verified: economicResultVerified,
      economic_unresolved_reasons: economicReasons,
      sell_debit_base_units: sellDebit === null ? null : sellDebit.toString(),
      buy_credit_base_units: buyCredit === null ? null : buyCredit.toString(),
      gas_used: gasUsed.toString(),
      effective_gas_price: effectiveGasPrice.toString(),
      network_fee_native_base_units: (gasUsed * effectiveGasPrice).toString(),
      fee_collection: feeCollection,
    },
  });
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function exactBaseUnitsToDisplayNumber(value, decimals) {
  if (value === null || value === undefined) return null;
  const raw = integerString(value, "evm_accounting_display_amount");
  const places = Number(decimals);
  if (!Number.isSafeInteger(places) || places < 0 || places > 18) return null;
  const padded = raw.padStart(places + 1, "0");
  const split = padded.length - places;
  const whole = places ? padded.slice(0, split) : padded;
  const fraction = places ? padded.slice(split).replace(/0+$/, "") : "";
  const result = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(result) && result <= 1_000_000 ? result : null;
}

export function createD1EvmLiveExecutionStore(db, { profile: profileSelector } = {}) {
  if (!db?.prepare) fail("live_execution_store_unavailable");
  const profile = resolveEvmChainProfile(profileSelector);
  const appendEvent = async ({ executionId, state, evidence, nowSeconds }) => {
    noTransactionMaterial(evidence);
    await db.prepare(`
      INSERT INTO ravenos_customer_live_execution_events
        (event_id, execution_id, state, evidence_json, observed_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`lee_${randomBytes(18).toString("base64url")}`, executionId, clean(state, 40), JSON.stringify(evidence || {}), nowSeconds).run();
  };
  return freeze({
    async createTicket({ prepared, user_id: userId, now_seconds: nowSeconds }) {
      const ticket = prepared?.ticket;
      if (
        ticket?.schema_version !== EVM_LIVE_TICKET_SCHEMA
        || ticket.profile_id !== profile.profile_id
        || ticket.chain_namespace !== profile.chain_namespace
      ) fail("evm_live_ticket_invalid");
      noTransactionMaterial(ticket);
      const expectedFeeAccounting = exactBaseUnitsToDisplayNumber(
        ticket.fee.accounting_amount_base_units,
        ticket.accounting.decimals,
      );
      await db.prepare(`
        INSERT INTO ravenos_customer_live_execution_intents
          (execution_id, schema_version, user_id, venue, chain_namespace, wallet_address, exact_market_id,
           side, order_type, notional_usdc, raven_fee_bps, expected_raven_fee_usdc, observed_raven_fee_usdc,
           fee_token, fee_recipient, fee_collection_method, fee_collection_status, state,
           prepared_payload_hash, provider_request_id, prepared_json, expires_at, created_at, updated_at,
           accounting_asset_address, notional_accounting_base_units, expected_raven_fee_amount_base_units,
           observed_raven_fee_amount_base_units, transaction_hash, entry_quote_hash, exit_quote_hash)
        VALUES (?, ?, ?, 'zero_x', ?, ?, ?, ?, 'market', NULL, ?, ?, NULL, ?, ?, ?, ?,
                'awaiting_wallet_signature', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).bind(
        ticket.ticket_id,
        EVM_LIVE_TICKET_SCHEMA,
        userId,
        profile.chain_namespace,
        ticket.wallet_address,
        ticket.exact_market.instrument_id,
        ticket.reviewed_order.side,
        ticket.fee.fee_bps,
        Number.isFinite(expectedFeeAccounting) ? expectedFeeAccounting : null,
        ticket.fee.token,
        ticket.fee.recipient,
        ticket.fee.collection_method,
        ticket.fee.enabled ? "expected" : "disabled",
        ticket.binding_hash,
        ticket.provider.quote_id,
        JSON.stringify(ticket),
        Math.floor(Date.parse(ticket.expires_at) / 1000),
        nowSeconds,
        nowSeconds,
        ticket.accounting.asset_address,
        ticket.accounting.notional_base_units,
        ticket.fee.expected_amount_base_units,
        ticket.provider.quote_hash,
        ticket.exit_proof?.quote_hash || null,
      ).run();
      await appendEvent({
        executionId: ticket.ticket_id,
        state: "awaiting_wallet_signature",
        evidence: { binding_hash: ticket.binding_hash, reviewed_transaction_hash: ticket.transaction.reviewed_transaction_hash, quote_hash: ticket.provider.quote_hash },
        nowSeconds,
      });
      return prepared;
    },
    async findTicket(executionId, userId) {
      const row = await db.prepare(`
        SELECT execution_id, user_id, venue, chain_namespace, wallet_address, exact_market_id, state,
               prepared_payload_hash, provider_request_id, prepared_json, transaction_hash,
               expires_at, created_at, updated_at
        FROM ravenos_customer_live_execution_intents
        WHERE execution_id = ? AND user_id = ? AND venue = 'zero_x' AND chain_namespace = ?
      `).bind(clean(executionId, 100), clean(userId, 160), profile.chain_namespace).first();
      return row ? freeze({ ...row, prepared: JSON.parse(row.prepared_json) }) : null;
    },
    async recordClientReport({ record, user_id: userId, now_seconds: nowSeconds }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = 'client_reported', transaction_hash = ?, updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND venue = 'zero_x' AND chain_namespace = ?
          AND state = 'awaiting_wallet_signature' AND expires_at >= ? AND transaction_hash IS NULL
      `).bind(record.transaction_hash, nowSeconds, record.ticket_id, userId, profile.chain_namespace, nowSeconds).run();
      if (changes(result) !== 1) fail("evm_execution_ticket_not_reportable");
      await appendEvent({ executionId: record.ticket_id, state: "client_reported", evidence: record, nowSeconds });
      return record;
    },
    async reconcile({ execution_id: executionId, user_id: userId, reconciliation, now_seconds: nowSeconds }) {
      const pendingReason = new Set([
        "transaction_not_observed_yet",
        "confirmation_depth_pending",
        "canonical_block_unresolved",
        "finality_pending",
        "provider_finality_unavailable",
      ]).has(String(reconciliation?.evidence?.reason || ""));
      const nextState = pendingReason
        ? "reconciliation_pending"
        : new Set(["provider_confirmed", "provider_rejected", "indeterminate"]).has(reconciliation?.state)
          ? reconciliation.state
          : "indeterminate";
      const feeEvidence = reconciliation?.evidence?.fee_collection || {};
      const feeStatus = new Set(["disabled", "expected", "observed", "failed", "indeterminate"]).has(feeEvidence.state)
        ? feeEvidence.state
        : "indeterminate";
      const result = await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = ?, fee_collection_status = ?, observed_raven_fee_amount_base_units = ?, updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND venue = 'zero_x' AND chain_namespace = ?
          AND state IN ('client_reported', 'reconciliation_pending')
      `).bind(
        nextState,
        feeStatus,
        feeEvidence.observed_amount_base_units ?? null,
        nowSeconds,
        executionId,
        userId,
        profile.chain_namespace,
      ).run();
      if (changes(result) !== 1) fail("evm_execution_not_reconcilable");
      await appendEvent({ executionId, state: nextState, evidence: reconciliation, nowSeconds });
      return freeze({ state: nextState, retryable: pendingReason, reconciliation });
    },
  });
}
