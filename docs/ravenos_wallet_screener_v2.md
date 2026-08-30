# RavenOS Pro Wallet Screener v2

Status: local, dormant, migration-gated
Reviewed: 2026-08-30
Entitlement: existing RavenOS Pro (`wallet.copy`)
Live execution changed: no

## Product boundary

This milestone makes the existing authenticated Wallet Intelligence surface independently useful for research. It does not add a second subscription, another wallet database, another quote engine, live copying, transaction construction, signing, broadcasting, custody, or fee collection.

The universe is explicitly `raven_indexed_solana_wallets`: exact public addresses that Raven has requested or observed. It is not presented as every Solana wallet. The current provider request is capped at 24 normalized transactions and probes one extra signature to distinguish a bounded partial window from a provider window that appears exhausted. Even an exhausted provider page is not presented as verified lifetime history.

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

## Deferred, not approximated

- chain-wide wallet coverage and arbitrary lifetime backfill;
- verified wallet creation time;
- historical entry market cap, liquidity, token age, depth and price impact;
- current marked or executable portfolio values;
- sector/theme classifications;
- a universal bot identity label;
- EVM wallets;
- copyability, follower P&L or capture ratios without prospective Raven Copy evidence;
- an active continuous provider connection before the private staging adapter and cohort prove reliability;
- live copying, signing, broadcasting, custody and actual fee collection.

The shared observer and bounded durable queue are now implemented as a dormant staging contract: observe each unique public wallet once, normalize each source event once, then fan out private policies and research projections without subscriber-proportional RPC duplication. The remaining reliability move is the private gRPC/shred adapter, restart/catch-up exercise, and measured mixed-wallet cohort.
