# RavenOS optional Privy wallets v1

Raven's WorkOS-backed account remains canonical. Privy is an optional embedded-wallet layer and can be disabled without affecting login, Discover, Community, Portfolio, wallet intelligence, Raven Copy, or external wallet connection.

## Flow

1. An authenticated Raven user explicitly selects **Create Raven Wallet** in Account or **Raven Wallet** in the Terminal wallet chooser.
2. Raven issues a five-minute ES256 custom-auth JWT containing only the Raven user ID and `privy_wallet_auth` scope.
3. The Privy browser SDK provisions or restores one Solana and one EVM embedded wallet idempotently.
4. The browser returns a Privy identity token. Raven verifies its signature, issuer, audience, expiry, custom-auth subject, and embedded linked accounts using Privy's app JWKS.
5. Raven binds that Privy DID to the current Raven session user and stores public wallet metadata only.

One EVM address is used across approved EVM networks. Balances and assets remain chain-specific. The Solana address is separate.

## Feature controls

All are default-off and absent from base Wrangler variables:

- `RAVENOS_PRIVY_ENABLED`
- `RAVENOS_PRIVY_WALLETS_ENABLED`
- `RAVENOS_PRIVY_SOLANA_ENABLED`
- `RAVENOS_PRIVY_EVM_ENABLED`
- `RAVENOS_PRIVY_MANUAL_SIGNING_ENABLED`
- `RAVENOS_PRIVY_DELEGATED_SIGNING_ENABLED`
- `RAVENOS_PRIVY_DEFAULT_WALLET_ONBOARDING`
- `RAVENOS_PRIVY_WALLET_USERS` (comma-delimited Raven user IDs; the first canary must not use `*`)

The immutable owner-canary release turns on only `PRIVY_ENABLED`, `PRIVY_WALLETS_ENABLED`, and `PRIVY_EVM_ENABLED`. The owner allowlist remains a server-only binding. Solana provisioning, manual signing, delegated signing, and default onboarding remain off.

Public configuration:

- `RAVENOS_PRIVY_APP_ID`
- `RAVENOS_PRIVY_CLIENT_ID`
- `RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK`
- `RAVENOS_PRIVY_IDENTITY_JWKS`

Secret configuration:

- `RAVENOS_PRIVY_CUSTOM_AUTH_PRIVATE_JWK`

The private JWK must be a server-only Cloudflare Worker secret. The custom-auth public JWK is published at `/api/v1/wallets/privy/jwks` for Privy's ES256 verification and never includes private key material. That public endpoint may be published before wallet activation so Privy can verify the configuration without exposing wallet creation or signing. `RAVENOS_PRIVY_IDENTITY_JWKS` is Privy's bounded app-specific identity-token verification set; retaining every currently published key by `kid` allows provider key rotation without accepting an unknown signer or making a provider network call during Raven verification.

Wallet provisioning also requires the authenticated Raven user to match `RAVENOS_PRIVY_WALLET_USERS`. The initial acceptance run is owner-only; a public wildcard is a separate activation decision after wallet creation, logout isolation, recovery, signing, fee binding, and receipt reconciliation have been exercised.

The Terminal consumes Privy's EIP-1193 provider through the same provider-neutral wallet boundary used by external wallets. Raven's existing 0x transaction review remains authoritative: the server owns the fee and recipient, the short-lived ticket binds the exact reviewed transaction, and Privy only receives that verified transaction after the user selects the final action. `RAVENOS_PRIVY_MANUAL_SIGNING_ENABLED` independently blocks embedded-wallet signatures even when wallet provisioning is enabled. Delegated signing and default onboarding remain false.

The Account CSP permits only Privy's documented secure iframe and API/RPC origins needed by embedded wallets: `https://auth.privy.io` and `https://*.rpc.privy.systems`. Raven does not add third-party script origins or broad wildcard frame access.

## Current milestone boundary

Implemented: opt-in UI, custom-auth token, public JWKS bootstrap, rotation-safe Privy identity verification, browser SDK boundary, dual-wallet provisioning, durable public-metadata association, account isolation, idempotency, usage ledger, external-wallet coexistence, and a Terminal EVM provider seam that reuses Raven's fee-bound 0x execution review.

Dashboard JWT configuration and identity-token return are now saved and reload-verified. The next owner-only acceptance step is an authenticated EVM wallet creation/link with no signature or value movement. Not yet claimed: a safe EVM signature/submission, Robinhood Chain compatibility, Solana signing, withdrawal/export, or funded Terminal trade. Solana stays disabled until Raven's Jupiter fee account is configured and independently verified.


## September 6, 2026: wallet choice and iPhone connection repair

Privy JWT authentication must allow the client-side environment because Raven's
browser SDK calls custom-auth directly. Server-side support remains enabled. The
app's existing issuer, audience, public JWKS, identity-token verification, and
explicit Raven user allowlist are unchanged. The owner confirmed creation of the
EVM wallet from iPhone Chrome after this dashboard correction.

Account now offers Solana, EVM, or both, bounded by the server's provisioning
capabilities. A linked EVM wallet no longer hides the control to add Solana.
Creation only occurs on an explicit click. The current owner allowlist can create
both ecosystems; manual and delegated embedded-wallet signing remain disabled.
Solana trade activation remains separately blocked pending its execution release.
A provisioning failure may be retried against the same provider wallet identity.

For external wallets without an injected provider, Account offers official
Phantom/Solflare/MetaMask wallet-browser links. This opens Raven inside the wallet
app; it does not establish a WalletConnect session back in Chrome or Safari.
Users may need to sign in again there, then connect. Links exclude authentication
parameters, fragments, and private account state. Existing injected-provider
connections remain read-only and tab-local. Terminal shares the same URL helper
and loads Privy via its immutable packaged dependency.

### Funding model

Wallet ecosystem and payment asset are independent choices. Terminal's existing
Auto setting resolves to same-chain canonical USDC; native-asset payment is an
explicit alternative where the existing route supports it. EVM sell settlement
continues to use its supported USDC path. Creating both wallets does not combine
balances, bridge funds, or reserve trading authority.

Cross-chain USDC funding should use the existing verified bridge-quote model:
source wallet/network, destination network, canonical asset, fees, arrival
estimate, and explicit confirmation. Funds must arrive and the trade must be
re-quoted before execution. The current quote/shadow infrastructure is not a live
bridge launch. Hyperliquid keeps its separate deposit and margin workflow.
