import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { PUMP_SWAP_REVIEW as pump, reviewPumpSwapCpis } from "../lib/customer_trade/pump_swap_review.mjs";
import { pumpSwapFixture } from "./fixtures/pump_swap.mjs";
import { SOLANA_CANARY_REVIEWED_PROGRAMS, SOLANA_UNREVIEWED_DEX_EXCLUSIONS } from "../lib/customer_trade/operator_solana_canary.mjs";

for (const method of ["buy", "buy_exact_quote_in", "sell"]) {
  test(`PumpSwap ${method} requires the swap, matching pool state, fee query and event under the verified Jupiter route`, () => {
    const fixture = pumpSwapFixture(method);
    const result = reviewPumpSwapCpis(fixture);
    assert.equal(result.reviewed, true);
    assert.equal(result.swap_count, 1);
    assert.deepEqual(result.methods, [method]);
    assert.deepEqual(result.program_ids, [pump.amm_program, pump.fee_program]);
    assert.equal(JSON.stringify(result).includes("innerInstructions"), false);
  });
}

function instruction(fixture, index) { return fixture.innerInstructions[0].instructions[index]; }
function changeData(fixture, index, mutate) {
  const row = instruction(fixture, index);
  const data = Buffer.from(bs58.decode(row.data)); mutate(data); row.data = bs58.encode(data);
}
function rpcSimulationFormat(fixture) {
  for (const row of fixture.innerInstructions[0].instructions) {
    row.programId = fixture.programs.account_keys[row.programIdIndex].address;
    row.accounts = row.accounts.map(index => fixture.programs.account_keys[index].address);
    delete row.programIdIndex;
  }
  return fixture;
}
const recordedFeeQuery = JSON.parse(readFileSync(new URL("./fixtures/pump_fee_quote_mint.json", import.meta.url), "utf8"));
test("the current read-only fee query matches Pump's published schema and a successful mainnet CPI", () => {
  const data = Buffer.from(bs58.decode(recordedFeeQuery.data));
  assert.equal(recordedFeeQuery.program_id, pump.fee_program);
  assert.deepEqual(recordedFeeQuery.accounts, [pump.fee_config, pump.amm_program]);
  assert.equal(data.subarray(0, 8).toString("hex"), createHash("sha256")
    .update(`global:${recordedFeeQuery.instruction}`).digest("hex").slice(0, 16));
  assert.equal(data.length, 57);
  for (const method of ["buy", "buy_exact_quote_in", "sell"]) {
    for (const format of [f => f, rpcSimulationFormat]) {
      const fixture = format(pumpSwapFixture(method));
      instruction(fixture, 1).data = recordedFeeQuery.data;
      assert.equal(reviewPumpSwapCpis(fixture).reviewed, true);
    }
  }
});
test("quote-mint fee queries reject changed mint, invalid bool, extra bytes, accounts or authority", () => {
  for (const [mutate, error] of [
    [f => changeData(f, 1, d => d[25] ^= 1), /fee_query_mint_mismatch/],
    [f => changeData(f, 1, d => d[8] = 2), /fee_query_data_invalid/],
    [f => instruction(f, 1).data = bs58.encode(bs58.decode(recordedFeeQuery.data).slice(0, -1)), /fee_query_data_invalid/],
    [f => instruction(f, 1).data = bs58.encode(Buffer.concat([bs58.decode(recordedFeeQuery.data), Buffer.from([0])])), /fee_query_data_invalid/],
    [f => instruction(f, 1).accounts.push(instruction(f, 0).accounts[1]), /fee_query_accounts_invalid/],
    [f => instruction(f, 1).accounts[0] = instruction(f, 0).accounts[1], /fee_query_accounts_invalid/],
    [f => instruction(f, 1).stackHeight = 2, /fee_instruction_unreviewed/],
    [f => changeData(f, 1, d => d[0] ^= 1), /fee_instruction_unreviewed/],
  ]) {
    const fixture = pumpSwapFixture(); instruction(fixture, 1).data = recordedFeeQuery.data;
    mutate(fixture); assert.throws(() => reviewPumpSwapCpis(fixture), error);
  }
});
test("unreviewed instruction diagnostics contain public selectors without account or transaction data", () => {
  const fixture = pumpSwapFixture(); changeData(fixture, 0, d => d[0] ^= 1);
  assert.throws(() => reviewPumpSwapCpis(fixture), error => {
    assert.equal(error.code, "pump_swap_instruction_unreviewed");
    assert.deepEqual(Object.keys(error.details).sort(), ["instruction_bytes", "instruction_tag", "parent_program_id",
      "parent_tag", "program_id", "stack_height"].sort());
    assert.equal(error.details.program_id, pump.amm_program);
    assert.equal(error.details.stack_height, 2);
    assert.equal(JSON.stringify(error.details).includes(fixture.request.wallet_address), false);
    return true;
  });
});
test("current simulation RPC address records and parsed built-ins preserve the same swap checks", () => {
  for (const method of ["buy", "buy_exact_quote_in", "sell"]) {
    const fixture = rpcSimulationFormat(pumpSwapFixture(method));
    fixture.innerInstructions[0].instructions.splice(2, 0, {
      programId: fixture.mint.token_program, stackHeight: 3,
      parsed: { type: "transfer", info: {} }, program: "spl-token",
    });
    assert.equal(reviewPumpSwapCpis(fixture).reviewed, true);
  }
});
test("simulation addresses must resolve to the actual transaction, and Pump bytes cannot be replaced by parsed text", () => {
  const unresolved = rpcSimulationFormat(pumpSwapFixture());
  instruction(unresolved, 0).accounts[0] = "unresolved";
  assert.throws(() => reviewPumpSwapCpis(unresolved), /inner_account_unresolved/);
  const parsed = rpcSimulationFormat(pumpSwapFixture());
  instruction(parsed, 0).parsed = { type: "buy" }; delete instruction(parsed, 0).data;
  assert.throws(() => reviewPumpSwapCpis(parsed), /inner_data_invalid/);
  const mismatch = pumpSwapFixture(); instruction(mismatch, 0).programId = pump.fee_program;
  assert.throws(() => reviewPumpSwapCpis(mismatch), /inner_program_mismatch/);
});
const cases = [
  ["top-level PumpSwap", f => f.programs.program_ids.push(pump.amm_program), /top_level_not_allowed/],
  ["top-level fee program", f => f.programs.program_ids.push(pump.fee_program), /top_level_not_allowed/],
  ["unverified Jupiter envelope", f => f.feeInstruction = null, /reviewed_route_required/],
  ["missing CPI records", f => f.innerInstructions = undefined, /inner_instructions_missing/],
  ["missing stack height", f => instruction(f, 0).stackHeight = null, /inner_stack_invalid/],
  ["unresolved account index", f => instruction(f, 0).accounts[0] = 999, /inner_account_unresolved/],
  ["missing fee query", f => f.innerInstructions[0].instructions.splice(1, 1), /invocation_evidence_incomplete/],
  ["truncated logs", f => f.logs.push("Log truncated"), /simulation_logs_incomplete/],
  ["unquoted extra swap", f => f.quote.route_plan = [], /reviewed_route_required/],
  ["wrong wallet", f => f.request.wallet_address = pump.amm_program, /swap_wallet_mismatch/],
  ["wrong config", f => instruction(f, 0).accounts[2] = instruction(f, 0).accounts[3], /swap_fixed_account_mismatch/],
  ["wrong token", f => f.request.terminal.token_address = pump.amm_program, /swap_mint_unreviewed/],
  ["wrong pool owner", f => f.preAccounts[0].owner = pump.fee_program, /pool_state_invalid/],
  ["wrong pool vault", f => f.preAccounts[0].data[139] ^= 1, /pool_accounts_mismatch/],
  ["wrong pool PDA", f => f.preAccounts[0].data[11] ^= 1, /pool_address_mismatch/],
  ["unquoted pool", f => f.quote.route_plan[0].amm_key = pump.amm_program, /route_pool_mismatch/],
  ["wrong token owner", f => f.postAccounts[1].data[32] ^= 1, /token_account_mismatch/],
  ["wrong creator fee vault", f => instruction(f, 0).accounts[17] = instruction(f, 0).accounts[10], /creator_fee_account_mismatch/],
  ["wrong volume account", f => instruction(f, 0).accounts[20] = instruction(f, 0).accounts[17], /volume_account_mismatch/],
  ["unreviewed Pump admin call", f => changeData(f, 0, d => d[0] ^= 1), /instruction_unreviewed/],
  ["unreviewed fee call", f => changeData(f, 1, d => d[0] ^= 1), /fee_instruction_unreviewed/],
  ["fee call outside swap", f => instruction(f, 1).stackHeight = 2, /fee_instruction_unreviewed/],
  ["writable fee config", f => f.programs.account_keys.find(a => a.address === pump.fee_config).writable = true, /swap_fixed_account_mismatch/],
  ["unrelated swap event", f => changeData(f, 2, d => d[128] ^= 1), /swap_event_mismatch/],
  ["unrelated event type", f => changeData(f, 2, d => d[8] ^= 1), /swap_event_mismatch/],
  ["extra method argument", f => instruction(f, 0).data = bs58.encode(Buffer.concat([bs58.decode(instruction(f, 0).data), Buffer.from([0])])), /swap_data_invalid/],
];
for (const [name, mutate, error] of cases) {
  test(`PumpSwap rejects ${name}`, () => {
    const fixture = pumpSwapFixture(); mutate(fixture);
    assert.throws(() => reviewPumpSwapCpis(fixture), error);
  });
}

test("PumpSwap preserves native SOL accounting for a transient WSOL account", () => {
  const fixture = pumpSwapFixture();
  fixture.preAccounts.splice(2, 1); fixture.postAccounts.splice(2, 1);
  assert.equal(reviewPumpSwapCpis(fixture).reviewed, true);
});

test("a closed WSOL simulation record must be empty, System-owned and have exactly zero lamports", () => {
  const closed = () => {
    const fixture = rpcSimulationFormat(pumpSwapFixture());
    fixture.postAccounts[2] = { address: fixture.postAccounts[2].address, exists: true,
      owner: "1".repeat(32), executable: false, lamports: 0n, data: Buffer.alloc(0) };
    return fixture;
  };
  assert.equal(reviewPumpSwapCpis(closed()).reviewed, true);
  for (const changed of [{lamports:1n},{owner:pump.amm_program},{data:Buffer.from([0])},{executable:true}]) {
    const fixture = closed(); Object.assign(fixture.postAccounts[2],changed);
    assert.throws(() => reviewPumpSwapCpis(fixture), /token_account_mismatch/);
  }
});

test("PumpSwap admission leaves bonding curves excluded and never grants general program admission", () => {
  assert.equal(SOLANA_UNREVIEWED_DEX_EXCLUSIONS.includes(pump.venue), false);
  assert.equal(SOLANA_UNREVIEWED_DEX_EXCLUSIONS.includes("Pump.fun"), true);
  assert.equal(SOLANA_CANARY_REVIEWED_PROGRAMS.includes(pump.amm_program), false);
  assert.equal(SOLANA_CANARY_REVIEWED_PROGRAMS.includes(pump.fee_program), false);
  const fixture = pumpSwapFixture();
  fixture.quote.route_plan = []; fixture.logs = []; fixture.innerInstructions = [];
  assert.equal(reviewPumpSwapCpis(fixture), null);
});
