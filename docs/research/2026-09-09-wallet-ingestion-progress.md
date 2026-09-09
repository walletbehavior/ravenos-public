# Wallet ingestion: durable progress and dedicated capacity

This is the first implementation of the wallet-depth audit. It addresses ingestion and publication bottlenecks. It does not establish GMGN parity, global holder rankings, complete lifetime P&L, or fifty qualified wallets in every category.

## Existing foundation retained

One source wallet and history job per chain/address; the same normalized event ledger, append-only page receipts, current-profile projection, historical price cache, wallet UI, and Pro access rules. No execution, signing, Copy authority, billing, referral, or fee changes.

## Capacity

A dedicated `* * * * *` scheduled invocation processes wallet history only. The existing five-minute services retain their schedule and skip their former history pass when `RAVENOS_WALLET_INGESTION_ENABLED=1`. Disabling that flag restores the prior five-minute entry point. A scheduling change can take up to fifteen minutes to propagate according to [Cloudflare's Cron Trigger documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Each pass leases at most four jobs: up to two without profiles, one existing background history, and the remaining capacity for normal demand, where customer watches retain first priority. Idle reservations lend their capacity. Chains rotate; due times, source evidence and existing atomic leases remain authoritative. Profile publication separately reserves two of four slots for initial profiles. New-wallet admission still uses cached KOL/smart-money/holder/trader provenance without fresh discovery RPCs.

EVM pages retain the eight-reference provider page, process up to eight references per pass (previously four), and alternate incoming/outgoing pages against the same confirmed pinned head. Existing cursors migrate in memory without resetting their progress. Expired provider tokens still resume inclusively with retained-event reuse. A pinned-head reorganization remains a hard stop.

The new hourly EVM history budget defaults to 6,000 RPC requests shared across supported EVM chains, configurable up to 24,000. Each pass reserves its 100-request upper bound before provider I/O and settles actual attempts once. A crash or failed settlement retains the upper-bound reservation. This is a request budget, not an Alchemy compute-unit or dollar estimate. Interactive lookups, other provider products and historical price requests are outside this backfill-specific meter. Helius's existing 600-credit/hour limit is unchanged.

## Receipt failures and accounting

An unavailable individual receipt becomes a durable retry reference. Successful normalized events are saved before the parent cursor moves. The other pages and direction can continue. Up to two due receipt retries share a pass; five failed attempts leave an explicitly unresolved gap. Provider requests remain bounded by the existing 30-second/100-request limits.

The existing append-only page ledger records each reference outcome. A small retry projection records public transaction references, minimal normalized index evidence, attempts, reason codes and cooldowns. It stores no raw receipt payload, keys or subscriber identity. A replay cannot duplicate normalized transactions, and decoded counts recover from retained evidence after an interrupted cursor commit.

Provider-index exhaustion is distinct from verified receipt coverage. Pending retries leave the job waiting; exhausted retries leave bounded partial history. Neither receives a verified complete accounting bound. The wallet profile and desktop/mobile history panel disclose unresolved receipts instead of claiming that a full 10,000-event window was retained. Missing balances remain explicitly unindexed.

## Migration and rollback

`0047_wallet_ingestion_progress.sql` adds the retry projection and hourly reservation ledger. Existing jobs, events, profiles and accounting are preserved. The 0046 number is reserved by the separate unfinished cohort worktree; this change does not overwrite or deploy that work.

Apply this additive migration before deploying this Worker. Rollback can restore the preceding Worker/cron without removing the new tables. Flag disable returns history processing to the five-minute path; existing event evidence remains available.

## Verification

Regression coverage includes all four EVM chains, receipt isolation and recovery, append-only attempts, exact chain identity, pinned heads, both transfer directions, expired cursors, retained-receipt reuse, crash replay, scheduling fairness, concurrent lease exclusion, provider-budget concurrency/idempotency, retry cooldowns, explicit UI gaps, and existing billing/auth/Copy/fee contracts.

Production baseline before this release: 35 EVM profiles (Base 9, BNB Chain 10, Ethereum 5, Robinhood 11). Hundreds of shared history jobs remained queued. Production release and post-deployment measurements are recorded separately in the operator handoff, rather than inferred from test fixtures or the discovery counter.

## Remaining depth work

- Expand qualified category cohorts from proved behavior, without padding top-fifty lists with unprofiled addresses.
- Separate protocol coverage, price coverage, cost-basis coverage and history coverage; deepen supported swap decoding and historical valuation.
- Build reconciled holder indexes or integrate a supported indexed holder feed; a twenty-wallet observed sample is not a complete holder list.
- Extend Solana analysis beyond the current 2,000-event projection using incremental accounting, and manage its Helius budget from measured utilization.
- Share public receipt evidence across wallets, archive bulky historical material economically, and reconcile incremental updates continuously.
