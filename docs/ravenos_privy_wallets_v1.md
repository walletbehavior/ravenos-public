# RavenOS optional Privy wallets v1

Raven's WorkOS-backed account remains canonical. Privy is an optional embedded-wallet layer and can be disabled without affecting login, Discover, Community, Portfolio, wallet intelligence, Raven Copy, or external wallet connection.

## Flow

1. An authenticated Raven user explicitly selects **Create Raven Wallet**.
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

Public configuration:

- `RAVENOS_PRIVY_APP_ID`
- `RAVENOS_PRIVY_CLIENT_ID`
- `RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK`
- `RAVENOS_PRIVY_IDENTITY_PUBLIC_JWK`

Secret configuration:

- `RAVENOS_PRIVY_CUSTOM_AUTH_PRIVATE_JWK`

The private JWK must be a server-only Cloudflare Worker secret. The custom-auth public JWK must match the key registered for Raven custom authentication in Privy. `RAVENOS_PRIVY_IDENTITY_PUBLIC_JWK` is Privy's app-specific identity-token verification key; keeping it in configuration removes a provider network call from Raven's verification path. Manual signing, delegated signing, and default onboarding remain false for this milestone regardless of browser behavior.

The Account CSP permits only Privy's documented secure iframe and API/RPC origins needed by embedded wallets: `https://auth.privy.io` and `https://*.rpc.privy.systems`. Raven does not add third-party script origins or broad wildcard frame access.

## Current milestone boundary

Implemented: opt-in UI, custom-auth token, browser SDK boundary, dual-wallet provisioning, identity-token verification, durable public-metadata association, account isolation, idempotency, usage ledger, and external-wallet coexistence.

Not yet claimed: a dashboard-configured end-to-end wallet creation, safe Solana/EVM signing, Robinhood Chain signing, withdrawal/export, or Terminal integration. Those require the separate controlled staging acceptance run.
