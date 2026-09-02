import { createHash, randomBytes } from "node:crypto";

import bs58 from "bs58";
import nacl from "tweetnacl";

import { decodeSolanaTransaction } from "./solana_transaction_decoder.mjs";
import {
  SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA,
  SOLANA_USDC_MINT,
  SOLANA_WRAPPED_MINT,
} from "./operator_solana_canary.mjs";

export const SOLANA_LIVE_TICKET_SCHEMA = "ravenos.solana_live_ticket.v1";
export const SOLANA_LIVE_EXECUTION_RESULT_SCHEMA = "ravenos.solana_live_execution_result.v1";

const JUPITER_EXECUTE_ENDPOINT = "https://api.jup.ag/swap/v2/execute";
const MAX_TICKET_TTL_MS = 10_000;
const MAX_PROVIDER_RESPONSE_BYTES = 96 * 1024;
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_TRANSACTION_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function clean(value, maximum = 180) {
  return String(value ?? "").trim().slice(0, maximum);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hash(value) {
  const material = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value
    : typeof value === "string"
      ? value
      : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(material).digest("hex");
}

function publicKey(value, field) {
  const address = clean(value, 64);
  try {
    if (!SOLANA_ADDRESS_RE.test(address) || bs58.decode(address).length !== 32) fail(`${field}_invalid`);
  } catch {
    fail(`${field}_invalid`);
  }
  return address;
}

function transactionSignature(value, field) {
  const signature = clean(value, 100);
  try {
    if (!SOLANA_TRANSACTION_SIGNATURE_RE.test(signature) || bs58.decode(signature).length !== 64) fail(`${field}_invalid`);
  } catch {
    fail(`${field}_invalid`);
  }
  return signature;
}

function unsignedInteger(value, field) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`${field}_invalid`);
  return BigInt(raw);
}

function finite(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function boundedBase64(value, field) {
  const raw = clean(value, 4_000);
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail(`${field}_invalid`);
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.length || decoded.length > 1_232 || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    fail(`${field}_invalid`);
  }
  return decoded.toString("base64");
}

function safeEndpoint(value, field, { host, pathname } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    fail(`${field}_invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail(`${field}_invalid`);
  if (host && url.hostname !== host) fail(`${field}_invalid`);
  if (pathname && url.pathname !== pathname) fail(`${field}_invalid`);
  return url;
}

function apiCredential(value) {
  const credential = String(value ?? "").trim();
  if (!credential || credential.length > 512 || !/^[\x21-\x7e]+$/.test(credential)) fail("jupiter_api_key_required");
  return credential;
}

async function boundedJson(response, maximumBytes, field) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) fail(`${field}_too_large`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) fail(`${field}_too_large`);
  try {
    return JSON.parse(text);
  } catch {
    fail(`${field}_invalid_json`);
  }
}

function noTransactionMaterial(value) {
  const serialized = JSON.stringify(value || {});
  if (/unsigned_transaction_base64|signed_transaction_base64|signedTransaction/i.test(serialized)) {
    fail("persisted_ticket_contains_transaction_material");
  }
}

export function createSolanaLiveTicket(input = {}, { now = Date.now(), ttl_ms: ttlMs = 8_000 } = {}) {
  const preflight = input.preflight && typeof input.preflight === "object" ? input.preflight : {};
  if (preflight.schema_version !== SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA
    || preflight.ok !== true
    || preflight.state !== "customer_unsigned_transaction_reviewed") {
    fail("customer_solana_preflight_required");
  }
  const walletAddress = publicKey(preflight.wallet?.address, "wallet_address");
  if (preflight.wallet?.role !== "customer") fail("customer_wallet_role_required");
  const unsignedTransaction = boundedBase64(preflight.unsigned_transaction_base64, "unsigned_transaction");
  const decoded = decodeSolanaTransaction(unsignedTransaction);
  if (decoded.signatures.some((signature) => signature.populated)) fail("unsigned_transaction_signature_present");
  if (decoded.message_hash !== clean(preflight.transaction_review?.message_hash, 64)
    || decoded.transaction_hash !== clean(preflight.transaction_review?.transaction_hash, 64)) {
    fail("preflight_transaction_hash_mismatch");
  }
  if (decoded.static_account_keys[0] !== walletAddress || decoded.header.required_signatures !== 1) {
    fail("transaction_signer_set_mismatch");
  }
  const intent = preflight.intent || {};
  if (intent.wallet_address !== walletAddress || intent.message_hash !== decoded.message_hash) fail("preflight_intent_mismatch");
  const notionalUsdc = finite(input.notional_usdc, "notional_usdc");
  const maximumNotionalUsdc = finite(input.maximum_notional_usdc, "maximum_notional_usdc");
  if (!(notionalUsdc >= 1) || notionalUsdc > maximumNotionalUsdc) fail("live_notional_out_of_bounds");
  const side = clean(intent.side, 12).toLowerCase();
  if (!new Set(["buy", "sell"]).has(side)) fail("side_invalid");
  const exitProof = input.exit_proof && typeof input.exit_proof === "object" ? input.exit_proof : null;
  if (side === "buy" && (exitProof?.verified !== true || exitProof?.settlement_mint !== SOLANA_USDC_MINT)) {
    fail("live_exit_proof_required");
  }
  const providerExpiry = Date.parse(preflight.quote?.expires_at || "");
  const boundedTtl = Math.max(2_000, Math.min(MAX_TICKET_TTL_MS, Number(ttlMs) || 8_000));
  const expiresAtMs = Math.min(now + boundedTtl, Number.isFinite(providerExpiry) ? providerExpiry : now + boundedTtl);
  if (expiresAtMs <= now + 1_000) fail("preflight_quote_expired");
  const ticketId = `lex_${randomBytes(18).toString("base64url")}`;
  const transaction = Object.freeze({
    message_hash: decoded.message_hash,
    unsigned_transaction_hash: decoded.transaction_hash,
    recent_blockhash: decoded.recent_blockhash,
    last_valid_block_height: clean(preflight.quote?.last_valid_block_height, 32),
    maximum_native_debit_lamports: clean(preflight.simulation?.native_balance_evidence?.maximum_allowed_debit_lamports, 40),
    total_estimated_fee_lamports: clean(preflight.quote?.total_estimated_fee_lamports, 40),
    fee_payer: walletAddress,
    required_signer: walletAddress,
  });
  const binding = Object.freeze({
    ticket_id: ticketId,
    wallet_address: walletAddress,
    instrument_id: clean(intent.terminal_instrument_id, 180),
    pool_address: publicKey(intent.terminal_pool_address, "pool_address"),
    side,
    input_mint: publicKey(intent.input_mint, "input_mint"),
    output_mint: publicKey(intent.output_mint, "output_mint"),
    input_amount_base_units: unsignedInteger(intent.input_amount_base_units, "input_amount").toString(),
    minimum_output_amount_base_units: unsignedInteger(intent.minimum_output_amount_base_units, "minimum_output").toString(),
    provider_request_id: clean(intent.provider_request_id, 160),
    transaction,
    expires_at: new Date(expiresAtMs).toISOString(),
  });
  if (!binding.provider_request_id) fail("provider_request_id_missing");
  const ticket = Object.freeze({
    ok: true,
    schema_version: SOLANA_LIVE_TICKET_SCHEMA,
    ticket_id: ticketId,
    state: "awaiting_wallet_signature",
    created_at: new Date(now).toISOString(),
    expires_at: binding.expires_at,
    wallet_address: walletAddress,
    exact_market: Object.freeze({
      instrument_id: binding.instrument_id,
      pool_address: binding.pool_address,
      selected_token_mint: publicKey(intent.selected_token_mint, "selected_token_mint"),
    }),
    reviewed_order: Object.freeze({
      side,
      order_type: "market",
      funding_kind: clean(intent.funding_kind, 32),
      settlement_kind: clean(intent.settlement_kind, 32),
      input_mint: binding.input_mint,
      output_mint: binding.output_mint,
      input_amount_base_units: binding.input_amount_base_units,
      expected_output_amount_base_units: clean(intent.expected_output_amount_base_units, 80),
      minimum_output_amount_base_units: binding.minimum_output_amount_base_units,
      notional_usdc: Number(notionalUsdc.toFixed(6)),
      slippage_bps: Number(intent.slippage_bps),
    }),
    transaction,
    provider: Object.freeze({
      venue: "jupiter",
      router: clean(intent.router, 32),
      request_id: binding.provider_request_id,
      submission: "raven_forwards_wallet_signed_reviewed_transaction",
    }),
    exit_proof: exitProof ? Object.freeze({
      verified: exitProof.verified === true,
      settlement_mint: publicKey(exitProof.settlement_mint, "exit_settlement_mint"),
      expected_usdc_base_units: clean(exitProof.expected_usdc_base_units, 80),
      minimum_usdc_base_units: clean(exitProof.minimum_usdc_base_units, 80),
      observed_at: clean(exitProof.observed_at, 40),
      expires_at: clean(exitProof.expires_at, 40),
      provider: clean(exitProof.provider, 40),
    }) : null,
    fee: Object.freeze({
      raven_fee_enabled: false,
      raven_fee_bps: 0,
      estimated_raven_fee_usdc: 0,
      fee_token: null,
      collection_method: "none",
      collector_configured: input.fee_collector_configured === true,
      hypothetical_only: false,
    }),
    binding_hash: hash(binding),
    execution_boundary: Object.freeze({
      wallet_signature_required: true,
      signing_location: "connected_browser_wallet",
      server_signing: false,
      private_key_received: false,
      custody: false,
      arbitrary_transaction_submission: false,
      exact_reviewed_transaction_only: true,
      agentic_execution: false,
    }),
  });
  noTransactionMaterial(ticket);
  return Object.freeze({ ticket, unsigned_transaction_base64: unsignedTransaction });
}

export function verifySolanaSignedTransaction(input = {}, expected = {}) {
  if (expected?.schema_version !== SOLANA_LIVE_TICKET_SCHEMA) fail("live_ticket_schema_invalid");
  if (Date.parse(expected.expires_at || "") <= Date.now()) fail("live_ticket_expired");
  const signedBase64 = boundedBase64(input.signed_transaction_base64, "signed_transaction");
  const decoded = decodeSolanaTransaction(signedBase64);
  const walletAddress = publicKey(expected.wallet_address, "wallet_address");
  if (decoded.message_hash !== expected.transaction?.message_hash) fail("signed_transaction_message_mismatch");
  if (decoded.recent_blockhash !== expected.transaction?.recent_blockhash) fail("signed_transaction_blockhash_mismatch");
  if (decoded.header.required_signatures !== 1 || decoded.static_account_keys[0] !== walletAddress) {
    fail("signed_transaction_signer_set_mismatch");
  }
  if (decoded.signatures.length !== 1 || decoded.signatures[0]?.populated !== true) fail("wallet_signature_missing");
  const signatureBytes = decoded.raw_bytes.subarray(decoded.signature_offset, decoded.signature_offset + 64);
  if (!nacl.sign.detached.verify(decoded.message_bytes, signatureBytes, bs58.decode(walletAddress))) {
    fail("wallet_signature_invalid");
  }
  return Object.freeze({
    schema_version: "ravenos.solana_signed_transaction_verification.v1",
    ticket_id: expected.ticket_id,
    wallet_address: walletAddress,
    message_hash: decoded.message_hash,
    signed_transaction_hash: decoded.transaction_hash,
    wallet_signature: decoded.signatures[0].signature_base58,
    signed_transaction_base64: signedBase64,
  });
}

export async function executeJupiterSignedTransaction(input = {}, {
  jupiter_api_key: apiKey = "",
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = 8_000,
  endpoint = JUPITER_EXECUTE_ENDPOINT,
} = {}) {
  const verified = input.verified || {};
  const ticket = input.ticket || {};
  if (verified.ticket_id !== ticket.ticket_id || verified.message_hash !== ticket.transaction?.message_hash) {
    fail("verified_transaction_ticket_mismatch");
  }
  const url = safeEndpoint(endpoint, "jupiter_execute_endpoint", { host: "api.jup.ag", pathname: "/swap/v2/execute" });
  const credential = apiCredential(apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-api-key": credential },
      body: JSON.stringify({
        signedTransaction: verified.signed_transaction_base64,
        requestId: ticket.provider?.request_id,
        lastValidBlockHeight: Number(ticket.transaction?.last_valid_block_height),
      }),
      signal: controller.signal,
    });
    const payload = await boundedJson(response, MAX_PROVIDER_RESPONSE_BYTES, "jupiter_execute_response");
    const status = clean(payload?.status, 40).toLowerCase();
    const signature = payload?.signature ? transactionSignature(payload.signature, "provider_signature") : null;
    if (!response.ok) fail("jupiter_execute_http_error", { status: response.status, code: payload?.code ?? null });
    if (!new Set(["success", "failed"]).has(status)) fail("jupiter_execute_status_invalid");
    if (status === "success" && !signature) fail("jupiter_execute_signature_missing");
    return Object.freeze({
      schema_version: "ravenos.jupiter_execute_observation.v1",
      state: status === "success" ? "provider_submitted" : "provider_rejected",
      provider: "jupiter",
      signature,
      slot: Number.isSafeInteger(Number(payload?.slot)) ? Number(payload.slot) : null,
      error_code: payload?.code == null ? null : clean(payload.code, 80),
      error_message: status === "failed" ? clean(payload?.error || payload?.message, 240) || "provider_rejected" : null,
      input_amount_result: clean(payload?.inputAmountResult, 80) || null,
      output_amount_result: clean(payload?.outputAmountResult, 80) || null,
      observed_at: new Date().toISOString(),
    });
  } catch (error) {
    if (controller.signal.aborted) fail("jupiter_execute_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(rpcUrl, method, params, { fetchImpl, timeoutMs }) {
  const endpoint = safeEndpoint(rpcUrl, "solana_rpc_url");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ravenos-live-reconcile", method, params }),
      signal: controller.signal,
    });
    const payload = await boundedJson(response, MAX_RPC_RESPONSE_BYTES, `rpc_${method}`);
    if (!response.ok || payload?.error || !Object.hasOwn(payload || {}, "result")) fail(`rpc_${method}_failed`);
    return payload.result;
  } catch (error) {
    if (controller.signal.aborted) fail(`rpc_${method}_timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function rawTokenAmount(row) {
  const value = String(row?.uiTokenAmount?.amount ?? "");
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : 0n;
}

function tokenBalance(rows, owner, mint) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => (
    row?.owner === owner && row?.mint === mint ? sum + rawTokenAmount(row) : sum
  ), 0n);
}

function economicTransactionEvidence(transaction, ticket) {
  const meta = transaction?.meta;
  if (!meta || meta.err !== null) fail("settled_transaction_failed");
  const keys = (transaction?.transaction?.message?.accountKeys || []).map((row) => String(row?.pubkey || row || ""));
  const walletIndex = keys.indexOf(ticket.wallet_address);
  if (walletIndex < 0) fail("settled_wallet_not_observed");
  const preLamports = BigInt(meta.preBalances?.[walletIndex] ?? -1);
  const postLamports = BigInt(meta.postBalances?.[walletIndex] ?? -1);
  if (preLamports < 0n || postLamports < 0n) fail("settled_native_balance_unavailable");
  const reviewed = ticket.reviewed_order;
  const selectedMint = ticket.exact_market.selected_token_mint;
  const selectedPre = tokenBalance(meta.preTokenBalances, ticket.wallet_address, selectedMint);
  const selectedPost = tokenBalance(meta.postTokenBalances, ticket.wallet_address, selectedMint);
  const inputAmount = unsignedInteger(reviewed.input_amount_base_units, "reviewed_input_amount");
  const minimumOutput = unsignedInteger(reviewed.minimum_output_amount_base_units, "reviewed_minimum_output");
  if (reviewed.side === "buy") {
    if (selectedPost - selectedPre < minimumOutput) fail("settled_selected_token_below_minimum");
  } else if (selectedPre - selectedPost !== inputAmount) {
    fail("settled_selected_token_debit_mismatch");
  }
  const usdcPre = tokenBalance(meta.preTokenBalances, ticket.wallet_address, SOLANA_USDC_MINT);
  const usdcPost = tokenBalance(meta.postTokenBalances, ticket.wallet_address, SOLANA_USDC_MINT);
  if (reviewed.input_mint === SOLANA_USDC_MINT && usdcPre - usdcPost !== inputAmount) fail("settled_usdc_debit_mismatch");
  if (reviewed.output_mint === SOLANA_USDC_MINT && usdcPost - usdcPre < minimumOutput) fail("settled_usdc_credit_below_minimum");
  const nativeDebit = preLamports > postLamports ? preLamports - postLamports : 0n;
  const nativeCredit = postLamports > preLamports ? postLamports - preLamports : 0n;
  const feeBound = unsignedInteger(ticket.transaction?.maximum_native_debit_lamports ?? "0", "maximum_native_debit");
  if (reviewed.input_mint === SOLANA_WRAPPED_MINT && (nativeDebit < inputAmount || nativeDebit > feeBound)) {
    fail("settled_native_debit_out_of_bounds");
  }
  if (reviewed.input_mint !== SOLANA_WRAPPED_MINT && nativeDebit > feeBound) fail("settled_native_fee_out_of_bounds");
  if (reviewed.output_mint === SOLANA_WRAPPED_MINT) {
    const fees = unsignedInteger(ticket.transaction?.total_estimated_fee_lamports ?? "0", "estimated_fees");
    const minimumNet = minimumOutput > fees ? minimumOutput - fees : 0n;
    if (nativeCredit < minimumNet) fail("settled_native_credit_below_minimum");
  }
  return Object.freeze({
    slot: Number(transaction.slot),
    block_time: Number.isSafeInteger(Number(transaction.blockTime)) ? Number(transaction.blockTime) : null,
    fee_lamports: String(meta.fee),
    selected_token_delta_base_units: reviewed.side === "buy"
      ? (selectedPost - selectedPre).toString()
      : (selectedPre - selectedPost).toString(),
    usdc_delta_base_units: (usdcPost - usdcPre).toString(),
    native_debit_lamports: nativeDebit.toString(),
    native_credit_lamports: nativeCredit.toString(),
  });
}

export async function reconcileSolanaExecution(input = {}, {
  rpc_url: rpcUrl,
  fetch_impl: fetchImpl = globalThis.fetch,
  timeout_ms: timeoutMs = 6_000,
} = {}) {
  const ticket = input.ticket || {};
  const provider = input.provider_observation || {};
  if (provider.state === "provider_rejected") {
    return Object.freeze({ state: "provider_rejected", signature: provider.signature || null, evidence: provider });
  }
  const signature = transactionSignature(provider.signature, "provider_signature");
  const statuses = await rpcCall(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }], { fetchImpl, timeoutMs });
  const status = statuses?.value?.[0];
  if (!status) return Object.freeze({ state: "indeterminate", signature, evidence: { reason: "signature_not_observed_yet" } });
  if (status.err) return Object.freeze({ state: "provider_rejected", signature, evidence: { reason: "transaction_failed", error: status.err } });
  if (!new Set(["confirmed", "finalized"]).has(status.confirmationStatus)) {
    return Object.freeze({ state: "indeterminate", signature, evidence: { reason: "transaction_not_confirmed", confirmation_status: status.confirmationStatus || null } });
  }
  const transaction = await rpcCall(rpcUrl, "getTransaction", [signature, {
    commitment: "confirmed",
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
  }], { fetchImpl, timeoutMs });
  if (!transaction) return Object.freeze({ state: "indeterminate", signature, evidence: { reason: "confirmed_transaction_not_available" } });
  try {
    const economic = economicTransactionEvidence(transaction, ticket);
    return Object.freeze({
      state: "provider_confirmed",
      signature,
      evidence: Object.freeze({
        provider: "solana_rpc",
        confirmation_status: status.confirmationStatus,
        confirmations: status.confirmations,
        economic_result_verified: true,
        ...economic,
      }),
    });
  } catch (error) {
    return Object.freeze({
      state: "indeterminate",
      signature,
      evidence: { reason: error?.code || error?.message || "economic_result_unresolved", economic_result_verified: false },
    });
  }
}

export function createD1SolanaLiveExecutionStore(db) {
  if (!db?.prepare) fail("live_execution_store_unavailable");
  const appendEvent = async ({ executionId, state, evidence, nowSeconds }) => {
    noTransactionMaterial(evidence);
    await db.prepare(`
      INSERT INTO ravenos_customer_live_execution_events
        (event_id, execution_id, state, evidence_json, observed_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      `lee_${randomBytes(18).toString("base64url")}`,
      executionId,
      clean(state, 40),
      JSON.stringify(evidence || {}),
      nowSeconds,
    ).run();
  };
  return Object.freeze({
    async createTicket({ ticket, user_id: userId, now_seconds: nowSeconds }) {
      noTransactionMaterial(ticket);
      await db.prepare(`
        INSERT INTO ravenos_customer_live_execution_intents
          (execution_id, schema_version, user_id, venue, chain_namespace, wallet_address, exact_market_id,
           side, order_type, notional_usdc, raven_fee_bps, expected_raven_fee_usdc, observed_raven_fee_usdc,
           fee_token, fee_recipient, fee_collection_method, fee_collection_status,
           state, prepared_payload_hash, provider_request_id,
           prepared_json, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'jupiter', 'solana', ?, ?, ?, 'market', ?, 0, 0, NULL,
                NULL, NULL, 'none', 'disabled', 'awaiting_wallet_signature', ?, ?, ?, ?, ?, ?)
      `).bind(
        ticket.ticket_id,
        SOLANA_LIVE_TICKET_SCHEMA,
        userId,
        ticket.wallet_address,
        ticket.exact_market.instrument_id,
        ticket.reviewed_order.side,
        ticket.reviewed_order.notional_usdc,
        ticket.binding_hash,
        ticket.provider.request_id,
        JSON.stringify(ticket),
        Math.floor(Date.parse(ticket.expires_at) / 1000),
        nowSeconds,
        nowSeconds,
      ).run();
      await appendEvent({
        executionId: ticket.ticket_id,
        state: "awaiting_wallet_signature",
        evidence: { binding_hash: ticket.binding_hash, message_hash: ticket.transaction.message_hash },
        nowSeconds,
      });
      return ticket;
    },
    async findTicket(executionId, userId) {
      const row = await db.prepare(`
        SELECT execution_id, user_id, venue, chain_namespace, wallet_address, exact_market_id, state,
               prepared_payload_hash, provider_request_id, prepared_json, expires_at, created_at, updated_at
        FROM ravenos_customer_live_execution_intents
        WHERE execution_id = ? AND user_id = ? AND venue = 'jupiter' AND chain_namespace = 'solana'
      `).bind(clean(executionId, 100), clean(userId, 160)).first();
      return row ? Object.freeze({ ...row, prepared: JSON.parse(row.prepared_json) }) : null;
    },
    async claimSubmission({ execution_id: executionId, user_id: userId, verification, now_seconds: nowSeconds }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = 'submission_pending', updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND venue = 'jupiter'
          AND state = 'awaiting_wallet_signature' AND expires_at >= ?
      `).bind(nowSeconds, executionId, userId, nowSeconds).run();
      if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) fail("execution_ticket_not_claimable");
      await appendEvent({
        executionId,
        state: "submission_pending",
        evidence: {
          message_hash: verification.message_hash,
          signed_transaction_hash: verification.signed_transaction_hash,
          wallet_signature: verification.wallet_signature,
        },
        nowSeconds,
      });
    },
    async finalize({ execution_id: executionId, user_id: userId, reconciliation, now_seconds: nowSeconds }) {
      const state = new Set(["provider_confirmed", "provider_rejected", "indeterminate"]).has(reconciliation?.state)
        ? reconciliation.state
        : "indeterminate";
      await db.prepare(`
        UPDATE ravenos_customer_live_execution_intents
        SET state = ?, updated_at = ?
        WHERE execution_id = ? AND user_id = ? AND venue = 'jupiter' AND state IN ('submission_pending', 'reconciliation_pending')
      `).bind(state, nowSeconds, executionId, userId).run();
      await appendEvent({ executionId, state, evidence: reconciliation, nowSeconds });
      return Object.freeze({ state, ...reconciliation });
    },
  });
}
