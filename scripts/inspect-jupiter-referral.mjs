// Read-only mainnet verification and unsigned USDC setup; no signing/submission API.
import { writeFile } from "node:fs/promises";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { RAVEN_JUPITER_REFERRAL as id, verifyRavenJupiterReferral } from "../lib/customer_trade/jupiter_referral.mjs";
import { RAVEN_STANDARD_EXECUTION_FEE_BPS, RAVEN_PRO_EXECUTION_FEE_BPS, RAVEN_PRO_CASHBACK_PERCENT } from "../lib/customer_product.mjs";

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/inspect-jupiter-referral.mjs OUTPUT.json");
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("mainnet_required");
const keys = [id.account, id.usdc_fee_account].map((key) => new PublicKey(key));
const response = await connection.getMultipleAccountsInfoAndContext(keys);
const state = { context: response.context, value: response.value.map((row) => row && ({
  ...row, owner: row.owner.toBase58(), data: [row.data.toString("base64"), "base64"],
})) };
let blocker = null;
try { verifyRavenJupiterReferral(state, id.account); } catch (error) {
  if (error.code !== "jupiter_usdc_fee_account_missing") throw error;
  blocker = error.code;
}
const report = { generated_at: new Date().toISOString(), identity: id, state, blocker, broadcast: false,
  fee_proof: { standard_bps: RAVEN_STANDARD_EXECUTION_FEE_BPS, pro_bps: RAVEN_PRO_EXECUTION_FEE_BPS,
    pro_cashback_percent: RAVEN_PRO_CASHBACK_PERCENT, unsigned_swap_instruction_proof: "pending", live_canary: "not_run" } };
if (blocker) {
  const associatedProgram = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const derived = PublicKey.findProgramAddressSync([keys[0].toBuffer(), new PublicKey(id.token_program).toBuffer(), new PublicKey(id.usdc_mint).toBuffer()], associatedProgram)[0];
  if (!derived.equals(keys[1])) throw new Error("derived_fee_account_mismatch");
  // Same idempotent ATA instruction as Referral SDK initializeReferralTokenAccountV2.
  const instruction = new TransactionInstruction({ programId: associatedProgram, data: Buffer.from([1]), keys: [
    { pubkey: new PublicKey(id.authority), isSigner: true, isWritable: true },
    { pubkey: derived, isSigner: false, isWritable: true },
    { pubkey: keys[0], isSigner: false, isWritable: false },
    { pubkey: new PublicKey(id.usdc_mint), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(id.token_program), isSigner: false, isWritable: false },
  ] });
  const recent = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: new PublicKey(id.authority), ...recent }).add(instruction);
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const decoded = Transaction.from(raw);
  if (decoded.signatures.some((row) => row.signature !== null) || decoded.instructions.length !== 1) throw new Error("unsigned_setup_invalid");
  report.unsigned_usdc_setup = { transaction_base64: raw.toString("base64"), ...recent,
    instruction: "createAssociatedTokenAccountIdempotent", program: associatedProgram.toBase58(),
    accounts: instruction.keys.map((row) => ({ address: row.pubkey.toBase58(), signer: row.isSigner, writable: row.isWritable })),
    data_hex: instruction.data.toString("hex"), signatures_populated: 0,
    rent_lamports: await connection.getMinimumBalanceForRentExemption(165),
    note: "Review artifact only. Refresh blockhash and revalidate accounts before any later authorized signing." };
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, slot: state.context.slot, blocker, broadcast: false }));
