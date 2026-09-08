# Wallet inspection recovery and cached card metrics

The owner’s open wallet screener reproduced an inspect request returning HTTP 401 / authentication_required while its old page still said Pro active. The client now exposes the existing sign-in methods, clears the stale entitlement presentation, and returns to the selected public wallet after authentication. The wallet’s inspection chain is independent of the screener chain. Source, activity and performance filters stay in the return URL; private saved research remains server-side. Network/provider errors instead show an inline retry explanation on the clicked card. No session lifetime, authorization or Pro entitlement checks are weakened.

Observed-wallet cards use generic KOL, smart-money, holder or trader labels, deduplicated by source type. Provider names and provider rankings no longer appear in screener labels. Internal provenance is unchanged.

Both observed and analyzed cards receive the same cached summary:

- Wallet age is a lower bound from the earliest retained on-chain activity or profile history. It is never the registry import date or an asserted creation date.
- Realized P&L comes from the existing reconciled profile projection with closed cost-basis evidence. Unknown stays unknown; observed zero and losses are preserved. SOL and USDC remain separate; no live FX mark or invented lifetime result.
- Rolling 1/7/30-day counts use distinct transaction references, including failed transactions, from stored events. Repeated decodes and transaction legs do not inflate counts. Future/unknown chain timestamps and expired retained rows are excluded. The old window edge is excluded; the current timestamp is included.
- Counts are labeled “seen” and remain explicitly partial. No retained transactions means Not indexed, not zero. The current analytics limit and the deeper retained transaction count can differ.

A page adds two bounded database reads for up to 30 displayed wallet identities, using the existing source-wallet index. There are no RPC/provider calls or history jobs from browsing cards. A successful inspection updates the clicked card from its returned cached summary without a second provider request.

No migration is required. No trading, fee, cashback, billing, treasury, signing or live-execution configuration changes.

Validation: four new database tests cover all supported chains, transaction deduplication/windows, unknown/zero/P&L semantics, and the shared page projection. Five new browser cases cover mobile/desktop metrics, incomplete history, expired fresh/cached inspection, and retry/update behavior. All 37 wallet browser tests pass. The full backend suite plus the corrected minimal-schema fixture recheck passes all 1,553 distinct tests. Build/security/public no-leak checks pass. Existing 192 affected market/terminal browser tests were verified separately before this wallet change.

Remaining data limitation: a registered address is not yet a fully analyzed profile. Cards say Not indexed or Insufficient evidence until shared history warming or inspection produces the relevant evidence. Bounded P&L remains bounded, even if more transactions have been retained.
