# Full-stack execution audit and runtime repairs

The owner requested a full-stack run. This release does not claim that every financial feature is live. It repairs concrete integration defects found by running all Node and browser tests and then checking the Worker runtime itself.

## Changes

- Stripe, Alchemy wallet history, and independent rewards-claim RPC verification use manual redirect refusal. The installed workerd runtime rejects `redirect: error` before issuing a request. Native runtime regression tests now exercise these clients without replacing their fetch function. Redirects are rejected without following them or forwarding credentials. Existing idempotency and reconciliation remain intact.
- The real Stripe $149 monthly price passed a read-only request through workerd after the fix. No customer, Checkout session, payment, subscription, credit or charge was created for this check.
- Public Solana/Robinhood holder and trade responses now feed their already observed addresses into Raven's existing shared source-wallet table. This runs for retained holder-cache hits as well as new validated projections. It performs no extra RPC request, does not enqueue a history scan or enroll a Copy strategy, and does not turn a sender/owner observation into reconstructed performance. Per-projection admission is capped at 20 unique addresses, repeated writes are throttled, and stale/invalid observations, contracts identified by the holder provider, token accounts and exact pool/mint identities are excluded. Existing decoded cursors and profiles are preserved.
- The current database's shared-source constraint admits only Solana and Robinhood. Base, Ethereum and BNB still support bounded on-demand lookup; full shared indexing for those chains needs a carefully preserved schema extension. The UI's all-chain filter alone never proves indexed coverage.
- Account now offers each existing Raven Wallet alongside external-wallet choices. Address-only connection does not provision another wallet, request a signature or depend on the signing service. Desktop copy no longer assumes iPhone Chrome.
- `npm run test:stack` runs every top-level Node test and the entire browser suite. The contract pipeline also includes the market-index and Worker-runtime regressions.

## Validation

- Before changes: 1,380 Node tests and 312 browser tests passed; the separate native-runtime probe still reproduced the redirect failure. Mock-only success was not sufficient.
- After changes: 1,392 Node tests and 314 browser tests passed. Tests cover cache reuse, bounds, chain identity, invalid owner exclusion, durable D1 visibility, duplicate prevention, preservation of decoded cursors, disabled-feature behavior, retry after database failure, both embedded-wallet choices, and provider redirect refusal under workerd.
- Native runtime/live provider proof: the actual $149 monthly Stripe price was read successfully. This verifies the deployed client's transport behavior, not paid-invoice settlement.
- No database migration or financial activation changes are included.

Cloudflare documents manual redirect behavior and credential forwarding risks in its [Request reference](https://developers.cloudflare.com/workers/runtime-apis/request/). The incompatibility above is independently reproduced against Raven's installed runtime; it is not inferred from documentation alone.

## What remains before the entire live stack can be claimed

| Area | Current boundary | Required work/evidence |
| --- | --- | --- |
| External-wallet native trading | User-reviewed routes enabled | Controlled funded fill, exact fee collection and reward reconciliation |
| Raven embedded-wallet trading | Address connection and user-owned provisioning work; signing disabled | Recovery/export and funded withdrawal verification, then bounded signing activation |
| Copy | Shared observer, shadow evaluation and manual handoff | Authorized bounded signer, live dispatcher, follower fill reconciliation and stop/revoke checks; code currently hard-disables automation |
| Universal USDC limits | Paper/review | Live funding/bridge adapters, durable settlement recovery and destination execution authorization |
| Rewards claims | Ledger, ownership checks, reservation and independent transfer verifier | Separately permissioned payout service, funded canonical-USDC treasury, measured minimum economics, idempotent transfer canary |
| Stripe and referral commissions | Billing/credits/enrollment configured; transport repaired | Actual voluntary paid invoice, partial/full rewards credit and refund evidence; no affiliate commission on trades or trial |
| Affiliate payouts | Ledger/manual state | Approved payout method and operational process; no provider invented |
| Shielded Reserve | Real signed shadow quotes in Portfolio | User-controlled Zcash wallet/signer, actual shielded settlement/refund evidence and security/counsel review; live movement remains hard-disabled |
| Wallet screening | Cache-first source discovery on Solana/Robinhood | Broader retained ingestion, EVM durable profile/index extension, deeper decoded history and honest cost-basis coverage |

Native fees remain 100 bps for Standard and Pro, active Pro/trials earn 30% of confirmed eligible Raven execution fees, Copy has no additional fee, and Hyperliquid economics remain separate. Existing funds and customer financial preferences are unchanged.
