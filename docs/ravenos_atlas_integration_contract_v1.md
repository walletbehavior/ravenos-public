# RavenOS Atlas Integration Contract v1

Status: verified private inputs; public adapter contract implemented but not connected to production
Public projection code: `lib/cross_market/atlas_projection.mjs`
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
| Public origin | `/srv/raven/app/tools/build_ravenos_public_origin.py` and `serve_ravenos_public_origin.py` | Publishes nine Raven endpoints; no Atlas endpoint currently exists. |

The current Atlas state showed fresh Massive market rows and fresh Tradier option summaries. This proves provider-backed private analytics. It does not prove a public equity terminal, company dataset, arbitrary-symbol endpoint, filings, earnings calendar, relationship graph, or customer broker integration.

## Current data limits

Current verified Atlas output can support:

- SPY, QQQ, IWM and selected broad-market ETF context;
- aggregate market posture and rail breadth;
- risk/equity regime labels;
- options regime, skew, demand, quality, and limited diagnostics;
- provider health and explicit degraded/stale state;
- cross-market context for Raven perps and token reads.

It does not yet publicly support:

- arbitrary equity lookup such as NVDA;
- a complete option chain in RavenOS;
- company fundamentals;
- filings or earnings chronology;
- corporate event feeds;
- peer/sector relationship graphs beyond current aggregate rail labels;
- broker accounts, orders, settlement, or execution;
- browser-side Tradier access.

The first Atlas product slice should therefore use a verified ETF context such as SPY while the arbitrary-equity public adapter is built. UI architecture may support equities and options, but unsupported modules must render unavailable—not sample rows.

## Public projection boundary

`buildPublicAtlasProjection()` accepts the three private aggregate state documents and emits `ravenos.atlas_projection.v1`.

Public fields include:

- generation time and freshness;
- aggregate Atlas posture, confidence, and rail alignment;
- risk/equity regime, sector breadth, and participation quality;
- bounded market rows with symbol, price, 5/21/63-day changes, sample points, provider label, and observation time;
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

## Target transport

The smallest justified production path is:

```mermaid
flowchart LR
  M[Atlas market state] --> B[Private public-safe Atlas builder]
  O[Tradier options summary] --> B
  S[Atlas synthesis] --> B
  B --> J[atlas.json]
  J --> P[Protected public-origin exact allowlist]
  P --> W[RavenOS Worker server-side read]
  W --> C[/api/atlas public projection]
  C --> UI[Discover / Terminal / Atlas]
```

Requirements before this path becomes current:

1. Add a deterministic private projection builder using the public adapter rules.
2. Add `atlas.json` to the public-origin manifest and exact allowlist.
3. Version its schema and include it in the RavenOS public-origin release contract.
4. Extend the private and public no-leak validators.
5. Add size, schema, source, freshness, timeout, and redirect rejection in the Worker.
6. Fail Atlas alone when unavailable; Raven crypto and perp lanes must remain healthy.
7. Restart/reload only the public-origin service if its exact endpoint allowlist changes, with separate authorization and smoke verification.

Tradier must never be called directly from browser JavaScript. If future arbitrary-symbol lookup is required, it must be a bounded server-side adapter with symbol validation, response size limits, rate limits, provider health, cache policy, and no credential reflection.

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

- ETF rows such as SPY resolve to an exact supported listing/venue when that adapter is available.
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
