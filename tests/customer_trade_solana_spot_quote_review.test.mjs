import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  SOLANA_SPOT_QUOTE_REVIEW_SCHEMA,
  SOLANA_CANONICAL_USDC_MINT,
  SOLANA_WRAPPED_NATIVE_MINT,
  SolanaSpotQuoteReviewLimits,
  createExactSolanaSpotIntent,
  createExactSolanaSpotQuoteReview,
  createSolanaSpotAdvancedControls,
  createSolanaSpotFeeDisclosure,
  createSolanaSpotPlanSource,
  createSolanaSpotQuoteTiming,
} from "../lib/customer_trade/solana_spot_quote_review.mjs";

const POOL = "11111111111111111111111111111111";
const TOKEN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6pB2XP1WKY3Mo9f";
const QUOTE = SOLANA_WRAPPED_NATIVE_MINT;
const INSTRUMENT = `solana:pool:${POOL}`;
const NOW = Date.parse("2026-08-28T10:00:01.000Z");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  return {
    input: {
      exact_market: {
        instrument_id: INSTRUMENT,
        pool_address: POOL,
        token_address: TOKEN,
        quote_address: QUOTE,
      },
      symbol: "THIS-NEVER-SELECTS",
      side: "buy",
      amount: { kind: "native_sol", display_amount: "0.25" },
      advanced_controls: {
        slippage_bps: 75,
        priority: { mode: "standard" },
      },
      plan: {
        source: "custom",
        levels: {
          entries: ["0.0000042"],
          take_profits: [{ price: "0.000005", allocation_bps: 5000 }],
          stop_loss: "0.0000035",
          invalidation: "Exact pool loses the reviewed support level.",
        },
      },
    },
    server: {
      market_authority: {
        instrument_id: INSTRUMENT,
        identity_scope: "exact_pool",
        chain: "solana",
        pool_address: POOL,
        token_address: TOKEN,
        quote_address: QUOTE,
        venue: "pumpswap",
        symbol: "TOKEN",
        quote_symbol: "SOL",
        token_decimals: 6,
        native_decimals: 9,
      },
      quote: {
        quote_id: "quo_exact_market_001",
        provider: "jupiter",
        instrument_id: INSTRUMENT,
        pool_address: POOL,
        token_address: TOKEN,
        quote_address: QUOTE,
        input_mint: SOLANA_WRAPPED_NATIVE_MINT,
        output_mint: TOKEN,
        exact_input_amount_base_units: "250000000",
        expected_output_amount_base_units: "5000000",
        minimum_output_amount_base_units: "4900000",
        price_impact_bps: 22,
        route_leg_count: 2,
        venues: ["Raydium CLMM", "Meteora DLMM"],
      },
      quote_timing: {
        requested_at: "2026-08-28T10:00:00.000Z",
        quoted_at: "2026-08-28T10:00:00.100Z",
        received_at: "2026-08-28T10:00:00.250Z",
        expires_at: "2026-08-28T10:00:20.100Z",
      },
      fee_disclosure: {
        configured_enabled: false,
        configuration_ready: false,
        configured_fee_bps: 255,
        actual_fee_bps: 0,
        actual_fee_amount_base_units: "0",
      },
    },
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

test("builds a browser-safe exact-market native SOL buy review", () => {
  const { input, server } = fixture();
  const review = createExactSolanaSpotQuoteReview(input, server, { now: NOW });
  assert.equal(review.schema_version, SOLANA_SPOT_QUOTE_REVIEW_SCHEMA);
  assert.equal(review.state, "quote_review_available");
  assert.equal(review.intent.exact_market.instrument_id, INSTRUMENT);
  assert.equal(review.intent.exact_market.pool_address, POOL);
  assert.equal(review.intent.exact_market.token_address, TOKEN);
  assert.equal(review.intent.exact_market.quote_address, QUOTE);
  assert.equal(review.intent.selection_basis, "exact_identity_only");
  assert.equal(review.intent.symbol_selection_allowed, false);
  assert.equal(review.intent.economic_flow, "native_sol_to_selected_token");
  assert.equal(review.intent.input_mint, SOLANA_WRAPPED_NATIVE_MINT);
  assert.equal(review.intent.output_mint, TOKEN);
  assert.equal(review.intent.amount.exact_input_amount_base_units, "250000000");
  assert.equal(review.intent.amount.conversion_authority, "server");
  assert.equal(review.quote.expected_output_display, "5");
  assert.equal(review.quote.minimum_output_display, "4.9");
  assert.equal(review.fee_disclosure.configured.fee_bps, 255);
  assert.equal(review.fee_disclosure.actual.charged, false);
  assert.equal(review.fee_disclosure.actual.fee_bps, 0);
  assert.equal(review.timing.freshness, "current");
});

test("symbols never select or substitute an exact pool", () => {
  const { input, server } = fixture();
  input.symbol = "USDC";
  input.exact_market.symbol = "SAME";
  server.market_authority.symbol = "RAVEN-AUTHORITATIVE-LABEL";
  const intent = createExactSolanaSpotIntent(input, server.market_authority);
  assert.equal(intent.exact_market.display.symbol, "RAVEN-AUTHORITATIVE-LABEL");
  assert.equal(intent.output_mint, TOKEN);

  const mismatched = clone(input);
  mismatched.exact_market.pool_address = TOKEN;
  assert.throws(() => createExactSolanaSpotIntent(mismatched, server.market_authority), hasCode("request_exact_market_mismatch"));
});

test("sell percentages resolve only against a server balance snapshot", () => {
  const { input, server } = fixture();
  input.side = "sell";
  input.amount = { kind: "sell_percentage", percentage_bps: 2500 };
  server.market_authority.spendable_token_balance_base_units = "123456789";
  const intent = createExactSolanaSpotIntent(input, server.market_authority);
  assert.equal(intent.economic_flow, "selected_token_to_canonical_usdc");
  assert.equal(intent.input_mint, TOKEN);
  assert.equal(intent.output_mint, SOLANA_CANONICAL_USDC_MINT);
  assert.equal(intent.amount.exact_input_amount_base_units, "30864197");
  assert.equal(intent.amount.display_amount, "30.864197");
  assert.equal(intent.amount.balance_snapshot.spendable_base_units, "123456789");

  delete server.market_authority.spendable_token_balance_base_units;
  assert.throws(() => createExactSolanaSpotIntent(input, server.market_authority), hasCode("spendable_token_balance_base_units_invalid"));
});

test("sell settlement can target native SOL without changing exact token sizing", () => {
  const { input, server } = fixture();
  input.side = "sell";
  input.amount = { kind: "sell_percentage", percentage_bps: 5000 };
  input.settlement = { kind: "native_sol" };
  server.market_authority.spendable_token_balance_base_units = "100000000";
  const intent = createExactSolanaSpotIntent(input, server.market_authority);
  assert.equal(intent.economic_flow, "selected_token_to_native_sol");
  assert.equal(intent.input_mint, TOKEN);
  assert.equal(intent.output_mint, SOLANA_WRAPPED_NATIVE_MINT);
  assert.equal(intent.settlement.kind, "native_sol");
  assert.equal(intent.settlement.output_decimals, 9);
  assert.equal(intent.amount.exact_input_amount_base_units, "50000000");
});

test("canonical USDC buys remain distinct from native SOL buys", () => {
  const { input, server } = fixture();
  input.amount = { kind: "canonical_usdc", display_amount: "500" };
  const intent = createExactSolanaSpotIntent(input, server.market_authority);
  assert.equal(intent.economic_flow, "canonical_usdc_to_selected_token");
  assert.equal(intent.input_mint, SOLANA_CANONICAL_USDC_MINT);
  assert.equal(intent.output_mint, TOKEN);
  assert.equal(intent.amount.exact_input_amount_base_units, "500000000");
  assert.equal(intent.amount.display_amount, "500");
  assert.equal(intent.amount.input_decimals, 6);
});

test("canonical USDC economic amounts remain exact across supported ticket sizes", () => {
  for (const [display, baseUnits] of [["10", "10000000"], ["500", "500000000"], ["10000", "10000000000"]]) {
    const { input, server } = fixture();
    input.amount = { kind: "canonical_usdc", display_amount: display };
    const intent = createExactSolanaSpotIntent(input, server.market_authority);
    assert.equal(intent.amount.display_amount, display);
    assert.equal(intent.amount.exact_input_amount_base_units, baseUnits);
    assert.equal(intent.amount.input_decimals, 6);
  }
});

test("client-supplied mint conversion and base-unit authority is rejected", () => {
  const { input, server } = fixture();
  input.token_decimals = 2;
  assert.throws(() => createExactSolanaSpotIntent(input, server.market_authority), hasCode("client_authority_field_forbidden"));
  delete input.token_decimals;
  input.amount.base_units = "1";
  assert.throws(() => createExactSolanaSpotIntent(input, server.market_authority), hasCode("client_authority_field_forbidden"));
  delete input.amount.base_units;
  input.settlement = { kind: "native_sol", mint: TOKEN };
  assert.throws(() => createExactSolanaSpotIntent(input, server.market_authority), hasCode("client_authority_field_forbidden"));
});

test("Raven, user-preset, and custom plan sources remain explicit and user edits remain separate", () => {
  const raven = createSolanaSpotPlanSource({
    source: "raven_exact_market",
    levels: { entries: ["999"] },
    user_modifications: [{
      field: "take_profit",
      from: "0.000005",
      to: "0.0000055",
      modified_at: "2026-08-28T10:00:00.000Z",
    }],
  }, {
    instrument_id: INSTRUMENT,
    raven_plan: {
      instrument_id: INSTRUMENT,
      raven_context_id: "raven_exact_001",
      observed_at: "2026-08-28T09:59:00.000Z",
      timeframe: "5m",
      levels: {
        entries: ["0.0000042"],
        take_profits: [{ price: "0.000005", allocation_bps: 5000 }],
        stop_loss: "0.0000035",
      },
    },
  });
  assert.equal(raven.source, "raven_exact_market");
  assert.equal(raven.original_levels.entries[0], "0.0000042");
  assert.equal(raven.provenance.authority, "server_qualified_raven_exact_market");
  assert.equal(raven.user_modified, true);
  assert.equal(raven.user_modifications[0].to, "0.0000055");
  assert.equal(raven.plan_is_execution_authority, false);
  assert.throws(() => createSolanaSpotPlanSource({ source: "raven_exact_market" }, { instrument_id: INSTRUMENT }), hasCode("raven_plan_authority_required"));

  const preset = createSolanaSpotPlanSource({ source: "user_preset", preset_id: "fast-scalp", preset_version: 3 }, { instrument_id: INSTRUMENT });
  const custom = createSolanaSpotPlanSource({ source: "custom" }, { instrument_id: INSTRUMENT });
  assert.equal(preset.provenance.authority, "user_preset");
  assert.equal(preset.provenance.preset_version, 3);
  assert.equal(custom.provenance.authority, "user_custom");
});

test("fee disclosure never confuses the configured rate with what the quote charges", () => {
  const preview = createSolanaSpotFeeDisclosure({
    configured_enabled: false,
    configuration_ready: false,
    configured_fee_bps: 255,
    actual_fee_bps: 0,
    actual_fee_amount_base_units: "0",
  });
  assert.equal(preview.configured.fee_bps, 255);
  assert.equal(preview.actual.fee_bps, 0);
  assert.equal(preview.actual.charged, false);

  const charged = createSolanaSpotFeeDisclosure({
    configured_enabled: true,
    configuration_ready: true,
    configured_fee_bps: 178,
    actual_fee_bps: 178,
    actual_fee_amount_base_units: "89000",
    asset_mint: TOKEN,
    recipient: POOL,
  });
  assert.equal(charged.configured.fee_bps, 178);
  assert.equal(charged.actual.fee_bps, 178);
  assert.equal(charged.actual.amount_base_units, "89000");
  assert.equal(charged.actual.charged, true);
  assert.throws(() => createSolanaSpotFeeDisclosure({
    configured_enabled: true,
    configuration_ready: true,
    configured_fee_bps: 100,
    actual_fee_bps: 101,
    actual_fee_amount_base_units: "1",
    asset_mint: TOKEN,
    recipient: POOL,
  }), hasCode("actual_fee_exceeds_configured_fee"));
});

test("quote timing exposes latency and freshness without treating expired quotes as current", () => {
  const { server } = fixture();
  const current = createSolanaSpotQuoteTiming(server.quote_timing, { now: NOW });
  assert.equal(current.provider_latency_ms, 250);
  assert.equal(current.quote_age_ms, 900);
  assert.equal(current.expires_in_ms, 19_100);
  assert.equal(current.fresh, true);
  const expired = createSolanaSpotQuoteTiming(server.quote_timing, { now: Date.parse("2026-08-28T10:00:21.000Z") });
  assert.equal(expired.freshness, "expired");
  assert.equal(expired.fresh, false);

  server.quote_timing.received_at = "2026-08-28T10:00:11.000Z";
  assert.throws(() => createSolanaSpotQuoteTiming(server.quote_timing, { now: NOW }), hasCode("quote_provider_latency_out_of_bounds"));
});

test("slippage, priority, and Jito controls fail closed at reviewed bounds", () => {
  const standard = createSolanaSpotAdvancedControls({ slippage_bps: 300, priority: { mode: "standard" } });
  assert.equal(standard.slippage_bps, 300);
  assert.equal(standard.priority.enforced_max_lamports, 50_000);
  assert.equal(standard.jito.state, "unavailable");
  const capped = createSolanaSpotAdvancedControls({ slippage_bps: 5, priority: { mode: "capped", max_lamports: 12_500 } });
  assert.equal(capped.priority.requested_max_lamports, 12_500);
  assert.throws(() => createSolanaSpotAdvancedControls({ slippage_bps: 301 }), hasCode("slippage_bps_out_of_bounds"));
  assert.throws(() => createSolanaSpotAdvancedControls({ priority: { mode: "capped", max_lamports: 50_001 } }), hasCode("priority_max_lamports_out_of_bounds"));
  assert.throws(() => createSolanaSpotAdvancedControls({ jito_requested: true }), hasCode("jito_unavailable"));
});

test("expired quote review is visibly blocked while all execution boundaries stay closed", () => {
  const { input, server } = fixture();
  const review = createExactSolanaSpotQuoteReview(input, server, { now: Date.parse("2026-08-28T10:00:21.000Z") });
  assert.equal(review.state, "quote_expired");
  assert.equal(review.review_available, false);
  assert.deepEqual(review.blocked_reasons, ["quote_expired"]);
  assert.deepEqual(review.execution_boundary, {
    quote_only: true,
    review_only: true,
    wallet_connection_required_for_quote: false,
    wallet_connection_available: false,
    signing_available: false,
    submission_available: false,
    transaction_material_available: false,
  });
});

test("raw provider payloads and transaction material are not projected", () => {
  const { input, server } = fixture();
  server.quote.raw_provider_payload = { secret: "must-not-project" };
  server.quote.swap_transaction = "base64-transaction-material";
  server.quote.transaction = { message: "must-not-project" };
  server.quote.route_plan = [{ opaque: "must-not-project" }];
  const review = createExactSolanaSpotQuoteReview(input, server, { now: NOW });
  const serialized = JSON.stringify(review);
  assert.doesNotMatch(serialized, /must-not-project|base64-transaction-material|raw_provider_payload|swap_transaction|route_plan/);
  assert.equal(review.execution_boundary.transaction_material_available, false);
});

test("the contract module is browser-safe and exposes the reviewed hard limits", () => {
  const source = fs.readFileSync(new URL("../lib/customer_trade/solana_spot_quote_review.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:|\bBuffer\b|\bprocess\.|\brequire\s*\(/);
  assert.equal(SolanaSpotQuoteReviewLimits.maximum_slippage_bps, 300);
  assert.equal(SolanaSpotQuoteReviewLimits.maximum_priority_fee_lamports, 50_000);
  assert.equal(SolanaSpotQuoteReviewLimits.maximum_configured_fee_bps, 255);
});
