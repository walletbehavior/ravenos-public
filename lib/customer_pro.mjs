import { createHmac, createHash } from "node:crypto";
import { RAVEN_PRO_TRIAL_DAYS, productFlags } from "./customer_product.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
export const PRO_CAPABILITIES = Object.freeze(["intelligence.perps_advanced", "intelligence.participant_advanced", "research.alerts", "wallet.copy", "agents.paper"]);

export function trialEligibility({ existing_trial = null, paid_history = false, verified = false, security_hold = false, account_created = false, existing_policy = "disabled", explicit_request = false, identity_claimed = false } = {}) {
  if (existing_trial) return { eligible: false, status: existing_trial.trial_status, reason: "trial_already_recorded" };
  if (security_hold || identity_claimed) return { eligible: false, status: "ABUSE_BLOCKED", reason: "identity_or_security_hold" };
  if (!verified || paid_history) return { eligible: false, status: "NOT_ELIGIBLE", reason: paid_history ? "prior_paid_pro" : "verified_identity_required" };
  if (!account_created && !(existing_policy === "opt_in" && explicit_request)) return { eligible: false, status: existing_policy === "opt_in" ? "ELIGIBLE" : "NOT_ELIGIBLE", reason: "existing_account_policy" };
  return { eligible: true, status: "ELIGIBLE", reason: account_created ? "new_verified_account" : "existing_account_opt_in" };
}

export function resolveProductAccess({ trial = null, subscription = null, now = Math.floor(Date.now() / 1000) } = {}) {
  // A Checkout session or Stripe trial is not a paid invoice. Cancellation at
  // period end retains already-funded access until the recorded invoice ends.
  const paid = subscription?.paid_history === 1 && ["active", "past_due"].includes(subscription?.status) && Number(subscription.period_start) <= now && Number(subscription.period_end) > now;
  const trialActive = trial?.trial_status === "ACTIVE" && trial.trial_started_at <= now && trial.trial_ends_at > now;
  const trialStatus = trial?.trial_status === "ACTIVE" && trial.trial_ends_at <= now ? "EXPIRED" : trial?.trial_status || "NOT_ELIGIBLE";
  return Object.freeze({
    pro: paid || trialActive, tier: paid || trialActive ? "pro" : "standard",
    state: paid ? "PAID_PRO" : trialActive ? "PRO_TRIAL_ACTIVE" : "STANDARD",
    source: paid ? "paid" : trialActive ? "trial" : "standard",
    active_from: paid ? subscription.period_start : trialActive ? trial.trial_started_at : null,
    active_until: paid ? subscription.period_end : trialActive ? trial.trial_ends_at : null,
    trial: trial ? { trial_started_at: trial.trial_started_at, trial_ends_at: trial.trial_ends_at, trial_status: trialStatus, days_remaining: trialActive ? Math.ceil((trial.trial_ends_at - now) / 86400) : 0, card_required: false, automatic_charge: false } : null,
    subscription: subscription ? { status: subscription.status, cancel_at_period_end: Boolean(subscription.cancel_at_period_end), period_end: subscription.period_end } : null,
  });
}

export async function readProductAccess(db, userId, { now = Math.floor(Date.now() / 1000) } = {}) {
  const [trial, subscription] = await Promise.all([
    db.prepare("SELECT * FROM ravenos_pro_trials WHERE user_id = ?").bind(userId).first(),
    db.prepare("SELECT * FROM ravenos_pro_subscriptions WHERE user_id = ?").bind(userId).first(),
  ]);
  return resolveProductAccess({ trial, subscription, now });
}

export function productCapabilityGrants(userId, access) {
  if (!access?.pro) return [];
  return PRO_CAPABILITIES.map((capability) => ({ grant_id: `ent_${digest(`${userId}|${access.source}|${capability}|${access.active_from}`).slice(0, 40)}`, user_id: userId, capability_key: capability, state: "active", activation_at: access.active_from, expires_at: access.active_until, revision: 1, grant_source: access.source }));
}

export async function ensureProTrial(env, account, identity, { now, explicit_request = false, db = env.RAVENOS_CUSTOMER_DB } = {}) {
  if (!productFlags(env).trials) return { eligible: false, status: "NOT_ELIGIBLE", reason: "trials_disabled" };
  const pepper = String(env.RAVENOS_PRO_TRIAL_IDENTITY_PEPPER || env.RAVENOS_AUTH_HASH_PEPPER || "");
  if (pepper.length < 16 || !db?.prepare || !identity?.issuer || !identity?.provider_subject || !identity?.email) return { eligible: false, status: "NOT_ELIGIBLE", reason: "trial_identity_unavailable" };
  const hmac = (value) => createHmac("sha256", pepper).update(value).digest("hex");
  const identityDigest = hmac(`pro-trial:identity:${identity.issuer}:${identity.provider_subject}`);
  const emailDigest = hmac(`pro-trial:email:${identity.email.trim().toLowerCase()}`);
  const [existing, subscription, claimed] = await Promise.all([
    db.prepare("SELECT * FROM ravenos_pro_trials WHERE user_id = ?").bind(account.user_id).first(),
    db.prepare("SELECT paid_history FROM ravenos_pro_subscriptions WHERE user_id = ?").bind(account.user_id).first(),
    db.prepare("SELECT user_id FROM ravenos_pro_trials WHERE identity_digest = ? OR email_digest = ?").bind(identityDigest, emailDigest).first(),
  ]);
  // A rollout cutoff lets an interrupted account-creation callback recover on
  // login without manufacturing trials for accounts created before rollout.
  const cutoff = Number(env.RAVENOS_PRO_TRIAL_ELIGIBILITY_START_AT || 0);
  const newAccount = account.created === true || (Number.isSafeInteger(cutoff) && cutoff > 0 && Number(account.user_created_at) >= cutoff);
  const eligibility = trialEligibility({ existing_trial: existing, paid_history: Boolean(subscription?.paid_history), verified: identity.verified === true, security_hold: account.state !== "active", account_created: newAccount, existing_policy: env.RAVENOS_PRO_TRIAL_EXISTING_USERS || "disabled", explicit_request, identity_claimed: Boolean(claimed && claimed.user_id !== account.user_id) });
  if (!eligibility.eligible) return eligibility;
  const started = newAccount ? Number(account.user_created_at ?? now) : now;
  if (!Number.isSafeInteger(started) || !Number.isSafeInteger(now) || started < 0 || started > now) throw new Error("trial_time_invalid");
  const ends = started + RAVEN_PRO_TRIAL_DAYS * 86400;
  const source = `trial:${account.user_id}`;
  // D1 batch is atomic. Unique account and verified-identity constraints win races.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ravenos_pro_trials (user_id, identity_digest, email_digest, trial_started_at, trial_ends_at, trial_status, eligibility_policy, created_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
      .bind(account.user_id, identityDigest, emailDigest, started, ends, eligibility.reason, now),
    db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id, user_id, event_type, source_reference, occurred_at, details_json)
      SELECT ?, user_id, 'trial_started', ?, trial_started_at, '{"card_required":false,"automatic_charge":false}' FROM ravenos_pro_trials WHERE user_id = ? AND identity_digest = ?`)
      .bind(`pe_${digest(source)}`, source, account.user_id, identityDigest),
  ]);
  if (String(env.RAVENOS_REFERRALS_ENABLED || "") === "1") {
    await db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json) SELECT 'pe_referral_trial_' || r.attribution_id,r.referred_user_id,'referral_trial_started',r.attribution_id,?,'{}' FROM ravenos_referral_attributions r JOIN ravenos_pro_trials t ON t.user_id=r.referred_user_id WHERE r.referred_user_id=?`).bind(started,account.user_id).run();
  }
  const recorded = await db.prepare("SELECT * FROM ravenos_pro_trials WHERE user_id = ?").bind(account.user_id).first();
  return recorded ? resolveProductAccess({ trial: recorded, now }) : { eligible: false, status: "ABUSE_BLOCKED", reason: "identity_trial_already_used" };
}

export async function expireProTrials(db, now = Math.floor(Date.now() / 1000)) {
  // Logical expiry is enforced on every access read; this sweep records analytics.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id, user_id, event_type, source_reference, occurred_at, details_json)
      SELECT 'pe_trial_expired_' || user_id, user_id, 'trial_expired', 'trial:' || user_id, trial_ends_at, '{}' FROM ravenos_pro_trials WHERE trial_status = 'ACTIVE' AND trial_ends_at <= ?`).bind(now),
    db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json) SELECT 'pe_referral_expired_' || r.attribution_id,t.user_id,'referral_trial_expired',r.attribution_id,t.trial_ends_at,'{}' FROM ravenos_pro_trials t JOIN ravenos_referral_attributions r ON r.referred_user_id=t.user_id WHERE t.trial_status='ACTIVE' AND t.trial_ends_at<=?`).bind(now),
    db.prepare("UPDATE ravenos_pro_trials SET trial_status = 'EXPIRED' WHERE trial_status = 'ACTIVE' AND trial_ends_at <= ?").bind(now),
  ]);
}
