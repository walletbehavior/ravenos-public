# Wallet discovery from retained Raven evidence

Default scope is all supported indexed chains, with exact-chain filtering for Solana, Robinhood, Base, Ethereum, and BNB Chain. The same EVM address on different chains remains a separate identity. Scope does not imply equal data coverage.

The screener reads the existing source-wallet, current-profile, and discovery-observation tables. It performs no provider calls and starts no history jobs. Completed profiles carry performance filters. The separate **Seen by Raven** list shows retained public observations awaiting analysis; it does not assert profitability or copyability and explicitly does not apply performance filters. Registered-address counts, completed-profile counts, and filtered matches are distinct.

Solana address lookup checks the shared retained profile first, then rebuilds a missing projection from retained normalized events. Fresh history/holdings are requested only on a cache miss or explicit refresh. Refresh reuses an analysis generated within five minutes. An unavailable refresh preserves earlier evidence and its timestamp. Deep history continues to use the existing shared, idempotent per-wallet queue. No copy policy or watch is created by browsing or inspection.

EVM lookup retains its validated chain/address-specific edge cache for one hour. An explicit refresh is allowed after five minutes. The original scan timestamp remains visible, and cached balances are not asserted to be current execution balances. This cache is per edge location, not a durable global EVM profile archive.

## Initial archive bridge

`scripts/import-retained-wallet-observations.mjs <bounded-stream.jsonl>` performs a dry run. `--apply` imports through the existing append-only discovery store and its receipt/idempotency machinery. It refuses to apply when the production discovery hydration evaluator is enabled, so an import cannot silently start a paid hydration sweep. It accepts at most 16 MiB and the existing 50,000-row validator ceiling. Reports include counts and evidence hashes, not credentials.

The September 7, 2026 initial import read a 4 MiB tail of Raven Core's already retained Constant-K stream: 515 transaction observations produced 59 qualifying candidate observations across 41 exact Solana wallet identities. Other rows lacked reviewed route or complete economic evidence and were excluded. Original observation times were September 6; import time is not represented as new on-chain activity. No RPC, transaction hydration, signing, broadcast, or copy enrollment occurred.

This is a bounded initial import, not yet continuous synchronization. Connecting a recurring archive export and importing additional EVM evidence require the same provenance and budget controls. Existing stream capture, fee policy, Pro gates, and live execution permissions are unchanged. Historical seed lists, strategy labels, simulated performance, and private user account data were not imported as wallet quality evidence.

Validation covers cache reuse across accounts, provider outage behavior, identity mismatch, explicit refresh throttling, chain isolation, observation deduplication, import replay, absence of backfill jobs during import, and browser flows for all-chain browsing, chain narrowing, and explicit inspection.
