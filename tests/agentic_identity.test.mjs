import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeCrossMarketInstrument,
  CanonicalChainIds,
  normalizeAssetIdentity,
  normalizeChainIdentity,
  normalizeInstrumentIdentity,
  normalizeSettlementAsset,
  normalizeVenueIdentity,
} from "../lib/agentic_trading/identity.mjs";

const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_TOKEN_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6qM5UXB263hLtB1p";

function solAsset({ symbol = "USDC", mint = SOL_USDC_MINT, kind = "stablecoin", issuer = "circle", representation = "canonical" } = {}) {
  return normalizeAssetIdentity({
    chain_id: CanonicalChainIds.SOLANA_MAINNET,
    kind,
    standard: "spl",
    reference: mint,
    symbol,
    decimals: 6,
    issuer_id: kind === "stablecoin" ? issuer : undefined,
    representation,
    verification_state: "verified",
  });
}

test("chain identity uses exact network identifiers and Robinhood brokerage stays offchain", () => {
  assert.equal(normalizeChainIdentity("robinhood-chain").chain_id, "eip155:4663");
  assert.equal(normalizeChainIdentity("46630").chain_id, "eip155:46630");
  assert.equal(normalizeChainIdentity("robinhood-brokerage").kind, "offchain");
  assert.notEqual(normalizeChainIdentity("robinhood-chain").chain_id, normalizeChainIdentity("robinhood-brokerage").chain_id);
});

test("same ticker on different chains cannot collide", () => {
  const solanaToken = solAsset({ symbol: "RAVEN", mint: SOL_TOKEN_MINT, kind: "fungible_token" });
  const evmToken = normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "fungible_token",
    standard: "erc20",
    reference: "0x1111111111111111111111111111111111111111",
    symbol: "RAVEN",
    decimals: 18,
    representation: "canonical",
  });
  assert.equal(solanaToken.symbol, evmToken.symbol);
  assert.notEqual(solanaToken.asset_id, evmToken.asset_id);
  assert.match(solanaToken.asset_id, /^solana:mainnet-beta\/spl:/);
  assert.match(evmToken.asset_id, /^eip155:4663\/erc20:/);
});

test("canonical and bridged USDC representations remain distinct", () => {
  const canonical = normalizeAssetIdentity({
    chain_id: "eip155:8453",
    kind: "stablecoin",
    standard: "erc20",
    reference: "0x1111111111111111111111111111111111111111",
    symbol: "USDC",
    issuer_id: "circle",
    representation: "canonical",
  });
  const bridged = normalizeAssetIdentity({
    chain_id: "eip155:8453",
    kind: "stablecoin",
    standard: "erc20",
    reference: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    issuer_id: "bridge-provider",
    representation: "bridged",
  });
  assert.notEqual(canonical.asset_id, bridged.asset_id);
  assert.equal(canonical.representation, "canonical");
  assert.equal(bridged.representation, "bridged");
});

test("spot and perpetual instruments remain venue-specific even with the same base ticker", () => {
  const sol = solAsset({ symbol: "SOL", mint: SOL_TOKEN_MINT, kind: "fungible_token" });
  const usdc = solAsset();
  const spot = normalizeInstrumentIdentity({
    kind: "spot",
    venue: "jupiter",
    base_asset: sol,
    quote_asset: usdc,
    settlement_asset: usdc,
  });
  const hlSol = normalizeAssetIdentity({
    chain_id: "hyperliquid:mainnet",
    kind: "fungible_token",
    standard: "venue-asset",
    reference: "SOL",
    symbol: "SOL",
    representation: "native",
  });
  const hlUsdc = normalizeAssetIdentity({
    chain_id: "hyperliquid:mainnet",
    kind: "stablecoin",
    standard: "venue-asset",
    reference: "USDC",
    symbol: "USDC",
    issuer_id: "circle",
    representation: "canonical",
  });
  const perpetual = normalizeInstrumentIdentity({
    kind: "perpetual",
    venue: "hyperliquid",
    base_asset: hlSol,
    quote_asset: hlUsdc,
    settlement_asset: hlUsdc,
    market_reference: "SOL",
  });
  assert.notEqual(spot.instrument_id, perpetual.instrument_id);
  assert.equal(spot.kind, "spot");
  assert.equal(perpetual.kind, "perpetual");
});

test("venue and asset chain mismatches are rejected", () => {
  const solToken = solAsset({ symbol: "SOL", mint: SOL_TOKEN_MINT, kind: "fungible_token" });
  const evmUsdc = normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "stablecoin",
    standard: "erc20",
    reference: "0x1111111111111111111111111111111111111111",
    symbol: "USDC",
    issuer_id: "circle",
    representation: "canonical",
  });
  assert.throws(() => normalizeInstrumentIdentity({
    kind: "spot",
    venue: "jupiter",
    base_asset: solToken,
    quote_asset: evmUsdc,
    settlement_asset: evmUsdc,
  }), /quote_asset_venue_chain_mismatch/);
});

test("future EVM venues retain exact chain binding and live placement defaults off", () => {
  const venue = normalizeVenueIdentity({
    slug: "future-dex",
    chain_id: "eip155:42161",
    environment: "mainnet",
    kind: "dex",
    capabilities: ["spot", "paper"],
  });
  assert.match(venue.venue_id, /eip155:42161/);
  assert.equal(venue.live_placement_enabled, false);
});

test("Robinhood Chain native ETH reuses the existing canonical slip44 identity", () => {
  const nativeEth = normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "native",
    symbol: "ETH",
    decimals: 18,
  });
  assert.equal(nativeEth.asset_id, "eip155:4663/slip44:60");
  assert.equal(nativeEth.reference, "60");
  assert.throws(() => normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "native",
    standard: "slip44",
    reference: "60",
    symbol: "WETH",
  }), /asset_native_metadata_mismatch/);
  assert.throws(() => normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "native",
    standard: "slip44",
    reference: "714",
    symbol: "ETH",
  }), /asset_native_metadata_mismatch/);
  assert.throws(() => normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "native",
    standard: "native",
    reference: "ETH",
    symbol: "ETH",
  }), /asset_standard_chain_mismatch/);
  assert.throws(() => normalizeAssetIdentity({
    chain_id: "eip155:4663",
    kind: "native",
    standard: "slip44",
    reference: "ETH",
    symbol: "ETH",
  }), /asset_native_reference_invalid/);
});

test("settlement identity does not make chain-local capital cross-chain transferable", () => {
  const settlement = normalizeSettlementAsset({ asset: solAsset(), role: "settlement", accounting_currency: "USDC" });
  assert.equal(settlement.chain_id, CanonicalChainIds.SOLANA_MAINNET);
  assert.equal(settlement.immediately_transferable_across_chains, false);
});

test("existing cross-market instruments bridge only with exact asset and venue identity", () => {
  const usdc = solAsset();
  const token = solAsset({ symbol: "SOL", mint: SOL_TOKEN_MINT, kind: "fungible_token" });
  const legacy = {
    instrument_type: "token",
    asset_class: "crypto",
    symbol: "SOL",
    chain: "solana",
    venue: "jupiter",
  };
  assert.throws(() => bridgeCrossMarketInstrument(legacy), /cross_market_exact_identity_required/);
  const bridged = bridgeCrossMarketInstrument(legacy, {
    venue: "jupiter",
    base_asset: token,
    quote_asset: usdc,
    settlement_asset: usdc,
  });
  assert.equal(bridged.kind, "spot");
  assert.equal(bridged.base_asset.asset_id, token.asset_id);
});
