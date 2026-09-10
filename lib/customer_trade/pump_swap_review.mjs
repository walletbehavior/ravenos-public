import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_PROGRAM_IDS } from "./solana_program_registry.mjs";

// Pump's published IDLs at 9c82f61cb711b044a17f770ab8ce9f9bdf78f333.
// Admission is conditional on the simulated CPI instructions below. These
// programs are deliberately NOT added to the general execution allowlist.
const AMM = SOLANA_PROGRAM_IDS.pump_amm;
const FEE = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM = "11111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const pda = (program, seeds) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
const keyBytes = address => Buffer.from(bs58.decode(address));
export const PUMP_SWAP_REVIEW = Object.freeze({
  amm_program: AMM,
  fee_program: FEE,
  venue: "Pump.fun Amm",
  global_config: pda(AMM, [Buffer.from("global_config")]),
  event_authority: pda(AMM, [Buffer.from("__event_authority")]),
  fee_config: pda(FEE, [Buffer.from("fee_config"), keyBytes(AMM)]),
});
const SWAPS = Object.freeze({
  "66063d1201daebea": { name: "buy", buy: true },
  "c62e1552b4d9e870": { name: "buy_exact_quote_in", buy: true },
  "33e685a4017f83ad": { name: "sell", buy: false },
});
function fail(reason) { throw Object.assign(new Error(`pump_swap_${reason}`), { code: `pump_swap_${reason}` }); }
function requireThat(value, reason) { if (!value) fail(reason); }
function addressAt(data, offset) { return bs58.encode(data.subarray(offset, offset + 32)); }

function resolveInner(programs, groups) {
  requireThat(Array.isArray(groups) && groups.length <= programs.instructions.length, "inner_instructions_missing");
  const seen = new Set();
  const resolved = [];
  const accountsByAddress = new Map(programs.account_keys.map(account => [account.address, account]));
  for (const group of groups) {
    const root = programs.instructions[group.index];
    requireThat(Number.isInteger(group.index) && root && !seen.has(group.index), "inner_group_invalid");
    seen.add(group.index);
    requireThat(Array.isArray(group.instructions), "inner_group_invalid");
    const stack = [{ ...root, height: 1 }];
    for (const row of group.instructions) {
      requireThat(resolved.length < 512, "inner_count_out_of_bounds");
      requireThat(Number.isInteger(row.stackHeight) && row.stackHeight >= 2 && row.stackHeight <= 16, "inner_stack_invalid");
      while (stack.at(-1)?.height >= row.stackHeight) stack.pop();
      const parent = stack.at(-1);
      requireThat(parent?.height === row.stackHeight - 1, "inner_stack_invalid");
      // simulateTransaction returns parsed built-ins and partially decoded
      // custom CPIs (addresses); retained transaction RPCs may use indexes.
      const compiled = row.programIdIndex !== undefined;
      const program = compiled
        ? Number.isInteger(row.programIdIndex) && programs.account_keys[row.programIdIndex]
        : accountsByAddress.get(row.programId);
      requireThat(program && !program.writable && !program.signer, "inner_program_invalid");
      requireThat(!compiled || row.programId === undefined || row.programId === program.address, "inner_program_mismatch");
      const parsedBuiltin = !compiled && row.parsed && typeof row.parsed === "object" && [SYSTEM, TOKEN,
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", ATA, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"].includes(program.address);
      requireThat(parsedBuiltin ? row.accounts === undefined && row.data === undefined
        : Array.isArray(row.accounts) && row.accounts.length <= 64, "inner_accounts_invalid");
      const accounts = (row.accounts || []).map(value => {
        const account = compiled ? Number.isInteger(value) && programs.account_keys[value] : accountsByAddress.get(value);
        requireThat(account, "inner_account_unresolved");
        return account;
      });
      requireThat(parsedBuiltin || typeof row.data === "string" && row.data.length <= 16384, "inner_data_invalid");
      let data;
      try { data = parsedBuiltin ? Buffer.alloc(0) : Buffer.from(bs58.decode(row.data)); } catch { fail("inner_data_invalid"); }
      const instruction = { program_id: program.address, accounts, data, parent, root, height: row.stackHeight };
      resolved.push(instruction);
      stack.push(instruction);
    }
  }
  return resolved;
}

// A WSOL account may be created and closed inside the same transaction. Its
// native balance remains covered by the existing full-transaction debit cap.
function tokenState(states, address, mint, owner, program, allowTransient = false) {
  const rows = states.map(accounts => accounts.find(row => row.address === address)).filter(row => row?.exists);
  requireThat(rows.length || allowTransient, "token_account_missing");
  for (const row of rows) {
    requireThat(row.owner === program && row.executable === false && row.data.length >= 165
      && row.data[108] === 1 && addressAt(row.data, 0) === mint
      && addressAt(row.data, 32) === owner, "token_account_mismatch");
  }
}

export function reviewPumpSwapCpis({ programs, innerInstructions, logs, request, quote, mint,
  preAccounts, postAccounts, feeInstruction }) {
  const invoked = (logs || []).filter(line => /^Program (\w+) invoke \[\d+\]$/.test(line))
    .map(line => line.split(" ")[1]);
  const pumpLegs = quote.route_plan.filter(leg => leg.venue === PUMP_SWAP_REVIEW.venue);
  const innerPumpPresent = Array.isArray(innerInstructions) && innerInstructions.some(group =>
    Array.isArray(group?.instructions) && group.instructions.some(row =>
      [AMM, FEE].includes(row.programId) || [AMM, FEE].includes(programs.account_keys[row.programIdIndex]?.address)));
  const relevant = pumpLegs.length || innerPumpPresent || [AMM, FEE].some(id => invoked.includes(id) || programs.program_ids.includes(id));
  if (!relevant) return null;
  requireThat(!programs.program_ids.some(id => id === AMM || id === FEE), "top_level_not_allowed");
  requireThat(feeInstruction && pumpLegs.length, "reviewed_route_required");
  requireThat(!(logs || []).some(line => /log.*truncat/i.test(line)), "simulation_logs_incomplete");
  const instructions = resolveInner(programs, innerInstructions);
  const pumpInstructions = instructions.filter(row => row.program_id === AMM || row.program_id === FEE);
  for (const id of [AMM, FEE]) {
    requireThat(invoked.filter(value => value === id).length === pumpInstructions.filter(row => row.program_id === id).length,
      "invocation_evidence_incomplete");
  }
  const swaps = [];
  const usedLegs = new Set();
  for (const instruction of pumpInstructions) {
    const { accounts, data, parent, root } = instruction;
    const tag = data.subarray(0, 8).toString("hex");
    const swap = instruction.program_id === AMM && SWAPS[tag];
    if (swap) {
      requireThat(parent.height === 1 && parent.program_id === SOLANA_PROGRAM_IDS.jupiter_v6
        && root.instruction_index === feeInstruction.instruction_index, "swap_parent_invalid");
      requireThat(swap.buy ? (data.length === 24 || data.length === 25 && data[24] <= 1) : data.length === 24,
        "swap_data_invalid");
      requireThat(data.readBigUInt64LE(8) > 0n, "swap_amount_invalid");
      const minimumAccounts = swap.buy ? 23 : 21;
      requireThat(accounts.length >= minimumAccounts && accounts.length <= 32, "swap_accounts_invalid");
      const a = index => accounts[index]?.address;
      requireThat(a(1) === request.wallet_address && accounts[1].signer && accounts[1].writable, "swap_wallet_mismatch");
      for (const index of [0, 5, 6, 7, 8, 10, 17, ...(swap.buy ? [20] : [])]) {
        requireThat(accounts[index].writable, "swap_account_not_writable");
      }
      const feeIndex = swap.buy ? 21 : 19;
      for (const [index, address] of [[2, PUMP_SWAP_REVIEW.global_config], [13, SYSTEM], [14, ATA],
        [15, PUMP_SWAP_REVIEW.event_authority], [16, AMM], [feeIndex, PUMP_SWAP_REVIEW.fee_config], [feeIndex + 1, FEE]]) {
        requireThat(a(index) === address && !accounts[index].writable && !accounts[index].signer, "swap_fixed_account_mismatch");
      }
      requireThat(a(3) === mint.mint && a(3) === request.terminal.token_address && [SOL, USDC].includes(a(4)), "swap_mint_unreviewed");
      requireThat(a(11) === mint.token_program && a(12) === TOKEN, "swap_token_program_mismatch");
      const pool = preAccounts.find(row => row.address === a(0));
      requireThat(pool?.exists && pool.owner === AMM && !pool.executable && pool.data.length >= 243
        && pool.data.subarray(0, 8).toString("hex") === "f19a6d0411b16dbc", "pool_state_invalid");
      requireThat(addressAt(pool.data, 43) === a(3) && addressAt(pool.data, 75) === a(4)
        && addressAt(pool.data, 139) === a(7) && addressAt(pool.data, 171) === a(8), "pool_accounts_mismatch");
      requireThat(pda(AMM, [Buffer.from("pool"), pool.data.subarray(9, 11), pool.data.subarray(11, 43),
        keyBytes(a(3)), keyBytes(a(4))]) === a(0), "pool_address_mismatch");
      const leg = pumpLegs.find(row => !usedLegs.has(row.leg_index) && row.amm_key === a(0)
        && row.input_mint === a(swap.buy ? 4 : 3) && row.output_mint === a(swap.buy ? 3 : 4));
      requireThat(leg, "route_pool_mismatch");
      usedLegs.add(leg.leg_index);
      const states = [preAccounts, postAccounts];
      tokenState(states, a(5), a(3), a(1), a(11));
      tokenState(states, a(6), a(4), a(1), a(12), a(4) === SOL);
      tokenState(states, a(7), a(3), a(0), a(11));
      tokenState(states, a(8), a(4), a(0), a(12));
      const creator = pda(AMM, [Buffer.from("creator_vault"), pool.data.subarray(211, 243)]);
      requireThat(a(18) === creator && a(17) === pda(ATA, [keyBytes(creator), keyBytes(TOKEN), keyBytes(a(4))]), "creator_fee_account_mismatch");
      requireThat(a(10) === pda(ATA, [keyBytes(a(9)), keyBytes(TOKEN), keyBytes(a(4))]), "protocol_fee_account_mismatch");
      if (swap.buy) {
        requireThat(a(19) === pda(AMM, [Buffer.from("global_volume_accumulator")])
          && a(20) === pda(AMM, [Buffer.from("user_volume_accumulator"), keyBytes(a(1))]), "volume_account_mismatch");
      }
      instruction.reviewedSwap = { method: swap.name, buy: swap.buy, pool: a(0), user: a(1), feeQueries: 0, events: 0 };
      swaps.push(instruction.reviewedSwap);
    } else if (instruction.program_id === FEE) {
      requireThat(parent.program_id === AMM && parent.reviewedSwap && tag === "e7257e55cf5b3f34", "fee_instruction_unreviewed");
      requireThat((data.length === 33 || data.length === 34 && data[33] <= 1) && data[8] <= 1, "fee_query_data_invalid");
      requireThat(accounts.length === 2 && accounts[0].address === PUMP_SWAP_REVIEW.fee_config && accounts[1].address === AMM
        && accounts.every(account => !account.writable && !account.signer), "fee_query_accounts_invalid");
      parent.reviewedSwap.feeQueries += 1;
    } else {
      requireThat(parent.program_id === AMM && parent.reviewedSwap && tag === "e445a52e51cb9a1d", "instruction_unreviewed");
      const event = parent.reviewedSwap;
      requireThat(data.length >= 192 && data.subarray(8, 16).toString("hex") === (event.buy ? "67f4521f2cf57777" : "3e2f370aa503dc2a")
        && addressAt(data, 128) === event.pool && addressAt(data, 160) === event.user, "swap_event_mismatch");
      requireThat(accounts.length === 1 && accounts[0].address === PUMP_SWAP_REVIEW.event_authority
        && !accounts[0].writable && !accounts[0].signer, "event_authority_mismatch");
      event.events += 1;
    }
  }
  requireThat(swaps.length === pumpLegs.length && swaps.every(swap => swap.feeQueries === 1 && swap.events === 1), "swap_evidence_incomplete");
  return Object.freeze({ reviewed: true, swap_count: swaps.length, fee_query_count: swaps.length,
    methods: Object.freeze(swaps.map(swap => swap.method)), program_ids: Object.freeze([AMM, FEE]),
    pool_addresses: Object.freeze(swaps.map(swap => swap.pool)) });
}
