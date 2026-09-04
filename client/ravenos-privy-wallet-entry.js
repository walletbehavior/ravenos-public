import Privy, {
  LocalStorage,
  getEntropyDetailsFromUser,
  getUserEmbeddedEthereumWallet,
  getUserEmbeddedSolanaWallet,
} from "@privy-io/js-sdk-core";

function requireConfig(value) {
  const appId = String(value?.appId || "").trim();
  const clientId = String(value?.clientId || "").trim();
  if (!/^cm[a-z0-9]{12,}$/i.test(appId)) throw new Error("privy_app_id_invalid");
  if (!clientId) throw new Error("privy_client_id_required");
  return { appId, clientId };
}

function walletView(user) {
  const evm = getUserEmbeddedEthereumWallet(user);
  const solana = getUserEmbeddedSolanaWallet(user);
  return {
    evm: evm ? { ecosystem: "evm", address: String(evm.address), providerWalletId: evm.id || null } : null,
    solana: solana ? { ecosystem: "solana", address: String(solana.address), providerWalletId: solana.id || null } : null,
  };
}

function unwrapUser(result) {
  return result?.user || result || null;
}

export function createRavenPrivyWalletClient(options) {
  const cfg = requireConfig(options);
  const privy = new Privy({ appId: cfg.appId, clientId: cfg.clientId, storage: new LocalStorage() });
  let iframe = null;
  let iframeOrigin = "";
  let listener = null;
  let initialized = false;
  let user = null;

  async function initialize() {
    if (initialized) return;
    await privy.initialize();
    const iframeUrl = new URL(privy.embeddedWallet.getURL());
    if (iframeUrl.protocol !== "https:") throw new Error("privy_secure_context_invalid");
    iframeOrigin = iframeUrl.origin;
    iframe = document.createElement("iframe");
    iframe.src = iframeUrl.toString();
    iframe.hidden = true;
    iframe.tabIndex = -1;
    iframe.title = "Privy secure wallet context";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    privy.setMessagePoster(iframe.contentWindow);
    listener = (event) => {
      if (event.source !== iframe.contentWindow || event.origin !== iframeOrigin) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        privy.embeddedWallet.onMessage(data);
      } catch {
        // Malformed cross-window messages are untrusted and ignored.
      }
    };
    window.addEventListener("message", listener);
    user = unwrapUser(await privy.user.get());
    initialized = true;
  }

  async function sync(walletAuthToken) {
    await initialize();
    const token = String(walletAuthToken || "");
    if (token.split(".").length !== 3) throw new Error("privy_wallet_auth_token_invalid");
    user = unwrapUser(await privy.auth.customProvider.syncWithToken(token, {
      embedded: {
        ethereum: { createOnLogin: "off" },
        solana: { createOnLogin: "off" },
      },
    }));
    return walletView(user);
  }

  async function provision({ evm = true, solana = true } = {}) {
    if (!user) throw new Error("privy_user_required");
    let wallets = walletView(user);
    if (solana && !wallets.solana) {
      user = unwrapUser(await privy.embeddedWallet.createSolana({
        ethereumAccount: getUserEmbeddedEthereumWallet(user) || undefined,
        idempotencyKey: `ravenos:${user.id}:solana:v1`,
      }));
      wallets = walletView(user);
    }
    if (evm && !wallets.evm) {
      user = unwrapUser(await privy.embeddedWallet.create({
        solanaAccount: getUserEmbeddedSolanaWallet(user) || undefined,
        idempotencyKey: `ravenos:${user.id}:evm:v1`,
      }));
      wallets = walletView(user);
    }
    return wallets;
  }

  async function identityToken() {
    if (!user) throw new Error("privy_user_required");
    const token = await privy.getIdentityToken();
    if (!token) throw new Error("privy_identity_token_unavailable");
    return token;
  }

  async function providers() {
    if (!user) throw new Error("privy_user_required");
    const entropy = getEntropyDetailsFromUser(user);
    const evmWallet = getUserEmbeddedEthereumWallet(user);
    const solanaWallet = getUserEmbeddedSolanaWallet(user);
    return {
      evm: evmWallet ? await privy.embeddedWallet.getEthereumProvider({ wallet: evmWallet, ...entropy }) : null,
      solana: solanaWallet ? await privy.embeddedWallet.getSolanaProvider(solanaWallet, entropy.entropyId, entropy.entropyIdVerifier) : null,
    };
  }

  async function logout() {
    try {
      if (user?.id) await privy.auth.logout({ userId: user.id });
    } finally {
      user = null;
      if (listener) window.removeEventListener("message", listener);
      iframe?.remove();
      iframe = null;
      listener = null;
      initialized = false;
    }
  }

  return Object.freeze({ initialize, sync, provision, identityToken, providers, logout });
}

export const RavenPrivyWalletBoundary = Object.freeze({
  schemaVersion: "ravenos.privy_browser_wallet.v1",
  ravenIdentityIsCanonical: true,
  manualConfirmationRequired: true,
  delegatedSigningEnabled: false,
  privateMaterialStoredByRaven: false,
});

globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__ = Object.freeze({
  create: createRavenPrivyWalletClient,
  boundary: RavenPrivyWalletBoundary,
});
