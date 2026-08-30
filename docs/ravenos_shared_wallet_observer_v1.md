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

The current staging milestone supplies the domain contract, D1/SQLite-compatible queue store, migration, bounded evaluator, a default-off hook in the existing scheduled Worker boundary, latency summary, and deterministic tests. It does not configure a new cron, public ingest route, gRPC credential, or ShredStream connection.

## Next adapter milestone

When the Constant-K endpoint and credentials are available, add one private Netcup adapter that:

1. loads the unique Raven watch universe;
2. subscribes once per public source wallet;
3. converts provider messages in memory into the bounded delivery contract;
4. records provider receipt before optional hydration;
5. reconnects with bounded backoff and a confirmed-RPC catch-up cursor;
6. never exposes the ingest surface publicly;
7. reports provider health, stream lag, queue depth, and lease recovery;
8. runs a deliberately mixed shadow cohort before any speed or copyability claim.

The first empirical gate remains at least seven days across high-frequency, swing, deep-liquidity, low-liquidity, concentrated-profit, and frequently refused wallets.
