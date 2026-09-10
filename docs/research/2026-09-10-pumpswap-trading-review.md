# PumpSwap execution review — 10 September 2026

The funded SQUIRE test could not reach unsigned preparation because Raven excluded PumpSwap from Jupiter routes. The owner has now deferred the funded test until returning to the M2. No trade confirmation, signing or submission is part of this implementation work.

The adapter now requests PumpSwap routes and independently reviews their simulated instructions. PumpSwap and its fee program remain outside the general program allowlist. Admission requires a reviewed Jupiter v2 fee envelope, the selected token and quoted pool, pool ownership and account layout, derived pool/config/creator-fee identities, matching token accounts, and the requested wallet. Only buy, buy-exact-quote-in and sell calls directly beneath that Jupiter instruction can qualify. Each swap must have a read-only fee query and matching nested swap event. Missing or truncated evidence, unknown methods, administration calls, top-level Pump instructions and unrelated pools fail closed. Bonding-curve Pump.fun remains excluded.

Existing whole-transaction input, minimum-output, slippage, network/rent, signer, token-program and Raven fee-account checks remain enforced. A transient WSOL account can be opened and closed inside a transaction; its native debit remains subject to the existing independent balance checks. Raw CPI material is used privately during preparation and is not added to the execution ticket response.

The current implementation requires PumpSwap's user to be the requested wallet. A route using a different intermediary authority needs a separate review; broad authority admission is not implied. Unsigned mainnet validation is still required before describing any specific market as ready.

## Sources

Reviewed official Pump public documentation pinned to commit `9c82f61cb711b044a17f770ab8ce9f9bdf78f333`:

- [PumpSwap program and pool layout](https://github.com/pump-fun/pump-public-docs/blob/9c82f61cb711b044a17f770ab8ce9f9bdf78f333/docs/PUMP_SWAP_README.md)
- [Pump AMM instruction definitions](https://github.com/pump-fun/pump-public-docs/blob/9c82f61cb711b044a17f770ab8ce9f9bdf78f333/idl/pump_amm.json), SHA-256 `6b5c7ec4e5ef9742fa99dc57b0d75b1031b379bba02a7e1b3c5a4cad68d77e56`.
- [Pump fee instruction definitions](https://github.com/pump-fun/pump-public-docs/blob/9c82f61cb711b044a17f770ab8ce9f9bdf78f333/idl/pump_fees.json), SHA-256 `ea2fb5dae0252375513ff8072a111affe83a0fd4db7a2e8840b3b39bace5ec83`.

Pinned IDL bytes were checked against the initially downloaded copies. The verifier deliberately reads the reviewed stable fields and rejects unknown instruction variants.

## Local validation

All 174 affected tests pass: PumpSwap instruction review; operator/customer preflight; actual recorded Jupiter fee-envelope decoding; referral identity; fee-inclusive previews; spot quote review; live execution/receipt validation; Worker preview requests; transaction and address-lookup decoding. The new tests include three valid swap methods, mismatched pools/wallets/fees, missing CPI evidence and prohibited calls. Build, security and public no-leak validation pass.

The broader run also exposed stale recorded-transaction tests that omitted the selected-mint context now required by the fee verifier. Those fixtures now supply their recorded USDC-to-BONK SPL context. Missing or mismatched context produces a validation error and remains rejected.

Deployment and mainnet unsigned results will be recorded below when observed. A successful unsigned result does not establish settlement, collected fees or cashback.
