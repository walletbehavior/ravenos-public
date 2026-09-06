# RavenOS trading workflow polish

Implemented locally; not deployed.

- Spot quote fees distinguish free preview from the percentage included in a quote. A quoted fee is no longer described as already charged. Standard and Pro pricing remain controlled by the server.
- Spot price impact uses percentages with extra precision for small values; missing evidence remains explicit.
- The existing review button stays within long scrolling trade panels. Mobile touch targets remain at least 44 pixels tall.
- Left/right arrows, Home and End move focus through available desk panels; Enter activates. Hidden or unavailable panels are skipped. Universal search shortcuts remain available.
- Trade-summary typography uses clearer labels, larger estimated fills and aligned figures.

Validation: 81 browser scenarios covered across the chart, desk and workspace suites. The initial pass had two failures (touch-target size and a stale copy assertion); both were corrected and the six affected/focused scenarios passed. Ten contract tests, production build, security validation, public-data-leak checks and whitespace validation passed. Screenshots use deterministic test market data and are not live market evidence.

Files: ravenos-terminal-desk.js, ravenos-terminal-desk.css, ravenos-terminal-live.js, terminal/index.html, their generated public mirrors, and regression tests. Earlier Jupiter referral guard work remains local and undeployed.
