import Stripe from "stripe";
import { findSubscriptionStatus, subscriptionConfig } from "../../../lib/ravenos_subscriptions.mjs";
import { verifyWalletSignature, walletAuthMessage } from "../../../lib/solana_wallet_auth.mjs";

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export async function onRequestPost(context) {
  const config = subscriptionConfig(context.env || {});
  if (!config.secretKey) return json({ ok: false, error: "missing_stripe_secret_key" }, { status: 503 });
  const body = await context.request.json().catch(() => ({}));
  const wallet = String(body.wallet || "").trim();
  const signature = String(body.signature || "").trim();
  const message = String(body.message || "");
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });
  const expectedMessage = walletAuthMessage({ wallet, origin: new URL(context.request.url).origin });
  if (message !== expectedMessage || !verifyWalletSignature({ wallet, message, signature })) {
    return json({ ok: false, error: "wallet_signature_required" }, { status: 401 });
  }
  const subscription = await findSubscriptionStatus(context.env || {}, { wallet });
  if (!subscription?.stripe_customer_id) return json({ ok: false, error: "subscription_not_found" }, { status: 404 });

  try {
    const stripe = new Stripe(config.secretKey, { apiVersion: "2025-06-30.basil" });
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: config.portalReturnUrl,
    });
    return json({ ok: true, url: session.url });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "portal_failed" }, { status: 502 });
  }
}
