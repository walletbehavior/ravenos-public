# Cached wallet research workflow

Wallet IDs for Solana, Robinhood, Base, Ethereum and BNB use the existing chain registry in saved-research and stored-profile routes. Stored chain, network and address must derive the requested ID; the same EVM address on another chain is rejected. Current-profile metadata is joined into the existing private saved-wallet list without a new database or provider lookup.

Observed-wallet cards now offer Save and, where a profile exists, Open cached. An unanalyzed saved wallet offers an explicit Analyze wallet action. A missing cached profile never silently starts a provider request: it changes the action for a subsequent explicit inspection. Saves preserve existing ownership, quotas and idempotency. Saving reads the existing deep-history status instead of enqueuing another deep scan. Existing background observer prioritization of saved research is unchanged; this is not a claim of zero future background processing.

EVM cached views retain their original profile timestamp, reduced receipt context and bounded transfer sample. Activity filters/pagination operate on the retained sample, without inferring complete history, profit or live balances. Server validation rejects mixed-chain snapshots and activity. Live EVM Copy is not enabled. Solana retains the existing history and Copy handoff.

The page offers a named Save-to list, a direct Saved wallets shortcut, and local saved-list chain/text filters. Failed list refreshes keep the last loaded rows with an explicit status. Failed removal leaves the wallet visible. Profile navigation resets chain-specific activity state and discards late requests from the previous view.

## Rollout

The user confirmed the Cloudflare Workers Paid upgrade and authorized deployment. Production auth-start returned HTTP 200 with the expected WorkOS host, confirming that the earlier D1 write-limit failure had cleared. Migration 0040 remains the only pending additive schema change from the preceding market-context release; no financial or user-ownership schema changes are introduced here.

Release configuration resumes the existing universe at four markets per five-minute tick and 48 reserved provider requests per hour. Retained market context is enabled through the existing customer configuration. Apply 0040 on preview, export production, apply it to production, then stage and verify the immutable release before promotion. Verify real scheduler receipts and context rows after promotion. Roll back via the prior version or disable the flags; retain the additive table.

Claims, automated live Copy, live cross-chain limit execution and live shielded money movement remain under their existing gates. This deployment does not sign or send a transaction, charge a subscription or create a treasury payout.

## Validation

Local validation passed: 1,438 Node tests and 321 browser tests, including all existing auth, billing/rewards/referrals, execution, portfolio and Copy regressions. New tests cover stored EVM profile reads on all four EVM chains without provider calls, private saved-list ownership, chain mismatch rejection, cached event filtering, failed list refresh/removal, and stale activity responses when opening another profile. Security architecture and public-asset/37 Worker-response leak checks passed.
