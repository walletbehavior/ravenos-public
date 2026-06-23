import { subscriptionConfig } from "../../../lib/ravenos_subscriptions.mjs";

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

async function stripeRequest(path, { secretKey, method = "POST", body = null } = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

async function resolvePriceId(config, plan) {
  if (plan === "monthly" && config.monthlyPriceId) return config.monthlyPriceId;
  if ((plan === "annual" || plan === "yearly") && config.yearlyPriceId) return config.yearlyPriceId;
  if (config.proPriceId) return config.proPriceId;
  if (!config.proProductId) throw new Error("missing_stripe_price_or_product");
  const params = new URLSearchParams({ product: config.proProductId, active: "true", limit: "1" });
  const prices = await stripeRequest(`/prices?${params.toString()}`, { secretKey: config.secretKey, method: "GET" });
  const price = prices.data?.[0];
  if (!price) throw new Error("stripe_price_not_found");
  return price.id;
}

export async function onRequestPost(context) {
  const config = subscriptionConfig(context.env || {});
  if (!config.secretKey) return json({ ok: false, error: "missing_stripe_secret_key" }, { status: 503 });
  const body = await readJson(context.request);
  const wallet = String(body.wallet || "").trim();
  const email = String(body.email || "").trim();
  const plan = String(body.plan || "monthly").toLowerCase() === "annual" ? "annual" : "monthly";
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });

  try {
    const priceId = await resolvePriceId(config, plan);
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: wallet,
      "metadata[wallet_public_key]": wallet,
      "metadata[plan_type]": plan,
      "subscription_data[metadata][wallet_public_key]": wallet,
      "subscription_data[metadata][plan_type]": plan,
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      allow_promotion_codes: "false",
    });
    if (email) params.set("customer_email", email);
    const session = await stripeRequest("/checkout/sessions", { secretKey: config.secretKey, body: params });
    return json({ ok: true, url: session.url, id: session.id });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "checkout_failed" }, { status: 502 });
  }
}
