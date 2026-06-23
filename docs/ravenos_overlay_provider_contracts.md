# RavenOS Overlay Provider Contracts

RavenOS chart overlays are rendered by `RavenPriceChart`, but data should enter through provider contracts in `lib/overlays`.
The contract keeps chart rendering separate from collection, storage, and market-specific adapters.

## Resolver

`resolveRavenChartOverlays` accepts:

- `instrument`: generic market identity such as `symbol`, `asset`, `instrumentId`, `market`, `venue`, and `marketType`.
- `candles`: optional OHLCV context used to place regions when provider data omits explicit coordinates.
- `tier`: `free`, `pro`, or `founder`.
- `data`: optional normalized provider data.
- `providers`: optional provider list for tests or product-specific bundles.

The resolver calls every supported provider, merges returned `RavenChartOverlay` objects, filters founder-only experimental overlays for lower tiers, and falls back to the mock provider if no live provider produces usable overlays.

## Normalized Inputs

Provider adapters should normalize live data into these 0-100 fields before it reaches the chart:

- `pressureScore`: perpetual futures pressure, basis, funding, open interest, or liquidation-proximity context.
- `compressionScore`: range, realized volatility, activity, and liquidity compression.
- `breadthPercentile`: participation breadth across the selected market group.
- `participantScore`: participant behavior intensity or confidence.
- `severity`: `info`, `warning`, `danger`, or `success`.

## Providers

- `mockProvider`: deterministic fallback and free-tier sample overlays.
- `perpsProvider`: maps normalized perpetual futures pressure into `pressure-zone` overlays.
- `marketBreadthProvider`: maps market breadth percentiles into `breadth-line` overlays.
- `liquidityProvider`: maps normalized liquidity regions into `liquidity-zone` overlays.
- `compressionProvider`: maps compression context into `compression-band` overlays.
- `participantProvider`: maps behavior shifts into `participant-shift` overlays.

## Live Data Plug-In Path

Collectors should not call chart components directly. They should write or serve market-agnostic records keyed by instrument, market, venue, and time window.
Application code can then fetch those records, normalize scores to 0-100, and pass them to `resolveRavenChartOverlays`.

Free users receive delayed/sample overlays through tier decoration. Pro receives all available non-experimental overlays. Founder receives experimental overlays such as rotation events or experimental compression layers.
