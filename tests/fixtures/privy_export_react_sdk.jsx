import { useEffect } from 'react';
export const PrivyProvider = ({children}) => children;
export const usePrivy = () => ({ready:true,authenticated:true,user:globalThis.__EXPORT_USER__});
export function useSubscribeToJwtAuthWithFlag({getExternalJwt}) {useEffect(()=>{getExternalJwt().then(token=>{globalThis.__EXPORT_SESSION_READY__=Boolean(token);});},[getExternalJwt]);}
export const useExportWallet = () => ({exportWallet:async({address})=>{globalThis.__EXPORT_CALLS__.push({ecosystem:'evm',address});}});
