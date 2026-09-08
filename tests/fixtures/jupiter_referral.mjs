import { createHash } from "node:crypto";
import bs58 from "bs58";
import { RAVEN_JUPITER_REFERRAL as id } from "../../lib/customer_trade/jupiter_referral.mjs";
export function referralFixture(feeMint = id.usdc_mint) {
  const referral = Buffer.alloc(274);
  createHash("sha256").update("account:ReferralAccount").digest().copy(referral, 0, 0, 8);
  Buffer.from(bs58.decode(id.authority)).copy(referral, 8);
  Buffer.from(bs58.decode(id.project)).copy(referral, 40);
  referral.writeUInt16LE(8000, 72); referral[74] = 1; referral.writeUInt32LE(7, 75); referral.write("RavenOS", 79);
  const token = Buffer.alloc(165);
  Buffer.from(bs58.decode(feeMint)).copy(token, 0);
  Buffer.from(bs58.decode(id.account)).copy(token, 32); token[108] = 1;
  return { context: { slot: 500 }, value: [
    { owner: id.program, executable: false, data: [referral.toString("base64"), "base64"] },
    { owner: id.token_program, executable: false, data: [token.toString("base64"), "base64"] },
  ] };
}
