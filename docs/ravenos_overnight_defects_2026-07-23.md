# RavenOS overnight baseline defects — 2026-07-23

Baseline: production release `ravenos-883dcf2ab0d1-b8ec7873ba8c0014`, captured without changing production. Screenshots and the machine-readable run manifest are under `/srv/raven/app/artifacts/ravenos_overnight_baseline_20260723`.

## Ranked operator defects

1. **Universal search can rank a semantically wrong instrument ahead of the exact useful market.** RETIRE discovery includes unrelated substring matches before the active Solana pool, while WETH can surface the listed equity alongside on-chain markets without enough intent-aware ordering. Exact contract matches work through DEX discovery, but the combined experience is not yet dependable enough to replace a DEX search tool.
2. **The chart is useful after it loads, but first-load reliability is provider-sensitive.** One Ethereum WETH/USDC mobile capture returned a 504 and an empty chart before succeeding at every larger viewport. A trader cannot distinguish a transient provider failure from permanent lack of coverage quickly enough.
3. **The chart lacks a persistent inspected-candle OHLCV readout.** Current source, bar count, and latest price are visible, but the operator cannot inspect exact UTC time, O/H/L/C, change, and volume without relying on canvas tooltips.
4. **Atlas still reads like a provider-rights and observation-state diagnostic.** Labels such as `Universe`, `Provider rights`, `Mode`, `Display Restricted`, `Cataloged`, `Hydrated`, and `Deep observed` expose implementation state rather than answering what the broader market implies. AAPL also has no useful public chart fallback.
5. **Discover is accurate but visually static and perp-heavy.** Rows explain deltas, yet the initial viewport does not make cross-market opportunity mechanisms, freshness, risk, and inspectability easy to scan. The side rail is mostly a second perp list.
6. **Mobile Terminal spends scarce width on controls whose labels truncate or crowd.** Exact identity is preserved and the chart is first-screen visible, but source/identity text, timeframe controls, attribution, and market activity compete for the same narrow area.
7. **Raven differentiation often resolves to an unavailable panel.** The failure state is honest, but it occupies valuable space without giving the operator a compact next-best answer such as market-only facts, admission requirements, or what would make a Raven read available.
8. **Global provider attribution is visually detached from the datum it governs.** It remains unobtrusive but appears on surfaces such as Portfolio where neither provider is materially powering the empty state.
9. **Cloudflare Web Analytics is injected into production but blocked by the strict CSP.** This is noncritical and the CSP is correctly winning; the configuration creates predictable console noise on Terminal routes and should be resolved without weakening CSP.
10. **Portfolio is truthful and intentionally empty, but its primary action is under-emphasized.** It no longer exposes the engineering readiness matrix, which is accepted; refinement should help the user return to inspection immediately.

## Baseline positives that must not regress

- No horizontal overflow at 390, 430, 768, 1280, or 1440 px in 45 production captures.
- Hyperliquid and supported exact-pool charts render real candles with volume and preserve exact identity.
- RETIRE and Base cbBTC exact-pool charts are dense at 15 minutes.
- Unsupported Robinhood Chain coverage fails explicitly without substituting another pool.
- Portfolio does not invent holdings, users, or balances.
- The four-destination shell is coherent on desktop and mobile.
- Production remains read-only and signing/submission remain unavailable.
