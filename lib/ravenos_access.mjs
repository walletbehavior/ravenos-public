const DEFAULT_PRO_THRESHOLD = 1_000_000;
const DEFAULT_FOUNDER_THRESHOLD = 10_000_000;

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

export function accessThresholds(env = {}) {
  const pro = numericEnv(
    env,
    "RAVENOS_ACCESS_PRO_THRESHOLD",
    numericEnv(env, "RAVENOS_ACCESS_PRO_TOKENS", DEFAULT_PRO_THRESHOLD),
  );
  const founder = numericEnv(
    env,
    "RAVENOS_ACCESS_FOUNDER_THRESHOLD",
    numericEnv(env, "RAVENOS_ACCESS_FOUNDER_TOKENS", DEFAULT_FOUNDER_THRESHOLD),
  );
  return { pro, founder };
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

export function resolveAccessFromSignals({ tokenBalance = 0, stripeStatus = "", stripeActive = false, env = {} } = {}) {
  const balance = Number(tokenBalance);
  const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const thresholds = accessThresholds(env);
  const subscriptionActive = Boolean(stripeActive) || stripeSubscriptionActive(stripeStatus);
  if (safeBalance >= thresholds.founder) {
    return { tier: "founder", reason: "Founder", balance: safeBalance, thresholds, stripeSubscriptionActive: subscriptionActive };
  }
  if (subscriptionActive) {
    return { tier: "pro", reason: "Subscription", balance: safeBalance, thresholds, stripeSubscriptionActive: true };
  }
  if (safeBalance >= thresholds.pro) {
    return { tier: "pro", reason: "Token Holder", balance: safeBalance, thresholds, stripeSubscriptionActive: false };
  }
  return { tier: "free", reason: "Free", balance: safeBalance, thresholds, stripeSubscriptionActive: false };
}

export function accessConfig(env = {}) {
  return {
    mint: textEnv(env, ["RAVENOS_ACCESS_TOKEN_MINT", "RAVENOS_TOKEN_GATE_MINT"]),
    rpcUrl: textEnv(env, ["RAVENOS_SOLANA_RPC_URL", "SOLANA_RPC_URL", "SOLANA_ALCHEMY_RPC_URL"]),
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
  const balance = await fetchSplTokenBalance({
    owner,
    mint: config.mint,
    rpcUrl: config.rpcUrl,
    fetchImpl,
  });
  return {
    wallet: owner,
    mintConfigured: Boolean(config.mint),
    balance,
    ...resolveAccessFromSignals({ tokenBalance: balance, env }),
    thresholds: config.thresholds,
  };
}
