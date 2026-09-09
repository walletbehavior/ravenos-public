# RavenOS Dexch discovery provider v1

Updated: 2026-09-09

Status: production discovery and lifecycle enrichment were approved on 2026-09-03. The September 9 extension adds chart sourcing and holder/trader candidate ingestion. See the [provider replacement evaluation](research/2026-09-09-market-provider-replacement.md) for deployment status and measured coverage.

## Role

Dexch is a market-data provider for discovery, lifecycle context and supported chart history. Raven validates identity and freshness at the adapter boundary. Wallet performance is reconstructed separately from transaction history; provider ranks and labels do not become Raven performance or safety claims. Execution still uses the existing execution providers.

The working data flow is:

1. Dexch finds or enriches a token.
2. Raven binds the result to an exact chain and contract or mint.
3. Raven resolves an exact pool through its existing market providers.
4. Dexch or another configured provider supplies the matching candle series.
5. Raven exact-market observations add proprietary events and overlays.
6. Jupiter or the provider-neutral EVM router independently proves an executable route.

Dexch failure cannot disable the Terminal.

## Current public API evidence

The [public documentation](https://dexch.art/api-docs) and live capability endpoint were checked again on 2026-09-09.

Documented provider surface used or normalized by this implementation:

- Current live chains: Robinhood Chain and BNB Chain. Solana is no longer returned by the capability endpoint; an unsupported chain is isolated from supported results.
- Token search and filters, including new, almost graduated, and graduated presets.
- Token feeds.
- Token detail.
- Batch token lookup, bounded to 100 exact chain/address identifiers.
- Recent trades, bounded to 200 rows.
- OHLCV.
- Top holders, bounded to 100 rows.
- Global and token-scoped WebSocket channels.

Important unknowns remain explicit:

- Commercial-use rights: `UNKNOWN` in the public documentation.
- Rate-limit contract: `UNKNOWN`.
- SLA: `UNKNOWN`.
- Historical retention: `UNKNOWN`.
- Exact semantics for `safeOnly`, `dexPaid`, holder calculations, and some launch-time fields: insufficiently documented for a Raven verdict.

Observed responses use `progressBps` on a 0–10,000 scale. Raven preserves that field as basis points and does not reinterpret it as an unbounded percentage.

## Implemented integration

### Provider boundary

`lib/dexch_discovery_provider.mjs` supplies strict, bounded normalization for search, feeds, batch enrichment, detail, trades, holders, and candles.

Every normalized row preserves:

- exact canonical chain and asset identity;
- provider endpoint and retrieval time;
- response digest and byte count;
- provider-reported versus Raven-verified status;
- contradictions and unavailable fields;
- an explicit read-only, research-only execution boundary.

Requests use bounded response sizes, timeouts, cache entries, in-flight coalescing, exact allowlisted endpoints, and strict query validation.

### Discover

The on-chain pulse can request one shared, bounded cohort for each of:

- Trending
- New
- Bonding / almost graduated
- Graduated

Results are deduplicated globally by exact chain plus address before Raven resolves the exact pool. Discover can filter by token age, lifecycle state, and bonding-progress bands alongside its existing market-cap, liquidity, volume, transaction, and holder filters.

### Terminal and charts

`RAVENOS_DEXCH_CHARTS_ENABLED=1` places Dexch first for its supported chains. The normal chart source label is “Dexch market prices.” There is no provider-quality warning or “fallback” badge.

Its token-scoped candles are accepted only when the token detail and a DexScreener pool snapshot agree on the requested chain, token, pool and quote asset. History before the known pool-creation/migration boundary is excluded. Sparse bars remain sparse, with no fabricated candles. Older-page support is not advertised because Dexch documents no candle pagination parameter. A failed identity check proceeds to the next configured provider internally.

Dexch lifecycle evidence can add:

- token creation time and token age;
- migration time;
- an `M` migration marker on the exact-pool chart;
- bonding state and progress;
- a clearly qualified DEX-paid report.

Lifecycle markers are annotation-only and remain separate from Raven overlays. They cannot replace candles, update the headline price, establish a holder count, enable a trade, or change a policy decision. Neutral lifecycle markers remain visible when actionable Raven annotations are risk-blocked.

### Raven proprietary overlays

Raven continues to own exact-market annotations and overlays, including qualified observation events, participant evidence, pressure, and plan entry/target/risk levels. The chart joins those only when the canonical instrument identity matches. A provider lifecycle event and Raven overlay can coexist without either changing the underlying candle series.

### Wallet intelligence

The existing wallet universe job can consume up to 100 holder/trader candidates per market using its existing two-request reservation. It retains candidate provenance and top-holder rank, then lets the existing history/profile queues do reconstruction. No provider token-wide trade sample is written as an exact-pool trade ledger or P&L.

The provider exposes a contemporaneous wallet-entry context. It can record provider-reported token age, market cap, liquidity, launch state, and bonding progress only when the provider observation falls within a bounded window of the wallet entry observation. Current Dexch values are never substituted for historical entry conditions.

### Streams

`lib/dexch_discovery_stream.mjs` implements bounded subscription management, exact token channels, duplicate suppression, reconnect backoff, event normalization, and stream health.

Global channels are labeled sampled and are suitable for discovery, not completeness claims. Token-scoped channels preserve the provider's every-frame claim but are not treated as complete chain evidence. The client is ready for a durable receiver; it is intentionally not started inside a request-scoped Cloudflare Worker lifecycle.

### Provider health

Dexch runtime and provider health appear as non-blocking discovery-enrichment health. A Dexch outage may degrade discovery enrichment but cannot mark the core Terminal unhealthy.

## September 3 evaluation (historical)

Command: `pnpm evaluate:dexch`

Snapshot completed at 2026-09-03T19:48:48.923Z. The evaluation sampled 25 trending tokens on each supported chain and emitted no token addresses.

| Chain | Dexch search latency | Holder-count coverage | Comparable with DexScreener | Median price difference | Median liquidity difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Solana | 1,072 ms | 0% | 25 / 25 | 62.86% | 70.71% |
| Robinhood | 312 ms | 64% | 24 / 25 | 1.08% | 2.28% |
| BNB Chain | 301 ms | 4% | 25 / 25 | 0.39% | 0.22% |

This was a current snapshot, not a provider SLA. Differences can reflect different pools, aggregation, or observation times. In particular, the Solana discrepancies prove that Dexch token-level market fields must not replace Raven's selected exact-pool chart or route evidence.

Additional observed limits:

- All 25 Solana rows reported active market data but no usable holder count.
- Only one of four sampled top-holder calls returned rows.
- Sampled candle histories ranged from 1 to 60 five-minute bars, so Dexch OHLCV is not treated as guaranteed historical coverage.
- Robinhood discovery and lifecycle coverage were useful and materially more complete than holder coverage.

The documented WebSocket endpoint was also exercised on 2026-09-03. A bounded global `trade:new` subscription received 12 provider frames in 1.44 seconds. Frames included exact chain, token address, transaction hash, side, amounts, price, volume, source, trader, and provider timestamp fields. Raven normalizes the exact asset and trade evidence but deliberately omits the trader address from the discovery projection. This confirms the stream is useful for fast discovery; it does not prove complete trade coverage or chain-level observation latency.

## Runtime and release gates

Preview requires:

- `RAVENOS_DEXCH_DISCOVERY_ENABLED=1`

A release-enforced runtime also requires:

- `RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED=1`

Release packaging enables both values only when the release contract marks the provider eligible. The owner authorized production activation on 2026-09-03 after the current public Dexch documentation described API access for developers and other platforms. Chart activation also requires `RAVENOS_DEXCH_CHARTS_ENABLED=1`; wallet candidate intake requires `RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED=1`. No execution or billing permission follows from these flags.

## Resource bounds

- REST response maximum: 2 MiB.
- Shared cache maximum: 240 entries.
- REST timeout: 250 ms to 10 seconds, with endpoint defaults below that ceiling.
- Batch maximum: 100 exact assets.
- Stream subscriptions: default 64, hard maximum 256.
- Stream duplicate ledger: default 2,048, hard maximum 10,000.
- Reconnect delay: exponential, bounded at 30 seconds.

No full-node storage, raw-block retention, or unbounded wallet graph is introduced.

## Remaining work

1. Run the durable WebSocket receiver in staging and measure event delay against Raven's direct Robinhood and Nexus observations.
2. Accumulate contemporaneous lifecycle snapshots before publishing historical wallet-entry metrics.
3. Keep holder lists on Raven's independently verified Solana/EVM paths; use Dexch holder data only as visibly provider-reported enrichment if later exposed.
4. Re-run the empirical sample periodically because provider behavior is not a stable contract.
