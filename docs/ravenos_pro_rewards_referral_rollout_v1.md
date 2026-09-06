# Pro, rewards, referrals and wallet research rollout

The September 2026 release ships the finished application and accounting work with financial activation controlled separately. `config/customer_security.json` is the source of release activation flags; `scripts/package-release.mjs` records them in the immutable Worker version. Wallet history uses Helius for Solana and Alchemy for Base, Ethereum and BNB Chain. Robinhood retains its existing provider fallback. EVM transfer history is not a complete realized-P&L or historical swap index.

## Product and accounting

`lib/customer_product.mjs` defines 100 bps for Standard, paid Pro and trial Pro, 30% Pro cashback, $149 monthly Pro, a 30-day no-card trial and zero additional Copy surcharge. The final customer decision keeps cashback based on the confirmed customer Raven fee before provider retention. On a $1,000 Jupiter trade, a $10 customer fee, $2 provider share and $3 Pro cashback leave $5 Raven net execution revenue. Provider share, collector receipt and customer fee are separate evidence fields. Hyperliquid is excluded.

Eligible verified new accounts receive a deterministic local trial when trial activation is enabled. No Stripe customer, card or automatic charge is created merely by trial start or expiry. Identity history prevents repeat trials; existing-user eligibility defaults off with an explicit opt-in migration policy available. Multiple verified identities remain an unresolved abuse vector. Voluntary Stripe conversion preserves the remaining trial except inside the documented final 48-hour checkout guard.

Rewards use integer micro-USDC, floor rounding, immutable execution entitlement snapshots and an append-only ledger. Only matched confirmed fee receipts earn available cashback. Quotes remain estimates; failed, mismatched or unreconciled fees cannot become available. Gross customer fee, provider costs, collector receipt, reward liability and net execution revenue are traceable. Reversals append adjustments; spent rewards produce a visible outstanding adjustment. Rewards do not expire or disappear with membership changes.

Stripe customer balance credits represent separate reward applications, invoices and external cash. Partial and full invoice offsets preserve whole-cent Stripe accounting and retain micro-USDC remainders. Auto-apply requires opt-in and never creates a subscription by itself. Durable operation locks and provider idempotency prevent duplicate applications. Tax configurations outside the tested supported invoice policy fail closed.

Claims reserve available rewards only, require a verified user-controlled wallet and explicitly configured canonical USDC network economics. The private `RAVENOS_REWARDS_TREASURY` service contract is implemented, but the signing service, funding and network minimums are not provisioned. Claims must stay disabled until those exist and an independently verified tiny canary succeeds. No arbitrary address withdrawal or implicit bridged-USDC payout is supported. Unvalued noncanonical fee receipts remain held; they are not fabricated as USDC.

Referrals extend the existing stable codes and immutable account attribution. The first qualifying referral is frozen through signup; the attribution window is 60 days. Explicit current Affiliate Terms acceptance activates enrollment. Commission is 25% of actual qualifying subscription cash after credits, discounts, refunds and chargebacks, for 12 calendar months from the first qualifying paid conversion. A fully rewards-funded invoice earns zero commission without terminating the original window. Trial activity, execution fees, Copy and cashback never generate affiliate commissions. Payout recording is manual administration, not a deployed payout provider.

## Release boundaries

- Wallet drill-through, search, holdings/history, Copy review handoff and emerging-market discovery are released. Advanced intelligence remains Pro-gated. Automatic live Copy is not enabled; EVM history does not complete a persistent multichain wallet screener.
- Account rewards/referral surfaces and financial services are deployed behind explicit flags. Trials, cashback activation, claims, subscription credits, new billing, affiliate enrollment/commissions and public referral CTAs remain off in this release.
- The light landing welcome appears only when trials are enabled. Pricing explicitly states that trial/rewards activation is pending.
- Existing login, Privy ownership boundaries, external wallet review, Hyperliquid behavior and existing execution canary gates are preserved. This release does not authorize or broadcast trades, claims or affiliate payments.
- Legal versions remain review candidates. Enablement requires exact effective legal records and the existing legal activation controls, not merely published draft pages.

## Database and operations

Apply any missing prerequisite `0033_customer_legal.sql`, followed by `0034_customer_pro_rewards.sql`, `0035_customer_pro_rewards_legal.sql` and `0036_customer_affiliate_conversion.sql`. Preserve a production export and time-travel bookmark first, validate migrations against the preview database, then apply production and check foreign keys. The legal table rebuild preserves acceptance history and restores append-only triggers.

Operational reporting separates global outstanding cashback liability from fee origin chain and payout destination. It does not claim source-chain allocation of unspent liability or proof of treasury solvency. Never treat the entire collector balance as unrestricted Raven revenue.

Before broad financial activation: approve effective terms; validate the live $149 Stripe price, webhook and invoice evidence; fund and deploy the private canonical-USDC claim service; choose network claim minimums from measured costs; complete unsigned current Jupiter 100/100 construction and fee evidence checks; then run explicitly authorized tiny live fee/claim canaries. Do not switch Jupiter API families as part of this release.
