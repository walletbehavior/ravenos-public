import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  SOLANA_WALLET_EVENT_SCHEMA,
  buildSolanaWalletProfile,
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 7));
const TOKEN = bs58.encode(Buffer.alloc(32, 9));
const TOKEN_2022 = bs58.encode(Buffer.alloc(32, 11));
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

function balance(owner, mint, amount, decimals) {
  return { owner, mint, uiTokenAmount: { amount: String(amount), decimals } };
}

function transaction({
  slot = 100,
  blockTime = 1_777_000_000,
  pre = [],
  post = [],
  preLamports = 1_000_000_000,
  postLamports = 999_995_000,
  fee = 5_000,
  logs = ["Program log: Instruction: Route"],
  programId = JUPITER,
  err = null,
  program = null,
} = {}) {
  return {
    slot,
    blockTime,
    transaction: {
      message: {
        accountKeys: [{ pubkey: WALLET, signer: true }],
        instructions: program
          ? [{ program, programId, parsed: { type: "transferChecked" } }]
          : [{ programId }],
      },
    },
    meta: {
      err,
      fee,
      preBalances: [preLamports],
      postBalances: [postLamports],
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: [],
      logMessages: logs,
    },
  };
}

function normalize(tx, suffix = "a", overrides = {}) {
  const observed = new Date((tx.blockTime * 1_000) + 2_000).toISOString();
  return normalizeSolanaWalletTransaction({
    wallet_address: WALLET,
    signature: suffix.repeat(88).slice(0, 88),
    transaction: tx,
    finality: "confirmed",
    provider: "fixture_rpc",
    observation_mode: "prospective",
    received_at: observed,
    decode_started_at: observed,
    decoded_at: observed,
    observed_at: observed,
    ...overrides,
  });
}

test("Solana wallet addresses require an exact 32-byte base58 public key", () => {
  assert.equal(normalizeSolanaWalletAddress(WALLET), WALLET);
  assert.throws(() => normalizeSolanaWalletAddress("not-a-wallet"), /wallet_address_invalid/);
});

test("a Jupiter canonical-USDC buy becomes one exact, prospective copy signal", () => {
  const event = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
  }));
  assert.equal(event.schema_version, SOLANA_WALLET_EVENT_SCHEMA);
  assert.equal(event.classification.kind, "SWAP_BUY");
  assert.equal(event.copy_signal.eligible_buy_signal, true);
  assert.equal(event.economic.source_asset.mint, SOLANA_CANONICAL_USDC_MINT);
  assert.equal(event.economic.destination_asset.mint, TOKEN);
  assert.equal(event.economic.destination_asset.standard, "spl_or_token_2022_unresolved");
  assert.equal(event.timing.detection_delay_ms, 2_000);
  assert.equal(event.execution_boundary, undefined);
  assert.equal(event.privacy.subscriber_identity_included, false);
});

test("opposing transfers without swap-route evidence remain ambiguous", () => {
  const event = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 10_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 5_000_000, 6), balance(WALLET, TOKEN, 1_000_000, 6)],
    logs: ["Program log: Instruction: TransferChecked"],
    programId: "11111111111111111111111111111111",
  }), "b");
  assert.equal(event.classification.kind, "AMBIGUOUS");
  assert.equal(event.copy_signal.eligible_buy_signal, false);
  assert.deepEqual(event.classification.reasons, ["opposing_balance_changes_without_swap_route_evidence"]);
});

test("an exact PumpSwap program invocation qualifies opposing economic deltas as a swap", () => {
  const event = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 10_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 5_000_000, 6), balance(WALLET, TOKEN, 1_000_000, 6)],
    logs: [],
    programId: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  }), "p");
  assert.equal(event.route_evidence.swap_route_observed, true);
  assert.equal(event.classification.kind, "SWAP_BUY");
  assert.equal(event.copy_signal.eligible_buy_signal, true);
});

test("transfers, airdrops, failed transactions, split routes, and Token-2022 stay distinct", () => {
  const transfer = normalize(transaction({
    pre: [balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, TOKEN, 1_000_000, 6)],
    logs: ["Program log: Instruction: TransferChecked"],
    programId: "11111111111111111111111111111111",
  }), "c");
  const airdrop = normalize(transaction({
    pre: [balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, TOKEN, 1_000_000, 6)],
    logs: ["Program log: Airdrop distribution"],
    programId: "11111111111111111111111111111111",
  }), "d");
  const failed = normalize(transaction({ err: { InstructionError: [1, "Custom"] } }), "e");
  const split = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 20_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 10_000_000, 6), balance(WALLET, TOKEN, 2_000_000, 6)],
    logs: ["Program log: Instruction: Swap", "Program log: Instruction: Swap"],
  }), "f");
  const token2022 = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 20_000_000, 6), balance(WALLET, TOKEN_2022, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 10_000_000, 6), balance(WALLET, TOKEN_2022, 2_000_000, 6)],
    logs: ["Program log: Instruction: Route"],
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  }), "g");
  assert.equal(transfer.classification.kind, "TRANSFER_IN");
  assert.equal(airdrop.classification.kind, "AIRDROP");
  assert.equal(failed.classification.kind, "FAILED_TRANSACTION");
  assert.equal(split.classification.kind, "SPLIT_ROUTE_SWAP");
  assert.equal(token2022.economic.destination_asset.standard, "spl_token_2022");
});

test("FIFO source performance excludes unknown cost basis and never promotes marks to liquidation", () => {
  const buy = normalize(transaction({
    slot: 101,
    blockTime: 1_777_000_000,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
  }), "h", { observation_mode: "historical_backfill" });
  const sell = normalize(transaction({
    slot: 102,
    blockTime: 1_777_000_100,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 105_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
  }), "i", { observation_mode: "historical_backfill" });
  const unknown = normalize(transaction({
    slot: 103,
    blockTime: 1_777_000_200,
    pre: [balance(WALLET, TOKEN_2022, 0, 6)],
    post: [balance(WALLET, TOKEN_2022, 5_000_000, 6)],
    logs: ["Program log: Instruction: TransferChecked"],
    programId: "11111111111111111111111111111111",
  }), "j", { observation_mode: "historical_backfill" });
  const profile = buildSolanaWalletProfile([unknown, sell, buy], { generated_at: "2026-08-29T12:00:00.000Z" });
  assert.equal(profile.source_performance.realized_pnl_usdc, 5);
  assert.equal(profile.source_performance.roi_pct, 20);
  assert.equal(profile.source_performance.closed_lots, 1);
  assert.equal(profile.source_performance.unrealized_pnl_usdc, null);
  assert.equal(profile.source_performance.executable_liquidation_value_usdc, null);
  assert.equal(profile.evidence.unknown_cost_basis_is_zero, false);
  assert.equal(profile.evidence.transfers_treated_as_trades, false);
  assert.equal(profile.evidence.airdrops_treated_as_profit, false);
});

test("FIFO accounting keeps native-SOL returns useful without inventing historical USD conversion", () => {
  const buy = normalize(transaction({
    slot: 201,
    blockTime: 1_777_001_000,
    preLamports: 10_000_000_000,
    postLamports: 8_999_995_000,
    pre: [balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, TOKEN, 10_000_000, 6)],
  }), "k", { observation_mode: "historical_backfill" });
  const sell = normalize(transaction({
    slot: 202,
    blockTime: 1_777_001_100,
    preLamports: 8_999_995_000,
    postLamports: 10_199_990_000,
    pre: [balance(WALLET, TOKEN, 10_000_000, 6)],
    post: [balance(WALLET, TOKEN, 0, 6)],
  }), "l", { observation_mode: "historical_backfill" });
  const profile = buildSolanaWalletProfile([sell, buy], { generated_at: "2026-08-29T12:00:00.000Z" });
  assert.equal(buy.economic.cost_basis_state, "known_native_sol");
  assert.equal(profile.profile_version, 2);
  assert.equal(profile.coverage.known_cost_basis_pct, 100);
  assert.equal(profile.coverage.known_sol_cost_basis_pct, 100);
  assert.equal(profile.source_performance.realized_pnl_sol, 0.2);
  assert.equal(profile.source_performance.realized_pnl_usdc, null);
  assert.equal(profile.source_performance.roi_pct, 20);
  assert.equal(profile.source_performance.roi_pct_by_basis.sol, 20);
  assert.equal(profile.evidence.cross_basis_conversion_performed, false);
  assert.match(profile.source_performance.limitations.join(" "), /not converted/i);
});

test("negative native-SOL performance remains a loss rather than an unavailable or unsigned value", () => {
  const buy = normalize(transaction({
    slot: 301,
    blockTime: 1_777_002_000,
    preLamports: 10_000_000_000,
    postLamports: 8_999_995_000,
    pre: [balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, TOKEN, 10_000_000, 6)],
  }), "m", { observation_mode: "historical_backfill" });
  const sell = normalize(transaction({
    slot: 302,
    blockTime: 1_777_002_100,
    preLamports: 8_999_995_000,
    postLamports: 9_799_990_000,
    pre: [balance(WALLET, TOKEN, 10_000_000, 6)],
    post: [balance(WALLET, TOKEN, 0, 6)],
  }), "n", { observation_mode: "historical_backfill" });
  const profile = buildSolanaWalletProfile([sell, buy], { generated_at: "2026-08-29T12:00:00.000Z" });
  assert.equal(profile.source_performance.realized_pnl_sol, -0.2);
  assert.equal(profile.source_performance.roi_pct, -20);
  assert.equal(profile.source_performance.win_rate_pct, 0);
});
