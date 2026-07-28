# RavenOS token-intelligence depth visual baseline

Captured from the local Playwright fixture environment after the exact-pool
market-profile and Terminal presentation pass.

The fixtures exercise the same public contracts and UI code as the release, but
the screenshots are deterministic visual QA rather than claims about live
production values. The immutable Cloudflare preview is the authority for live
provider behavior.

Included views:

- `exact-pool-terminal-1440x900.png`
- `exact-pool-terminal-390x844.png`
- `hyperliquid-terminal-1440x900.png`
- `hyperliquid-terminal-390x844.png`

The exact-pool views verify:

- chart-first composition;
- exact market identity;
- OHLCV inspection;
- holder distribution;
- bounded token controls and links;
- unobtrusive attribution;
- conditional Raven context;
- no empty or unknown profile cards.

The Hyperliquid views verify that the native perps chart, live market anatomy,
read-only market preview, and disabled signing/submission boundary are
unchanged.
