# RavenOS Pro Wallet Intelligence and Raven Copy — product report

Reviewed: 2026-08-29
Milestone: migration-safe Solana vertical slice
Production state: dormant; not deployed

## Decision

Build the evidence, policy, persistence, and Pro workspace before migration. Do not activate continuous observation, scheduling, live copy, signing, broadcasting, custody, or fee collection on the current host. After RavenOS has its own machine, add one shared source-wallet observer rather than scaling customer-driven polling.

This capability belongs to the existing RavenOS Pro entitlement. It does not create another subscription or a Pro+ tier. Any eventual execution fee remains separate and uses Raven's provider-independent fee policy.

## Working vertical slice

- Exact Solana public-wallet lookup and bounded 24-transaction history.
- Economic balance-delta normalization with exact wallet, mint, standard, signature, slot, time, provider, finality, and decode version.
- Distinct swaps, transfers, airdrops, token creation, liquidity activity, failures, ambiguous events, and unsupported events.
- FIFO source accounting for exact canonical-USDC and native SOL/wSOL settlement lots, with no invented cross-basis conversion.
- Private, owner-bound Raven Pro watches and versioned copy policies.
- First-refresh baseline that cannot create a shadow fill.
- Exact canonical-USDC entry quote and immediate reverse-USDC proof for a later source buy.
- Explicit execute, refuse, unavailable, and indeterminate shadow decisions.
- Append-only decisions and finality observations; a shadow position exists only after `SHADOW_EXECUTABLE`.
- Authenticated Find Wallet, Watching, Shadow Feed, and Positions views.
- Source performance and follower reality remain visibly separate.
- Hypothetical fees are visible and never represented as collected.

## Real read-only evidence

One bounded public-chain probe normalized 24 transactions: nine buys, six sells, two inbound transfers, six outbound transfers, and one failed transaction. Raven resolved the selected destination as an exact Token-2022 mint.

At a hypothetical $100 follower size:

- Entry quote: available.
- Reverse canonical-USDC quote: available.
- Current executable exit before Raven fee: $97.381251.
- Round-trip market/route friction: 2.618749%.
- Round-trip friction with a hypothetical 10 bps entry-and-exit Raven fee: 2.81613%.
- Entry quote latency: 234 ms.
- Reverse-exit quote latency: 287 ms.
- Bounded evaluation time: 6.456 seconds.
- Manual detection delay: 86.754 seconds.

The detection figure includes human selection and invocation. It is not a continuous-observer latency measurement and cannot support an Odin-level speed claim.

The same event was evaluated later at 642.939 seconds. Entry and exit remained quoteable, but Raven correctly returned `COPY_DELAY_TOO_HIGH`. The refusal remained in the evidence set and did not become a zero-return trade.

The native settlement ledger reconstructed five closed lots at -0.001345826 SOL realized, -2.9259% ROI, and 20% win rate. The result remains partial because two inbound transfers have unresolved acquisition cost. It remains SOL-denominated rather than being converted with a current price and mislabeled historical USD P&L. Qualified liquidity metadata was unavailable and remained null. The sanitized evidence record is `artifacts/ravenos_wallet_copy_live_validation_2026-08-29.json`.

## Current coverage

| Area | Working now | Not yet claimed |
|---|---|---|
| Chain | Solana mainnet | EVM and other chains |
| Wallet lookup | Exact public address | Universal historical index |
| Discovery | Wallets explicitly inspected or watched | Broad ranked screener universe |
| Decode | Common balance-delta swaps, PumpSwap, Jupiter, transfers, airdrops, failures, and guarded categories | Every Solana protocol and complete Token-2022 simulation |
| Accounting | Known-basis FIFO lots and explicit unresolved inventory | Deep cost basis from arbitrary prehistory |
| Follower evidence | Exact entry, reverse exit, friction, delay, policy, hypothetical fee | Continuous observer, crowding, follower-capacity curve, source exits, checkpoints |
| Portfolio | Shadow-position contract and authenticated position view | Aggregate live portfolio integration and live assets |
| Alerts | Decision records are available to the future alert bridge | Continuous or external alerts |
| Execution | None | Construction, authorization, signing, submission, settlement, fee collection |

## Public benchmark

OdinBot's public documentation, reviewed 2026-08-29, shows a more mature wallet-discovery universe, deep screener filters, wallet analysis, and a direct discovery-to-mirroring flow. GMGN's visible public workflow remains faster for casual address lookup and presents copy controls with less ceremony. Neither vendor's fill quality, internal scoring accuracy, or claimed speed was independently verified here.

Raven's working differentiation is already structural:

- Source-wallet returns never become follower returns.
- A quoteable entry does not become executable without a reverse exit.
- Skipped and unavailable signals stay visible.
- The same source event can pass one policy and fail another.
- Unknown cost basis does not become free profit.
- Hypothetical fees remain separate from market and route friction.

Remaining parity gaps are the broad wallet universe, saved screeners, deeper historical reconstruction, continuous detection, wallet and position alerts, capacity by order size, source-sell mapping, and eventually noncustodial execution.

Sources:

- `https://docs.odinbot.io/odinbot-pro/filters`
- `https://docs.odinbot.io/odinbot-pro/wallet-analysis`
- `https://docs.odinbot.io/odinbot-pro/what-is-odinbot-pro-and-how-to-start-using-it`

## Resource and unit-economics baseline

The observed one-signal probe made 27 Solana RPC requests, three quote-only Jupiter requests, and one DexScreener request. Its 24 normalized event records occupied 60,066 JSON bytes, with a 2,656-byte median event; the profile occupied 2,030 bytes.

A maximum manual refresh can approach 43 provider calls: one signatures request, up to 24 transactions, and up to three qualifying signals with mint, entry, reverse exit, optional SOL conversion, and liquidity evidence. The current 12-refreshes-per-15-minute account limit is an abuse ceiling, not a recommended polling cadence.

Naive five-minute polling of unique wallets would consume roughly 300 baseline RPC calls per wallet per hour before signal quotes. With no watch overlap that becomes approximately:

| Pro users / unique wallets | Baseline RPC calls per hour |
|---:|---:|
| 100 | 30,000 |
| 1,000 | 300,000 |
| 10,000 | 3,000,000 |

That model is not acceptable for activation. A shared observer makes observation and decode cost proportional to unique wallets and actual transactions, while policy evaluation fans out cheaply per subscriber. One million normalized events at the observed median would be about 2.657 GB of event JSON before indexes, snapshots, and storage overhead.

Dollar costs are intentionally not estimated here because provider plan allowances, overage terms, and post-migration infrastructure prices are not part of the public runtime contract. Billing and request telemetry must supply those values before Raven promises unlimited monitoring inside $149/month.

## Live-readiness blockers

- Dedicated shared Solana observation service and durable queue.
- Measured processed/confirmed/finalized latency and rollback handling.
- Larger evidence-bound historical backfill and archive strategy.
- Source-sell and partial-exit lot mapping.
- Checkpoint servicing and follower P&L.
- Capacity curves at $25, $100, $500, $1,000, and $5,000.
- Aggregate Raven follower crowding controls.
- Chain-local USDC and gas-readiness evidence.
- Noncustodial constrained authorization and transaction simulation.
- Destination economic settlement verification.
- Fee-collection construction and treasury reconciliation.
- Operational monitoring, emergency disable, and jurisdictional review.

## Next smallest move after migration

Run one shared Solana observer against a deliberately mixed cohort of 25 public wallets for at least seven days. Decode each source transaction once, evaluate standard follower sizes, service refusal and executable checkpoints, and report p50/p90/p95/p99 receipt, decode, entry-quote, exit-proof, and total-decision latency. The cohort must include high-frequency, swing, deep-liquidity, low-liquidity, concentrated-profit, and frequently refused wallets.

Only after that dataset exists should Raven publish a Copyability score, follower-capture ratio, speed claim, fair-use policy, or controlled live-copy canary.
