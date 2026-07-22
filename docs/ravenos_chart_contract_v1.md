# RavenOS normalized chart contract v1

Status: implemented, backward-compatible response extension

Schema: `ravenos.chart_candle_series.v1`

## Responsibilities

The chart response separates six concerns:

| Concern | Authority |
|---|---|
| Instrument/pool discovery | DexScreener or the exact listed/perp venue registry |
| Exact market identity | Canonical RavenOS instrument plus exact pool/contract/listing |
| Historical base candles | Venue-native, Atlas listed-market, or CoinGecko Onchain provider |
| Live base-candle updates | Venue WebSocket or bounded provider refresh/poll |
| Raven intelligence | Annotation/event/overlay payload only |
| Freshness/availability | Worker adapter and exact-provider cache lineage |

## Response shape

Existing consumers may continue to read `candles`. New consumers must also validate `candle_series`.

```json
{
  "ok": true,
  "instrument": {
    "schema_version": "ravenos.chart_instrument.v1",
    "canonical_id": "spot_pool:solana:onchain_pool:RETIRE/SOL:USD:<exact-pool>",
    "identity_scope": "exact_pool",
    "chain": "solana",
    "pool_address": "<exact-pool>"
  },
  "candle_series": {
    "schema_version": "ravenos.chart_candle_series.v1",
    "role": "base_ohlcv",
    "instrument_id": "<canonical-id>",
    "identity_scope": "exact_pool",
    "exact_identity": true,
    "provider": "coingecko_onchain",
    "provider_market_id": "solana:<exact-pool>",
    "timeframe": "15m",
    "price_currency": "USD",
    "token_orientation": "base",
    "bar_count": 480,
    "raven_observations_are_candles": false
  },
  "candles": [
    { "time": 1784696400, "open": 1, "high": 1.1, "low": 0.9, "close": 1.05, "volume": 10 }
  ],
  "raven_annotations": {
      "schema_version": "ravenos.chart_annotations.v1",
      "role": "annotation_only",
      "identity_scope": "exact_pool",
      "instrument_id": "<same-canonical-id-as-base-series>",
      "market_identity": "solana:<exact-pool>",
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
    "provider": "CoinGecko Onchain",
    "network": "solana",
    "pool_address": "<exact-pool>",
    "source_precedence": "provider_ohlcv_base_raven_annotations_only"
  }
}
```

## Invariants

1. `candle_series.role` is always `base_ohlcv` for rendered candles.
2. Every pool series has exact chain, pool address, token orientation, provider market ID, timeframe, and price currency.
3. The canonical market ID does not change when the configured CoinGecko tier changes.
4. Raven observations never create, close, overwrite, extend, or backfill a base candle.
5. Raven price-axis events are included only when the exact pool matches and the projected unit is USD per selected base token.
6. Non-comparable Raven events remain annotation metadata and do not enter `recent_trades` or the candle axis.
7. Token aggregates never substitute for exact-pool history.
8. A stale rescue must match the exact provider market and expose degraded freshness.
9. Missing current and rescue data produces `ok=false`, `candle_series=null`, and `candles=[]`.
10. Provider secrets remain server-only and are excluded from the response contract.

## Capability registry

`ravenos-chart-data-plane.js` exports `RAVENOS_CHART_CAPABILITY_REGISTRY` with schema `ravenos.chart_capability_registry.v1`.

For each verified on-chain network it records:

- discovery support;
- historical and live candle support;
- intervals and maximum history;
- history/live providers;
- freshness policy;
- Raven overlay support;
- route-preview support;
- execution support.

Network aliases are part of the same versioned registry rather than a separate chart-ready list. Each exact-pool resolution returns its provider network and `exact_market_id`; discovery alone never implies chartability.

`resolveChartCapability()` requires an exact pool before returning `chart_ready=true`. Robinhood Chain is explicitly discoverable but not chartable. Unknown networks fail closed.
