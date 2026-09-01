import assert from "node:assert/strict";
import test from "node:test";

import { createHyperliquidMarketPreview } from "../lib/customer_trade/hyperliquid_quote_preview.mjs";
import {
  SOLANA_CANONICAL_USDC_MINT,
  SOLANA_WRAPPED_NATIVE_MINT,
  createExactSolanaSpotQuoteReview,
} from "../lib/customer_trade/solana_spot_quote_review.mjs";
import {
  createHyperliquidAgenticPaperAdapter,
  createRobinhoodBrokerageAgenticReadOnlyAdapter,
  createRobinhoodChainAgenticReadOnlyAdapter,
  createSolanaAgenticPaperAdapter,
} from "../lib/agentic_trading/existing_venue_adapters.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const POOL = "11111111111111111111111111111111";
const TOKEN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6pB2XP1WKY3Mo9f";
const SOLANA_USDC = `solana:mainnet-beta/spl:${SOLANA_CANONICAL_USDC_MINT}`;
const SOLANA_SOL = "solana:mainnet-beta/native:sol";
const JUPITER = "jupiter@solana:mainnet-beta#mainnet";
const HL_USDC = "hyperliquid:mainnet/venue-asset:usdc";
const HL_VENUE = "hyperliquid@hyperliquid:mainnet#mainnet";

function solanaIntent() {
  return {
    plan_id: "plan-solana",
    leg_id: "leg-solana",
    intent_id: "intent-solana",
    chain_id: "solana:mainnet-beta",
    venue_id: JUPITER,
    instrument_id: "instrument:canonical-solana-token-usdc",
    venue_instrument_id: `solana:pool:${POOL}`,
    action: "buy",
    amount: { kind: "notional", value: "100", asset_id: SOLANA_USDC },
    settlement_asset: { asset_id: SOLANA_USDC },
    order_constraints: { time_in_force: "ioc", maximum_slippage_bps: 50 },
    idempotency_key: "intent-solana-once",
    environment: "paper",
    gas_requirement: { asset_id: SOLANA_SOL, amount_atomic: "5000" },
  };
}

function solanaReview() {
  return createExactSolanaSpotQuoteReview({
    exact_market: {
      instrument_id: `solana:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: SOLANA_WRAPPED_NATIVE_MINT,
    },
    side: "buy",
    amount: { kind: "canonical_usdc", display_amount: "100" },
    advanced_controls: { slippage_bps: 50, priority: { mode: "standard" } },
    plan: { source: "custom", levels: { entries: [], take_profits: [], stop_loss: null, invalidation: null } },
  }, {
    market_authority: {
      instrument_id: `solana:pool:${POOL}`,
      identity_scope: "exact_pool",
      chain: "solana",
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: SOLANA_WRAPPED_NATIVE_MINT,
      venue: "jupiter",
      symbol: "TOKEN",
      quote_symbol: "SOL",
      token_decimals: 6,
      native_decimals: 9,
    },
    quote: {
      quote_id: "jupiter-exact-quote",
      provider: "jupiter",
      instrument_id: `solana:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: SOLANA_WRAPPED_NATIVE_MINT,
      input_mint: SOLANA_CANONICAL_USDC_MINT,
      output_mint: TOKEN,
      exact_input_amount_base_units: "100000000",
      expected_output_amount_base_units: "500000000",
      minimum_output_amount_base_units: "490000000",
      price_impact_bps: 20,
      route_leg_count: 2,
      venues: ["Meteora", "Raydium"],
    },
    quote_timing: {
      requested_at: "2026-09-01T17:59:59.000Z",
      quoted_at: "2026-09-01T17:59:59.100Z",
      received_at: "2026-09-01T17:59:59.200Z",
      expires_at: "2026-09-01T18:00:10.000Z",
    },
    fee_disclosure: {
      configured_enabled: false,
      configuration_ready: false,
      configured_fee_bps: 10,
      actual_fee_bps: 0,
      actual_fee_amount_base_units: "0",
    },
  }, { now: NOW });
}

function account(chainId, venueId, assetId, amount = "500000000") {
  return { balances: [{ chain_id: chainId, venue_id: venueId, asset_id: assetId, available_atomic: amount, state: "available" }], positions: [] };
}

test("Solana adapter preserves canonical and exact-pool identity while requiring full economics", async () => {
  const adapter = createSolanaAgenticPaperAdapter({
    quote_review_source: async () => solanaReview(),
    quote_economics_source: async () => ({
      state: "complete",
      provider_health: "healthy",
      requested_notional_usdc_micros: "100000000",
      executable_notional_usdc_micros: "100000000",
      executable_quantity_atomic: "500000000",
      average_price: "0.2",
      worst_price: "0.20408163",
      estimated_slippage_bps: 50,
      venue_fee_usdc_micros: "0",
      network_fee_usdc_micros: "5000",
      gas_fee_usdc_micros: "0",
      funding_usdc_micros: "0",
      raven_fee_usdc_micros: "100000",
      capital_asset_id: SOLANA_USDC,
      gas_asset_id: SOLANA_SOL,
      gas_required_atomic: "5000",
    }),
    account_source: async () => ({
      balances: [
        ...account("solana:mainnet-beta", JUPITER, SOLANA_USDC).balances,
        ...account("solana:mainnet-beta", JUPITER, SOLANA_SOL, "100000").balances,
      ],
      positions: [],
    }),
    clock: () => NOW,
  });
  const quote = await adapter.quote(solanaIntent());
  assert.equal(quote.state, "executable");
  assert.equal(quote.instrument_id, "instrument:canonical-solana-token-usdc");
  assert.equal(quote.provider, "jupiter");
  assert.equal(quote.last_trade_price_used, false);
  assert.equal(quote.costs.raven_fee_usdc_micros, "100000");
});

function hyperliquidIntent() {
  return {
    plan_id: "plan-hl",
    leg_id: "leg-hl",
    intent_id: "intent-hl",
    chain_id: "hyperliquid:mainnet",
    venue_id: HL_VENUE,
    instrument_id: "instrument:canonical-hyperliquid-sol-perp",
    venue_instrument_id: "hyperliquid:perp:SOL",
    action: "open_short",
    amount: { kind: "notional", value: "100", asset_id: HL_USDC },
    settlement_asset: { asset_id: HL_USDC },
    order_constraints: { time_in_force: "ioc", maximum_slippage_bps: 30 },
    idempotency_key: "intent-hl-once",
    environment: "paper",
  };
}

function hyperliquidPreview(intent) {
  return createHyperliquidMarketPreview({
    instrument_id: intent.venue_instrument_id,
    side: "short",
    notional_usdc: 100,
    leverage: 2,
    market: { instrument_id: intent.venue_instrument_id, symbol: "SOL", max_leverage: 20 },
    book: {
      coin: "SOL",
      observed_at: "2026-09-01T17:59:59.000Z",
      bids: [{ price: 199.9, size: 2, notional_usd: 399.8 }],
      asks: [{ price: 200.1, size: 2, notional_usd: 400.2 }],
      summary: { best_bid: 199.9, best_ask: 200.1, mid_price: 200, spread_bps: 10 },
    },
  }, { now: NOW });
}

test("Hyperliquid adapter consumes the existing L2 preview and blocks unresolved fees", async () => {
  let feeEvidenceAvailable = false;
  const adapter = createHyperliquidAgenticPaperAdapter({
    market_preview_source: async (intent) => hyperliquidPreview(intent),
    quote_economics_source: async () => feeEvidenceAvailable ? {
      state: "complete",
      provider_health: "healthy",
      requested_notional_usdc_micros: "100000000",
      executable_notional_usdc_micros: "100000000",
      executable_quantity_atomic: "500250125",
      estimated_slippage_bps: 10,
      venue_fee_usdc_micros: "35000",
      network_fee_usdc_micros: "0",
      gas_fee_usdc_micros: "0",
      funding_usdc_micros: "0",
      raven_fee_usdc_micros: "100000",
      capital_asset_id: HL_USDC,
      gas_required_atomic: "0",
    } : { state: "unavailable", unavailable_reason: "account_fee_tier_unresolved" },
    account_source: async () => account("hyperliquid:mainnet", HL_VENUE, HL_USDC),
    clock: () => NOW,
  });
  const unresolved = await adapter.quote(hyperliquidIntent());
  assert.equal(unresolved.state, "unavailable");
  assert.equal(unresolved.unavailable_reason, "account_fee_tier_unresolved");
  feeEvidenceAvailable = true;
  const quote = await adapter.quote(hyperliquidIntent());
  assert.equal(quote.state, "executable");
  assert.equal(quote.quote_depth_source, "hyperliquid_live_l2_book");
  assert.equal(quote.costs.venue_fee_usdc_micros, "35000");
  assert.equal(quote.costs.funding_usdc_micros, "0");
  assert.equal(quote.live_order_material, false);
});

test("Robinhood Chain and brokerage adapters remain distinct read-only venues", async () => {
  const chain = createRobinhoodChainAgenticReadOnlyAdapter({
    health_source: async () => ({ state: "healthy", provider: "alchemy_rpc" }),
  });
  const brokerage = createRobinhoodBrokerageAgenticReadOnlyAdapter({
    health_source: async () => ({ state: "unconfigured", oauth_connected: false }),
  });
  assert.equal(chain.capability.chain_id, "eip155:4663");
  assert.equal(brokerage.capability.chain_id, "offchain:robinhood-brokerage");
  assert.notEqual(chain.capability.venue_id, brokerage.capability.venue_id);
  assert.equal(chain.capability.operations.live_place, false);
  assert.equal(brokerage.capability.operations.live_place, false);
  await assert.rejects(chain.placeLive({}), /live_execution_disabled/);
  await assert.rejects(brokerage.placeLive({}), /live_execution_disabled/);
});
