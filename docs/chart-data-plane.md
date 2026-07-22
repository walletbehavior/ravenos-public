# RavenOS chart data plane

## Boundary

The chart data plane is a disposable, read-only presentation path. It may read
provider market data and Raven evidence, but it does not create or mutate
ExecutionObservations, Behavioral Atoms, forecasts, positions, outcomes, or
calibration artifacts. Chart failure must degrade the user interface before it
affects Raven's evidence runtime.

## Canonical identity

`ravenos.chart_instrument.v1` represents three scopes:

- `spot_token`: aggregate token identity. It is never presented as an exact pool.
- `spot_pool`: chain-native exact pool or pair identity.
- `perpetual`: venue-specific perpetual market identity.

The contract preserves chain, venue, base and quote assets, token/pool/market
addresses, precision, coverage state, market status, and provider routing. Chain
normalization does not erase chain-native addresses or venue identifiers.

## History and backfill

`GET /api/terminal/chart` is the bounded history gateway. The initial request is
limited to the visible chart window. The workspace sends `before` only when the
user approaches the left edge after initial rendering. Prepending older candles
preserves the visible time range.

Current adapters are:

- Hyperliquid candle snapshots for perpetuals.
- Atlas/Tradier protected history for exact listed instruments.
- A versioned exact-pool on-chain provider chain. DexPaprika is evaluated first
  in development and CoinGecko Onchain remains an optional same-market fallback.
- Raven's bounded spot projection for exact-pool annotations, Solana
  token-aggregate observations, and public-safe evidence markers.
- DexPaprika plus DexScreener normalized discovery/current pair state.
- Yahoo-backed aggregate proxy history for explicitly mapped broad markets.

Every response identifies its source, freshness, capabilities, lineage, and
canonical instrument. Provider failures remain unavailable or degraded; the
frontend does not generate replacement candles.

Successful exact-pool responses are also stored in two bounded Cloudflare edge
cache entries: a short-lived normal entry and a six-hour rescue entry. The rescue
entry is read only after provider failure and is always relabeled delayed and
degraded with its original observation time. It can prevent a throttled provider
from blanking a chart, but it cannot present cached history as current market
truth.

Provider selection is explicit in `lib/onchain_chart_providers.mjs`. A secret's
presence cannot silently change the selected chart authority. The current
DexPaprika Free path is for development evaluation only; production promotion is
blocked until a provider's commercial rights, exact-pool anchors, rate behavior,
and server-side production binding are qualified.

`lib/chart_continuity.mjs` owns the only permitted same-provider derivations:
`5m → 15m`, `15m → 1h`, `1h → 4h`, and `1h → 1d`. Every historical target
bucket must contain the complete expected source sequence. The current bucket may
be partial only when it begins on the exact boundary and remains contiguous.
`1m → 5m` is prohibited after exact-pool comparisons found material volume and
completeness disagreements. No gap is filled and no Raven observation becomes a
base candle.

## Live subscriptions

Hyperliquid active markets use one shared browser WebSocket subscription per
canonical instrument and timeframe. The feed normalizes candles, trades, order
book snapshots, last/mark/oracle prices, funding, and open interest. A 30-second
heartbeat keeps active connections alive. The client detects disconnect gaps,
reconnects with bounded exponential backoff, and reconciles against the history
gateway after recovery.

That 30-second value is a connection heartbeat, not a candle interval. Every
market advertised as chart-ready must pass a provider-backed one-minute anchor;
`1m` is never derived from a `30s` series. The listed-market boundary preserves
case so `1m` (one minute) and `1M` (one month) cannot collapse into one request.

Exact-pool spot markets use active-view bounded polling where supported. Polling
stops when the final viewer leaves. The shared subscription hub permits at most
12 active instrument feeds and drops chart updates before allowing unbounded
memory or queue growth.

`ravenos-spot-chart-projection.service` tails only new bytes from Raven's existing
append-only price registries. It writes a disposable SQLite projection with a
48-hour retention window and a one-million-row hard cap. The authenticated public
origin serves bounded per-instrument queries from that projection; chart requests
never scan the source JSONL files. Solana observed-swap tape uses five-second
active-view polling and emits every projected source event once per browser feed.
The service runs at low CPU and IO weight and is not a dependency of core Raven
capture.

Raven registries may be published through atomic file replacement. Projection
continuity therefore uses byte position and opened-file size rather than treating
every inode change as rotation. A smaller source is the deterministic reset
signal. Dedicated chain/time and chain/scope indexes keep diagnostics bounded,
and aggregate diagnostics run less often than chart freshness updates.

## Candle updates

Provider candles update the current chart bar incrementally. The chart does not
recreate its canvas or reset its viewport for each market update. A bounded
`FormingCandleAccumulator` is available for providers that expose trades without
forming candles; it handles rollover, duplicate suppression, and older-bucket
refusal.

## Raven overlays

Raven chart markers are read-only references to existing evidence. A marker is
admitted only when instrument identity, event time, and lineage are exact. Marker
queries are filtered to the visible instrument and time range. Distant evidence
is not snapped onto the nearest candle.

Every rendered Raven marker has both canvas selection and a keyboard-accessible
marker control. Selection reveals public source evidence, evidence maturity,
path transition, matured outcome context, support, and contradiction. Missing
fields remain explicitly unavailable.

## Diagnostics

`window.RavenOSChartDataPlane.diagnostics()` reports active instruments, active
viewers, shared subscriptions, dropped updates, rejected subscriptions, feed
age, event counts, and connection state. `window.__RAVENOS_PERPS_WORKSPACE__`
exposes bounded page diagnostics for validation without logging every event.
The authenticated origin endpoint
`/public/ravenos/chart_diagnostics.json` reports projection rows by chain and
scope, source cursor lag, database size, latest observations, cycle duration,
and resource bounds.

The Worker also records bounded chart-provider usage signals by provider, exact
pool, requested/source interval, cache state, direct/derived mode, fallback,
provider request count, and projected-cost state. Public health exposes only
aggregates; exact-pool request signals remain in internal structured logs and are
not represented as exact concurrent-viewer counts.

## Coverage limitations

- Hyperliquid does not currently expose a dedicated public liquidation stream in
  this adapter. No liquidation markers are synthesized.
- Anonymous DexPaprika and public GeckoTerminal capacity can rate-limit
  exact-pool history. A 429 is shown as degraded data. A previously verified
  same-provider, same-market response may be shown as an explicitly stale rescue;
  generated candles are never used.
- DexPaprika source density varies by exact pool. Chain coverage does not prove
  that a requested timeframe has enough useful bars. Under-depth history falls
  through only to another provider for the same exact market or remains
  unavailable.
- Solana exact provider-pool snapshots do not prove that a Yellowstone vault-pair
  swap occurred in the same public pair. The terminal therefore exposes those
  swaps only in a separately labeled token-aggregate view. Exact-pool snapshots
  never claim a trade tape.
- Base and Ethereum trade tapes are exact-pool but only as current as Raven's
  configured observation cadence. Sparse pools can remain delayed or historical.
- The bounded Raven projection supplies recent history. Provider adapters remain
  responsible for older visible-range backfill.
- Aggregate-token history and exact-pool history remain separate identities and
  may have different coverage.
- The existing private Moralis integration supplies bounded wallet/holder facts,
  not public base candles or Raven behavioral authority.
