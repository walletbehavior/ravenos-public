import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_JITOSOL_MINT,
  SOLANA_TOKEN_PROGRAMS,
  SOLANA_USDC_MINT,
  SOLANA_USDT_MINT,
  SOLANA_WRAPPED_SOL_MINT,
  buildSolanaExposurePortfolio,
  createSolanaAssetDefinitionObservation,
  createSolanaConversionObservation,
  createSolanaExecutableExitObservation,
  createSolanaMarkObservation,
  createSolanaProtocolPositionObservation,
  observeSolanaWallet,
  selectSolanaExecutableValuationCandidates,
} from "../lib/portfolio_governor/solana_exposure.mjs";

const NOW = "2026-08-26T18:00:00.000Z";
const FRESH_EXPIRY = "2026-08-26T18:01:00.000Z";
const WALLET = publicKey(1);

function publicKey(seed) {
  return bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256));
}

function tokenAccount({ accountSeed, mint, amount, decimals = 6, state = "initialized", omitDecimals = false }) {
  const tokenAmount = { amount: String(amount) };
  if (!omitDecimals) tokenAmount.decimals = decimals;
  return {
    pubkey: publicKey(accountSeed),
    account: {
      data: {
        parsed: {
          info: {
            mint,
            state,
            tokenAmount,
          },
        },
      },
    },
  };
}

async function walletObservations({ native = "0", classic = [], token2022 = [], failToken2022 = false } = {}) {
  return observeSolanaWallet({
    wallet_address: WALLET,
    wallet_reference: "wallet_fixture",
    observed_at: NOW,
    provider: "fixture_existing_helius_rpc",
    rpc_request: async (method, params) => {
      if (method === "getBalance") return { context: { slot: 444 }, value: String(native) };
      const program = params[1].programId;
      if (program === SOLANA_TOKEN_PROGRAMS[1].program_id && failToken2022) throw new Error("provider_unavailable");
      return {
        context: { slot: 444 },
        value: program === SOLANA_TOKEN_PROGRAMS[0].program_id ? classic : token2022,
      };
    },
  });
}

function solMark(overrides = {}) {
  return createSolanaMarkObservation({
    asset_id: "solana:SOL",
    price_numerator_minor: "150000000",
    price_denominator_base_units: "1000000000",
    observed_at: NOW,
    source_reference: "existing_raven_price_layer",
    ...overrides,
  });
}

function mark(assetId, mint, numerator, denominator, overrides = {}) {
  return createSolanaMarkObservation({
    asset_id: assetId,
    mint,
    price_numerator_minor: String(numerator),
    price_denominator_base_units: String(denominator),
    observed_at: NOW,
    source_reference: "existing_market_data_adapter",
    ...overrides,
  });
}

function build(observations, overrides = {}) {
  return buildSolanaExposurePortfolio({
    portfolio_id: "portfolio_fixture",
    user_id: "user_fixture",
    snapshot_id: overrides.snapshot_id,
    measurement_id: overrides.measurement_id,
    observed_at: NOW,
    calculated_at: NOW,
    observations,
    asset_definition_observations: overrides.asset_definition_observations || [],
    minimum_material_value_minor: overrides.minimum_material_value_minor ?? "1000000",
    minimum_portfolio_weight_bps: overrides.minimum_portfolio_weight_bps ?? 50,
    maximum_auto_quotes: overrides.maximum_auto_quotes ?? 8,
  });
}

function measuredExposure(result, scopeType, scopeId, side = null) {
  return result.measurement.exposures.find((row) => (
    row.scope_type === scopeType
    && row.scope_id === scopeId
    && (!side || row.exposure_side === side)
  ));
}

test("native SOL and wrapped SOL remain separate instruments but conserve into one SOL exposure", async () => {
  const wallet = await walletObservations({
    native: "1000000000",
    classic: [tokenAccount({ accountSeed: 10, mint: SOLANA_WRAPPED_SOL_MINT, amount: "2000000000", decimals: 9 })],
  });
  const result = build([...wallet.observations, solMark()], { minimum_material_value_minor: "1" });
  assert.equal(result.snapshot.positions.length, 2);
  assert.equal(result.measurement.total_marked_asset_value_minor, "450000000");
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset").value_minor, "450000000");
  assert.equal(measuredExposure(result, "instrument", "solana:SOL").value_minor, "150000000");
  assert.equal(measuredExposure(result, "instrument", "solana:WSOL").value_minor, "300000000");
  assert.equal(result.conservation.ok, true);
  assert.equal(wallet.observations[0].provenance.role, "observation");
  assert.equal(result.economic_exposures[0].provenance.role, "economic_exposure_calculation");
});

test("recognized LSTs require current conversion evidence and preserve wrapper plus protocol identity", async () => {
  const secondLstMint = publicKey(40);
  const wallet = await walletObservations({
    classic: [
      tokenAccount({ accountSeed: 11, mint: SOLANA_JITOSOL_MINT, amount: "1000000000", decimals: 9 }),
      tokenAccount({ accountSeed: 12, mint: secondLstMint, amount: "2000000000", decimals: 9 }),
    ],
  });
  const secondDefinition = createSolanaAssetDefinitionObservation({
    definition_id: "fixture_second_lst_v1",
    asset_id: "solana:SecondLST",
    mint: secondLstMint,
    symbol: "sLST",
    decimals: 9,
    instrument_kind: "liquid_staking_token",
    underlying_mode: "observed_conversion",
    underlying_asset_id: "solana:SOL",
    protocol_id: "fixture_staking_protocol",
  }, NOW);
  const result = build([
    ...wallet.observations,
    solMark(),
    createSolanaConversionObservation({
      instrument_asset_id: "solana:JitoSOL",
      instrument_mint: SOLANA_JITOSOL_MINT,
      underlying_asset_id: "solana:SOL",
      input_amount_base_units: "1000000000",
      output_amount_base_units: "1100000000",
      observed_at: NOW,
      source_reference: "jito_protocol_state",
    }),
    createSolanaConversionObservation({
      instrument_asset_id: "solana:SecondLST",
      instrument_mint: secondLstMint,
      underlying_asset_id: "solana:SOL",
      input_amount_base_units: "1000000000",
      output_amount_base_units: "1050000000",
      observed_at: NOW,
      source_reference: "fixture_protocol_state",
    }),
  ], { asset_definition_observations: [secondDefinition], minimum_material_value_minor: "1" });
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset").value_minor, "480000000");
  assert.equal(measuredExposure(result, "instrument", "solana:JitoSOL").value_minor, "165000000");
  assert.equal(measuredExposure(result, "protocol", "jito").value_minor, "165000000");
  assert.equal(measuredExposure(result, "protocol", "fixture_staking_protocol").value_minor, "315000000");
  assert.equal(result.snapshot.positions.every((row) => ["derived", "exact"].includes(row.economic_resolution_state)), true);
});

test("an LST without current conversion state remains unresolved instead of inheriting SOL exposure", async () => {
  const wallet = await walletObservations({
    classic: [tokenAccount({ accountSeed: 13, mint: SOLANA_JITOSOL_MINT, amount: "1000000000", decimals: 9 })],
  });
  const jitoMark = mark("solana:JitoSOL", SOLANA_JITOSOL_MINT, "165000000", "1000000000");
  const result = build([...wallet.observations, jitoMark]);
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset"), undefined);
  assert.equal(measuredExposure(result, "unresolved", "unresolved", "asset").value_minor, "165000000");
  assert.equal(result.measurement.unresolved_value_minor, "165000000");
  assert.equal(result.snapshot.positions[0].economic_resolution_state, "unresolved");
});

test("stablecoin issuer and dependency dimensions do not confuse token count with diversification", async () => {
  const sharedCircleMint = publicKey(45);
  const wallet = await walletObservations({
    classic: [
      tokenAccount({ accountSeed: 14, mint: SOLANA_USDC_MINT, amount: "100000000", decimals: 6 }),
      tokenAccount({ accountSeed: 15, mint: SOLANA_USDT_MINT, amount: "200000000", decimals: 6 }),
      tokenAccount({ accountSeed: 16, mint: sharedCircleMint, amount: "50000000", decimals: 6 }),
    ],
  });
  const sharedDefinition = createSolanaAssetDefinitionObservation({
    definition_id: "fixture_circle_wrapper_v1",
    asset_id: "solana:CircleUSDWrapper",
    mint: sharedCircleMint,
    decimals: 6,
    instrument_kind: "stablecoin",
    underlying_mode: "self",
    underlying_asset_id: "solana:CircleUSDWrapper",
    stablecoin_issuer_id: "circle",
    stablecoin_dependency_id: "circle:usd_reserve",
  }, NOW);
  const result = build([
    ...wallet.observations,
    mark("solana:USDT", SOLANA_USDT_MINT, "1000000", "1000000"),
    mark("solana:CircleUSDWrapper", sharedCircleMint, "1000000", "1000000"),
  ], { asset_definition_observations: [sharedDefinition] });
  assert.equal(measuredExposure(result, "stablecoin_issuer", "circle").value_minor, "150000000");
  assert.equal(measuredExposure(result, "stablecoin_dependency", "circle:usd_reserve").value_minor, "150000000");
  assert.equal(measuredExposure(result, "stablecoin_issuer", "tether").value_minor, "200000000");
  assert.equal(result.measurement.total_marked_asset_value_minor, "350000000");
});

test("unknown SPL exposure with a mark remains explicitly unresolved and widens exposure bounds", async () => {
  const unknownMint = publicKey(50);
  const wallet = await walletObservations({
    classic: [tokenAccount({ accountSeed: 17, mint: unknownMint, amount: "1000000", decimals: 6 })],
  });
  const result = build([
    ...wallet.observations,
    mark("", unknownMint, "7000000", "1000000"),
  ]);
  assert.equal(result.measurement.total_marked_asset_value_minor, "7000000");
  assert.equal(result.measurement.unresolved_value_minor, "7000000");
  assert.equal(result.measurement.state, "partial");
  assert.equal(result.measurement.state_reasons.includes("underlying_exposure_unresolved"), true);
  assert.equal(result.snapshot.positions[0].asset_id, `solana:mint:${unknownMint}`);
});

test("suspected spam is preserved as a visible position but cannot inflate NAV from a mark alone", async () => {
  const spamMint = publicKey(55);
  const wallet = await walletObservations({
    classic: [tokenAccount({ accountSeed: 18, mint: spamMint, amount: "1000000000", decimals: 6 })],
  });
  const spamDefinition = createSolanaAssetDefinitionObservation({
    definition_id: "fixture_spam_v1",
    asset_id: "solana:spam_fixture",
    mint: spamMint,
    decimals: 6,
    underlying_mode: "self",
    underlying_asset_id: "solana:spam_fixture",
    classification: "suspected_spam",
  }, NOW);
  const result = build([
    ...wallet.observations,
    mark("solana:spam_fixture", spamMint, "1000000", "1000000"),
  ], { asset_definition_observations: [spamDefinition] });
  assert.equal(result.snapshot.positions.length, 1);
  assert.equal(result.snapshot.positions[0].risk_flags.includes("suspected_spam"), true);
  assert.equal(result.snapshot.positions[0].counted_in_nav, false);
  assert.equal(result.measurement.total_marked_asset_value_minor, "0");
  assert.deepEqual(result.snapshot.normalization_diagnostics.excluded_suspect_positions, [result.snapshot.positions[0].position_id]);
});

test("dust remains in marked NAV but automatic executable probing is skipped by explicit materiality", async () => {
  const dustMint = publicKey(60);
  const wallet = await walletObservations({
    classic: [tokenAccount({ accountSeed: 19, mint: dustMint, amount: "1", decimals: 6 })],
  });
  const definition = createSolanaAssetDefinitionObservation({
    asset_id: "solana:dust_fixture",
    mint: dustMint,
    decimals: 6,
    underlying_mode: "self",
    underlying_asset_id: "solana:dust_fixture",
  }, NOW);
  const result = build([
    ...wallet.observations,
    mark("solana:dust_fixture", dustMint, "1000000", "1000000"),
  ], { asset_definition_observations: [definition], minimum_material_value_minor: "1000" });
  assert.equal(result.measurement.total_marked_asset_value_minor, "1");
  assert.equal(result.snapshot.positions[0].executable_value_state, "not_material");
  assert.equal(result.valuation_plan.deferred[0].reason, "below_materiality_threshold");
});

test("missing, stale, unrouteable, and materially impaired valuations remain distinct", async () => {
  const noMarkMint = publicKey(65);
  const staleMint = publicKey(66);
  const illiquidMint = publicKey(67);
  const impairedMint = publicKey(68);
  const wallet = await walletObservations({
    classic: [
      tokenAccount({ accountSeed: 20, mint: noMarkMint, amount: "1000000", decimals: 6 }),
      tokenAccount({ accountSeed: 21, mint: staleMint, amount: "1000000", decimals: 6 }),
      tokenAccount({ accountSeed: 22, mint: illiquidMint, amount: "1000000", decimals: 6 }),
      tokenAccount({ accountSeed: 23, mint: impairedMint, amount: "1000000", decimals: 6 }),
    ],
  });
  const definitions = [noMarkMint, staleMint, illiquidMint, impairedMint].map((mintValue, index) => createSolanaAssetDefinitionObservation({
    asset_id: `solana:fixture_${index}`,
    mint: mintValue,
    decimals: 6,
    underlying_mode: "self",
    underlying_asset_id: `solana:fixture_${index}`,
  }, NOW));
  const result = build([
    ...wallet.observations,
    mark("solana:fixture_1", staleMint, "10000000", "1000000", { freshness_state: "stale" }),
    mark("solana:fixture_2", illiquidMint, "10000000000", "1000000"),
    mark("solana:fixture_3", impairedMint, "10000000000", "1000000"),
    createSolanaExecutableExitObservation({
      input_mint: illiquidMint,
      input_amount_base_units: "1000000",
      routeability: "not_routeable",
      observed_at: NOW,
    }),
    createSolanaExecutableExitObservation({
      input_mint: impairedMint,
      input_amount_base_units: "1000000",
      expected_output_minor: "3200000000",
      minimum_output_minor: "3000000000",
      routeability: "routeable",
      observed_at: NOW,
      expires_at: FRESH_EXPIRY,
    }),
  ], { asset_definition_observations: definitions, minimum_material_value_minor: "1" });
  const byAsset = new Map(result.snapshot.positions.map((row) => [row.asset_id, row]));
  assert.equal(byAsset.get("solana:fixture_0").marked_value_minor, null);
  assert.equal(byAsset.get("solana:fixture_1").marked_value_state, "stale");
  assert.equal(byAsset.get("solana:fixture_2").executable_value_state, "unrouteable");
  assert.equal(byAsset.get("solana:fixture_3").marked_value_minor, "10000000000");
  assert.equal(byAsset.get("solana:fixture_3").executable_value_minor, "3000000000");
  assert.equal(result.measurement.unrouteable_value_minor, "10000000000");
  assert.equal(result.measurement.stale_value_minor, "10000000");
  assert.equal(result.measurement.unavailable_valuations, 1);
});

test("expired executable evidence is stale and is never counted as current executable value", async () => {
  const mintValue = publicKey(70);
  const wallet = await walletObservations({ classic: [tokenAccount({ accountSeed: 24, mint: mintValue, amount: "1000000", decimals: 6 })] });
  const definition = createSolanaAssetDefinitionObservation({
    asset_id: "solana:expired_fixture",
    mint: mintValue,
    decimals: 6,
    underlying_mode: "self",
    underlying_asset_id: "solana:expired_fixture",
  }, NOW);
  const result = build([
    ...wallet.observations,
    mark("solana:expired_fixture", mintValue, "5000000", "1000000"),
    createSolanaExecutableExitObservation({
      input_mint: mintValue,
      input_amount_base_units: "1000000",
      expected_output_minor: "4900000",
      minimum_output_minor: "4800000",
      observed_at: "2026-08-26T17:58:00.000Z",
      expires_at: "2026-08-26T17:59:00.000Z",
    }),
  ], { asset_definition_observations: [definition], minimum_material_value_minor: "1" });
  assert.equal(result.snapshot.positions[0].executable_value_state, "stale");
  assert.equal(result.snapshot.positions[0].executable_value_minor, null);
  assert.equal(result.snapshot.positions[0].expected_executable_value_minor, "4900000");
  assert.equal(result.measurement.total_executable_asset_value_minor, "0");
});

test("non-50/50 LP look-through conserves NAV and preserves pool plus protocol identity", () => {
  const lp = createSolanaProtocolPositionObservation({
    position_id: "lp_position_1",
    economic_lot_id: "meteora:lp:pool_1:position_1",
    instrument_asset_id: "solana:lp:pool_1",
    position_kind: "lp",
    protocol_id: "meteora",
    pool_id: "pool_1",
    components: [
      { asset_id: "solana:SOL", amount_base_units: "1000000000", decimals: 9 },
      { asset_id: "solana:USDC", amount_base_units: "300000000", decimals: 6 },
    ],
    observed_at: NOW,
    source_reference: "fixture_current_pool_state",
  });
  const result = build([lp, solMark()], { minimum_material_value_minor: "1" });
  assert.equal(result.measurement.total_marked_asset_value_minor, "450000000");
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset").value_minor, "150000000");
  assert.equal(measuredExposure(result, "asset", "solana:USDC", "asset").value_minor, "300000000");
  assert.equal(measuredExposure(result, "instrument", "solana:lp:pool_1").value_minor, "450000000");
  assert.equal(measuredExposure(result, "protocol", "meteora").value_minor, "450000000");
  assert.equal(result.conservation.ok, true);
});

test("temporarily unavailable LP underlying state becomes unresolved rather than synthetic 50/50 exposure", () => {
  const lp = createSolanaProtocolPositionObservation({
    position_id: "lp_unresolved",
    instrument_asset_id: "solana:lp:unresolved_pool",
    amount_base_units: "1000000",
    decimals: 6,
    position_kind: "lp",
    protocol_id: "orca",
    pool_id: "unresolved_pool",
    components: [],
    underlying_state: "unavailable",
    observed_at: NOW,
  });
  const result = build([
    lp,
    mark("solana:lp:unresolved_pool", null, "500000000", "1000000"),
  ]);
  assert.equal(result.measurement.unresolved_value_minor, "500000000");
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset"), undefined);
  assert.equal(measuredExposure(result, "protocol", "orca").value_minor, "500000000");
});

test("lending supply and borrow preserve gross assets, liabilities, net equity, and leverage", () => {
  const supplied = createSolanaProtocolPositionObservation({
    position_id: "lend_supply_sol",
    instrument_asset_id: "solana:lending_receipt:sol",
    position_kind: "lending_supply",
    protocol_id: "fixture_lending",
    components: [{ asset_id: "solana:SOL", amount_base_units: "10000000000", decimals: 9, exposure_side: "asset" }],
    observed_at: NOW,
  });
  const borrowed = createSolanaProtocolPositionObservation({
    position_id: "lend_borrow_usdc",
    instrument_asset_id: "solana:lending_debt:usdc",
    position_kind: "lending_borrow",
    exposure_side: "liability",
    protocol_id: "fixture_lending",
    components: [{ asset_id: "solana:USDC", amount_base_units: "400000000", decimals: 6, exposure_side: "liability" }],
    observed_at: NOW,
  });
  const result = build([supplied, borrowed, solMark()], { minimum_material_value_minor: "1" });
  assert.equal(result.measurement.total_marked_asset_value_minor, "1500000000");
  assert.equal(result.measurement.total_liability_value_minor, "400000000");
  assert.equal(result.measurement.net_equity_minor, "1100000000");
  assert.equal(result.measurement.gross_economic_exposure_minor, "1900000000");
  assert.equal(measuredExposure(result, "liability", "solana:USDC", "liability").value_minor, "400000000");
  assert.equal(result.measurement.gross_leverage_bps, 17273);
  assert.equal(result.conservation.ok, true);
});

test("an unvalued borrowing remains an unknown liability and cannot collapse to zero debt", () => {
  const reserve = createSolanaProtocolPositionObservation({
    position_id: "reserve_usdc",
    instrument_asset_id: "solana:USDC",
    amount_base_units: "1000000000",
    decimals: 6,
    position_kind: "spot_position",
    protocol_id: "wallet",
    components: [{ asset_id: "solana:USDC", amount_base_units: "1000000000", decimals: 6 }],
    observed_at: NOW,
  });
  const unknownBorrow = createSolanaProtocolPositionObservation({
    position_id: "lend_borrow_unvalued",
    instrument_asset_id: "solana:lending_debt:unknown",
    amount_base_units: "5000000",
    decimals: 6,
    position_kind: "lending_borrow",
    exposure_side: "liability",
    protocol_id: "fixture_lending",
    components: [{ asset_id: "solana:UNKNOWN_DEBT", amount_base_units: "5000000", decimals: 6, exposure_side: "liability" }],
    observed_at: NOW,
  });
  const result = build([reserve, unknownBorrow]);
  const debt = result.snapshot.positions.find((row) => row.position_id === "lend_borrow_unvalued");
  assert.equal(debt.liability_value_minor, null);
  assert.equal(debt.liability_value_state, "unavailable");
  assert.equal(result.measurement.total_liability_value_minor, "0");
  assert.equal(result.measurement.total_liability_value_state, "partial");
  assert.equal(result.measurement.unavailable_liability_valuations, 1);
  assert.equal(result.measurement.net_equity_minor, null);
  assert.equal(result.measurement.state_reasons.includes("liability_value_unavailable"), true);
  assert.equal(result.conservation.ok, true);
});

test("a token receipt explicitly tied to a protocol position is representation-only and cannot double count principal", async () => {
  const receiptMint = publicKey(75);
  const receiptAccount = publicKey(76);
  const wallet = await walletObservations({
    classic: [{
      ...tokenAccount({ accountSeed: 76, mint: receiptMint, amount: "100000000", decimals: 6 }),
      pubkey: receiptAccount,
    }],
  });
  const protocolPosition = createSolanaProtocolPositionObservation({
    position_id: "represented_supply",
    instrument_asset_id: "solana:lending_receipt:represented",
    position_kind: "lending_supply",
    protocol_id: "fixture_lending",
    representation_token_account_ids: [receiptAccount],
    components: [{ asset_id: "solana:USDC", amount_base_units: "100000000", decimals: 6 }],
    observed_at: NOW,
  });
  const result = build([...wallet.observations, protocolPosition]);
  const receipt = result.snapshot.positions.find((row) => row.account_ref === "wallet_fixture");
  assert.equal(receipt.representation_only, true);
  assert.equal(receipt.counted_in_nav, false);
  assert.equal(result.measurement.total_marked_asset_value_minor, "100000000");
  assert.equal(measuredExposure(result, "asset", "solana:USDC", "asset").value_minor, "100000000");
});

test("closed, zero, malformed, and missing-decimal token accounts fail closed without erasing diagnostics", async () => {
  const wallet = await walletObservations({
    classic: [
      tokenAccount({ accountSeed: 80, mint: SOLANA_USDC_MINT, amount: "1000000", state: "closed" }),
      tokenAccount({ accountSeed: 81, mint: SOLANA_USDC_MINT, amount: "0" }),
      tokenAccount({ accountSeed: 82, mint: SOLANA_USDC_MINT, amount: "1000000", omitDecimals: true }),
      { pubkey: publicKey(83), account: { data: { parsed: { info: { mint: "bad", tokenAmount: { amount: "9", decimals: 6 } } } } } },
    ],
  });
  const result = build(wallet.observations);
  assert.equal(result.snapshot.positions.length, 1);
  assert.equal(result.snapshot.positions[0].metadata_state, "malformed");
  assert.equal(result.snapshot.positions[0].marked_value_minor, null);
  assert.equal(result.snapshot.positions[0].economic_resolution_state, "unresolved");
  assert.equal(result.snapshot.normalization_diagnostics.closed_or_zero_positions.length, 2);
  assert.equal(result.snapshot.normalization_diagnostics.rejected_observations.length, 1);
});

test("the RPC adapter preserves partial success without persisting the public address", async () => {
  const wallet = await walletObservations({ native: "1000000000", failToken2022: true });
  assert.equal(wallet.observations.length, 2);
  assert.deepEqual(wallet.diagnostics.successful_components, ["native", "spl_token"]);
  assert.equal(wallet.diagnostics.failures.length, 1);
  assert.equal(wallet.diagnostics.wallet_address_persisted, false);
  assert.equal(JSON.stringify(wallet).includes(WALLET), false);
});

test("unsafe numeric balances and malformed RPC components fail closed without erasing valid observations", async () => {
  const wallet = await observeSolanaWallet({
    wallet_address: WALLET,
    wallet_reference: "wallet_malformed_provider_fixture",
    observed_at: NOW,
    provider: "fixture_existing_helius_rpc",
    rpc_request: async (method, params) => {
      if (method === "getBalance") return { context: { slot: 444 }, value: Number.MAX_SAFE_INTEGER + 1 };
      const program = params[1].programId;
      if (program === SOLANA_TOKEN_PROGRAMS[0].program_id) return { context: { slot: 444 }, value: [] };
      return { context: { slot: 444 }, value: null };
    },
  });
  assert.equal(wallet.observations.length, 1);
  assert.deepEqual(wallet.diagnostics.successful_components, ["spl_token"]);
  assert.deepEqual(wallet.diagnostics.failures, [
    { component: "native", reason: "provider_response_invalid" },
    { component: "token_2022", reason: "provider_response_invalid" },
  ]);
  assert.equal(JSON.stringify(wallet).includes(String(Number.MAX_SAFE_INTEGER + 1)), false);
});

test("large illiquid positions retain marked value but zero current executable coverage", async () => {
  const mintValue = publicKey(85);
  const wallet = await walletObservations({ classic: [tokenAccount({ accountSeed: 86, mint: mintValue, amount: "1000000" })] });
  const definition = createSolanaAssetDefinitionObservation({
    asset_id: "solana:large_illiquid",
    mint: mintValue,
    decimals: 6,
    underlying_mode: "self",
    underlying_asset_id: "solana:large_illiquid",
  }, NOW);
  const result = build([
    ...wallet.observations,
    mark("solana:large_illiquid", mintValue, "10000000000", "1000000"),
    createSolanaExecutableExitObservation({
      input_mint: mintValue,
      input_amount_base_units: "1000000",
      routeability: "not_routeable",
      observed_at: NOW,
    }),
  ], { asset_definition_observations: [definition], minimum_material_value_minor: "1" });
  assert.equal(result.measurement.total_marked_asset_value_minor, "10000000000");
  assert.equal(result.measurement.total_executable_asset_value_minor, "0");
  assert.equal(result.measurement.unrouteable_value_minor, "10000000000");
  assert.equal(result.measurement.executable_coverage_bps, 0);
});

test("same economic asset through multiple protocols aggregates asset exposure while preserving protocol dimensions", () => {
  const first = createSolanaProtocolPositionObservation({
    position_id: "protocol_a_sol",
    instrument_asset_id: "solana:receipt:a",
    position_kind: "lending_supply",
    protocol_id: "protocol_a",
    components: [{ asset_id: "solana:SOL", amount_base_units: "1000000000", decimals: 9 }],
    observed_at: NOW,
  });
  const second = createSolanaProtocolPositionObservation({
    position_id: "protocol_b_sol",
    instrument_asset_id: "solana:receipt:b",
    position_kind: "liquid_staking_position",
    protocol_id: "protocol_b",
    components: [{ asset_id: "solana:SOL", amount_base_units: "2000000000", decimals: 9 }],
    observed_at: NOW,
  });
  const result = build([first, second, solMark()]);
  assert.equal(measuredExposure(result, "asset", "solana:SOL", "asset").value_minor, "450000000");
  assert.equal(measuredExposure(result, "protocol", "protocol_a").value_minor, "150000000");
  assert.equal(measuredExposure(result, "protocol", "protocol_b").value_minor, "300000000");
});

test("wallets containing only unknown unmarked assets and empty wallets report honest unavailable and empty states", async () => {
  const unknownMint = publicKey(90);
  const unknownWallet = await walletObservations({ classic: [tokenAccount({ accountSeed: 91, mint: unknownMint, amount: "1000000" })] });
  const unknown = build(unknownWallet.observations);
  assert.equal(unknown.measurement.state, "unavailable");
  assert.equal(unknown.measurement.unavailable_valuations, 1);
  assert.equal(unknown.measurement.unresolved_unknown_value_count, 1);

  const emptyWallet = await walletObservations();
  const empty = build(emptyWallet.observations);
  assert.equal(empty.snapshot.positions.length, 0);
  assert.equal(empty.measurement.state, "empty");
  assert.equal(empty.measurement.net_equity_minor, "0");
});

test("bounded quote planning selects only material positions and never creates transaction or execution objects", () => {
  const positions = [
    { position_id: "a", economic_lot_id: "a", asset_id: "a", quantity_base_units: "1", marked_value_minor: "9000", executable_value_minor: null, executable_value_state: "unavailable", position_state: "open", position_side: "asset", counted_in_nav: true, representation_only: false, risk_flags: [] },
    { position_id: "b", economic_lot_id: "b", asset_id: "b", quantity_base_units: "1", marked_value_minor: "8000", executable_value_minor: null, executable_value_state: "unavailable", position_state: "open", position_side: "asset", counted_in_nav: true, representation_only: false, risk_flags: [] },
    { position_id: "dust", economic_lot_id: "dust", asset_id: "dust", quantity_base_units: "1", marked_value_minor: "1", executable_value_minor: null, executable_value_state: "unavailable", position_state: "open", position_side: "asset", counted_in_nav: true, representation_only: false, risk_flags: [] },
  ];
  const plan = selectSolanaExecutableValuationCandidates({
    positions,
    minimum_material_value_minor: "100",
    minimum_portfolio_weight_bps: 0,
    maximum_auto_quotes: 1,
  });
  assert.deepEqual(plan.selected.map((row) => row.position_id), ["a"]);
  assert.equal(plan.deferred.find((row) => row.position_id === "b").reason, "bounded_quote_budget");
  assert.equal(plan.deferred.find((row) => row.position_id === "dust").reason, "below_materiality_threshold");
  assert.equal(plan.creates_execution_quote, false);
  assert.equal(plan.selected[0].transaction_material_allowed, false);
});

test("identical immutable evidence produces identical snapshots and measurements without policy or execution authority", async () => {
  const wallet = await walletObservations({ native: "1000000000" });
  const observations = [...wallet.observations, solMark()];
  const first = build(observations, { snapshot_id: "deterministic_snapshot", measurement_id: "deterministic_measurement" });
  const second = build(observations, { snapshot_id: "deterministic_snapshot", measurement_id: "deterministic_measurement" });
  assert.equal(first.snapshot.record_hash, second.snapshot.record_hash);
  assert.equal(first.measurement.record_hash, second.measurement.record_hash);
  assert.equal(first.boundary.policy_evaluated, false);
  assert.equal(first.boundary.portfolio_targets_inferred, false);
  assert.equal(first.boundary.market_posture_effect, "none");
  assert.equal(first.boundary.execution_objects_created, false);
  assert.equal(first.snapshot.execution_objects_created, false);
  assert.equal(first.measurement.execution_objects_created, false);
  assert.equal(JSON.stringify(first).includes("ExecutionQuote"), false);
  assert.equal(JSON.stringify(first).includes("ExecutionIntent"), false);
});
