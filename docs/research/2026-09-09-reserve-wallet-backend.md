# Shielded Reserve wallet backend

Sources checked September 9, 2026. The user confirmed **no Raven fee on Portfolio/Shielded Reserve capital movements**. Ordinary trading fees remain separate. The temporary positive reserve-fee experiment was removed before commit or deployment; its dry research evidence is archived outside the production repository. No fees were collected or funds moved.

## Recommendation

Keep Privy for Raven authentication and existing Solana/EVM wallets. Its current [wallet creation API](https://docs.privy.io/api-reference/wallets/create) offers no Zcash chain type. Changing generic signing vendors does not supply a shielded wallet's scanning, witnesses, proofs and recovery.

For the web product, evaluate **ChainSafe WebZjs** behind Raven's existing wallet abstraction. It is a concrete browser Zcash library using WASM, workers and a gRPC-web lightwallet proxy. Its maintainers explicitly mark it under development and unaudited, so this is a prototype recommendation, not approval for customer funds. GitHub HEAD observed: `a50df944c32243cb8da9f86e7d52cb65ac926439`. [Source](https://github.com/ChainSafe/WebZjs).

For native wallet engineering, evaluate **ZODL** and its SDK stack. The iOS SDK provides Zcash wallet components but is not an embedded wallet service for iPhone Chrome; its current README also marks it experimental/unaudited. Its licensing offers AGPL or a separately negotiated commercial license. Confirm compatibility and support before incorporating it. No vendor outreach or agreement has occurred. [SDK](https://github.com/zodl-inc/zodl-swift-wallet-sdk), [licensing](https://github.com/zodl-inc/zodl-swift-wallet-sdk/blob/main/COMMERCIAL-LICENSE.md).

The underlying [Zcash wallet crates](https://github.com/zcash/librustzcash) provide protocol functionality; [Zaino](https://github.com/zingolabs/zaino) supplies light-client chain data. Neither is a complete account/recovery product. Raven can use sync infrastructure without giving it private spend keys.

## Intended experience

Portfolio → Create Shielded Reserve → secure setup/recovery → Fund, Deploy or Return, using the existing Raven account. Return visits should restore wallet and sync state without a second account or repeated connection ceremony. Providers and chain mechanics belong in advanced evidence. Authentication, recovery and transaction authority remain separate capabilities.

The browser spike must prove actual iPhone Chrome sync, background/resume, historical restore, secure recoverable key storage, device-loss/browser-storage-deletion recovery, current Zcash upgrade support, provider failover and isolation from chart embeds/third-party scripts. A passkey can protect a verified unlock/recovery design; it is not itself a Zcash spend key. Local browser cache alone is not recovery. Raven must not receive private spend keys or default viewing access.

No SDK, customer reserve creation or live execution is added by this evaluation. There is no verified turnkey embedded Zcash backend to promise today. Wallet and settlement/recovery integration remain the work needed for a seamless reserve.
