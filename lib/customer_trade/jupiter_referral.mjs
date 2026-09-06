import { createHash } from "node:crypto";
import bs58 from "bs58";

// Reviewed Raven identity, verified on mainnet. Rotation requires a new review.
export const RAVEN_JUPITER_REFERRAL = Object.freeze({
  program: "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3",
  project: "DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc",
  account: "CAhs68qUBmRVg4i8kh6L6VzDqAWsMtNrE8acoTo3K3Vd",
  authority: "CEACkaNKdHVupnaiEMLGppw8RthjCdoMj8kdxJeg3MfV",
  usdc_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdc_fee_account: "AZvRGXzbBAJK5BoWMGp18wJUtJLFgc9LadY274gs6U17",
  token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  integrator_share_bps: 8000,
});
const identity = RAVEN_JUPITER_REFERRAL;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function data(row, program, minimum, label) {
  if (!row) fail(`jupiter_${label}_missing`);
  if (row.owner !== program || row.executable !== false) fail(`jupiter_${label}_owner_invalid`);
  if (row.data?.[1] !== "base64" || typeof row.data[0] !== "string") fail(`jupiter_${label}_data_invalid`);
  const bytes = Buffer.from(row.data[0], "base64");
  if (bytes.length < minimum || bytes.toString("base64") !== row.data[0]) fail(`jupiter_${label}_data_invalid`);
  return bytes;
}
export function verifyRavenJupiterReferral(result, referralAccount) {
  if (referralAccount !== identity.account) fail("jupiter_referral_identity_mismatch");
  if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot <= 0 || result.value?.length !== 2) fail("jupiter_referral_rpc_invalid");
  const referral = data(result.value[0], identity.program, 86, "referral_account");
  const discriminator = createHash("sha256").update("account:ReferralAccount").digest().subarray(0, 8);
  if (!referral.subarray(0, 8).equals(discriminator)) fail("jupiter_referral_discriminator_invalid");
  if (bs58.encode(referral.subarray(8, 40)) !== identity.authority) fail("jupiter_referral_authority_mismatch");
  if (bs58.encode(referral.subarray(40, 72)) !== identity.project) fail("jupiter_referral_project_mismatch");
  if (referral.readUInt16LE(72) !== identity.integrator_share_bps) fail("jupiter_referral_share_mismatch");
  if (referral[74] !== 1 || referral.readUInt32LE(75) !== 7 || referral.subarray(79, 86).toString() !== "RavenOS") fail("jupiter_referral_name_mismatch");
  const token = data(result.value[1], identity.token_program, 165, "usdc_fee_account");
  if (token.length !== 165 || token[108] !== 1) fail("jupiter_usdc_fee_account_state_invalid");
  if (bs58.encode(token.subarray(0, 32)) !== identity.usdc_mint) fail("jupiter_usdc_fee_account_mint_mismatch");
  if (bs58.encode(token.subarray(32, 64)) !== identity.account) fail("jupiter_usdc_fee_account_authority_mismatch");
  if (token.readUInt32LE(72) !== 0 || token.readUInt32LE(129) !== 0) fail("jupiter_usdc_fee_account_delegate_or_close_authority");
  return Object.freeze({ referral_account: identity.account, authority: identity.authority, project: identity.project,
    fee_account: identity.usdc_fee_account, fee_mint: identity.usdc_mint, context_slot: result.context.slot, onchain_verified: true });
}
