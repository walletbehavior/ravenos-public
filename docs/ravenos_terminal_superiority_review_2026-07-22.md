# RavenOS terminal superiority review

Status: product benchmark and implementation direction; not a production claim

Date: 2026-07-22 UTC

## The honest conclusion

RavenOS should not try to win by containing more widgets than every competitor. It should become the fastest place to move from an ambiguous market idea to an exact, evidence-bounded decision.

The durable product advantage is:

> Search any supported instrument, land on the exact market, get a useful chart immediately, see what changed and why Raven considered it, understand what Raven does not know, then review the appropriate venue and portfolio consequence without changing applications.

RavenOS is not superior yet. Its architecture now supports a credible path to superiority, and this pass closes several obvious inspection-loop gaps: the chart is promoted into the initial viewport, instrument-specific market anatomy sits beside it, Raven markers are inspectable, provider derivation is visible without dominating the screen, and Discover leads with actual instrument deltas when current market facts support them. It still loses avoidable minutes on drawing and compare ergonomics, holder depth, persistent workspace state, portfolio context, and eventually reviewed execution.

## Evidence used

This review combined the current RavenOS build, its browser suite, live read-only anchor probes, public product interfaces where accessible, and current official product documentation. Bot-protected/authenticated competitor surfaces were not bypassed. Marketing claims are treated as claims, not independent proof.

Current official references:

- [DEX Screener multicharts, watchlist, alerts, and chain surface](https://dexscreener.com/multicharts/)
- [GMGN token chart, multichart, activity, traders, holders, and trading workflow](https://docs.gmgn.ai/index/token-page-chart-multicharts-activity-trading-system)
- [Axiom product overview](https://docs.axiom.trade/) and [Trader Scan](https://docs.axiom.trade/trader-scan)
- [Hyperliquid order-book model](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-book)
- [TradingView Supercharts workflow](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/)
- [Genius cross-chain terminal](https://www.tradegenius.com/)
- [Koyfin functional inventory](https://www.koyfin.com/help/topic/functionality/)
- [Bloomberg Terminal and Launchpad](https://professional.bloomberg.com/products/bloomberg-terminal/)
- [IBKR Mosaic linked workspace](https://www.ibkrguides.com/traderworkstation/mosaic-layout.htm)
- [Phantom Terminal workflow](https://help.phantom.com/hc/en-us/articles/46527102843027-Trade-tokens-and-perps-in-Phantom-Terminal)

## What each product makes fast

| Product | What it makes fast | Why an operator leaves RavenOS for it today | What RavenOS should absorb | What RavenOS should not copy |
|---|---|---|---|---|
| DEX Screener | Contract search, exact pair chart, liquidity/volume/transactions, multicharts, watchlists, alerts, very broad chain discovery | A token can usually be found and assessed immediately | Near-infallible address/name search, pair alternatives, immediate market anatomy, multi-chart inspection later | Chain-first navigation and unqualified pair substitution |
| GMGN | Token chart plus live activity, trader classes, holders, wallet P&L, security facts, chart markers, fast trade controls | It answers “who is trading this and is the token structurally dangerous?” beside the chart | Holder distribution, public-safe participant change, chart-linked behavior, compact trade tape | Unqualified “smart money,” insider, ownership, or coordination labels |
| Axiom | New-market discovery, one-click workflow, wallet tracking, Trader Scan, token filters | It compresses discovery → participant scan → action | Fast stable feeds, wallet-event-to-chart workflow, token risk essentials, intentional presets once authorized | Custodial/security shortcuts or action-first claims that exceed evidence |
| Photon / Phantom Terminal | Low-chrome discovery, persistent search, quick presets, Solana token and Hyperliquid perp workflow | The interface exposes the common actions immediately | Persistent search, minimal shell, compact position/follow context, route presets later | Auto-confirm or execution semantics before RavenOS transaction security is complete |
| Hyperliquid | Chart, book, tape, ticket, positions, funding, OI, and collateral in one dense screen | It is faster for continuous perp operation | Chart-first layout, live book/tape adjacency, one selected market broadcasting everywhere, low-latency interaction | Perp-specific assumptions in the universal Terminal |
| TradingView | Symbol search, dense chart history, drawings, indicators, compare, saved layouts, alerts, replay | It remains the best place to manipulate and annotate a chart | Chart dominance, keyboard-first tools, saved chart state, compare, alerts, later drawing primitives | Rebuilding Pine/community breadth or embedding a widget to conceal missing RavenOS data |
| Genius | Cross-chain abstraction, unified token discovery, route aggregation, “do not think about bridges” narrative | It presents multi-chain action as one product | Intent-first trade review, backend abstraction, one stable economic language | Claims of invisible settlement/custody or bridge-free behavior before a reviewed route exists |
| Koyfin | Cross-asset search, screens, watchlists, reusable views, dashboards, relative analysis, macro/company context | It is faster for broad listed-market and macro exploration | Atlas market map, reusable views, comparisons, linked context | A blank-canvas dashboard that makes every user design the product |
| Bloomberg | Search/command fluency, multi-asset monitors, alerts, news, research, analytics, execution, collaboration | It compresses an enormous information universe into known workflows | Keyboard-first command semantics, saved monitors, source authority, event-to-instrument context | Function-code complexity, visual density without a specific operator question |
| IBKR Mosaic | Symbol-linked windows, watchlists/scanners, portfolio, chart, ticket, orders, positions | It keeps portfolio and execution state attached to the selected instrument | One selected instrument updates every linked panel; exact order lifecycle later | Broker-specific objects leaking into the universal product model |

## RavenOS strengths worth building around

RavenOS now has several capabilities competitors generally do not present together:

1. Exact instrument identity is a product rule, not a best effort. Pool, listing, perpetual contract, selected token, quote, provider market, and lineage can remain joined end to end.
2. Current market facts and Raven interpretation are separate. Provider candles do not become Raven evidence, and Raven observations do not become fake candles.
3. Opportunity evidence has authority, maturity, freshness, historical lineage, and explicit unavailable semantics.
4. Raven can explain why an opportunity was admitted, what contradicts it, which path state is current, and what comparable future-only outcomes actually matured.
5. Participant intelligence can become privacy-preserving and independence-adjusted instead of merely listing wallets with suggestive labels.
6. Atlas can add listed-market, company, event, options, sector, and cross-asset context to the same exact instrument.
7. Settlement, custody, execution provider, and economic numeraire are separate contracts. RavenOS can simplify the user's intent without lying about the pipes.
8. The release and public-safety systems already fail closed on mixed artifacts, stale current opportunities, secrets, signing, and provider uncertainty.

These are not excuses for weak table stakes. They matter only after search and charting are fast enough that the operator stays.

## Current RavenOS visual/product findings

The 2026-07-22 local baseline was compared at 1440×900 and 390×844.

### Terminal

- The chart is real, readable, interactive, and provider-backed. Exact identity and provider provenance are visible.
- This pass removed the visible page-title preamble and compressed market status, instrument selection, timeframe, resolved venue, and read-only state into operator bars. The chart now begins roughly 100–150 pixels earlier than the prior local baseline.
- The chart retains a large initial viewport: 560px on desktop and 480px on the primary mobile layout. Market anatomy and Raven context remain adjacent rather than forcing another page transition.
- The information rail now answers instrument-specific questions: liquidity/volume/transactions/age for exact pools; book/funding/OI/spread for perps; session/change/options context for listed markets; exact fingerprint and route state everywhere they are known.
- Candle provider, source interval, direct-versus-derived state, continuity, freshness, and renderer attribution are available in a compact source disclosure rather than occupying the main decision hierarchy.
- Every projected Raven event is available through keyboard-accessible marker controls as well as chart interaction. The detail binds source evidence, maturity, path transition, historical outcome, support, and contradiction to that event.
- The palette is now graphite and muted steel. Saturated green and red are reserved for directional and trading semantics rather than ambient decoration.
- The provider credit remains compliant and unobtrusive. Mobile still benefits from a future dedicated utility gutter once account and persistent navigation work is authorized.

### Discover

- The page answers the right question and preserves exact market identity.
- Opportunity rows now join current exact Hyperliquid market facts where available and lead with a real price delta since the Raven observation. When that timestamp cannot be joined, they show an actual current 24-hour change; they do not invent an opportunity delta.
- Public Raven explanation remains the fallback only when no current price delta can be established. Evidence maturity and route/inspectability stay separate from price movement.
- The live-perpetual rail is useful context, not a substitute for the ranked opportunity set. A later pass can reduce its visual weight further.

### Shell

- Four destinations are understandable, but universal search should carry more visual authority than destination tabs.
- The shell is already much quieter than the prior RavenOS. The next pass should compress it rather than invent another navigation system.
- “Raven Read” should behave like an instrument-attached intelligence layer, not a fifth destination.

## The winning operator loop

The critical loop should fit inside one persistent workspace:

1. Press `/` or `⌘/Ctrl-K` anywhere.
2. Type a symbol, name, contract, pool, option, perpetual, or company.
3. See grouped exact choices with chain/venue, pair, liquidity, chart coverage, freshness, and ambiguity.
4. Select once. Every linked surface adopts that exact identity.
5. See a useful chart and primary market state before deeper intelligence hydrates.
6. Read one compact decision stack:
   - What changed?
   - Why now?
   - What supports it?
   - What contradicts it?
   - What followed in comparable evidence?
   - What is unavailable, and why?
7. Review route, settlement, portfolio consequence, or monitor action only when that capability exists.

No second mode search. No chain ceremony. No stale substitution. No simulated customer position. No execution implication when signing is disabled.

## Ruthless implementation order

### 1. Win search and first chart

Definition of done:

- exact address/name/ticker success for representative Solana, Base, Ethereum, Robinhood, Hyperliquid, equity, and ETF anchors;
- ambiguity is grouped and explained rather than guessed;
- first useful chart is fast enough that the operator does not open DEX Screener or TradingView while waiting;
- selected market state survives every workspace transition;
- no chart-ready badge is based only on chain marketing coverage.

The DexPaprika/Gecko provider chain is a meaningful step, not the finish. Production capacity and rights still need qualification.

### 2. Make the chart the workspace, not a module

- Compress the Terminal preamble and instrument controls into a single 44–56px identity bar on desktop.
- Let the chart own roughly two-thirds to three-quarters of the initial desktop viewport and the majority of the first mobile screen.
- Preserve fast crosshair, volume, indicators, backfill, deduplication, reconnect, and exact annotations.
- Add compare, saved view state, keyboard timeframe control, and a small high-value drawing set before attempting a giant indicator catalog.
- Keep evaluating TradingView Advanced Charts only as an ergonomics option after the normalized datafeed is production-qualified. It is not a data-coverage solution.

### 3. Put market anatomy beside the chart

For exact on-chain pools, the first supported facts should be:

- price, market cap/FDV with denominator and source;
- executable liquidity and 24h volume/transactions;
- pool age and exact pool fingerprint;
- selected token and quote orientation;
- top-holder concentration and distribution change where Moralis supports them;
- route state, price impact, gas, and settlement preview when available;
- explicit unsupported security facts rather than empty badges.

For perps: book, tape, funding, OI, pressure, collateral, and liquidation context. For listed markets: session, quote, volume, events, company/fund context, options availability, and actual USD settlement.

### 4. Make Raven the reason to stay

Do not add another generic score. The sidecar should show deltas and authority:

- admitted because;
- changed since prior read;
- strongest confirming evidence;
- strongest contradiction;
- participant quality and independence adjustment;
- path state and invalidation;
- comparable sample and outcome range;
- what Raven cannot support.

Chart markers should link to the exact evidence sentence, and the sentence should focus the exact chart interval. This is where Raven can surpass raw scanners.

### 5. Add persistent operator state only after customer security

Saved views, watchlists, alerts, layouts, notes, and read-only portfolio connections matter because they eliminate repeated setup. They must use the already-defined account/session/wallet security architecture, not local demo state presented as durable truth.

### 6. Add reviewed execution last

Execution adapters should preserve the Terminal. Solana/Jupiter, Hyperliquid, Tradier, and future backends change route/review details, not the instrument experience. Public signing, broker submission, and position monitoring remain separate security milestones.

## Product measures

Feature count is the wrong scorecard. Track:

- exact-search success rate and first-three-result precision;
- percentage of selected markets with a useful chart at each advertised interval;
- median and p95 search-to-first-candle time;
- median instrument-switch-to-chart time;
- provider fallback, stale rescue, and unavailable rates by exact market;
- repeated full-list reorder and scroll-jump rate;
- percentage of opportunities with a distinct delta explanation;
- percentage of Raven markers that resolve to exact visible evidence;
- mobile first-screen chart height and interaction failure rate;
- external exits by declared reason: chart, holders, liquidity, search, market depth, news/events, execution, or portfolio;
- return-to-RavenOS rate after an external exit.

The north-star product metric is simple: for supported instruments, the trader stops opening another application to complete the inspection loop.

## Things deliberately not recommended

- Do not replace Lightweight Charts merely to borrow another product's appearance.
- Do not add dozens of panels before search, chart depth, and market anatomy are reliable.
- Do not expose raw Moralis wallets or copy competitors' “smart money” labels without Raven evidence and privacy review.
- Do not fabricate portfolio, watchlist, alert, plan, or execution rows to make the product look complete.
- Do not promise USDC settlement or no bridging when the reviewed route, custody domain, and actual venue settlement differ.
- Do not make Atlas a separate stock dashboard or Raven a separate research portal.
- Do not chase Bloomberg breadth. Use Bloomberg's command fluency, linked context, and source discipline.

## Completed in this bounded pass

- Versioned on-chain provider capability and explicit provider order.
- Venue-native, listed-market, direct exact-pool, deterministic same-provider derivation, qualified-secondary, last-good, then unavailable precedence.
- Deterministic `5m → 15m`, `15m → 1h`, `1h → 4h`, and `1h → 1d` aggregation with complete-bucket and continuity requirements.
- Explicit rejection of `1m → 5m` after representative direct-versus-derived volume disagreement.
- Release-enforced rejection of keyless GeckoTerminal capacity.
- Mandatory provider-backed `1m` release coverage for every advertised chart-ready market; no `30s` candle requirement.
- Distinct listed-market `1m` and `1M` contracts, including interval-shape validation.
- Exact identity, orientation, decimals, timestamps, gaps, duplicates, freshness, and volume-continuity validation.
- Provider/pool/interval/cache/direct-versus-derived/fallback/viewer-request telemetry.
- Graphite operator palette, compressed pre-chart chrome, market anatomy, provider detail, actual Discover deltas, and inspectable Raven markers.

## Highest-confidence superiority slice

The first slice that can already feel better than a generic terminal is:

> Universal search → exact Hyperliquid perpetual or exact provider-backed pool → immediate dense chart and live market anatomy → public-safe Why now → evidence authority and contradiction → matured comparable outcomes → explicit read-only route/review state.

Hyperliquid remains the strongest fully live lane. The exact Robinhood Chain pool demonstrates that the same Terminal can resolve a previously missing address and render a provider-backed on-chain chart without pretending route support. RETIRE demonstrates the limit of deterministic aggregation: the same-provider lower intervals remain sparse, so RavenOS must use a commercially qualified secondary exact-pool source or show limited/unavailable coverage. It never generates candles from Raven observations.

That is the product thesis in working form: market plumbing disappears until it matters, while identity, provenance, uncertainty, and risk never do.
