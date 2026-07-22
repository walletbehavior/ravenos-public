# RavenOS Atlas Integration Contract v1

Status: exact public adapter and UI slice implemented and tested; protected origin loaded; RavenOS Worker release not yet promoted
Public projection code: `/srv/raven/app/tools/build_ravenos_public_origin.py`, `lib/cross_market/atlas_projection.mjs`, and `worker.mjs`
Target schema: `ravenos.atlas_projection.v1`

## Role inside RavenOS

Atlas is the cross-market context system for equities, ETFs, options, rates, FX, energy, market relationships, and future company/event intelligence. It is not a second dashboard and it is not a second narrator.

Raven contributes behavioral evidence, decision-time context, participant/cohort structure, historical paths, and matured outcomes. Atlas contributes market-session and cross-asset context. The public UI combines those structured inputs under simple labels such as Why now, What changed, Path, Evidence, Similar history, Risk, and Plan.

## Verified private inputs on 2026-07-21

The bounded continuity refresh proved these current paths:

| Capability | Canonical private path | Current state |
| --- | --- | --- |
| Broad ETF/market rails | `/srv/raven/app/services/atlas_market.py` -> `data/atlas_market_state.json` | Current. Massive is the active provider when configured; bounded fallbacks exist. |
| Options summaries | `/srv/raven/app/services/atlas_options.py` -> `data/atlas_options_state.json` | Current Tradier production summaries for SPY, QQQ, and IWM. |
| Atlas synthesis | `/srv/raven/app/services/atlas_state.py` -> `data/atlas_state.json` | Current aggregate posture, breadth, alignment, options context, and rail health. |
| Analytics refresh | `/srv/raven/app/services/atlas_analytics_refresh_v1.py` | Analytics-only, explicitly reports `paper_engine_started=false` and `execution_path_loaded=false`. |
| Proposed service files | `/srv/raven/app/ops/systemd/raven-atlas-analytics-refresh.{service,timer}` | Present in source but not installed as systemd units at refresh time. |
| Public origin source | `/srv/raven/app/tools/build_ravenos_public_origin.py` and `serve_ravenos_public_origin.py` | Atlas is the ninth fixed source endpoint. The protected origin was loaded with the bounded listed lookup and chart contracts on 2026-07-22; unrelated Raven services were not restarted. |
| Exact public instrument registry | `/srv/raven/app/config/atlas_public_instrument_registry.json` | SPY, QQQ, and IWM retain fixed verified identities for Atlas projection admission. |
| Bounded listed-market lookup | `/srv/raven/app/tools/serve_ravenos_public_origin.py` -> protected `instrument_lookup.json?q=` -> `/api/instruments/search` | Exact US equity/ETF identities are sanitized from Tradier server-side. Query, response size, result count, exchange codes, freshness, and execution state are bounded. Active on the protected origin. |
| Bounded listed-market charts | `/srv/raven/app/tools/serve_ravenos_public_origin.py` -> protected `instrument_chart.json` -> `/api/terminal/chart` | The origin re-verifies the exact Tradier identity, retrieves provider history server-side, and emits only bounded, sorted, deduplicated OHLCV. Provider payloads and credentials never cross the projection. Active on the protected origin; Worker promotion pending. |
| RavenOS Worker adapter | `/api/atlas` in `worker.mjs` | Current-origin-only, schema/size/freshness validated, no embedded fallback; implemented and tested but not deployed. |
| Product consumers | `ravenos-shell.js`, `ravenos-atlas.js`, `ravenos-terminal-live.js` | Exact ETF search, Atlas research table, and exact-listing Terminal slice implemented and browser-tested. |

The current Atlas state showed fresh Massive market rows and fresh Tradier option summaries. This proves provider-backed private analytics. It does not prove a public equity terminal, company dataset, arbitrary-symbol endpoint, filings, earnings calendar, relationship graph, or customer broker integration.

## Current data limits

Current verified Atlas output can support:

- SPY, QQQ, IWM and selected broad-market ETF context;
- aggregate market posture and rail breadth;
- risk/equity regime labels;
- options regime, skew, demand, quality, and limited diagnostics;
- provider health and explicit degraded/stale state;
- cross-market context for Raven perps and token reads.

The undeployed Worker branch now supports exact listed-instrument discovery and provider-backed price-chart inspection through the protected origin. This provides identity and chart coverage; it does not create Atlas intelligence for each returned listing.

It does not yet publicly support:

- complete Atlas context for arbitrary equities such as NVDA;
- a complete option chain in RavenOS;
- company fundamentals;
- filings or earnings chronology;
- corporate event feeds;
- peer/sector relationship graphs beyond current aggregate rail labels;
- broker accounts, orders, settlement, or execution;
- browser-side Tradier access.

The first Atlas product slice now uses exact SPY/QQQ rows when current market state contains them. IWM retains a verified registry identity and current options summary but is not fabricated as a priced market row when the current market state omits it. Unsupported modules render unavailable—not sample rows.

## Public projection boundary

`buildPublicAtlasProjection()` accepts the three private aggregate state documents and emits `ravenos.atlas_projection.v1`.

Public fields include:

- generation time and freshness;
- aggregate Atlas posture, confidence, and rail alignment;
- risk/equity regime, sector breadth, and participation quality;
- bounded market rows with an exact `ravenos.instrument.v1` listing identity, symbol, price, 5/21/63-day changes, sample points, provider label, and observation time;
- aggregate option contexts by underlying;
- bounded provider health;
- an explicit capabilities object;
- explicit unavailable capability reasons.

The adapter intentionally removes:

- API keys and credential metadata;
- provider request/response payloads;
- provider URLs and debug structures;
- private filesystem paths;
- paper-engine state and candidates;
- internal permission state;
- execution or reservation state;
- proprietary thresholds and calibration mechanics.

The adapter does not expose the raw `by_underlying.provider_debug` structures currently present in `atlas_options_state.json`.

## Implemented transport (Worker promotion pending)

The smallest justified production path is:

```mermaid
flowchart LR
  M[Atlas market state] --> B[Private public-safe Atlas builder]
  O[Tradier options summary] --> B
  S[Atlas synthesis] --> B
  B --> J[atlas.json]
  T[Tradier exact lookup] --> P
  Y[Listed-market chart provider] --> P
  J --> P[Protected public-origin exact allowlist]
  P --> W[RavenOS Worker server-side read]
  W --> C[/api/atlas public projection]
  C --> UI[Discover / Terminal / Atlas]
```

Implemented in source and isolated tests:

1. Deterministic private projection builder with exact registry admission.
2. `atlas.json` in the public-origin manifest and exact allowlist.
3. Versioned schema in the RavenOS public-origin release contract.
4. Private safety scanning and generated Worker-response scanning.
5. Worker size, schema, source, freshness, timeout, redirect, identity, and execution-boundary rejection.
6. Atlas-only degradation; Raven crypto and perp lanes remain independent.

Still required before production use:

1. Stage the exact immutable RavenOS release and run the Cloudflare production-equivalent preflight.
2. Verify AAPL and SPY chart coverage through the real Worker-to-origin path.
3. Promote only the verified immutable release tuple under the owner authorization already granted for this pass.

Tradier and the listed-chart provider are never called directly from browser JavaScript. Exact-instrument lookup and chart normalization run only inside the protected private origin and return strict public-safe projections through the Worker. Lookup enforces query validation, a 256 KiB response bound, a 12-result cap, an admitted US exchange map, stock/ETF-only types, short caching, exact canonical identities, server-only credentials, and hard-false broker/quote/signing/submission capabilities. Charts re-verify that identity, accept only seven bounded timeframes, cap output at 1,000 candles and 512 KiB, remove raw provider structures, and retain hard-false execution state. Unknown exchanges, options, malformed identities, stale payloads, and provider failures fail closed.

## Health semantics

Atlas health is independent from core Raven and market health.

Recommended public states:

- `available`: projection is within policy and required rails are healthy;
- `degraded`: projection is usable but one or more optional rails are delayed, partial, or provider-limited;
- `stale`: projection age exceeds policy and must not be presented as current;
- `unavailable`: no valid public projection exists.

An Atlas outage must not collapse Hyperliquid market data, Raven Opportunity Census, exact spot charts, or existing public Raven evidence. The Terminal should show Atlas context unavailable while retaining its other current modules.

## Instrument handoff

Atlas entities and market rows resolve through `ravenos.instrument.v1` before opening Terminal. A ticker alone is not sufficient if multiple listings or derivative contracts exist.

- SPY resolves to `etf:nyse-arca:spy`, QQQ to `etf:nasdaq:qqq`, and IWM to `etf:nyse-arca:iwm` in the fixed Atlas registry.
- Other admitted US equities and ETFs resolve through the protected current lookup to exact identities such as `equity:nasdaq:aapl`. A lookup result may provide chart inspection without implying Raven evidence, Atlas context, broker connectivity, quote preview, or execution.
- Options require an exact contract identity and underlying instrument ID.
- Atlas events point to one or more canonical instruments; they cannot silently select one.
- Terminal links back to Atlas using the same exact instrument ID.

## Raven + Atlas sidecar contract

The combined public intelligence sidecar should keep factual domains distinct even when rendered as one product narrative:

```json
{
  "current_market_facts": {},
  "raven_behavioral_interpretation": {},
  "atlas_contextual_interpretation": {},
  "evidence_state": {},
  "uncertainty": [],
  "unavailable": []
}
```

The UI may merge the hierarchy, but it may not merge provenance. Atlas context cannot be presented as Raven behavioral evidence, and Raven evidence cannot be presented as a company/event fact.

## Entitlement boundary

Current infrastructure has no complete production authentication, subscription, D1 entitlement, or token-gating system. Atlas public fields must remain within the public-safe contract until real server-side entitlements exist.

Future deeper fields—complete option chains, company/event archives, relationship depth, saved research packets, advanced comparisons—must be enforced server-side. Client-only concealment is insufficient.

## Validation requirements

- projection schema and size tests;
- stale, unavailable, malformed, and provider-outage tests;
- provider debug and credential rejection;
- arbitrary-symbol ambiguity tests;
- option exact-identity tests;
- cross-market handoff tests;
- generated Worker-response no-leak scanning;
- JS/CSS/map/manifest scanning;
- public-origin token remains server-only;
- no paper or execution state crosses the adapter.

Current focused evidence:

- private public-origin suite: 10/10, including token enforcement, provider sanitization, bounded lookup, bounded listed charts, exact identity, and fixed artifact routes;
- RavenOS contract suite: 127/127, including current Atlas, listed-market lookup, protected listed charts, exact chart re-verification, origin failure, stale payload, malformed identity, and no-substitution cases;
- browser suite: 77/77, including Atlas-to-Terminal, arbitrary AAPL lookup without Atlas context, same-ticker equity-versus-token ranking, Robinhood Chain contract lookup, chart controls, focus mode, and mobile containment;
- generated deploy-asset and 26-route Worker-response no-leak scans pass;
- signing and submission remain hard false.

Listing identity sources:

- SPY: State Street’s official SPY product page identifies NYSE Arca: <https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy>;
- QQQ: Invesco’s official QQQ product page identifies Nasdaq: <https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=investors&productId=QQQ&ticker=QQQ>;
- IWM: iShares’ official IWM product page identifies NYSE Arca: <https://www.ishares.com/us/products/239710/IWM>.
