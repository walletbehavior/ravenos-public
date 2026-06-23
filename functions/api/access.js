import { accessConfig, fetchSplTokenBalance, resolveAccessFromSignals } from "../../lib/ravenos_access.mjs";
import { findSubscriptionStatus, subscriptionActiveFromRow } from "../../lib/ravenos_subscriptions.mjs";

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

function publicError(code, status = 400) {
  return json(
    {
      ok: false,
      tier: "free",
      balance: 0,
      error: code,
    },
    { status },
  );
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wallet = String(url.searchParams.get("wallet") || "").trim();
  if (!wallet) return publicError("missing_wallet", 400);

  try {
    const env = context.env || {};
    const config = accessConfig(env);
    const subscription = await findSubscriptionStatus(env, { wallet });
    let balance = 0;
    let tokenError = "";
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
    const access = resolveAccessFromSignals({
      tokenBalance: balance,
      stripeActive: subscriptionActiveFromRow(subscription),
      stripeStatus: subscription?.status || "",
      env,
    });
    if (tokenError && !access.stripeSubscriptionActive) {
      const status = tokenError === "missing_mint" || tokenError === "missing_rpc_url" ? 503 : 502;
      return publicError(tokenError, status);
    }
    return json({
      ok: true,
      wallet,
      mintConfigured: Boolean(config.mint),
      subscription: subscription
        ? {
            status: subscription.status,
            plan_type: subscription.plan_type || "unknown",
            current_period_end: subscription.current_period_end,
          }
        : null,
      tokenError,
      ...access,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "access_check_failed";
    const status = message === "missing_mint" || message === "missing_rpc_url" ? 503 : 502;
    return publicError(message, status);
  }
}
