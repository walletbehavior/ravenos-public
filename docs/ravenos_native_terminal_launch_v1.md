# RavenOS native terminal launch v1

Status: Hyperliquid market-preview and exact order-plan slices implemented; customer execution remains disabled.

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

## Exact order-plan flow

The second native Terminal slice turns the current exact-market preview into a richer human review without crossing into execution:

```text
exact Hyperliquid instrument + current normalized L2 book
  → market, limit, or directional stop-entry semantics
  → direction, USDC exposure, leverage, price, and time in force
  → optional take-profit and stop references
  → marketability, bounded current-book fill behavior, margin estimate, stop risk, and reward:risk
  → short-lived exact-market order plan
  → stop
```

Market plans walk the current book. Limit plans distinguish resting from currently marketable orders, reject post-only prices that would cross, reject IOC prices that would immediately cancel, and depth-check marketable size only through the limit price. Trigger plans require a long stop entry above the current market or a short stop entry below it and explicitly reprice against the future book when activated instead of presenting a current fill as future truth.

A qualified Raven research plan can populate direction, entry, take-profit, and stop fields only after an explicit user click. That handoff is a prefill for human review; it is never transaction authorization. Markets without a qualified plan omit the control.

Contract: `ravenos.hyperliquid_order_plan.v1`

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

### 1b. Exact order plan — current

- Market, limit, and directional trigger entry review.
- Current-book marketability and bounded fill modeling where applicable.
- GTC, post-only, and IOC semantics for limit plans.
- Optional take-profit, stop, projected stop risk, and reward:risk math.
- Explicit Raven-plan-to-ticket prefill where qualified evidence exists.
- No customer account, prepared payload, signature, submission, or claimed fill.

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
- `lib/customer_trade/hyperliquid_order_plan.mjs`
- `lib/customer_trade/execution_readiness.mjs`
- `lib/cross_market/trade_intent.mjs`
- `worker.mjs` at `POST /api/trade/market-preview`
- `worker.mjs` at `POST /api/trade/order-plan`
- `terminal/index.html`
- `ravenos-terminal-live.js`
- `tests/hyperliquid_quote_preview.test.mjs`
- `tests/hyperliquid_order_plan.test.mjs`
- `tests/worker_market_preview.test.mjs`
- `tests/browser/terminal-chart.spec.mjs`
