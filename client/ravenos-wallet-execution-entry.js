import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { VersionedTransaction } from "@solana/web3.js";
import { createWalletClient, custom, getAddress } from "viem";

function executionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Bytes(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 4_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw executionError("solana_transaction_base64_invalid");
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > 1_232) throw executionError("solana_transaction_size_invalid");
  return bytes;
}

function bytesBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function validatedHyperliquidWallet(provider, expectedAddress) {
  if (!provider?.request) throw executionError("evm_wallet_unavailable");
  const wallet = createWalletClient({ transport: custom(provider) });
  const addresses = await wallet.getAddresses();
  const actual = addresses[0] ? getAddress(addresses[0]) : null;
  const expected = getAddress(String(expectedAddress || ""));
  if (!actual || actual !== expected) throw executionError("wallet_account_identity_mismatch");
  return wallet;
}

async function executeHyperliquidTicket({ ticket, provider, address }) {
  if (ticket?.schema_version !== "ravenos.hyperliquid_live_ticket.v1") throw executionError("live_ticket_schema_invalid");
  if (Date.parse(ticket.expires_at || "") <= Date.now() + 500) throw executionError("live_ticket_expired");
  if (String(ticket.wallet_address || "").toLowerCase() !== String(address || "").toLowerCase()) {
    throw executionError("wallet_account_identity_mismatch");
  }
  if (await sha256(ticket.action) !== ticket.action_hash) throw executionError("live_ticket_action_hash_mismatch");
  if (ticket.execution_boundary?.server_signing !== false || ticket.execution_boundary?.custody !== false) {
    throw executionError("live_ticket_boundary_invalid");
  }
  const wallet = await validatedHyperliquidWallet(provider, address);
  const expiresAfter = Date.parse(ticket.expires_at);
  const exchange = new ExchangeClient({
    transport: new HttpTransport({ timeout: 10_000 }),
    wallet,
    defaultExpiresAfter: expiresAfter,
  });
  let settings_response = null;
  if (ticket.pre_actions?.update_leverage?.required === true) {
    const update = ticket.pre_actions.update_leverage;
    settings_response = await exchange.updateLeverage({
      asset: Number(update.asset),
      isCross: update.isCross === true,
      leverage: Number(update.leverage),
    });
  }
  if (Date.parse(ticket.expires_at || "") <= Date.now() + 250) throw executionError("live_ticket_expired");
  const provider_response = await exchange.order(ticket.action);
  return Object.freeze({
    ticket_id: ticket.ticket_id,
    wallet_address: ticket.wallet_address,
    action_hash: ticket.action_hash,
    settings_response,
    provider_response,
  });
}

async function approveHyperliquidBuilderFee({ approval, provider, address }) {
  if (approval?.schema_version !== "ravenos.hyperliquid_builder_approval.v1") throw executionError("builder_approval_schema_invalid");
  if (Date.parse(approval.expires_at || "") <= Date.now() + 500) throw executionError("builder_approval_expired");
  if (String(approval.wallet_address || "").toLowerCase() !== String(address || "").toLowerCase()) {
    throw executionError("wallet_account_identity_mismatch");
  }
  if (await sha256(approval.action) !== approval.action_hash) throw executionError("builder_approval_action_hash_mismatch");
  if (approval.execution_boundary?.server_signing !== false
    || approval.execution_boundary?.custody !== false
    || approval.execution_boundary?.order_submission_included !== false) {
    throw executionError("builder_approval_boundary_invalid");
  }
  const builder = getAddress(String(approval.action?.builder || ""));
  const percentLabel = String(approval.action?.maxFeeRate || "");
  const percent = Number(percentLabel.replace(/%$/, ""));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 0.1 || percentLabel !== `${percent.toFixed(2)}%`) {
    throw executionError("builder_approval_fee_invalid");
  }
  if (builder.toLowerCase() !== String(approval.fee?.builder_address || "").toLowerCase()) {
    throw executionError("builder_approval_recipient_mismatch");
  }
  const wallet = await validatedHyperliquidWallet(provider, address);
  const exchange = new ExchangeClient({
    transport: new HttpTransport({ timeout: 10_000 }),
    wallet,
    defaultExpiresAfter: Date.parse(approval.expires_at),
  });
  const provider_response = await exchange.approveBuilderFee({
    builder,
    maxFeeRate: percentLabel,
  });
  return Object.freeze({
    approval_id: approval.approval_id,
    wallet_address: approval.wallet_address,
    action_hash: approval.action_hash,
    provider_response,
  });
}

async function signSolanaTicket({ ticket, unsignedTransactionBase64, provider, address }) {
  if (ticket?.schema_version !== "ravenos.solana_live_ticket.v1") throw executionError("live_ticket_schema_invalid");
  if (Date.parse(ticket.expires_at || "") <= Date.now() + 500) throw executionError("live_ticket_expired");
  if (String(ticket.wallet_address || "") !== String(address || "")) throw executionError("wallet_account_identity_mismatch");
  if (ticket.execution_boundary?.server_signing !== false
    || ticket.execution_boundary?.custody !== false
    || ticket.execution_boundary?.exact_reviewed_transaction_only !== true) {
    throw executionError("live_ticket_boundary_invalid");
  }
  if (!provider?.signTransaction || !provider?.publicKey) throw executionError("solana_wallet_signing_unavailable");
  if (String(provider.publicKey) !== String(address)) throw executionError("wallet_account_identity_mismatch");
  const transaction = VersionedTransaction.deserialize(base64Bytes(unsignedTransactionBase64));
  if (transaction.signatures.length !== 1) throw executionError("solana_signer_set_invalid");
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== String(address)) throw executionError("solana_fee_payer_mismatch");
  const messageBytes = transaction.message.serialize();
  if (await sha256Bytes(messageBytes) !== ticket.transaction?.message_hash) throw executionError("solana_transaction_message_mismatch");
  if (await sha256Bytes(transaction.serialize()) !== ticket.transaction?.unsigned_transaction_hash) {
    throw executionError("solana_unsigned_transaction_hash_mismatch");
  }
  const signed = await provider.signTransaction(transaction);
  if (!signed?.message || !Array.isArray(signed?.signatures) || typeof signed?.serialize !== "function") {
    throw executionError("solana_wallet_signature_response_invalid");
  }
  if (await sha256Bytes(signed.message.serialize()) !== ticket.transaction?.message_hash) {
    throw executionError("solana_wallet_changed_transaction");
  }
  if (signed.signatures.length !== 1 || !signed.signatures[0].some((byte) => byte !== 0)) {
    throw executionError("solana_wallet_signature_missing");
  }
  return Object.freeze({
    ticket_id: ticket.ticket_id,
    signed_transaction_base64: bytesBase64(signed.serialize()),
  });
}

globalThis.RavenOSWalletExecution = Object.freeze({
  approveHyperliquidBuilderFee,
  executeHyperliquidTicket,
  signSolanaTicket,
});
