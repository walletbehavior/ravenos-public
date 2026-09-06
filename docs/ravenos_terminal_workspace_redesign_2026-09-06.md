# RavenOS Terminal workspace redesign

Completed locally on 2026-09-06. This is the first complete application of the new workspace system to Terminal, including interaction state, market resolution, chart integration, responsive layouts and production packaging.

## What changed

The desktop workspace now places a collapsible market rail beside the chart, with trade review and Raven research in a dedicated right panel. Transactions, holders, venue depth and public account information open below the chart in a resizable data panel. Opening these views preserves the chart.

One compact market summary replaces repeated identity and status rows. Market information, provider details, valuation evidence, chain coverage, project links and the existing Raven Monitor handoff remain available from the header. The chart plot begins around 240px down at the verified 1440px desktop size, compared with roughly 500px in the preceding layout.

The component system uses consistent sans-serif controls, aligned numerical metrics, subdued borders and panel backgrounds. Unavailable spot execution shows its real adapter status with useful research actions; redundant disabled ticket controls are removed from that state. Chart-derived research continues to update in its new host, including conflict and severe-risk suppression.

Mobile opens with a compact summary and chart. Market tabs remain at the bottom of the viewport; existing buy/sell review actions open the contained ticket sheet. Menus, recent markets and trade sheets have coordinated layering and dismissal. Portrait and landscape layouts are covered.

## Interaction and data behavior

- Recent and pinned public markets cover supported exact-pool spot chains, Hyperliquid perps, and exact listed equities/ETFs. Reopening resolves the market through existing data APIs rather than replaying saved prices.
- Balanced, Analysis and Chart focus layouts, rail preferences and data-panel height persist in this browser. Analysis opens research; explicitly choosing another tool exits Chart focus.
- Stored preferences are bounded and allowlisted. They contain public market identity and presentation preferences, not wallet addresses, account records, order sizes, credentials or execution authority. Browser storage failure does not prevent use.
- Keyboard users can browse recent markets, pin/unpin, resize the data panel and dismiss secondary UI. Layout state and open controls expose accessible labels and states.
- Slow exact-pool lookups are rejected after a newer market selection or a newer lookup. Saved listed-market resolution also checks that selection has not changed while awaiting its response.
- The existing authenticated Raven Monitor handoff continues to preserve exact identity, timeframe and explicitly empty indicator selections.

## Verification

- 907 contract tests passed, plus the configured prerequisite suites.
- 256 browser tests passed across the app.
- Production build, security architecture validation and public no-leak checks passed, including 37 Worker routes.
- New checks cover identity validation, bounded persistence, prohibited saved fields, reload/market restoration, pinning, layout recovery, keyboard resizing, storage denial, 360–1920px widths, mobile navigation and a delayed-market-response race.
- Existing checks continue to cover quote expiry, wrong-token rejection, severe risk, chart reconciliation, mobile trade sheets, exact ETF identity, Monitor handoffs and execution boundaries.
- Desktop and mobile screenshots were visually inspected. They use deterministic test market data, not production observations.
- Runtime modules and styles are included in public mirrors and fingerprinted deployment assets. Working changes do not modify execution configuration, legal policy or infrastructure authority.

## Delivery boundary

Committed local implementation; not deployed to production. The visual system is applied to Terminal. Discover and the other desks retain their existing layouts pending subsequent application of this system. Browser-local recent/pinned preferences are distinct from the existing authenticated Monitor saved-market service.
