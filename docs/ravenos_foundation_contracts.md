# RavenOS Foundation Contracts

RavenOS modules should share the same confidence, coverage, and outcome vocabulary.

## Coverage

Use `normalizeCoverage` from `lib/ravenos_coverage.mjs`.

Supported labels:

- `public`
- `indexed`
- `deep_raven`
- `cached`
- `preview`
- `sample`
- `unavailable`

Rules:

- Sample, preview, cached, and unavailable coverage must never be marked live.
- Dexscreener lookup should resolve to `public` unless Raven indexed data is merged.
- Fallback data should expose a warning and stale timestamp when available.

## Confidence

Use `normalizeConfidence` from `lib/ravenos_confidence.mjs`.

Every confidence object includes:

- `score`
- `label`: `low`, `developing`, `moderate`, or `high`
- `sampleDepth`
- `dataFreshness`
- `providerQuality`
- `replayQuality`
- `coverageQuality`
- normalized `coverage`

Use this for Explanation Engine, Replay Outcomes, Participant Intelligence, Degen Terminal, Perps, Research, Alerts, Watchlists, and Atlas.

## Outcome Observations

Use `normalizeObservation` and `serializeObservation` from `lib/ravenos_outcomes.mjs`.

Every observation can persist:

- instrument
- market
- timestamp
- structure type
- pressure state
- replay similarity
- participation state
- liquidity state
- attention state
- rotation state
- confidence
- coverage
- forward outcome
- outcome window
- outcome classification: `expansion`, `continuation`, `reversal`, `failure`, or `unresolved`

`persistObservation` is a safe hook. It returns a skipped result if no database binding is available.

No UI is exposed for the Outcome Database yet.
