export function verifiedExportWallet(user, wallet) {
  if (!wallet || !['evm', 'solana'].includes(wallet.ecosystem)) return false;
  const address = String(wallet.address || '');
  if (!(wallet.ecosystem === 'evm' ? /^0x[0-9a-fA-F]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/).test(address)) return false;
  return (user?.linkedAccounts || []).some(account => account.type === 'wallet'
    && ['privy', 'privy-v2'].includes(account.walletClientType)
    && account.chainType === (wallet.ecosystem === 'evm' ? 'ethereum' : 'solana')
    && (wallet.ecosystem === 'evm' ? String(account.address).toLowerCase() === address.toLowerCase() : account.address === address));
}
