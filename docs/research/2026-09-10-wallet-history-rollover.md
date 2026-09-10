# Completed wallet accounting disappears during refresh

Status: reproduced; not fixed. This is the next wallet-depth continuity correction under roadmap package 2. [Authoritative database observations](2026-09-10-wallet-history-rollover-baseline-proof.json) were read without changing any production record.

The Base wallet `0x98a8e6d5049a85b4f59499d31fca4096116e0404` had 13 retained events, eight decoded trades and seven matched sell observations in the completed block window 49,817,746–51,113,682. The version-3 snapshot at 17:09:36 recorded realized `0.826661679888576546` ETH, excluding network fees. The version-4 snapshot at 17:57:28 preserved the same result and one opening-balance entry.

At 17:57:45, a background projection changed the history state to `retry_wait`, removed that opening-balance entry and produced zero matched observations with unavailable profit. The retained event count, trade count and block window were unchanged. The actual signed-in page displayed one buy, seven sells, zero matched sells, unavailable profit and “History update delayed.”

The job cursor at the read still had `advance_from_head: true`, direction `done`, both directions completed, the same head/from-block and one opening-balance entry. The current projection in `persistSourceWalletProfile` authorizes opening balances only when the job state is `complete`. Requeueing a completed window therefore discards verified accounting while an extension is pending. `loadEvmWalletBackfillPage` also advances the head for an incremental scan, so the correction must handle both the pre-request delay and an extension actually in progress.

Required behavior:

- Preserve the accounting supported by the previously verified window through a queued, budget-deferred or failed extension. Keep its real coverage boundary visible.
- Retain an explicit verified boundary as the scan head advances. Pending activity may not silently extend cost-basis or profit coverage.
- Keep initial partial histories, unknown incoming costs, missing opening balances, unresolved older references, changed boundaries, truncation and reorgs conservative. Do not infer a complete wallet history from a completed retained window.
- Recompute from retained verified evidence with the current decoder; do not preserve an obsolete profit number if corrected evidence invalidates it.
- Verify the transition before/after restart and at extension completion, then recheck the actual Base profile. No migration, execution or provider-budget change should be inferred as necessary without evidence.

The correction must not merely relabel every pending job as complete or borrow an unverified opening balance. Wallet category qualification, 10–50 current members per ready category, continuous replacement and the remaining roadmap/final-audit requirements remain separate open gates.
