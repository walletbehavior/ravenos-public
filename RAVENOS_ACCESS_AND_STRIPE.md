# RavenOS Access and Stripe Configuration

RavenOS uses one access resolver for all Pro modules.

Access sources:

- Active Stripe subscription: Pro
- Qualifying Solana SPL token balance: Pro
- Founder SPL token balance: Founder
- No qualifying source: Free

Founder remains token-balance based and extensible for future access rules.

## Required Cloudflare Environment Variables

Stripe:

- `STRIPE_SECRET_KEY`
- `STRIPE_API_KEY` optional alias for `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_YEARLY_PRICE_ID`
- `APP_URL`, for example `https://ravenos.xyz`

Solana token access:

- `RAVENOS_ACCESS_TOKEN_MINT`
- `RAVENOS_SOLANA_RPC_URL`
- `RAVENOS_ACCESS_PRO_THRESHOLD`
- `RAVENOS_ACCESS_FOUNDER_THRESHOLD`

Cloudflare D1:

- Bind the D1 database as `RAVENOS_DB`.

## Database Migrations

Apply:

- `migrations/0001_ravenos_subscription_status.sql`
- `migrations/0002_ravenos_subscriptions.sql`

The active subscription model is `subscriptions`:

- `user_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `status`
- `current_period_end`
- `plan_type`
- `created_at`
- `updated_at`

Webhook idempotency is tracked in `stripe_webhook_events`.

## Stripe Webhook Events

Configure the Stripe webhook endpoint:

```text
https://ravenos.xyz/api/stripe/webhook
```

Supported events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Webhook signatures are verified server-side with `STRIPE_WEBHOOK_SECRET`.

## Pages

- `/pricing/`
- `/upgrade/`
- `/account/`
- `/pro/`
- `/token/`

Stripe secret keys are only used inside Cloudflare Pages Functions. Client pages call server-side endpoints to create Checkout and Customer Portal sessions.
