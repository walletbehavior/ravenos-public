import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnifiedPortfolioSnapshot,
  inspectLocalCapital,
  projectPartialPlanExposure,
  verifyUnifiedPortfolioSnapshot,
} from "../lib/agentic_trading/unified_portfolio.mjs";

const observedAt = "2026-09-01T18:00:00.000Z";
const solVenue = {
  slug: "jupiter",
  chain_id: "solana:mainnet-beta",
  environment: "mainnet",
  kind: "aggregator",
  capabilities: ["quote", "paper"],
};
const hlVenue = {
  slug: "hyperliquid",
  chain_id: "hyperliquid:mainnet",
  environment: "mainnet",
  kind: "exchange",
  capabilities: ["quote", "paper"],
};
const solUsdc = {
  chain_id: "solana:mainnet-beta",
  kind: "stablecoin",
  standard: "spl",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC",
  decimals: 6,
  issuer_id: "circle",
  representation: "canonical",
};
const hlUsdc = {
  chain_id: "hyperliquid:mainnet",
  kind: "stablecoin",
  standard: "venue-asset",
  reference: "usdc",
  symbol: "USDC",
  decimals: 6,
  issuer_id: "circle",
  representation: "canonical",
};
const sol = {
  chain_id: "solana:mainnet-beta",
  kind: "native",
  standard: "native",
  reference: "sol",
  symbol: "SOL",
  decimals: 9,
  representation: "native",
};
const hlSol = {
  chain_id: "hyperliquid:mainnet",
  kind: "synthetic",
  standard: "venue-asset",
  reference: "sol-perp",
  symbol: "SOL",
  decimals: 8,
  representation: "synthetic",
};

function fixture(overrides = {}) {
  return createUnifiedPortfolioSnapshot({
    snapshot_id: "portfolio-1",
    owner_tenant_id: "tenant-1",
    observed_at: observedAt,
    accounts: [
      { account_id: "sol-account", chain_id: "solana", venue: solVenue, provider: "nexus", provider_health: "healthy", finality: "confirmed", observed_at: observedAt },
      { account_id: "hl-account", chain_id: "hyperliquid", venue: hlVenue, provider: "hyperliquid", provider_health: "healthy", finality: "confirmed", observed_at: observedAt },
    ],
    balances: [
      { observation_id: "b-sol-usdc", economic_lot_id: "lot-sol-usdc", account_id: "sol-account", asset: solUsdc, state: "available", quantity_atomic: "500000000", available_atomic: "500000000", marked_value_usdc_micros: "500000000", executable_value_usdc_micros: "499500000", valuation_state: "executable", provider: "nexus", observed_at: observedAt },
      { observation_id: "b-sol-gas", economic_lot_id: "lot-sol-gas", account_id: "sol-account", asset: sol, state: "available", quantity_atomic: "20000000", available_atomic: "20000000", marked_value_usdc_micros: "4000000", executable_value_usdc_micros: "3900000", valuation_state: "executable", native_gas: true, provider: "nexus", observed_at: observedAt },
      { observation_id: "b-hl-usdc", economic_lot_id: "lot-hl-usdc", account_id: "hl-account", asset: hlUsdc, state: "available", quantity_atomic: "1000000000", available_atomic: "1000000000", marked_value_usdc_micros: "1000000000", executable_value_usdc_micros: "1000000000", valuation_state: "executable", provider: "hyperliquid", observed_at: observedAt },
    ],
    positions: [{
      position_id: "hl-sol-short",
      economic_lot_id: "lot-hl-sol-short",
      account_id: "hl-account",
      instrument: { kind: "perpetual", venue: hlVenue, base_asset: hlSol, quote_asset: hlUsdc, settlement_asset: hlUsdc, market_reference: "SOL" },
      side: "short",
      quantity_atomic: "250000000",
      marked_value_usdc_micros: "50000000",
      executable_value_usdc_micros: "49900000",
      gross_exposure_usdc_micros: "50000000",
      valuation_state: "executable",
      provider: "hyperliquid",
      observed_at: observedAt,
    }],
    liabilities: [],
    reservations: [],
    pending_plans: [],
    ...overrides,
  });
}

test("unified portfolio keeps same-symbol balances chain and venue local", () => {
  const snapshot = fixture();
  assert.equal(snapshot.balances.length, 3);
  const solAssetId = snapshot.balance_components.find((row) => row.observation_id === "b-sol-usdc").asset_id;
  const hlAssetId = snapshot.balance_components.find((row) => row.observation_id === "b-hl-usdc").asset_id;
  assert.notEqual(solAssetId, hlAssetId);
  assert.equal(verifyUnifiedPortfolioSnapshot(snapshot).ok, true);
});

test("capital on Hyperliquid cannot satisfy a Solana order", () => {
  const snapshot = fixture({
    balances: [{ observation_id: "b-hl-usdc", economic_lot_id: "lot-hl-usdc", account_id: "hl-account", asset: hlUsdc, state: "available", quantity_atomic: "1000000000", available_atomic: "1000000000", marked_value_usdc_micros: "1000000000", executable_value_usdc_micros: "1000000000", valuation_state: "executable", provider: "hyperliquid", observed_at: observedAt }],
    positions: [],
  });
  const result = inspectLocalCapital(snapshot, {
    chain_id: "solana:mainnet-beta",
    venue_id: "jupiter@solana:mainnet-beta#mainnet",
    asset_id: "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    required_atomic: "100000000",
  });
  assert.equal(result.result, "indeterminate");
  assert.equal(result.reason, "local_capital_unavailable");
  assert.equal(snapshot.cross_chain_capital_immediately_transferable, false);
});

test("stale local capital and missing gas both fail closed", () => {
  const stale = fixture({
    balances: [{ observation_id: "b-sol-usdc", economic_lot_id: "lot-sol-usdc", account_id: "sol-account", asset: solUsdc, state: "stale", quantity_atomic: "500000000", available_atomic: null, marked_value_usdc_micros: "500000000", executable_value_usdc_micros: null, valuation_state: "stale", provider: "nexus", observed_at: observedAt }],
    positions: [],
  });
  const capital = inspectLocalCapital(stale, {
    chain_id: "solana:mainnet-beta",
    venue_id: "jupiter@solana:mainnet-beta#mainnet",
    asset_id: "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    required_atomic: "1000000",
  });
  assert.equal(capital.result, "indeterminate");

  const noGas = fixture({ balances: fixture().balance_components.filter((row) => row.observation_id !== "b-sol-gas"), positions: [] });
  const settlement = noGas.balance_components.find((row) => row.observation_id === "b-sol-usdc");
  const gas = inspectLocalCapital(noGas, {
    chain_id: settlement.chain_id,
    venue_id: settlement.venue_id,
    asset_id: settlement.asset_id,
    required_atomic: "1000000",
    gas: {
      chain_id: "solana:mainnet-beta",
      venue_id: settlement.venue_id,
      asset_id: "solana:mainnet-beta/native:sol",
      required_atomic: "5000",
    },
  });
  assert.equal(gas.result, "indeterminate");
  assert.equal(gas.reason, "native_gas_unavailable");
});

test("partial multi-leg plan exposes the filled spot leg and requires new policy for repair", () => {
  const snapshot = fixture({
    pending_plans: [{
      plan_id: "plan-spot-hedge",
      state: "partially_executed",
      legs: [
        { leg_id: "sol-spot", chain_id: "solana:mainnet-beta", venue_id: "jupiter@solana:mainnet-beta#mainnet", instrument_id: "spot-sol", status: "filled", gross_exposure_usdc_micros: "100000000" },
        { leg_id: "hl-hedge", chain_id: "hyperliquid:mainnet", venue_id: "hyperliquid@hyperliquid:mainnet#mainnet", instrument_id: "perp-sol", status: "expired", gross_exposure_usdc_micros: "100000000" },
      ],
    }],
  });
  const projection = projectPartialPlanExposure(snapshot, "plan-spot-hedge");
  assert.equal(projection.partially_executed, true);
  assert.deepEqual(projection.filled_legs, ["sol-spot"]);
  assert.deepEqual(projection.unresolved_legs, ["hl-hedge"]);
  assert.equal(projection.resulting_gross_exposure_usdc_micros, "100000000");
  assert.equal(projection.retry_or_unwind_requires_new_policy_decision, true);
});

test("latest economic-lot observation wins without double counting", () => {
  const first = fixture().balance_components.find((row) => row.observation_id === "b-sol-usdc");
  const newer = {
    ...first,
    observation_id: "b-sol-usdc-new",
    available_atomic: "400000000",
    quantity_atomic: "400000000",
    marked_value_usdc_micros: "400000000",
    executable_value_usdc_micros: "399000000",
    observed_at: "2026-09-01T18:00:01.000Z",
  };
  const snapshot = fixture({ balances: [first, newer], positions: [] });
  assert.equal(snapshot.balance_components.length, 1);
  assert.equal(snapshot.balance_components[0].observation_id, "b-sol-usdc-new");
  assert.equal(snapshot.valuation.marked_assets_usdc_micros, "400000000");
  assert.equal(snapshot.deduplication.balances_removed.length, 1);
});
