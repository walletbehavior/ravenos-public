# Solana trading estimate and fee validation

The public Solana estimate requested no Raven referral fee, while live preparation requested 100 basis points. A stable route could therefore produce a prepared minimum below the displayed minimum and correctly fail the existing price protection. The estimate now requests the same fee and Metis routing as live preparation. Entry and reverse exit estimates include the fee; the separate SOL-to-USDC valuation remains a valuation without an execution fee.

[Jupiter's order reference](https://developers.jup.ag/docs/api-reference/swap/order) documents that omitting `taker` returns a quote without a transaction and that `referralAccount` and `referralFee` are paired parameters. The preview still omits `taker` and rejects transaction material. Provider evidence must match Raven's reviewed referral identity, fee rate, fee asset and router. Input-denominated amounts use the existing exact-in fee validator; an absent output-denominated fee amount remains unknown until simulation. Quotes report the estimated fee separately from actual collected fees, which remain zero. Unknown costs remain unknown; fee collection is not certified by a quote.

The prepared-minimum guard is unchanged. Regression tests show the old fee-free minimum rejecting a stable fee-inclusive ticket, the corrected minimum passing, and a worse prepared minimum still rejecting. Worker tests cover fee-inclusive entry/exit output, fee-free source valuation, absence of signing material, and free quote requests. All 107 affected quote, fee-policy, referral, preflight and execution tests pass before deployment.

## Authorized production test

The owner deposited SOL and requested a 0.005 SOL buy, then approved an approximately $1 buy when informed of the existing $1 minimum. The selected test market is SQUIRE/SOL on PumpSwap, token `EN2nnxrg8uUi6x2sJkzNPd2eT6rB9rdSoQNNaENA4RZA`, pool `4CPVihvjKUUsXq3HFrS8wniUKffbpDqz2h6jHKjeXoYD`. The signed-in Raven wallet displayed 0.05164987 SOL after the deposit. Saved slippage is 50 basis points. This authority covers one manual test buy; it does not authorize a sell, autonomous execution or additional trades. The rejected Base STONKEX path remains excluded.

At this commit no buy has been submitted. Release, actual quote and settlement evidence must be appended after verification. Actual Raven fee-account credit, journal and cashback reconciliation remain open.

## Fee release and live route finding

Source `ec5797b152845981036238056770338bc60047fb` deployed at 100% as `ravenos-ec5797b15284-0aec21228fcfcc0d`, Worker `ed1297f4-f16e-4929-8ee5-d52c2d378120`. All 107 affected unit/integration tests and six browser tests passed. Staging and production checks passed, including the explicit 66-check/39-asset/11-access-gate production verifier. These access gates do not certify signed-in journeys.

The actual staging and production SQUIRE quote at 0.0101 SOL included a 101,000-lamport estimated fee and still reported zero fees collected. Production valued the input at $1.008149 at 18:58:14 UTC. The signed-in UI showed the fee included, 1,465.383904 SQUIRE expected and 1,458.056984 minimum.

The owner-authorized Buy action then stopped before a ticket was created. The UI showed Not sent and an unchanged 0.05164987 SOL balance. A bounded read at 19:01:11 UTC found zero live execution intents/events for that wallet. An unsigned diagnostic request returned `jupiter_order_http_400` for SQUIRE. The same wallet, amount, fee and slippage on the current BONK/Orca pool returned a valid unsigned ticket with independently verified fee evidence; nothing was signed or submitted. That diagnostic ticket is allowed to expire.

The source excludes PumpSwap from live routes, while the public estimate had still allowed it. The follow-up makes estimates use the same venue exclusions as live preparation. It does not admit any new program or relax simulation, minimum receive, fee or wallet limits. PumpSwap support requires a separate program/fee-path review and unsigned mainnet validation; broader venue coverage remains a package-1 gap. The owner has been asked whether to use the supported BONK route for the ~$1 test or finish SQUIRE/PumpSwap support first.

## Venue alignment release and handoff

Source `be231eca4f734d9dc54b03077039eac1a5e47715` deployed as `ravenos-be231eca4f73-fa9011bdff9dd170`. All 107 affected tests passed again. Staging verification completed at 19:15:13 UTC. On the same candidate, SQUIRE returned unavailable with no quote; BONK returned a fee-inclusive quote and verified reverse exit. The explicit production verifier passed 66 checks, 39 asset digests and 11 access gates. The production BONK quote at 19:17:16 UTC valued 0.0101 SOL at $1.008366 and included the 101,000-lamport fee. Requesting these quotes remained free.

The BONK/Orca review page is open with 0.0101 SOL entered and the saved 0.50% slippage. Its exact pool is `5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9`; token `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`. The market choice is still pending. The Computer Use tool's financial-action policy requires the owner to make the final financial confirmation; no signing/submission workaround is authorized or needed. After the owner submits the chosen trade, inspect its settled message, wallet token credit, actual Raven collector credit, trade journal and Pro cashback. A sell or additional trade still requires its own specific authority.

PumpSwap review starts from the publisher's [AMM documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md), [AMM IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json) and [fee-program IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_fees.json). Verify the current swap/fee calls, exact accounts and simulation evidence before changing program admission. Documentation alone is not live execution evidence.
