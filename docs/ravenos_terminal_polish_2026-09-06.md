# Terminal polish and market evidence — 2026-09-06

This local pass improves Terminal’s visual hierarchy and valuation transparency. It is not a production deployment or a claim that the full flagship-terminal roadmap is complete.

## Changes

- Larger, consistently spaced market figures with tabular numerals; clearer sans-serif labels and 42px panel-tab targets.
- A compact, keyboard-accessible Market evidence disclosure. Source, valuation basis and chart comparison remain visible; detailed timestamps, activity windows, holder coverage and creation-time distinctions expand on demand.
- Explicit Snapshot, Chart close and Last trade labels. Chart candle times describe bar opening times rather than executable-quote freshness.
- One valuation result drives the header and anatomy panel. Price-scaled values say Estimated; FDV remains separate from market cap. Price ticks do not reverify supply or renew the underlying snapshot.
- Five-minute valuation expiry, with a direct Refresh valuation control. Refresh verifies chain, pool, token and quote orientation, ignores results after market switching, and does not initiate trade review or signing. Unavailable, invalid, future-dated and stale inputs remain unknown.

## Verification

- 905 contract tests plus prerequisite suites passed.
- 252 browser tests passed across the app before the final refresh control; the focused desktop/mobile evidence regression then passed with refresh success, wrong-token rejection and time-driven expiry.
- Production build, security architecture and public no-leak checks passed, including 37 Worker routes.
- Desktop 1440px and mobile 390px screenshots inspected; no page-width overflow. Screenshots use deterministic mocked market data, not live market observations.
- Public mirrors regenerated; no production deployment, execution configuration or legal-policy changes.

## Remaining work

This is a focused Terminal pass. Search/selection ergonomics, chart-toolbar density and consistency across the remaining desks still deserve separate design passes. A refreshed provider response can remain stale; the UI continues to show an unavailable valuation until a usable snapshot arrives.
