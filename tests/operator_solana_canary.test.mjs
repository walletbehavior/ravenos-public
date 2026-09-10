import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import bs58 from "bs58";
import { RAVEN_JUPITER_REFERRAL, ravenJupiterFeeAsset } from "../lib/customer_trade/jupiter_referral.mjs";
import { referralFixture } from "./fixtures/jupiter_referral.mjs";
import { PUMP_SWAP_REVIEW } from "../lib/customer_trade/pump_swap_review.mjs";

import {
  OperatorCanaryExecutionAuthorization,
  OperatorSolanaCanaryLimits,
  SOLANA_CANARY_REVIEWED_PROGRAMS,
  SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA,
  SOLANA_MAINNET_GENESIS_HASH,
  SOLANA_USDC_MINT,
  SOLANA_WRAPPED_MINT,
  SOLANA_UNREVIEWED_DEX_EXCLUSIONS,
  parseExactSolanaTerminalContext,
  runCustomerSolanaLivePreflight,
  runOperatorSolanaCanaryPreflight,
} from "../lib/customer_trade/operator_solana_canary.mjs";

const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function shortVec(value) {
  const out = [];
  let next = value;
  do {
    let byte = next & 0x7f;
    next >>= 7;
    if (next) byte |= 0x80;
    out.push(byte);
  } while (next);
  return Buffer.from(out);
}

function key(seed) {
  return Buffer.alloc(32, seed);
}

function fixtureTransaction(walletAddress, programAddress = JUPITER_PROGRAM, dynamicCount = 1, feeIndex = null, feeContext = null) {
  const wallet = Buffer.from(bs58.decode(walletAddress));
  const program = Buffer.from(bs58.decode(programAddress));
  const lookupAddress = key(22);
  const dynamicAccounts = Array.from({ length: dynamicCount }, (_, index) => key(23 + index));
  if (feeIndex !== null) dynamicAccounts[feeIndex] = Buffer.from(bs58.decode(ravenJupiterFeeAsset(feeContext.feeMint).account));
  const feeData = Buffer.alloc(41);
  Buffer.from("d19853937cfed8e9", "hex").copy(feeData);
  feeData.writeBigUInt64LE(1_000_000n, 9);
  feeData.writeBigUInt64LE(420_000n, 17);
  feeData.writeUInt16LE(50, 25);
  feeData.writeUInt16LE(feeContext?.bps ?? 100, 27);
  feeData.writeUInt32LE(feeContext?.routeCount ?? 1, 31);
  const token2022 = feeContext?.tokenProgram === TOKEN_2022_PROGRAM;
  const dynamicStart = token2022 ? 6 : 5;
  const sourceProgramIndex = token2022 && feeContext.side === "sell" ? 5 : 4;
  const destinationProgramIndex = token2022 && feeContext.side === "buy" ? 5 : 4;
  const instructionAccounts = feeContext ? [1, 0, dynamicStart, dynamicStart, dynamicStart, dynamicStart, 2, 3, sourceProgramIndex, destinationProgramIndex, 1, 1, dynamicStart + feeIndex] : [0, 2];
  const instructionData = feeContext ? feeData : Buffer.from([9, 10]);
  const instruction = Buffer.concat([
    Buffer.from([1]),
    shortVec(instructionAccounts.length),
    Buffer.from(instructionAccounts),
    shortVec(instructionData.length),
    instructionData,
  ]);
  const message = Buffer.concat([
    Buffer.from([0x80, 1, 0, feeContext ? dynamicStart - 1 : 1]),
    shortVec(feeContext ? dynamicStart : 2),
    wallet,
    program,
    ...(feeContext ? [bs58.decode(feeContext.inputMint), bs58.decode(feeContext.outputMint), bs58.decode(TOKEN_PROGRAM)] : []),
    ...(token2022 ? [bs58.decode(TOKEN_2022_PROGRAM)] : []),
    key(7),
    shortVec(1),
    instruction,
    shortVec(1),
    lookupAddress,
    shortVec(dynamicAccounts.length),
    Buffer.from(dynamicAccounts.map((_, index) => index)),
    shortVec(0),
  ]);
  const lookupMeta = Buffer.alloc(56);
  lookupMeta.writeUInt32LE(1, 0);
  lookupMeta.writeBigUInt64LE((1n << 64n) - 1n, 4);
  lookupMeta.writeBigUInt64LE(100n, 12);
  return {
    transaction: Buffer.concat([shortVec(1), Buffer.alloc(64), message]).toString("base64"),
    lookupAddress: bs58.encode(lookupAddress),
    lookupData: Buffer.concat([lookupMeta, ...dynamicAccounts]).toString("base64"),
    dynamicAddresses: dynamicAccounts.map((address) => bs58.encode(address)),
  };
}

function tokenAccount(mint, owner, amount, lamports = 2_039_280, program = TOKEN_PROGRAM, extensions = Buffer.from([2, 7, 0, 0, 0])) {
  const data = Buffer.alloc(165);
  Buffer.from(bs58.decode(mint)).copy(data, 0);
  Buffer.from(bs58.decode(owner)).copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  if (mint === SOLANA_WRAPPED_MINT) {
    const reserve = BigInt(lamports) - BigInt(amount);
    if (reserve < 0n) throw new Error("wrapped_sol_fixture_lamports_invalid");
    data.writeUInt32LE(1, 109);
    data.writeBigUInt64LE(reserve, 113);
  }
  return {
    lamports,
    owner: program,
    executable: false,
    data: [(program === TOKEN_2022_PROGRAM ? Buffer.concat([data, extensions]) : data).toString("base64"), "base64"],
  };
}

function walletAccount(lamports) {
  return {
    lamports,
    owner: SYSTEM_PROGRAM,
    executable: false,
    data: ["", "base64"],
  };
}

function routeLeg(inputMint, outputMint, seed, bps = 10_000) {
  return {
    bps,
    swapInfo: {
      label: `Fixture ${seed}`,
      ammKey: bs58.encode(key(seed)),
      inputMint,
      outputMint,
      inAmount: "1000000",
      outAmount: "420000",
    },
  };
}

function exactContext() {
  const pool = bs58.encode(key(8));
  const token = bs58.encode(key(9));
  const quote = bs58.encode(key(10));
  return {
    pool,
    token,
    quote,
    url: `https://ravenos.xyz/terminal/?chain=solana&market=spot&instrument_scope=exact_pool&instrument_id=${encodeURIComponent(`solana:pool:${pool}`)}&pair_address=${pool}&token_address=${token}&quote_address=${quote}&asset=CANARY%2FSOL`,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function runtime({
  side = "buy",
  fundingKind = "native_sol",
  settlementKind = "native_sol",
  router = "metis",
  program = JUPITER_PROGRAM,
  invokedProgram = program,
  simulationError = null,
  genesisHash = SOLANA_MAINNET_GENESIS_HASH,
  pairToken = null,
  walletBalance = 100_000_000,
  preWalletBalance = null,
  postWalletBalance = null,
  preTokenBalance = null,
  postTokenBalance = null,
  preWrappedBalance = null,
  postWrappedBalance = null,
  preWrappedAccountLamports = 3_000_000,
  postWrappedAccountLamports = 2_039_280,
  preUsdcBalance = null,
  postUsdcBalance = null,
  priceImpact = 0.1,
  signatureFee = 5_000,
  priorityFee = 1_000,
  rentFee = 0,
  blockhashValid = true,
  currentBlockHeight = 1_000,
  lastValidBlockHeight = 1_100,
  simulationUnits = 12_345,
  simulationFee = 6_000,
  dynamicCount = 1,
  routePlan = null,
  referralAccount = null,
  referralFeeBps = 100,
  providerReferralAccount = referralAccount,
  providerReferralFeeBps = referralFeeBps,
  platformFeeAmount = "10000",
  referralPreBalance = 0,
  referralPostBalance = 8_000,
  mintProgram = TOKEN_PROGRAM,
  mintExtensions = [{ extension: "metadataPointer" }, { extension: "tokenMetadata" }],
  tokenAccountExtensions,
  routeTokenProgram = mintProgram,
} = {}) {
  const wallet = bs58.encode(key(11));
  const context = exactContext();
  const hasWrappedState = preWrappedBalance !== null || postWrappedBalance !== null;
  const usesUsdc = (side === "buy" ? fundingKind : settlementKind) === "canonical_usdc";
  const hasReferral = Boolean(referralAccount);
  const resolvedDynamicCount = Math.max(dynamicCount, 1 + Number(hasWrappedState) + Number(usesUsdc) + Number(hasReferral));
  const inputMint = side === "buy"
    ? fundingKind === "canonical_usdc" ? SOLANA_USDC_MINT : SOLANA_WRAPPED_MINT
    : context.token;
  const outputMint = side === "buy"
    ? context.token
    : settlementKind === "canonical_usdc" ? SOLANA_USDC_MINT : SOLANA_WRAPPED_MINT;
  const feeMint = usesUsdc ? SOLANA_USDC_MINT : SOLANA_WRAPPED_MINT;
  const transaction = fixtureTransaction(wallet, program, resolvedDynamicCount, hasReferral ? 1 + Number(hasWrappedState) + Number(usesUsdc) : null,
    hasReferral ? { inputMint, outputMint, feeMint, bps: referralFeeBps, routeCount: routePlan?.length || 1, tokenProgram: routeTokenProgram, side } : null);
  const selectedPreAmount = preTokenBalance ?? (side === "buy" ? 0 : 1_000_000);
  const selectedPostAmount = postTokenBalance ?? (side === "buy" ? 420_000 : 0);
  const authoritativePreWalletBalance = preWalletBalance ?? walletBalance;
  const simulatedWalletBalance = postWalletBalance ?? (
    side === "buy"
      ? fundingKind === "native_sol" ? 98_994_000 : 99_994_000
      : settlementKind === "native_sol" ? 100_404_000 : 99_994_000
  );
  const authoritativePreUsdcBalance = preUsdcBalance ?? (side === "buy" ? 2_000_000 : 0);
  const simulatedPostUsdcBalance = postUsdcBalance ?? (side === "buy" ? 1_000_000 : 420_000);
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(String(url));
    if (target.hostname === "ravenos.xyz") {
      assert.equal(target.pathname, "/api/dexscreener/pair");
      assert.equal(target.searchParams.get("chainId"), "solana");
      assert.equal(target.searchParams.get("pairAddress"), context.pool);
      assert.equal(target.searchParams.get("tokenAddress"), context.token);
      return response({
        ok: true,
        results: [{
          chainId: "solana",
          pairAddress: context.pool,
          tokenAddress: pairToken || context.token,
          quoteTokenAddress: context.quote,
          dexId: "fixture-dex",
          symbol: "CANARY",
          quoteSymbol: "SOL",
        }],
      });
    }
    if (target.hostname === "api.jup.ag") {
      assert.equal(init.headers["x-api-key"], "fixture-key");
      assert.equal(target.searchParams.get("inputMint"), inputMint);
      assert.equal(target.searchParams.get("outputMint"), outputMint);
      assert.equal(target.searchParams.get("amount"), "1000000");
      assert.equal(target.searchParams.get("taker"), wallet);
      assert.equal(target.searchParams.get("swapMode"), "ExactIn");
      assert.equal(target.searchParams.get("slippageBps"), "50");
      assert.equal(target.searchParams.get("priorityFeeLamports"), OperatorSolanaCanaryLimits.maximum_priority_fee_lamports);
      assert.equal(target.searchParams.get("broadcastFeeType"), "maxCap");
      assert.equal(target.searchParams.get("excludeRouters"), "jupiterz,dflow,okx");
      assert.equal(target.searchParams.get("excludeDexes"), SOLANA_UNREVIEWED_DEX_EXCLUSIONS.join(","));
      assert.equal(target.searchParams.get("referralAccount"), referralAccount);
      assert.equal(target.searchParams.get("referralFee"), hasReferral ? String(referralFeeBps) : null);
      return response({
        requestId: "canary_request_1",
        inputMint,
        outputMint,
        inAmount: "1000000",
        outAmount: "420000",
        otherAmountThreshold: "410000",
        router,
        mode: "manual",
        swapMode: "ExactIn",
        slippageBps: 50,
        gasless: false,
        taker: wallet,
        feeBps: hasReferral ? providerReferralFeeBps : 10,
        platformFee: {
          feeBps: hasReferral ? providerReferralFeeBps : 10,
          feeMint,
          amount: hasReferral ? platformFeeAmount : "0",
        },
        feeMint,
        ...(providerReferralAccount ? { referralAccount: providerReferralAccount } : {}),
        priceImpact,
        priceImpactPct: String(priceImpact / 100),
        signatureFeeLamports: signatureFee,
        signatureFeePayer: wallet,
        prioritizationFeeLamports: priorityFee,
        prioritizationFeePayer: wallet,
        rentFeeLamports: rentFee,
        rentFeePayer: wallet,
        lastValidBlockHeight: String(lastValidBlockHeight),
        routePlan: routePlan || [{
          bps: 10_000,
          swapInfo: {
            label: "Fixture",
            ammKey: bs58.encode(key(24)),
            inputMint,
            outputMint,
            inAmount: "1000000",
            outAmount: "420000",
          },
        }],
        transaction: transaction.transaction,
      });
    }
    const request = JSON.parse(init.body);
    if (request.method === "getGenesisHash") {
      return response({ jsonrpc: "2.0", id: 1, result: genesisHash });
    }
    if (request.method === "getAccountInfo") {
      return response({ jsonrpc: "2.0", id: 1, result: {
        context: { slot: 500 },
        value: {
          owner: mintProgram,
          executable: false,
          data: { parsed: { type: "mint", info: {
            decimals: 6,
            supply: "1000000000",
            mintAuthority: null,
            freezeAuthority: null,
            isInitialized: true,
            ...(mintProgram === TOKEN_2022_PROGRAM ? { extensions: mintExtensions } : {}),
          } } },
        },
      } });
    }
    if (request.method === "getBalance") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 500 }, value: walletBalance } });
    }
    if (request.method === "getBlockHeight") {
      return response({ jsonrpc: "2.0", id: 1, result: currentBlockHeight });
    }
    if (request.method === "getMultipleAccounts") {
      if (request.params[0][0] === RAVEN_JUPITER_REFERRAL.account) {
        assert.deepEqual(request.params[0], [RAVEN_JUPITER_REFERRAL.account, ravenJupiterFeeAsset(feeMint).account]);
        return response({ jsonrpc: "2.0", id: 1, result: referralFixture(feeMint) });
      }
      if (request.params[0].length === 1 && request.params[0][0] === transaction.lookupAddress) {
        assert.equal(request.params[1].minContextSlot, 500);
        return response({ jsonrpc: "2.0", id: 1, result: {
          context: { slot: 501 },
          value: [{
            owner: LOOKUP_TABLE_PROGRAM,
            executable: false,
            data: [transaction.lookupData, "base64"],
          }],
        } });
      }
      assert.deepEqual(request.params[0], [wallet, ...transaction.dynamicAddresses]);
      assert.equal(request.params[1].minContextSlot, 501);
      return response({ jsonrpc: "2.0", id: 1, result: {
        context: { slot: 502 },
        value: [
          walletAccount(authoritativePreWalletBalance),
          selectedPreAmount > 0 ? tokenAccount(context.token, wallet, selectedPreAmount, 2_039_280, mintProgram, tokenAccountExtensions) : null,
          ...(hasWrappedState
            ? [preWrappedBalance === null ? null : tokenAccount(SOLANA_WRAPPED_MINT, wallet, preWrappedBalance, preWrappedAccountLamports)]
            : []),
          ...(usesUsdc ? [tokenAccount(SOLANA_USDC_MINT, wallet, authoritativePreUsdcBalance)] : []),
          ...(hasReferral ? [tokenAccount(feeMint, referralAccount, referralPreBalance, 2_039_280 + (feeMint === SOLANA_WRAPPED_MINT ? referralPreBalance : 0))] : []),
          ...transaction.dynamicAddresses.slice(1 + Number(hasWrappedState) + Number(usesUsdc) + Number(hasReferral)).map(() => null),
        ],
      } });
    }
    if (request.method === "isBlockhashValid") {
      assert.equal(request.params[0], bs58.encode(key(7)));
      assert.equal(request.params[1].minContextSlot, 501);
      return response({ jsonrpc: "2.0", id: 1, result: {
        context: { slot: 502 },
        value: blockhashValid,
      } });
    }
    if (request.method === "simulateTransaction") {
      assert.equal(request.params[1].sigVerify, false);
      assert.equal(request.params[1].replaceRecentBlockhash, false);
      assert.equal(request.params[1].minContextSlot, 502);
      assert.deepEqual(request.params[1].accounts.addresses, [wallet, ...transaction.dynamicAddresses]);
      assert.equal(request.params[0], transaction.transaction);
      return response({ jsonrpc: "2.0", id: 1, result: {
        context: { slot: 503 },
        value: {
          err: simulationError,
          logs: [`Program ${program} invoke [1]`, `Program ${invokedProgram} invoke [2]`, `Program ${invokedProgram} success`, `Program ${program} success`],
          unitsConsumed: simulationUnits,
          fee: simulationFee,
          accounts: [
            walletAccount(simulatedWalletBalance),
            tokenAccount(context.token, wallet, selectedPostAmount, 2_039_280, mintProgram, tokenAccountExtensions),
            ...(hasWrappedState
              ? [postWrappedBalance === null ? null : tokenAccount(SOLANA_WRAPPED_MINT, wallet, postWrappedBalance, postWrappedAccountLamports)]
              : []),
            ...(usesUsdc ? [tokenAccount(SOLANA_USDC_MINT, wallet, simulatedPostUsdcBalance)] : []),
            ...(hasReferral ? [tokenAccount(feeMint, referralAccount, referralPostBalance, 2_039_280 + (feeMint === SOLANA_WRAPPED_MINT ? referralPostBalance : 0))] : []),
            ...transaction.dynamicAddresses.slice(1 + Number(hasWrappedState) + Number(usesUsdc) + Number(hasReferral)).map(() => null),
          ],
          innerInstructions: [{ index: 0, instructions: [] }],
          replacementBlockhash: null,
        },
      } });
    }
    throw new Error(`unexpected_rpc_method:${request.method}`);
  };
  return { context, fetchImpl, wallet, side, fundingKind, settlementKind };
}

function requestFor(fixture, overrides = {}) {
  return {
    terminal_url: fixture.context.url,
    wallet_address: fixture.wallet,
    wallet_role: "reference_probe",
    side: fixture.side,
    amount_base_units: "1000000",
    slippage_bps: 50,
    ...overrides,
  };
}

test("customer preflight cannot admit PumpSwap from a program label without its CPI evidence", async () => {
  const fixture = runtime({ invokedProgram: PUMP_SWAP_REVIEW.amm_program });
  await assert.rejects(runCustomerSolanaLivePreflight(requestFor(fixture, { wallet_role: "customer", funding_kind: "native_sol" }), {
    rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: fixture.fetchImpl,
  }), /pump_swap_reviewed_route_required/);
});

test("operator preflight binds exact pool and mint, resolves a v0 lookup table, and passes unsigned mainnet simulation", async () => {
  const fixture = runtime();
  const result = await runOperatorSolanaCanaryPreflight(requestFor(fixture), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: fixture.fetchImpl,
    now: () => Date.parse("2026-08-27T15:00:00Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, "unsigned_mainnet_preflight_passed");
  assert.equal(result.network.genesis_hash, SOLANA_MAINNET_GENESIS_HASH);
  assert.equal(result.exact_market.pool_address, fixture.context.pool);
  assert.equal(result.exact_pool_verification.token_address, fixture.context.token);
  assert.equal(result.selected_mint.mint, fixture.context.token);
  assert.equal(result.wallet.secret_material_accepted, false);
  assert.equal(result.quote.router, "metis");
  assert.equal(result.quote.price_impact_bps, 10);
  assert.equal(result.quote.maximum_native_debit_lamports, "1006000");
  assert.equal(result.transaction_review.fee_payer, fixture.wallet);
  assert.deepEqual(result.transaction_review.signer_addresses, [fixture.wallet]);
  assert.deepEqual(result.transaction_review.program_ids, [JUPITER_PROGRAM]);
  assert.equal(result.transaction_review.lookup_tables.length, 1);
  assert.equal(result.transaction_review.lookup_tables[0].active, true);
  assert.equal(result.transaction_review.blockhash_valid, true);
  assert.equal(result.transaction_review.raw_transaction_returned, false);
  assert.equal(result.simulation.state, "passed");
  assert.equal(result.simulation.signature_verified, false);
  assert.equal(result.simulation.units_consumed, 12_345);
  assert.equal(result.simulation.simulation_fee_lamports, "6000");
  assert.equal(result.simulation.simulated_native_debit_lamports, "1006000");
  assert.equal(result.simulation.selected_token_balance_evidence.mint, fixture.context.token);
  assert.equal(result.simulation.selected_token_balance_evidence.delta_amount_base_units, "420000");
  assert.equal(result.simulation.selected_token_balance_evidence.exact_mint_verified, true);
  assert.deepEqual(result.safety_blocking_reasons, []);
  assert.deepEqual(result.boundary_blocking_reasons, [
    "reference_wallet_not_funding_eligible",
    "signing_source_disabled",
    "operator_submission_source_disabled",
  ]);
  assert.equal(result.canary_readiness.funding_authorized, false);
  assert.equal(result.execution_boundary.signing_available, false);
  assert.equal(result.execution_boundary.operator_submission_available, false);
  assert.match(result.intent_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("fixture-key"), false);
  assert.equal(Object.hasOwn(result.transaction_review, "transaction"), false);
  assert.equal(OperatorCanaryExecutionAuthorization.signing_for_simulation, false);
  assert.equal(OperatorCanaryExecutionAuthorization.submission, false);
});

test("customer preflight returns only the exact reviewed unsigned transaction and supports native or canonical USDC", async () => {
  const native = runtime();
  const nativeResult = await runCustomerSolanaLivePreflight(requestFor(native, {
    wallet_role: "customer",
    funding_kind: "native_sol",
    settlement_kind: "native_sol",
  }), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: native.fetchImpl,
    now: () => Date.parse("2026-08-27T15:00:00Z"),
  });
  assert.equal(nativeResult.schema_version, SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA);
  assert.equal(nativeResult.state, "customer_unsigned_transaction_reviewed");
  assert.equal(nativeResult.intent.funding_kind, "native_sol");
  assert.equal(nativeResult.transaction_review.raw_transaction_returned, true);
  assert.equal(typeof nativeResult.unsigned_transaction_base64, "string");
  assert(nativeResult.unsigned_transaction_base64.length > 0);
  assert.deepEqual(nativeResult.boundary_blocking_reasons, []);
  assert.equal(nativeResult.execution_boundary.browser_signing_available, true);
  assert.equal(nativeResult.execution_boundary.operator_submission_available, false);

  const usdc = runtime({ fundingKind: "canonical_usdc" });
  const usdcResult = await runCustomerSolanaLivePreflight(requestFor(usdc, {
    wallet_role: "customer",
    funding_kind: "canonical_usdc",
    settlement_kind: "canonical_usdc",
  }), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: usdc.fetchImpl,
    now: () => Date.parse("2026-08-27T15:00:00Z"),
  });
  assert.equal(usdcResult.ok, true);
  assert.equal(usdcResult.intent.input_mint, SOLANA_USDC_MINT);
  assert.equal(usdcResult.simulation.canonical_usdc_balance_evidence.direction, "debit");
  assert.equal(usdcResult.simulation.canonical_usdc_balance_evidence.delta_amount_base_units, "1000000");
  assert.equal(usdcResult.simulation.native_balance_evidence.direction, "network_fee_only");
});

test("customer preflight binds and independently simulates the exact Jupiter referral fee", async () => {
  const referralAccount = RAVEN_JUPITER_REFERRAL.account;
  const value = runtime({
    fundingKind: "canonical_usdc",
    referralAccount,
  });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, {
    wallet_role: "customer",
    funding_kind: "canonical_usdc",
    settlement_kind: "canonical_usdc",
    referral_account: referralAccount,
    referral_fee_bps: 100,
  }), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: value.fetchImpl,
    now: () => Date.parse("2026-08-27T15:00:00Z"),
  });
  assert.equal(result.quote.referral_account, referralAccount);
  assert.equal(result.quote.referral_fee_bps, 100);
  assert.equal(result.quote.platform_fee_amount_base_units, "10000");
  assert.equal(result.simulation.referral_fee_balance_evidence.independently_simulated, true);
  assert.equal(result.simulation.referral_fee_balance_evidence.minimum_collector_credit_base_units, "8000");
  assert.equal(result.simulation.referral_fee_balance_evidence.observed_credit_base_units, "8000");

  const mismatch = runtime({
    fundingKind: "canonical_usdc",
    referralAccount,
    providerReferralFeeBps: 70,
  });
  await assert.rejects(() => runCustomerSolanaLivePreflight(requestFor(mismatch, {
    wallet_role: "customer",
    funding_kind: "canonical_usdc",
    settlement_kind: "canonical_usdc",
    referral_account: referralAccount,
    referral_fee_bps: 100,
  }), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: mismatch.fetchImpl,
  }), /jupiter_referral_fee_not_applied/);
});

test("unknown programs and failed simulations fail closed while signing material is rejected before network access", async () => {
  const unknownProgram = bs58.encode(key(12));
  const unknown = runtime({ invokedProgram: unknownProgram });
  const unknownResult = await runOperatorSolanaCanaryPreflight(requestFor(unknown), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: unknown.fetchImpl,
  });
  assert.equal(unknownResult.ok, false);
  assert(unknownResult.safety_blocking_reasons.includes("invoked_program_review_required"));

  const failed = runtime({ simulationError: { InstructionError: [0, "Custom"] } });
  const failedResult = await runOperatorSolanaCanaryPreflight(requestFor(failed), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: failed.fetchImpl,
  });
  assert.equal(failedResult.ok, false);
  assert(failedResult.safety_blocking_reasons.includes("simulation_failed"));

  let networkTouched = false;
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(runtime()), {
    rpc_url: "https://rpc.example",
    secret_key: Buffer.alloc(64),
    fetch_impl: async () => {
      networkTouched = true;
      throw new Error("unexpected");
    },
  }), /signing_material_not_accepted_by_preflight/);
  assert.equal(networkTouched, false);
});

test("mainnet, exact-pair identity, origin, amount, price impact, fee, and low-balance caps fail closed", async () => {
  const context = exactContext();
  const parsed = parseExactSolanaTerminalContext(context.url);
  assert.equal(parsed.instrument_id, `solana:pool:${context.pool}`);
  assert(SOLANA_CANARY_REVIEWED_PROGRAMS.includes(JUPITER_PROGRAM));
  assert.throws(() => parseExactSolanaTerminalContext(context.url.replace("https://ravenos.xyz", "https://evil.example")), /terminal_origin_invalid/);
  const wrongPool = context.url.replace(
    `instrument_id=${encodeURIComponent(`solana:pool:${context.pool}`)}`,
    `instrument_id=${encodeURIComponent(`solana:pool:${bs58.encode(key(13))}`)}`,
  );
  assert.throws(() => parseExactSolanaTerminalContext(wrongPool), /terminal_instrument_pool_mismatch/);

  const oversized = runtime();
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(oversized, { amount_base_units: "50000001" }), {
    rpc_url: "https://rpc.example",
    fetch_impl: oversized.fetchImpl,
  }), /canary_buy_amount_out_of_bounds/);

  const devnet = runtime({ genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1" });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(devnet), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: devnet.fetchImpl,
  }), /solana_rpc_not_mainnet/);

  const mismatchedPair = runtime({ pairToken: bs58.encode(key(30)) });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(mismatchedPair), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: mismatchedPair.fetchImpl,
  }), /ravenos_exact_pair_identity_unverified/);

  const highImpact = runtime({ priceImpact: 5.01 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(highImpact), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: highImpact.fetchImpl,
  }), /jupiter_price_impact_out_of_bounds/);

  const highPriority = runtime({ priorityFee: 50_001 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(highPriority), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: highPriority.fetchImpl,
  }), /jupiter_priority_fee_out_of_bounds/);

  const highBalance = runtime({ walletBalance: 100_000_001 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(highBalance, {
    wallet_role: "canary",
    separate_low_balance_wallet_confirmed: true,
  }), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: highBalance.fetchImpl,
  }), /canary_wallet_balance_above_low_balance_cap/);
});

test("API credentials, current blockhash, block lifetime, compute, and account-count limits fail closed", async () => {
  const fixture = runtime();
  let networkTouched = false;
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(fixture), {
    rpc_url: "https://rpc.example",
    fetch_impl: async () => {
      networkTouched = true;
      throw new Error("unexpected");
    },
  }), /jupiter_api_key_required/);
  assert.equal(networkTouched, false);

  const invalidBlockhash = runtime({ blockhashValid: false });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(invalidBlockhash), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: invalidBlockhash.fetchImpl,
  }), /transaction_blockhash_invalid/);

  const expiring = runtime({ currentBlockHeight: 1_081, lastValidBlockHeight: 1_100 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(expiring), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: expiring.fetchImpl,
  }), /jupiter_order_block_height_expiring/);

  const computeHeavy = runtime({ simulationUnits: OperatorSolanaCanaryLimits.maximum_compute_units + 1 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(computeHeavy), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: computeHeavy.fetchImpl,
  }), /simulation_compute_units_out_of_bounds/);

  const excessiveSimulationFee = runtime({ simulationFee: Number(OperatorSolanaCanaryLimits.maximum_network_fee_lamports) + 1 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(excessiveSimulationFee), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: excessiveSimulationFee.fetchImpl,
  }), /simulation_fee_out_of_bounds/);

  const tooManyWritable = runtime({ dynamicCount: OperatorSolanaCanaryLimits.maximum_resolved_writable_accounts });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(tooManyWritable), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: tooManyWritable.fetchImpl,
  }), /writable_account_count_out_of_bounds/);
});

test("simulation must prove exact selected-mint deltas and bounded native settlement for buys and sells", async () => {
  const weakBuy = runtime({ postTokenBalance: 409_999 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(weakBuy), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: weakBuy.fetchImpl,
  }), /simulation_selected_token_credit_below_minimum/);

  const excessNativeDebit = runtime({ postWalletBalance: 98_993_999 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(excessNativeDebit), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: excessNativeDebit.fetchImpl,
  }), /simulated_native_debit_out_of_bounds/);

  const sell = runtime({ side: "sell" });
  const sellResult = await runOperatorSolanaCanaryPreflight(requestFor(sell), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: sell.fetchImpl,
  });
  assert.equal(sellResult.ok, true);
  assert.equal(sellResult.simulation.selected_token_balance_evidence.direction, "debit");
  assert.equal(sellResult.simulation.selected_token_balance_evidence.delta_amount_base_units, "1000000");
  assert.equal(sellResult.simulation.native_balance_evidence.credit_lamports, "404000");

  const wrongSellDebit = runtime({ side: "sell", postTokenBalance: 1 });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(wrongSellDebit), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: wrongSellDebit.fetchImpl,
  }), /simulation_selected_token_debit_mismatch/);

  const wrappedClosure = runtime({
    preWrappedBalance: 1_000_000,
    postWrappedBalance: null,
    postWalletBalance: 101_994_000,
  });
  const wrappedClosureResult = await runOperatorSolanaCanaryPreflight(requestFor(wrappedClosure), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: wrappedClosure.fetchImpl,
  });
  assert.equal(wrappedClosureResult.ok, true);
  assert.equal(wrappedClosureResult.simulation.native_balance_evidence.system_wallet_credit_lamports, "1994000");
  assert.equal(wrappedClosureResult.simulation.native_balance_evidence.economic_debit_lamports, "1006000");

  const changedBalance = runtime({ preWalletBalance: 99_000_000, postWalletBalance: 97_994_000 });
  const changedBalanceResult = await runOperatorSolanaCanaryPreflight(requestFor(changedBalance), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: changedBalance.fetchImpl,
  });
  assert.equal(changedBalanceResult.ok, true);
  assert.equal(changedBalanceResult.wallet.initial_balance_lamports, "100000000");
  assert.equal(changedBalanceResult.wallet.balance_lamports, "99000000");
  assert.equal(changedBalanceResult.wallet.balance_changed_during_preflight, true);
});

test("multi-leg routes stay bounded and every admitted leg connects exact input to exact output", async () => {
  const context = exactContext();
  const intermediates = Array.from({ length: 8 }, (_, index) => bs58.encode(key(60 + index)));
  const nineLegs = [SOLANA_WRAPPED_MINT, ...intermediates, context.token]
    .slice(0, -1)
    .map((mint, index, path) => routeLeg(mint, [SOLANA_WRAPPED_MINT, ...intermediates, context.token][index + 1], 80 + index));
  const tooMany = runtime({ routePlan: nineLegs });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(tooMany), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: tooMany.fetchImpl,
  }), /jupiter_route_plan_invalid/);

  const unrelatedMint = bs58.encode(key(91));
  const disconnected = runtime({ routePlan: [
    routeLeg(SOLANA_WRAPPED_MINT, context.token, 92),
    routeLeg(unrelatedMint, context.token, 93),
  ] });
  await assert.rejects(() => runOperatorSolanaCanaryPreflight(requestFor(disconnected), {
    rpc_url: "https://rpc.example",
    jupiter_api_key: "fixture-key",
    fetch_impl: disconnected.fetchImpl,
  }), /jupiter_route_mint_continuity_invalid/);
});

test("source limits match the reviewed security contract caps", async () => {
  const security = JSON.parse(await readFile("config/customer_security.json", "utf8"));
  assert.equal(Number(OperatorSolanaCanaryLimits.maximum_buy_lamports), security.operator_solana_canary.maximum_buy_lamports);
  assert.equal(Number(OperatorSolanaCanaryLimits.maximum_canary_wallet_lamports), security.operator_solana_canary.maximum_canary_wallet_lamports);
  assert.equal(Number(OperatorSolanaCanaryLimits.maximum_priority_fee_lamports), security.operator_solana_canary.maximum_priority_fee_lamports);
  assert.equal(Number(OperatorSolanaCanaryLimits.maximum_total_fee_lamports), security.operator_solana_canary.maximum_total_fee_lamports);
  assert.equal(Number(OperatorSolanaCanaryLimits.maximum_total_native_debit_lamports), security.operator_solana_canary.maximum_total_native_debit_lamports);
  assert.equal(OperatorSolanaCanaryLimits.maximum_route_legs, security.operator_solana_canary.maximum_route_legs);
});

for (const tier of ["Standard", "Pro"]) test(`${tier} referral preflight keeps 100 bps and exact USDC account`, async () => {
  const feeBps = 100;
  const value = runtime({ fundingKind: "canonical_usdc", referralAccount: RAVEN_JUPITER_REFERRAL.account, referralFeeBps: feeBps });
  const request = requestFor(value, { wallet_role: "customer", funding_kind: "canonical_usdc", settlement_kind: "canonical_usdc", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: feeBps });
  const options = { rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl };
  const result = await runCustomerSolanaLivePreflight(request, options);
  assert.equal(result.quote.fee_bps, feeBps);
  assert.equal(result.simulation.referral_fee_balance_evidence.fee_account, RAVEN_JUPITER_REFERRAL.usdc_fee_account);
  assert.equal(result.transaction_review.unsigned_transaction, true);
  let providerCalls = 0;
  await assert.rejects(() => runCustomerSolanaLivePreflight(request, { ...options, fetch_impl: async (url, init) => {
    if (String(url).includes("api.jup.ag")) providerCalls++;
    const rpc = init?.body ? JSON.parse(init.body) : null;
    if (rpc?.method === "getMultipleAccounts" && rpc.params[0][0] === RAVEN_JUPITER_REFERRAL.account) {
      const missing = referralFixture(); missing.value[1] = null;
      return response({ jsonrpc: "2.0", id: 1, result: missing });
    }
    return value.fetchImpl(url, init);
  } }), /jupiter_usdc_fee_account_missing/);
  assert.equal(providerCalls, 0, "missing fee account blocks before requesting a swap");
});

test("retired native Pro 70 bps requests fail before any provider call",async()=>{const value=runtime({fundingKind:"canonical_usdc",referralAccount:RAVEN_JUPITER_REFERRAL.account,referralFeeBps:70});let calls=0;await assert.rejects(runCustomerSolanaLivePreflight(requestFor(value,{wallet_role:"customer",funding_kind:"canonical_usdc",settlement_kind:"canonical_usdc",referral_account:RAVEN_JUPITER_REFERRAL.account,referral_fee_bps:70}),{rpc_url:"https://rpc.example",jupiter_api_key:"fixture-key",fetch_impl:async()=>{calls++;throw new Error("unexpected_provider_call");}}),/fee/);assert.equal(calls,0);});

for (const tier of ["Standard", "Paid Pro", "Trial Pro"]) test(`${tier} accepts current Jupiter v2 response without platformFee.amount`, async () => {
  const value = runtime({ fundingKind: "canonical_usdc", referralAccount: RAVEN_JUPITER_REFERRAL.account, platformFeeAmount: undefined });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, { wallet_role: "customer", funding_kind: "canonical_usdc", settlement_kind: "canonical_usdc", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), {
    rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: async (url, init) => {
      const reply = await value.fetchImpl(url, init);
      if (!String(url).includes("api.jup.ag")) return reply;
      const body = await reply.json(); delete body.platformFee.amount; return response(body);
    },
  });
  assert.equal(result.quote.platform_fee_amount_base_units, "10000");
  assert.equal(result.quote.platform_fee_amount_source, "exact_input_fee_calculation");
  assert.equal(result.transaction_review.fee_instruction_evidence.fee_bps, 100);
});

test("output USDC fee absent from provider quote requires exact independent simulated receipt", async () => {
  const value = runtime({ side: "sell", settlementKind: "canonical_usdc", referralAccount: RAVEN_JUPITER_REFERRAL.account, platformFeeAmount: null, referralPostBalance: 4242 });
  const input = requestFor(value, { side: "sell", wallet_role: "customer", funding_kind: "canonical_usdc", settlement_kind: "canonical_usdc", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 });
  const result = await runCustomerSolanaLivePreflight(input, {rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl});
  assert.equal(result.quote.platform_fee_amount_base_units, "4242");
  assert.equal(result.quote.platform_fee_amount_source, "independent_simulation");
  assert.equal(result.simulation.referral_fee_balance_evidence.observed_credit_base_units, "4242");
});

test("Terminal buy selected_token settlement reaches a fee-verified unsigned transaction", async () => {
  const value = runtime({ fundingKind: "canonical_usdc", referralAccount: RAVEN_JUPITER_REFERRAL.account });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, { wallet_role: "customer", funding_kind: "canonical_usdc", settlement_kind: "selected_token", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), {
    rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.intent.settlement_kind, "selected_token");
  assert.equal(result.transaction_review.fee_instruction_evidence.fee_bps, 100);
});

test("Terminal percentage sell uses selected-token funding and canonical USDC settlement", async () => {
  const value = runtime({ side: "sell", settlementKind: "canonical_usdc", referralAccount: RAVEN_JUPITER_REFERRAL.account, platformFeeAmount: null, referralPostBalance: 4242 });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, { side: "sell", wallet_role: "customer", funding_kind: "sell_percentage", settlement_kind: "canonical_usdc", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), {
    rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.intent.funding_kind, "selected_token");
  assert.equal(result.quote.fee_mint, SOLANA_USDC_MINT);
});

for (const tier of ["Standard", "Paid Pro", "Trial Pro"]) test(`${tier} SOL-funded buy has an exact 100 bps SOL referral instruction and simulated collection`, async () => {
  const value = runtime({ referralAccount: RAVEN_JUPITER_REFERRAL.account });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, { wallet_role: "customer", funding_kind: "native_sol", settlement_kind: "selected_token", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), { rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.quote.fee_mint, SOLANA_WRAPPED_MINT);
  assert.equal(result.transaction_review.fee_instruction_evidence.fee_bps, 100);
  assert.equal(result.transaction_review.fee_instruction_evidence.fee_account, RAVEN_JUPITER_REFERRAL.sol_fee_account);
  assert.equal(result.simulation.referral_fee_balance_evidence.observed_credit_base_units, "8000");
});

test("native SOL sell fee is reconstructed from net capital with rent and network cost separated", async () => {
  const value = runtime({ side: "sell", settlementKind: "native_sol", referralAccount: RAVEN_JUPITER_REFERRAL.account, platformFeeAmount: null, referralPostBalance: 4242, postWalletBalance: 100_414_000 });
  const result = await runCustomerSolanaLivePreflight(requestFor(value, { side: "sell", wallet_role: "customer", funding_kind: "sell_percentage", settlement_kind: "native_sol", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), { rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.quote.fee_mint, SOLANA_WRAPPED_MINT);
  assert.equal(result.quote.platform_fee_amount_base_units, "4242");
});

async function token2022Preflight(options = {}) {
  const side = options.side || "buy";
  const value = runtime({ mintProgram: TOKEN_2022_PROGRAM, fundingKind: "canonical_usdc", settlementKind: "canonical_usdc",
    referralAccount: RAVEN_JUPITER_REFERRAL.account, invokedProgram: TOKEN_2022_PROGRAM,
    ...(side === "sell" ? { platformFeeAmount: null, referralPostBalance: 4242 } : {}), ...options });
  return runCustomerSolanaLivePreflight(requestFor(value, { wallet_role: "customer", funding_kind: side === "sell" ? "sell_percentage" : "canonical_usdc",
    settlement_kind: side === "sell" ? "canonical_usdc" : "selected_token", referral_account: RAVEN_JUPITER_REFERRAL.account, referral_fee_bps: 100 }), {
    rpc_url: "https://rpc.example", jupiter_api_key: "fixture-key", fetch_impl: value.fetchImpl,
  });
}

for (const side of ["buy", "sell"]) test(`Token-2022 metadata-only ${side} verifies mint program, token movement and 100 bps collection`, async () => {
  const result = await token2022Preflight({ side });
  assert.equal(result.ok, true);
  assert.equal(result.selected_mint.token_2022_extensions_reviewed, true);
  assert.deepEqual(result.selected_mint.reviewed_extension_types, ["metadataPointer", "tokenMetadata"]);
  assert.equal(result.intent.selected_token_program, TOKEN_2022_PROGRAM);
  const fee = result.transaction_review.fee_instruction_evidence;
  assert.equal(fee[side === "buy" ? "destination_token_program" : "source_token_program"], TOKEN_2022_PROGRAM);
  assert.equal(fee[side === "buy" ? "source_token_program" : "destination_token_program"], TOKEN_PROGRAM);
  assert.equal(fee.fee_bps, 100);
  assert.equal(result.simulation.referral_fee_balance_evidence.fee_account, RAVEN_JUPITER_REFERRAL.usdc_fee_account);
});

test("Token-2022 base token account without extensions also preserves exact receipt proof", async () => {
  assert.equal((await token2022Preflight({ tokenAccountExtensions: Buffer.alloc(0) })).ok, true);
});

for (const extension of ["transferFeeConfig", "transferHook", "permanentDelegate", "nonTransferable", "confidentialTransferMint", "unknownExtension"]) {
  test(`Token-2022 ${extension} is not treated as an ordinary transferable token`, async () => {
    await assert.rejects(token2022Preflight({ mintExtensions: [{ extension }] }), /selected_mint_token_2022_extensions_not_supported/);
  });
}

test("missing Token-2022 extension evidence cannot silently qualify", async () => {
  await assert.rejects(token2022Preflight({ mintExtensions: null }), /selected_mint_token_2022_extensions_not_supported/);
});

for (const extensions of [Buffer.from([1, 7, 0, 0, 0]), Buffer.from([2, 7]), Buffer.from([2, 7, 0, 1, 0]),
  Buffer.from([2, 8, 0, 0, 0]), Buffer.from([2, 7, 0, 0, 0, 7, 0, 0, 0])]) {
  test(`malformed or unreviewed Token-2022 account tail ${extensions.toString("hex")} fails closed`, async () => {
    await assert.rejects(token2022Preflight({ tokenAccountExtensions: extensions }), /wallet_token_2022_/);
  });
}

test("Jupiter cannot substitute the selected mint's verified token program", async () => {
  await assert.rejects(token2022Preflight({ routeTokenProgram: TOKEN_PROGRAM }), /jupiter_fee_instruction_token_program_mismatch/);
});

test("Token-2022 program admission does not extend to an unrelated SPL mint", async () => {
  const result = await token2022Preflight({ mintProgram: TOKEN_PROGRAM });
  assert.equal(result.ok, false);
  assert.ok(result.safety_blocking_reasons.includes("invoked_program_review_required"));
});
