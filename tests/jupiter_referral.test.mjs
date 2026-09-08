import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { RAVEN_JUPITER_REFERRAL as id, verifyRavenJupiterReferral, ravenJupiterRouteFeeAsset } from "../lib/customer_trade/jupiter_referral.mjs";
import { referralFixture } from "./fixtures/jupiter_referral.mjs";

test("reviewed USDC account is the canonical V2 ATA and referral is the named Ultra PDA", () => {
  const ata = PublicKey.findProgramAddressSync([new PublicKey(id.account).toBuffer(), new PublicKey(id.token_program).toBuffer(), new PublicKey(id.usdc_mint).toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
  assert.equal(ata.toBase58(), id.usdc_fee_account);
  assert.equal(PublicKey.findProgramAddressSync([Buffer.from("referral"), new PublicKey(id.project).toBuffer(), Buffer.from("RavenOS")], new PublicKey(id.program))[0].toBase58(), id.account);
  assert.equal(verifyRavenJupiterReferral(referralFixture(), id.account).onchain_verified, true);
});
for (const [name, index, offset, code] of [
  ["discriminator", 0, 0, "discriminator_invalid"], ["authority", 0, 8, "authority_mismatch"],
  ["project", 0, 40, "project_mismatch"], ["share", 0, 72, "share_mismatch"],
  ["name", 0, 79, "name_mismatch"], ["mint", 1, 0, "mint_mismatch"],
  ["token authority", 1, 32, "authority_mismatch"], ["frozen", 1, 108, "state_invalid"],
  ["delegate", 1, 72, "delegate_or_close_authority"], ["close authority", 1, 129, "delegate_or_close_authority"],
]) test(`referral guard rejects changed ${name}`, () => {
  const fixture = referralFixture(); const bytes = Buffer.from(fixture.value[index].data[0], "base64"); bytes[offset] ^= 1;
  fixture.value[index].data[0] = bytes.toString("base64");
  assert.throws(() => verifyRavenJupiterReferral(fixture, id.account), new RegExp(code));
});
for (const index of [0, 1]) test(`referral guard rejects missing/wrong-program account ${index}`, () => {
  const fixture = referralFixture(); fixture.value[index].owner = id.account;
  assert.throws(() => verifyRavenJupiterReferral(fixture, id.account), /owner_invalid/);
  fixture.value[index] = null;
  assert.throws(() => verifyRavenJupiterReferral(fixture, id.account), /missing/);
});
test("referral guard rejects the Limit Order identity", () => {
  assert.throws(() => verifyRavenJupiterReferral(referralFixture(), "AvDJehWmpt6w8rkhwqbE2QVKW13Kvtgw9vqDQNiMhfZn"), /identity_mismatch/);
});

test("SOL fee account uses V2 ATA derivation and mint priority, without arbitrary token accounts", () => {
  const ata = PublicKey.findProgramAddressSync([new PublicKey(id.account).toBuffer(), new PublicKey(id.token_program).toBuffer(), new PublicKey(id.sol_mint).toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
  assert.equal(ata.toBase58(), id.sol_fee_account);
  assert.equal(ravenJupiterRouteFeeAsset(id.sol_mint, id.usdc_mint).mint, id.sol_mint);
  assert.equal(verifyRavenJupiterReferral(referralFixture(id.sol_mint), id.account, id.sol_mint).fee_account, id.sol_fee_account);
  assert.throws(() => verifyRavenJupiterReferral(referralFixture(), id.account, id.sol_mint), /mint_mismatch/);
  const missing = referralFixture(id.sol_mint); missing.value[1] = null;
  assert.throws(() => verifyRavenJupiterReferral(missing, id.account, id.sol_mint), /sol_fee_account_missing/);
  assert.throws(() => ravenJupiterRouteFeeAsset(id.account, id.authority), /fee_asset_unreviewed/);
});
