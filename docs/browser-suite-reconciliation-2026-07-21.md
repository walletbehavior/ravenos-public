# RavenOS truthfulness baseline: browser-suite reconciliation

Date: 2026-07-21 UTC

This note reconciles the earlier `82/82` Playwright result with the smaller
suite reported after replacing the legacy Terminal. The reduction was real and
intentional, but it was not originally documented clearly enough.

## Exact count history

The preserved pre-overhaul checkpoint enumerates 79 tests in the same five
browser spec files that exist now:

| Spec | Checkpoint count |
| --- | ---: |
| `mobile-perps-visual.spec.mjs` | 2 |
| `perps-chart.spec.mjs` | 2 |
| `public-route-copy.spec.mjs` | 22 |
| `terminal-chart.spec.mjs` | 48 |
| `terminal-shell.spec.mjs` | 5 |
| Total | 79 |

Before the legacy Terminal was replaced, three truthfulness-route cases were
added to `public-route-copy.spec.mjs`: truthful Account state, truthful Pricing
state, and wallet context separated from customer access. That produced the
observed intermediate result:

`2 + 2 + 25 + 48 + 5 = 82`

The Terminal replacement rewrote the 48-case legacy Terminal spec as 10
evidence-based cases. No browser spec file was deleted:

`2 + 2 + 25 + 10 + 5 = 44`

This reconciliation pass restored three valid regression cases: provider-backed
`1w` history, provider-backed `1m` history, and keyboard/outside dismissal of
exact-pool search. The current discovered suite is therefore:

| Spec | Current count |
| --- | ---: |
| `mobile-perps-visual.spec.mjs` | 2 |
| `perps-chart.spec.mjs` | 2 |
| `public-route-copy.spec.mjs` | 25 |
| `terminal-chart.spec.mjs` | 13 |
| `terminal-shell.spec.mjs` | 5 |
| Total | 47 |

`playwright.config.mjs` points at the complete `tests/browser` directory and
sets no grep, shard, project subset, or test-file allowlist. Therefore
`npm run test:browser` discovers all five current spec files.

## What happened to the 48 legacy Terminal cases

The old cases fell into three dispositions.

### Preserved through consolidated browser coverage

- provider failure, empty response, fallback labeling, and no substitute candles;
- exact Hyperliquid instrument selection and real chart repainting;
- `5m` through `1m` timeframe availability, including explicit `1w` and `1m` runs;
- exact spot-pool selection and spot timeframe repainting;
- rapid switching and duplicate-canvas prevention;
- dynamic market discovery rather than the static three-symbol list;
- current build identity, data provenance, freshness, and chart diagnostics;
- exact Raven chart marker rendering;
- desktop, mobile, landscape, focus mode, navigation, and context continuity;
- search-result interaction and dismissal;
- quote-preview capability remaining wallet-optional and non-signing.

### Preserved at the lower contract/data-plane layer

- forming-candle rollover, deduplication, bounded buffers, reconnect and resync;
- exact-pool versus aggregate-token identity;
- exact Raven event identity, timestamp, and lineage requirements;
- provider-backed indicator and Raven overlay rendering support;
- pressure and participation Raven Read translation and unavailable semantics;
- Hyperliquid book, tape, funding, open-interest, and privacy normalization;
- all signing and submission flags remaining false.

`raven_reads.test.mjs` is now included in `npm run test:contracts` so the existing
Raven Read and overlay translator assertions cannot silently fall outside the
release test command.

### Retired because the product contract was deleted

The following assertions were not migrated because their UI or data was mock,
unsupported, or no longer authorized:

- Watchlist and Paper lanes populated with fixture rows;
- mock paper candidates and paper-trade tables;
- fabricated TP/SL and fee-preview controls;
- Buy/Sell/Long/Short controls that implied execution;
- Phantom and Solflare capability flows in a product with no customer session;
- chain-aware wallet, gas, and route previews that were not live execution paths;
- static meme-token search fixtures and metadata-backed synthetic lookup rows;
- seeded pressure/composition, synthetic similarity, and fake replay displays;
- assertions that old embedded artifacts or narrator prose were live product data.

Restoring those test names would require restoring the false product behavior
they asserted. The replacement tests instead enforce exact identities, current
providers, explicit unavailable states, and the non-signing boundary.

## Regression found during reconciliation

The expanded run caught a real context-continuity defect: navigating from a
selected BTC perpetual into Opportunities preserved BTC in the URL, but the
page shell replaced it with the first ranked Census row. The route now retains
an explicit or persisted user subject, uses a matching Census row when one
exists, and never overwrites that subject merely because another row ranks
first.
