# Solana Discovery lifecycle recovery

## Failure and correction

The production pulse returned 49 Solana markets in the captured one-hour response, but none retained lifecycle evidence. Jupiter's current top-trending response had 28 tokens with explicit graduation metadata. The normalizer discarded that metadata, and the browser only admitted Dexch's lifecycle contract. Dexch currently supplies Robinhood and BNB, so the Solana quick categories had no usable source.

The worker now preserves exact-token Jupiter graduation evidence, separately tracks token and first-pool age, and blends three cached inputs: trending tokens, recently created first pools, and active Pump.fun markets. Active curves are discovered through a shared DexScreener venue search and cross-checked against Jupiter's token metadata. A missing curve-liquidity field remains unknown; it no longer discards an otherwise evidenced bonding market. PumpSwap membership alone never proves graduation.

Trading-again scans reuse fresh rows from Raven's existing participation universe. This introduces no RPC collection and never refreshes timestamps merely because a cached row is read. The candidate cap prioritizes plausible quiet-old-token bursts before final qualification. A new pool cannot erase an older first-pool history. Existing activity, age and quiet-period requirements still apply; ordinary active tokens are not relabeled revivals to fill a category.

The mobile and desktop quickbar counts actual matching tokens for the selected chain and filters. Empty inactive categories are hidden; an active category that loses its evidence offers a same-chain return to all markets. The shared validator rejects stale, contradictory, mismatched-chain or mismatched-token lifecycle evidence. Provider reports are not signing or execution authority.

## Validation

- 57 focused unit/integration checks passed, covering the radar, provider fallbacks and Jupiter integration.
- Seven Chromium lifecycle/revival cases passed, including 390px and 1440px layouts, absent bonding liquidity, chain-specific counts, stale-evidence rejection and same-chain recovery.
- All 73 cross-market browser cases passed, including search, participation, mode separation and existing Discovery behavior.
- No new provider subscription, secret, migration, execution flag or fund movement.

## Source semantics

Jupiter's `recent` endpoint lists recent first-pool creations, not token mint age. Some records have a provider `createdAt` later than their first pool; these retain the older first-pool age without treating provider record creation as mint creation.

- https://developers.jup.ag/docs/tokens/token-information
- https://developers.jup.ag/docs/api-reference/tokens/search
- https://developers.jup.ag/docs/openapi-spec/tokens/v2/tokens.yaml
- https://docs.dexscreener.com/api/reference

Counts above describe one captured September 9 snapshot and will change as markets move. This is not an exhaustive census of all Solana launches.
