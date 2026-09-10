// An EVM pool can be a contract address or a 32-byte pool identifier. The
// latter is not a wallet/token address and must never be passed to a signer.
// Callers still validate the chain and cross-check the complete pool identity.
export function normalizeEvmPoolIdentifier(value) {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)
    ? value.toLowerCase() : null;
}
