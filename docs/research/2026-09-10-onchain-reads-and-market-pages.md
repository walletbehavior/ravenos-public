# Onchain Reads and complete delivery of the qualified sample

Continues roadmap package 3 and the tab audit; the complete roadmap stays open.

## Reproduced production gaps

At 12:27 UTC, `/api/opportunity` reported a current Onchain producer but had only 11 old Solana registry rows and zero qualified Reads. The independent collector supplied 4,444 sampled tokens across five chains. `/api/onchain/trending` found 3,101 qualifying tokens but delivered only 2,000 (`delivery_limited: true`), after which browser quality, freshness, scope, selected-window activity and duplicate filters reduced the visible count further. The signed-in Onchain Reads tab was empty. Perps Reads showed twelve current rows.

## Implemented behavior

- The existing collector retains up to three compact exact-pool observations, no more than ten minutes apart in total. Repeated cached timestamps do not count as additional observations. Pool, chain, token and quote identity changes reset the sequence. Provider calls, leases, cooldowns and budgets are unchanged.
- A separate deterministic pressure classifier requires two distinct observations at least 30 seconds apart, current facts within 120 seconds, reported liquidity of at least $5,000, the existing holder/quality filters, at least 20 swaps in both reported windows and $1,000 current-window volume. A 60% activity-side share must persist in both observations, alongside a price move of at least 0.5% and aligned or conflicting observed price movement. Balanced or unsupported observations do not qualify.
- Reads explain measured activity/price alignment or divergence, observation spacing, liquidity change and what weakens the interpretation. Rolling windows are not summed. Trade counts do not establish net capital flow or wallet accumulation. No timing advantage, wallet PnL, forward outcome, profitable setup or execution claim is made.
- `/api/onchain/reads` reads one existing shared snapshot without provider requests or writes. Discovery's Raven tab, the Onchain Reads workspace and the selected pool's Terminal Raven tab consume this evidence independently of the old origin registry. Timeframes and exact selected identities remain scoped. Perps/Atlas retain their own readers.
- A generic one-observation headline was hiding qualified Read text; the UI now gives the actual Raven interpretation priority. The sample's retained observation count is represented accurately.
- Discovery requests immutable pages of 500 rows and displays 100 per screen. It continues through the qualified sample instead of silently stopping at 2,000. Pages preserve source timestamps and one snapshot identity; wrong or expired cursors require a new snapshot, and aborted/out-of-order scope responses cannot replace the current chain/window. The existing legacy endpoint limit remains for callers that do not opt into pages. A defensive 10,000-row processing bound remains above the current shared sample; this is not a chain census.
- Cohort ranking sorts once per cohort and uses binary positions, preserving existing tie/rank semantics while avoiding repeated cohort sorts during broad delivery. Existing quality thresholds, token identity and chart/trade flows are retained.

## Qualification

### Terminal refresh follow-up

The first signed-in production audit found a PCC Read in the exact-pool endpoint while Terminal retained its initial empty result. Opening Raven now rechecks the selected pool, then refreshes at most every 45 seconds while the overlay remains open. Requests are bounded to six seconds, coalesced, and guarded against selection changes and older response sequences. Quote-driven replacement of the selected row cannot discard a same-market Read. Reads older than two minutes expire. All potentially populated sections move into the overlay with their visibility state preserved, so newly arriving content appears inside it and survives closing it. Refreshing does not reset an existing plan preview when current evidence remains available.

Seven Chromium and fifteen WebKit affected browser checks pass, including 390px/1440px empty-to-current recovery and retained content after closing. These are controlled browser tests; the signed-in live viewport is desktop. Production deployment and postflight are recorded in the companion proof.

118 targeted backend/runtime cases pass, including all five Read chains, stale/future/repeated observations, identity changes, thin pools, window distinctions, exact selection and a 2,301-token paged Worker response with zero additional provider calls. Chromium passes 21 affected UI cases; WebKit passes 13. Both engines verify 390px/1440px Reads, complete paged loading, retained source timestamps, chain switching and the affected Discovery behavior. Terminal uses the selected pool's actual Read. Build, security and 41 public-response checks pass.

Production release and signed-in postflight evidence will be recorded after promotion. Source freshness under repeated provider throttling, broader discovery depth, wallet history, qualified behavior families and forward outcomes remain open.
