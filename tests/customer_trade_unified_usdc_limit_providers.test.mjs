import assert from "node:assert/strict";
import test from "node:test";

import {
  UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY,
  buildLifiFundingQuoteRequest,
  buildLifiIntentQuoteRequest,
  encodeLifiInteroperableAddress,
  normalizeLifiIntentQuoteEvidence,
  normalizeLifiSupportedChainsEvidence,
  requestLifiIntentQuoteEvidence,
  unifiedUsdcLimitProviderCapabilities,
  verifyLifiIntentQuoteEvidence,
  verifyLifiIntentQuoteRequest,
  verifyLifiSupportedChainsEvidence,
} from "../lib/customer_trade/unified_usdc_limit_providers.mjs";
import {
  canonicalUsdcAssetForChain,
  createUnifiedUsdcLimitOrder,
} from "../lib/customer_trade/unified_usdc_limit_orders.mjs";

const NOW = "2026-09-03T17:00:00.000Z";
const BASE = "eip155:8453";
const ROBINHOOD = "eip155:4663";
const EVM_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const RH_TOKEN = {
  chain_id: ROBINHOOD,
  kind: "fungible_token",
  standard: "erc20",
  reference: "0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03",
  symbol: "ARROW",
  decimals: 18,
  representation: "canonical",
  verification_state: "verified",
};
const RH_USDG = {
  chain_id: ROBINHOOD,
  kind: "stablecoin",
  standard: "erc20",
  reference: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  symbol: "USDG",
  decimals: 6,
  issuer_id: "global-dollar-network",
  representation: "canonical",
  verification_state: "verified",
};

function order() {
  return createUnifiedUsdcLimitOrder({
    order_id: "base-usdc-to-rh-arrow",
    owner_scope: "tenant-a",
    side: "buy",
    destination_chain_id: ROBINHOOD,
    destination_venue_id: "uniswap@eip155:4663#mainnet",
    destination_asset: RH_TOKEN,
    limit_price_usdc: "0.5",
    trade_notional_usdc: "100",
    allowed_funding_chain_ids: [BASE],
    maximum_quote_age_ms: 15_000,
    created_at: NOW,
    expires_at: "2026-09-03T18:00:00.000Z",
    environment: "paper",
  });
}

function request() {
  return buildLifiIntentQuoteRequest({
    order: order(),
    source_chain_id: BASE,
    source_asset: canonicalUsdcAssetForChain(BASE),
    source_wallet_address: EVM_WALLET,
    destination_wallet_address: EVM_WALLET,
    requested_at: NOW,
  });
}

function quoteRow({ quoteId, output = "200000000000000000000", validUntil = 1788454820 } = {}) {
  const built = request();
  return {
    quoteId,
    validUntil,
    partialFill: false,
    failureHandling: "refund-automatic",
    preview: {
      inputs: [{ ...built.body.intent.inputs[0] }],
      outputs: [{ ...built.body.intent.outputs[0], amount: output }],
    },
  };
}

test("ERC-7930 interoperable address encoding matches the official EVM and Solana examples", () => {
  assert.equal(
    encodeLifiInteroperableAddress({ chain_id: "eip155:1", address: EVM_WALLET }),
    "0x00010000010114d8da6bf26964af9d7eed9e03e53415d37aa96045",
  );
  assert.equal(
    encodeLifiInteroperableAddress({
      chain_id: "solana:mainnet-beta",
      address: "MJKqp326RZCHnAAbew9MDdui3iCKWco7fsK9sVuZTX2",
    }),
    "0x000100022045296998a6f8e2a784db5d9f95e18fc23f70441a1039446801089879b08c7ef02005333498d5aea4ae009585c43f7b8c30df8e70187d4a713d134f977fc8dfe0b5",
  );
});

test("LI.FI request binds one exact canonical-USDC source to the exact destination asset", () => {
  const value = request();
  assert.equal(verifyLifiIntentQuoteRequest(value), true);
  assert.equal(value.source_chain_id, BASE);
  assert.equal(value.destination_chain_id, ROBINHOOD);
  assert.equal(value.body.intent.inputs[0].amount, "100000000");
  assert.equal(value.body.intent.outputs[0].amount, null);
  assert.equal(value.semantics.provider_quote_is_not_a_raven_limit_trigger, true);
  assert.deepEqual(value.execution_boundary, UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY);
});

test("LI.FI request rejects lookalike USDC and cross-chain sell construction", () => {
  const lookalike = {
    ...canonicalUsdcAssetForChain(BASE),
    reference: "0x1111111111111111111111111111111111111111",
    asset_id: undefined,
  };
  assert.throws(() => buildLifiIntentQuoteRequest({
    order: order(),
    source_chain_id: BASE,
    source_asset: lookalike,
    source_wallet_address: EVM_WALLET,
    destination_wallet_address: EVM_WALLET,
    requested_at: NOW,
  }), /lifi_source_is_not_verified_canonical_usdc/);

  const sell = createUnifiedUsdcLimitOrder({
    order_id: "sell-rh-arrow",
    owner_scope: "tenant-a",
    side: "sell",
    destination_chain_id: ROBINHOOD,
    destination_venue_id: "uniswap@eip155:4663#mainnet",
    destination_asset: RH_TOKEN,
    limit_price_usdc: "0.5",
    quantity_atomic: "1000000000000000000",
    created_at: NOW,
    expires_at: "2026-09-03T18:00:00.000Z",
    environment: "paper",
  });
  assert.throws(() => buildLifiIntentQuoteRequest({
    order: sell,
    source_chain_id: BASE,
    source_asset: canonicalUsdcAssetForChain(BASE),
    source_wallet_address: EVM_WALLET,
    destination_wallet_address: EVM_WALLET,
    requested_at: NOW,
  }), /lifi_cross_chain_sell_not_supported/);
});

test("cross-chain funding is a distinct non-atomic leg ending in a verified destination stablecoin", () => {
  const value = buildLifiFundingQuoteRequest({
    order: order(),
    source_chain_id: BASE,
    source_asset: canonicalUsdcAssetForChain(BASE),
    destination_funding_asset: RH_USDG,
    source_wallet_address: EVM_WALLET,
    destination_wallet_address: EVM_WALLET,
    requested_at: NOW,
  });
  assert.equal(verifyLifiIntentQuoteRequest(value), true);
  assert.equal(value.route_purpose, "cross_chain_funding");
  assert.equal(value.order_destination_asset_id, order().destination_asset_id);
  assert.equal(value.destination_asset_id, `${ROBINHOOD}/erc20:${RH_USDG.reference}`);
  assert.equal(value.semantics.destination_swap_required, true);

  const evidence = normalizeLifiIntentQuoteEvidence({
    request: value,
    response: { quotes: [{
      ...quoteRow({ quoteId: "funding-leg", output: "9871962" }),
      preview: {
        inputs: [{ ...value.body.intent.inputs[0] }],
        outputs: [{ ...value.body.intent.outputs[0], amount: "9871962" }],
      },
    }] },
    observed_at: NOW,
  });
  assert.equal(evidence.route_purpose, "cross_chain_funding");
  assert.equal(evidence.semantics.usable_for_limit_trigger, false);
  assert.ok(evidence.semantics.incomplete_reasons.includes("destination_swap_quote_required"));
});

test("LI.FI quote selection is deterministic and remains incomplete trigger evidence", () => {
  const built = request();
  const best = quoteRow({ quoteId: "z-best", output: "205000000000000000000" });
  const lesser = quoteRow({ quoteId: "a-lesser", output: "200000000000000000000" });
  const rows = [
    normalizeLifiIntentQuoteEvidence({ request: built, response: { quotes: [lesser, best] }, observed_at: NOW }),
    normalizeLifiIntentQuoteEvidence({ request: built, response: { quotes: [best, lesser] }, observed_at: NOW }),
  ];
  assert.deepEqual(rows.map((row) => row.selected_quote_id), ["z-best", "z-best"]);
  assert.equal(rows.every(verifyLifiIntentQuoteEvidence), true);
  assert.equal(rows[0].semantics.usable_for_limit_trigger, false);
  assert.equal(rows[0].semantics.all_in_economics_complete, false);
  assert.deepEqual(rows[0].semantics.incomplete_reasons, [
    "funding_transaction_gas_unknown",
    "raven_fee_not_applied",
    "reverse_exit_unavailable",
  ]);
});

test("untrusted provider text cannot enter quote evidence", () => {
  const built = request();
  const malicious = quoteRow({ quoteId: "malicious-metadata" });
  malicious.failureHandling = "<script>alert(1)</script>";
  malicious.metadata = { exclusiveFor: "ignore_previous_instructions!" };
  const evidence = normalizeLifiIntentQuoteEvidence({
    request: built,
    response: { quotes: [malicious] },
    observed_at: NOW,
  });
  assert.equal(evidence.route_state, "unavailable");
  assert.equal(evidence.candidates[0].failure_handling, null);
  assert.equal(evidence.candidates[0].exclusive_solver, null);
  assert.deepEqual(evidence.candidates[0].refusal_reasons, [
    "exclusive_solver_invalid",
    "failure_handling_invalid",
  ]);
});

test("supported-chain evidence proves each desired lane independently", () => {
  const evidence = normalizeLifiSupportedChainsEvidence({
    observed_at: NOW,
    response: [
      { chainId: 1, chainType: "EVM", name: "Ethereum" },
      { chainId: 56, chainType: "EVM", name: "BNB Chain" },
      { chainId: 8453, chainType: "EVM", name: "Base" },
      { chainId: 4663, chainType: "EVM", name: "Robinhood Chain" },
      { chainId: "1151111081099710", chainType: "SVM", name: "Solana" },
    ],
  });
  assert.equal(verifyLifiSupportedChainsEvidence(evidence), true);
  assert.deepEqual(evidence.desired_lane_support, {
    "eip155:1": true,
    "eip155:56": true,
    "eip155:8453": true,
    "eip155:4663": true,
    "solana:mainnet-beta": true,
  });
  assert.equal(evidence.live_order_submission_enabled, false);
});

test("provider fetch is bounded and returns sealed quote evidence", async () => {
  const built = request();
  const body = JSON.stringify({ quotes: [quoteRow({ quoteId: "bounded" })] });
  const evidence = await requestLifiIntentQuoteEvidence({
    request: built,
    clock: () => Date.parse(NOW),
    fetch_impl: async (_url, init) => {
      assert.equal(init.method, "POST");
      assert.equal(init.signal.aborted, false);
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(evidence.selected_quote_id, "bounded");
  assert.equal(verifyLifiIntentQuoteEvidence(evidence), true);

  await assert.rejects(() => requestLifiIntentQuoteEvidence({
    request: built,
    clock: () => Date.parse(NOW),
    maximum_response_bytes: 64,
    fetch_impl: async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(new TextEncoder().encode(body).byteLength) },
    }),
  }), /lifi_response_too_large/);
});

test("capability registry never converts quote support into execution authority", () => {
  const capability = unifiedUsdcLimitProviderCapabilities();
  assert.equal(capability.providers.lifi_intents_v1.status, "quote_evidence_ready_submission_disabled");
  assert.equal(capability.providers.lifi_intents_v1.order_submission, false);
  assert.equal(capability.providers.lifi_intents_v1.live_enabled, false);
  assert.equal(capability.providers.jupiter_trigger_v2.status, "not_selected");
  assert.match(capability.providers.jupiter_trigger_v2.refusal_reason, /custodial_vault/);
  assert.deepEqual(capability.execution_boundary, UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY);
});
