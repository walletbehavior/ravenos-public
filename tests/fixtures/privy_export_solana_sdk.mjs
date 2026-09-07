export const useExportWallet = () => ({exportWallet:async({address})=>{globalThis.__EXPORT_CALLS__.push({ecosystem:'solana',address});}});
