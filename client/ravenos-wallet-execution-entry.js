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

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(String(value));
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

const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_HEX = "0x1237";
const ROBINHOOD_QUOTE_SCHEMA = "ravenos.robinhood_zero_x_unsigned_quote.v1";
const ROBINHOOD_LIVE_TICKET_SCHEMA = "ravenos.robinhood_live_ticket.v1";
const EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EVM_NATIVE_ASSET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const EVM_UINT256_MAX = (1n << 256n) - 1n;
const ROBINHOOD_TRANSACTION_KEYS = new Set([
  "chain_id",
  "data",
  "from",
  "gas",
  "gas_price",
  "max_fee_per_gas",
  "max_priority_fee_per_gas",
  "to",
  "unsigned",
  "value",
]);
const EVM_TRANSACTION_KEYS = new Set([
  ...ROBINHOOD_TRANSACTION_KEYS,
  "canonical_chain_id",
  "chain_namespace",
  "profile_id",
]);

const EVM_ZERO_X_QUOTE_SCHEMA = "ravenos.evm_zero_x_unsigned_quote.v1";
const EVM_LIVE_TICKET_SCHEMA = "ravenos.evm_live_ticket.v1";
const ZERO_X_ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";
const EVM_ZERO_X_PROFILES = Object.freeze({
  robinhood: Object.freeze({
    profile_id: "robinhood-mainnet-v1",
    chain_namespace: "robinhood",
    chain_id: ROBINHOOD_CHAIN_ID,
    canonical_chain_id: "eip155:4663",
    wallet_chain_hex: ROBINHOOD_CHAIN_HEX,
    native_symbol: "ETH",
    accounting_asset: Object.freeze({
      address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      symbol: "USDG",
      decimals: 6,
      representation: "paxos_usdg",
      issuer: "Paxos",
      circle_canonical_usdc: false,
    }),
  }),
  bsc: Object.freeze({
    profile_id: "bsc-mainnet-v1",
    chain_namespace: "bsc",
    chain_id: 56,
    canonical_chain_id: "eip155:56",
    wallet_chain_hex: "0x38",
    native_symbol: "BNB",
    accounting_asset: Object.freeze({
      address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      symbol: "USDC",
      decimals: 18,
      representation: "binance_peg_usdc",
      issuer: "Binance-Peg",
      circle_canonical_usdc: false,
    }),
  }),
});
const EVM_ZERO_X_PROFILE_ALIASES = Object.freeze({
  robinhood: "robinhood",
  "robinhood-mainnet-v1": "robinhood",
  bsc: "bsc",
  "bsc-mainnet-v1": "bsc",
});

function exactEvmZeroXProfile(value) {
  const requested = typeof value === "string"
    ? value
    : value?.profile_id || value?.chain_namespace;
  const key = EVM_ZERO_X_PROFILE_ALIASES[String(requested || "").trim().toLowerCase()];
  const profile = key ? EVM_ZERO_X_PROFILES[key] : null;
  if (!profile) throw executionError("evm_zero_x_profile_not_supported");
  if (value && typeof value === "object") assertEvmProfileIdentity(value, profile, "evm_requested");
  return profile;
}

function assertEvmProfileIdentity(value, profile, field) {
  if (!value || typeof value !== "object"
    || value.profile_id !== profile.profile_id
    || value.chain_namespace !== profile.chain_namespace
    || value.chain_id !== profile.chain_id
    || value.canonical_chain_id !== profile.canonical_chain_id) {
    throw executionError(`${field}_profile_mismatch`);
  }
}

function exactEvmAddress(value, field, { allowNative = false } = {}) {
  try {
    const address = getAddress(String(value || "")).toLowerCase();
    if (address === EVM_ZERO_ADDRESS || (!allowNative && address === EVM_NATIVE_ASSET)) throw new Error(field);
    return address;
  } catch {
    throw executionError(`${field}_invalid`);
  }
}

function exactDecimalQuantity(value, field, { positive = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)
    || raw.length > 78
    || BigInt(raw) > EVM_UINT256_MAX
    || (positive && raw === "0")) {
    throw executionError(`${field}_invalid`);
  }
  return raw;
}

function rpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function exactTransactionData(value) {
  const data = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(data) || data.length < 10 || data.length % 2 !== 0 || data.length > 131_074) {
    throw executionError("robinhood_transaction_data_invalid");
  }
  return data;
}

function exactHash(value, field) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw executionError(`${field}_invalid`);
  return hash;
}

function exactTransactionHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw executionError("robinhood_transaction_hash_invalid");
  return hash;
}

function exactRobinhoodTransaction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw executionError("robinhood_reviewed_transaction_invalid");
  }
  for (const key of Object.keys(value)) {
    if (!ROBINHOOD_TRANSACTION_KEYS.has(key)) throw executionError(`robinhood_transaction_field_forbidden:${key}`);
  }
  if (value.chain_id !== ROBINHOOD_CHAIN_ID || value.unsigned !== true) {
    throw executionError("robinhood_reviewed_transaction_invalid");
  }
  const transaction = {
    chain_id: ROBINHOOD_CHAIN_ID,
    from: exactEvmAddress(value.from, "robinhood_transaction_from"),
    to: exactEvmAddress(value.to, "robinhood_transaction_to"),
    data: exactTransactionData(value.data),
    value: exactDecimalQuantity(value.value, "robinhood_transaction_value"),
    gas: exactDecimalQuantity(value.gas, "robinhood_transaction_gas", { positive: true }),
    unsigned: true,
  };
  const hasLegacyFee = value.gas_price !== undefined;
  const hasMaxFee = value.max_fee_per_gas !== undefined;
  const hasPriorityFee = value.max_priority_fee_per_gas !== undefined;
  if (hasLegacyFee === (hasMaxFee || hasPriorityFee) || hasMaxFee !== hasPriorityFee) {
    throw executionError("robinhood_transaction_fee_fields_invalid");
  }
  if (hasLegacyFee) {
    transaction.gas_price = exactDecimalQuantity(value.gas_price, "robinhood_transaction_gas_price");
  } else {
    transaction.max_fee_per_gas = exactDecimalQuantity(value.max_fee_per_gas, "robinhood_transaction_max_fee_per_gas");
    transaction.max_priority_fee_per_gas = exactDecimalQuantity(
      value.max_priority_fee_per_gas,
      "robinhood_transaction_max_priority_fee_per_gas",
    );
    if (BigInt(transaction.max_priority_fee_per_gas) > BigInt(transaction.max_fee_per_gas)) {
      throw executionError("robinhood_transaction_fee_fields_invalid");
    }
  }
  return Object.freeze(transaction);
}

function robinhoodFeeHashBinding(fee = {}) {
  return {
    enabled: fee.enabled,
    state: fee.state,
    amount: fee.amount,
    token: fee.token,
    type: fee.type,
    recipient: fee.recipient,
    configured_fee_bps: fee.configured_fee_bps,
    fee_bps: fee.fee_bps,
    collection_state: fee.collection_state,
    amount_verification: fee.amount_verification,
    amount_independently_verified: fee.amount_independently_verified,
  };
}

async function reviewedRobinhoodTransaction(quote, address) {
  if (!globalThis.crypto?.subtle?.digest) throw executionError("browser_crypto_unavailable");
  if (quote?.schema_version !== ROBINHOOD_QUOTE_SCHEMA
    || quote.ok !== true
    || quote.provider !== "0x_swap_api_v2"
    || quote.state !== "awaiting_wallet_signature"
    || quote.wallet_handoff_eligible !== true
    || quote.chain_id !== ROBINHOOD_CHAIN_ID
    || quote.canonical_chain_id !== "eip155:4663"
    || !Array.isArray(quote.blockers)
    || quote.blockers.length !== 0) {
    throw executionError("robinhood_ticket_not_wallet_handoff_eligible");
  }
  const observedAt = Date.parse(String(quote.observed_at || ""));
  const expiresAt = Date.parse(String(quote.expires_at || ""));
  const checkedAt = Date.now();
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= observedAt
    || expiresAt - observedAt > 15_000
    || expiresAt <= checkedAt + 500
    || expiresAt > checkedAt + 15_000) {
    throw executionError("robinhood_ticket_expired");
  }
  const requestHash = exactHash(quote.request_hash, "robinhood_request_hash");
  if (String(quote.request_id || "") !== `zxr_${requestHash.slice(0, 32)}`) {
    throw executionError("robinhood_ticket_id_invalid");
  }
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  const binding = quote.exact_binding;
  if (!binding || typeof binding !== "object"
    || exactEvmAddress(binding.taker, "robinhood_ticket_taker") !== expectedAddress
    || exactEvmAddress(binding.recipient, "robinhood_ticket_recipient") !== expectedAddress) {
    throw executionError("wallet_account_identity_mismatch");
  }
  const sellToken = exactEvmAddress(binding.sell_token, "robinhood_ticket_sell_token", { allowNative: true });
  const buyToken = exactEvmAddress(binding.buy_token, "robinhood_ticket_buy_token", { allowNative: true });
  if (sellToken === buyToken) throw executionError("robinhood_ticket_token_pair_invalid");
  for (const [field, value] of [
    ["sell_amount", binding.sell_amount_base_units],
    ["buy_amount", binding.buy_amount_base_units],
    ["minimum_buy_amount", binding.minimum_buy_amount_base_units],
  ]) exactDecimalQuantity(value, `robinhood_ticket_${field}`, { positive: true });
  const boundary = quote.execution_boundary;
  if (boundary?.self_custodial !== true
    || boundary?.signing_location !== "connected_customer_wallet"
    || boundary?.provider_constructed_calldata !== true
    || boundary?.exact_taker_bound !== true
    || boundary?.exact_recipient_bound !== true
    || boundary?.exact_tokens_bound !== true
    || boundary?.fee_policy_bound !== true
    || boundary?.customer_wallet_signature_required !== true
    || boundary?.raven_signing !== false
    || boundary?.private_key_received !== false
    || boundary?.custody !== false
    || boundary?.transaction_submission !== false
    || boundary?.broadcasting !== false
    || boundary?.autonomous_execution !== false) {
    throw executionError("robinhood_ticket_boundary_invalid");
  }
  if (!new Set(["sufficient", "not_applicable_native_asset"]).has(quote.allowance?.state)
    || quote.provider_issues?.balance !== null
    || quote.provider_issues?.simulation_incomplete !== false
    || !Array.isArray(quote.provider_issues?.invalid_sources)
    || quote.provider_issues.invalid_sources.length !== 0) {
    throw executionError("robinhood_ticket_provider_issue");
  }
  const transaction = exactRobinhoodTransaction(quote.unsigned_transaction);
  if (transaction.from !== expectedAddress) throw executionError("wallet_account_identity_mismatch");
  const transactionHash = await sha256(transaction);
  if (transactionHash !== exactHash(quote.reviewed_transaction_hash, "robinhood_reviewed_transaction_hash")) {
    throw executionError("robinhood_reviewed_transaction_hash_mismatch");
  }
  const quoteHash = await sha256({
    request_hash: requestHash,
    provider_quote_id: String(quote.provider_quote_id || ""),
    chain_id: ROBINHOOD_CHAIN_ID,
    taker: expectedAddress,
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount_base_units: binding.sell_amount_base_units,
    buy_amount_base_units: binding.buy_amount_base_units,
    minimum_buy_amount_base_units: binding.minimum_buy_amount_base_units,
    transaction_hash: transactionHash,
    fee: robinhoodFeeHashBinding(quote.fee),
    block_number: exactDecimalQuantity(quote.block_number, "robinhood_ticket_block_number", { positive: true }),
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (quoteHash !== exactHash(quote.quote_hash, "robinhood_quote_hash")) {
    throw executionError("robinhood_quote_hash_mismatch");
  }
  return transaction;
}

async function validateRobinhoodLiveTicket(ticket, quote, transaction, address) {
  if (ticket?.schema_version !== ROBINHOOD_LIVE_TICKET_SCHEMA
    || ticket.ok !== true
    || ticket.state !== "awaiting_wallet_signature"
    || ticket.chain_id !== ROBINHOOD_CHAIN_ID
    || ticket.canonical_chain_id !== "eip155:4663"
    || !/^lex_[A-Za-z0-9_-]{20,96}$/.test(String(ticket.ticket_id || ""))) {
    throw executionError("robinhood_live_ticket_invalid");
  }
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  if (exactEvmAddress(ticket.wallet_address, "robinhood_live_wallet") !== expectedAddress) {
    throw executionError("wallet_account_identity_mismatch");
  }
  const expiresAt = Date.parse(String(ticket.expires_at || ""));
  const createdAt = Date.parse(String(ticket.created_at || ""));
  const checkedAt = Date.now();
  if (!Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || expiresAt - createdAt > 10_000
    || expiresAt <= checkedAt + 500
    || expiresAt > checkedAt + 10_000
    || expiresAt > Date.parse(String(quote.expires_at || ""))) {
    throw executionError("robinhood_live_ticket_expired");
  }
  const boundary = ticket.execution_boundary;
  if (boundary?.wallet_signature_required !== true
    || boundary?.signing_location !== "connected_customer_wallet"
    || boundary?.submission_path !== "wallet_direct_to_robinhood_chain"
    || boundary?.server_signing !== false
    || boundary?.private_key_received !== false
    || boundary?.custody !== false
    || boundary?.arbitrary_transaction_submission !== false
    || boundary?.exact_reviewed_transaction_only !== true
    || boundary?.autonomous_execution !== false) {
    throw executionError("robinhood_live_ticket_boundary_invalid");
  }
  const reviewed = ticket.reviewed_order || {};
  const quoteBinding = quote.exact_binding || {};
  if (ticket.provider?.venue !== "zero_x"
    || String(ticket.provider?.quote_id || "") !== String(quote.provider_quote_id || "")
    || exactHash(ticket.provider?.quote_hash, "robinhood_live_quote_hash") !== exactHash(quote.quote_hash, "robinhood_quote_hash")
    || exactHash(ticket.transaction?.reviewed_transaction_hash, "robinhood_live_transaction_hash") !== exactHash(quote.reviewed_transaction_hash, "robinhood_reviewed_transaction_hash")
    || exactEvmAddress(ticket.transaction?.to, "robinhood_live_transaction_to") !== transaction.to
    || exactDecimalQuantity(ticket.transaction?.maximum_gas, "robinhood_live_maximum_gas", { positive: true }) !== transaction.gas
    || exactDecimalQuantity(ticket.transaction?.value, "robinhood_live_value") !== transaction.value
    || (transaction.gas_price !== undefined
      ? exactDecimalQuantity(ticket.transaction?.quoted_gas_price, "robinhood_live_gas_price") !== transaction.gas_price
        || ticket.transaction?.quoted_maximum_fee_per_gas !== null
        || ticket.transaction?.quoted_maximum_priority_fee_per_gas !== null
      : ticket.transaction?.quoted_gas_price !== null
        || exactDecimalQuantity(ticket.transaction?.quoted_maximum_fee_per_gas, "robinhood_live_maximum_fee") !== transaction.max_fee_per_gas
        || exactDecimalQuantity(ticket.transaction?.quoted_maximum_priority_fee_per_gas, "robinhood_live_priority_fee") !== transaction.max_priority_fee_per_gas)
    || await sha256Text(transaction.data) !== exactHash(ticket.transaction?.input_data_sha256, "robinhood_live_input_data")
    || exactEvmAddress(reviewed.sell_token, "robinhood_live_sell_token", { allowNative: true }) !== exactEvmAddress(quoteBinding.sell_token, "robinhood_quote_sell_token", { allowNative: true })
    || exactEvmAddress(reviewed.buy_token, "robinhood_live_buy_token", { allowNative: true }) !== exactEvmAddress(quoteBinding.buy_token, "robinhood_quote_buy_token", { allowNative: true })
    || exactDecimalQuantity(reviewed.sell_amount_base_units, "robinhood_live_sell_amount", { positive: true }) !== exactDecimalQuantity(quoteBinding.sell_amount_base_units, "robinhood_quote_sell_amount", { positive: true })
    || exactDecimalQuantity(reviewed.expected_buy_amount_base_units, "robinhood_live_buy_amount", { positive: true }) !== exactDecimalQuantity(quoteBinding.buy_amount_base_units, "robinhood_quote_buy_amount", { positive: true })
    || exactDecimalQuantity(reviewed.minimum_buy_amount_base_units, "robinhood_live_minimum_buy", { positive: true }) !== exactDecimalQuantity(quoteBinding.minimum_buy_amount_base_units, "robinhood_quote_minimum_buy", { positive: true })) {
    throw executionError("robinhood_live_ticket_quote_mismatch");
  }
  const fee = ticket.fee || {};
  if (fee.enabled !== quote.fee?.enabled
    || Number(fee.fee_bps) !== Number(quote.fee?.fee_bps)
    || fee.token !== quote.fee?.token
    || fee.recipient !== quote.fee?.recipient
    || String(fee.expected_amount_base_units) !== String(quote.fee?.amount)) {
    throw executionError("robinhood_live_ticket_fee_mismatch");
  }
  const market = ticket.exact_market || {};
  const poolAddress = exactEvmAddress(market.pool_address, "robinhood_live_pool");
  if (market.instrument_id !== `robinhood:pool:${poolAddress}`
    || exactEvmAddress(market.token_address, "robinhood_live_token") !== (market.side === "buy" ? reviewed.buy_token : reviewed.sell_token)
    || !new Set(["buy", "sell"]).has(String(market.side || ""))
    || market.side !== reviewed.side) {
    throw executionError("robinhood_live_ticket_market_mismatch");
  }
  const binding = {
    ticket_id: ticket.ticket_id,
    chain_id: ticket.chain_id,
    wallet_address: expectedAddress,
    exact_market: ticket.exact_market,
    entry_quote_hash: ticket.provider.quote_hash,
    reviewed_transaction_hash: ticket.transaction.reviewed_transaction_hash,
    sell_token: reviewed.sell_token,
    buy_token: reviewed.buy_token,
    sell_amount_base_units: reviewed.sell_amount_base_units,
    expected_buy_amount_base_units: reviewed.expected_buy_amount_base_units,
    minimum_buy_amount_base_units: reviewed.minimum_buy_amount_base_units,
    accounting: ticket.accounting,
    fee: ticket.fee,
    exit_quote_hash: ticket.exit_proof?.quote_hash || null,
    expires_at: new Date(expiresAt).toISOString(),
  };
  if (await sha256(binding) !== exactHash(ticket.binding_hash, "robinhood_live_binding_hash")) {
    throw executionError("robinhood_live_ticket_binding_mismatch");
  }
  return true;
}

async function connectedRobinhoodAccount(provider, expectedAddress) {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.length) throw executionError("evm_wallet_not_connected");
  const connected = exactEvmAddress(accounts[0], "connected_wallet_address");
  if (connected !== expectedAddress) throw executionError("wallet_account_identity_mismatch");
  return connected;
}

async function executeRobinhoodZeroXTicket({ ticket, quote, provider, address }) {
  if (!provider?.request) throw executionError("evm_wallet_unavailable");
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  const transaction = await reviewedRobinhoodTransaction(quote, expectedAddress);
  await validateRobinhoodLiveTicket(ticket, quote, transaction, expectedAddress);
  let chainId = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
  if (chainId !== ROBINHOOD_CHAIN_HEX) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
      });
    } catch {
      throw executionError("robinhood_chain_switch_failed");
    }
    chainId = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
  }
  if (chainId !== ROBINHOOD_CHAIN_HEX) throw executionError("robinhood_chain_identity_mismatch");
  await connectedRobinhoodAccount(provider, expectedAddress);
  const walletTransaction = {
    from: transaction.from,
    to: transaction.to,
    data: transaction.data,
    value: rpcQuantity(transaction.value),
    gas: rpcQuantity(transaction.gas),
  };
  if (transaction.gas_price !== undefined) {
    walletTransaction.gasPrice = rpcQuantity(transaction.gas_price);
  } else {
    walletTransaction.maxFeePerGas = rpcQuantity(transaction.max_fee_per_gas);
    walletTransaction.maxPriorityFeePerGas = rpcQuantity(transaction.max_priority_fee_per_gas);
  }
  if (Date.parse(ticket.expires_at || "") <= Date.now() + 250) throw executionError("robinhood_ticket_expired");
  await connectedRobinhoodAccount(provider, expectedAddress);
  if (String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase() !== ROBINHOOD_CHAIN_HEX) {
    throw executionError("robinhood_chain_identity_mismatch");
  }
  let submittedHash;
  try {
    submittedHash = await provider.request({
      method: "eth_sendTransaction",
      params: [walletTransaction],
    });
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    if (code === "4001" || /user (?:rejected|denied)|request rejected/.test(message)) throw executionError("user_rejected_request");
    throw executionError("robinhood_wallet_submission_indeterminate");
  }
  const transactionHash = exactTransactionHash(submittedHash);
  return Object.freeze({
    ticket_id: ticket.ticket_id,
    wallet_address: expectedAddress,
    reviewed_transaction_hash: ticket.transaction.reviewed_transaction_hash,
    transaction_hash: transactionHash,
  });
}

function exactEvmTransactionData(value) {
  const data = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(data) || data.length < 10 || data.length % 2 !== 0 || data.length > 131_074) {
    throw executionError("evm_transaction_data_invalid");
  }
  return data;
}

function exactEvmTransactionHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw executionError("evm_transaction_hash_invalid");
  return hash;
}

function exactEvmZeroXTransaction(value, profile, binding) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw executionError("evm_reviewed_transaction_invalid");
  }
  for (const key of Object.keys(value)) {
    if (!EVM_TRANSACTION_KEYS.has(key)) throw executionError(`evm_transaction_field_forbidden:${key}`);
  }
  assertEvmProfileIdentity(value, profile, "evm_transaction");
  if (value.unsigned !== true) {
    throw executionError("evm_reviewed_transaction_invalid");
  }
  const transaction = {
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    from: exactEvmAddress(value.from, "evm_transaction_from"),
    to: exactEvmAddress(value.to, "evm_transaction_to"),
    data: exactEvmTransactionData(value.data),
    value: exactDecimalQuantity(value.value, "evm_transaction_value"),
    gas: exactDecimalQuantity(value.gas, "evm_transaction_gas", { positive: true }),
    unsigned: true,
  };
  const hasLegacyFee = value.gas_price !== undefined;
  const hasMaxFee = value.max_fee_per_gas !== undefined;
  const hasPriorityFee = value.max_priority_fee_per_gas !== undefined;
  if (hasLegacyFee === (hasMaxFee || hasPriorityFee) || hasMaxFee !== hasPriorityFee) {
    throw executionError("evm_transaction_fee_fields_invalid");
  }
  if (hasLegacyFee) {
    transaction.gas_price = exactDecimalQuantity(value.gas_price, "evm_transaction_gas_price");
  } else {
    transaction.max_fee_per_gas = exactDecimalQuantity(value.max_fee_per_gas, "evm_transaction_max_fee_per_gas");
    transaction.max_priority_fee_per_gas = exactDecimalQuantity(
      value.max_priority_fee_per_gas,
      "evm_transaction_max_priority_fee_per_gas",
    );
    if (BigInt(transaction.max_priority_fee_per_gas) > BigInt(transaction.max_fee_per_gas)) {
      throw executionError("evm_transaction_fee_fields_invalid");
    }
  }
  if (binding.sell_token === EVM_NATIVE_ASSET) {
    if (transaction.value !== binding.sell_amount_base_units) throw executionError("evm_native_transaction_value_mismatch");
  } else {
    if (transaction.value !== "0") throw executionError("evm_erc20_transaction_value_mismatch");
    if (transaction.to !== ZERO_X_ALLOWANCE_HOLDER) throw executionError("evm_zero_x_transaction_target_mismatch");
  }
  return Object.freeze(transaction);
}

function exactGenericQuoteFee(value, binding) {
  if (!value || typeof value !== "object" || typeof value.enabled !== "boolean") {
    throw executionError("evm_quote_fee_invalid");
  }
  const feeBps = Number(value.fee_bps);
  const configuredFeeBps = Number(value.configured_fee_bps);
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 1_000
    || !Number.isSafeInteger(configuredFeeBps) || configuredFeeBps < 0 || configuredFeeBps > 1_000) {
    throw executionError("evm_quote_fee_invalid");
  }
  if (value.enabled !== true) {
    if (feeBps !== 0
      || String(value.amount) !== "0"
      || value.token !== null
      || value.type !== null
      || value.recipient !== null
      || value.state !== "disabled"
      || value.collection_state !== "disabled"
      || value.amount_verification !== "not_applicable"
      || value.amount_independently_verified !== true) {
      throw executionError("evm_quote_fee_invalid");
    }
    return Object.freeze({
      enabled: false,
      fee_bps: 0,
      configured_fee_bps: configuredFeeBps,
      amount: "0",
      token: null,
      recipient: null,
    });
  }
  const amount = exactDecimalQuantity(value.amount, "evm_quote_fee_amount", { positive: true });
  const token = exactEvmAddress(value.token, "evm_quote_fee_token", { allowNative: true });
  const recipient = exactEvmAddress(value.recipient, "evm_quote_fee_recipient");
  if (feeBps < 1
    || value.state !== "enabled"
    || value.type !== "volume"
    || value.collection_state !== "provider_quote_bound"
    || !new Set(["independently_computed_from_sell_amount", "provider_quoted_buy_token_amount"]).has(value.amount_verification)
    || typeof value.amount_independently_verified !== "boolean"
    || (token !== binding.sell_token && token !== binding.buy_token)) {
    throw executionError("evm_quote_fee_invalid");
  }
  return Object.freeze({
    enabled: true,
    fee_bps: feeBps,
    configured_fee_bps: configuredFeeBps,
    amount,
    token,
    recipient,
  });
}

function exactEvmMarket(value, profile) {
  assertEvmProfileIdentity(value, profile, "evm_exact_market");
  const poolAddress = exactEvmAddress(value.pool_address, "evm_exact_market_pool");
  const tokenAddress = exactEvmAddress(value.token_address, "evm_exact_market_token");
  const quoteAddress = exactEvmAddress(value.quote_address, "evm_exact_market_quote");
  const side = String(value.side || "").trim().toLowerCase();
  if (value.instrument_id !== `${profile.chain_namespace}:pool:${poolAddress}`
    || !new Set(["buy", "sell"]).has(side)) {
    throw executionError("evm_exact_market_identity_mismatch");
  }
  return Object.freeze({ poolAddress, tokenAddress, quoteAddress, side });
}

async function reviewedEvmZeroXTransaction(quote, address, profile) {
  if (!globalThis.crypto?.subtle?.digest) throw executionError("browser_crypto_unavailable");
  assertEvmProfileIdentity(quote, profile, "evm_quote");
  if (quote.schema_version !== EVM_ZERO_X_QUOTE_SCHEMA
    || quote.ok !== true
    || quote.provider !== "0x_swap_api_v2"
    || quote.state !== "awaiting_wallet_signature"
    || quote.wallet_handoff_eligible !== true
    || !Array.isArray(quote.blockers)
    || quote.blockers.length !== 0) {
    throw executionError("evm_ticket_not_wallet_handoff_eligible");
  }
  const observedAt = Date.parse(String(quote.observed_at || ""));
  const expiresAt = Date.parse(String(quote.expires_at || ""));
  const checkedAt = Date.now();
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= observedAt
    || expiresAt - observedAt > 15_000
    || expiresAt <= checkedAt + 500
    || expiresAt > checkedAt + 15_000) {
    throw executionError("evm_ticket_expired");
  }
  const requestHash = exactHash(quote.request_hash, "evm_request_hash");
  if (String(quote.request_id || "") !== `zxr_${requestHash.slice(0, 32)}`) {
    throw executionError("evm_ticket_id_invalid");
  }
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  const binding = quote.exact_binding;
  assertEvmProfileIdentity(binding, profile, "evm_quote_binding");
  if (exactEvmAddress(binding.taker, "evm_ticket_taker") !== expectedAddress
    || exactEvmAddress(binding.recipient, "evm_ticket_recipient") !== expectedAddress) {
    throw executionError("wallet_account_identity_mismatch");
  }
  const exactBinding = Object.freeze({
    sell_token: exactEvmAddress(binding.sell_token, "evm_ticket_sell_token", { allowNative: true }),
    buy_token: exactEvmAddress(binding.buy_token, "evm_ticket_buy_token", { allowNative: true }),
    sell_amount_base_units: exactDecimalQuantity(binding.sell_amount_base_units, "evm_ticket_sell_amount", { positive: true }),
    buy_amount_base_units: exactDecimalQuantity(binding.buy_amount_base_units, "evm_ticket_buy_amount", { positive: true }),
    minimum_buy_amount_base_units: exactDecimalQuantity(binding.minimum_buy_amount_base_units, "evm_ticket_minimum_buy_amount", { positive: true }),
  });
  if (exactBinding.sell_token === exactBinding.buy_token
    || BigInt(exactBinding.minimum_buy_amount_base_units) > BigInt(exactBinding.buy_amount_base_units)) {
    throw executionError("evm_ticket_token_pair_invalid");
  }
  const boundary = quote.execution_boundary;
  if (boundary?.self_custodial !== true
    || boundary?.signing_location !== "connected_customer_wallet"
    || boundary?.provider_constructed_calldata !== true
    || boundary?.exact_taker_bound !== true
    || boundary?.exact_recipient_bound !== true
    || boundary?.exact_tokens_bound !== true
    || boundary?.fee_policy_bound !== true
    || boundary?.customer_wallet_signature_required !== true
    || boundary?.raven_signing !== false
    || boundary?.private_key_received !== false
    || boundary?.custody !== false
    || boundary?.approval_transaction_included !== false
    || boundary?.transaction_submission !== false
    || boundary?.broadcasting !== false
    || boundary?.autonomous_execution !== false) {
    throw executionError("evm_ticket_boundary_invalid");
  }
  const expectedAllowanceState = exactBinding.sell_token === EVM_NATIVE_ASSET
    ? "not_applicable_native_asset"
    : "sufficient";
  if (quote.allowance?.state !== expectedAllowanceState
    || quote.allowance?.approval_transaction_included !== false
    || quote.provider_issues?.balance !== null
    || quote.provider_issues?.simulation_incomplete !== false
    || !Array.isArray(quote.provider_issues?.invalid_sources)
    || quote.provider_issues.invalid_sources.length !== 0) {
    throw executionError("evm_ticket_provider_issue");
  }
  const fee = exactGenericQuoteFee(quote.fee, exactBinding);
  const transaction = exactEvmZeroXTransaction(quote.unsigned_transaction, profile, exactBinding);
  if (transaction.from !== expectedAddress) throw executionError("wallet_account_identity_mismatch");
  const transactionHash = await sha256(transaction);
  if (transactionHash !== exactHash(quote.reviewed_transaction_hash, "evm_reviewed_transaction_hash")) {
    throw executionError("evm_reviewed_transaction_hash_mismatch");
  }
  exactHash(quote.quote_hash, "evm_quote_hash");
  exactDecimalQuantity(quote.block_number, "evm_ticket_block_number", { positive: true });
  return Object.freeze({ transaction, binding: exactBinding, fee, expiresAt });
}

async function validateEvmLiveTicket(ticket, quote, reviewed, address, profile) {
  assertEvmProfileIdentity(ticket, profile, "evm_live_ticket");
  if (ticket.schema_version !== EVM_LIVE_TICKET_SCHEMA
    || ticket.ok !== true
    || ticket.state !== "awaiting_wallet_signature"
    || ticket.wallet_chain_id_hex !== profile.wallet_chain_hex
    || ticket.native_symbol !== profile.native_symbol
    || !/^lex_[A-Za-z0-9_-]{20,96}$/.test(String(ticket.ticket_id || ""))) {
    throw executionError("evm_live_ticket_invalid");
  }
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  if (exactEvmAddress(ticket.wallet_address, "evm_live_wallet") !== expectedAddress) {
    throw executionError("wallet_account_identity_mismatch");
  }
  const expiresAt = Date.parse(String(ticket.expires_at || ""));
  const createdAt = Date.parse(String(ticket.created_at || ""));
  const checkedAt = Date.now();
  if (!Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || expiresAt - createdAt > 10_000
    || expiresAt <= checkedAt + 500
    || expiresAt > checkedAt + 10_000
    || expiresAt > reviewed.expiresAt) {
    throw executionError("evm_live_ticket_expired");
  }
  const boundary = ticket.execution_boundary;
  if (boundary?.wallet_signature_required !== true
    || boundary?.signing_location !== "connected_customer_wallet"
    || boundary?.submission_path !== "wallet_direct_to_evm_chain"
    || boundary?.server_signing !== false
    || boundary?.private_key_received !== false
    || boundary?.custody !== false
    || boundary?.arbitrary_transaction_submission !== false
    || boundary?.exact_reviewed_transaction_only !== true
    || boundary?.autonomous_execution !== false) {
    throw executionError("evm_live_ticket_boundary_invalid");
  }
  const market = exactEvmMarket(ticket.exact_market, profile);
  const order = ticket.reviewed_order || {};
  const quoteBinding = reviewed.binding;
  const transaction = reviewed.transaction;
  if (ticket.provider?.venue !== "zero_x"
    || String(ticket.provider?.quote_id || "") !== String(quote.provider_quote_id || "")
    || exactHash(ticket.provider?.quote_hash, "evm_live_quote_hash") !== exactHash(quote.quote_hash, "evm_quote_hash")
    || String(ticket.provider?.block_number || "") !== String(quote.block_number || "")
    || exactHash(ticket.transaction?.reviewed_transaction_hash, "evm_live_transaction_hash") !== exactHash(quote.reviewed_transaction_hash, "evm_reviewed_transaction_hash")
    || exactEvmAddress(ticket.transaction?.to, "evm_live_transaction_to") !== transaction.to
    || exactDecimalQuantity(ticket.transaction?.maximum_gas, "evm_live_maximum_gas", { positive: true }) !== transaction.gas
    || exactDecimalQuantity(ticket.transaction?.value, "evm_live_value") !== transaction.value
    || (transaction.gas_price !== undefined
      ? exactDecimalQuantity(ticket.transaction?.quoted_gas_price, "evm_live_gas_price") !== transaction.gas_price
        || ticket.transaction?.quoted_maximum_fee_per_gas !== null
        || ticket.transaction?.quoted_maximum_priority_fee_per_gas !== null
      : ticket.transaction?.quoted_gas_price !== null
        || exactDecimalQuantity(ticket.transaction?.quoted_maximum_fee_per_gas, "evm_live_maximum_fee") !== transaction.max_fee_per_gas
        || exactDecimalQuantity(ticket.transaction?.quoted_maximum_priority_fee_per_gas, "evm_live_priority_fee") !== transaction.max_priority_fee_per_gas)
    || await sha256Text(transaction.data) !== exactHash(ticket.transaction?.input_data_sha256, "evm_live_input_data")
    || String(order.side || "").toLowerCase() !== market.side
    || order.order_type !== "market"
    || exactEvmAddress(order.sell_token, "evm_live_sell_token", { allowNative: true }) !== quoteBinding.sell_token
    || exactEvmAddress(order.buy_token, "evm_live_buy_token", { allowNative: true }) !== quoteBinding.buy_token
    || exactDecimalQuantity(order.sell_amount_base_units, "evm_live_sell_amount", { positive: true }) !== quoteBinding.sell_amount_base_units
    || exactDecimalQuantity(order.expected_buy_amount_base_units, "evm_live_buy_amount", { positive: true }) !== quoteBinding.buy_amount_base_units
    || exactDecimalQuantity(order.minimum_buy_amount_base_units, "evm_live_minimum_buy", { positive: true }) !== quoteBinding.minimum_buy_amount_base_units
    || (market.side === "buy" ? quoteBinding.buy_token : quoteBinding.sell_token) !== market.tokenAddress) {
    throw executionError("evm_live_ticket_quote_mismatch");
  }
  const accounting = ticket.accounting || {};
  const accountingAsset = exactEvmAddress(accounting.asset_address, "evm_live_accounting_asset", { allowNative: true });
  const accountingDecimals = Number(accounting.decimals);
  if (!Number.isSafeInteger(accountingDecimals) || accountingDecimals < 0 || accountingDecimals > 255
    || !String(accounting.symbol || "").trim()
    || accountingAsset !== profile.accounting_asset.address
    || String(accounting.symbol || "") !== profile.accounting_asset.symbol
    || accountingDecimals !== profile.accounting_asset.decimals
    || accounting.representation !== profile.accounting_asset.representation
    || accounting.issuer !== profile.accounting_asset.issuer
    || accounting.circle_canonical_usdc !== profile.accounting_asset.circle_canonical_usdc
    || BigInt(exactDecimalQuantity(accounting.notional_base_units, "evm_live_accounting_notional", { positive: true }))
      > BigInt(exactDecimalQuantity(accounting.maximum_notional_base_units, "evm_live_accounting_maximum", { positive: true }))
    || exactEvmAddress(order.accounting_asset_address, "evm_live_order_accounting_asset", { allowNative: true }) !== accountingAsset
    || String(order.accounting_asset_symbol || "") !== String(accounting.symbol || "")
    || exactDecimalQuantity(order.notional_accounting_base_units, "evm_live_order_accounting_notional", { positive: true })
      !== exactDecimalQuantity(accounting.notional_base_units, "evm_live_accounting_notional", { positive: true })) {
    throw executionError("evm_live_ticket_accounting_mismatch");
  }
  const ticketFee = ticket.fee || {};
  const quoteFee = reviewed.fee;
  if (ticketFee.enabled !== quoteFee.enabled
    || Number(ticketFee.fee_bps) !== quoteFee.fee_bps
    || String(ticketFee.expected_amount_base_units) !== quoteFee.amount
    || (quoteFee.enabled
      ? exactEvmAddress(ticketFee.token, "evm_live_fee_token", { allowNative: true }) !== quoteFee.token
        || exactEvmAddress(ticketFee.recipient, "evm_live_fee_recipient") !== quoteFee.recipient
        || ticketFee.collection_method !== "zero_x_integrator_fee"
      : ticketFee.token !== null
        || ticketFee.recipient !== null
        || ticketFee.collection_method !== "none")) {
    throw executionError("evm_live_ticket_fee_mismatch");
  }
  exactHash(ticket.binding_hash, "evm_live_binding_hash");
  return true;
}

async function executeEvmZeroXTicket({ profile: requestedProfile, ticket, quote, provider, address }) {
  if (!provider?.request) throw executionError("evm_wallet_unavailable");
  const profile = exactEvmZeroXProfile(requestedProfile);
  const expectedAddress = exactEvmAddress(address, "wallet_address");
  const reviewed = await reviewedEvmZeroXTransaction(quote, expectedAddress, profile);
  await validateEvmLiveTicket(ticket, quote, reviewed, expectedAddress, profile);
  let chainId = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
  if (chainId !== profile.wallet_chain_hex) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: profile.wallet_chain_hex }],
      });
    } catch {
      throw executionError("evm_chain_switch_failed");
    }
    chainId = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
  }
  if (chainId !== profile.wallet_chain_hex) throw executionError("evm_chain_identity_mismatch");
  await connectedRobinhoodAccount(provider, expectedAddress);
  const transaction = reviewed.transaction;
  const walletTransaction = {
    from: transaction.from,
    to: transaction.to,
    data: transaction.data,
    value: rpcQuantity(transaction.value),
    gas: rpcQuantity(transaction.gas),
  };
  if (transaction.gas_price !== undefined) {
    walletTransaction.gasPrice = rpcQuantity(transaction.gas_price);
  } else {
    walletTransaction.maxFeePerGas = rpcQuantity(transaction.max_fee_per_gas);
    walletTransaction.maxPriorityFeePerGas = rpcQuantity(transaction.max_priority_fee_per_gas);
  }
  if (Date.parse(ticket.expires_at || "") <= Date.now() + 250) throw executionError("evm_ticket_expired");
  await connectedRobinhoodAccount(provider, expectedAddress);
  if (String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase() !== profile.wallet_chain_hex) {
    throw executionError("evm_chain_identity_mismatch");
  }
  let submittedHash;
  try {
    submittedHash = await provider.request({
      method: "eth_sendTransaction",
      params: [walletTransaction],
    });
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    if (code === "4001" || /user (?:rejected|denied)|request rejected/.test(message)) throw executionError("user_rejected_request");
    throw executionError("evm_wallet_submission_indeterminate");
  }
  return Object.freeze({
    ticket_id: ticket.ticket_id,
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    wallet_address: expectedAddress,
    reviewed_transaction_hash: ticket.transaction.reviewed_transaction_hash,
    transaction_hash: exactEvmTransactionHash(submittedHash),
  });
}

globalThis.RavenOSWalletExecution = Object.freeze({
  approveHyperliquidBuilderFee,
  executeEvmZeroXTicket,
  executeRobinhoodZeroXTicket,
  executeHyperliquidTicket,
  signSolanaTicket,
});
