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

## Owner's mobile buy failure: leading decimal notation

While preparing the release, the owner supplied PUMPCAT screenshots showing `.015` and `.02` SOL and the generic unavailable-route message. Production independently reproduced `.015` on the already supported BONK/Orca market at `2026-09-10T19:41:12.494Z`: HTTP 400, `buy_display_amount_invalid`, release `ravenos-be231eca4f73-fa9011bdff9dd170`. This establishes an amount-input defect independent of venue support. PUMPCAT's exact pool is still awaiting the owner's URL/address; the symbol alone resolves to several different contracts.

The frontend and server now normalize a leading decimal point by adding `0` as text. No floating-point conversion or rounding is involved. Solana preview/preparation and EVM base-unit conversion accept the same notation; invalid, zero, negative and excessive-precision values remain rejected. Invalid amount errors also have a specific user-facing message. All 177 affected unit/integration tests and seven browser tests pass, including `.015` and `.02` request bodies at 390px and 1440px with no execution requests. Build, security and no-leak checks pass.

The intermediate PumpSwap-only candidate at source `864331f66ad4` was packaged and copied to the release host, but not staged or promoted. The combined fix supersedes it.

## First production validation and RPC representation correction

Source `3e66f729a79654796120b197ffc727ffa5b2b1d2` deployed at 100% as `ravenos-3e66f729a796-aa0ae3a2fe29c69e`, Worker `5aaa54ef-b085-4b7e-8510-e2a3afe0802d`. Staging verified at `2026-09-10T19:47:40.437Z`; the production workspace verifier passed with 39 asset digests, 11 access gates and zero transactions. Access gates are not signed-in journey coverage. Archive SHA-256: `f3c64a4aaf517f9bfa1c11f9eb32bc248e415d82066bdb8d2d8ba8d646b17a84`.

Production BONK/Orca `.02` returned HTTP 200 at `2026-09-10T19:49:08.375Z`, value $1.995927 with fee-inclusive entry and verified reverse quote. The previously rejected fractional notation now works without a frontend reload. SQUIRE's staged entry and reverse quotes also returned HTTP 200.

The signed-in SQUIRE unsigned preparation at `2026-09-10T19:49:28.381Z` reached independent simulation and stopped with `pump_swap_inner_program_invalid`, HTTP 409, no ticket, no signing or submission. Review of the [official simulation RPC reference](https://solana.com/docs/rpc/http/simulatetransaction) and [Agave implementation](https://github.com/anza-xyz/agave/blob/master/rpc/src/rpc.rs) identified a format difference: simulations return parsed built-in instructions and partially decoded custom instructions with account addresses; retained transaction responses can use compiled account indexes.

The decoder now resolves both representations against the actual transaction's account keys, keeping writable/signer and stack-parent checks. Pump instructions still require their binary data, and mismatched program identities or unresolvable addresses remain rejected. Added tests cover all three swap methods in the simulation format, parsed built-ins, contradictory identity and missing binary evidence. All 179 affected tests pass. This correction still needs deployment and a new mainnet unsigned result.

Source `7335128eefd5865d0e77bfb718cd8994f2502043` was subsequently staged and deployed as `ravenos-7335128eefd5-6545eb565af37aea`, Worker `4fcb96c5-e071-4965-be01-ae42efd836c1`. Staging verified at `2026-09-10T19:55:40.567Z`. Signed-in unsigned preparation at `19:57:50.893Z` advanced past CPI decoding and stopped on `pump_swap_token_account_mismatch`, HTTP 409 with no ticket or signature.

A separate unsigned mainnet simulation at `2026-09-10T20:01:12.282Z` created and closed a temporary WSOL account in simulation only. It succeeded without populated signatures or submission and returned the closed account as an empty, System-owned record with zero lamports, rather than `null`. The token-account review now recognizes exactly that closed state for transient WSOL. Nonzero lamports, any data, a different owner or an executable account still fail. Pool and selected-token accounts do not receive this exception. This also confirmed the RPC's parsed built-in instruction representation directly.
