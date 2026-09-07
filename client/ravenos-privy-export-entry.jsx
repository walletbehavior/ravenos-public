import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useExportWallet as useEvmExport, useSubscribeToJwtAuthWithFlag } from '@privy-io/react-auth';
import { useExportWallet as useSolanaExport } from '@privy-io/react-auth/solana';
import { verifiedExportWallet } from './wallet-export-policy.mjs';

function ExportPanel({ wallet, getExternalJwt, close }) {
  const { ready, authenticated, user } = usePrivy();
  const { exportWallet: exportEvm } = useEvmExport();
  const { exportWallet: exportSolana } = useSolanaExport();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const panel = useRef(null);
  useSubscribeToJwtAuthWithFlag({ isAuthenticated: true, isLoading: false, enabled: !failed, getExternalJwt, onError: () => setFailed(true) });
  const verified = !failed && ready && authenticated && verifiedExportWallet(user, wallet);
  useEffect(() => { panel.current?.querySelector('button')?.focus(); }, []);
  useEffect(() => {
    if (verified || failed) return;
    const timeout = setTimeout(() => setFailed(true), 30000);
    return () => clearTimeout(timeout);
  }, [verified, failed]);
  async function exportSelected() {
    if (!verified || busy) return;
    setBusy(true);
    try {
      // The SDK renders the key in its cross-origin iframe. Never retrieve,
      // serialize, log, store or copy a private key in Raven's own context.
      await (wallet.ecosystem === 'solana' ? exportSolana : exportEvm)({ address: wallet.address });
      close();
    } catch { setBusy(false); setFailed(true); }
  }
  function keydown(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="raven-wallet-export-overlay" style={{ display: busy ? 'none' : undefined }} onKeyDown={keydown}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="ravenExportTitle" className="raven-wallet-export-dialog">
      <header><h2 id="ravenExportTitle">Export your {wallet.ecosystem === 'solana' ? 'Solana' : 'EVM'} wallet</h2><button onClick={close}>Close</button></header>
      <code>{wallet.address}</code>
      <p>Privy will show your private key in its secure export window. Raven cannot read it.</p>
      <p>Anyone with this key can control the wallet. Save it privately or import it into a wallet you trust. Never send it to support or put it in a screenshot.</p>
      <p role="status">{verified ? 'Your selected wallet is verified.' : failed ? 'We could not verify this wallet session. Close and try again.' : 'Verifying your wallet…'}</p>
      <button className="raven-wallet-export-confirm" disabled={!verified} onClick={exportSelected}>Open secure export</button>
    </section>
  </div>;
}
let active = false;
export function openSecureWalletExport({ appId, clientId, wallet, getExternalJwt }) {
  if (active) return;
  if (!appId || !wallet || typeof getExternalJwt !== 'function') throw Error('wallet_export_unavailable');
  active = true;
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  function close() { root.unmount(); host.remove(); active = false; if (previousFocus?.isConnected) previousFocus.focus(); }
  root.render(<PrivyProvider appId={appId} clientId={clientId || undefined} config={{
    appearance: { theme: 'dark', walletList: [] },
    externalWallets: { disableAllExternalWallets: true, walletConnect: { enabled: false } },
    embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
    legal: { termsAndConditionsUrl: 'https://ravenos.xyz/terms/', privacyPolicyUrl: 'https://ravenos.xyz/privacy/' },
  }}><ExportPanel wallet={wallet} getExternalJwt={getExternalJwt} close={close} /></PrivyProvider>);
}
