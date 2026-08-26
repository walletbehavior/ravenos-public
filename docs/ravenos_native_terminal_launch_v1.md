# RavenOS native terminal launch v1

Status: Hyperliquid market preview, exact order plan, public account desk, and account-informed scenario slices implemented; customer execution remains disabled.

## Product boundary

The first native Terminal slice answers a bounded question:

> If this exact Hyperliquid perpetual were entered now at the requested economic size, what does the currently visible book imply?

The preview is computed from the exact venue instrument and current Hyperliquid L2 book. It does not create an order, prepare a signing payload, infer a customer account, claim an available balance, calculate an account-specific fee, estimate a trustworthy liquidation price, submit anything, or create a position.

The terminal also supports an optional public Hyperliquid account view. A viewer may enter a public address—or ask an injected browser wallet only for its public address—to observe current venue equity, withdrawable collateral, spot balances, margin and maintenance state, account leverage, positions, open and historical orders, recent fills, and position funding. A loaded wallet address is transport context only, not an authenticated account connection: RavenOS does not persist the address, assert ownership, mark the wallet verified or linked, expose venue transaction/order identifiers, request a signature, prepare a payload, sign, or submit.

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

## Public account-informed scenario flow

When a current public account snapshot is loaded, the ticket can join the exact short-lived order plan to that same address and model the consequences RavenOS can support without authentication:

```text
exact order plan + current public account snapshot + current account fee tier
  → selected cross or isolated mode + reduce-only intent
  → open, increase, reduce, close, or flip classification
  → projected signed position and notional
  → maker/taker fee estimate
  → incremental opening margin and current-withdrawable check
  → required venue leverage/margin-setting change
  → immutable scenario binding
  → stop
```

The public scenario may identify blockers such as insufficient current withdrawable collateral or a required venue setting change. It does not prove the viewer owns the address, produce a liquidation-price projection, change venue settings, prepare an order, request wallet confirmation, sign, submit, cancel, or monitor a position.

Contract: `ravenos.hyperliquid_account_scenario.v1`

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

### 1c. Public account desk — current

The viewer may supply a Hyperliquid public address and inspect current venue equity, withdrawable collateral, spot balances, margin and maintenance state, account leverage, perpetual exposure, open positions, open orders, bounded historical orders, recent fills, and position funding. Historical orders load only when their tab is opened. The address is retained only in page memory and bounded Worker read caches. Responses strip provider transaction hashes and order/trade identifiers, assert no ownership, and cannot cancel, sign, or submit.

### 1d. Public account-informed scenario — current

- Joins one exact order plan to the same current public address snapshot.
- Models position effect, projected exposure, current account fee tier, incremental margin, collateral sufficiency, selected margin mode, leverage, and reduce-only semantics.
- Supports account-based size presets and a reduce-only close-review prefill from an observed position.
- A browser wallet may supply only its public address; `walletTransportConnected` is distinct from verified or linked ownership.
- Produces an immutable scenario binding but no venue-setting action, prepared order, wallet confirmation, signature, submission, cancellation, or monitoring.

### 2. Authenticated account-aware review — not implemented

Requires the customer identity and session security foundation, verified Hyperliquid account proof, current margin and position state, account-specific fees, margin-mode selection, and recent reauthentication.

### 3. Prepared order — not implemented

Requires an immutable review packet binding the account, exact instrument, direction, size, leverage, order type, price protections, fees, expiry, and payload hash. Any material change invalidates review.

### 4. Wallet confirmation — not authorized

Requires a decoded order preview, payload equality verification, explicit user confirmation in the wallet or venue signing surface, and an independent transaction-security review.

### 5. Submission and reconciliation — not authorized

Requires at-most-once submission, idempotency, acknowledgement/fill separation, order-status monitoring, fill reconciliation, resulting position reconciliation, incident controls, and an explicit owner authorization milestone.

## Solana exact-pool research strategy — current

Velocity, Raven, and activity rows open the selected exact-pool Terminal instead of a detached chart. When the exact market has current provider candles, an aligned Raven spot context, active buy-side participation, sufficient liquidity, complete token-control evidence, and a qualified long structure, RavenOS may show a research-only custom take-profit ladder on the chart.

The ladder adapts its target spacing and scale-out weights to chart structure, structural risk, RSI, recent volume, buy-side share, trader participation, holder change, liquidity, market cap, pool age, holder concentration, developer holdings, and token-control risk. It is omitted when those gates are not satisfied. It cannot populate a spot order, prepare a swap, sign, or submit.

## Next venue

Solana spot is the second intended native route. It must retain exact pool identity and model the full economic intent from USDC to the selected asset and back to USDC. Intermediate hops and native gas assets must remain visible in review without becoming the user’s accidental settlement result. Public signing remains disabled until the same account, wallet-proof, intent-binding, simulation, idempotency, and reconciliation gates pass.

## Implementation evidence

- `lib/customer_trade/hyperliquid_quote_preview.mjs`
- `lib/customer_trade/hyperliquid_order_plan.mjs`
- `lib/customer_trade/hyperliquid_account_snapshot.mjs`
- `lib/customer_trade/hyperliquid_account_scenario.mjs`
- `lib/customer_trade/hyperliquid_account_history.mjs`
- `lib/customer_trade/execution_readiness.mjs`
- `lib/cross_market/trade_intent.mjs`
- `worker.mjs` at `POST /api/trade/market-preview`
- `worker.mjs` at `POST /api/trade/order-plan`
- `worker.mjs` at `POST /api/trade/account-snapshot`
- `worker.mjs` at `POST /api/trade/account-scenario`
- `worker.mjs` at `POST /api/trade/account-history`
- `terminal/index.html`
- `ravenos-terminal-live.js`
- `tests/hyperliquid_quote_preview.test.mjs`
- `tests/hyperliquid_order_plan.test.mjs`
- `tests/hyperliquid_account_snapshot.test.mjs`
- `tests/hyperliquid_account_scenario.test.mjs`
- `tests/hyperliquid_account_history.test.mjs`
- `tests/worker_market_preview.test.mjs`
- `tests/browser/terminal-chart.spec.mjs`
