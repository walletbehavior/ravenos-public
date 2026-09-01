import { createHash } from "node:crypto";

import {
  createSourceWalletId,
  normalizeSourceWalletChainIdentity,
  normalizeSourceWalletTransactionReference,
} from "./source_wallet_chain_identity.mjs";

export const ROBINHOOD_CORE_WALLET_EVENT_SCHEMA = "raven.robinhood.wallet-economic-event.v1";
export const SOURCE_WALLET_CHAIN_EVENT_SCHEMA = "ravenos.source_wallet_chain_event.v1";

const CHAIN_ID = 4663;
const EVENT_FIELDS = new Set([
  "schema_version", "event_id", "chain", "network", "chain_id", "state", "classification",
  "transaction_hash", "block_number", "block_hash", "observed_finality", "detected_at", "decoded_at",
  "provider_state", "providers", "economic_actor_identity", "wallet_controller_identity_claimed",
  "asset_deltas", "transfer_log_count", "route_evidence", "settlement_truth", "copy_signal",
  "provenance", "execution_boundary", "provider_reconciliation", "supersedes_event_id",
]);
const EXECUTION_FIELDS = new Set([
  "live_copy", "transaction_construction", "signing", "broadcasting", "custody", "fee_collection",
]);
const EVENT_STATES = new Set(["ECONOMIC_ACTOR_OBSERVED"]);
const CLASSIFICATIONS = new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP"]);
const PROVIDER_STATES = new Set(["AGREED", "SINGLE_PROVIDER"]);
const PROVIDERS = new Set(["official_sequencer", "alchemy_wss", "quicknode_wss", "rpc_replay"]);
const FINALITIES = new Set(["pending", "processed", "confirmed", "safe", "finalized"]);
const EVM_ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const EVM_TRANSACTION_RE = /^0x[a-f0-9]{64}$/;
const SIGNED_INTEGER_RE = /^-?(?:0|[1-9]\d*)$/;
const NATIVE_ASSET_ID = "eip155:4663/slip44:60";
const CORE_EVENT_ID_RE = /^rhre_[a-f0-9]{40}$/;
const REQUIRED_EVIDENCE = new Set([
  "independent_provider_confirmation", "current_exact_entry_quote", "current_reverse_liquidation_quote",
  "policy_evaluation", "route_simulation_where_supported",
]);
const FORBIDDEN_MATERIAL_KEYS = new Set([
  "raw_provider_payload", "raw_payload", "transaction", "receipt", "trace", "signed_transaction",
  "serialized_transaction", "private_key", "seed_phrase", "signer_material", "transaction_material",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${field}_invalid`);
  return parsed;
}

function exactFalseExecutionBoundary(value) {
  const row = exactObject(value, EXECUTION_FIELDS, "robinhood_wallet_execution_boundary_invalid");
  for (const field of EXECUTION_FIELDS) if (row[field] !== false) fail("robinhood_wallet_execution_boundary_invalid");
  return row;
}

function assertNoForbiddenMaterial(value, depth = 0) {
  if (depth > 12) fail("robinhood_wallet_event_depth_invalid");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) assertNoForbiddenMaterial(child, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MATERIAL_KEYS.has(String(key).toLowerCase())) fail("robinhood_wallet_forbidden_material");
    assertNoForbiddenMaterial(child, depth + 1);
  }
}

function normalizeAssetDelta(input) {
  const row = exactObject(input, new Set([
    "asset_id", "contract", "token_standard", "delta_raw", "direction", "settlement_asset",
    "settlement_kind", "symbol", "canonical_usdc",
  ]), "robinhood_wallet_asset_delta_invalid");
  const assetId = String(row.asset_id || "").trim().toLowerCase();
  const standard = String(row.token_standard || "").trim().toLowerCase();
  const deltaRaw = String(row.delta_raw ?? "").trim();
  if (!SIGNED_INTEGER_RE.test(deltaRaw) || BigInt(deltaRaw) === 0n) fail("robinhood_wallet_asset_delta_invalid");
  const direction = BigInt(deltaRaw) > 0n ? "in" : "out";
  if (row.direction !== direction || !["native", "erc20"].includes(standard)) fail("robinhood_wallet_asset_delta_invalid");
  let contract = null;
  if (standard === "native") {
    if (assetId !== NATIVE_ASSET_ID || row.contract !== null) fail("robinhood_wallet_asset_delta_invalid");
  } else {
    contract = String(row.contract || "").trim().toLowerCase();
    if (!EVM_ADDRESS_RE.test(contract) || assetId !== `eip155:${CHAIN_ID}/erc20:${contract}`) {
      fail("robinhood_wallet_asset_delta_invalid");
    }
  }
  if (row.canonical_usdc !== false || typeof row.settlement_asset !== "boolean") {
    fail("robinhood_wallet_asset_delta_invalid");
  }
  return freeze({
    asset_id: assetId,
    contract,
    token_standard: standard,
    delta_base_units: deltaRaw,
    direction,
    settlement_asset: row.settlement_asset,
    settlement_kind: row.settlement_asset ? String(row.settlement_kind || "").slice(0, 40) || null : null,
    symbol: row.settlement_asset ? String(row.symbol || "").slice(0, 24) || null : null,
    canonical_usdc: false,
  });
}

function normalizeProviders(providerState, values) {
  if (!PROVIDER_STATES.has(providerState) || !Array.isArray(values)) fail("robinhood_wallet_provider_evidence_invalid");
  const providers = [...new Set(values.map((value) => String(value || "").trim().toLowerCase()))].sort();
  if (providers.some((provider) => !PROVIDERS.has(provider))) fail("robinhood_wallet_provider_evidence_invalid");
  if ((providerState === "AGREED" && providers.length < 2) || (providerState === "SINGLE_PROVIDER" && providers.length !== 1)) {
    fail("robinhood_wallet_provider_evidence_invalid");
  }
  return providers;
}

function assertCoreCopyBoundary(copySignal, providerState) {
  if (!copySignal || typeof copySignal !== "object" || Array.isArray(copySignal)) fail("robinhood_wallet_copy_boundary_invalid");
  const confirmed = providerState === "AGREED";
  if (
    copySignal.state !== "SOURCE_SIGNAL_READY_FOR_ROUTE_PROOF"
    || copySignal.independent_provider_confirmation_complete !== confirmed
    || copySignal.entry_quote_proved !== false
    || copySignal.reverse_exit_proved !== false
    || copySignal.canonical_usdc_settlement_proved !== false
    || copySignal.shadow_decision_created !== false
  ) fail("robinhood_wallet_copy_boundary_invalid");
  const required = new Set(Array.isArray(copySignal.required_next_evidence) ? copySignal.required_next_evidence : []);
  if (required.size !== copySignal.required_next_evidence.length || [...required].some((item) => !REQUIRED_EVIDENCE.has(item))) {
    fail("robinhood_wallet_copy_boundary_invalid");
  }
  for (const item of ["current_exact_entry_quote", "current_reverse_liquidation_quote", "policy_evaluation"]) {
    if (!required.has(item)) fail("robinhood_wallet_copy_boundary_invalid");
  }
  if ((confirmed && required.has("independent_provider_confirmation")) || (!confirmed && !required.has("independent_provider_confirmation"))) {
    fail("robinhood_wallet_copy_boundary_invalid");
  }
}

export function normalizeRobinhoodWalletEconomicEvent(input = {}) {
  const row = exactObject(input, EVENT_FIELDS, "robinhood_wallet_event_invalid");
  assertNoForbiddenMaterial(row);
  if (
    row.schema_version !== ROBINHOOD_CORE_WALLET_EVENT_SCHEMA
    || !CORE_EVENT_ID_RE.test(String(row.event_id || ""))
    || row.chain !== "robinhood"
    || row.network !== "mainnet"
    || Number(row.chain_id) !== CHAIN_ID
    || !EVENT_STATES.has(row.state)
    || !CLASSIFICATIONS.has(row.classification)
    || row.wallet_controller_identity_claimed !== false
  ) fail("robinhood_wallet_event_invalid");
  exactFalseExecutionBoundary(row.execution_boundary);
  const actor = exactObject(row.economic_actor_identity, new Set([
    "wallet_id", "address", "chain", "network", "basis", "transaction_submitter_match",
    "trace_participant", "opposing_net_asset_deltas", "protocol_event_role_used_as_identity",
  ]), "robinhood_wallet_actor_identity_invalid");
  const identity = normalizeSourceWalletChainIdentity({
    chain: actor.chain,
    network: actor.network,
    chain_id: CHAIN_ID,
    address: actor.address,
  });
  if (
    actor.wallet_id !== `eip155:${CHAIN_ID}:${identity.address}`
    || actor.opposing_net_asset_deltas !== true
    || actor.protocol_event_role_used_as_identity !== false
  ) fail("robinhood_wallet_actor_identity_invalid");

  const transactionReference = normalizeSourceWalletTransactionReference({
    chain: "robinhood",
    transaction_reference: row.transaction_hash,
  });
  const blockHash = String(row.block_hash || "").trim().toLowerCase();
  if (!EVM_TRANSACTION_RE.test(blockHash)) fail("robinhood_wallet_block_hash_invalid");
  const blockNumber = integer(row.block_number, "robinhood_wallet_block_number");
  const finality = String(row.observed_finality || "").trim().toLowerCase();
  if (!FINALITIES.has(finality)) fail("robinhood_wallet_finality_invalid");
  const providerState = String(row.provider_state || "").trim().toUpperCase();
  const providers = normalizeProviders(providerState, row.providers);
  assertCoreCopyBoundary(row.copy_signal, providerState);

  if (!Array.isArray(row.asset_deltas) || row.asset_deltas.length < 2 || row.asset_deltas.length > 32) {
    fail("robinhood_wallet_asset_deltas_invalid");
  }
  const assetDeltas = row.asset_deltas.map(normalizeAssetDelta);
  if (new Set(assetDeltas.map((asset) => asset.asset_id)).size !== assetDeltas.length) {
    fail("robinhood_wallet_asset_deltas_invalid");
  }
  if (!assetDeltas.some((asset) => asset.direction === "in") || !assetDeltas.some((asset) => asset.direction === "out")) {
    fail("robinhood_wallet_asset_deltas_invalid");
  }
  const detectedAt = timestamp(row.detected_at, "robinhood_wallet_detected_at");
  const decodedAt = timestamp(row.decoded_at, "robinhood_wallet_decoded_at");
  if (Date.parse(decodedAt) < Date.parse(detectedAt)) fail("robinhood_wallet_timing_invalid");
  const independentlyConfirmed = providerState === "AGREED";
  const sourceWalletId = createSourceWalletId({
    chain: identity.chain,
    network: identity.network,
    chain_id: identity.chain_id,
    address: identity.address,
  });
  const adapted = {
    schema_version: SOURCE_WALLET_CHAIN_EVENT_SCHEMA,
    decode_version: 1,
    event_id: `swe_${digest([row.event_id, sourceWalletId, transactionReference, blockHash, providerState, finality])}`,
    source_event_id: String(row.event_id || "").slice(0, 100),
    source_wallet_id: sourceWalletId,
    source_wallet: {
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      vm_family: identity.vm_family,
      address: identity.address,
    },
    chain_evidence: {
      transaction_reference: transactionReference,
      block_number: blockNumber,
      block_hash: blockHash,
      finality,
      provider_state: providerState,
      providers,
      independent_provider_confirmation_complete: independentlyConfirmed,
      evidence_reference: `eip155:${CHAIN_ID}:tx:${transactionReference}`,
    },
    timing: {
      detected_at: detectedAt,
      decoded_at: decodedAt,
      decode_latency_ms: Date.parse(decodedAt) - Date.parse(detectedAt),
    },
    classification: {
      kind: row.classification,
      observed: true,
      confidence: independentlyConfirmed ? "exact_net_deltas_independently_confirmed" : "exact_net_deltas_single_provider",
      ambiguous: false,
    },
    economic: {
      asset_deltas: assetDeltas,
      source_assets: assetDeltas.filter((asset) => asset.direction === "out"),
      destination_assets: assetDeltas.filter((asset) => asset.direction === "in"),
      canonical_usdc_observed: false,
      marked_value_claimed: false,
      executable_value_claimed: false,
      cost_basis_state: "prospective_source_event_only",
    },
    copy_signal: {
      state: independentlyConfirmed ? "ROUTE_PROOF_REQUIRED" : "PROVIDER_CONFIRMATION_REQUIRED",
      source_signal_ready: independentlyConfirmed,
      eligible_buy_signal: independentlyConfirmed && row.classification === "SWAP_BUY",
      eligible_sell_signal: independentlyConfirmed && row.classification === "SWAP_SELL",
      entry_quote_proved: false,
      reverse_exit_proved: false,
      shadow_decision_created: false,
      required_next_evidence: [...row.copy_signal.required_next_evidence],
    },
    evidence_hash: digest({
      source_event_id: row.event_id,
      source_wallet_id: sourceWalletId,
      transaction_reference: transactionReference,
      block_hash: blockHash,
      provider_state: providerState,
      finality,
      asset_deltas: assetDeltas,
    }),
    privacy: {
      public_source_wallet_only: true,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: Object.fromEntries([...EXECUTION_FIELDS].map((field) => [field, false])),
  };
  return freeze(adapted);
}
