# Account checks recover without manufacturing a sign-out

The production Portfolio audit on release `9fc1f55acb6b` briefly showed Sign in and unavailable balances, then recovered the existing account on reload. The HTTP status of that incident was not captured. Source inspection did identify a reproducible presentation defect: Portfolio treated a failed session request as signed out, and Account/the shell lacked automatic recovery. Perps checked authentication before its service-error state. Terminal also awaited the complete account restoration before loading a public chart.

The Account page, shell, Terminal and Portfolio (including its reserve panel) now use the same account reader. It shares an in-flight GET only. It does not cache completed authentication, store credentials in browser storage, extend cookies, alter accepted terms or change server authentication rules. A valid signed-out result stays signed out; server errors, malformed responses and missing CSRF cannot become authenticated or signed out. Explicit logout invalidates pending responses. One surface canceling its read does not cancel other surfaces.

A transient network error, 429 or 5xx receives at most one automatic retry. Retry-After is honored, including the identity service's 30-second backoff, with a 60-second maximum wait and eight-second transport timeout per attempt. Longer requested backoffs remain unavailable. Successful restoration selects the existing Raven wallet; no create/connect click is added. A sustained failure shows an account-check error, with the existing refresh/retry path. The module retries only the session GET, never a quote, order, signature, submission or other mutation.

Public chart loading now proceeds while the account retries. The primary action waits for the account check. Re-entering the tab coalesces concurrent trading-session checks. A submitted result remains visible while account access is delayed; an automatic quote refresh cannot erase that result or replay the order. Deliberately editing the ticket still clears the previous ticket's result. Existing pending-submission protection and server trading gates remain in force.

The reserve bundle imports the shared module externally so it does not create a separate account-check instance. The public-copy, build-manifest and release-asset allowlists include the new module, and production verification checks its deployed hash in addition to page assets.

Qualification covers the reader and server identity contracts, real sign-out and expiry, delayed/malformed responses, shared retries, cancellation races, Portfolio privacy clearing, Account form visibility, Perps chart loading during account backoff, and the existing Solana/EVM one-Buy paths. Controlled EVM fixtures recover on RH/BNB/Base/Ethereum, then simulate a second outage after the trade; signing/report counters remain exactly one. These are controlled browser transactions, not customer settlement evidence. Browser engines, counts and deployment evidence are recorded below once complete.

The cause of the original production service interruption is still unconfirmed. Remaining roadmap gates include account-check consistency in the other intelligence workspaces, the account-scoped receipt journal, native receipt/refund evidence, non-USDC fee valuation and actual user-authorized settlement. The goal remains active.

## Controlled qualification

- 37 Node tests pass: 15 account-reader cases and 22 server identity cases.
- 91 Chromium and 91 WebKit browser cases pass across Account, Portfolio, reserve previews, Perps session recovery and Solana/EVM one-Buy flows.
- Five additional transaction-tape cases pass in each engine: 360/390/1440-pixel scrolling, readable price/wallet/transaction columns, combined filters, wallet overlays, retained provider responses and Mobula exact-pool amounts.
- Build, security architecture and public no-leak/38 Worker-response checks pass. Generated import dependencies point at the same content-hashed account reader.
- Fixture transactions only; no real wallet signature, transfer or trade was requested. Production promotion and the signed-in postflight follow this source qualification.

## Production result and remaining reliability work

Source `03289b1180cc` is live at 100% as `ravenos-03289b1180cc-5f028ca3c95526de`, Worker `b68c4eec-0dfa-4407-bd0a-1a44c053ec0e`, on both domains. Full staging and 41 production checks pass, including 26 asset hashes and seven authenticated entrypoints. Account displayed Signed in securely and hid login actions. Perps kept its chart and signed-in state visible.

Portfolio's first post-promotion load still ended in account-check unavailable. It did **not** falsely display Sign in. Its existing Refresh wallet action succeeded, but the shell badge stayed pending until reload. A subsequent traced reload restored the account, one wallet/holding, consistent SOL/USDC buying power (after normalizing trailing decimal zeros), an unavailable exit estimate and three blank targets without a new login. The actual browser width was 1525 pixels; this is not new live mobile evidence.

The short sanitized Worker trace captured successful session reads (71/164 ms), successful wallet-list reads (188/190 ms), and two balance reads canceled at approximately 10,026/10,027 ms. It did not capture the failed initial account request. Do not infer its cause from the later balance cancellations or count intermittent account availability as solved. Next: propagate successful account rechecks to the shell, apply the same handling to intelligence overlays, and diagnose the remaining request timeouts. Then continue the receipt journal and remaining roadmap. See [production proof](2026-09-10-account-session-production-proof.json).
