# RavenOS unified USDC limit orders v1

Status: paper and review only. No signing, submission, broadcast, autonomous bridge, or server wallet exists in this milestone.

## Product contract

RavenOS may present one aggregate USDC buying-power view, but every balance remains bound to its exact chain, venue, contract or mint, issuer, representation, and freshness. A balance on one chain never satisfies another chain's local-capital requirement.

A buy limit is evaluated against the conservative all-in executable USDC cost per destination token. A sell limit is evaluated against the minimum net USDC output per token. Chart price, marked price, provider headline output, and a bridge-only quote cannot trigger an order.

Cross-chain buys are non-atomic:

1. Reserve exact USDC on one permitted source chain.
2. Obtain a current cross-chain funding quote.
3. Require wallet or bounded-session authorization for that funding leg.
4. Reconcile destination settlement-asset arrival.
5. Obtain a fresh destination-token entry quote and reverse-exit proof.
6. Re-run the limit and policy checks.
7. If the limit moved away, retain the arrived stablecoin as chain-local buying power. Do not buy and do not automatically bridge it back.

Cross-chain sells are not enabled. They settle first into an exact same-chain accounting asset; moving proceeds elsewhere is a separate capital-transfer operation.

## Implemented

- Canonical multi-chain asset identity and exact chain-local balance checks.
- Canonical Circle USDC registry for supported chains; Robinhood and BNB lookalikes are not silently labeled canonical USDC.
- Sub-micro-dollar limit precision.
- Explicit Raven fee, network, bridge, DEX, solver, provider, gas, token-tax, and fee-collection cost fields.
- Deterministic route comparison independent of provider ordering.
- Quote age, expiry, provider health, gas readiness, route availability, and reverse-exit gates.
- Exact capital reservation preventing two orders from spending the same balance.
- Append-only, hash-chained, restartable order journal with idempotency checks.
- LI.FI Intents quote-request and quote-evidence adapters with bounded response size, timeout, exact interoperable addresses, sealed evidence, and no submission authority.
- Distinct LI.FI direct-token and cross-chain-funding request purposes.
- Public trade capability projection stating what is paper/review-only and what is disabled.

## Provider evidence

Checked 2026-09-03 against current public documentation and read-only provider responses.

- LI.FI Intents supports quote requests and same-chain/cross-chain intent discovery. Its order flow can require an escrow deposit or resource lock and a user signature. RavenOS currently requests quote evidence only.
- A live read-only Base canonical USDC to Robinhood Chain USDG funding request returned one current provider quote. That proves a funding route at that observation time, not a token purchase and not durable future availability.
- The same observation did not return a direct Base USDC to ARROW quote. Robinhood micro-cap execution therefore needs an explicit second, fresh local DEX leg.
- Jupiter Trigger V2 is not selected for Raven limits because its documented vault flow uses a provider-managed custodial account, which conflicts with Raven's noncustodial boundary.
- 0x remains Raven's EVM market/cross-chain quote and wallet-transaction provider. Raven does not currently have an integrated durable 0x limit-order API.

References:

- https://docs.li.fi/lifi-intents/intents-api/api-overview
- https://docs.li.fi/lifi-intents/intents-api/create-and-submit
- https://docs.li.fi/lifi-intents/intents-api/request-quote
- https://developers.jup.ag/docs/trigger/create-order
- https://eips.ethereum.org/EIPS/eip-7930
- https://docs.0x.org/api-reference/api-overview

## Live activation blockers

These are required before calling one-balance cross-chain limits live:

- A reviewed noncustodial funding authorization model: wallet-present signing or narrowly constrained, revocable, expiring session permissions.
- Security review of the selected external escrow/resource-lock contracts and approval scopes.
- Durable server-side order scheduling independent of a browser tab.
- Provider-specific transaction construction and simulation with exact destination restrictions.
- Current source and destination gas pricing normalized into explicit USDC economic terms.
- Fresh local destination entry and reverse-exit evidence joined to the funding quote.
- Raven fee construction and collection for every selected route, not merely fee preview.
- Source-departure and destination-arrival reconciliation, including ambiguous and partial outcomes.
- Recovery rules that require a new policy decision for retry, unwind, or compensation.

Until those gates pass, the terminal must label this capability `PAPER / REVIEW` and must not imply that Raven will execute while the user's wallet is absent.
