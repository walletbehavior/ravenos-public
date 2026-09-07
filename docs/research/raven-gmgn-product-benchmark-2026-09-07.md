# RavenOS / GMGN — authenticated product benchmark

September 7, 2026. Raven was tested through the owner-authorized Pro-trial account. GMGN was inspected through its public live interface and official documentation. No GMGN login was created; its full wallet page required sign-in, so that page's documented capabilities are distinguished from observed token/holder behavior. No trades, payouts, paid subscriptions, key exports, public posts or affiliate enrollment were performed.

## Finding

Raven has useful market evidence, exact-pool routing, wallet links, Pro cohort research and a functioning shielded route preview. GMGN currently makes token triage and holder investigation faster and more information-dense. Raven's most important deficit is the populated shared wallet index and history depth, followed by the presentation of existing evidence. Adding more high-level panels before fixing those foundations will not close the gap.

## Comparison

| Workflow | Raven observed today | GMGN observed / documented | Raven priority |
| --- | --- | --- | --- |
| Early discovery | All-chain list, lifecycle/chain filters, velocity/risk context; Bonding and Migrated now contain markets | Live Trenches shows New, Almost bonded and Migrated together with per-column controls | Offer a launch workspace using chain-correct lifecycle semantics; retain the mixed-market desk |
| Scan a market | Cap, liquidity, volume, activity and occasional holders leave an uneven second row | Trending exposes age, ATH market cap, liquidity, transaction splits, holders and fees in consistent columns | Use a stable two-row grid with explicit missing values and asset-specific metrics |
| Exact token | Exact token/pool IDs, current chart, holder census, risk evidence and reverse-USDC quote | Same token adds developer/funding links, pool creation, initial/current pool assets, flow and heuristic audit tags | Surface measured age, net flow, concentration and provenance; do not copy opaque risk labels |
| Holders | Owner balance, supply share, pool exclusion, sampled recent activity, wallet and explorer links | Live holder rows include bought/sold value, cost context, P&L, remaining position, funding and last activity | Join retained wallet/token positions into the holder table; expand a row without forcing navigation |
| Wallet detail | Current balance snapshot, retained events and cost-basis caveats; first look can be dominated by recent transfers | Holder popup shows 7D P&L, win rate, transaction count, hold duration and tracked counts; full wallet page requires login | Holdings/activity overview first, then performance and advanced evidence; enrich names and prices from Raven caches |
| Wallet discovery | 44 registered Solana wallets and two analyzed profiles at audit time; no indexed EVM profiles | Official Wallet Radar supports candidate selection by most bought, profit, early entry and shared holdings | Admit bounded candidates from markets/trades Raven already sees, by exact chain; incrementally hydrate once and share results |
| Copy | Exact wallet prefill, policy composer and shadow/manual Terminal handoff; automatic execution disabled | Official Copy docs describe sizing, copied-position exits, filters and failure controls | Keep separate source returns and follower results; finish prospective evidence and execution readiness before enabling automation |
| Pro research | Perps and behavior tables load; Raven Lab is currently mainly an entry page; Agents is paper-only | GMGN's visible workflow stays close to token and wallet decisions | Give each Raven section a concrete job: research cohorts/replay; monitor and explain; manage capital |
| Capital privacy | Signed Deploy/Return/Send preview quotes work; reserve value is ZEC exposure and is not buying power | Not assessed as a GMGN capability | Keep Shielded Reserve in Portfolio. Never present the preview as an operational shielded wallet |

Sources: [GMGN New Pair](https://docs.gmgn.ai/index/new-pair), [GMGN live OTC token](https://gmgn.ai/sol/token/MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump), [Wallet Radar](https://docs.gmgn.ai/index/wallet-radar), [Wallet Detail documentation](https://docs.gmgn.ai/index/wallet-detail-page), [Copy documentation](https://docs.gmgn.ai/index/gmgn-app-tutorial/copy-trade). GMGN documentation is not evidence that every feature works on every chain.

## Same-token and same-wallet evidence

The test token was Solana OTC, contract `MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump`, pool `DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt`. Successive snapshots showed roughly $11.8–12M capitalization, $571–579K liquidity and 11.9K holders on both platforms. These were not simultaneous measurements, nor proof of identical indexing.

Raven displayed 11.95K on-chain owners with 100 returned holder rows. Top-10 concentration was 21.8% after its exact-pool exclusion; GMGN showed approximately 15.7%. Treat that difference as unresolved membership/exclusion/denominator evidence, not proof that either percentage is correct. Pool, escrow, exchange and other infrastructure accounts need explicit classification with provenance.

Both platforms exposed holder `CPZfoAcQKnsWYApcFR7jh2GvtbUGjcjSARCZsypmBGhP`. GMGN's token-holder popup included accumulated buy value and position-level P&L. Raven's first lookup produced a live SOL/token balance snapshot, including the matching OTC holding, but only 24 recent events and no classified trades. Retained pagination worked. Global wallet search also opened the correct address. Shared backfill subsequently reached 300 decoded transactions and 15 trades without another manual provider refresh; known basis was still only 3.5%. That is progress, not a complete wallet performance record.

The production backfill scheduler was enabled and running every five minutes, one 100-signature page per job per run. The UI polled for only two minutes and stopped before the next batch. That made real background progress look frozen. This release extends the same bounded 12-read budget over roughly twenty minutes, skips hidden-page network reads, and adds a cache-only history-status refresh. Current indexed coverage was independently checked in D1; broad multichain screening is not operationally complete.

GMGN's holder/first-buyer/insider labels remain heuristics. Raven should display address relationships, evidence and timestamps without inferring real identities or coordination. [GMGN trading-system documentation](https://docs.gmgn.ai/index/trading-system), [GMGN holder/first-buyer definitions](https://docs.gmgn.ai/index/insider-traders-snipers-first-70-buyers).

## Changes made during this audit

- Fixed the deployed Shielded Reserve adapter's native Worker fetch receiver and redirect handling. Live read-only customer previews for all three directions succeeded; execution remains hard-disabled.
- Fixed the market rail rejecting the chart API's valid legacy `chain:pool-address` identity alias. Exact chain/pool/token checks remain mandatory.
- New customer Copy policies and ongoing shared research jobs use the centrally configured 100-bps native fee. The server rejects cheaper customer-supplied scenarios. Historical research policy hashes and explicit older assumptions are preserved. Customer copyability projections select the current 100-bps evidence instead of reusing cheaper historical results.
- The Copy form displays the current fee and cashback boundary; no simulated cashback is earned or deducted from results.
- Expired exit quotes lose their current-verification labels throughout the ticket.
- History status remains cache-first, can be refreshed without an RPC rescan, and no longer invalidates an open same-wallet Copy draft.
- Replaced obsolete Pro Intelligence text claiming self-service billing was closed with the membership entry point.

No schema migration or financial feature activation is required for these changes.

## Next implementation order

1. **Shared wallet coverage and backfill:** register observed makers/holders with chain, time, source and demand priority; deduplicate pending jobs; cap enrichment per chain. Prioritize Solana and Robinhood. Browsing/filtering must remain provider-free. Use incremental cursors, bounded hydration and token metadata from Raven's existing caches. A new customer's repeated page visits must not multiply history fetches.
2. **Wallet/holder usability:** token names, logos, value and quote timestamps; holdings/trades/performance tabs; token-specific position preview within holder rows; explicit cost-basis coverage, transfer adjustments and meaningful funding links. Show marked value separately from executable exit value. Do not advertise reconstructable P&L where the evidence is insufficient.
3. **Discover metrics:** tokens: age, holders, net flow, concentration and ATH/drawdown only from verified complete history. Label bounded-chart highs as observed highs. Equities/ETFs: listing-appropriate range, relative volume, spread, float/assets where licensed and available. Perps: funding, OI, spread/depth and liquidation context. Avoid filling cells with incomparable invented equivalents.
4. **Mixed Raven setups:** inspect candidate creation and ranking. The visible 24-market feed remained perp-only even while the token list had around 200 exact markets. Do not fabricate spot signals merely to achieve visual balance; show qualifying token/equity opportunities and explain when none qualify.
5. **Pro product jobs:** consolidate the Lab entry with useful cohort comparison/replay. Make Agents monitoring, explanations and paper-policy results explicit. Portfolio should own working capital and Shielded Reserve. The current paper controls, disabled Radar and unavailable Governor need honest product boundaries.
6. **Verification:** repeat equivalent-token comparisons on Robinhood and Solana, reconcile concentration definitions, measure cache hit rate/history age/provider cost and test funded execution separately. Community remains empty because no public profile clears its evidence threshold; private controls should stay opt-in. Behavior's repeated 50% success values need upstream numerator/denominator review before using them as a sales claim.

## Financial boundaries

Native execution remains 1% for Standard and Pro, Pro/trial cashback remains 30% of eligible confirmed Raven fees, and Copy adds no surcharge. Hyperliquid is separate. The owner's account was unfunded: no live-fill, recovery, withdrawal, subscription-payment or claim-settlement proof was obtained. Cashback payouts still require a funded verified payout service. Shielded quotes are real provider responses but do not prove shielded settlement, wallet custody properties, refunds or unlinkability.
