# Single-action spot execution — September 8, 2026

## Product behavior

The native spot ticket estimates output, minimum receive, slippage and price impact as the amount changes. One explicit Buy or Sell action connects the selected wallet if needed, refreshes stale evidence, obtains an exact EVM token allowance where required, prepares the transaction, checks it against the last displayed minimum, hands it to the user's signer, submits once, and checks the receipt. There are no separate Raven Prepare, Review route or Confirm buttons in this flow. Route details remain available in a collapsed section.

Typing, accepting terms, connecting a wallet and background quote refreshes cannot sign or submit. External wallet prompts remain controlled by the wallet. Embedded wallet signing is enabled for this explicit manual action; default onboarding and delegated trading stay disabled.

The existing enabled Solana, Robinhood, Base, Ethereum and BNB spot lanes use this flow. Hyperliquid is unchanged. SOL/ETH/native units and each lane's existing USDC/USDG funding options remain explicit; Auto does not invent cross-chain buying power or bridge a balance automatically.

## Execution corrections

- The Solana contract accepts the terminal's `selected_token` buy settlement and `sell_percentage` sell input, fixing `settlement kind invalid`.
- Native SOL routes use the correct Jupiter v2 referral SOL token account. Canonical USDC routes use the existing USDC account. Other referral token accounts do not broaden the admitted fee policy automatically.
- Standard, paid Pro and trial Pro all retain 100 bps. The decoded Jupiter instruction, fee account, amount and simulated collector credit must match. Output-denominated fee checks separate wallet token-account rent and network cost from proceeds.
- Token-2022 mints with only metadata pointer/token metadata extensions are supported. The selected mint's actual program is bound to the route. The complete token-account extension tail is checked; ordinary accounts and ImmutableOwner are admitted. Transfer fees, hooks, permanent delegates, confidential transfers, non-transferable and unknown extensions remain unsupported. See [Solana metadata documentation](https://solana.com/docs/tokens/extensions/metadata) and the [official Token-2022 layout](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/mod.rs).
- The Privy Solana signer adapts the installed SDK's request interface while preserving public-address access without signing.
- EVM approvals use the exact token, chain, connected wallet, trusted 0x AllowanceHolder and requested amount. They do not grant an unlimited allowance. A confirmed allowance triggers a fresh quote before the swap.
- Repeated clicks, Enter and in-flight changes cannot produce a duplicate submission. An unresolved submission is checked through an authenticated, owner-bound status endpoint; polling never resubmits. The in-browser lock is not persisted across a full page reload; server tickets remain single use.
- Solana signing tickets allow up to 45 seconds by default, bounded by provider expiry and a 60-second ceiling. EVM expiry rules are unchanged. The actual transaction must still meet the displayed minimum.

## Mainnet evidence — no signed transaction

The production referral identity and both SOL/USDC token accounts were verified on-chain after the owner created the accounts. Read-only Jupiter orders for a 0.02 SOL purchase of OTC (`MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump`) using the owner's existing public Raven wallet passed independent mainnet simulation for both Standard and Pro:

- Correct input/output mints, one user signer and reviewed programs.
- 100 bps in the decoded `route_v2` instruction; no positive-slippage surcharge.
- Simulated credit of 200,000 lamports to `E3Sgifvj4gDQZxHA6vezC7ej5wBrXsky7vW6k73cgDhX` on a 20,000,000-lamport input.
- Verified Token-2022 receipt and no safety blockers.

An additional Standard run obtained a real OTC → canonical USDC exit quote and produced the final unsigned ticket in `awaiting_wallet_signature`. The subsequent repeated Pro exit quote hit the public endpoint's HTTP 429 limit; the prior Pro route and fee simulation had passed. These diagnostics used Jupiter's public keyless read endpoints; production credential requirements were not relaxed. No signature, submission, completed fill or balance change is claimed.

## Accounting and operational limits

Fee receipts remain separate from cashback. Confirmed SOL-denominated fees retain their exact lamport amount and require evidenced USDC valuation before a USDC reward can become available; this change does not mark an unvalued SOL fee as USDC. Existing subscriptions, referrals, rewards ledgers and Hyperliquid economics are preserved.

The live feature gates, existing notional limits, wallet ownership checks, exact-market verification, current route checks and receipt reconciliation remain in force. No database migration is required. A small owner-executed buy and sell is still required to establish live fill evidence after deployment; automated tests use fixture signers only.

## Validation

Coverage includes automatic quote refresh, one-action Solana buy/sell, all four EVM lanes, exact allowance flow, stale quote minimums, duplicate clicks, unresolved submissions, wrong wallet/chain, fee-account binding, native fee accounting, Token-2022 extension admission, account isolation and release signing flags. The release is staged and preview-verified before promotion. The release receipt records the deployed source commit and Worker version.

The full contract pipeline passed 1,641 checks across its suites; all 99 selected terminal/browser regressions passed. Build, security-architecture validation and the public-data-leak checks passed. A sandbox-only loopback restriction on the first contract attempt was resolved by running the local-server tests with loopback access; no product assertion was waived.
