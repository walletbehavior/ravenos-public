# RavenOS Worker API Verification

The Cloudflare Worker serves static RavenOS assets and API endpoints from the same deployment.

## Required Endpoints

- `GET /api/access`
- `POST /api/access`
- `POST /api/stripe/checkout`
- `POST /api/stripe/portal`
- `POST /api/stripe/webhook`
- `GET /api/alerts`
- `POST /api/alerts`
- `PATCH /api/alerts/:id`
- `DELETE /api/alerts/:id`
- `GET /api/alerts/events`

## Manual Checks

```bash
curl -sS https://ravenos.xyz/api/access | jq
curl -sS "https://ravenos.xyz/api/access?wallet=ExampleWallet" | jq
curl -sS -X POST https://ravenos.xyz/api/access -H 'content-type: application/json' -d '{"wallet":"ExampleWallet"}' | jq
```

Expected behavior without a configured token mint is a safe Free response with `tokenAccessConfigured=false`.

Checkout creation requires Stripe env vars:

```bash
curl -sS -X POST https://ravenos.xyz/api/stripe/checkout \
  -H 'content-type: application/json' \
  -d '{"wallet":"ExampleWallet","plan":"monthly"}' | jq

Atlas checkout uses the same endpoint with Atlas plan names:

```bash
curl -sS -X POST https://ravenos.xyz/api/stripe/checkout \
  -H 'content-type: application/json' \
  -d '{"wallet":"ExampleWallet","plan":"atlas_monthly"}' | jq
curl -sS -X POST https://ravenos.xyz/api/stripe/checkout \
  -H 'content-type: application/json' \
  -d '{"wallet":"ExampleWallet","plan":"atlas_annual"}' | jq
```

Portal creation requires a signed wallet payload and an existing subscription row.

Webhook verification requires the raw Stripe payload and `stripe-signature` header. Duplicate events are idempotent through `stripe_webhook_events`.

Alerts use the same unified access resolver. Free wallets can preview alert types but cannot create active alerts:

```bash
curl -sS "https://ravenos.xyz/api/alerts?wallet=ExampleWallet" | jq
curl -sS -X POST https://ravenos.xyz/api/alerts \
  -H 'content-type: application/json' \
  -d '{"wallet":"ExampleWallet","instrument":"SOL-PERP","market":"Perpetual Futures","alert_type":"pressure_score_crosses_threshold","condition":"crosses_above","threshold":75}' | jq
curl -sS "https://ravenos.xyz/api/alerts/events?wallet=ExampleWallet" | jq
```

If `RAVENOS_DB` or the alert tables are unavailable, alert endpoints return a structured unavailable response instead of breaking the terminal.

## Bindings

- `RAVENOS_DB`
- `STRIPE_SECRET_KEY` or `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_YEARLY_PRICE_ID`
- `STRIPE_ATLAS_MONTHLY_PRICE_ID`
- `STRIPE_ATLAS_YEARLY_PRICE_ID`
- `RAVENOS_SOLANA_MINT`
- `RAVENOS_SOLANA_RPC_URL`
- `RAVENOS_PRO_THRESHOLD_EARLY`
- `RAVENOS_PRO_THRESHOLD_GROWTH`
- `RAVENOS_PRO_THRESHOLD_MATURE`
- `RAVENOS_FOUNDER_THRESHOLD`
- `RAVENOS_MARKET_CAP_STAGE`
- `APP_URL`

Stripe Checkout and Portal require a secret key (`sk_...`) in `STRIPE_SECRET_KEY` or `STRIPE_API_KEY`. A publishable key (`pk_...`) is only suitable for client-side Stripe.js and cannot create products, prices, Checkout sessions, or Portal sessions from the Worker.
