import { accessConfig, fetchSplTokenBalance, resolveAccessFromSignals } from "./lib/ravenos_access.mjs";
import {
  findSubscriptionStatus,
  subscriptionActiveFromRow,
  subscriptionConfig,
} from "./lib/ravenos_subscriptions.mjs";
import { processStripeWebhookEvent } from "./lib/ravenos_stripe_webhooks.mjs";
import { verifyWalletSignature, walletAuthMessage } from "./lib/solana_wallet_auth.mjs";

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

async function readJson(request) {
  return request.json().catch(() => ({}));
}

function freeAccess(env = {}, extra = {}) {
  const config = accessConfig(env);
  return {
    ok: true,
    status: "disconnected",
    tier: "free",
    reason: "Free",
    balance: 0,
    mintConfigured: Boolean(config.mint),
    tokenAccessConfigured: config.tokenAccessConfigured,
    tokenAccessStatus: config.tokenAccessConfigured ? "configured" : "not_configured",
    thresholds: config.thresholds,
    subscription: null,
    stripeSubscriptionActive: false,
    ...extra,
  };
}

function unavailable(error, status = 503, env = {}) {
  return json(freeAccess(env, { ok: false, error }), { status });
}

async function handleAccess(request, env) {
  const url = new URL(request.url);
  let wallet = String(url.searchParams.get("wallet") || "").trim();
  if (request.method === "POST") {
    const body = await readJson(request);
    wallet = String(body.wallet || wallet || "").trim();
  }
  if (!wallet) return json(freeAccess(env));

  const config = accessConfig(env);
  let subscription = null;
  let subscriptionError = "";
  try {
    subscription = await findSubscriptionStatus(env, { wallet });
  } catch (error) {
    subscriptionError = error instanceof Error ? error.message : "subscription_unavailable";
  }

  let balance = 0;
  let tokenError = "";
  if (config.tokenAccessConfigured) {
    try {
      balance = await fetchSplTokenBalance({
        owner: wallet,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        fetchImpl: fetch,
      });
    } catch (error) {
      tokenError = error instanceof Error ? error.message : "token_balance_unavailable";
    }
  }

  const access = resolveAccessFromSignals({
    tokenBalance: balance,
    stripeActive: subscriptionActiveFromRow(subscription),
    stripeStatus: subscription?.status || "",
    env,
  });

  return json({
    ok: true,
    wallet,
    mintConfigured: Boolean(config.mint),
    tokenAccessConfigured: config.tokenAccessConfigured,
    tokenAccessStatus: config.tokenAccessConfigured ? (tokenError ? "unavailable" : "configured") : "not_configured",
    tokenError,
    subscriptionError,
    subscription: subscription
      ? {
          status: subscription.status,
          plan_type: subscription.plan_type || "unknown",
          current_period_end: subscription.current_period_end,
        }
      : null,
    ...access,
  });
}

async function stripeRequest(env, path, params) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) throw new Error("missing_stripe_secret_key");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") body.append(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

async function stripeGet(env, path, params = {}) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) throw new Error("missing_stripe_secret_key");
  const query = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1${path}${query.size ? `?${query}` : ""}`, {
    headers: { authorization: `Bearer ${config.secretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

function planPriceId(config, plan) {
  if (plan === "annual" && config.yearlyPriceId) return config.yearlyPriceId;
  if (config.monthlyPriceId) return config.monthlyPriceId;
  if (config.proPriceId) return config.proPriceId;
  return "";
}

async function handleCheckout(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) return unavailable("missing_stripe_secret_key", 503, env);
  const body = await readJson(request);
  const wallet = String(body.wallet || "").trim();
  const email = String(body.email || "").trim();
  const plan = String(body.plan || "monthly").toLowerCase() === "annual" ? "annual" : "monthly";
  const priceId = planPriceId(config, plan);
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });
  if (!priceId) return json({ ok: false, error: "missing_stripe_price_id" }, { status: 503 });
  try {
    const session = await stripeRequest(env, "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      customer_email: email || undefined,
      client_reference_id: wallet,
      "metadata[wallet_public_key]": wallet,
      "metadata[plan_type]": plan,
      "subscription_data[metadata][wallet_public_key]": wallet,
      "subscription_data[metadata][plan_type]": plan,
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      allow_promotion_codes: "false",
    });
    return json({ ok: true, url: session.url, id: session.id });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "checkout_failed" }, { status: 502 });
  }
}

async function handlePortal(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) return unavailable("missing_stripe_secret_key", 503, env);
  const body = await readJson(request);
  const wallet = String(body.wallet || "").trim();
  const signature = String(body.signature || "").trim();
  const message = String(body.message || "");
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });
  const expectedMessage = walletAuthMessage({ wallet, origin: new URL(request.url).origin });
  if (message !== expectedMessage || !verifyWalletSignature({ wallet, message, signature })) {
    return json({ ok: false, error: "wallet_signature_required" }, { status: 401 });
  }
  let subscription = null;
  try {
    subscription = await findSubscriptionStatus(env, { wallet });
  } catch {
    return unavailable("subscription_store_unavailable", 503, env);
  }
  if (!subscription?.stripe_customer_id) return json({ ok: false, error: "subscription_not_found" }, { status: 404 });
  try {
    const session = await stripeRequest(env, "/billing_portal/sessions", {
      customer: subscription.stripe_customer_id,
      return_url: config.portalReturnUrl,
    });
    return json({ ok: true, url: session.url });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "portal_failed" }, { status: 502 });
  }
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const signedPayload = `${parts.t}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));
  return timingSafeEqual(digest, parts.v1);
}

async function handleWebhook(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey || !config.webhookSecret) return unavailable("missing_stripe_webhook_config", 503, env);
  const rawBody = await request.text();
  const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature") || "", config.webhookSecret);
  if (!valid) return json({ ok: false, error: "invalid_signature" }, { status: 400 });
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_event_json" }, { status: 400 });
  }
  const stripe = {
    subscriptions: {
      retrieve: (id) => stripeGet(env, `/subscriptions/${encodeURIComponent(id)}`, { "expand[]": "items.data.price" }),
    },
  };
  try {
    return json(await processStripeWebhookEvent({ env, event, stripe }));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "webhook_store_failed" }, { status: 500 });
  }
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/access" && (request.method === "GET" || request.method === "POST")) return handleAccess(request, env);
  if (url.pathname === "/api/stripe/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (url.pathname === "/api/stripe/portal" && request.method === "POST") return handlePortal(request, env);
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return handleWebhook(request, env);
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/.git") || url.pathname.startsWith("/.wrangler")) {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname.startsWith("/api/")) return routeApi(request, env || {});
    return env.ASSETS.fetch(request);
  },
};
