# RavenOS Pro Wallet Intelligence and Raven Copy v1

Status: local, dormant, migration-safe vertical slice
Reviewed: 2026-08-29
Production activation: not approved

## Product boundary

Wallet Intelligence and Raven Copy are part of the existing RavenOS Pro entitlement. They do not introduce a second subscription, custody, a copy-bot wallet, or a live execution path. The first implementation supports public Solana source wallets, a bounded Raven-indexed screener, and two customer modes: Watch and Shadow. Live Raven Copy is source-level disabled.

Raven keeps these statements distinct:

- A source wallet was profitable.
- Raven reconstructed enough cost basis to measure that profit.
- Raven observed a new source transaction prospectively.
- Raven decoded an exact buy signal.
- A follower entry was currently quoteable.
- A reverse liquidation route was currently quoteable.
- The user’s policy accepted the evidence.
- A shadow position was recorded.

None of those statements represents a fill, an asset held, a transaction prepared, or a fee collected.

## Reused Raven architecture

The slice extends the current WorkOS account and host-only session boundary, D1 owner authorization, server-owned entitlement grants, Solana RPC governor, provider health circuit, canonical asset identity, Jupiter exact-token quote path, reverse-USDC proof, hypothetical `FeePolicy`, and append-only evidence conventions. It does not create another quote engine, portfolio ledger, provider-health service, or billing system.

Shared public-chain source evidence is stored once per Solana address. Customer watches, policies, shadow decisions, and strategy attribution remain owner-bound. Subscriber-to-wallet relationships never enter public telemetry or public responses.

## Current workflow

1. A Raven Pro user can enter an exact Solana public address or screen the bounded set of wallets Raven has already normalized. The screener never claims every Solana wallet and never substitutes source performance for follower performance.
2. Raven loads at most 24 recent signatures through the configured Solana RPC and fetches decoded transactions in bounded batches.
3. Net wallet balance changes are normalized into explicit economic events. Opposing balance changes are not called swaps without swap-route evidence.
4. Transfers, airdrops, failed transactions, liquidity operations, ambiguous activity, and unsupported activity remain separate from buys and sells.
5. FIFO source P&L uses exact canonical-USDC or native SOL/wSOL settlement lots. SOL returns remain SOL-denominated; Raven never converts them with a current price and calls it historical USD performance. Unknown inbound cost basis never becomes zero-cost profit.
6. The first watch refresh establishes a historical baseline and cursor. It cannot create a shadow trade.
7. A later source-wallet buy may request an exact canonical-USDC entry quote and immediate token-to-canonical-USDC reverse quote.
8. Raven checks exact mint identity, token program, quote age, latency, liquidity, price impact, round-trip friction, funding assumption, and user policy.
9. Raven records either `SHADOW_EXECUTABLE` or a named refusal. Refusals are retained and are not counted as zero-return trades.
10. Only `SHADOW_EXECUTABLE` creates a shadow position. It has no transaction hash and holds no live assets.

## Storage and mutability

Migration `0007_customer_wallet_copy.sql` adds a single `wallet.copy` capability to the existing grant registry. It also adds shared source wallets, append-only normalized events, append-only finality observations, append-only profile snapshots, owner-bound watches, append-only shadow decisions, shadow positions, and future checkpoint storage. Migration `0008_customer_wallet_screener.sql` adds a rebuildable current-profile projection for bounded filtering and deterministic sorting; the append-only profile snapshots remain the historical source of truth.

Economic events are idempotent by wallet, signature, and decode version. Processed, confirmed, and finalized observations are recorded separately so a finality upgrade does not create a second trade. Corrections require a new decode version or superseding evidence; historical decisions retain their policy and quote evidence.

Customer deletion cascades private watches and customer shadow state. Public-chain source evidence has an independent retention policy. Raw provider payloads, signer material, transaction construction material, private keys, and subscriber identities are excluded.

## Activation and authority

All controls default off:

- `RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE`
- `RAVENOS_WALLET_INTELLIGENCE_ENABLED`
- `RAVENOS_WALLET_COPY_ROUTES_ENABLED`
- `RAVENOS_WALLET_SCREENER_ENABLED`
- `RAVENOS_SHADOW_COPY_ENABLED`
- `RAVENOS_LIVE_COPY_ENABLED`
- `RAVENOS_COPY_FEE_COLLECTION_ENABLED`

The first five can eventually expose the authenticated intelligence and shadow surface after migration validation. The last two cannot enable live authority: live copy, signing, broadcasting, custody, scheduling, continuous observation, and fee collection are hard false in source code for this milestone.

## Public benchmark, 2026-08-29

OdinBot’s public documentation describes an integrated Solana wallet screener, wallet analyzer, and discovery-to-mirroring workflow. Public filter documentation includes activity, balance, completed trades, swaps, active days, bot usage, wins and losses, hold time, wallet age, tokens, success rate, trade rate, buy size, entry market cap, P&L, and ROI. Its speed and universe-size statements are vendor claims, not independently measured here.

Sources reviewed:

- `https://docs.odinbot.io/odinbot-pro/filters`
- `https://docs.odinbot.io/odinbot-pro/wallet-analysis`
- `https://docs.odinbot.io/odinbot-pro/what-is-odinbot-pro-and-how-to-start-using-it`

GMGN’s publicly visible navigation and wallet-discovery surfaces emphasize immediate address search, categorized wallet lists, monitoring, copy controls, and low-friction movement from discovery into action. Authentication limited deeper verification during this review. No claim about GMGN’s fill quality, scoring accuracy, or internal implementation is treated as verified.

Raven’s intended advantage is not a larger headline P&L. It is the explicit split between source performance and follower reality, the reverse-exit requirement, visible refusal evidence, policy-specific shadow outcomes, and prospective copyability by order size.

## Migration gate

Before activating continuous observation on the new RavenOS machine, validate D1 migration and backup retention, staged-origin authorization, provider subrequest budgets, queue backpressure, event lag, RPC costs, storage growth, and restart recovery. Measure p50, p90, p95, and p99 from chain event through receipt, decode, entry quote, reverse-exit proof, and decision.

The current host remains manual-refresh only. No scheduler or wallet WebSocket fan-out is added before the migration. This avoids turning a resource-constrained machine into a hidden reliability dependency.

Operators can validate one public source-wallet buy against real read-only chain and quote evidence with `npm run validate:wallet-copy-live -- --wallet <address> --source-signature <signature>`. The validator reads only the allowlisted Solana RPC and Jupiter credentials from the configured parent environment, persists nothing, hashes the public wallet and signature in its report, rejects transaction material, and has no construction, signing, submission, broadcast, or fee-collection path.

A manual refresh is deliberately bounded: at most 24 transaction fetches plus signature, mint, route, reverse-route, optional SOL conversion, and liquidity lookups. A refresh with three genuinely new qualifying buys can therefore approach 43 provider calls. This is an activation constraint, not a sustainable subscriber polling model; the post-migration shared observer must decode each unique source event once and fan out only policy evaluation.

## Read-only chain validation

The 2026-08-29 probe normalized 24 real public Solana transactions for one source wallet, distinguished nine buys, six sells, two inbound transfers, six outbound transfers, and one failed transaction, and resolved the selected asset as an exact Token-2022 mint. A hypothetical $100 follower order received an exact Jupiter entry quote and reverse canonical-USDC quote. Current executable exit was $97.381251 before the hypothetical Raven fee, producing 2.618749% market/route round-trip friction and 2.81613% including the 10 bps entry-and-exit fee scenario.

The bounded evaluation took 6.456 seconds. Entry quote latency was 234 ms and reverse-exit quote latency was 287 ms. The event was selected and invoked manually 86.754 seconds after chain time, so that number is a manual-poll baseline and not a continuous-observer speed result. The version-2 native settlement ledger reconstructed five closed lots at -0.001345826 SOL realized, -2.9259% ROI, and 20% win rate. The profile remains partial because two inbound transfers retain unresolved acquisition cost. No current or reconstructed SOL/USD price was used. Qualified liquidity metadata was unavailable and remained null; the diagnostic policy used no minimum-liquidity threshold. The complete sanitized record is `artifacts/ravenos_wallet_copy_live_validation_2026-08-29.json`.

The same event was probed again after 642.939 seconds. Its entry and reverse-exit routes were still available, but Raven returned `COPY_DELAY_TOO_HIGH` because it had crossed the diagnostic ten-minute delay policy. The refusal was retained and was not converted into a zero-return trade. The 24 normalized events occupied 60,066 bytes in bounded JSON form (2,656-byte median), and the version-2 profile occupied 2,030 bytes.

## Deferred work

The current screener covers only exact public wallets already requested or observed by Raven. It supports retained activity, trade count, active days, cost-basis coverage, closed lots, win rate, ROI, performance-evidence state, and deterministic sorting. It does not publish a global profitability or copyability score. Copyability is separated into $25, $100, $500, $1,000, and $5,000 follower-size evidence; unsampled sizes remain explicitly not sampled.

The following are not claimed by v1: chain-wide wallet coverage, deep historical backfill, full Token-2022 extension simulation, reliable historical liquidity, wallet relationship attribution, EVM wallets, continuous observation, automatic alerts, source-sell position mapping, checkpoint servicing, crowding allocation, live funding balances, transaction construction, signing, broadcasting, fee collection, treasury reconciliation, or live-copy performance.

The smallest post-migration move is a shared Solana observer with durable queueing and one controlled public-wallet cohort. That service should measure detection and quote latency before Raven publishes any speed or follower-capture claim.
