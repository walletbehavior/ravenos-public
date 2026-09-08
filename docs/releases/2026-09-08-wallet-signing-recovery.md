# Raven Wallet signing recovery — September 8, 2026

The production Buy button stalled while opening a Raven Wallet. This was a Raven integration failure, unrelated to the user's selected slippage or funding balance.

## Verified causes

1. The deployed Terminal/Discover Content Security Policy omitted Privy's auth endpoint and secure iframe. Account permitted them. The production Terminal header was verified directly; a connection-only attempt with the owner's account reproduced the authentication failure. The wallet already existed and remained accessible from Account.
2. The pinned Privy 0.73.0 SDK references `Buffer` when serializing Solana messages and signatures. Its browser bundle had no implementation for that reference. New browser tests using the actual shipped SDK failed with `Buffer is not defined` in both on-device and user-controlled server wallet modes after the security policy was corrected.

## Change

Terminal and Discover now permit the same specific Privy auth/iframe and wallet RPC origins used by the existing Account integration. Script restrictions, frame-ancestor protection and signing ownership remain in force. A module-local esbuild Buffer injection supplies the SDK's required encoding implementation without adding a global browser object.

Already linked wallets are verified against the authenticated provider identity, then opened without repeating creation and linking. Providers are reused within the tab; concurrent opens for one ecosystem share a promise. Opening is bounded to 25 seconds, with a clear unsent error and no late execution after a timeout. An existing connected wallet starts with routing instead of showing a misleading connection step.

The original single Buy/Sell action, minimum-receive checks, fee verification, account isolation and duplicate-submission guard remain. This release does not change fees, slippage defaults, funds, wallet ownership, delegation or other engine activation.

## Verification boundary

Browser tests now keep the real SDK and production CSP. Provider service responses and signatures are fixtures. Tests cover both wallet modes, repeated Buy with the same provider, timeout without preparation/signing, mobile and desktop, and existing EVM trade paths. The owner-account production check opens the wallet only. No owner trade is signed or broadcast by this diagnostic work, and no live fill is claimed.

See [Privy's vanilla JavaScript integration](https://docs.privy.io/recipes/core-js) for its iframe/provider connection contract. The exact installed SDK is the implementation reference for the encoding correction.
