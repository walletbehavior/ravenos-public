# RavenOS billing, rewards credit, referrals and Solana fee activation

Operator authorization: the user approved deployment, Stripe configuration and the legal package on September 7, 2026. They explicitly instructed that entity/contact fields may remain blank for now. Those fields are shown as unprovided; no entity, address, jurisdiction, or contact was invented. This record is operator approval, not an independent legal opinion.

## Enabled in this release

- Existing 30-day no-card Pro trial and 30% fee cashback continue. Every eligible native trade uses the same 100 bps execution fee; there is no additional Copy surcharge. Hyperliquid remains separate.
- Paid Pro checkout uses the verified live $149 monthly Stripe price. Remaining free trial time is preserved. Account creation and trial expiry do not create a Stripe subscription or charge. The existing less-than-48-hours trial scheduling boundary remains explicit.
- Available rewards can be posted as whole-cent Stripe customer balance credit. Partial and full invoice credits remain distinct from external payment. Opt-in auto-apply is reversible and does not itself start a subscription.
- Referral enrollment requires explicit, hash-bound Affiliate Terms assent. Attribution is persisted through the trial. Commissions are 25% of qualifying external subscription revenue after credits, for 12 calendar months after first qualifying payment; the attribution window is 60 days. Trials, trades, execution fees and cashback generate no affiliate commission. Automated affiliate payouts remain disabled.
- Six approved legal document versions are appended through migration 0037. Historical rows and acceptance records remain intact. Current documents are at `/terms/`, `/privacy/` and `/legal/`; archived drafts remain available. Withdrawal/export/recovery and existing account access do not require fresh trading assent.
- Solana routes validate the actual Jupiter v2 instruction fee envelope, exact user/mints, 100 bps, exact reviewed referral and canonical-USDC fee account, independent simulation and admitted CPI programs. Settlement binds the exact fee-account index and amount. Standard, paid Pro and trial Pro each passed unsigned buy and sell construction/simulation.
- Account wallets include network-specific funding guidance, public address copying and a lazy secure-export flow using Privy's own isolated export interface. Raven never retrieves the exported private key. Both ecosystems pass the real SDK bootstrap under nonce-bound styles and self-only scripts, plus destination ownership checks. This is not a funded recovery/withdrawal canary.

## Stripe configuration and evidence

Live price: `price_1TlSQc1VWvkKnSWZ66YK9vPy` (USD 14900, monthly).
Portal: `bpc_1UD1yg1VWvkKnSWZ6Kby8Beu` (payment methods, invoice history, cancellation at period end).
Webhook: `we_1UD1yg1VWvkKnSWZ2EFsMhk3`, `https://app.ravenos.xyz/api/v1/pro/stripe/webhook`, API version `2024-06-20`.

An explicitly tagged nonpaying configuration customer was used to create a live Checkout session with the 30-day trial, verify the hosted Checkout/portal origins, and expire the session. No card, subscription, invoice or charge was created. Actual paid invoice settlement remains a canary requirement. Restricted credentials and webhook signing secrets are stored outside the repository and passed through the protected release-secret workflow.

## Solana economics evidence

Referral account: `CAhs68qUBmRVg4i8kh6L6VzDqAWsMtNrE8acoTo3K3Vd`.
Referral authority: `CEACkaNKdHVupnaiEMLGppw8RthjCdoMj8kdxJeg3MfV`.
Canonical Solana USDC fee account: `AZvRGXzbBAJK5BoWMGp18wJUtJLFgc9LadY274gs6U17`.

The unsigned matrix covers three account tiers in both directions, using public reference wallets solely for construction/simulation. The current provider program-to-label catalog constrains candidate routes to previously reviewed venues; it never adds program execution authority. Unknown instructions, CPI programs, fee accounts and Token-2022 behavior fail closed. The v2 validator checks the fee envelope, not a claimed complete route-plan decoder. The existing full-transaction and CPI checks remain required.

Jupiter's current referral economics retain 20% of the gross execution fee. Pro cashback is 30% of the customer fee before that provider share. A confirmed $10 customer fee therefore means $2 provider share, $3 cashback liability and $5 Raven revenue before other costs. On the tested USDC buy and sell paths, fees collect in canonical USDC. No production transaction was signed or broadcast.

## Still disabled or incomplete

- On-chain cashback claims need a funded, verified treasury settlement service. The liability ledger, wallet validation and claim policy exist; they do not constitute a funded payout system.
- Automatic Copy execution needs bounded signing authority and live execution/reconciliation validation. Existing research, shadow and manual handoff remain available.
- Universal USDC limit orders remain paper/review; automatic cross-chain settlement and limit execution are not activated by this release.
- Privy delegated and manual signing remain disabled pending ecosystem-specific funded recovery/withdrawal verification. Existing external-wallet trading is separate.
- Shielded Reserve remains an operator shadow/research feature. No shielded wallet signer, viewing-key ingestion or live capital movement is enabled.
- The operator-deferred entity and contact fields still need completion. Actual paid invoice/credit/refund settlement and a tiny live trade remain controlled follow-up checks.

## Validation

The full contract command passed 1,337 checks across its suites. An additional 38 focused fee-envelope/export-security checks and 16 browser tests passed. Real-SDK bootstrap covers EVM and Solana, while mocked export confirms the explicit selected-address handoff and prevents export for a mismatched identity. Browser snapshots were inspected. Clean dependency installation reports zero known audit findings. Release build, security architecture, and public data-leak validation passed.

The release must still pass the standard clean-tree package, staging and production-cohesion verification before being described as deployed. Deployment receipts are retained separately from this source report.
