import bs58 from "bs58";
import nacl from "tweetnacl";

export function walletAuthMessage({ wallet, origin = "" }) {
  return [
    "RavenOS account access",
    `Wallet: ${wallet}`,
    `Origin: ${origin}`,
  ].join("\n");
}

export function verifyWalletSignature({ wallet, message, signature }) {
  if (!wallet || !message || !signature) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(wallet),
    );
  } catch (_) {
    return false;
  }
}
