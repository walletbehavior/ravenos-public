# RavenOS chart unification — 2026-07-23

Visual QA captures for the shared RavenOS chart pass.

- `landing-1440x900.png` and `landing-390x844.png` show the landing product demonstration using the same exact-market `PriceWorkspace` and `RavenPriceChart` as Terminal.
- `atlas-dgs10-1440x900.png` and `atlas-dgs10-390x844.png` show a periodic Treasury series in the shared RavenOS chart shell. Periodic observations remain a line series; they are not fabricated into OHLC candles.

The Atlas capture uses a deterministic bounded API fixture so visual behavior can be inspected without depending on the public-origin process. The chart renderer, layout, inspection behavior, and responsive code are the production source.
