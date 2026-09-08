# Shielded Reserve: usable route comparison, transfers still unavailable

Raven's deployed Shielded Reserve remains a Pro route preview. Wallet connection, shielded balance discovery, shielding, live deployment/return/send, receipt verification and refund recovery are not implemented. This release does not claim those capabilities. The Portfolio connection label now says **Not integrated yet** rather than suggesting that a supported wallet can be connected.

## Shipped in this change

Portfolio → Capital helper → **Compare direct vs reserve routes** compares a direct canonical-USDC route with a return to ZEC followed by deployment. It supports supported catalog entries for Solana, Base, Arbitrum, Ethereum and Avalanche. Robinhood and Hyperliquid venue funding are not included in this same-asset comparison. Existing individual Hyperliquid previews remain separate.

Both alternatives start with the identical source atomic amount. The second reserve leg spends the first leg's exact expected ZEC output, without revaluing through USD. Source USDC prices come from the provider; the code does not assume a $1 peg. Each leg retains its signature verification, timestamp, asset identity, fee information, evidence hash and privacy facts. The combined comparison has its own hash and expires at the earliest leg expiry. Integer arithmetic is used for amounts and combined marked friction.

There is no locked round-trip quote, guaranteed combined minimum, automatic wallet funding or reduced-linkage promise. The provider-time sum excludes unknown wallet spendability waits. ZEC value can move between legs. Native execution fees, Pro cashback, rewards, subscriptions, affiliates and Copy economics are untouched.

The existing Pro/trial, session, CSRF, bounded-body and master/per-action flag checks protect the comparison endpoint. Only fixed assets and public research addresses are allowed. Two comparisons per user per minute, plus the existing overall preview limit; matching comparisons share a request and cache for at most 25 seconds. At most three provider dry quotes per comparison. Missing evidence, failures, expired legs or unsupported routes produce an unavailable result. No partial success is sold as a complete route. The client drops late responses when inputs change. No account address, planner balance, viewing key, spend key or analytics event is sent to the provider.

## Fresh read-only measurements

September 8, 2026, Base USDC → Solana USDC. Each result passed provider signature verification. These estimates are a sample, not settlement tests or guaranteed prices.

| USD-equivalent input | Direct receive (USDC) | Via ZEC receive (USDC) | Direct marked friction | Via ZEC marked friction |
|---|---:|---:|---:|---:|
| $25 | 24.705708 | 24.298870 | 1.1958% | 2.8228% |
| $500 | 499.324520 | 498.219184 | 0.1539% | 0.3749% |
| $5,000 | 4,995.484977 | 4,974.954620 | 0.1091% | 0.5197% |

Direct provider estimate: 32 seconds. Via ZEC: 150 + 452 = 602 seconds, plus an unknown wallet wait. All nine underlying quotes succeeded. These are marked-value differences, not independently itemized network, solver or FX fees. The append-only, hash-linked operator dataset is `outputs/shielded-gap-proof-2026-09-08/comparisons.jsonl`. Reproduce with `node scripts/validate-shielded-comparison-shadow.mjs <output-directory>`; no credentials or customer addresses are accepted.

Current [NEAR quote documentation](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) confirms that `dry: true` creates neither a deposit address nor an initiated swap. The provider's [bridge documentation](https://docs.near-intents.org/integration/bridging/overview) and [Privy chain support](https://docs.privy.io/wallets/overview/chains) were also checked. A successful quote does not establish an integrated Zcash signer, shielded receipt or trustless end-to-end route.

## What still blocks a real reserve

1. **User-controlled Zcash wallet adapter:** supported external wallet transport, receiver composition, recovery semantics and proof of user control. No Privy Zcash support is assumed. No Raven-held spend keys or viewing-key import.
2. **Settlement and recovery:** authenticated route records linked to source and destination evidence, idempotent transitions through in-transit/unresolved states, confirmation policy, exact shielded-receipt proof and refund reconciliation. The existing shadow Portfolio compartments are a foundation, not live accounting.
3. **Provider integration agreement:** confirmed shielded recipient/refund support, commercial fees, limits, failure handling and bridge assumptions. No production reserve fee is selected.
4. **Security and counsel review:** the existing open review items remain open. Route preview approval does not authorize wallet signing or live payments.
5. **Explicitly authorized tiny canaries:** deployment, return and failure/refund recovery using the selected external wallet, after implementation and review. None has been performed.

Recommendation remains a user-controlled reserve beta after these steps. The current product should be described as **Shielded Reserve route planning**, not live shielding. No further action from the user is needed for this preview release; changing a feature flag would not complete the missing money path.

## Validation

Baseline: 101 targeted tests passed. Added comparison tests cover precise chained amounts, off-peg pricing, identity restrictions, feature flags, failed legs, expiry, evidence mismatch, session/CSRF/Pro checks, rate limits, shared caching and secret rejection. Browser coverage checks both layouts, input races, errors and expiry, plus the funded-wallet display. Full regression and release receipts are recorded in the operator release report. No database migration.
