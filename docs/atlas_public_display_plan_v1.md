# Atlas free-first public-display plan v1

Status: licensing-safe implementation path
Reviewed: 2026-08-26

## Decision

Atlas will not use Tradier, Massive, Yahoo Finance, or a blanket FRED entitlement as its anonymous public observation layer. The public product will use authoritative zero-dollar sources where their product terms support the intended use, a narrowly labeled IEX-only lane for equity reference data, and an authenticated broker overlay for current options data.

This is a free-first architecture, not a claim that every market can be covered by a free quote feed. Exchange-grade consolidated equities, futures quotes, index values, news, analyst estimates, and anonymous options chains remain paid/licensed products.

## What Raven can ship at zero data-subscription cost

| Atlas surface | Source | Cadence | Public use in Raven | Integration state |
| --- | --- | --- | --- | --- |
| Instrument identity across providers | [OpenFIGI v3](https://www.openfigi.com/api/documentation) | On demand, cached | Canonical FIGI/listing mapping. FIGI identifiers are dedicated to the public domain; third-party input identifiers keep their own rights | Ready for private-origin adapter |
| Filings and filing events | [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) and [SEC RSS](https://www.sec.gov/data-research/structured-data/structured-disclosure-rss-feeds) | API near real time; structured RSS every 10 minutes during published weekday hours | Filing metadata, documents, XBRL facts, and event alerts | Filings already connected; RSS/companyfacts expansion next |
| Insider activity | SEC Forms 3, 4, and 5 | Filing-time path plus quarterly bulk data | Normalized reported purchases, sales, awards, exercises, and ownership changes | Already connected |
| Institutional and beneficial ownership | SEC Forms 13F and Schedules 13D/13G | Filing cadence | Delayed reported holdings and ownership events, clearly labeled | Next SEC expansion |
| ETF and fund holdings | SEC Form N-PORT / N-CEN | Public filing cadence; not live holdings | Delayed public fund portfolio and fund metadata | Next SEC expansion |
| Company fundamentals | SEC Company Facts/XBRL | Updated as filings disseminate | Reported financial statement facts with filing context; no analyst estimates | Next SEC expansion |
| Energy | [EIA Open Data](https://www.eia.gov/opendata/documentation.php) | Dataset-specific | Energy series and Raven-derived context with EIA attribution | Already connected |
| Treasury curves | [Treasury XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) | Daily | Nominal/real yield curves, bill rates, curve shape, and Raven-derived regimes | Ready for private-origin adapter |
| Official funding rates | [New York Fed reference rates](https://www.newyorkfed.org/markets/reference-rates) | Business daily | SOFR, EFFR, OBFR, TGCR, BGCR, averages, and index | Ready for private-origin adapter |
| Inflation, employment, growth, and income | BLS and BEA official APIs | Release cadence | Macro observations and release-event context | Ready for private-origin adapters |
| Daily FX reference | [ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) | Business daily | Reference-only FX history and Raven-derived context with ECB attribution; not transaction pricing | Ready for private-origin adapter |
| Futures positioning | [CFTC COT API](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm) | Weekly | Aggregate futures and futures-plus-options positioning/crowding context; not futures quotes | Ready for private-origin adapter |
| US equity T+1 reference | [IEX HIST](https://www.iex.io/products/equities/market-data-connectivity) | T+1 | IEX-only trades/quotes with the exact required IEX attribution; never labeled consolidated or official close | Ready for a private PCAP ingestion pipeline |

All provider requests, keys, bulk downloads, parsing, caching, and rate limiting belong in the private Atlas origin. The public Worker receives only normalized, product-labeled observations with a recorded display decision.

## The only plausible zero-data-fee delayed equity stream

[IEX's current fee schedule](https://www.iex.io/resources/trading/fee-schedule) lists delayed TOPS, DEEP, and DEEP+ at a $0 exchange data fee and defines delayed as at least 15 minutes. It also says delayed data may be further redistributed. That does not make it a free HTTP API:

- It covers activity on IEX Exchange only, not the consolidated US market.
- Raven must establish receipt through IEX or an approved data distributor.
- Agreements/forms and connectivity or distributor charges can still apply.
- It must be labeled as IEX-only and at least 15 minutes delayed.

Therefore `iex_tops_delayed` is recorded as `agreement_and_connectivity_required`, not active. IEX HIST can be built first because its T+1 distribution permission and required attribution are explicit.

## Options boundary

There is no anonymous free delayed US options quote lane for RavenOS. OPRA requires a vendor agreement for redistribution of current or delayed options information. A 15-minute delay changes some fees; it does not erase the agreement or turn a personal broker API into public-display permission.

The product behavior is therefore:

1. Anonymous users receive exact contract identity, expirations/reference metadata that Raven has a right to show, SEC filing context, and historical/aggregate public analytics.
2. Current option chains and quotes appear only after the user connects an entitled broker account.
3. Broker observations stay private to that user, are not put in the public cache, and are never used as Raven's anonymous feed.
4. If Raven later signs an OPRA vendor arrangement, it is activated as a separate data product with its own delay, attribution, reporting, and cache policy.

## What stays unavailable until a paid or signed data product exists

- Consolidated US equity quotes and official closing prices.
- Anonymous public option chains, Greeks, bid/ask, volume, and open interest.
- Futures and listed-commodity quotes.
- Proprietary index values.
- Analyst estimates, ratings, and earnings consensus.
- Broad commercial news and machine-readable news redistribution.
- Current ETF holdings sourced from fund sponsors rather than delayed SEC filings.

Atlas should say `unavailable` for these surfaces instead of silently substituting a scraped or personal-use feed.

## Rejected free-feed shortcuts

The following are not free anonymous-public Raven feeds under their current published terms:

- Massive/Polygon individual plans, including the free EOD tier, are personal/non-business; public commercial display is a Business product.
- Twelve Data Basic is internal/non-display. External display begins on a paid business tier, and redistribution can require a separate add-on or agreement.
- Cboe One/BATS is not a free public-display workaround. Cboe publishes external-distribution, consolidation, user, and digital-media fees.
- Market Data's self-service plans are internal/personal; public redistribution requires a commercial arrangement and the applicable exchange licenses.
- OANDA market data cannot be republished under the ordinary API/internal-use license.
- A disclaimer or “15 minutes delayed” badge satisfies neither a missing vendor agreement nor a provider redistribution restriction.

These products can be reconsidered as paid fallbacks, but none should be activated from a free API key.

## Enforced activation gate

No observation becomes public because a key exists or a setting is enabled. Every provider/data product must carry:

1. The named data product and entity/series scope.
2. Public anonymous commercial-display permission.
3. Raw-display and Raven-derived-metric permission.
4. Cache/history/retention rules.
5. Delay and attribution requirements.
6. Any audience, geography, reporting, or connectivity obligation.
7. Evidence URL/order form, review date, and owner.

The Worker admits values only when the upstream product policy is explicitly `allowed`, raw redistribution is true, a decision source and review date are recorded, and no provider/product hard block applies. Unknown, restricted, and internal-only observations remain null.

The public control-plane inventory is exposed at `GET /api/atlas/sources`. It describes what is connected, ready to build, agreement-required, broker-private, or blocked. It contains no credentials and does not itself activate a feed.

## Build order

1. Keep Massive, Tradier, Yahoo, anonymous OPRA options, and ICE/BofA-through-FRED observations blocked.
2. Expand the existing SEC lane with RSS events, Company Facts, 13F, 13D/13G, and public N-PORT/N-CEN data.
3. Add OpenFIGI v3 as the cached identifier mapping layer.
4. Add Treasury, New York Fed, BLS, BEA, ECB FX, and CFTC adapters behind the private Atlas origin.
5. Build the IEX HIST T+1 PCAP ingestion pipeline with exact IEX attribution and IEX-only labels.
6. Ask IEX/distributors for the real all-in cost and paperwork for delayed TOPS; activate it only after the connection and display route are documented.
7. Keep current options as an authenticated broker overlay until Raven deliberately signs an OPRA vendor arrangement.
