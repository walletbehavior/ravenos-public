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

The next activation step is one private Netcup receiver using this completed adapter contract. It must:

1. load the unique Raven watch universe;
2. subscribe once per public source wallet;
3. convert provider messages in memory into the bounded delivery contract;
4. record provider receipt before optional hydration;
5. reconnect with bounded backoff and a confirmed-RPC catch-up cursor;
6. never expose the ingest surface publicly;
7. report provider health, stream lag, queue depth, and lease recovery;
8. run a deliberately mixed shadow cohort before any speed or copyability claim.

The receiver and evaluator flags remain dormant until migration `0010`, private watch-universe delivery, finality/catch-up behavior, and operator recovery have been staged together. Live copy, signing, broadcasting, custody, and fee collection remain unavailable regardless of receiver state.

The first empirical gate remains at least seven days across high-frequency, swing, deep-liquidity, low-liquidity, concentrated-profit, and frequently refused wallets.
