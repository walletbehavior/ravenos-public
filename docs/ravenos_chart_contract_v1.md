# RavenOS normalized chart contract v1

Status: implemented evaluation baseline; backward-compatible response extension

Schema: `ravenos.chart_candle_series.v1`

## Responsibilities

| Concern | Authority |
|---|---|
| Instrument/pool discovery | Normalized DexPaprika + DexScreener search or exact listed/perp registry |
| Exact market identity | Canonical RavenOS instrument plus exact pool/contract/listing |
| Historical base candles | Venue-native, Atlas listed-market, or selected versioned exact-pool provider |
| Live base-candle updates | Venue WebSocket or bounded exact-provider refresh |
| Wallet/holder facts | Private bounded Moralis enrichment where supported |
| Raven intelligence | Annotation/event/overlay payload only |
| Freshness/availability | Worker adapter, provider health, and exact-cache lineage |

## Response shape

Existing consumers may continue to read `candles`. New consumers must validate `candle_series` and `provider_selection`.

```json
{
  "ok": true,
  "instrument": {
    "schema_version": "ravenos.chart_instrument.v1",
    "canonical_id": "spot_pool:base:onchain_pool:cbBTC/USDC:USD:<exact-pool>",
    "identity_scope": "exact_pool",
    "chain": "base",
    "pool_address": "<exact-pool>"
  },
  "candle_series": {
    "schema_version": "ravenos.chart_candle_series.v1",
    "role": "base_ohlcv",
    "instrument_id": "<canonical-id>",
    "identity_scope": "exact_pool",
    "exact_identity": true,
    "provider": "dexpaprika",
    "provider_market_id": "base:<exact-pool>",
    "timeframe": "15m",
    "price_currency": "USD",
    "token_orientation": "selected_token_usd",
    "source_interval": "5m",
    "derivation": {
      "state": "derived",
      "source_interval": "5m",
      "target_interval": "15m",
      "missing_buckets_filled": 0,
      "interpolation_used": false
    },
    "continuity_state": "verified",
    "freshness_state": "live",
    "bar_count": 366,
    "raven_observations_are_candles": false
  },
  "provider_selection": {
    "attempted": [{ "provider": "dexpaprika", "state": "selected" }],
    "selected": "dexpaprika",
    "fallback": false,
    "commercial_state": "free_development_only"
  },
  "chart_readiness": {
    "schema_version": "ravenos.exact_market_chart_readiness.v1",
    "state": "verified_current",
    "exact_market_verified": true,
    "provider_id": "dexpaprika",
    "timeframe": "15m",
    "bars": 366,
    "one_minute_requirement": "not_evaluated_by_this_request"
  },
  "continuity": {
    "schema_version": "ravenos.chart_continuity.v1",
    "state": "verified",
    "exact_pool_fingerprint": "base:<pool>:<selected-token>:<quote-token>",
    "selected_token_decimals": 18,
    "quote_token_decimals": 6,
    "token_orientation": "selected_token_usd",
    "candles": {
      "duplicate_rows": 0,
      "conflicting_duplicates": 0,
      "missing_source_buckets": 0,
      "freshness_state": "fresh"
    }
  },
  "provider_usage": {
    "provider": "dexpaprika",
    "interval": "15m",
    "source_interval": "5m",
    "cache_hit": false,
    "candle_mode": "derived",
    "fallback_event": true,
    "active_viewer_measurement": "request_signal_only"
  },
  "market_anatomy": {
    "schema_version": "ravenos.market_anatomy.v1",
    "exact_identity": true,
    "market_profile": {
      "schema_version": "ravenos.onchain_market_profile.v1",
      "identity": {
        "state": "exact",
        "chain": "base",
        "pool_address": "<exact-pool>",
        "token_address": "<selected-token>",
        "quote_token_address": "<quote-token>"
      },
      "holder_distribution": {
        "state": "available",
        "holder_count": 4852,
        "observed_at": "2026-07-28T04:00:00Z",
        "top_10_pct": 29.95,
        "next_10_pct": 12.4593,
        "next_20_pct": 15.1691,
        "rest_pct": 42.4216
      },
      "token_controls": {
        "mint_authority": "disabled",
        "freeze_authority": "disabled",
        "honeypot": "unknown",
        "developer_holding_pct": 1.74
      },
      "links": [
        { "kind": "website", "label": "example.com", "url": "https://example.com/" }
      ]
    }
  },
  "candles": [
    { "time": 1784696400, "open": 1, "high": 1.1, "low": 0.9, "close": 1.05, "volume": 10 }
  ],
  "raven_annotations": {
    "schema_version": "ravenos.chart_annotations.v1",
    "role": "annotation_only",
    "identity_scope": "exact_pool",
    "instrument_id": "<same-canonical-id-as-base-series>",
    "market_identity": "base:<exact-pool>",
    "price_unit": "usd_per_token",
    "price_axis_compatible": true,
    "candle_replacement_allowed": false,
    "events": [
      { "type": "raven-observation", "time": 1784696400, "exact_observed_at": "2026-07-22T13:00:00Z" }
    ],
    "overlays": [],
    "lineage": { "source": "Raven exact observations", "observed_at": "2026-07-22T13:00:00Z" }
  },
  "freshness_state": "live",
  "lineage": {
    "provider": "DexPaprika",
    "network": "base",
    "pool_address": "<exact-pool>",
    "source_precedence": "provider_ohlcv_base_raven_annotations_only"
  },
  "attribution": {
    "label": "Powered by DexPaprika",
    "url": "https://dexpaprika.com/"
  }
}
```

## Invariants

1. `candle_series.role` is `base_ohlcv` for every rendered candle.
2. Every pool series retains exact chain, pool, selected token, quote token, provider market, orientation, timeframe, and price currency.
3. Canonical market identity does not change when provider order, provider plan, or secret bindings change.
4. Provider selection is explicit through `RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER`; key presence never silently changes authority.
5. Raven observations never create, close, overwrite, extend, interpolate, or backfill a base candle.
6. Raven price-axis events are admitted only when exact market identity and price units match.
7. Token aggregates never substitute for exact-pool history.
8. Provider fallback may occur only for the same exact selected market. A different pool, token aggregate, venue, or historical snapshot is not fallback.
9. A stale rescue must match exact provider market and expose degraded freshness and original observation time.
10. Missing current and rescue data produces an unavailable response and empty candles.
11. Raw provider payloads, provider credentials, internal paths, and proprietary Raven evidence do not enter this response.
12. Commercial qualification is independent of technical success and is enforced by the release gate.
13. `1m → 5m` is prohibited. Only the derivations declared in `PRIMARY_PROVIDER_DERIVATIONS` may run.
14. A completed derived bucket contains every expected source bar; missing buckets are never filled and sparse observations never become market candles.
15. A provider transition must preserve exact pool, token/quote orientation, decimals, and continuity. A rejected transition cannot update the chart.
16. A release-enforced Worker cannot use keyless GeckoTerminal capacity.
17. `1m` is required for every advertised chart-ready market and must contain at least 120 useful provider-backed bars in the release anchor matrix.
18. `1m` and `1M` are distinct case-sensitive product intervals. Provider adapters and public-origin contracts may not collapse them.
19. No `30s` candle source is required, and sub-minute data is not used to manufacture one-minute history.
20. Static network/provider routing proves only that a request can be attempted. It never proves that the selected exact pool is chart-ready.
21. Search may expose `probe_required` or `unavailable`; only a validated exact-market response may expose `verified_current` or `verified_with_visible_staleness`.
22. A provider-specific request cannot silently fall back to a different provider merely because that provider supports the network.
23. CoinGecko's provider-defined empty intervals are accepted only when explicitly requested, attributed in lineage, and returned as previous-close, zero-volume bars. RavenOS itself never manufactures them.
24. Exact-pool profile data is accepted only when the selected token and quote both match the exact requested pool response.
25. Holder concentration is aggregate-only. Raw holder wallets, developer addresses, provider prose, scores, payloads, and migration targets never enter the public chart response.
26. Submitted token links are bounded to HTTPS, reject local/private destinations, and are rendered as inert text links rather than HTML.
27. Missing, malformed, or stale profile enrichment never changes candle authority, chart identity, or chart availability. The absent profile section is omitted.

## Exact-pool market profile

`ravenos.onchain_market_profile.v1` is a bounded optional enrichment attached to `market_anatomy`. It uses the same exact chain, pool, selected-token, and quote-token identity as the candle request. The current CoinGecko Basic implementation may project:

- token name, symbol, decimals, and an allowlisted image URL;
- holder count and the aggregate top-10, ranks 11–20, ranks 21–40, and remaining-holder shares;
- mint and freeze authority state without exposing authority addresses;
- honeypot flag state as reported by the provider;
- developer holding percentage without exposing the developer address;
- completed launch state and timestamp;
- bounded HTTPS website and social links;
- required provider attribution and cache accounting.

The profile is cached for ten minutes in the Worker and Cloudflare Cache API. It is a market-anatomy enrichment, never price history, Raven evidence, actor identity, wallet attribution, or execution authority. An enrichment error fails open only for this optional section; exact-pool candles retain their existing fail-closed identity and continuity rules.

## Capability registries

`lib/onchain_chart_providers.mjs` exports `RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY` (`ravenos.onchain_chart_provider_registry.v1`). It records each provider's identity, exact-pool support, network mapping, native intervals, maximum rows, live mechanism, server-secret binding, attribution requirements, commercial state, and production state.

`ravenos-chart-data-plane.js` exports `RAVENOS_CHART_CAPABILITY_REGISTRY` (`ravenos.chart_capability_registry.v1`). It records market/network discovery, historical/live support, intervals, maximum history, provider order, freshness, Raven overlays, route preview, and execution capability.

`resolveChartCapability()` requires an exact pool before returning `chart_request_supported=true`. Its legacy `chart_ready` field remains a request-routing alias for compatible consumers, but on-chain customer surfaces must use `advertised_chart_ready=false` until the exact provider response passes. A discoverable exact market can still be unchartable, under-depth, non-routeable, or non-executable. Unknown networks and provider/network mismatches fail closed without choosing another provider.

## DexPaprika adapter specifics

- The pool detail endpoint is checked before OHLCV is accepted.
- EVM pool requests are lowercased without changing canonical identity.
- DexPaprika `base_token_id` and `quote_token_id` determine whether `inversed` is required.
- The raw response is bounded to 366 rows and 512 KiB, normalized, sorted, and deduplicated.
- Qualified higher intervals may be derived from complete real source rows according to the fixed derivation registry; no sparse interval is fabricated.
- Insufficient source depth can invoke the next configured provider for the same exact market or return unavailable.

## Customer-visible availability

The UI distinguishes:

- discovered;
- exact identity verified;
- chart available;
- chart delayed/degraded;
- route preview available;
- execution unavailable.

Those states are not collapsed into a generic “supported” badge. Provider identity and attribution remain visible without exposing internal plumbing or secrets.
