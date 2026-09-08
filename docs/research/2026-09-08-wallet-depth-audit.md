# Wallet depth: production audit and recovery sequence

The wallet universe counts discovered addresses. It does not count complete analyzed histories. Raven's discovery, collection, decoding, valuation and profile publication have materially different coverage. The UI shipped ahead of a pipeline capable of maintaining that universe.

## Measured evidence before the profile fix

Signed-in production inspection on September 8 found 19,957 discovered EVM addresses across Robinhood, Base, Ethereum and BNB, but only 15 analyzed profiles in the initial UI snapshot. Counts can change as inspections and jobs run. Two subsequent manual lookups succeeded; a universal auth/UI failure does not explain the missing depth.

| Chain | Discovered addresses in UI snapshot | Analyzed profiles | Retained top-holder category entries |
| --- | ---: | ---: | ---: |
| Robinhood | 9,020 | 10 | 60 |
| Base | 3,814 | 3 | 40 |
| Ethereum | 3,250 | 1 | 20 |
| BNB | 3,873 | 1 | 0 |

These holder entries are retained observations, not a complete global holder ranking. Default minimum-trade, active-day and recency filters can hide transfer-only profiles. An inspected profile does not necessarily contain a reconstructed trade or known cost basis.

A later read-only D1 query, before this fix, found:

| Chain | Wallets with retained latest events | Those without a current profile | Retained events |
| --- | ---: | ---: | ---: |
| Base | 7 | 5 | 180 |
| BNB | 10 | 8 | 184 |
| Ethereum | 5 | 4 | 20 |
| Robinhood | 10 | 1 | 63 |
| Solana | 34 | 1 | 46,343 |

This query covers wallets in the receipt/event index, a smaller population than the discovery index. It demonstrates that even already-collected evidence was failing to publish.

## Confirmed defects and limits

1. **Initial EVM profile publication was broken.** `persistSourceWalletProfile` used EVM accounting only when an EVM basic profile already existed. Otherwise chain-neutral events went to the Robinhood-only builder, which rejects Base, Ethereum and BNB. A manual lookup created the missing basic profile and accidentally bypassed the defect. New regression tests reproduce the failure through the real D1 job/event pipeline.
2. **Processing capacity remained very small.** The production five-minute scheduler selects at most four wallets. Each EVM job processes four transaction references per run. That is at most 192 references/hour across the service, before Solana competition, retries or errors. A transaction reference is not necessarily a decoded swap. The profile publisher separately selects four candidates.
3. **Initial lookup is deliberately shallow.** It takes bounded transfer pages, up to 12 receipt candidates and the first 24 token balances. Dust and incoming distributions can occupy much of that sample. Backfill processes inbound history before outbound history.
4. **Receipt failures stall progress.** The audit found 188 unfinished EVM jobs, including 12 retrying `evm_wallet_backfill_receipt_incomplete`. One failed reference prevents a page from advancing. That error combines several causes; the individual failing receipts still require diagnosis.
5. **Decoding and valuation are incomplete.** Current EVM accounting recognizes verified supported V2/V3 pool routes and supported native legs. Unsupported protocols, incomplete native evidence and unmatched inventory remain unknown. Current marks and historical acquisition prices are separate requirements. Sampled profiles had many unpriced balances and little or no matched sell history.
6. **Solana is also constrained internally.** The default Helius allowance is 600 credits/hour, and analysis reads at most 2,000 events even when a deeper archive is retained. Those are Raven settings, not Helius's maximum history depth.
7. **Holder lookup is a sample.** EVM observed-holder lookup starts with known market wallets or one recent transfer page and checks up to 20 balances. It cannot establish full holder counts or a global top-50 ranking.

## Fix in this change

Background EVM materialization now uses the existing EVM profile model without requiring an earlier interactive lookup. Refreshes rebuild activity coverage from retained events while preserving actual balance observation timestamps. Receipt history cannot create a fresh balance snapshot. A partial window with a pinned end block cannot use unverified opening balances as if the window were complete.

No new wallet, accounting ledger, provider, database migration or live-trading behavior is introduced. Legacy Robinhood and Solana profile paths remain. The normal wallet-history test command now includes the EVM reconstruction and durable-history suites that previously ran separately.

The fix publishes collected evidence. It does not create missing trades, prices, balances or complete histories.

Validation: 120 wallet-history tests pass, including four first-profile chain cases and a verified buy/sell inventory case. The 1,029 contract tests and all configured pretest suites pass. Production build, security validation, public-asset redaction and 37 Worker response checks pass. Post-deployment publication counts are recorded separately in the release verification receipt.

## How to fill depth

### 1. Publish and account for existing work

Drain missing-profile work from the existing index first. Track discovered, queued, history-started, history-covered, decoded, priced and published separately per chain. Record safe reason codes for failures and age of the oldest unfinished work. Prioritize first profiles without starving active user requests.

### 2. Give ingestion sustained capacity

Use the existing durable queue with a dedicated ingestion runner or queue consumers. Separate interactive refresh, initial coverage and deep history work. Benchmark request costs and database writes on 100 wallets per EVM chain before increasing concurrency. Apply per-provider rate and daily-cost limits; do not simply remove limits from the shared web Worker.

Persist progress per transaction reference. Retry missing receipts separately with explicit coverage holes. One malformed or unavailable receipt must not repeatedly discard the rest of a successful page. Fetch and retain shared receipts by chain, transaction hash and block hash, with shared block, metadata and historical-price caches.

### 3. Populate an evidence-backed initial cohort

Start from Raven's known KOL, smart-money, top-trader and holder observations. Build the first 50 qualified wallets per category per supported chain, deduplicating overlapping groups. A category with insufficient evidence must show that shortage rather than fill its quota with arbitrary wallets.

Obtain an initial useful history slice, then complete the configured 30-day window in both directions. Extend backward where required to establish acquisition lots and wallet age. Cover active wallet-initiated transactions early so inbound dust does not monopolize the queue. Solana should use full Helius history with token-account activity; EVM should page transfers and reconcile receipts/native legs using verified chain capabilities.

### 4. Finish the analytical evidence

Measure the undecoded transaction mix on those cohorts. Add the highest-volume missing protocols with receipt-backed fixtures, reconcile native spending/refunds and gas, and enrich exact token identities and historical prices. Keep transfers, bridges, rewards and trading P&L distinct. Add a real holder index or a verified provider holder dataset before claiming complete rankings.

### 5. Maintain incrementally

Serve saved profiles immediately. Refresh only stale or missing evidence, advance from stored checkpoints, and use supported streaming/webhook inputs where verified. Reuse public-chain evidence across profiles; do not refetch each wallet's entire history when somebody opens a card.

### Acceptance measurements

- Each initially published wallet opens from the retained profile store.
- Cards expose 1/7/30-day observed transaction counts, coverage dates, last indexed time and age evidence.
- Profiles separate decoded trades, priced holdings, known cost basis, realized P&L and unknown values.
- Publish profile throughput, receipt failure rate, coverage completeness and provider cost per analyzed wallet.
- Report category qualification and shortages separately from raw universe size.
- Benchmark freshness under load before claiming an update-latency target or GMGN-level parity.

## Current provider documentation

Helius currently documents up to 1,000 full transactions per request, associated-token-account coverage and unlimited mainnet retention: [getTransactionsForAddress](https://www.helius.dev/docs/rpc/gettransactionsforaddress). Its published metering is 10 credits per 100 full transactions returned, rounded up: [credits](https://www.helius.dev/docs/billing/credits). One million returned full transactions would therefore be approximately 100,000 history credits with full pages, excluding other endpoints, retries and storage; this is not a total operational cost estimate.

Alchemy's [Transfers API](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers) supports pagination. Its documented internal-transfer coverage is limited to Ethereum, Polygon and Base mainnet. Robinhood and BNB native reconstruction must be capability-verified separately; token balances alone do not supply swap P&L or a global holder ranking.
