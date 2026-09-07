// Wallet-app handoffs carry public navigation only, never authentication state.
export function walletHandoffTarget(current = globalThis.location?.href) {
  const fallback = new URL("https://app.ravenos.xyz/account/");
  let source;
  try { source = new URL(current); } catch { return fallback; }
  if (!["https://app.ravenos.xyz", "https://ravenos.xyz"].includes(source.origin)) return fallback;
  if (!/^\/terminal\/(?:[a-zA-Z0-9_-]+\/)*$/.test(source.pathname)) return fallback;
  const target = new URL(source.pathname, source.origin);
  for (const key of ["chain", "asset", "instrument_id", "market", "venue", "symbol"]) {
    const value = source.searchParams.get(key);
    if (value && /^[a-zA-Z0-9_:.-]{1,160}$/.test(value)) target.searchParams.set(key, value);
  }
  return target;
}

export function walletLaunchHref(wallet, chainType, current = globalThis.location?.href) {
  const target = walletHandoffTarget(current);
  const encoded = encodeURIComponent(target.href);
  const ref = encodeURIComponent(target.origin);
  if (wallet === "Phantom") return `https://phantom.app/ul/browse/${encoded}?ref=${ref}`;
  if (chainType === "solana") {
    if (wallet === "Solflare") return `https://solflare.com/ul/v1/browse/${encoded}?ref=${ref}`;
    if (wallet === "Backpack") return "https://backpack.app/";
    if (wallet === "Glow") return "https://glow.app/";
    return null;
  }
  if (wallet === "MetaMask") return `https://metamask.app.link/dapp/${target.host}${target.pathname}${target.search}`;
  if (wallet === "Coinbase Wallet") return `https://go.cb-w.com/dapp?cb_url=${encoded}`;
  if (wallet === "Trust Wallet") return `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`;
  if (wallet === "Rabby") return "https://rabby.io/";
  if (wallet === "Rainbow") return "https://rainbow.me/";
  return null;
}
