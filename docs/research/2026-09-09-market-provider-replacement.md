# Existing provider replacement evaluation

Implementation status: local source changes and live public-API evaluation, not deployed by this change. No subscription purchase, overage activation, financial transaction, or provider cancellation was performed.

The aim is to replace overlapping CoinGecko work where the existing sources can supply it. Dexch is a normal chart provider, presented as “Dexch market prices,” without a lesser-provider badge. Identity failures are internal routing decisions; source and actual freshness remain accurate.

## Provider assignments

| Source | Useful work now | Boundary |
| --- | --- | --- |
| Dexch | BNB/Robinhood discovery, lifecycle, token context, holder and trader candidates, qualifying OHLCV | Current deployment supports BNB and Robinhood. Candles are token scoped; selected pool and quote identity must agree before use in Raven's pool chart. |
| DexScreener | Exact token/pool identification; price, liquidity, volume, transactions, market cap/FDV and pool age | No documented complete wallet history or OHLCV API. Profiles are candidate seeds, not quality rankings. |
| Existing Jupiter | Solana discovery, route quotes and execution | Existing execution fee policy is unchanged. |
| Existing Helius/Alchemy | Wallet history and transaction reconstruction | Holder candidates must pass through the existing history and profile pipeline before performance can be claimed. |
| DexPaprika | Existing exact-pool chart adapter; pool search, liquidity and activity coverage available for evaluation | Formal API terms §3.6 restrict commercial use to non-Free plans. No paid plan was purchased or commercial gate removed. |
| CoinGecko | Still-configured chart/market coverage where other sources cannot establish the required market | Its observed account credit exhaustion must not keep triggering repeated discovery requests. This change does not cancel the account. |

Sources checked September 9: [Dexch API](https://dexch.art/api-docs), [DexScreener API](https://docs.dexscreener.com/api/reference), [DexPaprika API](https://docs.dexpaprika.com/introduction), [DexPaprika formal terms](https://dexpaprika.com/api/terms).

## What changed

Discover uses retained Raven tokens before bounded public profile/search seeds, then batches at most 30 token addresses per chain through DexScreener. A covered chain no longer spends CoinGecko trending calls. An uncovered chain attempts one configured CoinGecko page instead of three. Public GETs use shared edge caching, bounded local caches, request coalescing, timeouts, streamed response limits, redirect rejection and provider backoff. Credentialed responses remain outside the public edge cache; credentials are excluded from public cache keys. Observation timestamps survive cache reuse.

These are request controls, not a global provider dollar budget. Public edge caches are scoped to the serving cache location. Wallet candidate ingestion retains its existing D1 reservation of two requests per market and 48 requests per hour by default. Historical wallet processing keeps its separate budgets.

Dexch capability discovery prevents an unsupported Solana query from breaking BNB/Robinhood results. Cached capability changes and failures are isolated by chain. Top-holder and recent-trader samples now enter the existing wallet registry without creating a transaction ledger, P&L or Copy enrollment. Existing profiles/cursors remain untouched.

Dexch chart requests support 1m, 5m, 15m, 1h, 4h and 1d. Raven checks the chain, token, selected pool and quote asset against a DexScreener pool snapshot. Only candles after the known pool-creation/migration boundary qualify. Invalid candles are rejected; sparse intervals are not interpolated. Older-page support is not advertised. Canonical instrument identity remains independent of provider so a compatible provider transition does not change the selected market.

Flags: `RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED` and `RAVENOS_DEXCH_CHARTS_ENABLED`. Existing Dexch enablement/commercial acknowledgment still applies. No database migration is added here.

## Measured evidence

The [immutable snapshot](2026-09-09-market-provider-replacement-snapshot.json) was captured at 2026-09-09T12:32:38Z by the local Worker using live public GETs and no API keys:

- Discovery: 2,493 ms; 77 retained-result candidates — Solana 6, Base 4, BNB 32, Ethereum 1, Robinhood 34. Every chain had a result, but Base/Ethereum cold-start breadth remains thin. These are sampled market rows, not wallet profiles or a complete token census.
- BNB BREW/WBNB: 240 one-minute candles, verified identity/continuity, 639 ms. Dexch selected normally with no CoinGecko request.
- Robinhood CHART/ETH: not accepted into the exact-pool chart. Dexch reports pool `0x8366a39cc670b4001a1121b8f6a443a643e40951` and wrapped ETH, while DexScreener identifies a V4 pool `0x1a3b0b30dd0ddba010d2b4e269fbd68d76d78dcbbcdc78a084a8ab4613b8db96` with native ETH. No alias or conversion was invented. Dexch's raw candle endpoint itself returned 240 bars in the earlier public probe; pool identity is the remaining integration issue for this anchor.

Reproduce with `node scripts/evaluate-market-provider-replacement.mjs <new-output-path>`. The script refuses to overwrite a prior result. No credentials or wallet/RPC calls are used. It demonstrates independence on successful routes, not the current CoinGecko quota.

## Verification and remaining work

The focused suite covers provider caching/backoff, chain isolation, timestamp preservation, malformed/mismatched chart data, migration cutoffs, sparse bars, ordinary chart labels, full Worker chart/discovery routes, wallet candidate provenance and the existing universe budget. Existing chart and wallet regressions are included.

Before a complete CoinGecko replacement: resolve Robinhood V4 pool identity with source evidence, qualify remaining chain/timeframe coverage, deepen cold-start Base/Ethereum seeds using retained market data, and confirm the terms of any additional production source. The existing release preflight requires dense one-minute charts across the advertised chains; this change does not waive that requirement or claim production rollout from a local API probe.
