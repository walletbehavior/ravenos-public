import { createWalletCapabilitySnapshot } from "./contracts.mjs";

export const WalletCapabilityNames = Object.freeze([
  "connect",
  "disconnect",
  "account_events",
  "network_events",
  "sign_transaction",
  "sign_and_send_transaction",
  "sign_all_transactions",
  "versioned_transactions",
  "mobile_deep_link",
  "embedded_wallet",
  "injected_wallet",
]);

export const SolanaWalletFamilies = Object.freeze(["phantom", "solflare", "unknown"]);

function eventBinder(provider = {}) {
  if (typeof provider.on === "function") return ["on", provider.on.bind(provider)];
  if (typeof provider.addEventListener === "function") return ["addEventListener", provider.addEventListener.bind(provider)];
  return [null, null];
}

function eventUnbinder(provider = {}) {
  if (typeof provider.off === "function") return provider.off.bind(provider);
  if (typeof provider.removeEventListener === "function") return provider.removeEventListener.bind(provider);
  return null;
}

export function privacySafeWalletAddress(address = "") {
  const text = String(address || "").trim();
  if (!text) return "";
  if (text.length <= 10) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function detectWalletFamily(provider = {}) {
  if (provider?.isPhantom) return "phantom";
  if (provider?.isSolflare) return "solflare";
  return "unknown";
}

export function detectSolanaWalletCapabilities(provider = {}) {
  const capabilities = {
    connect: typeof provider.connect === "function",
    disconnect: typeof provider.disconnect === "function",
    account_events: typeof provider.on === "function" || typeof provider.addEventListener === "function",
    network_events: false,
    sign_transaction: typeof provider.signTransaction === "function",
    sign_and_send_transaction: typeof provider.signAndSendTransaction === "function",
    sign_all_transactions: typeof provider.signAllTransactions === "function",
    versioned_transactions: Boolean(provider.supportedTransactionVersions?.has?.(0) || provider.supportsVersionedTransactions || provider.isPhantom),
    mobile_deep_link: Boolean(provider.isMobile || provider.mobile || provider.isPhantomMobile),
    embedded_wallet: Boolean(provider.isEmbedded || provider.embedded || provider.providerType === "embedded"),
    injected_wallet: Boolean(provider.isPhantom || provider.isSolflare || provider.isBackpack || provider.isInjected),
  };

  if (capabilities.embedded_wallet && !capabilities.sign_transaction && capabilities.sign_and_send_transaction) {
    capabilities.versioned_transactions = Boolean(capabilities.versioned_transactions);
  }

  return Object.freeze(capabilities);
}

export function detectAvailableSolanaWallets(scope = globalThis) {
  const out = [];
  const providers = [];
  if (scope?.phantom?.solana) providers.push(scope.phantom.solana);
  if (scope?.solflare) providers.push(scope.solflare);
  if (scope?.solana) providers.push(scope.solana);
  for (const provider of providers) {
    if (!provider || out.some((entry) => entry.provider === provider)) continue;
    out.push({
      family: detectWalletFamily(provider),
      provider,
      capabilities: detectSolanaWalletCapabilities(provider),
    });
  }
  return out;
}

export function unsupportedWalletMethods(capabilities = {}, required = []) {
  return required.filter((name) => !Boolean(capabilities[name]));
}

export function canShowWalletAction(capabilities = {}, action, flags = {}) {
  if (action === "connect") return Boolean(flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE && capabilities.connect);
  if (action === "disconnect") return Boolean(flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE && capabilities.disconnect);
  if (action === "sign") return false;
  if (action === "submit") return false;
  return false;
}

export function createWalletCapabilitySnapshotFromProvider(provider = {}, options = {}) {
  const capabilities = detectSolanaWalletCapabilities(provider);
  const connected = Boolean(options.public_address);
  const unsupportedVersion = Boolean(options.requires_versioned_transactions && !capabilities.versioned_transactions);
  const state = unsupportedVersion
    ? "unsupported_transaction_version"
    : connected
      ? "connected_read_only"
      : capabilities.injected_wallet || capabilities.embedded_wallet
        ? "detected_not_connected"
        : "not_detected";
  return createWalletCapabilitySnapshot({
    state,
    wallet_family: options.wallet_family || detectWalletFamily(provider) || provider.providerType || "unknown",
    wallet_adapter_version: options.wallet_adapter_version || null,
    supported_chain: options.supported_chain || "solana",
    supported_transaction_versions: capabilities.versioned_transactions ? ["legacy", "v0"] : ["legacy"],
    address_lookup_table_support: capabilities.versioned_transactions,
    message_signing_available: typeof provider.signMessage === "function",
    transaction_signing_available: capabilities.sign_transaction,
    connection_state: connected ? "connected" : "disconnected",
    public_address: connected ? String(options.public_address) : null,
    observation_timestamp: options.observation_timestamp || new Date().toISOString(),
    freshness_state: options.freshness_state || "fresh",
    warnings: unsupportedVersion ? ["unsupported_transaction_version"] : [],
  });
}

export async function connectReadOnlySolanaWallet(provider = {}, options = {}) {
  if (typeof provider.connect !== "function") throw new Error("wallet_connect_unavailable");
  const result = await provider.connect(options.connect_options || {});
  const publicAddress = String(
    options.public_address ||
    result?.publicKey?.toBase58?.() ||
    result?.publicKey?.toString?.() ||
    provider.publicKey?.toBase58?.() ||
    provider.publicKey?.toString?.() ||
    "",
  );
  return createWalletCapabilitySnapshotFromProvider(provider, {
    ...options,
    public_address: publicAddress || null,
  });
}

export function bindWalletReadOnlyEvents(provider = {}, handlers = {}) {
  const [, on] = eventBinder(provider);
  const off = eventUnbinder(provider);
  if (!on || !off) return () => {};
  const listeners = [];
  if (typeof handlers.onAccountChange === "function") {
    on("accountChanged", handlers.onAccountChange);
    listeners.push(["accountChanged", handlers.onAccountChange]);
  }
  if (typeof handlers.onDisconnect === "function") {
    on("disconnect", handlers.onDisconnect);
    listeners.push(["disconnect", handlers.onDisconnect]);
  }
  if (typeof handlers.onConnect === "function") {
    on("connect", handlers.onConnect);
    listeners.push(["connect", handlers.onConnect]);
  }
  return () => {
    for (const [event, handler] of listeners) off(event, handler);
  };
}
