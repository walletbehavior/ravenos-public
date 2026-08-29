# RavenOS Shadow Route Truth Loop v1

## Purpose

RavenOS must measure whether a route that appears usable remains usable before customer execution can be considered. The truth loop records normalized read-only route evidence at quote time, then rechecks the exact liquidation path at fixed horizons. It is an empirical reliability system, not paper trading, custody, a portfolio ledger, or transaction execution.

## Admission

Only a server-qualified exact Solana market review with a canonical-USDC buy request and a normalized shadow execution result is eligible. Symbols never select the asset. The observation retains the canonical exact-market identifier, destination mint identity, USDC amount band, exact destination base units, provider, route state, entry and exit states, quote timing, latency, slippage, and the known round-trip result.

The ledger uses a deterministic five-minute sample key across market, side, amount band, provider, route state, and slippage. Repeated clicks cannot inflate the sample count. A user or wallet is neither required nor stored.

## Checkpoints

The scheduled evaluator checks the original expected destination quantity back to Circle-issued Solana USDC at 5 minutes, 1 hour, 4 hours, 24 hours, and 7 days. Each checkpoint is a new immutable row. The original observation is never rewritten using later evidence.

Each run uses one database lease, considers at most eight due checkpoints, uses RavenOS provider pacing and circuit behavior, and records either a current reverse quote or a bounded refusal reason. Provider failure does not erase the original observation and cannot produce a synthetic route.

## Privacy and authority boundary

The database contains no customer ID, account ID, wallet address, IP or network address, raw provider response, Raven plan price, approval, signature, serialized transaction, calldata, private key, balance, position, or order. Public output is aggregate-only.

Signing, transaction construction, submission, bridging, approvals, custody, and fee charging remain unavailable. Environment configuration cannot turn a shadow sample into transaction authority. The quote adapter also rejects a provider response if transaction, approval, signature, or calldata material unexpectedly appears.

## Retention and output

Observations expire after 30 days. Checkpoints cascade with their observation. Append-only triggers block mutation of either evidence table. The public readiness endpoint returns bounded 24-hour aggregates by chain, provider, and amount band plus checkpoint maturity. It exposes no provider payload or user-level record.

Readiness distinguishes entry quote coverage, verified exit coverage, complete-friction coverage, and actual trade availability. A reverse quote with unpriced network cost remains exit-verified but not friction-complete and not executable.
