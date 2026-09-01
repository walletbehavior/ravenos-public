# RavenOS Constant-K Nexus discovery coverage v1

## Why this boundary exists

The active Constant-K sidecar observed on 2026-09-01 is healthy but uses `identity_backed` transaction filtering with a bounded 208-account Raven research universe. That is appropriate for exact watched-wallet latency. It cannot support a claim that Raven is continuously discovering the wider Solana trading universe.

The independent RavenOS discovery receiver therefore requires a different, exact provider contract before it reads the Nexus journal. The provider must acknowledge a transaction subscription covering the reviewed Solana swap-program registry, not merely the current identity list and not an unbounded all-transactions stream.

## Exact manifest

`ravenos.constant_k_nexus_discovery_coverage_manifest.v1` is generated from `lib/customer_trade/solana_program_registry.mjs`. The first version contains 11 reviewed program identities across Jupiter, Raydium, Orca, Meteora, and Pump venues.

The required Yellowstone transaction-filter shape is:

- commitment: confirmed;
- vote transactions: excluded;
- failed transactions: excluded;
- `accountInclude`: any exact reviewed program ID;
- `accountRequired`: empty;
- `accountExclude`: empty.

The coverage hash is deterministic over the exact filter and program registry. A label, program identity, or filter-semantics change creates a new hash. The manifest contains public program IDs only and grants no wallet, policy, subscriber, transaction-construction, signing, broadcast, custody, fee-collection, or live-copy authority.

Generate a review artifact without changing any service:

```sh
npm run generate:constant-k-wallet-discovery-manifest
```

Write one explicit staging artifact:

```sh
npm run generate:constant-k-wallet-discovery-manifest -- --output /var/lib/ravenos-wallet-discovery/coverage-manifest.json
```

The generator does not edit a service unit, contact Constant-K, activate a subscription, or create the provider acknowledgement.

## Provider acknowledgement

The Nexus publisher must independently emit `ravenos.constant_k_nexus_discovery_coverage_ack.v1` after it applies and verifies the exact manifest. The acknowledgement binds:

- provider;
- active filter mode;
- manifest ID;
- coverage hash;
- program count;
- transaction-filter count;
- activation time;
- last verification time;
- expiry.

An acknowledgement is valid for at most 15 minutes. The publisher must refresh it while the exact filter remains active. Missing, stale, future-dated, mismatched, identity-backed, or broad-all-transactions acknowledgements fail closed.

The discovery receiver validates the manifest and acknowledgement before reading a single journal byte. Its checkpoint scope includes the exact coverage hash. A program-registry change cannot silently continue from an older coverage cursor; the operator must review the new manifest and deliberately establish a new live-tail boundary.

## What this enables—and what it does not

This filter can supply a much wider stream of public wallets interacting with the listed programs. RavenOS still reduces each row to bounded signer-owned economic deltas, sends only candidate observations through authenticated ingress, hydrates the public transaction independently, and requires the existing economic decoder before admitting a wallet to history reconstruction.

Listed-program coverage is not:

- every Solana wallet;
- every Solana DEX;
- a normalized trade by itself;
- proof of profitability;
- proof of copyability;
- proof that every route can be entered or exited;
- authorization to move funds.

## Controlled activation sequence

1. Generate and review the RavenOS manifest.
2. Add manifest consumption and acknowledgement emission to the isolated Raven/Constant-K publisher workstream.
3. Replay a bounded provider sample and measure event rate, RSS, CPU, journal growth, lag, reconnect recovery, parse quality, and candidate reduction.
4. Prove the provider remains at the live tail under the reviewed-program filter.
5. Transfer only the manifest acknowledgement through the restricted one-way artifact channel.
6. Run one staging receiver cycle and verify coverage, cursor, authenticated ingress receipt, and private health output.
7. Observe hydration/backfill queue growth and provider budgets before continuous activation.

This milestone performs none of those activation steps. The current production sidecar remains identity-backed; the new discovery receiver remains default-off and cannot accept that narrower mode as reviewed-program coverage.
