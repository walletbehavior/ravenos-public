# Shielded Reserve in the Portfolio capital helper

Raven Pro and active no-card Pro trials can now open `/portfolio/#shielded-reserve` on the authenticated app. The public Portfolio points to this workspace; Account links to it directly. Hyperliquid positions and risk remain below the capital helper.

## What the customer can do

- Preview Deploy, Return and fixed-output Send routes using current, signature-verified NEAR 1Click dry quotes. Exact canonical asset identities are allowlisted. Amount input is USD equivalent, including Send; it is not an exact USDC face amount when USDC trades off $1.
- Inspect minimum receive, provider settlement estimate, marked friction, provider-injected fees, currentness and conditional refund/bridge assumptions. No production Raven reserve fee is chosen; native trade fees and cashback are unchanged.
- Inspect facts about public legs, provider/solver visibility and amount/timing correlation. End-to-end privacy remains UNKNOWN until an actual shielded spend/receipt is proved. No anonymity claim is made.
- Calculate a local hypothetical capital allocation with integer zatoshis and micro-USD/USDC. ZEC price changes alter reserve value; reserve capital never satisfies immediate Copy buying power. An excess can populate a Return preview form after an explicit click, without requesting a route or moving funds automatically.

The shielded balance is **Not connected**, not a fabricated zero. There is no Zcash signer or connection, no key/viewing-key import, no custody, no transfer, no treasury service, no bridge initiation, no automatic Copy funding and no Community export.

## Fresh provider evidence

September 7, 2026 follow-up exercised the customer route adapter against the live anonymous provider, with operator-injected access only (no fabricated customer session):

| $500 USD-equivalent request | Expected receive | Marked friction | Provider time |
|---|---:|---:|---:|
| ZEC → Solana USDC | 498.483853 USDC | 0.3131% | 452 seconds |
| Solana USDC → ZEC | 0.42143039 ZEC | 0.0796% | 135 seconds |
| Fixed-output Send → Solana USDC | 500.050006 USDC | 1.2818% | 452 seconds |

All three responses passed provider signature verification. Values are a timestamped snapshot, not an offer or settlement-success test. Full records are in the operator workspace `outputs/RavenOS-shielded-customer-provider-proof.json`. Earlier 121-row matrix and standard-versus-two-leg economics remain in [the research report](../research/raven-shielded-reserve-spike.md).

[Current provider API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) confirms `dry: true` avoids an executable deposit address. [Bridge documentation](https://docs.near-intents.org/integration/bridging/overview) and [wallet spendability policy](https://support.zodl.com/article/35-when-are-funds-spendable) were rechecked. Provider time is not an end-to-end promise; an external wallet can add spendability waits.

## Access, privacy and cost controls

Existing Raven sessions, CSRF validation, Pro access and D1 user rate limits are reused. Eight preview/catalog requests per user per minute, including cache hits. Supported catalog is reused for 60 seconds, equal public quotes are coalesced and reused up to 25 seconds, and stale prices fail closed. Provider request fields and origins are fixed. Input is capped at 1 KiB while streaming, USD input at $1–$50,000. Secrets, addresses, arbitrary assets/providers and query-string inputs are rejected. No customer addresses, balances or planner inputs go to the provider. The provider sees Raven server IP and quote amounts/timing. No application logs contain quote bodies or scenarios.

No schema migration, reward primitive, fee ledger or wallet system added. Feature flags can disable all preview access; `LIVE_SHIELDED_EXECUTION_ENABLED` is hard false regardless of environment. Current internal legal/privacy inventory is updated. No effective legal-document content/hash changed in this release.

## Verification

Baseline 43 tests passed before this work. New route/planner tests cover server Pro enforcement, CSRF policy, all action flags, real-money refusal, input secrecy, bounded streaming, cache/single-flight/expiry, provider failures and precision. Browser tests cover desktop/mobile layout, local-only scenarios, excess handoff, late-response races, Standard/signed-out gating and expired previews. The full `test:contracts` command passed 1,392 checks across its suites (including 55 Shielded Reserve checks); 18 Portfolio/mobile and wallet browser checks passed. Existing Portfolio, fees, rewards, billing, identity, Copy and security regressions remain required by `test:contracts`.

The secure beta path is still external user-controlled wallet discovery, recovery verification, audited signer/receiver semantics, small explicitly authorized forward/reverse/refund canaries, reconciliation and counsel review. None of those unfinished steps is implied by making the preview discoverable.
