import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { verifyMessage } from "viem";
import { CANONICAL_REWARD_ASSETS, RewardError, rewardBalance, reserveRewards, finishRewardOperation } from "./customer_rewards.mjs";
import { moneyMicros, productFlags } from "./customer_product.mjs";

const clock = () => Math.floor(Date.now() / 1000);
export function rewardWalletAddress(chain, input) {
  const asset = CANONICAL_REWARD_ASSETS[chain];
  if (!asset) throw new RewardError("canonical_usdc_network_unsupported", 400);
  const address = String(input || "");
  if (asset.ecosystem === "evm") { if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) throw new RewardError("wallet_address_invalid", 400); return address.toLowerCase(); }
  try { if (bs58.decode(address).length !== 32) throw new Error(); } catch { throw new RewardError("wallet_address_invalid", 400); }
  return address;
}
export function rewardClaimPolicy(env, chain) {
  if (!productFlags(env).claims) throw new RewardError("cashback_claims_unavailable", 503);
  let policies; try { policies = JSON.parse(env.RAVENOS_REWARD_CLAIM_NETWORKS_JSON || "{}"); } catch { throw new RewardError("claim_network_configuration_invalid", 503); }
  const policy = policies[chain];
  const asset = CANONICAL_REWARD_ASSETS[chain];
  if (!asset || !policy || policy.enabled !== true || policy.token !== asset.token || policy.network_cost_policy !== "raven_absorbs") throw new RewardError("claim_network_unavailable", 503);
  const minimum = moneyMicros(policy.minimum_claim_micros);
  const maximumCost = moneyMicros(policy.maximum_network_cost_micros);
  if (minimum <= 0n || maximumCost <= 0n || !Number.isInteger(policy.maximum_cost_bps) || policy.maximum_cost_bps < 1 || policy.maximum_cost_bps > 1000) throw new RewardError("claim_economics_configuration_invalid", 503);
  return Object.freeze({ chain, token: asset.token, treasury_wallet: rewardWalletAddress(chain, policy.treasury_wallet), minimum_claim_micros: minimum.toString(), maximum_network_cost_micros: maximumCost.toString(), maximum_cost_bps: policy.maximum_cost_bps, network_cost_policy: "raven_absorbs" });
}
export function validateClaimEconomics(policy, amountMicros, costMicros) {
  const amount = moneyMicros(amountMicros), cost = moneyMicros(costMicros);
  if (amount < moneyMicros(policy.minimum_claim_micros)) throw new RewardError("claim_below_minimum");
  if (cost > moneyMicros(policy.maximum_network_cost_micros) || cost * 10000n > amount * BigInt(policy.maximum_cost_bps)) throw new RewardError("claim_network_cost_too_high");
  return { amount_micros: amount.toString(), estimated_network_cost_micros: cost.toString(), user_network_cost_micros: "0" };
}
export async function createRewardWalletChallenge(db, principal, { chain, address, now = clock() }) {
  const wallet = rewardWalletAddress(chain, address);
  const id = `rwc_${randomBytes(24).toString("hex")}`;
  const message = `RavenOS cashback destination verification\nAccount: ${principal.user_id}\nSession: ${principal.session_public_id}\nNetwork: ${chain}\nWallet: ${wallet}\nChallenge: ${id}\nExpires: ${new Date((now + 300) * 1000).toISOString()}\nThis verifies your claim destination. It does not authorize a trade or token transfer.`;
  await db.prepare("INSERT INTO ravenos_reward_wallet_challenges (challenge_id,user_id,session_id,chain,wallet_address,message,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, principal.user_id, principal.session_public_id, chain, wallet, message, now, now + 300).run();
  return { challenge_id: id, chain, wallet_address: wallet, message, expires_at: now + 300 };
}
export async function verifyRewardWalletChallenge(db, principal, { challenge_id, signature, now = clock() }) {
  const row = await db.prepare("SELECT * FROM ravenos_reward_wallet_challenges WHERE challenge_id = ? AND user_id = ? AND session_id = ?").bind(challenge_id, principal.user_id, principal.session_public_id).first();
  if (!row || row.expires_at <= now || row.consumed_at !== null) throw new RewardError("wallet_challenge_expired_or_unavailable");
  let verified = false;
  try {
    if (row.chain === "solana") verified = nacl.sign.detached.verify(new TextEncoder().encode(row.message), bs58.decode(String(signature)), bs58.decode(row.wallet_address));
    else verified = await verifyMessage({ address: row.wallet_address, message: row.message, signature });
  } catch { /* Invalid signatures fail closed. */ }
  if (!verified) throw new RewardError("wallet_signature_invalid");
  await db.prepare("UPDATE ravenos_reward_wallet_challenges SET verified_at = ? WHERE challenge_id = ? AND user_id = ? AND session_id = ? AND consumed_at IS NULL AND expires_at > ?").bind(now, challenge_id, principal.user_id, principal.session_public_id, now).run();
  return { verification_id: challenge_id, kind: "external_connected", chain: row.chain, wallet_address: row.wallet_address, expires_at: row.expires_at };
}
export async function resolveClaimDestination(db, principal, input, { now = clock() } = {}) {
  const asset = CANONICAL_REWARD_ASSETS[input.chain];
  if (!asset) throw new RewardError("canonical_usdc_network_unsupported");
  if (input.kind === "privy_embedded") {
    const wallet = await db.prepare(`SELECT w.* FROM ravenos_privy_wallets w JOIN ravenos_user_privy_identities p ON p.raven_user_id = w.raven_user_id AND p.privy_user_id = w.privy_user_id
      WHERE w.wallet_record_id = ? AND w.raven_user_id = ? AND w.state = 'active' AND p.state = 'active' AND w.wallet_type = 'privy_embedded' AND w.ecosystem = ?`).bind(input.wallet_record_id, principal.user_id, asset.ecosystem).first();
    if (!wallet || Number(wallet.last_verified_at) < now - 86400) throw new RewardError("embedded_wallet_verification_required");
    return { kind: "privy_embedded", wallet_record_id: wallet.wallet_record_id, chain: input.chain, token: asset.token, wallet_address: rewardWalletAddress(input.chain, wallet.public_address) };
  }
  if (input.kind === "external_connected") {
    const proof = await db.prepare("SELECT * FROM ravenos_reward_wallet_challenges WHERE challenge_id = ? AND user_id = ? AND session_id = ? AND chain = ? AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > ?").bind(input.verification_id, principal.user_id, principal.session_public_id, input.chain, now).first();
    if (!proof) throw new RewardError("external_wallet_verification_required");
    return { kind: "external_connected", verification_id: proof.challenge_id, chain: proof.chain, token: asset.token, wallet_address: proof.wallet_address };
  }
  throw new RewardError("verified_wallet_destination_required");
}

export async function treasuryRequest(env, path, payload) {
  // A separately permissioned service binding owns treasury signing. The
  // customer worker never accepts a key, unsigned transfer, or arbitrary URL.
  if (!env.RAVENOS_REWARDS_TREASURY?.fetch) throw new RewardError("rewards_treasury_unavailable", 503);
  const response = await env.RAVENOS_REWARDS_TREASURY.fetch(new Request(`https://raven-rewards-treasury.internal/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }));
  const text = await response.text();
  if (text.length > 16384 || !response.ok) throw new RewardError("rewards_treasury_unavailable", 503);
  const result = JSON.parse(text);
  if (result.ok !== true) throw new RewardError("rewards_treasury_unavailable", 503);
  return result;
}
export async function prepareCashbackClaim(env, principal, input, { now = clock(), treasury = treasuryRequest } = {}) {
  const db = env.RAVENOS_CUSTOMER_DB;
  const policy = rewardClaimPolicy(env, input.destination?.chain);
  const destination = await resolveClaimDestination(db, principal, input.destination, { now });
  const amount = moneyMicros(input.amount_micros).toString();
  const balance = await rewardBalance(db, principal.user_id);
  if (moneyMicros(balance.available_micros) < moneyMicros(amount)) throw new RewardError("reward_balance_insufficient");
  const quote = await treasury(env, "quote", { destination, amount_micros: amount, treasury_wallet: policy.treasury_wallet });
  if (quote.chain !== policy.chain || quote.token !== policy.token || quote.wallet_address !== destination.wallet_address || quote.amount_micros !== amount || quote.treasury_wallet !== policy.treasury_wallet || !Number.isSafeInteger(quote.expires_at) || quote.expires_at <= now || quote.expires_at > now + 120 || typeof quote.quote_id !== "string") throw new RewardError("claim_quote_mismatch");
  const economics = validateClaimEconomics(policy, amount, quote.network_cost_micros);
  if (moneyMicros(quote.spendable_usdc_micros) < moneyMicros(amount)) throw new RewardError("claim_treasury_funding_unavailable", 503);
  return { policy, destination, amount, quote, economics };
}
export async function requestCashbackClaim(env, principal, input, { now = clock(), treasury = treasuryRequest } = {}) {
  if (!Number.isSafeInteger(principal.authenticated_at) || principal.authenticated_at > now + 60 || now - principal.authenticated_at > 900) throw new RewardError("claim_recent_login_required", 401);
  const db = env.RAVENOS_CUSTOMER_DB;
  const existing = await db.prepare("SELECT operation_id,state,amount_micros,destination_json FROM ravenos_reward_operations WHERE user_id = ? AND idempotency_key = ? AND kind = 'claim'").bind(principal.user_id, input.idempotency_key).first();
  if (existing) {
    const dest = JSON.parse(existing.destination_json);
    if (String(existing.amount_micros) !== input.amount_micros || dest.chain !== input.destination?.chain || dest.kind !== input.destination?.kind || (dest.kind === "privy_embedded" ? dest.wallet_record_id !== input.destination.wallet_record_id : dest.verification_id !== input.destination.verification_id)) throw new RewardError("reward_idempotency_conflict");
    return { operation_id: existing.operation_id, state: existing.state, amount_micros: String(existing.amount_micros) };
  }
  const { policy, destination, amount, quote, economics } = await prepareCashbackClaim(env, principal, input, { now, treasury });
  const consumeProof = destination.verification_id ? [db.prepare("UPDATE ravenos_reward_wallet_challenges SET consumed_at=? WHERE challenge_id=? AND user_id=? AND consumed_at IS NULL").bind(now,destination.verification_id,principal.user_id)] : [];
  const operation = await reserveRewards(db, { extra_statements: consumeProof, user_id: principal.user_id, kind: "claim", amount_micros: amount, idempotency_key: input.idempotency_key, destination: { ...destination, treasury_wallet: policy.treasury_wallet, quote_id: quote.quote_id }, now });
  // Reservation is durable. Only the payout dispatcher may submit to the
  // signing service, and only independent chain verification marks CLAIMED.
  return { operation_id: operation.operation_id, state: operation.state, destination, ...economics };
}

export async function reconcileClaimOperation(env, operation, { verify_transfer, now = clock(), treasury = treasuryRequest } = {}) {
  if (operation.kind !== "claim" || !["reserved", "processing", "indeterminate"].includes(operation.state)) return { state: operation.state };
  if (typeof verify_transfer !== "function") throw new RewardError("claim_chain_verifier_required", 503);
  const destination = JSON.parse(operation.destination_json);
  const policy = rewardClaimPolicy(env, destination.chain);
  if (policy.token !== destination.token || policy.treasury_wallet !== destination.treasury_wallet) throw new RewardError("claim_treasury_policy_changed");
  const current = await env.RAVENOS_CUSTOMER_DB.prepare("SELECT submission_reference FROM ravenos_reward_operations WHERE operation_id=?").bind(operation.operation_id).first();
  const transfer = current?.submission_reference ? {transaction_hash:current.submission_reference} : await treasury(env, "payout", { operation_id: operation.operation_id, user_id: operation.user_id, amount_micros: String(operation.amount_micros), destination });
  if (transfer.state === "rejected_before_submission" && transfer.transaction_hash === null) return finishRewardOperation(env.RAVENOS_CUSTOMER_DB, { ...operation, outcome: "failed", evidence: { reason: "treasury_rejected_before_submission" }, now });
  if (!transfer.transaction_hash) return { state: "reserved", operation_id: operation.operation_id };
  if (typeof transfer.transaction_hash !== "string" || transfer.transaction_hash.length<30 || transfer.transaction_hash.length>100) throw new RewardError("claim_transaction_reference_invalid");
  await env.RAVENOS_CUSTOMER_DB.prepare("UPDATE ravenos_reward_operations SET submission_reference=?,state='processing',updated_at=? WHERE operation_id=? AND state IN ('reserved','processing','indeterminate') AND (submission_reference IS NULL OR submission_reference=?)").bind(transfer.transaction_hash,now,operation.operation_id,transfer.transaction_hash).run();
  const saved=await env.RAVENOS_CUSTOMER_DB.prepare("SELECT submission_reference FROM ravenos_reward_operations WHERE operation_id=?").bind(operation.operation_id).first();
  if(saved.submission_reference!==transfer.transaction_hash)throw new RewardError("claim_submission_identity_conflict");
  const verified = await verify_transfer({ chain: destination.chain, token: destination.token, from: destination.treasury_wallet, to: destination.wallet_address, amount_micros: String(operation.amount_micros), transaction_hash: transfer.transaction_hash });
  if (verified?.finalized !== true || verified?.matched !== true) return finishRewardOperation(env.RAVENOS_CUSTOMER_DB, { ...operation, outcome: "indeterminate", evidence: { reason: "chain_transfer_unconfirmed" }, now });
  return finishRewardOperation(env.RAVENOS_CUSTOMER_DB, { ...operation, outcome: "settled", external_reference: `${destination.chain}:${transfer.transaction_hash}`, evidence: verified, now });
}
