import { stripeSubscriptionActive } from "./ravenos_access.mjs";

export function subscriptionDb(env = {}) {
  return env.RAVENOS_DB || env.DB || env.SUBSCRIPTIONS_DB || null;
}

export function subscriptionConfig(env = {}) {
  const appUrl = env.APP_URL || env.RAVENOS_APP_URL || "";
  return {
    secretKey: env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || "",
    publishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    proProductId: env.STRIPE_PRO_PRODUCT_ID || env.RAVENOS_STRIPE_PRO_PRODUCT_ID || "",
    proPriceId: env.STRIPE_PRO_PRICE_ID || env.RAVENOS_STRIPE_PRO_PRICE_ID || "",
    monthlyPriceId: env.STRIPE_MONTHLY_PRICE_ID || env.RAVENOS_STRIPE_MONTHLY_PRICE_ID || "",
    yearlyPriceId: env.STRIPE_YEARLY_PRICE_ID || env.STRIPE_ANNUAL_PRICE_ID || env.RAVENOS_STRIPE_YEARLY_PRICE_ID || "",
    successUrl: env.STRIPE_SUCCESS_URL || env.RAVENOS_STRIPE_SUCCESS_URL || (appUrl ? `${appUrl}/account/?checkout=success` : "/account/?checkout=success"),
    cancelUrl: env.STRIPE_CANCEL_URL || env.RAVENOS_STRIPE_CANCEL_URL || (appUrl ? `${appUrl}/pricing/?checkout=cancelled` : "/pricing/?checkout=cancelled"),
    portalReturnUrl: env.STRIPE_PORTAL_RETURN_URL || env.RAVENOS_STRIPE_PORTAL_RETURN_URL || (appUrl ? `${appUrl}/account/` : "/account/"),
  };
}

export function planTypeForPriceId(priceId, env = {}) {
  const config = subscriptionConfig(env);
  if (priceId && priceId === config.monthlyPriceId) return "monthly";
  if (priceId && priceId === config.yearlyPriceId) return "annual";
  if (priceId && priceId === config.proPriceId) return "pro";
  return "unknown";
}

export async function findSubscriptionStatus(env, { wallet = "", customerId = "" } = {}) {
  const db = subscriptionDb(env);
  if (!db) return null;
  if (wallet) {
    return db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ? OR wallet_public_key = ? ORDER BY updated_at DESC LIMIT 1")
      .bind(wallet, wallet)
      .first();
  }
  if (customerId) {
    return db
      .prepare("SELECT * FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1")
      .bind(customerId)
      .first();
  }
  return null;
}

export async function findSubscriptionBySubscriptionId(env, subscriptionId = "") {
  const db = subscriptionDb(env);
  if (!db || !subscriptionId) return null;
  return db
    .prepare("SELECT * FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1")
    .bind(subscriptionId)
    .first();
}

export async function recordWebhookEvent(env, event) {
  const db = subscriptionDb(env);
  if (!db || !event?.id) return true;
  const receivedAt = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare("INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)")
    .bind(event.id, event.type || "unknown", receivedAt)
    .run();
  return Boolean(result?.meta?.changes ?? result?.changes ?? 1);
}

export async function markWebhookProcessed(env, eventId) {
  const db = subscriptionDb(env);
  if (!db || !eventId) return;
  await db
    .prepare("UPDATE stripe_webhook_events SET processed_at = ? WHERE event_id = ?")
    .bind(Math.floor(Date.now() / 1000), eventId)
    .run();
}

export async function findLegacySubscriptionStatus(env, { wallet = "", customerId = "" } = {}) {
  const db = subscriptionDb(env);
  if (!db) return null;
  if (wallet) {
    return db
      .prepare("SELECT * FROM ravenos_subscription_status WHERE wallet_public_key = ? ORDER BY updated_at DESC LIMIT 1")
      .bind(wallet)
      .first();
  }
  if (customerId) {
    return db
      .prepare("SELECT * FROM ravenos_subscription_status WHERE stripe_customer_id = ? LIMIT 1")
      .bind(customerId)
      .first();
  }
  return null;
}

export async function upsertSubscriptionStatus(env, row) {
  const db = subscriptionDb(env);
  if (!db) return null;
  const updatedAt = Math.floor(Date.now() / 1000);
  const createdAt = Number(row.created_at || updatedAt);
  const userId = row.user_id || row.wallet_public_key || row.stripe_customer_id || row.stripe_subscription_id;
  await db
    .prepare(`
      INSERT INTO subscriptions (
        user_id, wallet_public_key, stripe_customer_id, stripe_subscription_id,
        status, current_period_end, plan_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        wallet_public_key = excluded.wallet_public_key,
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        plan_type = excluded.plan_type,
        updated_at = excluded.updated_at
    `)
    .bind(
      userId,
      row.wallet_public_key || "",
      row.stripe_customer_id || "",
      row.stripe_subscription_id || "",
      row.status || "unknown",
      Number(row.current_period_end || 0),
      row.plan_type || "unknown",
      createdAt,
      updatedAt,
    )
    .run();
  return findSubscriptionStatus(env, { customerId: row.stripe_customer_id });
}

export function subscriptionActiveFromRow(row) {
  return stripeSubscriptionActive(row?.status || "");
}

export function subscriptionItem(subscription) {
  return subscription?.items?.data?.[0] || {};
}

export function subscriptionRowFromStripeSubscription(subscription, { walletFallback = "", env = {} } = {}) {
  const item = subscriptionItem(subscription);
  const priceId = String(item.price?.id || "");
  const wallet = subscription.metadata?.wallet_public_key || walletFallback || "";
  return {
    user_id: wallet || String(subscription.customer || ""),
    wallet_public_key: wallet,
    stripe_customer_id: String(subscription.customer || ""),
    stripe_subscription_id: subscription.id || "",
    status: subscription.status || "unknown",
    current_period_end: Number(subscription.current_period_end || 0),
    plan_type: subscription.metadata?.plan_type || planTypeForPriceId(priceId, env),
    created_at: Number(subscription.created || Math.floor(Date.now() / 1000)),
  };
}

export async function markSubscriptionPaymentFailed(env, { subscriptionId = "", customerId = "" } = {}) {
  const db = subscriptionDb(env);
  if (!db) return null;
  const updatedAt = Math.floor(Date.now() / 1000);
  if (subscriptionId) {
    await db
      .prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?")
      .bind("past_due", updatedAt, subscriptionId)
      .run();
    return findSubscriptionBySubscriptionId(env, subscriptionId);
  }
  if (customerId) {
    await db
      .prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_customer_id = ?")
      .bind("past_due", updatedAt, customerId)
      .run();
    return findSubscriptionStatus(env, { customerId });
  }
  return null;
}
