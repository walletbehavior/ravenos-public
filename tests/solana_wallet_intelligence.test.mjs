import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";
import { persistSourceWalletProfile } from '../lib/customer_wallet_copy.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';

import {
  SOLANA_CANONICAL_USDC_MINT,
  SOLANA_WALLET_EVENT_SCHEMA,
  buildSolanaWalletProfile,
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
  solanaAnalyticalTradeKind,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  SOLANA_PROGRAM_IDS,
  SOLANA_REVIEWED_SWAP_PROGRAM_IDS,
  identifySolanaSwapPrograms,
  isReviewedSolanaSwapProgram,
} from "../lib/customer_trade/solana_program_registry.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 7));
const TOKEN = bs58.encode(Buffer.alloc(32, 9));
const TOKEN_2022 = bs58.encode(Buffer.alloc(32, 11));
const TOKEN_TWO = bs58.encode(Buffer.alloc(32, 13));
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

function retainedEvent(template, index, at = 1777000000) {
  const bytes = Buffer.alloc(64, 7); bytes.writeUInt32BE(index, 60);
  return { ...template, event_id: 'swe_' + index.toString(16).padStart(40, '0'),
    chain_evidence: { ...template.chain_evidence, signature: bs58.encode(bytes), slot: 100 + index,
      block_time: new Date((at + index) * 1000).toISOString() } };
}

test('deep retained analysis restores older entry basis without another history read', async () => {
  const at = 1777000000;
  const buy = normalize(transaction({ blockTime: at,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100000000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 69999999, 6), balance(WALLET, TOKEN, 3000000, 6)] }), 'A');
  const sell = normalize(transaction({ blockTime: at + 3001,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 69999999, 6), balance(WALLET, TOKEN, 3000000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 84999999, 6), balance(WALLET, TOKEN, 2000000, 6)] }), 'B');
  const idle = normalize(transaction({ logs: [], programId: '11111111111111111111111111111111' }), 'C');
  const events = [buy, ...Array.from({length:3000},(_,i)=>retainedEvent(idle,i+1)), sell].reverse();
  const sourceId = normalizeSourceWalletChainIdentity({chain:'solana',network:'mainnet',address:WALLET}).source_wallet_id;
  let saved = null;
  const store = { listSourceEvents: () => { throw Error('duplicate retained history read'); },
    latestProfile: async () => null, recordProfile: async (id, profile) => { assert.equal(id,sourceId); saved=profile; } };
  const profile = await persistSourceWalletProfile(store,sourceId,at+3002,{transactions_decoded:3002},null,null,events);
  assert.equal(profile,saved);
  assert.equal(profile.coverage.normalized_events,3002);
  assert.equal(profile.coverage.first_observed_at,new Date(at*1000).toISOString());
  assert.equal(profile.data_quality.analysis_event_limit,10000);
  assert.equal(profile.data_quality.analysis_truncated,false);
  assert.equal(profile.source_performance.closed_lots,1);
  assert.equal(profile.trading_record.tokens[0].by_basis.usdc.matched_cost,'10.000000');
  assert.equal(profile.trading_record.tokens[0].by_basis.usdc.realized_pnl,'5.000000');
  await assert.rejects(persistSourceWalletProfile(store,
    normalizeSourceWalletChainIdentity({chain:'solana',network:'mainnet',address:bs58.encode(Buffer.alloc(32,8))}).source_wallet_id,
    at+3002,null,null,null,events), /wallet_profile_chain_mixed/);
});

test('analysis retains the newest 10,000 events and exposes truncation without a complete-history claim', () => {
  const idle = normalize(transaction({ logs: [], programId: '11111111111111111111111111111111' }), 'D');
  const events = Array.from({length:10005},(_,i)=>retainedEvent(idle,i));
  const profile = buildSolanaWalletProfile(events,{history:{source_history_verified_complete:true,history_exhausted:true}});
  assert.equal(profile.coverage.normalized_events,10000);
  assert.equal(profile.data_quality.analysis_events,10000);
  assert.equal(profile.data_quality.analysis_event_limit,10000);
  assert.equal(profile.data_quality.analysis_truncated,true);
  assert.equal(profile.coverage.source_history_complete,false);
  assert.equal(profile.coverage.first_observed_at,events[5].chain_evidence.block_time);
  assert.equal(profile.coverage.last_observed_at,events.at(-1).chain_evidence.block_time);
  assert.equal(events[0].chain_evidence.slot,100,'does not reorder the caller archive');
  assert.throws(()=>buildSolanaWalletProfile([{...events[0],source_wallet:{...events[0].source_wallet,address:TOKEN}},...events.slice(1)]),/owner_mismatch/);
});

test('10,000 events across 5,000 tokens retain exact totals with bounded profile output', t => {
  const buy = normalize(transaction({ pre:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,100000000,6)],
    post:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,69999999,6),balance(WALLET,TOKEN,3000000,6)] }),'E');
  const sell = normalize(transaction({ pre:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,69999999,6),balance(WALLET,TOKEN,3000000,6)],
    post:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,114999999,6),balance(WALLET,TOKEN,0,6)] }),'F');
  const events = Array.from({length:5000},(_,i)=>{
    const bytes=Buffer.alloc(32,9);bytes.writeUInt32BE(i,28);const mint=bs58.encode(bytes);
    return [retainedEvent({...buy,economic:{...buy.economic,destination_asset:{...buy.economic.destination_asset,mint}}},i*2),
      retainedEvent({...sell,economic:{...sell.economic,source_asset:{...sell.economic.source_asset,mint}}},i*2+1)];
  }).flat();
  const start=performance.now();
  const profile=buildSolanaWalletProfile(events,{generated_at:new Date(1777020000000).toISOString()});
  const bytes=Buffer.byteLength(JSON.stringify(profile));
  assert.equal(profile.coverage.normalized_events,10000);
  assert.equal(profile.source_performance.closed_lots,5000);
  assert.equal(profile.source_performance.realized_pnl_usdc,74999.995);
  assert.equal(profile.trading_record.token_count,5000);
  assert.equal(profile.trading_record.tokens.length,100);
  assert.equal(profile.trading_record.tokens_truncated,true);
  assert(bytes<1048576,'retained profile must fit the existing storage bound');
  t.diagnostic(JSON.stringify({analyzed_events:10000,tokens:5000,elapsed_ms:Math.round(performance.now()-start),profile_bytes:bytes}));
});

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
  assert.equal(event.copy_signal.eligible_sell_signal, false);
  assert.equal(event.economic.source_asset.mint, SOLANA_CANONICAL_USDC_MINT);
  assert.equal(event.economic.destination_asset.mint, TOKEN);
  assert.equal(event.economic.destination_asset.balance_before_base_units, "0");
  assert.equal(event.economic.destination_asset.balance_after_base_units, "10000000");
  assert.equal(event.economic.destination_asset.standard, "spl_or_token_2022_unresolved");
  assert.equal(event.timing.detection_delay_ms, 2_000);
  assert.equal(event.wallet_state.canonical_usdc_balance_base_units, "75000000");
  assert.equal(event.wallet_state.current_balance_claimed, false);
  assert.equal(event.execution_boundary, undefined);
  assert.equal(event.privacy.subscriber_identity_included, false);
});

test("an exact token sale preserves the source-wallet fraction needed for mapped exits", () => {
  const event = normalize(transaction({
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 87_000_000, 6), balance(WALLET, TOKEN, 6_000_000, 6)],
  }), "z");
  assert.equal(event.classification.kind, "SWAP_SELL");
  assert.equal(event.copy_signal.eligible_buy_signal, false);
  assert.equal(event.copy_signal.eligible_sell_signal, true);
  assert.equal(event.copy_signal.exact_source_asset.mint, TOKEN);
  assert.equal(event.copy_signal.exact_source_asset.amount_base_units, "4000000");
  assert.equal(event.copy_signal.exact_source_asset.balance_before_base_units, "10000000");
  assert.equal(event.copy_signal.exact_source_asset.balance_after_base_units, "6000000");
  assert.equal(event.copy_signal.reason, "observed_source_wallet_sell");
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

test("one reviewed mainnet registry drives wallet swap identity without accepting old mistyped variants", () => {
  const reviewed = [
    SOLANA_PROGRAM_IDS.raydium_amm_v4,
    SOLANA_PROGRAM_IDS.raydium_cpmm,
    SOLANA_PROGRAM_IDS.raydium_clmm,
    SOLANA_PROGRAM_IDS.orca_whirlpool,
    SOLANA_PROGRAM_IDS.meteora_dlmm,
    SOLANA_PROGRAM_IDS.pump_bonding_curve,
    SOLANA_PROGRAM_IDS.pump_amm,
  ];
  assert.equal(new Set(SOLANA_REVIEWED_SWAP_PROGRAM_IDS).size, SOLANA_REVIEWED_SWAP_PROGRAM_IDS.length);
  for (const [index, programId] of reviewed.entries()) {
    assert.equal(isReviewedSolanaSwapProgram(programId), true);
    const event = normalize(transaction({
      pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 10_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
      post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 5_000_000, 6), balance(WALLET, TOKEN, 1_000_000, 6)],
      logs: [],
      programId,
    }), String.fromCharCode(65 + index));
    assert.equal(event.route_evidence.swap_route_observed, true, programId);
    assert.equal(event.classification.kind, "SWAP_BUY", programId);
  }
  const suspectVariants = [
    "675kPX9MHTjS2zt1qfr1NYHuzeKDq1Z4mYqPJ1L5S9LC",
    "CPMMoo8L3F4NbTegBCKVNnYhW3T6HhK7V9rD7NmQ1Fj",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUQpB4c4jUxQ3YMpiZ",
    "whirLbMiicVdio4qvUfM5KAg6CtR9bV11MZWdN5L8z1",
  ];
  assert.deepEqual(identifySolanaSwapPrograms([...reviewed, reviewed[0]]).map((row) => row.program_id).sort(), [...reviewed].sort());
  for (const programId of suspectVariants) assert.equal(isReviewedSolanaSwapProgram(programId), false, programId);
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
    blockTime: 1_777_086_500,
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
  assert.equal(profile.behavior.first_trade_at, new Date(1_777_000_000_000).toISOString());
  assert.equal(profile.behavior.last_trade_at, new Date(1_777_000_100_000).toISOString());
  assert.equal(profile.behavior.tokens_traded, 1);
  assert.equal(profile.behavior.trade_rate_per_active_day, 2);
  assert.equal(profile.behavior.median_hold_seconds, 100);
  assert.equal(profile.behavior.average_hold_seconds, 100);
  assert.equal(profile.behavior.active_days, 1);
  assert.equal(profile.behavior.observed_token_exit_coverage_pct, 100);
  assert.equal(profile.behavior.observed_trade_completion_scope, "bought_token_with_any_observed_sell");
  assert.equal(profile.exit_behavior.partial_exit_token_pct, null);
  assert.equal(profile.exit_behavior.fully_exited_token_pct, null);
  assert.equal(profile.exit_behavior.known_cost_fully_exited_token_pct, 100);
  assert.equal(profile.coverage.known_cost_basis_pct, 50);
  assert.equal(profile.coverage.cost_basis_observations, 2);
  assert.equal(profile.coverage.known_cost_basis_observations, 1);
  assert.equal(profile.coverage.unresolved_cost_basis_observations, 1);
  assert.deepEqual(profile.behavior.buy_notional_by_basis.usdc, {
    count: 1,
    total: 25,
    average: 25,
    median: 25,
  });
  assert.deepEqual(profile.behavior.buy_notional_by_basis.sol, {
    count: 0,
    total: null,
    average: null,
    median: null,
  });
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
  assert.equal(profile.profile_version, 9);
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

test("profile v5 separates USDC and SOL buy notionals and counts exact traded assets", () => {
  const usdcBuy10 = normalize(transaction({
    slot: 401,
    blockTime: 1_777_100_000,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100_000_000, 6), balance(WALLET, TOKEN, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 90_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
  }), "o", { observation_mode: "historical_backfill" });
  const usdcBuy30 = normalize(transaction({
    slot: 402,
    blockTime: 1_777_100_100,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 90_000_000, 6), balance(WALLET, TOKEN, 10_000_000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 60_000_000, 6), balance(WALLET, TOKEN, 20_000_000, 6)],
  }), "q", { observation_mode: "historical_backfill" });
  const solBuy1 = normalize(transaction({
    slot: 403,
    blockTime: 1_777_186_400,
    preLamports: 10_000_000_000,
    postLamports: 8_999_995_000,
    pre: [balance(WALLET, TOKEN_TWO, 0, 6)],
    post: [balance(WALLET, TOKEN_TWO, 10_000_000, 6)],
  }), "r", { observation_mode: "historical_backfill" });
  const solBuy3 = normalize(transaction({
    slot: 404,
    blockTime: 1_777_186_500,
    preLamports: 10_000_000_000,
    postLamports: 6_999_995_000,
    pre: [balance(WALLET, TOKEN_TWO, 10_000_000, 6)],
    post: [balance(WALLET, TOKEN_TWO, 20_000_000, 6)],
  }), "s", { observation_mode: "historical_backfill" });

  const profile = buildSolanaWalletProfile(
    [solBuy3, usdcBuy10, solBuy1, usdcBuy30],
    { generated_at: "2026-08-29T12:00:00.000Z" },
  );

  assert.equal(profile.profile_version, 9);
  assert.equal(profile.behavior.first_trade_at, new Date(1_777_100_000_000).toISOString());
  assert.equal(profile.behavior.last_trade_at, new Date(1_777_186_500_000).toISOString());
  assert.equal(profile.behavior.active_days, 2);
  assert.equal(profile.behavior.trade_count, 4);
  assert.equal(profile.behavior.tokens_traded, 2);
  assert.equal(profile.behavior.trade_rate_per_active_day, 2);
  assert.equal(profile.behavior.average_hold_seconds, null);
  assert.deepEqual(profile.behavior.buy_notional_by_basis, {
    usdc: { count: 2, total: 40, average: 20, median: 20 },
    sol: { count: 2, total: 4, average: 2, median: 2 },
  });
  assert.equal(profile.source_performance.roi_pct, null);
  assert.equal(profile.evidence.cross_basis_conversion_performed, false);
});

test("profile v5 exposes profit quality, drawdown, windows, reconstruction coverage, and a bounded research thesis", () => {
  const base = Math.floor(Date.parse("2026-08-29T10:00:00.000Z") / 1_000);
  const buy = (mint, spend, slot, suffix) => normalize(transaction({
    slot,
    blockTime: base + slot,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 1_000_000_000, 6), balance(WALLET, mint, 0, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 1_000_000_000 - spend, 6), balance(WALLET, mint, 100_000_000, 6)],
  }), suffix, { observation_mode: "historical_backfill" });
  const sell = (mint, proceeds, slot, suffix) => normalize(transaction({
    slot,
    blockTime: base + slot,
    pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 500_000_000, 6), balance(WALLET, mint, 100_000_000, 6)],
    post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 500_000_000 + proceeds, 6), balance(WALLET, mint, 0, 6)],
  }), suffix, { observation_mode: "historical_backfill" });
  const events = [
    buy(TOKEN, 100_000_000, 1, "u"),
    sell(TOKEN, 150_000_000, 2, "v"),
    buy(TOKEN_TWO, 100_000_000, 3, "w"),
    sell(TOKEN_TWO, 110_000_000, 4, "x"),
    buy(TOKEN_2022, 100_000_000, 5, "y"),
    sell(TOKEN_2022, 90_000_000, 6, "z"),
  ];
  const profile = buildSolanaWalletProfile(events, {
    generated_at: "2026-08-29T12:00:00.000Z",
    history: {
      provider: "fixture_rpc",
      history_limit: 24,
      history_exhausted: true,
      signatures_requested: 6,
      transactions_decoded: 6,
    },
  });
  assert.equal(profile.source_performance.realized_pnl_usdc, 50);
  assert.equal(profile.source_performance.profit_factor, 6);
  assert.equal(profile.source_performance.by_basis.usdc.average_trade_roi_pct, 16.6667);
  assert.equal(profile.source_performance.by_basis.usdc.median_trade_roi_pct, 10);
  assert.equal(profile.source_performance.by_basis.usdc.maximum_realized_drawdown, 10);
  assert.equal(profile.profit_quality.by_basis.usdc.top_1_profit_concentration_pct, 83.3333);
  assert.equal(profile.profit_quality.by_basis.usdc.top_5_profit_concentration_pct, 100);
  assert.equal(profile.source_performance.windows.d7.observations, 3);
  assert.equal(profile.source_performance.windows.d7.realized_pnl.usdc, 50);
  assert.equal(profile.data_quality.provider_history_exhausted, true);
  assert.equal(profile.data_quality.history_complete, false);
  assert.equal(profile.data_quality.trade_decode_coverage_pct, 100);
  assert.equal(profile.data_quality.classification_coverage_pct, 100);
  assert.equal(profile.data_quality.reconstruction_confidence_pct, 100);
  assert.equal(profile.data_quality.full_data_confidence_pct, null);
  assert.equal(profile.positions.known_cost_open_position_count, 0);
  assert.equal(profile.capital_observations.current_balance_claimed, false);
  assert.equal(profile.capital_observations.canonical_usdc.state, "last_observed_in_transaction");
  assert.equal(profile.research_thesis.schema_version, "ravenos.wallet_research_thesis.v1");
  assert.equal(profile.research_thesis.source_edge.state, "concentrated_positive_record");
  assert.match(profile.research_thesis.headline, /concentrated/i);
  assert.equal(profile.research_thesis.follower_reality.source_performance_used_as_follower_performance, false);
  assert.equal(profile.research_thesis.claim_boundary.copyability_claimed, false);
  assert.equal(profile.copy_readiness.source_performance_substituted, false);
});

test("discovery counts known-cost multiplier tokens and applies the exact 15-second boundary", () => {
  for (const holdSeconds of [14, 15]) {
    const buy = normalize(transaction({ slot: 501, blockTime: 1777000000,
      pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100000000, 6), balance(WALLET, TOKEN, 0, 6)],
      post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75000000, 6), balance(WALLET, TOKEN, 10000000, 6)],
    }), "A");
    const sell = normalize(transaction({ slot: 502, blockTime: 1777000000 + holdSeconds,
      pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 75000000, 6), balance(WALLET, TOKEN, 10000000, 6)],
      post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 200000000, 6), balance(WALLET, TOKEN, 0, 6)],
    }), "B");
    const metrics = buildSolanaWalletProfile([buy, sell]).discovery_metrics;
    assert.equal(metrics.mooner_tokens, 1);
    assert.equal(metrics.double_tokens, 1);
    assert.equal(metrics.under_15_seconds_count, holdSeconds < 15 ? 1 : 0);
    assert.equal(metrics.warning_tokens_pct, null);
    assert.equal(metrics.unrealized_profit_share_pct, null);
  }
});

test("holdings aggregate exact token balances and reject mismatched owners without inventing zeros", async () => {
  const { loadSolanaWalletHoldings, WALLET_TOKEN_PROGRAMS } = await import("../lib/customer_trade/solana_wallet_holdings.mjs");
  const tokenRow = (program, owner = WALLET) => ({ account: { owner: program, data: { parsed: { info: { owner, mint: TOKEN, tokenAmount: { amount: "9007199254740993", decimals: 6 } } } } } });
  const rpc = async (method, params) => method === "getBalance" ? { context: { slot: 1 }, value: 1000000000 }
    : { context: { slot: 2 }, value: params[1].programId === WALLET_TOKEN_PROGRAMS[0] ? [tokenRow(params[1].programId), tokenRow(params[1].programId)] : [] };
  const snapshot = await loadSolanaWalletHoldings({ address: WALLET, rpc });
  assert.equal(snapshot.state, "available");
  assert.equal(snapshot.tokens[0].balance_base_units, "18014398509481986");
  assert.equal(snapshot.tokens[0].balance_display, "18014398509.481986");
  const partial = await loadSolanaWalletHoldings({ address: WALLET, rpc: async (method, params) => method === "getBalance" ? { value: 0 } : { value: [tokenRow(params[1].programId, TOKEN_TWO)] } });
  assert.equal(partial.state, "partial");
  assert.equal(partial.tokens.length, 0);
  assert.equal(partial.native.amount, 0);
  assert.equal(partial.executable_valuation_available, false);
});

test("wallet trading record reuses exact partial FIFO closes, bounds periods, and excludes transfer profits", () => {
  const at = 1777000000;
  const buy = normalize(transaction({ blockTime: at, pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 100000000, 6)], post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 69999999, 6), balance(WALLET, TOKEN, 3000000, 6)] }), "A");
  const sell = normalize(transaction({ blockTime: at + 86400 * 2, pre: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 69999999, 6), balance(WALLET, TOKEN, 3000000, 6)], post: [balance(WALLET, SOLANA_CANONICAL_USDC_MINT, 84999999, 6), balance(WALLET, TOKEN, 2000000, 6)] }), "B");
  const transfer = normalize(transaction({ blockTime: at + 86400 * 2 + 1, pre: [], post: [balance(WALLET, TOKEN_TWO, 5000000, 6)], programId: "11111111111111111111111111111111", logs: ["Program log: Instruction: TransferChecked"] }), "C");
  const result = buildSolanaWalletProfile([transfer, sell, buy], { generated_at: new Date((at + 86400 * 2 + 60) * 1000).toISOString() });
  const record = result.trading_record;
  assert.equal(record.tokens.length, 1);
  assert.equal(record.tokens[0].mint, TOKEN);
  assert.equal(record.tokens[0].by_basis.usdc.matched_cost, "10.000000");
  assert.equal(record.tokens[0].by_basis.usdc.matched_proceeds, "15.000000");
  assert.equal(record.tokens[0].by_basis.usdc.realized_pnl, "5.000000");
  assert.equal(record.tokens[0].by_basis.sol.realized_pnl, null);
  assert.equal(record.periods.h24.buy_count, 0);
  assert.equal(record.periods.h24.sell_count, 1);
  assert.equal(record.periods.d7.buy_count, 1);
  assert.equal(record.periods.d7.buy_notional_by_basis.usdc.total, "30.000001");
  assert.equal(record.periods.d7.buy_notional_by_basis.usdc.average, "30.000001");
  assert.equal(record.periods.d7.distribution.reduce((n, row) => n + row.count, 0), 1);
  assert.equal(record.periods.d7.average_hold_seconds, 172800);
  assert.equal(record.wallet_creation_time_claimed, false);
  assert.equal(record.settlement_bases_combined, false);
  assert.equal(record.network_fees_included, false);
  assert(Object.isFrozen(record.tokens[0].by_basis));
});

test('transferred inventory cannot be reused to inflate later Solana trading profits', () => {
  const template = normalize(transaction({ logs: [], programId: '11111111111111111111111111111111' }), 'C');
  const asset = (mint, amount, decimals = 6) => ({ mint, amount_base_units: String(amount), decimals });
  const token = n => asset(TOKEN, n * 1000000), usdc = n => asset(SOLANA_CANONICAL_USDC_MINT, n * 1000000);
  const event = (index, kind, source, destination) => retainedEvent({ ...template, classification: { ...template.classification, kind },
    economic: { ...template.economic, source_asset: source, destination_asset: destination } }, index);
  const profile = events => buildSolanaWalletProfile(events, { generated_at: new Date(1777000100000).toISOString() });
  const result = profile([event(1, 'SWAP_BUY', usdc(10), token(10)), event(2, 'TRANSFER_OUT', token(8), null),
    event(3, 'AIRDROP', null, token(8)), event(4, 'SWAP_SELL', token(10), usdc(20))]);
  assert.equal(result.source_performance.realized_pnl_usdc, 2);
  assert.equal(result.trading_record.tokens[0].by_basis.usdc.matched_cost, '2.000000');
  assert.equal(result.trading_record.tokens[0].by_basis.usdc.matched_proceeds, '4.000000');
  assert.equal(result.source_performance.open_known_cost_lots, 0);
  assert.equal(result.source_performance.open_unknown_cost_lots, 0);
  assert.equal(result.behavior.unmatched_sell_observations, 1);
  assert.equal(result.source_performance.state, 'partial');
});

test('unknown incoming lots occupy inventory before later known purchases', () => {
  const template = normalize(transaction({ logs: [], programId: '11111111111111111111111111111111' }), 'C');
  const asset = (mint, amount, decimals = 6) => ({ mint, amount_base_units: String(amount), decimals });
  const event = (index, kind, source, destination) => retainedEvent({ ...template, classification: { ...template.classification, kind },
    economic: { ...template.economic, source_asset: source, destination_asset: destination } }, index);
  const token = n => asset(TOKEN, n * 1000000), usdc = n => asset(SOLANA_CANONICAL_USDC_MINT, n * 1000000);
  const events = [event(1, 'TRANSFER_IN', null, token(8)), event(2, 'SWAP_BUY', usdc(2), token(2)), event(3, 'SWAP_SELL', token(8), usdc(16))];
  const first = buildSolanaWalletProfile(events, { generated_at: new Date(1777000100000).toISOString() });
  assert.equal(first.source_performance.realized_pnl_usdc, null);
  assert.equal(first.source_performance.open_known_cost_lots, 1);
  const next = buildSolanaWalletProfile([...events, event(4, 'SWAP_SELL', token(2), usdc(4))], { generated_at: new Date(1777000100000).toISOString() });
  assert.equal(next.source_performance.realized_pnl_usdc, 2);
  assert.equal(next.source_performance.closed_lots, 1);
});

test('Solana FIFO never skips a different-currency lot to claim a matched profit', () => {
  const template = normalize(transaction({ logs: [], programId: '11111111111111111111111111111111' }), 'C');
  const asset = (mint, amount, decimals = 6) => ({ mint, amount_base_units: String(amount), decimals });
  const event = (index, kind, source, destination) => retainedEvent({ ...template, classification: { ...template.classification, kind },
    economic: { ...template.economic, source_asset: source, destination_asset: destination } }, index);
  const token = asset(TOKEN, 2000000), sol = asset('native_sol', 1000000000, 9);
  const result = buildSolanaWalletProfile([event(1, 'SWAP_BUY', asset(SOLANA_CANONICAL_USDC_MINT, 2000000), token),
    event(2, 'SWAP_BUY', sol, token), event(3, 'SWAP_SELL', token, asset('native_sol', 2000000000, 9))], { generated_at: new Date(1777000100000).toISOString() });
  assert.equal(result.source_performance.realized_pnl_sol, null);
  assert.equal(result.source_performance.realized_pnl_usdc, null);
  assert.equal(result.source_performance.open_known_cost_lots, 1);
  assert.equal(result.behavior.unmatched_sell_observations, 1);
});

test("wallet token results keep SOL profits denominated in SOL", () => {
  const buy = normalize(transaction({blockTime:1777000000,preLamports:10000000000,postLamports:8999995000,pre:[],post:[balance(WALLET,TOKEN,1000000,6)]}), "D");
  const sell = normalize(transaction({blockTime:1777000100,preLamports:8999995000,postLamports:10199990000,pre:[balance(WALLET,TOKEN,1000000,6)],post:[balance(WALLET,TOKEN,0,6)]}), "E");
  const record=buildSolanaWalletProfile([buy,sell],{generated_at:new Date(1777000200000).toISOString()}).trading_record;
  assert.equal(record.tokens[0].by_basis.sol.realized_pnl,"0.200000000");
  assert.equal(record.tokens[0].by_basis.usdc.realized_pnl,null);
  assert.equal(record.periods.d30.buy_notional_by_basis.sol.total,"1.000000000");
});

test('split-route net wallet buys and sells enter settlement and USD records without changing Copy signals', () => {
  const at=1777000000,logs=['Program log: Instruction: Swap','Program log: Instruction: Swap'];
  const buy=normalize(transaction({blockTime:at,logs,preLamports:1000000000,postLamports:699995000,
    pre:[balance(WALLET,TOKEN,0,6)],post:[balance(WALLET,TOKEN,1000000,6)]}), 'J');
  const sell=normalize(transaction({slot:101,blockTime:at+60,logs,preLamports:699995000,postLamports:1099990000,
    pre:[balance(WALLET,TOKEN,1000000,6)],post:[balance(WALLET,TOKEN,0,6)]}), 'K');
  const events=[buy,sell],original=JSON.stringify(events);
  assert.equal(solanaAnalyticalTradeKind(buy),'SWAP_BUY');
  assert.equal(solanaAnalyticalTradeKind(sell),'SWAP_SELL');
  const profile=buildSolanaWalletProfile(events,{generated_at:new Date((at+120)*1000).toISOString()});
  assert.equal(profile.behavior.buy_count,1);assert.equal(profile.behavior.sell_count,1);
  assert.equal(profile.behavior.classifications.SPLIT_ROUTE_SWAP,2);
  assert.equal(profile.source_performance.realized_pnl_sol,0.1);
  assert.equal(profile.source_performance.closed_lots,1);
  assert.equal(profile.trading_record.tokens[0].buy_count,1);
  assert.equal(profile.trading_record.tokens[0].sell_count,1);
  assert.equal(profile.trading_record.periods.all_available.buy_notional_by_basis.sol.total,'0.300000000');
  const prices=[{symbol:'SOL',bucket_at:Math.floor(at/300)*300,price_usd:'100',provider:'alchemy_historical_5m'}];
  const usd=walletUsdTradingRecord(profile,events,prices);
  assert.equal(usd.eligible_trades,2);assert.equal(usd.priced_trades,2);
  assert.equal(usd.periods.all_available.realized_pnl.usd,'10');
  assert.equal(walletUsdTradingRecord(profile,events,[]).periods.all_available.realized_pnl.usd,null);
  assert.equal(JSON.stringify(events),original);
  assert.equal(buy.classification.kind,'SPLIT_ROUTE_SWAP');
  assert.equal(buy.copy_signal.eligible_buy_signal,false);assert.equal(sell.copy_signal.eligible_sell_signal,false);
  for(const mutate of [
    event=>{event.economic.deltas[0].amount_base_units='1';},
    event=>{event.economic.deltas.push({...event.economic.deltas[1],mint:TOKEN_TWO});},
    event=>{event.route_evidence.program_ids=[];},
    event=>{event.route_evidence.swap_route_observed=false;},
    event=>{event.economic.source_asset.decimals=6;},
    event=>{event.chain_evidence.finality='processed';},
  ]){const invalid=structuredClone(buy);mutate(invalid);assert.equal(solanaAnalyticalTradeKind(invalid),'SPLIT_ROUTE_SWAP');}
});

test('unpriced token rotations consume outgoing lots and retain unknown incoming cost', () => {
  const at=1777000000;
  const buy=normalize(transaction({blockTime:at,
    pre:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,50000000,6),balance(WALLET,TOKEN,0,6)],
    post:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,40000000,6),balance(WALLET,TOKEN,10000000,6)]}), 'L');
  const rotate=normalize(transaction({blockTime:at+30,slot:101,
    pre:[balance(WALLET,TOKEN,10000000,6),balance(WALLET,TOKEN_TWO,0,6)],
    post:[balance(WALLET,TOKEN,0,6),balance(WALLET,TOKEN_TWO,2000000,6)]}), 'M');
  const sell=normalize(transaction({blockTime:at+60,slot:102,
    pre:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,40000000,6),balance(WALLET,TOKEN_TWO,2000000,6)],
    post:[balance(WALLET,SOLANA_CANONICAL_USDC_MINT,60000000,6),balance(WALLET,TOKEN_TWO,0,6)]}), 'N');
  assert.equal(solanaAnalyticalTradeKind(rotate),'MULTIHOP_SWAP');
  const profile=buildSolanaWalletProfile([buy,rotate,sell],{generated_at:new Date((at+120)*1000).toISOString()});
  assert.equal(profile.source_performance.closed_lots,0);
  assert.equal(profile.source_performance.realized_pnl_usdc,null);
  assert.equal(profile.coverage.unresolved_cost_basis_observations,1);
  assert.equal(profile.positions.known_cost_open_positions.length,0);
});
