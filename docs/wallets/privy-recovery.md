# Privy wallet recovery and user control

Status: implementation spike; production disabled; no funded-wallet test completed.

RavenOS keeps its existing account and session system. Privy is an optional wallet provider attached to a Raven user. Raven stores the Privy user identifier, embedded-wallet identifiers, public addresses, and audit metrics. Raven does not store private keys, seed phrases, recovery material, or Privy authorization tokens.

## What current Privy documentation supports

Privy documents export for user-owned embedded wallets and an external recovery route intended to remain available when an application frontend is unavailable. The exact recovery experience depends on the wallet ownership and recovery configuration selected in the Privy dashboard. EVM and Solana support must each be exercised against Raven's final dashboard configuration before RavenOS presents either path as verified.

## Raven product requirements

- A subscription lapse must never block withdrawal or export.
- Withdrawal is a user-authorized wallet action, not a Portfolio Governor approval.
- Raven logout must remove the wallet surface and terminate the local Privy session.
- Raven must never describe recovery, export, or self-custody more strongly than the configuration actually tested.
- A funded production wallet is not permitted until recovery and withdrawal are exercised in staging.

## Unverified in this milestone

- EVM key export in Raven's selected ownership mode.
- Solana key export in Raven's selected ownership mode.
- External recovery with the Raven frontend unavailable.
- Withdrawal from both wallets in a safe test environment.
- Mobile Safari recovery and export.

Until these tests pass, the Raven Wallet UI exposes addresses only. Fund, withdraw, export, recovery, manual signing, and delegated signing remain unavailable.

## Acceptance evidence still required

Record the Privy app configuration, wallet ownership mode, recovery method, test user, wallet ecosystem, date, device/browser, result, and a redacted Privy receipt. Never record export material or authorization tokens.
