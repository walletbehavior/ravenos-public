# RavenOS shared source-wallet observer v1

Status: staging candidate, dormant by default. No live copy, signing, broadcasting, custody, or fee collection is introduced.

## Purpose

The observer removes subscriber-proportional wallet polling. Raven observes one exact Solana public wallet transaction once, records provider and finality deliveries, decodes it once, and then fans the normalized event into any number of private Raven Copy policies.

This is the post-migration foundation for prospective wallet evidence and tomorrow's higher-speed gRPC and shred transports. It does not make a latency claim before Raven has enough prospective measurements.

## Data flow

```text
RPC poll / Geyser gRPC / ShredStream / replay
  -> bounded delivery envelope
  -> one durable job per wallet + signature + decode version
  -> lease and bounded worker pool
  -> hydrate only when normalized evidence was not delivered
  -> one exact economic decode
  -> append-only shared wallet event
  -> idempotent policy fan-out
  -> append-only latency observation
  -> processed / retry / dead-letter state
```

Provider deliveries and finality upgrades remain append-only. The job table is explicitly mutable operational state and can be rebuilt from retained deliveries. An expired lease can be recovered by another worker after a restart.

## Transport boundary

The provider-neutral delivery contract accepts:

- `rpc_poll`
- `geyser_grpc`
- `shredstream`
- `replay`

A transport may deliver either an exact signature reference or an already normalized `ravenos.solana_wallet_event.v1`. Raw provider payloads are never stored in the queue. A reference-only delivery is hydrated in memory, normalized, and discarded after the bounded event projection is written.

Every delivery requires exact:

- Solana mainnet wallet address;
- transaction signature;
- slot;
- provider and transport;
- observed finality;
- Raven receipt time;
- provider and chain time when available;
- evidence reference.

An included normalized event must match the same wallet, signature, and slot and must affirm the existing no-provider-payload, no-signer, no-transaction-material, and no-subscriber-identity boundary.

## Queue semantics

The durable job key is:

`source wallet + signature + decode version`

Multiple providers, redeliveries, and processed-to-confirmed-to-finalized observations converge on that job. A stronger finality can requeue it without creating a second economic event. Downstream fan-out must remain idempotent because a process may fail after event persistence but before queue acknowledgement.

Current hard bounds:

- 100 jobs leased per batch;
- 8 concurrent jobs;
- 120-second lease;
- 8 attempts;
- bounded exponential retry from 2 to 600 seconds;
- 64 KiB delivery envelope;
- 30-day delivery retention;
- 90-day latency retention.

Private policy fan-out is also bounded to 250 policies and four distinct exact-size quote variants per job attempt. Completed decisions are idempotent, so any remaining policy/size groups resume on the next retry without repeating source observation or economic decoding. This bound prevents a single popular wallet event from turning into an unbounded provider burst.

Malformed identity and privacy violations dead-letter immediately. Provider timeouts and transient unavailability retry. Refused or unavailable copy decisions remain downstream evidence rather than being converted into zero-return trades.

## Latency evidence

The observer records distinct timestamps and durations for:

- chain event;
- provider observation;
- Raven receipt;
- decode completion;
- fan-out completion;
- decision completion.

Summaries expose p50, p90, p95, and p99 for detection, provider, ingress, decode, fan-out, and total decision latency, including transport-specific partitions. A speed claim is not calibrated before at least 100 prospective observations.

## Activation

Both controls default off:

- `RAVENOS_WALLET_OBSERVER_ENABLED`
- `RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED`

The evaluator also requires wallet intelligence and Shadow Copy activation. Enabling either observer control never enables live copy, signing, broadcasting, custody, or fee collection.

The current staging milestone supplies the domain contract, D1/SQLite-compatible queue store, migration, bounded evaluator, a default-off hook in the existing scheduled Worker boundary, latency summary, provider-neutral transport adapters, and deterministic tests. It does not configure a new cron, public ingest route, gRPC credential, or ShredStream connection.

## Provider adapters and catch-up integrity

`lib/customer_trade/source_wallet_transports.mjs` now provides the private adapter boundary used by both polling and future stream receivers.

- A watch universe is deduplicated by exact `solana + mainnet + public address`; subscriber IDs and policies never enter the transport envelope.
- RPC polling is bounded to 250 unique wallets per run, 100 signatures per page, four pages per existing cursor, and eight concurrent wallet requests.
- Existing cursors page oldest-to-newest before they advance. If the bounded pages cannot close the gap, Raven emits no deliveries and does not advance the cursor. The result is `provider_catch_up_bound_exceeded`, not silent history loss.
- A newly requested wallet receives one explicitly partial initial page. That initial-history truncation is counted and never represented as complete lifetime coverage.
- Queue ingestion must succeed for the entire wallet batch before its cursor advances. Partial ingest is safely replayable because downstream delivery and job keys are idempotent.
- Private gRPC, ShredStream, and replay references use the same exact reference normalizer. Off-universe wallets, malformed identities, and duplicate references are rejected or deduplicated before queue ingestion.
- Raw provider messages, transactions, subscriber identity, and signer material are discarded at the adapter boundary. Only the exact reference delivery reaches persistence.

Transport health keeps provider access distinct from trading results. It reports current/degraded/unavailable state, request latency, chain-to-receipt age, error categories, reference counts, cursor advancement, gap detection, and ingest failures. RPC catch-up age is explicitly not prospective stream-detection latency. At least 100 prospective stream observations remain required before the transport is considered calibrated.

The manual `npm run validate:wallet-observer-live -- --wallet <public-address>` harness exercises configured Solana RPC access, bounded catch-up, transaction hydration, and Raven economic decoding entirely in memory. Its output hashes wallet, signature, and mint references and returns no raw provider response or transaction material. It never writes a watch, decision, position, migration, or database row.

## First read-only provider sample

On 2026-08-30, Raven sampled five public wallets from a current exact-pool trade tape through the configured adapter contract using the public Solana RPC as a deliberately weak baseline. The bounded run received and ingested 20/20 signature references, hydrated 10/12 requested transactions, and decoded two exact `SWAP_BUY` signals, one `SWAP_SELL`, two split-route swaps, four internal account movements, and one transfer-in. Signature polling measured 94 ms p50 and 116 ms p95. Successful transaction hydration measured 32 ms p50 and 34 ms p95.

The public RPC rate-limited two of twelve transaction hydrations. This is retained as provider failure evidence rather than dropped from the denominator, and it validates why the production observer needs the paid provider and fallback path. Chain-to-poll age is intentionally not reported as detection latency because the command was a manual historical catch-up, not a continuous listener. No speed claim is supported yet. The sanitized result is `artifacts/ravenos_wallet_observer_live_validation_2026-08-30.json`.

## Constant-K Nexus adapter

The provider-specific private adapter is now implemented in `lib/customer_trade/constant_k_nexus_wallet_transport.mjs`. It consumes Raven's compact Constant-K transaction frames, requires the exact watched wallet to be a transaction signer, preserves Raven's first sidecar receipt time, and emits only the bounded provider-neutral signature reference. Slot frames, unrelated messages, off-universe accounts, malformed identities, duplicate deliveries, wrong-provider rows, future timestamps, and oversized frames cannot become wallet events.

The adapter deliberately discards accounts, token deltas, matched-identity sets, filter names, and any other raw provider content before queue ingestion. A processed Constant-K observation remains processed evidence; confirmed or finalized hydration must upgrade it. The adapter never treats a captured signature as a trade, a buy signal, an executable route, or a copyable result.

`scripts/validate-constant-k-wallet-observer-live.mjs` is the bounded operator harness. It reads a private local tail, selects a small public source-wallet cohort, reduces the stream to exact references, hydrates a bounded subset through the configured confirmed RPC, economically decodes those transactions, and returns only hashed identities plus aggregate health and latency evidence. It does not persist a watch, delivery, decision, position, provider payload, or transaction.

The first authorized read-only Nexus probe ran on RS4000 on 2026-09-01:

- 2,779 valid Constant-K transaction frames and 931 slot frames were inspected;
- five exact public source wallets produced 163 watched-signer references;
- no provider mismatch, malformed row, duplicate reference, overflow, rejection, or ingest failure occurred;
- 32/32 selected references hydrated through confirmed RPC;
- the decoder kept transfers, sells, internal movement, and two observed `SWAP_BUY` signals distinct;
- chain-block-time-to-Raven-receipt measured 1,109 ms p50 and 1,568 ms p95, subject to Solana block time's one-second precision;
- confirmed RPC hydration measured 36 ms p50 and 125 ms p95;
- economic normalization measured 0 ms p50 and 1 ms p95 with millisecond timer resolution.

This proves the private transport and economic-decoding boundary. It does not support an Odin-level speed claim or a copyability claim. The sanitized evidence is `artifacts/ravenos_constant_k_wallet_observer_live_validation_2026-09-01.json`.

## Continuous receiver milestone

The restart-safe receiver contract is now implemented in `lib/customer_trade/constant_k_nexus_wallet_receiver.mjs`. It follows the compact event journal by device, inode, and exact byte offset; commits newline-complete rows only; crosses the retained `.1` rotation without skipping; and fails closed if a restart outlives the rotation window or a file truncates in place. A first start tails current data by default so historical replay cannot be mislabeled as prospective observation. An explicit beginning mode remains available for bounded operator replay.

The receiver advances its reduced checkpoint only after every exact delivery reaches the injected durable sink. A partial sink failure leaves the prior checkpoint in place, making the whole batch safely replayable through the existing idempotent D1 delivery and job keys. Malformed and oversized source rows are counted as degraded input and committed without entering the sink. The checkpoint contains only file continuity, aggregate counters, a watch-universe hash, provider slot, and hashed signature reference—never raw provider rows, wallet addresses, subscriber identity, or transaction material.

Large watch universes are dynamically chunked against the existing 1,000-reference transport ceiling. RPC polling remains capped at 250 wallets per run, while the private stream contract now accepts up to 25,000 exact public wallets. Event batches are divided by the number of matching signers—not the total subscriber count—so an idle 25,000-wallet universe does not create 25,000 queue operations. The deterministic tests cover a 1,001-wallet universe and the worst-case 250-watched-signers-per-event burst without overflow.

`source_wallet_watch_manifest.mjs` builds a deterministic private Constant-K manifest from distinct active copy watches and saved research wallets. It uses stable hash buckets with no more than 900 accounts per provider filter and contains no subscriber IDs, policies, follower counts, or signing material. `constant_k_nexus_wallet_pipeline.mjs` will not read or advance the receiver until the provider side confirms the exact manifest hash, wallet count, shard count, and current coverage. This prevents RavenOS from silently describing a partial subscription as continuous monitoring. The public/reporting projection contains only counts and hashes; exact addresses stay in the private transport manifest.

Restart, partial-line, rotation, gap, truncation, malformed-line, sink-failure, checkpoint, manifest-mismatch, large-universe, privacy, and raw-payload exclusion paths are covered in `tests/constant_k_nexus_wallet_receiver.test.mjs` and `tests/source_wallet_watch_manifest.test.mjs`.

At this milestone the receiver was still a dormant contract, not a running daemon. Activation required one private Netcup service that supplied the exact Raven watch universe and bound the receiver to the existing D1 observer ingest—not a second queue. It had to:

1. load the unique Raven watch universe through the completed D1 projection;
2. activate and acknowledge the completed deterministic Constant-K manifest;
3. subscribe once per public source wallet across bounded provider filters;
4. bind the completed rotation-safe receiver to the existing durable observer sink;
5. record provider receipt before optional hydration;
6. reconnect with bounded backoff and a confirmed-RPC catch-up cursor;
7. never expose the ingest surface without the dedicated host, Access, and HMAC controls;
8. report provider health, stream lag, queue depth, and lease recovery;
9. run a deliberately mixed shadow cohort before any speed or copyability claim.

The receiver and evaluator flags remain dormant until migration `0010`, private watch-universe delivery, finality/catch-up behavior, and operator recovery have been staged together. Live copy, signing, broadcasting, custody, and fee collection remain unavailable regardless of receiver state.

The first empirical gate remains at least seven days across high-frequency, swing, deep-liquidity, low-liquidity, concentrated-profit, and frequently refused wallets.

## Authenticated Nexus ingress milestone

The remaining machine-to-machine boundary is now implemented but deliberately inactive. `GET /api/internal/v1/wallet-observer/watch-manifest` returns the exact current public-wallet universe only after the dedicated ingress host, coordinated intelligence flag, HMAC key, freshness window, and optional Cloudflare Access service identity all pass. `POST /api/internal/v1/wallet-observer/deliveries` accepts only provider-neutral `constant_k_nexus` / `geyser_grpc` delivery envelopes from that exact acknowledged manifest.

The boundary does not accept a normalized trade, raw provider response, account list, balance delta, transaction material, subscriber identity, policy, signer, or transaction construction. RavenOS hydrates the signature through its own confirmed RPC and performs the economic decode after durable ingress. This prevents a provider label from becoming a Raven trade classification.

Each POST uses a versioned HMAC canonical request containing method, exact path, timestamp, request ID, and SHA-256 body hash. Requests expire after 90 seconds. The receiver supports current and previous key IDs for rotation, can require a separate Cloudflare Access service client, rejects query strings, requires a configured exact host, and behaves as a missing route when disabled or reached on another host.

Migration `0013_source_wallet_ingress.sql` adds append-only batch receipts containing only body/manifest hashes, key ID, aggregate counts, and timing. An identical replay returns its prior receipt without touching the queue. Reusing a batch ID with different bytes is refused. If a process stops after some idempotent deliveries but before its receipt, retrying the whole batch is safe.

`scripts/run-constant-k-wallet-observer-receiver.mjs` is the dormant receiver daemon. It:

1. fetches the exact HMAC-authenticated Raven watch manifest;
2. refuses to read Nexus until a local provider acknowledgement matches its hash, wallet count, and shard count;
3. tails only newline-complete Constant-K compact journal rows through the rotation-safe receiver;
4. reduces them to exact watched-signer signature deliveries;
5. posts batches of at most 50 envelopes to the existing D1 observer sink;
6. advances its local file checkpoint only after every HTTP batch returns a matching durable receipt;
7. writes a sanitized health document with counts and hashes, never addresses, signatures, secrets, policies, or provider payloads.

No service unit, secret, ingress host, Access policy, D1 migration, manifest acknowledgement, or feature flag is activated by this milestone. Required server gates remain off by default:

- `RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED`
- `RAVENOS_WALLET_INTELLIGENCE_ENABLED`
- `RAVENOS_WALLET_OBSERVER_ENABLED`

The receiver has an additional local hard gate, `RAVENOS_WALLET_OBSERVER_RECEIVER_ENABLED=1`. Activation requires a dedicated Constant-K subscription that actually acknowledges the Raven wallet manifest. The existing bounded Raven research identity filter must not be relabeled as 25,000-wallet RavenOS coverage.

## Nexus wallet-universe discovery milestone

The compact Constant-K stream can also propose public-wallet research candidates outside Raven's exact watch manifest. `constant_k_nexus_wallet_discovery.mjs` provides a separate read-only discovery boundary rather than weakening the exact observer contract. A candidate observation requires all of the following:

- a successful, non-vote Constant-K transaction frame;
- an exact required signer with complete signer-owned token-balance economics;
- an exact reviewed mainnet swap program identity;
- either opposing non-zero token deltas or a reviewed Pump bonding-curve buy instruction with a positive signer-owned token delta.

This is candidate evidence, not a normalized trade. It never becomes source P&L, follower P&L, a profitable-wallet label, copyability, a watch, or an execution decision. A recurring candidate only becomes eligible for independent Raven hydration and bounded history reconstruction. Admission to ranked research still requires Raven-confirmed transaction evidence and the existing accounting pipeline.

Wallet reconstruction, Nexus discovery, the operator validation harness, and Solana preflight now share `solana_program_registry.mjs`. This corrected previously copied or mistyped Raydium AMM v4, Raydium CPMM, Raydium CLMM, and Orca identifiers and added reviewed Raydium router/stable, Meteora DLMM, Pump bonding-curve, and Pump AMM identities. Exact program identity is centralized so a transcription error cannot silently turn a valid economic swap into a transfer or ambiguous event. The operator canary retains its intentionally narrower allowlist.

An authorized read-only 64 MiB Nexus sample on 2026-09-01 inspected 14,213 newline-complete frames with zero parse failures. It found 275 qualifying observations across 196 previously unwatched public-wallet candidates, including 37 recurring candidates and three candidates with at least five qualifying observations. The leading candidate had 19 exact swap-shape observations across four distinct mints. Already matched Raven signers were excluded. The sanitized result is `artifacts/ravenos_constant_k_wallet_discovery_live_validation_2026-09-01.json` and contains hashes and aggregate evidence only—no addresses, signatures, subscriber identity, raw provider payload, persistence, or execution authority.

The current Constant-K service still uses a bounded 208-account Raven research identity filter. These off-universe candidates are therefore useful proof that Nexus can expand Raven's research frontier, not a chain-wide Solana coverage claim.

## Durable candidate admission milestone

The authenticated intake and independent-admission gate are now implemented as dormant staging code. The same rotation-safe Nexus cursor can feed both the exact watched-wallet lane and the off-universe candidate lane, but it advances only after both sinks return matching durable receipts. If either sink fails, the precise frame range is replayed. Replay receipts are reported as replay work rather than inflated new inserts, and an interrupted pre-receipt write repairs the candidate projection from append-only evidence.

Migration `0014_source_wallet_discovery.sql` adds a research-frontier projection plus append-only candidate observations, independent Raven hydration evidence, and replay receipts. The candidate payload is deliberately reduced: public wallet, signature, slot, reviewed program identity, mint identities, timestamps, and categorical evidence only. It cannot contain amounts, raw provider payloads, subscriber or policy identity, transaction material, signer material, or execution authority.

A candidate becomes hydration-eligible after two qualifying observations. Raven then fetches the exact transaction through its configured Solana RPC, performs the existing economic normalization, and admits the address to the existing source-wallet/backfill system only when Raven itself reconstructs a supported swap with route evidence. A transfer, airdrop, ambiguous event, unavailable transaction, or provider timeout remains explicit non-trade/retry evidence and cannot create P&L, a screener rank, a watch, or a Copy decision.

Every activation remains independent and off by default:

- Worker intake: `RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED`
- Worker evaluator: `RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED`
- Nexus receiver candidate posting: `RAVENOS_WALLET_DISCOVERY_RECEIVER_ENABLED`
- The existing wallet-intelligence and bounded-backfill controls must also be active before evaluation can run.

The intake requires its own exact host, HMAC identity, rotation-ready key pair, and optional Access service identity. These controls are intentionally separate from the watched-wallet ingress credentials. No migration, flag, secret, ingress host, service unit, or provider subscription is activated by this milestone. Live copy, signing, broadcasting, custody, and fee collection remain unavailable.

## Independent Nexus discovery-firehose receiver

`scripts/run-constant-k-wallet-discovery-receiver.mjs` decouples broad candidate discovery from the manifest-bound exact observer lane. This matters because a high-throughput Nexus stream can expose economically shaped swap participants even when the provider has not yet acknowledged Raven's full exact-watch manifest. The discovery receiver therefore never fetches or claims the active watch universe and cannot create a watch, normalized trade, wallet return, Copy decision, position, or execution object.

The receiver starts at the live tail on first activation. Every subsequent newline-complete batch is reduced locally to the existing reviewed-program and exact-signer-owned-economic-delta candidate schema. Only the reduced observations cross the authenticated discovery ingress. Raw Nexus frames, token amounts, subscriber identity, policies, follower counts, and pooled follower capital do not. Candidate observations still require independent Raven RPC hydration and the existing economic decoder before admission to history reconstruction or the screener.

Its cursor is independent from the exact observer cursor. It advances only after every reduced candidate batch receives the existing matching HMAC-authenticated durable receipt. A refused or unavailable sink leaves the prior cursor intact so the same byte range is replayed through the idempotent ingress protocol. Malformed and oversized source rows are counted and committed as degraded input instead of becoming wallets. Health output contains aggregate throughput, reduction, ingress, continuity, and cursor state only.

Before reading any journal byte, the receiver now requires `ravenos.constant_k_nexus_discovery_coverage_manifest.v1` and a matching short-lived provider acknowledgement. The manifest is deterministically generated from Raven’s 11 reviewed Solana swap-program identities. An identity-backed, broad-all-transactions, stale, future, incomplete, or mismatched acknowledgement is refused before the cursor can move. The checkpoint scope includes the exact coverage hash, so a provider-filter change cannot silently inherit an older cursor. The full contract and controlled activation sequence are documented in `ravenos_constant_k_discovery_coverage_v1.md`.

The new local gate is `RAVENOS_WALLET_DISCOVERY_FIREHOSE_RECEIVER_ENABLED=1`; it is off by default and is not configured in Wrangler. The Worker ingress and evaluator remain separately gated. The dormant process can be started through `npm run run:constant-k-wallet-discovery-receiver` after the migration owner provisions the dedicated ingress identity, local event path, state directory, and service supervision. Activating it still does not establish chain-wide coverage or exact watched-wallet monitoring. The latter continues to require the provider-side manifest acknowledgement enforced by `run-constant-k-wallet-observer-receiver.mjs`.

### Host-local candidate census

The receiver no longer sends every reduced firehose observation to D1. Before its source cursor can advance, it writes each unique candidate observation to a private, mode-`0600` SQLite census on the RavenOS host. One-off activity remains local and expires. A wallet becomes eligible for its initial bounded remote research round only after at least five qualifying observations, two distinct mints, and sixty seconds of observed activity. Ranking uses only recurrence, mint breadth, and exact economic-shape evidence; subscriber demand, follower capital, returns, and copy outcomes are unavailable to the census.

An initial promotion carries five mint-diverse evidence rows so the existing independent-hydration gate can verify recurrence without trusting a local aggregate. A promoted candidate may send one newer refresh observation after 24 hours. At most eight rounds are created per cycle, 100 per hour, 1,000 per day, and 50 observations are placed in one outbound request. The budgets and queued outbox survive process restarts.

Crash behavior is intentionally replay-safe:

- a stop before local staging leaves the source cursor unchanged;
- a stop after local staging replays the same raw rows into the local observation-ID dedupe;
- a stop after remote receipt but before local acknowledgement re-posts the same observation IDs into D1's existing idempotent receipt boundary;
- a stop after local acknowledgement but before cursor persistence cannot re-promote the delivered evidence.

The local health projection exposes only aggregate candidate, backlog, evidence-state, and rate-budget counts. It contains no address, signature, raw Nexus row, subscriber identity, policy, outcome, transaction material, or execution authority. Default retention is 36 hours for unpromoted candidates, 90 days for promoted candidates, 48 hours for raw replay IDs, and seven days for delivered evidence. The census and receiver remain dormant until their existing independent activation gates and private service supervision are explicitly approved.

## Shared prospective copyability milestone

Raven can now evaluate one admitted, prospectively observed source-wallet buy against the standard follower-size ladder of $25, $100, $500, $1,000, and $5,000. This is shared source-level research, not subscriber fanout. Each size receives its own exact current entry quote and reverse-USDC exit quote through the existing Raven Copy provider boundary. Asset identity, liquidity, detection delay, price impact, entry degradation, round-trip friction, policy outcome, provider failure, and a hypothetical Raven fee scenario remain explicit.

Migration `0015_source_wallet_copyability.sql` adds an append-only observation ledger keyed by source event, exact order size, hypothetical fee scenario, and versioned research policy. Rows contain no user ID or watch ID, never create a shadow position, and cannot contain transaction material or a transaction hash. Approved, refused, unavailable, stale, and indeterminate probes all remain in the denominator. Historical source returns are never substituted for prospective follower evidence.

The five-size matrix is deliberately economical: shared token-standard, mint-authority, source-notional, and liquidity context is loaded once per source event, while only the size-dependent entry and reverse-exit routes vary. A later customer policy may reuse this research for screening, but exact user-size quotes remain mandatory for any future live execution.

The Raven Pro wallet profile can consume this shared matrix before a subscriber shadows the wallet. It shows sample counts and policy-pass rates immediately, but publishes a 0–100 Copyability score for an order size only after at least 20 prospective observations with sufficient entry and exit evidence. The reference headline uses $100 evidence and the full five-size capacity rail remains visible.

Migration `0017_source_wallet_copyability_projection.sql` adds a rebuildable current projection for the Pro screener. It lets traders filter and sort by prospective sample size, entry availability, verified-exit rate, policy-pass rate, round-trip friction, and mature $100 Copyability without rescanning every append-only route observation on each request. Current scores are bound to an exact versioned policy-matrix hash; superseded policy observations remain in history but are never mixed into the current score.

Migration `0018_source_wallet_detection_market_context.sql` retains the exact-token market Raven observed while producing the prospective route proof. For each source signal, Raven records at most one selected-pair context even though it tests five follower sizes. The rebuildable wallet projection exposes coverage plus median detected market cap, liquidity, selected-pair age, source-notional/liquidity footprint, and observation delay. The selected pair is the highest-liquidity exact-token pair Raven saw near detection; it is not represented as the source wallet's pool, source fill context, or token age. Current market state is never used as historical fill evidence.

These dimensions make the screener more useful before live copying: a researcher can distinguish wallets whose prospective trades repeatedly appeared in deeper markets from wallets whose source orders were large relative to detected liquidity. Missing context remains unavailable rather than zero, and five follower-size quotes cannot inflate the market-context sample count.

Migration `0019_source_wallet_copyability_checkpoints.sql` adds the prospective outcome layer. For every due source signal and horizon (`30s`, `60s`, `90s`, `5m`, `15m`, `1h`, `4h`, and `24h`), Raven requests one exact-quantity liquidation quote for the source wallet's received tokens and re-quotes each follower size's exact expected quantity. The source quote is shared across the five sizes; follower quotes remain size-specific. Provider failures are retained with unavailable economics, never a fabricated zero return.

The current screener reference is the $100 follower at +1 hour. It exposes route persistence, median net follower return, follower win rate, alpha retained when the source counterfactual return is positive, and the follower-minus-source return gap. The source comparison is a same-horizon counterfactual liquidation, not the source wallet's actual exit or realized P&L. Every follower value is an expected read-only quote, not a fill. Alpha retained is intentionally uncapped so negative capture and values above 100% remain visible instead of being cosmetically normalized.

The entry evaluator is independently dormant behind `RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED`; the outcome evaluator has the additional independent gate `RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED`. Both require the coordinated wallet-intelligence, Shadow, and shared-observer evaluator gates. No Wrangler binding or production flag is added. Migrations `0015`, `0017`, `0018`, and `0019`, observer activation, live copying, signing, broadcasting, custody, and fee collection remain outside this milestone.

## Nexus research-cohort milestone

The discovery-to-copyability loop is now closed without making every provider candidate look like a trader. A wallet still needs recurring reduced Nexus evidence, independent Raven transaction hydration, an economically normalized swap with route evidence, and admission into the existing bounded backfill system. Only then can Raven add it to a shared prospective research cohort.

Migration `0016_source_wallet_research_cohort.sql` adds bounded operational membership for those verified public wallets. Membership is not a profitability, smart-money, or copyability label. The append-only discovery observations and hydration rows remain the admission evidence; the cohort row only determines which verified wallets deserve continuing observation.

The exact manifest always reserves capacity for active customer watches and saved research wallets first. Remaining capacity may be filled by at most 20,000 active research-cohort wallets, ranked by transparent recurrence and mint-breadth evidence. The overall Constant-K manifest remains under its existing 25,000-wallet hard ceiling and still contains no user IDs, policies, follower counts, balances, or execution material.

This closes the intended shared pipeline:

`Nexus candidate → Raven hydration → bounded backfill/profile → research cohort → prospective observer → five-size entry/exit evidence → screener and wallet profile`

The bounded-backfill stage now has demand-aware scheduling through migration `0020_source_wallet_backfill_priority.sql`. A customer watch outranks a saved wallet, which outranks an interactive lookup, verified Nexus research, and bulk indexed research. Repeated demand upgrades the existing shared job rather than cloning it, and higher Nexus evidence can improve research order within its lane. Cursor progress and retry cooldowns are never reset by a priority upgrade; subscriber identity never enters the queue.

Migration `0021_source_wallet_discovery_priority.sql` makes the earlier Nexus hydration gate safe under a much wider candidate stream. Raw transaction frequency no longer determines who is inspected first. Raven uses a versioned 0–1000 research priority made only from the candidate evidence already retained: recurrence, distinct-mint breadth, evidence tier, and the share of observations with exact opposing token deltas. The exact-delta component is deliberately stronger than volume, so a smaller wallet with diverse exact economic evidence can outrank a repetitive high-frequency candidate. Recency is a deterministic tie-breaker. This score schedules independent hydration only; it is not a profit, identity, safety, or copyability label.

## Privacy-safe aggregate demand stress

Migration `0022_source_wallet_copy_crowding.sql` closes the gap between an isolated follower quote and Raven-wide follower demand. At detection time Raven snapshots every eligible active fixed-USDC Shadow policy for the source signal once, removes subscriber and watch associations, and requests one exact aggregate entry plus reverse-exit quote. Unsupported sizing, provider failures, excessive aggregate notional, constrained economics, and unavailable routes are all stored explicitly rather than dropped or converted to zero.

The internal append-only record may retain a policy count and aggregate notional solely to reproduce route stress. The wallet profile never receives either value. A source signal contributes to the public summary only when its internal demand cohort meets the minimum privacy threshold of five; the profile publishes only privacy-qualified source-signal samples, route survival percentages, and a dominant constraint. The result is not a simultaneous-fill, allocation, pool-capacity, or live-execution promise. `RAVENOS_WALLET_COPY_CROWDING_ENABLED` remains independent, default-off, Shadow-only, and absent from release configuration.

That same versioned evidence score now survives admission into the long-running research cohort. Raven no longer replaces it with the older activity-heavy cohort ranking. A newer admission can raise or lower current scheduling priority as the exact-delta share changes; an older replay cannot overwrite newer evidence. The manifest remains subscriber-free and the score still controls research attention only.

The prospective matrix now retains a reason-level refusal fingerprint at every standard follower size. The wallet profile can identify the leading observed blocker at the $100 reference size, while the matrix reports the largest tested size with a majority of policy-approved routes and the first tested size below that threshold. These are transparent sample statements, not a pool-capacity claim. Unavailable, stale, policy-rejected, and provider-failed routes remain in the denominator and never become zero-return trades.

The same exact $25 / $100 / $500 / $1,000 / $5,000 ladder now produces a versioned route-size stress summary. Raven reports full-ladder coverage, median entry and reverse-exit price impact by tested size, majority-pass continuity, and non-linear evidence. This remains isolated quote evidence. It does not expose subscriber counts or capital, assume batching, or present one route quote as proof that simultaneous followers can all receive it.

Follower reality is also segmented by the exact-token market context Raven observed near each prospective signal. The first version uses explicit, stable buckets for detected market cap (`<$200K`, `$200K–$750K`, `$750K–$2M`, `$2M+`), detected liquidity (`<$25K`, `$25K–$100K`, `$100K–$500K`, `$500K+`), and selected-pair age (`<5m`, `5m–1h`, `1h–24h`, `1d+`). Each bucket retains entry availability, exit availability, policy-pass rate, friction, and its leading refusal reason at the $100 reference size. A segment needs 20 prospective signals before Raven calls it evidence-qualified. Pair age is never relabeled as token age, and the selected exact-token market is never claimed as the source wallet’s execution pool or fill.

`ravenos.source_wallet_copy_playbook.v1` is a deterministic read model over this existing evidence. It surfaces the contiguous majority-pass size window, first qualified size breakdown, strongest evidence-qualified market segment, +1h route persistence, and leading refusal in one compact profile block. It creates no score, recommendation, position, transaction, or live authority; every unavailable or under-sampled component remains explicit.

The cohort is independently dormant behind `RAVENOS_WALLET_RESEARCH_COHORT_ENABLED`. Admission also requires the discovery and backfill gates; manifest inclusion also requires the observer-ingress gates. The flag is absent from Wrangler. No migration, service, manifest change, observer activation, live copy, signing, broadcasting, custody, or fee collection is performed by this milestone.
