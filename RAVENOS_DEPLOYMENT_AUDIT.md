# RavenOS Deployment Audit

Date: 2026-06-23

## Situation

GitHub repository `walletbehavior/ravenos-public` is updated on `main`.

Recent pushed commits:

- `40d140481` Add RavenOS Pro access and Stripe subscriptions
- `850657367` Mirror RavenOS routes at site root

Local public checkout:

- `/srv/raven/ravenos-public`
- `HEAD -> main -> origin/main`
- Current commit: `850657367`

## Findings

### 1. Live Cloudflare output is pinned to an older artifact

Live checks show:

- `https://ravenos.xyz/`
- `https://ravenos.xyz/pricing/`
- `https://ravenos-public.pages.dev/pricing/`

all return the same HTML payload.

That payload hash is:

```text
6cef5552883f4c4a7c10b06ba10df77c1db52f2a79aaba1563a0e46d87c04da9
```

That hash matches repository commit `fa1c307a:index.html`, not the current `main` commit.

Current repo files differ:

```text
85065736:index.html hash = 3723c2363dbea9fc0bf7b5f0eb4fc7752ee6976f9813c9c75b30c9dc7bb9d4e8
pricing/index.html hash = 4388030dde922ba225889ed7688108485aca61b8aa99b113c5f4b418033b8f3a
```

Root cause: Cloudflare Pages is serving a deployment built from `fa1c307a` or an equivalent stale artifact. It is not serving the latest `main` deployment.

### 2. Unknown paths and assets fall back to old terminal HTML

These URLs return `text/html` and the same old terminal payload:

- `/pricing/`
- `/account/`
- `/token/`
- `/ravenos-access.js`

`/ravenos-access.js` should return JavaScript. Returning HTML proves a fallback handler is serving `index.html` for asset paths.

Likely causes:

- Cloudflare Pages has not deployed the latest commit.
- A Worker/Pages fallback route is overriding asset routes.
- Output directory or branch settings still point to an older artifact/deployment.
- Auto deployments are disabled or latest deployment failed and Cloudflare retained the last successful deployment.

### 3. Repository currently has no explicit Cloudflare routing files

No files found in the current public repo:

- `wrangler.toml`
- `_routes.json`
- `_redirects`
- `_headers`

Pages Functions are present:

- `functions/api/access.js`
- `functions/api/stripe/checkout.js`
- `functions/api/stripe/portal.js`
- `functions/api/stripe/webhook.js`

Because no `_routes.json` exists, Cloudflare Pages Functions may attempt default routing behavior. Static assets should still serve directly if the latest deployment is active.

### 4. Build output directory must be repo root

The public repo now has root-level static assets:

- `index.html`
- `pricing/index.html`
- `upgrade/index.html`
- `account/index.html`
- `pro/index.html`
- `token/index.html`
- `terminal/index.html`
- `ravenos-access.js`
- `raven-price-chart.js`
- `vendor/lightweight-charts.standalone.production.js`

If Cloudflare output directory is set to `public`, the root-level route mirror will be ignored.

If output directory is set to `.`, both root routes and `public/` copies exist.

## Root Cause Analysis

Most likely root cause:

Cloudflare Pages production deployment is not using the latest `main` commit. The live default Pages domain and custom domain both serve `fa1c307a` content, which means the custom domain is not the only issue.

Secondary issue:

The current live deployment has SPA-style fallback behavior for all paths, including JavaScript asset paths. If this remains after the latest deployment, an explicit `_routes.json` and/or redirect configuration should be added to prevent static assets from being swallowed by the fallback.

## Exact Files Needing Modification

Recommended repository additions:

### `_routes.json`

Add at repo root:

```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": [
    "/",
    "/account/*",
    "/pricing/*",
    "/pro/*",
    "/terminal/*",
    "/token/*",
    "/upgrade/*",
    "/vendor/*",
    "/*.js",
    "/*.css",
    "/*.json",
    "/*.html"
  ]
}
```

Purpose: ensure Pages Functions only run for `/api/*` and never override static pages/assets.

### `_headers`

Optional but recommended:

```text
/*.js
  Content-Type: application/javascript; charset=utf-8

/*.json
  Content-Type: application/json; charset=utf-8
```

Purpose: harden static asset content types.

### `README.md`

Update Cloudflare settings from “output directory `.` or root” to a strict production instruction:

```text
Build command: empty
Build output directory: .
Production branch: main
```

## Exact Cloudflare Settings Needing Modification

In Cloudflare Pages project for `ravenos-public`:

1. Production branch:

```text
main
```

2. Build command:

```text
<empty>
```

3. Build output directory:

```text
.
```

4. Root directory:

```text
/
```

5. Environment variable:

```text
NODE_VERSION=20.18.0
```

6. Functions compatibility:

Enable Pages Functions for the repo and keep function routes under:

```text
functions/api/*
```

7. D1 binding:

```text
RAVENOS_DB
```

8. Stripe/Solana env vars:

```text
STRIPE_SECRET_KEY
STRIPE_API_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_MONTHLY_PRICE_ID
STRIPE_YEARLY_PRICE_ID
APP_URL=https://ravenos.xyz
RAVENOS_ACCESS_TOKEN_MINT
RAVENOS_SOLANA_RPC_URL
RAVENOS_ACCESS_PRO_THRESHOLD
RAVENOS_ACCESS_FOUNDER_THRESHOLD
```

9. Worker routes:

Check Cloudflare dashboard:

- Workers & Pages -> Workers -> Routes
- DNS/custom domain route rules
- Any Worker bound to `ravenos.xyz/*`

If a Worker route exists for `ravenos.xyz/*`, disable it or narrow it so Pages serves static routes.

## Deployment Checklist

1. Confirm GitHub latest:

```bash
git -C /srv/raven/ravenos-public fetch origin main
git -C /srv/raven/ravenos-public rev-parse origin/main
```

Expected:

```text
850657367...
```

2. Apply migrations to Cloudflare D1:

```bash
migrations/0001_ravenos_subscription_status.sql
migrations/0002_ravenos_subscriptions.sql
```

3. Add `_routes.json`.

4. Add required Cloudflare env vars.

5. Trigger a Cloudflare Pages production redeploy from `main`.

6. Confirm build/deploy logs show commit:

```text
850657367
```

7. Confirm no Worker route overrides `ravenos.xyz/*`.

8. Purge Cloudflare cache after successful deployment.

## Verification Steps

Run:

```bash
curl -sS -L https://ravenos.xyz/pricing/ | rg "Market Intelligence Access|Monthly Pro|Annual Pro"
curl -sS -L https://ravenos.xyz/account/ | rg "Start Monthly Pro|Manage Subscription|Plan type"
curl -sS -L https://ravenos.xyz/terminal/ | rg "RavenOS Flow Terminal|Flow Table"
curl -sS -L https://ravenos.xyz/ravenos-access.js | rg "startCheckout|Backpack|stripe/checkout"
curl -sS -L -D - https://ravenos.xyz/ravenos-access.js -o /tmp/ravenos-access.js
```

Expected:

- `/pricing/` contains premium pricing content.
- `/account/` contains subscription/account controls.
- `/terminal/` contains Flow Terminal UI.
- `/ravenos-access.js` returns JavaScript, not HTML.
- `content-type` for `/ravenos-access.js` is JavaScript or at least not `text/html`.

API checks:

```bash
curl -sS https://ravenos.xyz/api/access
```

Expected without wallet:

```json
{"ok":false,"tier":"free","balance":0,"error":"missing_wallet"}
```

Stripe webhook route:

```bash
curl -i https://ravenos.xyz/api/stripe/webhook
```

Expected:

- `405` or route exists with method handling.
- It should not return terminal fallback HTML.
