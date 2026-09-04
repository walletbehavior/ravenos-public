import { createHash } from "node:crypto";

export const SOURCE_WALLET_CHAIN_IDENTITY_SCHEMA = "ravenos.source_wallet_chain_identity.v1";

export const SourceWalletChainRegistry = Object.freeze({
  solana: Object.freeze({
    chain: "solana",
    network: "mainnet",
    chain_id: "solana",
    vm_family: "svm",
    source_id_namespace: "sol",
    address_pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    transaction_pattern: /^[1-9A-HJ-NP-Za-km-z]{64,100}$/,
  }),
  robinhood: Object.freeze({
    chain: "robinhood",
    network: "mainnet",
    chain_id: 4663,
    vm_family: "evm",
    source_id_namespace: "rh",
    address_pattern: /^0x[a-fA-F0-9]{40}$/,
    transaction_pattern: /^0x[a-fA-F0-9]{64}$/,
  }),
  bsc: Object.freeze({
    chain: "bsc",
    network: "mainnet",
    chain_id: 56,
    vm_family: "evm",
    source_id_namespace: "bsc",
    address_pattern: /^0x[a-fA-F0-9]{40}$/,
    transaction_pattern: /^0x[a-fA-F0-9]{64}$/,
  }),
  base: Object.freeze({
    chain: "base",
    network: "mainnet",
    chain_id: 8453,
    vm_family: "evm",
    source_id_namespace: "base",
    address_pattern: /^0x[a-fA-F0-9]{40}$/,
    transaction_pattern: /^0x[a-fA-F0-9]{64}$/,
  }),
  ethereum: Object.freeze({
    chain: "ethereum",
    network: "mainnet",
    chain_id: 1,
    vm_family: "evm",
    source_id_namespace: "eth",
    address_pattern: /^0x[a-fA-F0-9]{40}$/,
    transaction_pattern: /^0x[a-fA-F0-9]{64}$/,
  }),
});

const IDENTITY_FIELDS = new Set(["chain", "network", "chain_id", "address"]);

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

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function registryEntry(chainValue) {
  const chain = String(chainValue || "").trim().toLowerCase();
  const entry = SourceWalletChainRegistry[chain];
  if (!entry) fail("source_wallet_chain_unsupported");
  return entry;
}

function normalizedAddress(entry, value) {
  const address = String(value || "").trim();
  if (!entry.address_pattern.test(address)) fail("source_wallet_address_invalid");
  return entry.vm_family === "evm" ? address.toLowerCase() : address;
}

export function normalizeSourceWalletChainIdentity(input = {}) {
  const row = exactObject(input, IDENTITY_FIELDS, "source_wallet_identity_invalid");
  const entry = registryEntry(row.chain);
  if (String(row.network || "").trim().toLowerCase() !== entry.network) {
    fail("source_wallet_network_unsupported");
  }
  if (row.chain_id !== undefined && row.chain_id !== null && String(row.chain_id) !== String(entry.chain_id)) {
    fail("source_wallet_chain_id_mismatch");
  }
  const address = normalizedAddress(entry, row.address);
  return freeze({
    schema_version: SOURCE_WALLET_CHAIN_IDENTITY_SCHEMA,
    source_wallet_id: `sw_${entry.source_id_namespace}_${digest([entry.chain, entry.network, address])}`,
    chain: entry.chain,
    network: entry.network,
    chain_id: entry.chain_id,
    vm_family: entry.vm_family,
    address,
    public_chain_address_only: true,
    controller_identity_claimed: false,
    subscriber_identity_included: false,
  });
}

export function createSourceWalletId(input = {}) {
  return normalizeSourceWalletChainIdentity(input).source_wallet_id;
}

export function normalizeSourceWalletTransactionReference({ chain, network = "mainnet", transaction_reference: value } = {}) {
  const entry = registryEntry(chain);
  if (String(network || "").trim().toLowerCase() !== entry.network) {
    fail("source_wallet_network_unsupported");
  }
  const transaction = String(value || "").trim();
  if (!entry.transaction_pattern.test(transaction)) fail("source_wallet_transaction_reference_invalid");
  return entry.vm_family === "evm" ? transaction.toLowerCase() : transaction;
}
