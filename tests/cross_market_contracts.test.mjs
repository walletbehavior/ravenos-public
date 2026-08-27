import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInstrument,
  resolveInstrumentSelection,
  validateInstrument,
} from "../lib/cross_market/instrument.mjs";
import {
  createSettlementPreview,
  createTradeIntent,
} from "../lib/cross_market/trade_intent.mjs";
import { normalizePortfolioSnapshot } from "../lib/cross_market/portfolio.mjs";
import { buildPublicAtlasProjection } from "../lib/cross_market/atlas_projection.mjs";

const ATLAS_INSTRUMENTS = {
  SPY: { instrument_id: "etf:nyse-arca:spy", symbol: "SPY", display_name: "State Street SPDR S&P 500 ETF Trust", asset_class: "etf", instrument_type: "etf", venue: "nyse-arca", listing: "NYSE Arca", quote_asset: "USD", settlement_asset: "USD", economic_numeraire: "USDC" },
};

test("existing Hyperliquid exact identity survives universal normalization", () => {
  const instrument = normalizeInstrument({
    instrument_id: "hyperliquid:perp:BTC",
    symbol: "BTC",
    instrument_type: "perpetual",
    venue: "hyperliquid",
    chain: "hyperliquid",
    quote_asset: "USD",
    settlement_asset: "USDC",
    capabilities: { chart: true, book: true, funding: true, open_interest: true },
  });
  assert.equal(instrument.instrument_id, "hyperliquid:perp:BTC");
  assert.equal(instrument.symbol, "BTC-PERP");
  assert.equal(instrument.identity_scope, "exact_instrument");
  assert.equal(instrument.capabilities.funding, true);
});

test("symbol ambiguity never silently chooses a pool, spot token, or perpetual", () => {
  const candidates = [
    { instrument_id: "hyperliquid:perp:BTC", symbol: "BTC", instrument_type: "perpetual", venue: "hyperliquid" },
    { instrument_id: "crypto:token:bitcoin:btc", symbol: "BTC", instrument_type: "token", chain: "bitcoin" },
  ];
  const selection = resolveInstrumentSelection(candidates, { symbol: "BTC" });
  assert.equal(selection.state, "ambiguous");
  assert.equal(selection.instrument, null);
  assert.equal(selection.candidates.length, 2);
});

test("an explicit instrument ID is preserved or rejected, never substituted", () => {
  const candidates = [{ instrument_id: "hyperliquid:perp:ETH", symbol: "ETH", instrument_type: "perpetual", venue: "hyperliquid" }];
  const selection = resolveInstrumentSelection(candidates, { instrument_id: "hyperliquid:perp:BTC" });
  assert.equal(selection.state, "not_found");
  assert.equal(selection.instrument, null);
  assert.equal(selection.exact, true);
});

test("an exact pool cannot masquerade as a token aggregate", () => {
  const missing = validateInstrument({ symbol: "BONK", instrument_type: "exact_pool", chain: "solana", venue: "raydium" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes("pool_address_required"));
  const exact = validateInstrument({ symbol: "BONK", instrument_type: "exact_pool", chain: "solana", venue: "raydium", pool_address: "Pool111" });
  assert.equal(exact.ok, true);
  assert.equal(exact.instrument.identity_scope, "exact_pool");
});

test("declared asset class cannot contradict exact instrument type", () => {
  const validation = validateInstrument({
    symbol: "BONK",
    instrument_type: "exact_pool",
    asset_class: "equity",
    chain: "solana",
    venue: "raydium",
    pool_address: "Pool111",
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("asset_class_incompatible"));
  assert.equal(validation.instrument.asset_class, "crypto");
});

test("option identity retains underlying, expiry, strike, and right", () => {
  const validation = validateInstrument({
    instrument_type: "option",
    symbol: "NVDA",
    venue: "tradier",
    underlying_instrument_id: "equity:nasdaq:NVDA",
    option: { expiry: "2026-09-18", strike: 220, right: "call", occ_symbol: "NVDA260918C00220000" },
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.instrument.market_identity.option.strike, 220);
  assert.equal(validation.instrument.market_identity.option.right, "call");
  assert.equal(validation.instrument.underlying_instrument_id, "equity:nasdaq:NVDA");
});

test("spot intent defaults economically to USDC while remaining preview-only", () => {
  const intent = createTradeIntent({
    instrument: {
      instrument_id: "crypto:pool:solana:raydium:Pool111",
      symbol: "BONK",
      instrument_type: "exact_pool",
      asset_class: "crypto",
      chain: "solana",
      venue: "raydium",
      pool_address: "Pool111",
      quote_asset: "USDC",
      settlement_asset: "USDC",
    },
    side: "buy",
    amount: { value: 250, currency: "USDC" },
  });
  const preview = createSettlementPreview({ intent, route: { available: true, input_asset: "USDC", output_asset: "BONK", expected_output: 1000000 } });
  assert.equal(intent.state, "preview_only");
  assert.equal(preview.route.input_asset, "USDC");
  assert.equal(preview.route.output_asset, "BONK");
  assert.equal(preview.signing_available, false);
  assert.equal(preview.submission_available, false);
});

test("spot sell preview defaults from the selected asset back to USDC", () => {
  const intent = createTradeIntent({
    instrument: {
      instrument_id: "crypto:pool:solana:raydium:Pool111",
      symbol: "BONK",
      instrument_type: "exact_pool",
      chain: "solana",
      venue: "raydium",
      pool_address: "Pool111",
      quote_asset: "USDC",
      settlement_asset: "USDC",
    },
    side: "sell",
    amount: { value: 1000000, currency: "BONK", denomination: "base_asset" },
  });
  const preview = createSettlementPreview({ intent, route: { available: true, expected_output: 250 } });
  assert.equal(preview.route.input_asset, "BONK");
  assert.equal(preview.route.output_asset, "USDC");
  assert.equal(preview.confirmation_boundary, "wallet");
});

test("spot cash intent stays USDC when the exact pool quote and venue settlement are not USDC", () => {
  const intent = createTradeIntent({
    instrument: {
      instrument_id: "crypto:pool:ethereum:uniswap:0xpool",
      symbol: "JUP",
      instrument_type: "exact_pool",
      chain: "ethereum",
      venue: "uniswap",
      pool_address: "0xpool",
      quote_asset: "WETH",
      settlement_asset: "WETH",
    },
    side: "sell",
    amount: { value: 100, currency: "JUP", denomination: "base_asset" },
  });
  const preview = createSettlementPreview({ intent, route: { available: true, output_asset: "USDC", expected_output: 2.5 } });
  assert.equal(intent.instrument.quote_asset.symbol, "WETH");
  assert.equal(intent.instrument.settlement_asset.symbol, "WETH");
  assert.equal(intent.instrument.preferred_cash_asset.symbol, "USDC");
  assert.equal(intent.requested_settlement_asset, "USDC");
  assert.equal(preview.route.output_asset, "USDC");
  assert.equal(preview.settlement_truth.venue_settlement_asset, "WETH");
  assert.equal(preview.settlement_truth.preferred_cash_asset, "USDC");
});

test("preferred cash object forms normalize without leaking object stringification", () => {
  const instrument = normalizeInstrument({
    instrument_id: "crypto:pool:base:uniswap:0xpool",
    symbol: "TOKEN",
    instrument_type: "exact_pool",
    chain: "base",
    venue: "uniswap",
    pool_address: "0xpool",
    quote_asset: { symbol: "WETH" },
    settlement_asset: { symbol: "WETH" },
    preferredCashAsset: { symbol: "USDC", asset_id: "base:usdc" },
  });
  const intent = createTradeIntent({ instrument, side: "buy", amount: { value: 250, currency: "USDC" }, preferred_cash_asset: { symbol: "USDC" } });
  assert.equal(instrument.preferred_cash_asset.symbol, "USDC");
  assert.equal(instrument.preferred_cash_asset.asset_id, "base:usdc");
  assert.equal(intent.economic_flow.preferred_cash_asset, "USDC");
  assert.doesNotMatch(JSON.stringify(intent), /\[OBJECT OBJECT\]/i);
});

test("a cross-domain route is available only when it is end-to-end and fully reviewable", () => {
  const intent = createTradeIntent({
    instrument: {
      instrument_id: "crypto:pool:base:uniswap:0xpool",
      symbol: "TOKEN",
      instrument_type: "exact_pool",
      chain: "base",
      venue: "uniswap",
      pool_address: "0xpool",
      quote_asset: "WETH",
      settlement_asset: "WETH",
    },
    side: "buy",
    amount: { value: 500, currency: "USDC" },
  });
  const incomplete = createSettlementPreview({
    intent,
    route: { available: true, output_asset: "TOKEN", cross_domain_transfer_required: true },
  });
  assert.equal(incomplete.state, "unavailable");
  assert.ok(incomplete.route_errors.includes("cross_domain_route_incomplete"));
  assert.ok(incomplete.route_errors.includes("cross_domain_route_not_end_to_end"));

  const reviewed = createSettlementPreview({
    intent,
    route: {
      available: true,
      input_asset: "USDC",
      output_asset: "TOKEN",
      source_custody_domain: "solana:wallet",
      destination_custody_domain: "base:wallet",
      cross_domain_transfer_required: true,
      transfer_provider: "bounded_cross_chain_adapter",
      end_to_end: true,
      expected_output: 1200,
    },
  });
  assert.equal(reviewed.state, "quote_preview_available");
  assert.equal(reviewed.route.cross_domain_transfer.required, true);
  assert.equal(reviewed.route.cross_domain_transfer.manual_bridge_required, false);
  assert.equal(reviewed.route.cross_domain_transfer.review_required, true);
  assert.equal(reviewed.settlement_truth.source_custody_domain, "solana:wallet");
  assert.equal(reviewed.settlement_truth.destination_custody_domain, "base:wallet");
  assert.equal(reviewed.signing_available, false);
  assert.equal(reviewed.submission_available, false);
});

test("different custody domains cannot bypass cross-domain review by omitting the route flag", () => {
  const intent = createTradeIntent({
    instrument: {
      instrument_id: "crypto:pool:base:uniswap:0xpool",
      symbol: "TOKEN",
      instrument_type: "exact_pool",
      chain: "base",
      venue: "uniswap",
      pool_address: "0xpool",
      quote_asset: "USDC",
      settlement_asset: "USDC",
    },
    side: "buy",
    amount: { value: 100, currency: "USDC" },
  });
  const preview = createSettlementPreview({
    intent,
    route: {
      available: true,
      output_asset: "TOKEN",
      source_custody_domain: "solana:wallet",
      destination_custody_domain: "base:wallet",
      transfer_provider: "bounded_cross_chain_adapter",
    },
  });
  assert.equal(preview.state, "unavailable");
  assert.ok(preview.route_errors.includes("cross_domain_route_not_end_to_end"));
});

test("equity settlement remains USD even when portfolio display is USDC", () => {
  const instrument = normalizeInstrument({ symbol: "NVDA", instrument_type: "equity", venue: "nasdaq", settlement_asset: "USD", economic_numeraire: "USDC" });
  assert.equal(instrument.settlement_asset.symbol, "USD");
  assert.equal(instrument.economic_numeraire, "USDC");
});

test("portfolio requires an explicit USD to USDC conversion", () => {
  const snapshot = normalizePortfolioSnapshot({
    economic_numeraire: "USDC",
    holdings: [{ holding_id: "cash-usd", economic_lot_id: "broker:cash", value: 1000, currency: "USD", valuation_role: "cash" }],
  });
  assert.equal(snapshot.holdings[0].normalized_value, null);
  assert.equal(snapshot.valuation.usd_usdc_parity_assumed, false);
  assert.equal(snapshot.state, "partial");
  assert.ok(snapshot.warnings.includes("conversion_unavailable:USD:USDC"));
});

test("authoritative account equity prevents child holdings from double-counting", () => {
  const snapshot = normalizePortfolioSnapshot({
    economic_numeraire: "USDC",
    conversions: [{ from: "USD", to: "USDC", rate: 0.999, source: "verified_fx", observed_at: "2026-07-21T20:00:00Z", freshness_state: "fresh" }],
    accounts: [{ account_id: "tradier-1", venue: "tradier", authoritative_equity: 10000, authoritative_equity_currency: "USD" }],
    holdings: [
      { holding_id: "cash", economic_lot_id: "tradier-1:cash", account_id: "tradier-1", value: 4000, currency: "USD", valuation_role: "cash" },
      { holding_id: "nvda", economic_lot_id: "tradier-1:nvda", account_id: "tradier-1", value: 6000, currency: "USD", valuation_role: "asset_value" },
    ],
    positions: [{ position_id: "btc-perp", economic_lot_id: "hl:btc", notional: 50000, currency: "USDC", valuation_role: "derivative_exposure" }],
  });
  assert.equal(snapshot.valuation.total_value, 9990);
  assert.equal(snapshot.valuation.derivative_notional, 50000);
  assert.equal(snapshot.accounts[0].valuation_source, "authoritative_account_equity");
});

test("stale USD to USDC conversion is rejected rather than treated as parity", () => {
  const snapshot = normalizePortfolioSnapshot({
    economic_numeraire: "USDC",
    conversions: [{ from: "USD", to: "USDC", rate: 1, source: "old_fx", observed_at: "2026-07-01T00:00:00Z", freshness_state: "stale" }],
    accounts: [{ account_id: "broker-1", authoritative_equity: 5000, authoritative_equity_currency: "USD" }],
  });
  assert.equal(snapshot.accounts[0].normalized_equity, null);
  assert.equal(snapshot.valuation.total_value, 0);
  assert.equal(snapshot.state, "partial");
  assert.equal(snapshot.valuation.usd_usdc_parity_assumed, false);
});

test("duplicate custody lots retain the freshest observation once", () => {
  const snapshot = normalizePortfolioSnapshot({
    holdings: [
      { holding_id: "old", economic_lot_id: "wallet:usdc", value: 100, currency: "USDC", observed_at: "2026-07-21T19:00:00Z" },
      { holding_id: "new", economic_lot_id: "wallet:usdc", value: 120, currency: "USDC", observed_at: "2026-07-21T20:00:00Z" },
    ],
  });
  assert.equal(snapshot.holdings.length, 1);
  assert.equal(snapshot.holdings[0].holding_id, "new");
  assert.equal(snapshot.valuation.total_value, 120);
  assert.equal(snapshot.deduplication.holdings_removed.length, 1);
});

test("Atlas projection keeps identity but removes unqualified provider observations", () => {
  const projection = buildPublicAtlasProjection({
    nowMs: Date.parse("2026-07-21T20:10:00Z"),
    atlas: {
      ts: Date.parse("2026-07-21T20:00:00Z") / 1000,
      atlas_posture: "caution",
      confidence: "low",
      rail_health: { options: { status: "ok", provider: "tradier_production", last_success_ts: Date.parse("2026-07-21T20:00:00Z") / 1000 } },
    },
    market: {
      ts: Date.parse("2026-07-21T20:00:00Z") / 1000,
      market_provider: "massive",
      prices: { spy: { ticker: "SPY", price: 742.09, ret_5d: -0.01, points: 63, provider: "massive" } },
      features: { risk_regime: "risk_off", equity_regime: "down" },
    },
    options: {
      ts: Date.parse("2026-07-21T20:00:00Z") / 1000,
      delayed_data: true,
      provider_debug: { quote_url: "https://api.tradier.com/private", token: "must-not-leak" },
      options_contexts: { SPY: { underlying: "SPY", regime: "neutral", quality: "clean", source: "tradier_option_chain" } },
    },
    instrumentRegistry: ATLAS_INSTRUMENTS,
  });
  const serialized = JSON.stringify(projection);
  assert.equal(projection.capabilities.options_summary, false);
  assert.equal(projection.capabilities.full_options_chain, false);
  assert.equal(projection.market_context.rows[0].instrument_id, "etf:nyse-arca:spy");
  assert.equal(projection.market_context.rows[0].instrument.settlement_asset.symbol, "USD");
  assert.equal(projection.market_context.rows[0].instrument.capabilities.live_price, false);
  assert.equal(projection.market_context.rows[0].state, "display_restricted");
  assert.equal(projection.market_context.rows[0].price, null);
  assert.equal(projection.market_context.rows[0].change_5d, null);
  assert.equal(projection.market_context.rows[0].display_policy.decision, "internal_only");
  assert.deepEqual(projection.options_context, []);
  assert.equal(projection.posture.state, "unavailable");
  assert.equal(projection.market_context.risk_regime, "unknown");
  assert.equal(projection.execution_boundary.signing_available, false);
  assert.equal(projection.public_safety.provider_payloads_removed, true);
  assert.equal(projection.public_safety.display_entitlements_enforced, true);
  assert.doesNotMatch(serialized, /api\.tradier\.com|must-not-leak/);
});

test("Atlas projection enforces a public allowlist and hard row bounds", () => {
  const prices = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`T${index}`, { ticker: `T${index}`, price: index }]));
  const instrumentRegistry = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`T${index}`, {
    instrument_id: `equity:test-venue:t${index}`,
    symbol: `T${index}`,
    asset_class: "equity",
    instrument_type: "equity",
    venue: "test-venue",
    listing: "Test Venue",
    quote_asset: "USD",
    settlement_asset: "USD",
    economic_numeraire: "USDC",
  }]));
  const projection = buildPublicAtlasProjection({
    market: { ts: Date.parse("2026-07-21T20:00:00Z") / 1000, prices },
    allowedInstrumentHints: [],
    instrumentRegistry,
    maxMarketRows: 10,
  });
  assert.equal(projection.market_context.rows.length, 10);
  assert.equal(projection.bounds.market_rows_available, 100);
  assert.equal(projection.bounds.truncated, true);
});
