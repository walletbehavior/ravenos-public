import { validateInstrument } from "../cross_market/instrument.mjs";
import { AgenticTradingSchemas } from "./constants.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const CanonicalChainIds = Object.freeze({
  SOLANA_MAINNET: "solana:mainnet-beta",
  SOLANA_DEVNET: "solana:devnet",
  ROBINHOOD_CHAIN_MAINNET: "eip155:4663",
  ROBINHOOD_CHAIN_TESTNET: "eip155:46630",
  BSC_MAINNET: "eip155:56",
  ETHEREUM_MAINNET: "eip155:1",
  BASE_MAINNET: "eip155:8453",
  ARBITRUM_ONE: "eip155:42161",
  HYPERLIQUID_MAINNET: "hyperliquid:mainnet",
  HYPERLIQUID_TESTNET: "hyperliquid:testnet",
  ROBINHOOD_BROKERAGE: "offchain:robinhood-brokerage",
});

export const AssetKinds = Object.freeze([
  "native",
  "wrapped_native",
  "fungible_token",
  "stablecoin",
  "cash",
  "equity",
  "etf",
  "tokenized_equity",
  "synthetic",
]);

export const InstrumentKinds = Object.freeze([
  "spot",
  "perpetual",
  "equity",
  "etf",
  "option",
  "tokenized_equity",
  "lending_position",
  "lp_position",
  "borrowed_asset",
  "synthetic_exposure",
]);

const ASSET_KINDS = new Set(AssetKinds);
const INSTRUMENT_KINDS = new Set(InstrumentKinds);
const REPRESENTATIONS = new Set(["native", "wrapped", "canonical", "bridged", "synthetic", "broker_record"]);
const VENUE_KINDS = new Set(["aggregator", "exchange", "dex", "protocol", "brokerage", "chain_observer"]);
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SAFE_REFERENCE_RE = /^[A-Za-z0-9@._:+-]{1,160}$/;

const CHAIN_ALIASES = Object.freeze(new Map([
  ["solana", CanonicalChainIds.SOLANA_MAINNET],
  ["solana:mainnet", CanonicalChainIds.SOLANA_MAINNET],
  ["solana:mainnet-beta", CanonicalChainIds.SOLANA_MAINNET],
  ["solana:devnet", CanonicalChainIds.SOLANA_DEVNET],
  ["robinhood", CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET],
  ["robinhood-chain", CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET],
  ["robinhood_chain", CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET],
  ["robinhood-mainnet", CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET],
  ["robinhood-testnet", CanonicalChainIds.ROBINHOOD_CHAIN_TESTNET],
  ["bsc", CanonicalChainIds.BSC_MAINNET],
  ["bnb", CanonicalChainIds.BSC_MAINNET],
  ["bnb-chain", CanonicalChainIds.BSC_MAINNET],
  ["binance-smart-chain", CanonicalChainIds.BSC_MAINNET],
  ["base", CanonicalChainIds.BASE_MAINNET],
  ["ethereum", CanonicalChainIds.ETHEREUM_MAINNET],
  ["arbitrum", CanonicalChainIds.ARBITRUM_ONE],
  ["hyperliquid", CanonicalChainIds.HYPERLIQUID_MAINNET],
  ["hyperliquid:mainnet", CanonicalChainIds.HYPERLIQUID_MAINNET],
  ["hyperliquid:testnet", CanonicalChainIds.HYPERLIQUID_TESTNET],
  ["robinhood-brokerage", CanonicalChainIds.ROBINHOOD_BROKERAGE],
  ["offchain:robinhood-brokerage", CanonicalChainIds.ROBINHOOD_BROKERAGE],
]));

const CHAIN_METADATA = Object.freeze({
  [CanonicalChainIds.SOLANA_MAINNET]: { kind: "solana", network: "mainnet-beta", native_gas_asset_symbol: "SOL" },
  [CanonicalChainIds.SOLANA_DEVNET]: { kind: "solana", network: "devnet", native_gas_asset_symbol: "SOL" },
  [CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET]: { kind: "evm", network: "robinhood-mainnet", native_gas_asset_symbol: "ETH", native_gas_asset_reference: "60", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.ROBINHOOD_CHAIN_TESTNET]: { kind: "evm", network: "robinhood-testnet", native_gas_asset_symbol: "ETH", native_gas_asset_reference: "60", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.BSC_MAINNET]: { kind: "evm", network: "bsc-mainnet", native_gas_asset_symbol: "BNB", native_gas_asset_reference: "714", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.ETHEREUM_MAINNET]: { kind: "evm", network: "ethereum-mainnet", native_gas_asset_symbol: "ETH", native_gas_asset_reference: "60", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.BASE_MAINNET]: { kind: "evm", network: "base-mainnet", native_gas_asset_symbol: "ETH", native_gas_asset_reference: "60", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.ARBITRUM_ONE]: { kind: "evm", network: "arbitrum-one", native_gas_asset_symbol: "ETH", native_gas_asset_reference: "60", native_gas_asset_decimals: 18 },
  [CanonicalChainIds.HYPERLIQUID_MAINNET]: { kind: "venue_ledger", network: "mainnet", native_gas_asset_symbol: null },
  [CanonicalChainIds.HYPERLIQUID_TESTNET]: { kind: "venue_ledger", network: "testnet", native_gas_asset_symbol: null },
  [CanonicalChainIds.ROBINHOOD_BROKERAGE]: { kind: "offchain", network: "production", native_gas_asset_symbol: null },
});

const KNOWN_VENUES = Object.freeze({
  jupiter: {
    slug: "jupiter",
    chain_id: CanonicalChainIds.SOLANA_MAINNET,
    environment: "mainnet",
    kind: "aggregator",
    capabilities: ["spot", "quote", "preview", "paper"],
  },
  hyperliquid: {
    slug: "hyperliquid",
    chain_id: CanonicalChainIds.HYPERLIQUID_MAINNET,
    environment: "mainnet",
    kind: "exchange",
    capabilities: ["spot", "perpetual", "quote", "preview", "paper", "account_state"],
  },
  "hyperliquid-testnet": {
    slug: "hyperliquid",
    chain_id: CanonicalChainIds.HYPERLIQUID_TESTNET,
    environment: "testnet",
    kind: "exchange",
    capabilities: ["spot", "perpetual", "quote", "preview", "paper", "account_state"],
  },
  "robinhood-chain": {
    slug: "robinhood-chain",
    chain_id: CanonicalChainIds.ROBINHOOD_CHAIN_MAINNET,
    environment: "mainnet",
    kind: "chain_observer",
    capabilities: ["observe", "quote", "preview", "paper"],
  },
  "robinhood-chain-testnet": {
    slug: "robinhood-chain",
    chain_id: CanonicalChainIds.ROBINHOOD_CHAIN_TESTNET,
    environment: "testnet",
    kind: "chain_observer",
    capabilities: ["observe", "quote", "preview", "paper"],
  },
  "robinhood-brokerage": {
    slug: "robinhood-brokerage",
    chain_id: CanonicalChainIds.ROBINHOOD_BROKERAGE,
    environment: "production",
    kind: "brokerage",
    capabilities: ["observe", "capability_discovery", "preview", "paper"],
  },
});

function text(value) {
  return String(value ?? "").trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value).toLowerCase()).filter(Boolean))].sort();
}

function normalizeEip155Reference(value) {
  const reference = text(value);
  if (!/^[1-9][0-9]*$/.test(reference)) throw new Error("chain_id_invalid");
  return BigInt(reference).toString();
}

function chainIdFromInput(input) {
  if (typeof input === "number" || typeof input === "bigint") return `eip155:${normalizeEip155Reference(input)}`;
  if (typeof input === "string") {
    const raw = text(input).toLowerCase();
    if (CHAIN_ALIASES.has(raw)) return CHAIN_ALIASES.get(raw);
    if (raw.startsWith("eip155:")) return `eip155:${normalizeEip155Reference(raw.slice(7))}`;
    if (/^[1-9][0-9]*$/.test(raw)) return `eip155:${normalizeEip155Reference(raw)}`;
    throw new Error("chain_id_invalid");
  }
  if (!input || typeof input !== "object") throw new Error("chain_id_required");
  if (input.chain_id || input.chainId) return chainIdFromInput(input.chain_id || input.chainId);
  const namespace = text(input.namespace).toLowerCase();
  const reference = text(input.reference || input.network).toLowerCase();
  if (namespace === "eip155") return `eip155:${normalizeEip155Reference(reference)}`;
  if (namespace === "solana" && new Set(["mainnet-beta", "devnet"]).has(reference)) return `solana:${reference}`;
  if (namespace === "hyperliquid" && new Set(["mainnet", "testnet"]).has(reference)) return `hyperliquid:${reference}`;
  if (namespace === "offchain" && reference === "robinhood-brokerage") return CanonicalChainIds.ROBINHOOD_BROKERAGE;
  throw new Error("chain_id_invalid");
}

export function normalizeChainIdentity(input) {
  const chainId = chainIdFromInput(input);
  const [namespace, ...referenceParts] = chainId.split(":");
  const reference = referenceParts.join(":");
  const metadata = CHAIN_METADATA[chainId] || (namespace === "eip155"
    ? { kind: "evm", network: `eip155-${reference}`, native_gas_asset_symbol: null, native_gas_asset_reference: null, native_gas_asset_decimals: null }
    : null);
  if (!metadata) throw new Error("chain_id_unsupported");
  return deepFreeze({
    schema_version: AgenticTradingSchemas.chain_identity,
    chain_id: chainId,
    namespace,
    reference,
    kind: metadata.kind,
    network: metadata.network,
    native_gas_asset_symbol: metadata.native_gas_asset_symbol,
    native_gas_asset_reference: metadata.native_gas_asset_reference || null,
    native_gas_asset_decimals: metadata.native_gas_asset_decimals ?? null,
    execution_domain: metadata.kind === "offchain" ? "broker_account" : metadata.kind === "venue_ledger" ? "venue_account" : "chain_account",
  });
}

function venueInput(input) {
  if (typeof input === "string") {
    const alias = text(input).toLowerCase();
    if (KNOWN_VENUES[alias]) return KNOWN_VENUES[alias];
    throw new Error("venue_identity_object_required");
  }
  if (!input || typeof input !== "object") throw new Error("venue_required");
  if (input.venue_id && input.slug && input.chain_id) return input;
  const alias = text(input.venue || input.slug || input.name).toLowerCase();
  if (KNOWN_VENUES[alias] && !input.chain_id && !input.chain) return { ...KNOWN_VENUES[alias], ...input };
  return input;
}

export function normalizeVenueIdentity(input) {
  const source = venueInput(input);
  const slug = requiredText(source.slug || source.venue || source.name, "venue_slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw new Error("venue_slug_invalid");
  const chain = normalizeChainIdentity(source.chain_id || source.chain);
  const environment = requiredText(source.environment || source.network || chain.network, "venue_environment").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(environment)) throw new Error("venue_environment_invalid");
  const kind = text(source.kind || "exchange").toLowerCase();
  if (!VENUE_KINDS.has(kind)) throw new Error("venue_kind_invalid");
  const venueId = `${slug}@${chain.chain_id}#${environment}`;
  if (source.venue_id && source.venue_id !== venueId) throw new Error("venue_id_mismatch");
  return deepFreeze({
    schema_version: AgenticTradingSchemas.venue_identity,
    venue_id: venueId,
    slug,
    environment,
    kind,
    chain_id: chain.chain_id,
    capabilities: uniqueStrings(source.capabilities),
    live_placement_enabled: false,
  });
}

function normalizeAssetReference({ chain, standard, reference, symbol }) {
  if (standard === "native") return text(reference || symbol).toLowerCase() || "native";
  if (standard === "slip44") {
    const normalized = text(reference);
    if (chain.kind !== "evm" || !/^[0-9]+$/.test(normalized)) throw new Error("asset_native_reference_invalid");
    return BigInt(normalized).toString();
  }
  if (chain.kind === "evm" && standard === "erc20") {
    if (!EVM_ADDRESS_RE.test(reference)) throw new Error("asset_contract_invalid");
    return reference.toLowerCase();
  }
  if (chain.kind === "solana" && new Set(["spl", "token-2022"]).has(standard)) {
    if (!SOLANA_ADDRESS_RE.test(reference)) throw new Error("asset_mint_invalid");
    return reference;
  }
  if (chain.kind === "solana" && standard === "solana-mint") {
    if (!SOLANA_ADDRESS_RE.test(reference)) throw new Error("asset_mint_invalid");
    return reference;
  }
  if (!SAFE_REFERENCE_RE.test(reference)) throw new Error("asset_reference_invalid");
  return chain.kind === "offchain" ? reference : reference.toLowerCase();
}

function defaultAssetStandard(chain, kind) {
  if (kind === "native") return chain.kind === "evm" ? "slip44" : "native";
  if (chain.kind === "evm") return "erc20";
  if (chain.kind === "solana") return "spl";
  if (chain.kind === "venue_ledger") return "venue-asset";
  return "broker-asset";
}

export function normalizeAssetIdentity(input = {}) {
  if (!input || typeof input !== "object") throw new Error("asset_identity_required");
  const chain = normalizeChainIdentity(input.chain_id || input.chain);
  const kind = text(input.kind || input.asset_kind || "fungible_token").toLowerCase();
  if (!ASSET_KINDS.has(kind)) throw new Error("asset_kind_invalid");
  const symbol = requiredText(input.symbol, "asset_symbol").toUpperCase();
  const standard = requiredText(input.standard || defaultAssetStandard(chain, kind), "asset_standard").toLowerCase();
  if (chain.kind === "evm" && kind === "native" && standard !== "slip44") throw new Error("asset_standard_chain_mismatch");
  if (standard === "slip44" && (chain.kind !== "evm" || kind !== "native")) throw new Error("asset_standard_chain_mismatch");
  if (standard === "erc20" && chain.kind !== "evm") throw new Error("asset_standard_chain_mismatch");
  if (new Set(["spl", "token-2022"]).has(standard) && chain.kind !== "solana") throw new Error("asset_standard_chain_mismatch");
  if (standard === "solana-mint" && chain.kind !== "solana") throw new Error("asset_standard_chain_mismatch");
  if (standard === "venue-asset" && chain.kind !== "venue_ledger") throw new Error("asset_standard_chain_mismatch");
  if (standard === "broker-asset" && chain.kind !== "offchain") throw new Error("asset_standard_chain_mismatch");
  const rawReference = requiredText(
    input.reference || input.address || input.contract_address || input.mint || input.asset_code || (kind === "native" ? chain.native_gas_asset_reference || symbol : ""),
    "asset_reference",
  );
  const reference = normalizeAssetReference({ chain, standard, reference: rawReference, symbol });
  if (kind === "stablecoin" && !text(input.representation)) throw new Error("stablecoin_representation_required");
  const representation = text(input.representation || (kind === "native" ? "native" : kind === "wrapped_native" ? "wrapped" : chain.kind === "offchain" ? "broker_record" : "canonical")).toLowerCase();
  if (!REPRESENTATIONS.has(representation)) throw new Error("asset_representation_invalid");
  if (kind === "native" && representation !== "native") throw new Error("asset_native_representation_invalid");
  const issuerId = text(input.issuer_id || input.issuerId).toLowerCase() || null;
  if (kind === "stablecoin" && !issuerId) throw new Error("stablecoin_issuer_required");
  const decimals = input.decimals === null || input.decimals === undefined ? null : Number(input.decimals);
  if (decimals !== null && (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)) throw new Error("asset_decimals_invalid");
  if (kind === "native" && chain.native_gas_asset_reference) {
    if (reference !== chain.native_gas_asset_reference || symbol !== chain.native_gas_asset_symbol) throw new Error("asset_native_metadata_mismatch");
    if (decimals !== null && decimals !== chain.native_gas_asset_decimals) throw new Error("asset_native_decimals_mismatch");
  }
  const assetId = `${chain.chain_id}/${standard}:${reference}`;
  if (input.asset_id && input.asset_id !== assetId) throw new Error("asset_id_mismatch");
  return deepFreeze({
    schema_version: AgenticTradingSchemas.asset_identity,
    asset_id: assetId,
    chain_id: chain.chain_id,
    kind,
    standard,
    reference,
    symbol,
    decimals,
    issuer_id: issuerId,
    representation,
    underlying_asset_id: text(input.underlying_asset_id) || null,
    verification_state: text(input.verification_state || "unverified").toLowerCase(),
  });
}

function assertAssetOnVenue(asset, venue, field) {
  if (asset.chain_id !== venue.chain_id) throw new Error(`${field}_venue_chain_mismatch`);
}

export function normalizeInstrumentIdentity(input = {}) {
  if (!input || typeof input !== "object") throw new Error("instrument_identity_required");
  const kind = text(input.kind || input.instrument_type || input.instrument_kind).toLowerCase();
  if (!INSTRUMENT_KINDS.has(kind)) throw new Error("instrument_kind_invalid");
  const venue = normalizeVenueIdentity(input.venue || input.venue_identity);
  const baseAsset = normalizeAssetIdentity(input.base_asset);
  const quoteAsset = normalizeAssetIdentity(input.quote_asset);
  const settlementAsset = normalizeAssetIdentity(input.settlement_asset || input.quote_asset);
  assertAssetOnVenue(baseAsset, venue, "base_asset");
  assertAssetOnVenue(quoteAsset, venue, "quote_asset");
  assertAssetOnVenue(settlementAsset, venue, "settlement_asset");
  const marketReference = text(input.market_reference || input.market_ref || input.market_id) || null;
  const identityCore = {
    kind,
    venue_id: venue.venue_id,
    base_asset_id: baseAsset.asset_id,
    quote_asset_id: quoteAsset.asset_id,
    settlement_asset_id: settlementAsset.asset_id,
    market_reference: marketReference,
    underlying_asset_id: text(input.underlying_asset_id) || null,
    expiry: text(input.expiry) || null,
    strike: input.strike === null || input.strike === undefined ? null : text(input.strike),
    option_right: text(input.option_right).toLowerCase() || null,
  };
  if (kind === "option") {
    if (!identityCore.underlying_asset_id) throw new Error("option_underlying_required");
    if (!identityCore.expiry || !identityCore.strike || !new Set(["call", "put"]).has(identityCore.option_right)) throw new Error("option_terms_invalid");
  }
  if (kind === "tokenized_equity" && !identityCore.underlying_asset_id) throw new Error("tokenized_equity_underlying_required");
  const instrumentId = `instrument:${agenticContractHash(identityCore)}`;
  if (input.instrument_id && input.instrument_id !== instrumentId) throw new Error("instrument_id_mismatch");
  return deepFreeze({
    schema_version: AgenticTradingSchemas.instrument_identity,
    instrument_id: instrumentId,
    ...identityCore,
    chain_id: venue.chain_id,
    venue,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    settlement_asset: settlementAsset,
    display_symbol: text(input.display_symbol || `${baseAsset.symbol}/${quoteAsset.symbol}`).toUpperCase(),
  });
}

export function bridgeCrossMarketInstrument(input = {}, exactIdentity = {}) {
  const validation = validateInstrument(input);
  if (!validation.ok) throw new Error(`cross_market_instrument_invalid:${validation.errors.join(",")}`);
  if (!exactIdentity.base_asset || !exactIdentity.quote_asset || !exactIdentity.settlement_asset || !exactIdentity.venue) {
    throw new Error("cross_market_exact_identity_required");
  }
  const kindMap = {
    token: "spot",
    exact_pool: "spot",
    perpetual: "perpetual",
    equity: "equity",
    etf: "etf",
    option: "option",
  };
  const kind = kindMap[validation.instrument.instrument_type];
  if (!kind) throw new Error("cross_market_instrument_kind_unsupported");
  const baseAsset = normalizeAssetIdentity(exactIdentity.base_asset);
  const legacySymbol = validation.instrument.base_asset.symbol;
  if (legacySymbol !== "UNKNOWN" && baseAsset.symbol !== legacySymbol) throw new Error("cross_market_base_symbol_contradiction");
  return normalizeInstrumentIdentity({
    kind,
    venue: exactIdentity.venue,
    base_asset: baseAsset,
    quote_asset: exactIdentity.quote_asset,
    settlement_asset: exactIdentity.settlement_asset,
    market_reference: exactIdentity.market_reference
      || validation.instrument.market_identity.pool_address
      || validation.instrument.market_identity.market_id,
    underlying_asset_id: exactIdentity.underlying_asset_id || validation.instrument.underlying_instrument_id,
    expiry: exactIdentity.expiry || validation.instrument.market_identity.option?.expiry,
    strike: exactIdentity.strike ?? validation.instrument.market_identity.option?.strike,
    option_right: exactIdentity.option_right || validation.instrument.market_identity.option?.right,
    display_symbol: validation.instrument.symbol,
  });
}

export function normalizeSettlementAsset(input = {}) {
  const asset = normalizeAssetIdentity(input.asset || input);
  const accountingCurrency = requiredText(input.accounting_currency || "USDC", "accounting_currency").toUpperCase();
  const quotedCurrency = requiredText(input.quoted_currency || asset.symbol, "quoted_currency").toUpperCase();
  const role = text(input.role || "settlement").toLowerCase();
  if (!new Set(["accounting", "quoted", "settlement", "fee", "gas"]).has(role)) throw new Error("settlement_role_invalid");
  return deepFreeze({
    schema_version: AgenticTradingSchemas.settlement_asset,
    asset,
    asset_id: asset.asset_id,
    chain_id: asset.chain_id,
    role,
    accounting_currency: accountingCurrency,
    quoted_currency: quotedCurrency,
    immediately_transferable_across_chains: false,
  });
}
