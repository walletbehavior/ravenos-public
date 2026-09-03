import assert from "node:assert/strict";
import test from "node:test";

import { createCapitalReservationBook } from "../lib/agentic_trading/capital_reservations.mjs";
import {
  UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  UnifiedUsdcLimitLimits,
  canonicalUsdcAssetForChain,
  createUnifiedUsdcLimitJournal,
  createUnifiedUsdcLimitOrder,
  createUnifiedUsdcLimitQuote,
  decideAfterDestinationFundsArrive,
  evaluateUnifiedUsdcLimitOrder,
  reserveUnifiedUsdcLimitCapital,
  unifiedUsdcLimitCapability,
  verifyUnifiedUsdcLimitEvaluation,
  verifyUnifiedUsdcLimitJournalSnapshot,
  verifyUnifiedUsdcLimitOrder,
  verifyUnifiedUsdcLimitQuote,
} from "../lib/customer_trade/unified_usdc_limit_orders.mjs";

const NOW = "2026-09-03T17:00:00.000Z";
const QUOTE_EXPIRY = "2026-09-03T17:00:20.000Z";
const ORDER_EXPIRY = "2026-09-03T18:00:00.000Z";
const SOLANA = "solana:mainnet-beta";
const BASE = "eip155:8453";
const BSC = "eip155:56";
const SOLANA_WALLET = "wallet@solana:mainnet-beta#user";
const BASE_WALLET = "wallet@eip155:8453#user";
const TOKEN_MINT = "3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj";

const solanaUsdc = canonicalUsdcAssetForChain(SOLANA);
const baseUsdc = canonicalUsdcAssetForChain(BASE);
const token = Object.freeze({
  chain_id: SOLANA,
  kind: "fungible_token",
  standard: "spl",
  reference: TOKEN_MINT,
  symbol: "RAVEN",
  decimals: 6,
  representation: "canonical",
  verification_state: "verified",
});

function costs(side = "buy", { crossChain = false, unknown = null } = {}) {
  const active = side === "buy" ? "added_to_input" : "deducted_from_output";
  const embedded = "embedded_in_output";
  const result = {
    network: { amount_usdc_micros: "200000", treatment: active, source: "route" },
    bridge: crossChain
      ? { amount_usdc_micros: "500000", treatment: active, source: "route" }
      : { amount_usdc_micros: "0", treatment: "not_applicable" },
    dex: { amount_usdc_micros: "300000", treatment: embedded, source: "route" },
    solver: { amount_usdc_micros: "0", treatment: "not_applicable" },
    provider: { amount_usdc_micros: "0", treatment: "not_applicable" },
    gas: { amount_usdc_micros: "0", treatment: "not_applicable" },
    raven: { amount_usdc_micros: side === "buy" ? "1000000" : "1100000", treatment: active, source: "raven_fee_v1" },
    token_tax: { amount_usdc_micros: "0", treatment: "not_applicable" },
    fee_collection: { amount_usdc_micros: "0", treatment: "not_applicable" },
  };
  if (unknown) result[unknown] = { amount_usdc_micros: null, treatment: "unknown" };
  return result;
}

function order(overrides = {}) {
  return createUnifiedUsdcLimitOrder({
    order_id: overrides.order_id || "limit-buy-1",
    owner_scope: "tenant-a",
    side: "buy",
    destination_chain_id: SOLANA,
    destination_venue_id: "jupiter@solana:mainnet-beta#mainnet",
    destination_asset: token,
    limit_price_usdc: "1",
    trade_notional_usdc: "100",
    allowed_funding_chain_ids: [SOLANA, BASE],
    maximum_quote_age_ms: 15_000,
    created_at: NOW,
    expires_at: ORDER_EXPIRY,
    environment: "paper",
    ...overrides,
  });
}

function bridgeEvidence(crossChain) {
  return crossChain ? {
    state: "verified_quote",
    provider: "solver-fixture",
    mechanism_id: "base-to-solana-usdc-v1",
    quote_bound: true,
    expected_arrival_ms: 5_000,
    expires_at: QUOTE_EXPIRY,
    trust_dependencies: ["solver", "source-finality", "destination-finality"],
  } : { state: "not_required" };
}

function buyQuote(limitOrder, {
  quoteId = "same-chain-quote",
  sourceAsset = solanaUsdc,
  sourceVenue = SOLANA_WALLET,
  minimumOutput = "102000000",
  expectedOutput = "103000000",
  observedAt = NOW,
  expiresAt = QUOTE_EXPIRY,
  crossChain = sourceAsset.chain_id !== SOLANA,
  costUnknown = null,
  providerHealth = "healthy",
  routeState = "executable",
  exitState = "verified",
} = {}) {
  return createUnifiedUsdcLimitQuote({
    order: limitOrder,
    quote_id: quoteId,
    provider: crossChain ? "solver-fixture" : "jupiter-fixture",
    provider_health: providerHealth,
    route_state: routeState,
    side: "buy",
    source_venue_id: sourceVenue,
    destination_venue_id: "jupiter@solana:mainnet-beta#mainnet",
    source_asset: sourceAsset,
    destination_asset: limitOrder.destination_asset,
    source_capital_location: { chain_id: sourceAsset.chain_id, venue_id: sourceVenue, asset: sourceAsset },
    trade_notional_usdc_micros: "100000000",
    expected_destination_quantity_atomic: expectedOutput,
    minimum_destination_quantity_atomic: minimumOutput,
    output_is_net_of_embedded_costs: true,
    costs: costs("buy", { crossChain, unknown: costUnknown }),
    raven_fee_bps: 100,
    raven_fee_policy_version: "raven-standard-v1",
    source_gas: { state: "sponsored", provider: "solver-fixture" },
    destination_gas: { state: "not_required" },
    bridge: bridgeEvidence(crossChain),
    exit_proof: exitState === "verified" ? {
      state: "verified",
      verified: true,
      quote_id: `${quoteId}-exit`,
      observed_at: observedAt,
      expires_at: expiresAt,
      minimum_liquidation_usdc_micros: "97000000",
      settlement_asset_id: solanaUsdc.asset_id,
    } : { state: exitState, verified: false },
    estimated_settlement_ms: crossChain ? 5_000 : 800,
    transaction_count: crossChain ? 2 : 1,
    observed_at: observedAt,
    expires_at: expiresAt,
  });
}

function balance(asset, venueId, amount, observedAt = NOW) {
  return {
    chain_id: asset.chain_id,
    venue_id: venueId,
    asset_id: asset.asset_id,
    available_atomic: amount,
    state: "available",
    observed_at: observedAt,
    expires_at: "2026-09-03T17:01:00.000Z",
  };
}

test("limit order uses exact asset identity, sub-micro price precision, and no automatic execution authority", () => {
  const value = order({ limit_price_usdc: "0.00000000425" });
  assert.equal(value.limit_price_usdc, "0.00000000425");
  assert.equal(value.limit_price_usdc_e18, "4250000000");
  assert.equal(value.trigger_basis, "maximum_all_in_usdc_per_token");
  assert.equal(value.destination_asset_id, `solana:mainnet-beta/spl:${TOKEN_MINT}`);
  assert.equal(value.execution_boundary.autonomous_bridging, false);
  assert.equal(value.execution_boundary.server_signing, false);
  assert.equal(value.execution_boundary.server_broadcasting, false);
  assert.equal(verifyUnifiedUsdcLimitOrder(value), true);
});

test("same-chain buy triggers only on conservative all-in executable price and verified exit", () => {
  const limitOrder = order();
  const quote = buyQuote(limitOrder);
  const evaluation = evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [quote],
    balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")],
    observed_at: NOW,
  });
  assert.equal(verifyUnifiedUsdcLimitQuote(quote), true);
  assert.equal(verifyUnifiedUsdcLimitEvaluation(evaluation), true);
  assert.equal(quote.economics.source_debit_usdc_micros, "101200000");
  assert.equal(quote.economics.effective_price_usdc, "0.99215686274509804");
  assert.equal(evaluation.trigger_met, true);
  assert.equal(evaluation.state, "execution_review_required");
  assert.equal(evaluation.marked_price_used_for_trigger, false);
  assert.equal(evaluation.execution_boundary.live_automatic_execution, false);
});

test("a chart-price touch cannot trigger when the current all-in route is above the limit", () => {
  const limitOrder = order();
  const expensive = buyQuote(limitOrder, { minimumOutput: "95000000", expectedOutput: "100000000" });
  const evaluation = evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [expensive],
    balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")],
    observed_at: NOW,
  });
  assert.equal(Number(expensive.economics.effective_price_usdc) > 1, true);
  assert.equal(evaluation.state, "watching");
  assert.equal(evaluation.trigger_met, false);
  assert.deepEqual(evaluation.refusal_reasons, ["all_in_executable_limit_not_met"]);
  assert.equal(JSON.stringify(evaluation).includes("chart"), false);
});

test("unknown costs, stale quotes, unhealthy providers, and missing exit proof fail closed", () => {
  const limitOrder = order();
  const incomplete = buyQuote(limitOrder, { quoteId: "incomplete", costUnknown: "network" });
  const stale = buyQuote(limitOrder, { quoteId: "stale", observedAt: "2026-09-03T16:59:30.000Z", expiresAt: "2026-09-03T17:00:30.000Z" });
  const unhealthy = buyQuote(limitOrder, { quoteId: "unhealthy", providerHealth: "degraded" });
  const noExit = buyQuote(limitOrder, { quoteId: "no-exit", exitState: "unknown" });
  const evaluation = evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [incomplete, stale, unhealthy, noExit],
    balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")],
    observed_at: NOW,
  });
  assert.equal(evaluation.state, "indeterminate");
  assert.ok(evaluation.refusal_reasons.includes("route_economics_incomplete"));
  assert.ok(evaluation.refusal_reasons.includes("quote_too_old"));
  assert.ok(evaluation.refusal_reasons.includes("provider_degraded"));
  assert.ok(evaluation.refusal_reasons.includes("exit_unverified"));
});

test("deterministic route selection ignores provider ordering and compares net conservative outcome", () => {
  const limitOrder = order();
  const slowerBetter = buyQuote(limitOrder, { quoteId: "z-better", minimumOutput: "104000000", expectedOutput: "105000000" });
  const fasterWorse = buyQuote(limitOrder, { quoteId: "a-worse", minimumOutput: "102000000", expectedOutput: "103000000" });
  const rows = [
    evaluateUnifiedUsdcLimitOrder({ order: limitOrder, quotes: [fasterWorse, slowerBetter], balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")], observed_at: NOW }),
    evaluateUnifiedUsdcLimitOrder({ order: limitOrder, quotes: [slowerBetter, fasterWorse], balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")], observed_at: NOW }),
  ];
  assert.deepEqual(rows.map((row) => row.selected_quote_id), ["z-better", "z-better"]);
});

test("cross-chain buy reserves exact source-chain USDC but remains manual funding approval only", () => {
  const limitOrder = order();
  const quote = buyQuote(limitOrder, {
    quoteId: "base-to-solana",
    sourceAsset: baseUsdc,
    sourceVenue: BASE_WALLET,
    minimumOutput: "103000000",
    expectedOutput: "104000000",
    crossChain: true,
  });
  const balances = [balance(baseUsdc, BASE_WALLET, "250000000")];
  const evaluation = evaluateUnifiedUsdcLimitOrder({ order: limitOrder, quotes: [quote], balances, observed_at: NOW });
  assert.equal(evaluation.state, "funding_approval_required");
  assert.equal(evaluation.trigger_met, true);
  assert.equal(evaluation.capital_ready, true);
  assert.equal(evaluation.source_chain_id, BASE);
  assert.equal(evaluation.destination_chain_id, SOLANA);
  const reserved = reserveUnifiedUsdcLimitCapital({ evaluation, balances, created_at: NOW });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.manual_approval_required, true);
  assert.equal(reserved.automatic_transfer_started, false);
  assert.equal(reserved.automatic_execution_started, false);
  assert.equal(reserved.reservations[0].chain_id, BASE);
  assert.equal(reserved.reservations[0].amount_atomic, "101700000");
});

test("capital reservation prevents two limit orders from spending the same chain-local USDC", () => {
  const firstOrder = order({ order_id: "first" });
  const secondOrder = order({ order_id: "second" });
  const firstQuote = buyQuote(firstOrder, { quoteId: "first-quote" });
  const secondQuote = buyQuote(secondOrder, { quoteId: "second-quote" });
  const balances = [balance(solanaUsdc, SOLANA_WALLET, "150000000")];
  const firstEvaluation = evaluateUnifiedUsdcLimitOrder({ order: firstOrder, quotes: [firstQuote], balances, observed_at: NOW });
  const secondEvaluation = evaluateUnifiedUsdcLimitOrder({ order: secondOrder, quotes: [secondQuote], balances, observed_at: NOW });
  const book = createCapitalReservationBook({ initial_balances: balances });
  const first = reserveUnifiedUsdcLimitCapital({ evaluation: firstEvaluation, balances, reservation_book: book, created_at: NOW });
  const second = reserveUnifiedUsdcLimitCapital({ evaluation: secondEvaluation, balances, reservation_book: book, created_at: NOW });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "insufficient_local_capital");
  assert.equal(book.forPlan("first")[0].state, "reserved");
});

test("fresh destination quote is mandatory after funding and a moved price leaves USDC unspent", () => {
  const limitOrder = order();
  const crossQuote = buyQuote(limitOrder, {
    quoteId: "base-to-solana",
    sourceAsset: baseUsdc,
    sourceVenue: BASE_WALLET,
    minimumOutput: "103000000",
    expectedOutput: "104000000",
    crossChain: true,
  });
  const prior = evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [crossQuote],
    balances: [balance(baseUsdc, BASE_WALLET, "250000000")],
    observed_at: NOW,
  });
  const freshAt = "2026-09-03T17:00:05.000Z";
  const fresh = buyQuote(limitOrder, {
    quoteId: "destination-price-moved",
    minimumOutput: "90000000",
    expectedOutput: "92000000",
    observedAt: freshAt,
    expiresAt: "2026-09-03T17:00:25.000Z",
  });
  const arrival = decideAfterDestinationFundsArrive({
    order: limitOrder,
    prior_evaluation: prior,
    fresh_quotes: [fresh],
    balances: [balance(solanaUsdc, SOLANA_WALLET, "150000000", freshAt)],
    observed_at: freshAt,
  });
  assert.equal(arrival.state, "destination_funds_ready_limit_not_met");
  assert.equal(arrival.destination_swap_started, false);
  assert.equal(arrival.destination_funds_returned_automatically, false);
  assert.ok(arrival.refusal_reasons.includes("destination_funds_retained_as_chain_local_buying_power"));
});

test("sell limit uses minimum net USDC after fees and settles to exact same-chain canonical USDC", () => {
  const sellOrder = createUnifiedUsdcLimitOrder({
    order_id: "sell-1",
    owner_scope: "tenant-a",
    side: "sell",
    destination_chain_id: SOLANA,
    destination_venue_id: "jupiter@solana:mainnet-beta#mainnet",
    destination_asset: token,
    limit_price_usdc: "1",
    quantity_atomic: "100000000",
    created_at: NOW,
    expires_at: ORDER_EXPIRY,
    environment: "paper",
  });
  const quote = createUnifiedUsdcLimitQuote({
    order: sellOrder,
    quote_id: "sell-quote",
    provider: "jupiter-fixture",
    provider_health: "healthy",
    route_state: "executable",
    source_venue_id: SOLANA_WALLET,
    destination_venue_id: "jupiter@solana:mainnet-beta#mainnet",
    source_asset: sellOrder.destination_asset,
    destination_asset: solanaUsdc,
    source_capital_location: { chain_id: SOLANA, venue_id: SOLANA_WALLET, asset: sellOrder.destination_asset },
    input_quantity_atomic: "100000000",
    expected_gross_usdc_output_micros: "111000000",
    minimum_gross_usdc_output_micros: "110000000",
    output_is_net_of_embedded_costs: true,
    costs: costs("sell"),
    raven_fee_bps: 100,
    raven_fee_policy_version: "raven-standard-v1",
    source_gas: { state: "sponsored" },
    destination_gas: { state: "not_required" },
    bridge: { state: "not_required" },
    exit_proof: {},
    estimated_settlement_ms: 800,
    transaction_count: 1,
    observed_at: NOW,
    expires_at: QUOTE_EXPIRY,
  });
  const evaluation = evaluateUnifiedUsdcLimitOrder({
    order: sellOrder,
    quotes: [quote],
    balances: [balance(sellOrder.destination_asset, SOLANA_WALLET, "100000000")],
    observed_at: NOW,
  });
  assert.equal(quote.economics.net_minimum_output_usdc_micros, "108700000");
  assert.equal(quote.economics.effective_price_usdc, "1.087");
  assert.equal(evaluation.state, "execution_review_required");
  assert.equal(quote.destination_asset_id, solanaUsdc.asset_id);
  assert.equal(quote.route_kind, "same_chain");
});

test("BNB and Robinhood accounting assets are not silently promoted to canonical Circle USDC", () => {
  assert.equal(canonicalUsdcAssetForChain(BSC), null);
  assert.equal(canonicalUsdcAssetForChain("eip155:4663"), null);
  const capability = unifiedUsdcLimitCapability();
  assert.deepEqual(capability.unsupported_as_canonical_usdc, [BSC, "eip155:4663"]);
  const bscUsdc = {
    chain_id: BSC,
    kind: "stablecoin",
    standard: "erc20",
    reference: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    symbol: "USDC",
    decimals: 18,
    issuer_id: "binance-peg",
    representation: "bridged",
    verification_state: "verified",
  };
  assert.throws(() => buyQuote(order({ allowed_funding_chain_ids: [BSC] }), {
    sourceAsset: bscUsdc,
    sourceVenue: "wallet@eip155:56#user",
    crossChain: true,
  }), /buy_source_is_not_verified_canonical_usdc/);
});

test("journal is append-only, restartable, idempotent, and rejects tampering", () => {
  const limitOrder = order();
  const evaluation = evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [buyQuote(limitOrder, { minimumOutput: "95000000", expectedOutput: "100000000" })],
    balances: [balance(solanaUsdc, SOLANA_WALLET, "200000000")],
    observed_at: NOW,
  });
  const journal = createUnifiedUsdcLimitJournal();
  assert.equal(journal.register(limitOrder).idempotent, false);
  assert.equal(journal.register(limitOrder).idempotent, true);
  const recorded = journal.recordEvaluation(evaluation);
  assert.equal(recorded.current_state, "watching");
  assert.equal(recorded.events.length, 1);
  const snapshot = journal.snapshot();
  assert.equal(verifyUnifiedUsdcLimitJournalSnapshot(snapshot), true);
  const restored = createUnifiedUsdcLimitJournal({ snapshot });
  assert.equal(restored.get(limitOrder.order_id).terminal_event_hash, recorded.terminal_event_hash);
  const tampered = structuredClone(snapshot);
  tampered.orders[0].current_state = "filled";
  assert.equal(verifyUnifiedUsdcLimitJournalSnapshot(tampered), false);
  assert.throws(() => createUnifiedUsdcLimitJournal({ snapshot: tampered }), /limit_journal_snapshot_integrity_invalid/);
});

test("evaluation and journal bounds fail closed before unbounded work or time regression", () => {
  const limitOrder = order();
  const quote = buyQuote(limitOrder);
  const available = balance(solanaUsdc, SOLANA_WALLET, "200000000");
  assert.throws(() => evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: Array(UnifiedUsdcLimitLimits.maximum_quote_candidates_per_evaluation + 1).fill(quote),
    balances: [available],
    observed_at: NOW,
  }), /limit_quote_candidates_out_of_bounds/);
  assert.throws(() => evaluateUnifiedUsdcLimitOrder({
    order: limitOrder,
    quotes: [quote],
    balances: Array(UnifiedUsdcLimitLimits.maximum_balance_rows_per_evaluation + 1).fill(available),
    observed_at: NOW,
  }), /limit_balance_rows_out_of_bounds/);

  const journal = createUnifiedUsdcLimitJournal();
  journal.register(limitOrder);
  journal.transition(limitOrder.order_id, "watching", { at: NOW, reason: "first_evaluation" });
  assert.throws(() => journal.transition(limitOrder.order_id, "watching", {
    at: "2026-09-03T16:59:59.999Z",
    reason: "clock_regression",
  }), /journal_event_before_order|journal_event_time_regression/);
});

test("source boundaries remain globally disabled for automatic bridge, signing, and broadcast", () => {
  assert.deepEqual(UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY, {
    live_automatic_execution: false,
    autonomous_bridging: false,
    server_signing: false,
    server_broadcasting: false,
    automatic_retry: false,
    automatic_unwind: false,
    wallet_or_session_authorization_required: true,
    capital_transfer_requires_manual_approval: true,
  });
});
