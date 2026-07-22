# Market-data plane visual validation

Date: 2026-07-22 UTC

Environment: local RavenOS Worker, real read-only exact-pool provider requests, no production promotion

## RETIRE/SOL — exact Raydium pool

Pool: `6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw`

Timeframe: `15m`

Rendered bars: 239 (Terminal request bound: 240; one duplicate timestamp removed)

Base series: exact-pool provider OHLCV

Raven context: unavailable in this local capture; no substitute evidence or candles were generated

| Capture | Viewport | Chart geometry | Browser errors | Horizontal overflow |
|---|---:|---:|---:|---:|
| `retire-15m-desktop-1440x900.png` | 1440 × 900 | 1,049 × 426, seven canvases | 0 | no |
| `retire-15m-mobile-390x844.png` | 390 × 844 | 374 × 330, seven canvases | 0 | no |

The fixed API validator separately returned 480 `15m` bars and 359 normalized `1h` bars for this exact pool. The difference is intentional: the UI requests a bounded 240-bar first load, while the anchor validator tests the deeper provider contract.

Signing and submission remained unavailable throughout the capture.
