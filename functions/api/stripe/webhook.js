import Stripe from "stripe";
import { subscriptionConfig } from "../../../lib/ravenos_subscriptions.mjs";
import { processStripeWebhookEvent } from "../../../lib/ravenos_stripe_webhooks.mjs";

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
  if (!config.secretKey || !config.webhookSecret) return json({ ok: false, error: "missing_stripe_webhook_config" }, { status: 503 });

  const stripe = new Stripe(config.secretKey, { apiVersion: "2025-06-30.basil" });
  const signature = context.request.headers.get("stripe-signature");
  const rawBody = await context.request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch (error) {
    return json({ ok: false, error: "invalid_signature" }, { status: 400 });
  }

  try {
    const result = await processStripeWebhookEvent({ env: context.env || {}, event, stripe });
    return json(result);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "webhook_store_failed" }, { status: 500 });
  }
}
