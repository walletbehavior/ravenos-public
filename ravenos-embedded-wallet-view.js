// Authenticated Raven wallet records already establish address ownership.
// Opening an account view needs no signing session, recovery, or wallet creation.
export function createEmbeddedWalletView(wallet) {
  const ecosystem = wallet?.ecosystem;
  const address = String(wallet?.address || "");
  if (ecosystem === "evm" ? !/^0x[a-fA-F0-9]{40}$/.test(address)
    : ecosystem === "solana" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : true) throw new Error("embedded_wallet_address_invalid");
  const denied = async () => { const error = new Error("This wallet connection is read-only. Trading activation is separate."); error.code = 4100; throw error; };
  const listeners = new Map();
  return Object.freeze({
    ravenWalletViewOnly: true,
    publicKey: ecosystem === "solana" ? Object.freeze({ toString: () => address }) : undefined,
    connect: async () => ({ publicKey: address }),
    request: async ({ method }) => {
      if (ecosystem === "evm" && ["eth_accounts", "eth_requestAccounts"].includes(method)) return [address];
      return denied();
    },
    signTransaction: denied, signAllTransactions: denied, signMessage: denied,
    signAndSendTransaction: denied,
    on(event, fn) { const callbacks = listeners.get(event) || new Set(); callbacks.add(fn); listeners.set(event, callbacks); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    disconnect: async () => { for (const fn of listeners.get("disconnect") || []) fn(); listeners.clear(); },
  });
}
