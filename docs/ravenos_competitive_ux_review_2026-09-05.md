# RavenOS competitive UX review — 2026-09-05

## Verdict

RavenOS already has broader evidence, cross-chain identity, filtering, route review, and policy context than the products reviewed. Its main product gap is not a missing pile of controls. The gap is that high-intent workflows are less obvious than the underlying capability.

The strongest near-term product move is to keep Raven's evidence boundary while reducing the distance between:

1. finding a lifecycle or wallet signal;
2. understanding the exact instrument and uncertainty;
3. checking entry and exit execution;
4. acting through Terminal, Watch, Follow, or Copy.

## Current benchmark

| Product | Strong current pattern | Raven response |
| --- | --- | --- |
| [Axiom Pulse](https://docs.axiom.trade/axiom/finding-tokens/pulse) | New Creations, Final Stretch, and Migrated are primary lanes; dense filters and quick buy remain close to the list. | Expose New, Bonding, Migrated, and Trading again above Raven's full filter drawer. Keep exact-pool identity and Raven evidence in every handoff. |
| [Axiom Trader Scan](https://docs.axiom.trade/trader-scan) | Token activity connects quickly to wallet buys, sells, balances, realized P&L, and hold time. | Bring qualifying-wallet activity and copyability into token and trader views using Raven-observed accounting and confidence. |
| [GMGN token pages](https://docs.gmgn.ai/index/token-page-chart-multicharts-activity-trading-system) | Chart, activity, traders, holders, and trading are one compact workflow. | Keep Chart, Txns, Holders, Trade, and Raven synchronized to one exact market. Make readiness and data failures visible without explanatory blocks. |
| [GMGN wallet detail](https://docs.gmgn.ai/index/wallet-detail-page) | Follow, copy, alerts, P&L, win rate, hold duration, and cost are co-located. | Make the basic wallet profile free and immediate; reserve reconstruction depth, cohorts, copyability, and advanced comparisons for Pro. |
| [OdinBot Pro filters](https://docs.odinbot.io/odinbot-pro/filters) | Wallet discovery is driven by composable behavior and performance filters. | Continue the chain-neutral Raven screener with explicit unavailable values, data confidence, profit concentration, drawdown, and follower-realistic copyability. |
| [Phantom Terminal](https://help.phantom.com/articles/46527102843027) | Low-friction account/wallet onboarding, launch lanes, quick buy, and no extension switching for embedded flows. | Keep Raven login canonical, make embedded wallets optional and recommended at trade time, and preserve external wallets. |
| [Robinhood Trenches](https://robinhoodtrenches.com/) | A narrowly focused Robinhood live tape makes wallet activity immediately legible. | Use Raven's direct RH observation for a meaningful smart-money tape, clustered activity, profiles, follow, and Raven Copy rather than a raw transaction firehose. |

## Raven advantages to protect

- Canonical chain, venue, contract or mint, pool, and instrument identity instead of symbol identity.
- Observed, inferred, marked, executable, and unavailable values remain distinct.
- Entry and reverse-exit evidence can be reviewed before action.
- One architecture spans Solana, Robinhood Chain, BNB Chain, Base, Ethereum, and Hyperliquid without pretending balances or settlement are atomic.
- Raven reads, Portfolio Governor policy, wallet reconstruction, copyability, and reconciliation can share the same evidence chain.
- External discovery providers remain replaceable enrichment rather than execution or accounting authority.

## Gaps confirmed in this pass

### Discover

- Lifecycle lanes existed but were hidden inside Filter markets.
- Same-symbol contracts looked like accidental duplicate rows even when their addresses were distinct.
- Exact-pool deduplication existed, but the display did not explain remaining same-symbol identities.
- Filtered result size was not visible.
- The global search consumed enough header width to crowd seven workspace destinations.

### Terminal

- The core market workflow is competitive when current: chart, book or transactions, holders, trade review, and Raven context share an exact identity.
- The remaining UX gap is readiness above the fold: wallet, quote freshness, exit availability, fee, and signing state should be immediately visible before users enter order details.
- Embedded EVM wallet work remains a staged path until its real transaction lifecycle is independently exercised. Solana embedded signing remains gated on the Jupiter fee configuration and canary.

### Wallet intelligence and Copy

- Raven's data model exceeds basic competitor filters, but the UI must lead with the six or eight metrics that answer “is this trader repeatable and copyable?” before exposing the full laboratory.
- Basic lookup, watch, follow, and Copy should remain available without Pro. Cost-basis depth, cohorts, propagation, comparison, and follower-realistic copyability belong to Pro.
- Copy must continue to show skipped and indeterminate signals; source performance is not follower performance.

## Implemented slice

- Added visible All, New, Bonding, Migrated, and Trading again lifecycle lanes.
- Added a live result count.
- Kept one best exact pool per canonical chain and token.
- Grouped distinct same-symbol contracts for presentation only, labeled the count, retained the selected exact contract and CA, and added an All contracts reveal.
- Expanded Jupiter Top Trending from 20 to 50 tokens and resolved pools in documented 30-mint batches.
- Raised the current EVM pool intake from 44 to the complete three-page 60-row bound per chain, and raised Dexch lifecycle candidates to 30 per represented chain.
- Removed alternate-pool duplication before the 240-token public bound, then selected overflow fairly across the requested chains.
- Interleaved the first 15 all-chain results so Solana, Robinhood, Base, BNB, and Ethereum are visible without changing each chain's underlying rank.
- Reduced desktop header competition between search and workspace navigation.
- Moved the Terminal wallet → quote → exit → sign → reconcile readiness rail above risk, fee, and review controls.
- Kept mobile controls horizontally scannable and preserved exact-identity access.

## Next UX bridge

1. Make token-level qualifying-wallet activity the bridge from Discover and Terminal into wallet profiles, Follow, and Copy.
2. Compress wallet profiles into a basic overview followed by evidence, behavior, risk, and copyability tabs.
3. Ship the Robinhood smart-money tape from normalized Raven events with significance filters and pause.
4. Exercise the embedded EVM flow end to end before recommending it publicly; keep delegated signing off.

## Acceptance rules

- Same ticker never becomes asset identity.
- Grouping never changes the exact contract or pool sent to Terminal.
- All hidden same-symbol contracts remain one click away.
- Missing evidence never becomes zero or permission.
- Discovery enrichment cannot block Terminal execution.
- Public claims describe only paths that were actually exercised.
