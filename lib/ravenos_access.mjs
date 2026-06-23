const DEFAULT_PRO_THRESHOLD = 1_000_000;
const DEFAULT_FOUNDER_THRESHOLD = 10_000_000;
const DEFAULT_TOKEN_SUPPLY = 1_000_000_000;
const DEFAULT_MARKET_CAP_STAGE = "early";
const STAGES = new Set(["early", "growth", "mature"]);

function numericEnv(env, key, fallback) {
  const raw = env && env[key] != null ? String(env[key]).trim() : "";
  if (!raw) return fallback;
  const value = Number(raw.replaceAll("_", ""));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function textEnv(env, keys) {
  for (const key of keys) {
    const value = env && env[key] != null ? String(env[key]).trim() : "";
    if (value) return value;
  }
  return "";
}

function marketCapStage(env = {}) {
  const raw = textEnv(env, ["RAVENOS_MARKET_CAP_STAGE", "RAVENOS_ACCESS_MARKET_CAP_STAGE"]).toLowerCase();
  return STAGES.has(raw) ? raw : DEFAULT_MARKET_CAP_STAGE;
}

export function accessThresholds(env = {}) {
  const stage = marketCapStage(env);
  const stageDefaults = {
    early: numericEnv(env, "RAVENOS_PRO_THRESHOLD_EARLY", DEFAULT_PRO_THRESHOLD),
    growth: numericEnv(env, "RAVENOS_PRO_THRESHOLD_GROWTH", 500_000),
    mature: numericEnv(env, "RAVENOS_PRO_THRESHOLD_MATURE", 100_000),
  };
  const legacyPro = numericEnv(env, "RAVENOS_ACCESS_PRO_THRESHOLD", numericEnv(env, "RAVENOS_ACCESS_PRO_TOKENS", NaN));
  const pro = Number.isFinite(legacyPro) ? legacyPro : stageDefaults[stage];
  const founder = numericEnv(
    env,
    "RAVENOS_FOUNDER_THRESHOLD",
    numericEnv(
      env,
      "RAVENOS_ACCESS_FOUNDER_THRESHOLD",
      numericEnv(env, "RAVENOS_ACCESS_FOUNDER_TOKENS", DEFAULT_FOUNDER_THRESHOLD),
    ),
  );
  const tokenSupply = numericEnv(env, "RAVENOS_TOKEN_SUPPLY", DEFAULT_TOKEN_SUPPLY);
  return {
    pro,
    founder,
    stage,
    tokenSupply,
    stages: {
      early: stageDefaults.early,
      growth: stageDefaults.growth,
      mature: stageDefaults.mature,
    },
  };
}

export function resolveAccessTier(balanceTokens, env = {}) {
  const balance = Number(balanceTokens);
  const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const thresholds = accessThresholds(env);
  if (safeBalance >= thresholds.founder) return "founder";
  if (safeBalance >= thresholds.pro) return "pro";
  return "free";
}

export function stripeSubscriptionActive(status) {
  return status === "active" || status === "trialing";
}

export function resolveAccessFromSignals({ tokenBalance = 0, stripeStatus = "", stripeActive = false, stripePlanType = "", env = {} } = {}) {
  return resolveAccessFromSignalsV2({ tokenBalance, stripeStatus, stripeActive, stripePlanType, env });
}

function isAtlasPlan(planType = "") {
  return String(planType || "").toLowerCase().startsWith("atlas");
}

function accessEntitlements({ tier = "free", tokenTier = "free", stripePlanType = "", subscriptionActive = false } = {}) {
  const entitlements = new Set(["free"]);
  const resolved = String(tier || "free").toLowerCase();
  const token = String(tokenTier || "free").toLowerCase();
  if (resolved === "pro" || resolved === "founder" || token === "pro" || token === "founder") entitlements.add("pro");
  if (resolved === "founder" || token === "founder") {
    entitlements.add("pro");
    entitlements.add("founder");
  }
  if ((subscriptionActive && isAtlasPlan(stripePlanType)) || resolved === "atlas") entitlements.add("atlas");
  return [...entitlements];
}

export function resolveAccessFromSignalsV2({ tokenBalance = 0, stripeStatus = "", stripeActive = false, stripePlanType = "", env = {} } = {}) {
  const balance = Number(tokenBalance);
  const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const thresholds = accessThresholds(env);
  const subscriptionActive = Boolean(stripeActive) || stripeSubscriptionActive(stripeStatus);
  const tokenTier = resolveAccessTier(safeBalance, env);
  const withEntitlements = (payload) => ({
    ...payload,
    tokenTier,
    entitlements: accessEntitlements({ tier: payload.tier, tokenTier, stripePlanType, subscriptionActive }),
  });
  if (subscriptionActive && isAtlasPlan(stripePlanType)) {
    return withEntitlements({ tier: "atlas", reason: "Atlas Subscription", balance: safeBalance, thresholds, stripeSubscriptionActive: true });
  }
  if (safeBalance >= thresholds.founder) {
    return withEntitlements({ tier: "founder", reason: "Founder", balance: safeBalance, thresholds, stripeSubscriptionActive: subscriptionActive });
  }
  if (subscriptionActive) {
    return withEntitlements({ tier: "pro", reason: "Subscription", balance: safeBalance, thresholds, stripeSubscriptionActive: true });
  }
  if (safeBalance >= thresholds.pro) {
    return withEntitlements({ tier: "pro", reason: "Token Holder", balance: safeBalance, thresholds, stripeSubscriptionActive: false });
  }
  return withEntitlements({ tier: "free", reason: "Free", balance: safeBalance, thresholds, stripeSubscriptionActive: false });
}

export function accessConfig(env = {}) {
  const mint = textEnv(env, ["RAVENOS_ACCESS_TOKEN_MINT", "RAVENOS_TOKEN_GATE_MINT", "RAVENOS_SOLANA_MINT"]);
  const rpcUrl = textEnv(env, ["RAVENOS_SOLANA_RPC_URL", "SOLANA_RPC_URL", "SOLANA_ALCHEMY_RPC_URL"]);
  return {
    mint,
    rpcUrl,
    tokenAccessConfigured: Boolean(mint && rpcUrl),
    thresholds: accessThresholds(env),
  };
}

function jsonRpcBody(owner, mint) {
  return {
    jsonrpc: "2.0",
    id: "ravenos-access",
    method: "getTokenAccountsByOwner",
    params: [
      owner,
      { mint },
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
      },
    ],
  };
}

function tokenAmountFromAccount(account) {
  const info = account?.account?.data?.parsed?.info;
  const amount = info?.tokenAmount;
  if (!amount) return 0;
  const ui = Number(amount.uiAmountString ?? amount.uiAmount);
  if (Number.isFinite(ui)) return ui;
  const raw = Number(amount.amount);
  const decimals = Number(amount.decimals);
  if (!Number.isFinite(raw) || !Number.isFinite(decimals)) return 0;
  return raw / (10 ** decimals);
}

export async function fetchSplTokenBalance({ owner, mint, rpcUrl, fetchImpl = fetch }) {
  if (!owner) throw new Error("missing_wallet");
  if (!mint) throw new Error("missing_mint");
  if (!rpcUrl) throw new Error("missing_rpc_url");
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(jsonRpcBody(owner, mint)),
  });
  if (!response || !response.ok) throw new Error("rpc_http_error");
  const payload = await response.json();
  if (payload?.error) throw new Error("rpc_error");
  const accounts = Array.isArray(payload?.result?.value) ? payload.result.value : [];
  return accounts.reduce((total, account) => total + tokenAmountFromAccount(account), 0);
}

export async function resolveWalletAccess({ owner, env = {}, fetchImpl = fetch }) {
  const config = accessConfig(env);
  const balance = config.tokenAccessConfigured
    ? await fetchSplTokenBalance({
        owner,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        fetchImpl,
      })
    : 0;
  return {
    wallet: owner,
    mintConfigured: Boolean(config.mint),
    tokenAccessConfigured: config.tokenAccessConfigured,
    balance,
    ...resolveAccessFromSignals({ tokenBalance: balance, env }),
    thresholds: config.thresholds,
  };
}
