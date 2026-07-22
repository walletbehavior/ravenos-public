# RavenOS market-data plane v1

Status: CoinGecko Basic production-qualified; final release verification pending

Date: 2026-07-22 UTC

Scope: read-only discovery, exact instrument identity, historical OHLCV, active-view updates, Raven overlays, provider health, attribution, and commercial qualification

## Decision

RavenOS keeps one Lightweight Charts renderer and normalizes multiple authoritative feeds beneath it. A provider is a replaceable capability, not part of the instrument identity.

The base-chart precedence is:

1. venue-native OHLCV for an exact venue market, currently Hyperliquid;
2. exact-listing Atlas market history for equities and ETFs;
3. direct OHLCV from the first commercially qualified exact-pool provider in `RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER`;
4. deterministic aggregation from that provider's bake-off-qualified lower interval;
5. a commercially qualified secondary provider for the same exact pool;
6. a last-good response matching exact provider, market, orientation, decimals, and timeframe, visibly marked degraded, where policy permits;
7. no chart.

The default unconfigured evaluation order remains `dexpaprika,coingecko_onchain`. The production release explicitly selects `coingecko_onchain` with plan `basic` through the generic provider contract. The owner confirmed the paid Basic subscription on 2026-07-22; the Pro host accepted the server-side credential and returned 120 exact-pool one-minute bars before the production flag was enabled. The parent `COINGECKO_API_KEY` is mapped locally to `ONCHAIN_CHART_PROVIDER_SECRET`; key presence alone never changes provider authority inside the Worker.

Every market advertised as chart-ready must provide a useful one-minute series. The release matrix requires at least 120 real provider-backed `1m` bars for every representative chart-ready anchor. No `30s` candle contract is required, and RavenOS does not derive `1m` from sub-minute observations. A market can remain discoverable while its one-minute chart is unavailable.

DexPaprika and DexScreener jointly resolve on-chain instruments and current pair state. Moralis remains a private Raven enrichment source for wallet and holder facts. Raven observations supply annotations, events, overlays, actor/cohort interpretation, and decision support. None of those sources may become replacement OHLCV.

The implementation is in:

- `lib/onchain_chart_providers.mjs` — versioned provider registry and runtime bindings;
- `lib/chart_continuity.mjs` — exact identity, timestamp, duplicate, gap, volume, freshness, and deterministic-derivation rules;
- `ravenos-chart-data-plane.js` — canonical candle/event primitives and market capability registry;
- `worker.mjs` — server-side provider adapters, exact-identity checks, cache, provenance, density qualification, and fail-closed precedence;
- `ravenos-price-workspace.js` — renderer-independent history, backfill, polling, and venue-live subscriptions;
- `raven-price-chart.js` — preserved Lightweight Charts renderer;
- `ravenos-shell.js` and `ravenos-terminal-live.js` — universal search, provider attribution, and visible availability;
- `config/release.json` and release scripts — explicit production-qualification gate.

## Provider responsibility boundaries

| Responsibility | Current authority | Explicit non-authority |
|---|---|---|
| On-chain discovery | DexPaprika plus DexScreener, normalized server-side | Discovery does not prove chart readiness or execution support |
| On-chain base candles | Versioned exact-pool provider selection | Raven observations never substitute as candles |
| Perpetual market data | Hyperliquid native APIs and WebSocket | Does not establish spot-market identity |
| Listed instruments | Atlas/Tradier protected projection | RavenOS does not expose provider secrets or raw broker payloads |
| Wallet and holder facts | Existing private Moralis enrichment, where enabled and supported | Moralis does not define Raven cohorts, evidence, independence, or opportunities |
| Intelligence | Constant-K/Raven public-safe projection | Does not rewrite provider OHLCV or silently choose another market |
| Edge delivery | Cloudflare Worker and bounded caches | Cloudflare is not authorization or market-data authority |

## Provider comparison

Published claims and live RavenOS probes are deliberately separated. Pricing and terms are dynamic and were checked on 2026-07-22.

| Source | Exact identity and coverage | History and live path | Limits / cost observed | Commercial and attribution state | RavenOS decision |
|---|---|---|---|---|---|
| Hyperliquid native | Exact venue contract for supported perps | Native history plus WebSocket candles, tape, book, funding, and OI | Existing venue-specific adapter | Venue terms govern | Authoritative perp feed |
| Atlas listed-market projection | Exact listing/instrument ID | Protected provider-backed equity/ETF history | Existing bounded current-origin contract | Existing Atlas/Tradier server-side boundary | Authoritative listed-market feed |
| [DexPaprika](https://docs.dexpaprika.com/introduction) | Network plus exact pool; published coverage includes Solana, Base, Ethereum, and Robinhood | Up to 366 rows per request; native `1m`, `5m`, `10m`, `15m`, `30m`, `1h`, `6h`, `12h`, `24h`; RavenOS derives `4h` from `1h` and maps `1d` to `24h`; bounded polling for active views | Current pricing page advertises 200k anonymous requests/month at 30/min, 500k registered Free, and Pro at $99/month for 5M requests; response headers and 429s remain runtime authority | [Terms effective 2026-07-14](https://dexpaprika.com/api/terms) restrict Free to development, testing, and support; commercial use requires a non-Free plan. Visible exact `Powered by DexPaprika` attribution is required | Integrated first in the development bake-off; not production-qualified |
| [CoinGecko Onchain](https://docs.coingecko.com/reference/pool-ohlcv-contract-address) | Network plus exact pool and base/quote orientation; Basic was verified on the selected Solana, Base, and Ethereum pools | Up to 1,000 bars/call; backward pagination; all required RavenOS intervals exercised; provider-defined empty intervals requested explicitly | Pro authentication uses `pro-api.coingecko.com` and the server-only `x-cg-pro-api-key`; anonymous GeckoTerminal remains diagnostic-only | Paid Basic commercial product use with visible `Data provided by CoinGecko` attribution, as confirmed by the owner | Selected production exact-pool provider; full anchor matrix passed |
| [Codex](https://docs.codex.io/api-reference/queries/getbars) | Exact pair plus network ID | Up to 1,500 points; GraphQL bar subscription | Growth advertises high request and WebSocket limits; SLA is plan-dependent | Executed product and redistribution rights must be confirmed | Strong challenger; not integrated in this pass |
| [Birdeye](https://docs.birdeye.so/reference/get-defi-v3-ohlcv-pair) | Exact pair plus chain header | Up to 5,000 records and pair/token OHLCV streaming | Compute-unit billing and plan-specific rate limits | Product-use and attribution rights need vendor confirmation | Strong Solana/EVM challenger; not integrated in this pass |
| Moralis | Exact wallet/token/pair facts on supported chains | Existing private holder-distribution enrichment and related wallet surfaces; not selected as the chart authority | Existing Free integration is budget-bounded in Raven | Private Raven credential is not a RavenOS browser credential or blanket production license | Keep for wallet/holder facts; evaluate chart OHLCV only if it independently wins the fixed matrix |
| [DexScreener](https://docs.dexscreener.com/api/reference) | Exact chain/token/pair discovery and current pair state | No historical OHLCV contract is documented | Public endpoint-specific limits | Product-use terms still apply | Keep for discovery/current pair state only |

Provider plan numbers are operational estimates, not a procurement decision. The executed agreement and provider response headers take precedence over website copy.

## Fixed qualification matrix

`Verified` means exercised against a real anchor or already operating in RavenOS. `Documented` means the provider publishes the capability but RavenOS has not exercised it with a product credential.

| Criterion | DexPaprika | CoinGecko Onchain | Codex | Birdeye | Moralis | DexScreener |
|---|---|---|---|---|---|---|
| Exact pool/contract identity | Verified on Solana, Base, Ethereum, and Robinhood | Verified on Solana, Base, Ethereum | Documented pair + network query | Documented pair + chain header | Verified private exact wallet/token facts; pair OHLCV remains a challenger | Verified discovery/current pair identity |
| Historical depth | Maximum 366 source rows/call; density varies by pool | Up to 1,000/call documented | Up to 1,500 documented | Up to 5,000 documented | Endpoint/plan dependent | No documented history |
| Required intervals | Native `1m`, `5m`, `15m`, `1h`, `1d`; derived bounded `4h` | Verified `1m`, `5m`, `15m`, `1h`, `4h`, and `1d` on three exact pools | Exact set needs trial | Broad set documented | No native `15m` in prior audit | Not applicable |
| Backward window | `start` required, `end` optional; bounded by adapter | `before_timestamp` | Time-bounded query | `time_from` / `time_to` | Endpoint dependent | Not applicable |
| Live transition | Bounded server polling; no provider stream proven | Paid REST and WebSocket documented | Subscription documented | WebSocket documented | Exact-pair stream not proven | Current-state HTTP only |
| Liquidity/volume | Pool metadata plus OHLCV volume verified | Pool metadata plus OHLCV volume | Documented | Documented | Holder/wallet metrics are the intended role | Current liquidity/volume verified |
| Pool migration | New pool remains a new exact instrument | Same RavenOS rule | Same RavenOS rule | Same RavenOS rule | Not chart authority | May discover a replacement but cannot switch selection |
| Duplicate/out-of-order handling | Normalized, sorted, deduplicated before render | Same canonical normalizer | Required | Required | Required if evaluated | Discovery ranking only |
| Cloudflare fit | Anonymous server-side adapter and cache verified | Generic server-only secret adapter verified with paid Basic; secret absent from payloads | Technically suitable; not integrated | Technically suitable; not integrated | Private Raven integration; no browser exposure | Worker discovery adapter operating |
| Commercial readiness | Free explicitly development-only; paid terms and capacity not yet qualified | Basic selected and production-qualified with required attribution | Not verified | Not verified | Existing private use only | Not the candle source |

No provider becomes chart-ready because a marketing page names a chain. An exact anchor must pass identity, depth, interval, freshness, failure, rate, and rights checks.

## Normalization and fail-closed rules

- A provider is selected through the versioned registry, never by accidental secret presence.
- Exact pool, selected token, quote token, chain, orientation, and provider market ID are checked before a candle is accepted.
- EVM addresses are normalized for provider requests while the canonical RavenOS identity remains stable.
- Pool-detail base/quote identities determine DexPaprika `inversed`; provider token array order is not treated as price orientation.
- Provider rows are bounded, schema-checked, sorted ascending, and deduplicated by interval timestamp.
- Same-provider interval derivation is limited to `5m → 15m`, `15m → 1h`, `1h → 4h`, and `1h → 1d`. These are the only mappings that passed representative exact-pool comparison. `1m → 5m` is explicitly prohibited because representative pools showed incomplete source buckets and material volume disagreement.
- Every completed derived bucket must contain every expected lower-interval bar. A currently forming bucket is accepted only when it begins at the exact UTC boundary and all received source bars are contiguous. Missing source intervals remain missing; RavenOS never interpolates, forward-fills, or manufactures OHLCV.
- Provider or derivation transitions validate exact pool, selected/quote orientation, token decimals, timestamps, open/close continuity, volume semantics, duplicate/conflicting rows, missing buckets, and freshness before data is applied. A failed transition degrades the feed without switching identity.
- A release-enforced Worker never uses the anonymous GeckoTerminal endpoint as application capacity. Production uses the explicitly commercial CoinGecko Basic plan through the generic server-only binding and Pro host.
- One minute is a native-provider requirement. RavenOS does not downsample a `30s` source, upsample a sparse Raven observation, or relabel a monthly series as `1m`.
- A pool migration is a new exact market. RavenOS never silently moves a selected chart to the replacement pool.
- A last-good rescue must match provider, network, exact pool, token orientation, and timeframe and must remain visibly degraded.
- A discoverable market may be unchartable. A chartable market may still be non-routeable and non-executable.
- Raw provider payloads and provider secrets never enter browser responses.

## CoinGecko exact-pool anchor matrix

The original Demo evaluation matrix completed at `2026-07-22T17:00:36Z` with zero failures. The full matrix was repeated against the paid Basic Pro endpoint at `2026-07-22T19:45:16Z`, again with zero failures and no keyless fallback. Counts are observations from the qualified run, not availability guarantees.

| Exact market | 1m | 5m | 15m | 1h | 4h | 1d | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| RETIRE/SOL, Solana pool `6Hfa…7gtw` | 480 | 480 | 480 | 360 | 240 | 180 | Exact identity and full interval matrix passed |
| cbBTC/USDC, Base pool `0x4e96…E778` | 480 | 480 | 480 | 360 | 240 | 180 | Exact identity and full interval matrix passed |
| WETH/USDC, Ethereum pool `0x88e6…5640` | 480 | 480 | 480 | 360 | 240 | 180 | Exact identity and full interval matrix passed |
| RUNNER/WETH, Robinhood Chain pool `0x6026…E6a9` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | Expected unavailable: selected provider has no Robinhood network route; no alternate pool or provider was substituted |
| SOL-PERP, Hyperliquid | 480 | 480 | 289 | 337 | 127 | 181 | Native venue matrix passed |
| SPY, exact NYSE Arca ETF | 480 | 355 | 119 | 148 | 42 | 125 | Protected listed-market matrix passed |

CoinGecko's `include_empty_intervals=true` semantics are explicit in lineage: when a provider interval has no trade, CoinGecko may return the previous close with zero volume. RavenOS does not invent or interpolate those bars. An inactive exact pool can therefore render a truthful dense but flat chart rather than sparse Raven observation dots.

The listed-market source appends a flat, zero-volume live quote at provider observation time. The public adapter now deterministically folds that quote into the current interval, or aligns it to the immediately following interval when appropriate. It does not fill intermediate history. That repair made SPY's full `1m` through `1d` matrix pass while retaining exact listing identity and observation time.

Chart readiness is now per exact market. Search reports `probe_required` when the selected provider has a viable 1m and 1h request route, and `unavailable` when it does not. Only a validated candle response may report `verified_current` or `verified_with_visible_staleness`; a static chain mapping is not advertised as proof.

### Prior DexPaprika bake-off observations

Earlier read-only probes from the Raven host on 2026-07-22 produced these representative DexPaprika results. They remain useful provider-comparison evidence but do not describe the explicitly selected CoinGecko Demo preview.

| Anchor | DexPaprika result | Qualification consequence |
|---|---|---|
| RETIRE/SOL, Solana Raydium pool `6Hfa…7gtw` | Exact identity; latest fixed-window probe returned 12 direct `15m` rows, while 12 `5m` rows produced only 12 derived `15m` buckets | Aggregation cannot create density for a quiet/sparse provider source. This anchor remains below the production first-screen target and must use a qualified secondary exact-pool source or show limited/unavailable history |
| cbBTC/USDC, Base Aerodrome pool `0x4e96…E778` | 366 `15m` and 366 `1h` rows | Dense anchor candidate |
| WETH/USDC, Ethereum Uniswap v3 pool `0x88e6…5640` | 366 `15m` and 366 `1h` rows | Dense anchor candidate |
| RUNNER/WETH, Robinhood Chain pool `0x6026…E6a9` | Exact address search and pool resolution; 101 `15m` and 30 `1h` rows on a market only about 37 hours old in the final validation run | Search gap is repaired and history is appropriate to market age; still requires production terms/capacity qualification |
| Unregistered network | No registry mapping | May be discoverable, but chart support fails explicitly |

### Prior one-minute gate

The earlier evaluation run at 2026-07-22 16:10 UTC added `1m` to every applicable anchor rather than treating it as an optional UI control. Its failures were specific to the prior DexPaprika-plus-keyless diagnostic configuration and are superseded for the current keyed Demo preview by the complete matrix above.

| Anchor | One-minute result | Production consequence |
|---|---|---|
| SOL-PERP Hyperliquid | 480 native venue bars | Passed |
| cbBTC/USDC Base | 363 DexPaprika bars | Technically passed; commercial plan remains unqualified |
| RETIRE/SOL | 480 bars only after the anonymous GeckoTerminal evaluation fallback | Useful proof, but forbidden as production capacity until a qualified paid provider supplies the same exact pool |
| WETH/USDC Ethereum | DexPaprika rows included records without the contractually required volume field; fallback did not produce a qualified result | Failed closed |
| RUNNER/WETH Robinhood Chain | DexPaprika returned fewer than 120 usable `1m` bars and some rows omitted required volume; CoinGecko has no registered Robinhood adapter | Failed closed |
| SPY Atlas | Not exercised by the public validator process because its server-only origin binding was intentionally absent | Source and contract tests pass; production-equivalent origin probe remains required |

The listed-market adapter also had a casing defect that collapsed `1m` and `1M`. The source preserves `1m` as Yahoo's one-minute/5-day request and `1M` as a monthly/10-year request. The public-origin consumer additionally normalizes the provider's trailing zero-volume live quote and validates the resulting candle spacing against the requested interval. Validation used an isolated current-source origin; no production service was restarted.

DexPaprika requires lowercase EVM pool addresses on the OHLCV path in current live behavior; the adapter normalizes those requests. Pool detail accepts broader casing. That provider-specific quirk never changes canonical identity.

## Deterministic interval bake-off

The 2026-07-22 bake-off compared direct higher-interval bars with aggregation of lower-interval bars for the same exact provider pool. It did not assume that arithmetic equivalence implied provider-volume equivalence.

| Exact pool | Comparison | Result | Consequence |
|---|---|---|---|
| Base cbBTC/USDC | `1m → 5m` | Rejected; material provider-volume mismatch (roughly 75%) | Keep direct `5m` |
| Ethereum WETH/USDC | `1m → 5m` | Rejected; incomplete buckets and roughly 3.3% volume mismatch | Keep direct `5m` |
| Base cbBTC/USDC and Ethereum WETH/USDC | `5m → 15m` | OHLC matched; only bounded floating-point volume variance | Qualified derivation |
| Same active anchors | `15m → 1h` | OHLC and volume continuity passed | Qualified derivation |
| Same active anchors | `1h → 4h` | Complete UTC buckets passed | Qualified derivation |
| Same active anchors | `1h → 1d` | OHLC matched; bounded volume variance | Qualified derivation |
| RETIRE/SOL | lower interval → higher interval | Valid but still sparse | Remain explicit; do not fill gaps |

DexPaprika's 366-row source bound limits the approximate per-request derived depth to 122 `15m` bars, 91 `1h` bars, 91 `4h` bars, or 15 `1d` bars. Backward pagination can extend history only where the provider returns complete source buckets.

## Moralis boundary

The existing private implementation is `services/holder_distribution_enrichment.py` in Raven. It uses `MORALIS_API_KEY` only server-side, is controlled by `MORALIS_HOLDER_COHORT_ENABLE`, enforces request budgets, and currently feeds bounded holder-distribution facts into private actor intelligence and hydration audit paths.

Moralis may supply supported wallet balances, swaps/history, P&L/net worth, top holders, historical holder counts, distribution metrics, entity labels, and top-trader facts only through reviewed private adapters. Raven remains authoritative for public-safe actor/cohort interpretation, independence adjustment, behavioral classification, opportunity confirmation, historical evidence, and decision-support overlays. No raw Moralis payload or key is projected to RavenOS.

## Attribution

RavenOS now exposes a collapsed global provider ledger with persistent `Data by DexPaprika + CoinGecko` text and the official unmodified DexPaprika symbol. It identifies the bounded roles of DexPaprika, DexScreener, CoinGecko, Hyperliquid, Tradier/Atlas, Moralis, Constant-K/Raven, Cloudflare, and the TradingView Lightweight Charts renderer and explicitly avoids implying endorsement or partnership. The exact chart response and Terminal source detail carry the active provider, freshness, derivation, and required CoinGecko attribution.

Attribution does not establish commercial permission. It satisfies a presentation requirement while the release gate independently blocks production use of an unqualified plan.

## Cost and operating implications

- DexPaprika Free carries no API-key setup cost and is appropriate for the current development bake-off, but its terms prohibit commercial production use. Current Pro list pricing begins at $99/month; actual RavenOS rights and capacity must be confirmed before selection.
- CoinGecko Basic is the explicitly selected production provider. The current parent `COINGECKO_API_KEY` is mapped locally to the provider-neutral secret contract; it is never shipped as a browser variable. The full six-interval matrix uses approximately one bounded OHLCV request per exact pool/interval plus cached identity requests; Cloudflare caching and active-view polling remain the first production capacity controls.
- `COINGECKO_PRO_API_KEY` remains a compatibility input only, not the architectural release contract. Production uses `ONCHAIN_CHART_PROVIDER`, `ONCHAIN_CHART_PROVIDER_PLAN`, `ONCHAIN_CHART_PROVIDER_COMMERCIAL`, and `ONCHAIN_CHART_PROVIDER_SECRET`.
- Cloudflare caches coalesce identical exact-market requests and retain a bounded same-market rescue. They reduce calls but do not make an insufficient or prohibited provider production-safe.
- Active views currently use bounded polling. At scale, one shared upstream subscription per exact market/timeframe may be preferable; that requires a measured stateful-fanout cost model.
- Hyperliquid and Atlas remain independent, so an on-chain provider outage must not collapse perp or listed-market surfaces.
- Moralis consumption remains private and budgeted separately from OHLCV.

## Production recommendation

Stage the exact immutable Basic-backed release for owner evaluation, visual QA, screenshots, automated tests, and provider/cache measurement. Promote only that same verified artifact after all of these gates pass:

1. written/contractual commercial product-display and normalized-delivery rights;
2. a selected paid plan and explicit server-side production binding;
3. fixed-anchor coverage and density across every exact market advertised as chart-ready; unsupported markets remain discoverable with an explicit unavailable state;
4. at least 120 provider-backed one-minute bars for every advertised chart-ready anchor, with `1m` and `1M` proven distinct;
5. measured rate/429, latency, cache, and outage behavior at expected concurrency;
6. isolated Cloudflare preview validation using the exact staged release artifact;
7. passing chart, search, browser, no-leak, security, and release-cohesion gates.
