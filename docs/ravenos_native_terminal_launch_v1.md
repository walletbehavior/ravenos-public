# RavenOS native terminal launch v1

Status: Hyperliquid market-preview slice implemented; customer execution remains disabled.

## Product boundary

The first native Terminal slice answers a bounded question:

> If this exact Hyperliquid perpetual were entered now at the requested economic size, what does the currently visible book imply?

The preview is computed from the exact venue instrument and current Hyperliquid L2 book. It does not create an order, prepare a signing payload, infer a customer account, claim an available balance, calculate an account-specific fee, estimate a trustworthy liquidation price, submit anything, or create a position.

This is deliberately separate from Raven Plan research. A Raven read may inform a human decision, but it never authorizes a transaction.

## Current flow

```text
exact Hyperliquid instrument
  → current normalized L2 book
  → user direction, USDC notional, and leverage
  → bounded depth walk
  → estimated base size, VWAP, worst price, spread, impact, and initial margin
  → short-lived market preview
  → stop
```

The preview fails closed when:

- exact identity does not match;
- the book is stale, malformed, inverted, or unavailable;
- visible depth cannot cover the requested notional;
- requested leverage exceeds the current exact market maximum;
- the estimated impact exceeds the user-facing preview bound;
- the provider request times out.

No alternate instrument or historical book substitutes for the selected current market.

## Contract

`ravenos.hyperliquid_market_preview.v1`

The public response contains:

- exact canonical instrument and venue market ID;
- requested direction, notional, and leverage;
- estimated initial USDC margin before account-specific effects;
- estimated base fill, VWAP, worst price, spread, impact, and depth consumed;
- source observation time, freshness, and exact-identity proof;
- explicit account-dependent values that remain unresolved;
- explicit false values for payload inclusion, signing, submission, and position monitoring.

The response never contains:

- a wallet or venue-account credential;
- a transaction or order payload;
- a signature;
- a submission ID;
- a claimed fill;
- a customer balance or position;
- a private provider payload.

## Launch ladder

### 1. Market preview — current

- Public read-only market modeling.
- No account required.
- Exact current book only.
- No transaction payload.

### 2. Account-aware review — not implemented

Requires the customer identity and session security foundation, verified Hyperliquid account proof, current margin and position state, account-specific fees, margin-mode selection, and recent reauthentication.

### 3. Prepared order — not implemented

Requires an immutable review packet binding the account, exact instrument, direction, size, leverage, order type, price protections, fees, expiry, and payload hash. Any material change invalidates review.

### 4. Wallet confirmation — not authorized

Requires a decoded order preview, payload equality verification, explicit user confirmation in the wallet or venue signing surface, and an independent transaction-security review.

### 5. Submission and reconciliation — not authorized

Requires at-most-once submission, idempotency, acknowledgement/fill separation, order-status monitoring, fill reconciliation, resulting position reconciliation, incident controls, and an explicit owner authorization milestone.

## Next venue

Solana spot is the second intended native route. It must retain exact pool identity and model the full economic intent from USDC to the selected asset and back to USDC. Intermediate hops and native gas assets must remain visible in review without becoming the user’s accidental settlement result. Public signing remains disabled until the same account, wallet-proof, intent-binding, simulation, idempotency, and reconciliation gates pass.

## Implementation evidence

- `lib/customer_trade/hyperliquid_quote_preview.mjs`
- `lib/customer_trade/execution_readiness.mjs`
- `lib/cross_market/trade_intent.mjs`
- `worker.mjs` at `POST /api/trade/market-preview`
- `terminal/index.html`
- `ravenos-terminal-live.js`
- `tests/hyperliquid_quote_preview.test.mjs`
- `tests/worker_market_preview.test.mjs`
- `tests/browser/terminal-chart.spec.mjs`
