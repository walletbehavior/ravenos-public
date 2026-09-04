# RavenOS Referrals v1

Status: attribution-only production release authorized; migration and promotion pending. No checkout, reward policy, credit, payout, or billing reconciliation is enabled.

## Purpose

Raven referrals provide a first-party attribution foundation for future Raven Pro subscriptions. They do not reward trading volume, returns, leverage, copying, engagement, or follower losses. A referral is not an investment endorsement.

The first release adds an authenticated account panel and three owner-scoped routes:

- `GET /api/v1/referrals/me`
- `PUT /api/v1/referrals/code`
- `PUT /api/v1/referrals/claim`

The customer may create one stable opaque referral code. The code contains no username, email, legal name, wallet address, connected-account identifier, billing identifier, or account size. A recipient must deliberately apply the code after authentication; merely opening a link does not mutate account state. No referral state is written to browser storage. The existing validated authentication return path carries a valid code through sign-in, and the authenticated page removes it from the visible URL.

## Attribution and subscription truth

Each referred Raven account can have at most one referrer. Attribution is append-only and cannot be silently reassigned. Self-referral is rejected. Replayed delivery of the same attribution is idempotent; a different later code is rejected.

A customer claim creates only attribution. It cannot create a Raven Pro entitlement, qualify a paid subscription, create earnings, create a credit, or initiate a payout.

Future subscription qualification must arrive as append-only evidence from a separately reviewed authoritative billing reconciliation contract. Every such observation requires a source contract identifier and source reference digest. The customer API has no route for writing subscription evidence. Entitlement grants are not treated as paid-subscription proof.

## Storage

Migration `customer-migrations/0030_customer_referrals.sql` adds:

- stable opaque referral codes;
- immutable one-referrer attribution;
- append-only subscription evidence;
- append-only customer-action audit events.

No payment credential, provider token, raw billing object, wallet address, trade, position, order, transaction, execution material, or payout credential is stored.

## Activation and boundaries

`RAVENOS_REFERRALS_ENABLED=1` is required for the authenticated customer routes. The base deployment configuration remains default-off; only an immutable release carrying the reviewed authorization may enable it. `RAVENOS_REFERRAL_BILLING_RECONCILIATION_ENABLED` remains hard-off in this release and is a separate future control.

Attribution may run without a reward program. Before rewards or payouts RavenOS still needs an approved referral policy, authoritative billing reconciliation, tax/payout/vendor review, abuse controls, and terms and disclosure review. Until then the account panel never displays invented earnings.

## Security and privacy

All customer reads are private/no-store and all mutations require a valid RavenOS session, same-origin CSRF proof, bounded JSON, and user-scoped rate limiting. Codes have 60 bits of generated entropy and are not public identity. Public Community profile visibility does not expose a link unless its own separate privacy preference is enabled and a later reviewed public projection provides the link.

The referral module has no wallet, signing, transaction, order-submission, broadcast, custody, execution, entitlement-grant, billing-write, credit, or payout authority.
