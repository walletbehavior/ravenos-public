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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature);
}

async function stripeGet(path, secretKey) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

export async function onRequestPost(context) {
  const config = subscriptionConfig(context.env || {});
  if (!config.secretKey || !config.webhookSecret) return json({ ok: false, error: "missing_stripe_webhook_config" }, { status: 503 });

  const signature = context.request.headers.get("stripe-signature");
  const rawBody = await context.request.text();
  const verified = await verifyStripeSignature(rawBody, signature, config.webhookSecret);
  if (!verified) {
    return json({ ok: false, error: "invalid_signature" }, { status: 400 });
  }
  const event = JSON.parse(rawBody);

  try {
    const stripe = {
      subscriptions: {
        retrieve: (id) => stripeGet(`/subscriptions/${encodeURIComponent(id)}?expand[]=items.data.price`, config.secretKey),
      },
    };
    const result = await processStripeWebhookEvent({ env: context.env || {}, event, stripe });
    return json(result);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "webhook_store_failed" }, { status: 500 });
  }
}
