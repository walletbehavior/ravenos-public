# Portfolio trade history

Adds an account-scoped, read-only journal of submitted Raven trades to Portfolio. This is a receipt-history foundation for roadmap package 4, not completed position or profit accounting.

## Behavior

- Shares Portfolio's existing account check, then reads `/api/v1/portfolio/trades` without connecting a wallet or creating transaction material.
- Lists 25 submissions at a time, with stable chronological continuation and duplicate suppression. Unsigned quote tickets and expired preparations are excluded.
- Separates checking receipt, confirmed, finalized, failed/rejected, and venue-acknowledged Perps orders. A venue acknowledgment is not presented as a filled position.
- Shows time, selected market, side and status in the initial mobile view. Horizontal scrolling reaches exact Raven fees and receipt actions. Details expose full market/token/transaction identities and exact observed asset changes.
- Retains loaded history during a same-account history-service outage. Logout, failed account revalidation, account changes and mismatched response/session identifiers clear private rows. Canceled responses cannot repopulate an old account.
- Uses private/no-store responses, owner-scoped SQL and a bounded opaque cursor. Browser parameters cannot select another user's ledger. Raw tickets, wallet-owner identifiers, provider payloads and authentication material are never returned.

## Monetary evidence

Receipt identity must match the stored execution, wallet, market, latest state and transaction reference. Solana additionally requires the persisted signature and matching reviewed/settled message hash. Monetary values require verified economic evidence from that bound receipt.

Amounts remain integer strings. Known canonical token decimals are used; unknown token precision is shown explicitly in base units rather than assuming 18 decimals. SOL balance movement includes fees/rent and is labeled accordingly; native SOL and wrapped SOL have distinct identities. EVM net token transfer logs are accepted, while transaction value alone is not called net spend after potential refunds. Conflicting duplicate observations of one asset are omitted rather than double counted or arbitrarily selected.

Solana shows the verified gross trading fee, not just the collector's net referral share. EVM fees require observed collection. Indeterminate, absent or reversed fee evidence remains unavailable. No cashback entitlement, profit, portfolio total or fill is manufactured from a quote.

## Validation before deployment

- `npm run test:portfolio`: **101 passed**, including account isolation, pagination, receipt binding, state/finality distinctions, no mutation, outages and integer precision.
- Chromium and WebKit Portfolio/history suite: **26 passed each / 52 total**, including 360/390/1440 widths, receipt scrolling, duplicate pages, account changes, response races, actual authentication expiry and unsafe provider text/links.
- Inspected 390px WebKit screenshot. The first design made rows too tall and obscured status; the revised table keeps status in the initial view and compact receipt actions on the right.
- Build and security checks pass; public asset and **39 Worker-response** leak checks pass.
- Production verification now checks the imported history module/CSS and confirms the history endpoint rejects unauthenticated and wrong-origin reads.

## Release gate still open

The production execution ledger was empty at the last observation. A live empty journal can validate account access and truthful empty-state behavior; it cannot prove real settlement, position closure, fees or cashback. No real transaction, signature, funding operation or execution-authority activation was performed for this change. Native-input refunds, native-output receipt evidence, non-USDC valuation and actual closed-position reconciliation remain separate roadmap gates.

Deployment and signed-in production evidence will be recorded after promotion.

The first production candidate (`f570add0adbd`) passed staging but failed the added production endpoint probe: the app's outer API allowlist returned 404 before reaching the journal. The signed-in page correctly displayed a load failure while the existing capital helper stayed available. Added the exact path to that boundary, strengthened the Worker-level test (previously too permissive), and reproduced the regression before the fix. The next candidate must pass anonymous 401, wrong-origin 409 and signed-in history checks before this feature is considered deployed successfully.
