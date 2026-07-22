# RavenOS market-data plane v1

Status: implementation baseline, not production-promoted

Date: 2026-07-22 UTC

Scope: read-only chart discovery, exact identity, OHLCV, active-view updates, and Raven overlays

## Decision

RavenOS keeps one Lightweight Charts renderer and normalizes multiple authoritative feeds beneath it.

The base-chart precedence is:

1. venue-native OHLCV where a venue exposes exact market data (Hyperliquid);
2. exact-listing Atlas market history for equities and ETFs;
3. exact-pool CoinGecko Onchain OHLCV for supported on-chain markets;
4. a last-good response from the same exact provider market, visibly marked degraded;
5. no chart.

DexScreener resolves instruments and current pair state. Raven observations supply annotations, events, overlays, and intelligence. Neither source is allowed to become replacement OHLCV.

The implementation is in:

- `ravenos-chart-data-plane.js` — canonical candle/event primitives and capability registry;
- `worker.mjs` — server-side provider adapters, cache, provenance, and fail-closed precedence;
- `ravenos-price-workspace.js` — renderer-independent history, backfill, polling, and venue-live subscriptions;
- `raven-price-chart.js` — preserved Lightweight Charts renderer;
- `ravenos-shell.js` and `ravenos-terminal-live.js` — search ranking and visible availability derived from the registry.

## Provider comparison

The table separates published provider claims from RavenOS live probes. Pricing and terms are dynamic and were checked on 2026-07-22.

| Source | Exact identity | Published coverage and depth | Live mechanism | Limits and operations | Commercial implications | RavenOS result |
|---|---|---|---|---|---|---|
| Hyperliquid native | Exact venue contract | Native historical candles for supported perps; RavenOS retains 1m through 1M normalization | Venue WebSocket for candles, tape, book, funding, and OI | Venue-specific; existing reconnect/dedupe path is deployed | Venue terms govern | Keep as authoritative perp source |
| Atlas listed-market projection | Exact listing/instrument ID | Current provider-backed equity/ETF history through the protected public origin | Bounded current-origin refresh | Existing schema, freshness, size, and identity checks | Existing Atlas/Tradier contract governs; no browser secret | Keep as authoritative listed-market source |
| [CoinGecko Onchain](https://docs.coingecko.com/reference/pool-ohlcv-contract-address) | Network plus exact pool address and base/quote orientation | 250+ networks are advertised; up to 1,000 bars/call; paid history may extend to Sep 2021; backward pagination by `before_timestamp`; 1m, 5m, 15m, 1h, 4h, and 1d needed by RavenOS are documented | [OnchainOHLCV WebSocket](https://docs.coingecko.com/websocket/wssonchainohlcv), as fast as 1 second for active pools; REST updates every 10 seconds on paid plans | Analyst: 500k calls/month and 500/min; WebSocket beta is outside the API SLA | [Analyst is $129 monthly / $103.20 annualized](https://www.coingecko.com/en/api/pricing). Commercial integration requires attribution. Resale, sublicensing, syndication, and redistribution are restricted; RavenOS must obtain written confirmation that its normalized browser chart delivery fits the chosen license | Recommended primary on-chain feed, conditional on paid server-only key and licensing confirmation |
| [Codex](https://docs.codex.io/api-reference/queries/getbars) | Exact pair plus network ID; token aggregate is a separate query | `getBars` returns up to 1,500 points; 90+ networks are advertised; sub-minute history is limited to 24 hours | `onBarsUpdated` GraphQL subscription | Growth advertises 1M requests, 300 req/s, 300 WebSockets; SLA is Enterprise-only | [Growth starts at $350/month](https://www.codex.io/pricing). Product/redistribution rights must be confirmed in the executed terms | Strong technical challenger; require exact-anchor trial and licensing review before substituting it |
| [Birdeye](https://docs.birdeye.so/reference/get-defi-v3-ohlcv-pair) | Exact pair address with chain header | Pair OHLCV V3 publishes up to 5,000 records; documented chain list on that endpoint includes Solana, Base, BSC, and Ethereum; broad 1s–1M intervals | [Pair/token OHLCV WebSocket](https://docs.birdeye.so/reference/subscribe_price-ohlcv), up to 100 addresses per subscription | Premium: 50 req/s, 1,000 req/min, 500 WebSocket connections; compute-unit billing applies | [Premium is $199/month](https://docs.birdeye.so/docs/pricing); WebSocket overage and product-use rights need vendor confirmation | Strong Solana/EVM alternative; narrower documented endpoint coverage than CoinGecko/Codex |
| [Moralis](https://docs.moralis.com/data-api/solana/token/prices/ohlc) | Exact Solana or EVM pair address | Solana and supported EVM pair OHLCV; max 1,000 Solana rows; 1m, 5m, 1h, 4h, 1d, 1w, 1M, but no native 15m | REST polling for this endpoint; no OHLCV WebSocket contract was proven in this pass | Pair candles cost 150 CUs/call; 40–200 req/s by plan | [Starter $49, Pro $199, Business $490 annualized monthly](https://moralis.com/pricing/); attribution applies below Business. Existing private Raven key is not automatically a RavenOS production license or Worker secret | Verified fallback candidate. Live probes were slower and RETIRE lagged; do not make it primary without a separate product credential and terms review |
| [DexScreener](https://docs.dexscreener.com/api/reference) | Exact chain, token, and pair discovery | Search, pair metadata, liquidity, volume, transactions, and current price; no historical OHLCV contract is documented | Current-state HTTP API | Public API rate limits vary by endpoint | Product-use terms must still be observed | Keep for discovery/current pair state only; never use as historical candles |

### Fixed qualification matrix

`Verified` below means exercised against a real anchor or already operating in RavenOS. `Documented` means the provider publishes the capability but RavenOS did not exercise it with a product credential in this pass.

| Criterion | CoinGecko Onchain | Codex | Birdeye | Moralis | DexScreener |
|---|---|---|---|---|---|
| Exact pool/contract identity | Verified on Solana, Base, and Ethereum | Documented pair + network query | Documented pair + chain header | Verified exact Solana/EVM pair | Verified discovery/current pair identity |
| Chain/DEX breadth | 250+ networks advertised; anchor DEXs verified | 90+ networks advertised; exact Raven anchors not exercised | Endpoint documents Solana, Base, BSC, Ethereum; anchors not exercised | Solana and supported EVM chains; three anchors exercised | Broad discovery; chart breadth not applicable |
| Historical depth and useful bars | Up to 1,000/call; 480 `15m` RETIRE/Base/Ethereum bars verified | Up to 1,500 points documented | Up to 5,000 rows documented | Up to 1,000 rows documented; 155 RETIRE `1h` rows observed | No documented historical OHLCV |
| Required intervals | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` documented and normalized | Broad interval contract documented; exact set needs credentialed trial | `1s` through `1M` documented | No native `15m`; `1m`, `5m`, `1h`, `4h`, `1d`, `1w`, `1M` | Not applicable |
| Backward pagination | `before_timestamp` documented and implemented | Time-bounded bar query documented | `time_from` / `time_to` documented | Date-bounded requests documented | Not applicable |
| Live mechanism and latency | REST paid refresh documented at roughly 10s; WebSocket as fast as 1s; REST polling implemented, WebSocket not yet exercised | GraphQL bar subscription documented; product latency not exercised | OHLCV WebSocket documented; product latency not exercised | REST polling verified; no exact-pair OHLCV stream proven | Current-state HTTP only |
| Liquidity and volume | Pool metadata plus OHLCV volume documented; volume present in anchors | Bar volume and market metadata documented | OHLCV volume plus pair data documented | Candle volume documented | Liquidity, volume, transactions verified for discovery |
| Pool migration behavior | Exact pool remains immutable; replacement pool is a new selection | Same RavenOS rule | Same RavenOS rule | Same RavenOS rule | Discovery may surface the new pool, but never silently changes the selected one |
| Duplicate/out-of-order handling | One duplicate RETIRE `1h` row observed; RavenOS normalized it | RavenOS normalization required | RavenOS normalization required | RavenOS normalization required | Discovery ranking only |
| Rate limit / uptime evidence | Published plan limits; keyless `429` reproduced; paid SLA scope must be confirmed | Growth limits published; SLA Enterprise-only | Premium limits published; SLA not proven in this pass | Plan CU/rate limits published; observed requests were slower | Endpoint limits documented; no history SLA |
| Product-use / redistribution | Attribution and redistribution restrictions require written product confirmation | Executed product terms still required | Executed product terms still required | Separate RavenOS credential/license required; attribution below Business | Product-use review still required |
| Cloudflare/server-side fit | Worker REST adapter verified; server-only key test and no-leak scan pass | HTTP/GraphQL and WS technically suitable; not integrated | HTTP/WS technically suitable; not integrated | Server-side REST verified from Raven host; Worker binding not configured | Worker discovery adapter already operating |

No provider is treated as supporting a network because a marketing page names the chain. A network becomes chart-ready only after an exact anchor passes identity, depth, interval, freshness, and failure tests.

### Migration, ordering, and availability rules

- A pool migration creates a new exact market. It does not mutate the selected pool or silently move its chart.
- Provider rows are normalized, deduplicated by interval timestamp, sorted ascending, and bounded before reaching the renderer.
- Out-of-order provider rows are accepted only after normalization. Duplicate timestamps produce one bar.
- Missing trade intervals remain missing unless the selected provider explicitly supplies an empty interval. RavenOS does not interpolate trades or manufacture OHLC values.
- A provider or rate-limit failure may use a last-good cache only for the same provider network, exact pool, orientation, and timeframe. The UI must show the cache as degraded and stale.
- A discoverable market is not necessarily chartable.

## Live anchor observations

These are read-only probes made from the Raven host on 2026-07-22. They are not synthetic fixtures.

| Anchor | Provider probe | Result |
|---|---|---|
| RETIRE/SOL, Solana Raydium pool `6Hfa…7gtw` | GeckoTerminal public exact-pool endpoint | 480 1m bars, 480 5m bars, 480 15m bars, 360 raw 1h rows, and 240 4h bars. The 15m window covered 2026-07-15 18:00 UTC through 2026-07-22 13:00 UTC. One duplicate timestamp occurred in the raw 1h response and is removed by normalization. |
| RETIRE/SOL | Moralis exact Solana pair | 259 5m bars and 155 1h bars over the requested 14-day window. Latest observed RETIRE bar lagged the CoinGecko/GeckoTerminal probe. |
| cbBTC/USDC, Base Aerodrome pool `0x4e96…E778` | GeckoTerminal public exact-pool endpoint | 240 15m and 240 1h rows. |
| cbBTC/USDC | Moralis exact EVM pair | 336 1h rows over the requested 14-day window. |
| WETH/USDC, Ethereum Uniswap v3 pool `0x88e6…5640` | GeckoTerminal public exact-pool endpoint | 240 15m rows. A later 1h call was throttled, demonstrating that the keyless endpoint is unsuitable as the production capacity plan. |
| WETH/USDC | Moralis exact EVM pair | 336 1h rows over the requested 14-day window. |
| SPY, NYSE Arca ETF | Atlas protected listed-market projection | 316 5m, 106 15m, 149 1h, 43 4h, and 125 1d provider-backed bars in the 2026-07-22 fixed validation. Exact `etf:nyse-arca:spy` identity was preserved. |
| RUNNER/WETH, Robinhood Chain pool `0x6026…E6a9` | DexScreener discovery | Exact pool is discoverable, but no verified historical/live OHLCV provider network was found. Registry state remains chart unavailable. |
| Unregistered network | Capability registry | Discoverable results may be shown, but historical/live chart support is false until a provider network and exact anchor pass are recorded. |

The keyless Gecko endpoint returned HTTP 429 during the fixed probes. That is an operational capacity finding, not a market-coverage failure. It blocks production promotion until a paid server-only path or another qualified provider is bound and verified.

The repeatable gate reinforced that conclusion: a first fixed run passed RETIRE, Base, and Ethereum; a subsequent run preserved RETIRE and Base but failed the Ethereum request closed after keyless throttling. Hyperliquid and every tested Atlas interval remained independent and healthy. No Raven observation series replaced the unavailable Ethereum candles.

## Cost and operating model

Recommended initial paid shape:

- CoinGecko Analyst as the exact-pool REST/WebSocket source: $129 month-to-month or $103.20/month annualized, before overages and any custom license;
- Cloudflare Worker Cache API for short-lived exact request coalescing and a six-hour same-market rescue cache;
- active-view polling at 10 seconds until shared WebSocket fanout is justified;
- Hyperliquid native WebSocket and Atlas current-origin paths remain independent, so an on-chain vendor outage does not collapse perps or listed markets;
- DexScreener remains a separately bounded discovery dependency;
- no broad cache purge is required for correctness.

At larger concurrent-view counts, use one shared provider subscription per exact pool/timeframe through a bounded stateful fanout. Do not create one outbound paid WebSocket per browser. Cloudflare Durable Objects are a candidate, but outbound provider sockets consume active duration and need a measured cost model before implementation.

## Production recommendation

Do not promote this pass yet.

The code-level precedence defect is repaired, and the exact RETIRE provider feed proves dense 15m/1h coverage. Production still needs:

1. a paid server-only CoinGecko Onchain key or an equivalently qualified Codex/Birdeye contract;
2. written confirmation of product-display/normalized-browser-delivery rights and required attribution;
3. an isolated Cloudflare preview using that exact secret binding and release artifact;
4. fixed-anchor browser screenshots and live transition/reconnect tests on the preview;
5. all release-cohesion, no-leak, security, chart, search, and exact-identity gates.
