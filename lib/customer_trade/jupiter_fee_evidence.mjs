import { RAVEN_STANDARD_EXECUTION_FEE_BPS } from "../customer_product.mjs";
import { RAVEN_JUPITER_REFERRAL as identity, ravenJupiterRouteFeeAsset } from "./jupiter_referral.mjs";

const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ENVELOPES = Object.freeze({
  d19853937cfed8e9: { name: "shared_accounts_route_v2", offset: 9, wallet: 1, input: 6, output: 7, sourceProgram: 8, destinationProgram: 9, program: 11, fee: 12 },
  bb64facc31c4af14: { name: "route_v2", offset: 8, wallet: 0, input: 3, output: 4, sourceProgram: 5, destinationProgram: 6, program: 9, fee: 10 },
});
function fail(code) { throw Object.assign(new Error(code), { code }); }

// The fixed v2 envelope is verified against actual unsigned /swap/v2/order
// transactions. Route internals remain subject to the existing program and
// whole-transaction simulation checks. An unfamiliar envelope fails closed.
export function verifyJupiterFeeInstruction(programs, request, quote, selectedMint) {
  if (!request.referral_account) return null;
  const feeAsset = ravenJupiterRouteFeeAsset(request.input_mint, request.output_mint);
  const routes = programs.instructions.filter(row => row.program_id === JUPITER_PROGRAM);
  if (routes.length !== 1) fail("jupiter_fee_instruction_count_invalid");
  const instruction = routes[0];
  const data = Buffer.from(instruction.data_base64, "base64");
  const envelope = ENVELOPES[data.subarray(0, 8).toString("hex")];
  if (!envelope || data.length < envelope.offset + 31) fail("jupiter_fee_instruction_unreviewed");
  const base = envelope.offset;
  const accounts = instruction.accounts;
  const bps = data.readUInt16LE(base + 18);
  if (bps !== RAVEN_STANDARD_EXECUTION_FEE_BPS || bps !== request.referral_fee_bps || bps !== quote.platform_fee_bps) fail("jupiter_fee_instruction_bps_mismatch");
  if (data.readUInt16LE(base + 20) !== 0) fail("jupiter_positive_slippage_fee_not_allowed");
  if (data.readBigUInt64LE(base).toString() !== request.amount_base_units) fail("jupiter_fee_instruction_input_mismatch");
  if (data.readBigUInt64LE(base + 8).toString() !== quote.expected_output_amount_base_units) fail("jupiter_fee_instruction_output_mismatch");
  if (data.readUInt16LE(base + 16) !== quote.slippage_bps) fail("jupiter_fee_instruction_slippage_mismatch");
  if (data.readUInt32LE(base + 22) !== quote.route_plan.length) fail("jupiter_fee_instruction_route_count_mismatch");
  if (accounts?.[envelope.wallet]?.address !== request.wallet_address || accounts[envelope.wallet].signer !== true) fail("jupiter_fee_instruction_wallet_mismatch");
  if (accounts?.[envelope.input]?.address !== request.input_mint || accounts?.[envelope.output]?.address !== request.output_mint) fail("jupiter_fee_instruction_mint_mismatch");
  if (!selectedMint?.mint || selectedMint.mint !== request.terminal?.token_address) fail("jupiter_fee_instruction_selected_mint_unverified");
  const tokenProgram = selectedMint.token_program;
  if (tokenProgram !== identity.token_program && !(tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" && selectedMint.token_2022_extensions_reviewed === true)) fail("jupiter_fee_instruction_token_program_unreviewed");
  const sourceProgram = request.input_mint === selectedMint.mint ? tokenProgram : identity.token_program;
  const destinationProgram = request.output_mint === selectedMint.mint ? tokenProgram : identity.token_program;
  if (accounts?.[envelope.sourceProgram]?.address !== sourceProgram || accounts?.[envelope.destinationProgram]?.address !== destinationProgram) fail("jupiter_fee_instruction_token_program_mismatch");
  if (accounts?.[envelope.program]?.address !== JUPITER_PROGRAM) fail("jupiter_fee_instruction_program_mismatch");
  if (accounts?.[envelope.fee]?.address !== feeAsset.account || accounts[envelope.fee].writable !== true || accounts[envelope.fee].signer) fail("jupiter_fee_instruction_account_mismatch");
  if (request.referral_account !== identity.account || quote.fee_mint !== feeAsset.mint) fail("jupiter_fee_instruction_identity_mismatch");
  return Object.freeze({ instruction: envelope.name, instruction_index: instruction.instruction_index,
    fee_bps: bps, fee_bps_byte_offset: base + 18, positive_slippage_bps: 0,
    fee_account: feeAsset.account, fee_account_instruction_index: envelope.fee, fee_account_writable: true,
    input_mint: request.input_mint, output_mint: request.output_mint, fee_mint: quote.fee_mint,
    source_token_program: sourceProgram, destination_token_program: destinationProgram,
    input_amount_base_units: request.amount_base_units, quoted_output_amount_base_units: quote.expected_output_amount_base_units });
}

// /order may omit platformFee.amount. An input-denominated fee is still
// deterministic; an output-denominated fee must come from simulation/receipt.
export function jupiterQuotedFeeAmount(order, request) {
  const supplied = order.platformFee?.amount;
  if (supplied !== undefined && supplied !== null && !/^(0|[1-9][0-9]*)$/.test(String(supplied))) fail("jupiter_platform_fee_amount_invalid");
  if (!request.referral_account) return supplied == null ? "0" : String(supplied);
  if (order.feeMint === request.input_mint) {
    const expected = BigInt(request.amount_base_units) * BigInt(request.referral_fee_bps) / 10_000n;
    if (supplied != null && BigInt(supplied) !== expected) fail("jupiter_platform_fee_amount_mismatch");
    return expected.toString();
  }
  return supplied == null ? null : String(supplied);
}
