# EVM history and holder recovery

The production history queue could not get past bulk distributions on Robinhood, Base, BNB Chain and Ethereum. A reproduced Robinhood receipt contained 2,000 Transfer logs (1,270,772 compact bytes). Raven rejected receipts above 1 MiB or 500 logs and saved no history page for that wallet. The shared Blockscout holder API also returned non-JSON 502/503 responses in all four chain probes.

## History

The shared receipt reader now permits complete receipts up to 4 MiB / 4,096 logs. Other RPC responses retain their 1 MiB ceiling. Streaming enforces the byte cap even without Content-Length. Initial lookups retain at most 8,192 receipt logs and fetch at most two receipts concurrently. Deeper backfills still process four references per run, at most 100 requests / 30 seconds, across a pinned 30-day window with a 10,000-reference cap. Neither raw transactions nor provider credentials are persisted.

Receipt identity, status, block hash, transfer amounts and pool verification remain required. Large distributions are transfers, not purchases or trading profit. Path verification now uses linear graph traversal instead of repeated full-log scans. Receipts beyond the limits or with inconsistent evidence still stop at the unverified reference; no complete-history claim is made for them. Provider errors retain their specific sanitized failure code rather than becoming a generic missing-receipt error.

A real read-only Robinhood canary advanced the formerly blocked wallet `0x110d57ea4dbb4d050a19014bba276acd703a3609`: four verified events, including three 2,000-log distributions, with 50 RPC reads. Existing durable cursors, replay deduplication, per-chain queue fairness, cost-basis rules, and profile refreshes are unchanged.

## Holders

Cached holder projections remain first. On a shared Blockscout availability failure, Base and Ethereum can use their official chain-instance endpoints without forwarding the Pro key. No fallback masks a successful wrong-token response. If indexed holders remain unavailable, Raven uses the existing Alchemy chain connection to verify an observed wallet sample:

1. Select up to 20 cached exact-market wallet observations from the last day.
2. Only if none exist, request one descending token-specific transfer-index page of 20 rows.
3. Verify chain identity, confirmed block, token precision/supply, each candidate's balance and contract status, and the block hash again before returning.
4. Reuse the existing holder cache and single-flight operation. No new wallet-history job is launched by a holder read.

The sample has a 48-request / 15-second budget, not counting the bounded explorer attempts. A real Robinhood sample returned nine positive balances (two externally owned accounts and seven contracts), all 14 candidates checked, in 1.99 seconds with 35 RPC reads. Base and Ethereum direct-instance probes returned 50 ranked rows each. Provider availability can vary by network location; the balance fallback handles that too.

Sampled holders do not become a top-holder census, top-holder discovery ranking, or global concentration metric. Total holder count stays unknown. The UI names the sample and confirmed balance timestamp, preserves full addresses and wallet-profile links, and leaves global concentration unavailable. This is useful current holder evidence, not GMGN-wide indexed-holder parity.

## Wallet discovery

An empty analyzed/filter view now offers a direct button into the chain's cached discovered wallets. Switching views preserves performance filters and does not silently treat unknown metrics as passing. Browsing does not start RPC history calls; inspecting a wallet uses the existing shared history system.

## Verification and rollout

Regression tests cover 2,000-log receipts with the wallet leg at the end on all four EVM chains, byte/log ceilings, corrupted receipt identity, cached-first holder candidates, chain/token isolation, current-balance checks, reorgs, explorer key isolation, sample-versus-ranking behavior and mobile navigation. Existing wallet reconstruction, lookup, history queue, market risk and holder tests are retained. No migration or new credential is required. Existing EVM holder and Alchemy feature flags control this path. Financial execution, Copy authority, billing, fee and reward settings are untouched.

Primary API references: [Alchemy Transfers API](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers), [Robinhood API capabilities](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview), [Blockscout Pro and per-instance routes](https://docs.blockscout.com/devs/pro-api-responses-and-routes).
