# RavenOS Pro Wallet Intelligence and Raven Copy v1

Status: local, dormant, migration-safe vertical slice
Reviewed: 2026-09-01
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
2. Raven returns an immediate 24-transaction evidence window, then can enqueue one shared resumable deep-history job for the exact source wallet. The dormant worker reads 100 signatures per page and indexes up to 10,000 signatures without duplicating work per subscriber.
3. Net wallet balance changes are normalized into explicit economic events. Opposing balance changes are not called swaps without swap-route evidence.
4. Transfers, airdrops, failed transactions, liquidity operations, ambiguous activity, and unsupported activity remain separate from buys and sells. The wallet profile exposes this retained evidence through bounded cursor pages with explicit trade, buy, sell, transfer, unresolved, and other-activity filters.
5. FIFO source P&L uses exact canonical-USDC or native SOL/wSOL settlement lots. SOL returns remain SOL-denominated; Raven never converts them with a current price and calls it historical USD performance. Unknown inbound cost basis never becomes zero-cost profit.
6. The first watch refresh establishes a historical baseline and cursor. It cannot create a shadow trade.
7. A later source-wallet buy may request an exact canonical-USDC entry quote and immediate token-to-canonical-USDC reverse quote.
8. Raven checks exact mint identity, token program, quote age, latency, liquidity, price impact, round-trip friction, funding assumption, and user policy.
9. Raven records either `SHADOW_EXECUTABLE` or a named refusal. Refusals are retained and are not counted as zero-return trades.
10. Only `SHADOW_EXECUTABLE` creates a shadow position. It has no transaction hash and holds no live assets.
11. A later exact source-wallet sell is mapped only to Raven-created lots belonging to the same source wallet, watch, and mint. Raven never adopts source inventory that predates the watch.
12. A partial source sell proposes the same transaction-observed fraction against each mapped follower lot. The fraction is based only on source token accounts touched by that transaction and is never labeled as the wallet’s complete token balance. One current read-only token-to-canonical-USDC quote is shared for each exact policy and mapped quantity; unavailable or stale routes remain visible refusals and leave the lot unchanged.
13. A complete source sell closes only the remaining mapped quantity. Current position state is derived from append-only allocation evidence as `SHADOW_OPEN`, `SHADOW_PARTIAL_EXIT`, or `SHADOW_CLOSED`.
14. Source-sell evidence remains hypothetical: no live asset is held, no fee is collected, and no transaction is constructed, signed, or broadcast.

## Storage and mutability

Migration `0007_customer_wallet_copy.sql` adds a single `wallet.copy` capability to the existing grant registry. It also adds shared source wallets, append-only normalized events, append-only finality observations, append-only profile snapshots, owner-bound watches, append-only shadow decisions, shadow positions, and future checkpoint storage. Migration `0008_customer_wallet_screener.sql` adds a rebuildable current-profile projection for bounded filtering and deterministic sorting; the append-only profile snapshots remain the historical source of truth. Migration `0011_source_wallet_backfill.sql` adds one resumable job per exact source wallet plus append-only page and run evidence. Backfill reuses the same normalized event ledger and does not store raw RPC responses or hydrated transaction material. Migration `0012_shadow_copy_source_exits.sql` adds append-only source-sell decisions and exact per-position allocation evidence. Migration `0013_source_wallet_ingress.sql` adds hash-only, append-only receipts for authenticated Constant-K Nexus batches so retries can be reconciled without storing another provider payload or subscriber relationship. Migration `0014_source_wallet_discovery.sql` adds reduced off-universe candidate observations and independent Raven hydration evidence; it cannot create a watch, subscriber policy, or Copy decision. The independent discovery-firehose receiver can now feed that existing admission boundary directly from new Nexus journal rows without requiring or weakening exact watch-manifest acknowledgement. Migration `0020_source_wallet_backfill_priority.sql` adds only shared demand and evidence priority to the existing backfill job: it preserves cursor progress and retry timing and cannot retain the subscriber or policy that expressed demand. Migration `0021_source_wallet_discovery_priority.sql` ranks the broad Nexus research frontier by exact economic evidence, breadth, and bounded recurrence before hydration; raw high-frequency activity cannot monopolize the queue. None of these migrations or receivers can hold live assets, collect fees, or retain transaction construction material.

Economic events are idempotent by wallet, signature, and decode version. Processed, confirmed, and finalized observations are recorded separately so a finality upgrade does not create a second trade. Corrections require a new decode version or superseding evidence; historical decisions retain their policy and quote evidence.

Current position derivation is bounded at 2,000 Raven-created lots and 2,000 retained source-exit decisions per position view. Hitting either bound fails closed instead of silently omitting older exits or presenting an incorrect remaining balance.

Customer deletion cascades private watches and customer shadow state. Public-chain source evidence has an independent retention policy. Raw provider payloads, signer material, transaction construction material, private keys, and subscriber identities are excluded.

The activity explorer reads only Raven's retained normalized-event ledger. Each page is capped at 20 events, uses a deterministic event-time and event-ID cursor, and returns a compact allowlisted evidence projection rather than raw RPC data. It preserves exact asset base units, classification reasons, provider/finality, route programs, network fee, and timing evidence. Filtering or loading older pages never performs another Solana provider request, never changes the source cursor, and never upgrades bounded provider history into a lifetime-history claim.

## Activation and authority

All controls default off:

- `RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE`
- `RAVENOS_WALLET_INTELLIGENCE_ENABLED`
- `RAVENOS_WALLET_COPY_ROUTES_ENABLED`
- `RAVENOS_WALLET_SCREENER_ENABLED`
- `RAVENOS_SHADOW_COPY_ENABLED`
- `RAVENOS_WALLET_BACKFILL_ENABLED`
- `RAVENOS_LIVE_COPY_ENABLED`
- `RAVENOS_COPY_FEE_COLLECTION_ENABLED`

The intelligence, screener, shadow, observer, and deep-history controls can eventually expose their read-only surfaces after migration validation. The last two cannot enable live authority: live copy, signing, broadcasting, custody, transaction submission, and fee collection remain hard false in source code.

## Public benchmark, 2026-08-29

OdinBot’s public documentation describes an integrated Solana wallet screener, wallet analyzer, and discovery-to-mirroring workflow. Public filter documentation includes activity, balance, completed trades, swaps, active days, bot usage, wins and losses, hold time, wallet age, tokens, success rate, trade rate, buy size, entry market cap, P&L, and ROI. Its speed and universe-size statements are vendor claims, not independently measured here.

Sources reviewed:

- `https://docs.odinbot.io/odinbot-pro/filters`
- `https://docs.odinbot.io/odinbot-pro/wallet-analysis`
- `https://docs.odinbot.io/odinbot-pro/what-is-odinbot-pro-and-how-to-start-using-it`

GMGN’s publicly visible navigation and wallet-discovery surfaces emphasize immediate address search, categorized wallet lists, monitoring, copy controls, and low-friction movement from discovery into action. Authentication limited deeper verification during this review. No claim about GMGN’s fill quality, scoring accuracy, or internal implementation is treated as verified.

Raven’s intended advantage is not a larger headline P&L. It is the explicit split between source performance and follower reality, the reverse-exit requirement, visible reason-level refusal evidence, policy-specific shadow outcomes, and prospective copyability by order size. The profile identifies the leading blocker at the reference size, reports majority-pass size observations without presenting them as proven liquidity capacity, and shows where follower routes actually survive across detected market-cap, liquidity, and selected-pair-age regimes. It summarizes both the five-size isolated quote ladder and a separate privacy-qualified aggregate Raven-demand stress result. The latter discloses neither follower counts nor pooled capital and is not a simultaneous-fill or allocation promise.

The versioned `ravenos.source_wallet_copy_playbook.v1` projection condenses those separate observations into one deterministic trader-facing read: the contiguous tested-size window that still clears majority policy checks, the first tested breakdown size, the strongest evidence-qualified detected-market segment, +1h exact-quantity reverse-route persistence, and the leading retained refusal. It publishes no opaque score, financial advice, position-size recommendation, or live action. When any component lacks the required prospective sample, that component remains forming or unavailable instead of being inferred from source-wallet returns.

## Migration gate

Before activating continuous observation on the new RavenOS machine, validate D1 migration and backup retention, staged-origin authorization, provider subrequest budgets, queue backpressure, event lag, RPC costs, storage growth, and restart recovery. Measure p50, p90, p95, and p99 from chain event through receipt, decode, entry quote, reverse-exit proof, and decision.

The migrated RS2000 host carries the dormant shared-observer contract and durable queue described in `ravenos_shared_wallet_observer_v1.md`, while Constant-K Nexus supplies the Solana transport foundation. The authenticated manifest/delivery boundary, restart-safe dual-sink receiver, candidate intake, and independent hydration gate are implemented but remain off. Manual refresh remains the only active customer workflow until migrations `0010`–`0014`, the dedicated ingress hosts and Access policies, exact provider-manifest acknowledgement, private transport telemetry, queue behavior, and a controlled cohort are explicitly activated and verified. No public scheduler or stream is activated by this code.

The wider discovery lane additionally requires the reviewed-program coverage contract in `ravenos_constant_k_discovery_coverage_v1.md`. The active 208-identity Constant-K filter cannot satisfy it. RavenOS will not call that feed broad wallet coverage until the upgraded provider applies the exact 11-program transaction filter, emits a current acknowledgement, and passes bounded load and freshness validation.

Operators can validate one public source-wallet buy against real read-only chain and quote evidence with `npm run validate:wallet-copy-live -- --wallet <address> --source-signature <signature>`. The validator reads only the allowlisted Solana RPC and Jupiter credentials from the configured parent environment, persists nothing, hashes the public wallet and signature in its report, rejects transaction material, and has no construction, signing, submission, broadcast, or fee-collection path.

A manual refresh is deliberately bounded: at most 24 transaction fetches plus signature, mint, route, reverse-route, optional SOL conversion, and liquidity lookups. A refresh with three genuinely new qualifying buys can therefore approach 43 provider calls. It remains an activation constraint, not the scaling model. The staging shared observer instead keys one durable job by source wallet, signature, and decode version and fans out only idempotent policy evaluation.

## Read-only chain validation

The 2026-08-29 probe normalized 24 real public Solana transactions for one source wallet, distinguished nine buys, six sells, two inbound transfers, six outbound transfers, and one failed transaction, and resolved the selected asset as an exact Token-2022 mint. A hypothetical $100 follower order received an exact Jupiter entry quote and reverse canonical-USDC quote. Current executable exit was $97.381251 before the hypothetical Raven fee, producing 2.618749% market/route round-trip friction and 2.81613% including the 10 bps entry-and-exit fee scenario.

The bounded evaluation took 6.456 seconds. Entry quote latency was 234 ms and reverse-exit quote latency was 287 ms. The event was selected and invoked manually 86.754 seconds after chain time, so that number is a manual-poll baseline and not a continuous-observer speed result. The version-2 native settlement ledger reconstructed five closed lots at -0.001345826 SOL realized, -2.9259% ROI, and 20% win rate. The profile remains partial because two inbound transfers retain unresolved acquisition cost. No current or reconstructed SOL/USD price was used. Qualified liquidity metadata was unavailable and remained null; the diagnostic policy used no minimum-liquidity threshold. The complete sanitized record is `artifacts/ravenos_wallet_copy_live_validation_2026-08-29.json`.

The same event was probed again after 642.939 seconds. Its entry and reverse-exit routes were still available, but Raven returned `COPY_DELAY_TOO_HIGH` because it had crossed the diagnostic ten-minute delay policy. The refusal was retained and was not converted into a zero-return trade. The 24 normalized events occupied 60,066 bytes in bounded JSON form (2,656-byte median), and the version-2 profile occupied 2,030 bytes.

## Deferred work

The current screener covers only exact public wallets already requested or observed by Raven. It supports paginated retained activity, event-kind filtering, trade count, active days, cost-basis coverage, closed lots, win rate, ROI, performance-evidence state, and deterministic sorting. Deep history is bounded at 10,000 signatures, and each current profile snapshot openly discloses its 2,000-event analysis ceiling. It does not publish a global profitability or copyability score. Copyability is separated into $25, $100, $500, $1,000, and $5,000 follower-size evidence; unsampled sizes remain explicitly not sampled.

The following are not claimed by v1: chain-wide wallet coverage, unbounded lifetime history, full Token-2022 extension simulation, reliable historical liquidity, wallet relationship attribution, EVM wallets, an activated continuous provider connection, automatic alerts, checkpoint servicing beyond retained exit evidence, crowding allocation, live funding balances, transaction construction, signing, broadcasting, fee collection, treasury reconciliation, or live-copy performance.

The shared Solana observer contract, durable queue, Constant-K Nexus transport, exact 25,000-wallet manifest, retry/restart semantics, latency ledger, deep-history backfill, and source-sell lot mapping are implemented but dormant. The next move is one controlled public-wallet cohort measuring detection, decoding, entry/exit proof, partial-exit mapping, reconstruction coverage, storage growth, and provider cost before Raven publishes any speed or follower-capture claim.
