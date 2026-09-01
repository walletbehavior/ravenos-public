# RavenOS Pro Wallet Screener v2

Status: post-migration staging candidate, dormant by default
Reviewed: 2026-09-01
Entitlement: existing RavenOS Pro (`wallet.copy`)
Live execution changed: no

## Product boundary

This milestone makes the existing authenticated Wallet Intelligence surface independently useful for research. It does not add a second subscription, another wallet database, another quote engine, live copying, transaction construction, signing, broadcasting, custody, or fee collection.

The universe is explicitly `raven_indexed_solana_wallets`: exact public addresses that Raven has requested, observed, or admitted after independent hydration from a qualified provider candidate. It is not presented as every Solana wallet. An interactive lookup still returns a fast 24-transaction evidence window, then a shared resumable backfill can index up to 10,000 signatures for that exact source wallet in 100-signature pages. The job is shared across every researcher and follower, retries an incomplete page without advancing its cursor, and becomes `complete` only after provider exhaustion. A 10,000-signature ceiling is labeled `bounded_partial`; neither state is presented as verified lifetime history without a separately reconciled current head.

## Competitive evidence matrix

Public sources reviewed on 2026-08-29:

- OdinBot Pro filters: `https://docs.odinbot.io/odinbot-pro/filters`
- OdinBot wallet analysis: `https://docs.odinbot.io/odinbot-pro/wallet-analysis`
- GMGN public wallet entry point: `https://gmgn.ai/`

The table records public product evidence, not independently verified vendor internals or performance.

| Feature | Public benchmark definition | Raven equivalent | Raven source | Current state | Confidence / gap |
|---|---|---|---|---|---|
| Last active | Last observed wallet activity | Exact last normalized trade | Normalized Solana events | Available | Bounded Raven history only |
| SOL balance | Last known SOL balance | Last transaction-touched SOL balance | Exact post-transaction account balance | Available with timestamp | Never labeled current |
| Trades / swaps | Completed trades and swap activity | Normalized buys, sells, routed swaps, transfers and ambiguous events kept distinct | Net balance changes plus route evidence | Available | Multiaction ambiguity fails closed |
| Active days | Distinct active dates | Distinct observed event days | Normalized event times | Available | Observation window, not lifetime |
| Bot usage | Percentage attributed to bots | Mechanical timing and exact-sizing evidence | Observed trade intervals and settlement sizes | Partial | No person/bot identity claim |
| Winners / losers | Winning and losing tokens or trades | Positive, negative and flat closed FIFO observations | Exact USDC or native-SOL settlement lots | Available | Settlement bases never combined |
| Hold time | First buy to last sell | FIFO matched-lot hold distribution | Exact buy/sell event times | Available | Only reconstructed known-cost lots |
| First detected | First indexed activity | Raven first observed plus provider history scope | Source/profile ledgers | Available | Not wallet creation time |
| Tokens traded | Distinct tokens | Exact non-settlement mints | Canonical asset identities | Available | Tickers never identify assets |
| Success / trade rate | Successful trade percentage and completed-trade rate | FIFO win rate, bought-token exit coverage and trades per active day | FIFO closes and normalized activity | Available | An observed sell is not overstated as universal trade completion |
| Buy / sell size | Total and average buy/sell | Total, average and median by USDC or SOL basis | Exact settlement deltas | Available | No cross-basis total |
| Entry market cap | Median market cap at buy | Historical entry market cap | Contemporaneous market evidence | Unavailable | Current market cap is never substituted |
| P&L / ROI | Completed trade P&L and average/median ROI | Realized P&L, profit factor, average/median ROI and drawdown by settlement basis | FIFO exact-settlement accounting | Available where basis is known | Partial basis remains explicit |
| Immediate wallet lookup | Public address search | Exact Solana address inspection | Configured Solana RPC | Available | Bounded and Pro-gated |
| Holdings / positions | Current holdings and P&L views | Known-cost open lots plus unresolved inventory | Reconstructed lots | Partial | Marks and executable values require later evidence |
| Copyability | Copy setup and monitoring | Prospective source-vs-follower evidence by order size | Separate Raven Copy ledger | Integration sealed | Insufficient until prospective samples exist |

## Raven-native depth

Profile v5 adds:

- gross profit and loss, profit factor, average and median outcomes, average and median trade ROI;
- top-1, top-3 and top-5 concentration as shares of gross positive realized P&L;
- realized drawdown and win/loss streaks by settlement basis;
- profitable-week and profitable-month evidence;
- 24-hour, 7-day, 30-day, 90-day and all-observed windows;
- hold-time distribution, re-entry, scale-in, multi-exit behavior and bought-token exit coverage;
- cautious mechanical timing/sizing evidence with inspectable components;
- known-cost open inventory, unresolved basis events and last transaction-touched balances;
- provider decode, classification and cost-basis coverage;
- reconstruction confidence from available components while full data confidence remains unavailable without historical price and liquidity coverage.

Profile v5 also adds a versioned `ravenos.wallet_research_thesis.v1` projection. It turns the raw measurements into a concise, inspectable research brief with:

- source-result shape: broad positive, concentrated positive, developing, negative, flat, mixed settlement bases, or insufficient evidence;
- observed timing style from median reconstructed hold time;
- explicit evidence strength from closed observations, cost-basis coverage, and reconstruction coverage;
- bounded strengths, watch-outs, and the next evidence Raven needs;
- an immutable claim boundary that forbids identity, bot, “smart money,” copyability, calibrated-alpha, or cross-settlement-basis claims.

The thesis is deterministic and contains no opaque score. It never converts source performance into follower performance. Fast wallets explicitly call out unmeasured latency sensitivity until prospective Shadow evidence exists; concentrated wallets identify largest-winner dependence instead of presenting the headline P&L alone.

Unknown is never zero. USDC and SOL results are never added. An inbound transfer or airdrop of a non-settlement asset lowers cost-basis coverage and is never converted to a zero-cost winner. Non-trade activity never inflates active trading days. A source result never becomes a follower result.

## Filter contract

The v2 engine retains the bounded legacy controls and adds up to 24 allowlisted clauses. Supported operators are:

`gt`, `gte`, `lt`, `lte`, `eq`, `between`, `in`, `not_in`, `available`, `unavailable`.

Every field maps to a fixed server-owned SQL column. Client input cannot provide a column or sort expression. NULL values do not satisfy numeric comparisons and cannot float to the top of ascending sorts. Presets are transparent groups of the same clauses:

- Evidence first
- Consistent winners
- Broad edge
- Active swing
- Fast patterns

The URL stores bounded filter state for reload/share continuity. The server remains authoritative.

Signed-in Pro users can also save up to 100 exact source wallets across 20 private research-list names. A save references the canonical `source_wallet_id`; it is not a symbol lookup, does not start observation or shadow copying, does not create a policy, and conveys no execution authority. Save and removal mutations use the authenticated app origin, CSRF protection, object ownership and idempotent contracts.

## Deep-history contract

Migration `0011_source_wallet_backfill.sql` adds one durable job per exact source wallet, append-only page-attempt evidence, and append-only run summaries. Successful normalized events enter the existing source-event ledger; there is no second wallet database or accounting engine. Raw RPC payloads, hydrated transaction material, subscriber identity, and execution authority are excluded.

The Worker integration is present but activation remains off behind `RAVENOS_WALLET_BACKFILL_ENABLED` plus the existing wallet-intelligence controls. Each scheduled invocation is intentionally budgeted to four wallets and one 100-signature page per wallet; normalized event writes use bounded batches instead of hundreds of sequential database round trips. Nexus remains the fast prospective observation lane; bounded RPC backfill reconstructs historical evidence. Profile snapshots currently analyze at most the most recent 2,000 retained normalized events and disclose when the larger indexed history exceeds that analysis window.

## Nexus discovery feeder

Raven now has a provider-neutral discovery kernel for proposing additional public-wallet candidates from compact Constant-K Nexus economics. The provider candidate lane is deliberately separate from the exact watched-wallet observer lane. It requires exact reviewed swap-program identity, a required signer, complete signer-owned token economics, and either opposing non-zero deltas or a reviewed Pump buy observation. It applies transparent `single_observation`, `recurring`, and `high_signal` evidence tiers based on observation and distinct-mint counts; it does not use an opaque wallet score.

`recurring` means eligible for Raven's bounded independent hydration and history reconstruction, not admitted, profitable, or copyable. Provider observations never become P&L or Copy signals directly. Unknown, incomplete, unrouteable, and unavailable evidence remain distinct.

The durable feeder now has a separate authenticated candidate endpoint and append-only evidence ledger. A recurring candidate is hydrated from Raven's configured Solana RPC and must independently normalize as a supported trade with exact route evidence before it is admitted to the existing source-wallet and resumable-backfill pipeline. Non-trades and unavailable hydration remain visible refusals; they are not discarded or translated into zero-return wallets. The shared Nexus cursor advances only after watched-wallet and discovery receipts both succeed, so a partial outage cannot create a silent discovery gap.

Migration `0014_source_wallet_discovery.sql` and the three coordinated discovery flags remain unapplied/off. The new tables contain no subscriber relationship, copy policy, signing material, transaction construction, custody, or fee-collection authority.

The first authorized read-only 64 MiB sample on 2026-09-01 found 196 previously unwatched candidates, 37 recurring candidates, and three high-signal candidates from 14,213 complete Nexus frames with zero parse failures. This is evidence that the existing feed can expand Raven's research universe economically. It is not evidence of chain-wide coverage or candidate quality because the active Constant-K research filter remains bounded to 208 identity accounts. The sanitized aggregate is retained at `artifacts/ravenos_constant_k_wallet_discovery_live_validation_2026-09-01.json`.

## Deferred, not approximated

- chain-wide wallet coverage and unbounded lifetime backfill;
- verified wallet creation time;
- historical entry market cap, liquidity, token age, depth and price impact;
- current marked or executable portfolio values;
- sector/theme classifications;
- a universal bot identity label;
- EVM wallets;
- copyability, follower P&L or capture ratios without prospective Raven Copy evidence;
- an active continuous provider connection before the private staging adapter and cohort prove reliability;
- automatic admission of provider candidates without Raven hydration, economic normalization, and bounded history reconstruction;
- live copying, signing, broadcasting, custody and actual fee collection.

The shared observer, Constant-K Nexus adapter, restart-safe dual-sink receiver, authenticated candidate intake, independent Raven admission gate, 25,000-wallet exact manifest contract, and resumable history backfill are implemented as dormant contracts: observe each unique public wallet once, normalize each source event once, then fan out private policies and research projections without subscriber-proportional RPC duplication. The remaining activation work is a controlled cohort with queue, latency, provider-cost, storage-growth, false-candidate rate, and reconstruction-coverage measurement.
