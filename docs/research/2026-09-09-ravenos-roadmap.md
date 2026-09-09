# RavenOS roadmap after the production tab audit

Based on the [9 September production audit](2026-09-09-ravenos-tab-audit.md). This is an implementation sequence with release gates, not a claim that every feature is live or a calendar estimate.

The immediate product promise is simple: discover a coin, inspect its market and wallets, see actual buying power, enter an amount, and buy. Everything beyond that should make that workflow better.

## Current baseline

- Discovery and charts work across the five onchain networks, with differing provider coverage. Perps has strong live market data.
- Twelve audit fixes are deployed in release `ravenos-d8e502468a1e-45726ec7ef6ce9b1`. The final browser check displayed 30 Solana Bonding and 29 Migrated tokens. These are measured snapshots, not guaranteed permanent counts.
- About 31,000 wallet addresses have been seen, but only about 500 profiles are analyzed. Some fresh inspections fail; many profiles lack reconstructed cost basis.
- Pro aggregate research loads. It is not yet the requested long-running wallet-family intelligence.
- Solana produces usable read-only buy estimates with the existing Raven wallet. Sample EVM markets still fail to produce usable estimates. Settlement was not tested in the audit.
- Shielded Reserve returns real provider quotes, including reverse routes and comparisons. The wallet/signing/shielding lifecycle is missing.
- Copy and Agents are research/paper/shadow products. Monitor alerts and Portfolio Governor were unavailable for the tested account.

## 1. Finish the everyday trading path

**First work package.** A polished page that cannot buy is the highest-priority failure.

Work:

- Reproduce the audited Solana holder-inspection HTTP 503 and EVM estimate failures with request-stage diagnostics. Use bounded error identifiers; never log keys, session tokens, or full sensitive payloads.
- Separate economic quote calculation from the funding, allowance, and signing readiness checks. An unfunded account should still get a meaningful preview, while Buy explains exactly what is missing.
- Keep an existing Raven wallet selected after navigation and session restoration. A researched wallet must never become the trading wallet merely because its address appears in a URL.
- Use the configured native/USDC amount, 3% fresh-user default or a supported Auto policy, and visible warnings over 5% slippage or 5% quoted impact. Preserve deliberate saved preferences and disclose fee/gas separately.
- Keep one primary Buy/Sell action. Refresh route, limits, fee, and current exit evidence automatically; retain required wallet authorization rather than adding Raven prepare/connect/review loops.
- Distinguish provider coverage from product gating. Add a validated execution adapter where a supported chain lacks a usable route; never substitute a wrong asset or pool.
- Verify the 1% trading fee against actual route configuration and collected receipts. Verify Pro's 30% cashback against successfully collected Raven fees, with idempotent reconciliation.

Done when:

- New and returning accounts complete the flow on iPhone Chrome and desktop without repeated wallet connection or endless loading.
- SOL/native and USDC inputs yield estimates before funds are available; insufficient gas, allowance, expired quote, and provider failure have accurate recovery paths.
- Each advertised live chain passes a user-controlled small buy and sell, with receipt, destination balance, fee, and cashback reconciliation. Unverified routes are explicitly excluded from the live claim.
- No transaction was executed merely to satisfy a test without the user authorizing that transaction.

## 2. Make wallet intelligence deep and dependable

**Second work package, with holder → profile reliability included in the first.** Optimize useful analyzed profiles, not address totals.

Work:

- Serve retained profiles and history first. A failed refresh must leave established evidence accessible, with its actual observation time.
- Fix the fresh Solana lookup failure and trace all-chain inspection errors. Show queued/running/completed history progress instead of a generic retry loop.
- Paginate and store Solana history through existing Helius capabilities; target at least 10,000 retained transactions for eligible active wallets, with continuation beyond that and honest provider limits.
- Deepen EVM transfer, receipt, and swap reconstruction using existing Alchemy and supported chain sources. Verify Robinhood endpoint capabilities instead of assuming every enhanced Ethereum API exists there.
- Normalize buys, sells, transfers, fees, token accounts, position balances, partial exits, and historical prices. Retain unknown incoming basis rather than counting it as zero cost.
- Prioritize known KOL/smart-money lists, top holders, and top traders. Follow with market-derived active wallets. Share cached analyses across visitors and enforce collection budgets.
- Fill cards with age lower bound, P&L evidence, transaction counts for 1/7/30 days, activity freshness, win rate, hold time, and coverage. Full addresses remain visible and copyable.
- Build the requested top-50 lists per category per chain using analyzed profiles. If fewer than 50 qualify, show the true qualified count and the ingestion backlog rather than padding weak or invented results.

Done when:

- Sampled stored and new wallet inspections on all five chains open a usable profile or a precise progress state; no silent or generic 503 dead ends.
- Solana and EVM profiles reconcile known test histories, including partial closes and external transfers.
- At least 50 **qualified** profiles exist in each publicly promised category/chain; categories without enough evidence are clearly identified before release.
- Depth, cost-basis coverage, collection latency, and cost per newly analyzed wallet are recorded. Provider calls do not scale with each browser visit.

## 3. Complete the market-data layer behind Discover and Terminal

Work:

- Replace the CoinGecko-only spot Txns path with provider-neutral exact-market activity adapters. Use existing provider capabilities first; a DexScreener chart embed does not supply a native trade tape.
- Expand BNB holder ingestion; the audited one-contract sample is not a holder leaderboard. Improve holder coverage and activity linkage on every EVM chain.
- Keep provider roles explicit: Dexch for its supported RH/BNB data, DexScreener for supported market snapshots and embeds, existing Mobula credentials where capabilities are verified, Helius for Solana history, and chain-supported Alchemy services for EVM history.
- Ensure New/Bonding/Migrated candidates survive all-chain limits. Do not invent a revival when no market qualifies for Trading again.
- Broaden verified asset identity so tokenized stocks and reserve ZEC stay out of the memecoin side, while stock-paired memes keep the meme as the traded asset.
- Keep participation summaries and their drill-down on the same rolling six-hour observations; sort the matching coins by that actual window's moves.
- Diagnose shared participation snapshots that contain markets but mark every visible tile stale. Record collection time, source observation time, return-window coverage, and refresh failures separately; a large universe is not proof of a fresh six-hour sample.
- Add anomaly checks for implausible provider volumes and conflicting valuation units. Retain source values and reasons for exclusion; do not silently rewrite them.
- Grow native OHLC where existing providers permit it. Preserve honest, neutral chart-source labels and required provider attribution.
- Populate Onchain Raven Reads from actual token observations. Keep Onchain, Perps, and Atlas evidence separate.

Done when:

- All advertised lifecycle filters produce real candidates when source evidence exists, on mobile and desktop.
- Every supported chain's sampled active markets have functioning Txns and holder profiles, or a specifically identified upstream limitation with a working alternative view.
- A participation tile opens the intended chain/cap family with top matching movers, not unrelated paired stocks or a different return window.
- Provider outages do not erase cached market identity or relabel a working fallback chart as unavailable.

## 4. Make Portfolio the capital-management home

Work:

- Show consistent verified buying power in Terminal, Portfolio, and account/wallet surfaces. Retain balances while refreshing and show stale/unverified states accurately.
- Reconcile trade receipts into positions, fees, realized/unrealized results, and in-transit capital. Avoid double counting source, transit, and destination assets.
- Finish Portfolio Governor as an actionable helper: working-capital targets, concentration, gas readiness, drift, and excess-capital suggestions. State what data each suggestion uses.
- Group capital planning, reserve research, and copy-readiness here. Shielded ZEC is variable-value reserve capital and never automatic sub-second buying power.
- Preserve funding and secure export guidance. Account login, wallet keys, optional analytics permission, and execution authority remain distinct.

Done when:

- Balances and buying power agree across surfaces after refresh and a settled trade.
- A real position closes into a reconciled history with no duplicate capital.
- The helper gives supported, useful proposals for the tested account; it is not just an unavailable card.

## 5. Make Raven Pro's intelligence the differentiator

Work:

- Turn the existing Behavior Lab aggregates into labeled, sourced wallet families: early participants, precursor wallets, recurring cohort actors, rotation, and exit behavior.
- Record membership evidence, first/last observation, chain, relevant runs, sample size, freshness, and uncertainty. Begin reliable accumulation now; reconstruct older history only where records support it.
- Link each cohort to its wallet profiles and affected markets. A user should understand why a group matters and inspect the underlying evidence.
- Measure prospective outcomes separately from retrospective pattern fits. Add controls against look-ahead bias, duplication, and unsupported causal claims.
- Keep Community opt-in. Performance verification and published strategy evidence should not reveal private capital by default.
- Make Raven Lab the inspectable research/evidence home; remove or fold any section that has no distinct user purpose into the relevant workspace.
- Fill qualified Similar History/Replay coverage, connect results to the same scoped sample, and remove duplicate filter labels and persistent checking states after responses finish. Distinguish broad participation statistics from completed comparable outcomes.

Done when:

- A Pro user can open a sourced cohort, inspect its analyzed members and associated runs, and see prospective follow-through.
- Wallet families work across supported chains and are clearly distinct from chain/market-cap participation summaries.
- Public profiles disclose only the owner's chosen fields. Private wallet/reserve data never leaks into leaderboards.

## 6. Graduate Copy and Agents from shadow to controlled live use

Dependencies: trading and reconciliation from package 1; wallet evidence from package 2; capital readiness from package 4.

Work:

- Finish the requested copy controls as real policy fields: buy/sell enablement, fixed/scaled sizing, min/max size, per-mirror/token frequency limits, cap and age ranges, new-position-only, cross-mirror protection, slippage/impact bounds, tips, and supported MEV/landing settings.
- Expose only controls the selected chain adapter can enforce. Solana launchpad/landing behavior must not be implied for EVM.
- Run prospective shadow decisions with skipped reasons, source/follower divergence, fees, finality, fills, and position attribution.
- Require prepositioned working capital for fast copy. Shielded reserve backing does not satisfy hot-capital requirements.
- Add explicit owner-configured execution authority, wallet/chain/asset allowlists, budgets, duplicate protection, pause/revoke, and recovery from unresolved transactions before enabling autonomous execution.
- Make Agents substantive helpers using these same policies and evidence. Avoid a separate trading engine or decorative on/off switches.

Done when:

- Shadow runs produce attributable follower decisions and outcomes for real source events.
- Duplicate events, unavailable quotes, provider failures, gaps, reorg/finality uncertainty, budget exhaustion, and stop/revoke are tested.
- A limited user-authorized beta completes and reconciles real transactions within policy. Only then label Copy/Agents live.

## 7. Build Shielded Reserve into a distinctive, user-controlled beta

Dependencies: Portfolio accounting; verified wallet recovery and signer architecture; security/legal review; provider route evidence.

Work:

- Decide the Zcash wallet integration from verified current capabilities. Do not assume Privy can create or sign a Zcash wallet.
- Prefer a user-controlled external/hybrid bridge for the first beta unless a seamless supported signer passes recovery/export and threat-model review. No Raven spend keys, omnibus wallet, or pooled user balances.
- Implement verified shielding, spend preparation, confirmations, refunds, and return-to-shielded-state reconciliation. Model a transparent intermediate plus separate shield step explicitly when required.
- Keep viewing-key analytics optional, sensitive, and separate from spend authority. Do not require one just to support a weaker external-wallet flow.
- Carry route privacy facts, public destination visibility, metadata exposure, timing/amount correlation, price risk, and provider failure/refund behavior into the user review.
- Charge no Raven reserve movement fee, as decided. Network/provider costs and ZEC price exposure still apply. Trading fees remain separate.
- Add opt-in conversion of **settled, claimable** cashback to ZEC only after that route is working. Do not alter the cashback ledger's USDC entitlement or automatically convert rewards.

Done when:

- A user can recover/export the chosen wallet, verify reserve value, deploy, and return through a small controlled beta with correct final accounting.
- At least one real round trip proves the claimed shielded endpoints. Read-only quotes alone do not pass this gate.
- The product can explain exactly what remains public and observable. Unknown privacy properties never receive a Shielded promise.

## 8. Finish commercial and onboarding readiness

Work:

- Verify trial expiry, paid checkout, cancellation, webhook replay/idempotency, referral enrollment/conversion, refunds/reversals, and cashback claims in appropriate test environments first.
- Align prices, plan access, labels, and capability flags across account, pricing, docs, and UI. Do not advertise an account-gated tool as generally available.
- Finish Monitor alerts and their delivery path; distinguish an empty saved list from an unavailable alert service.
- Keep versioned accepted terms and session restoration smooth. Reaccept only when the applicable version/policy requires it; do not use terms acceptance as permission for unspecified transactions.
- Repeat the tab matrix for signed-out Standard, signed-in Standard, Pro trial, and paid Pro, with zero/funded balances and provider degradation on mobile and desktop.

Done when:

- Commercial events reconcile without duplicate fees/rewards, and users can understand exactly what they are paying for.
- Every visible tab either performs its advertised job or has a useful, accurate state with a recovery action. No permanent placeholders masquerade as finished features.
- Production release smoke checks, provider-health checks, and the critical user journeys are repeatable.

## How to work through this

Complete one work package through deployed verification before treating it as done. Start with **trading reliability plus holder-profile failures**, then **wallet depth**, then **market-data completeness**. Avoid another broad feature-expansion pass until those foundations meet their gates.

For each package, record: reproducible example, root cause, files changed, unit/runtime coverage, mobile/desktop evidence, real-provider result, deployment receipt, and remaining limitation. Keep completion claims proportional to the evidence; preview, shadow, and live are separate milestones.
