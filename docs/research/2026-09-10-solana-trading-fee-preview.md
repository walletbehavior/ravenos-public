# Solana trading estimate and fee validation

The public Solana estimate requested no Raven referral fee, while live preparation requested 100 basis points. A stable route could therefore produce a prepared minimum below the displayed minimum and correctly fail the existing price protection. The estimate now requests the same fee and Metis routing as live preparation. Entry and reverse exit estimates include the fee; the separate SOL-to-USDC valuation remains a valuation without an execution fee.

[Jupiter's order reference](https://developers.jup.ag/docs/api-reference/swap/order) documents that omitting `taker` returns a quote without a transaction and that `referralAccount` and `referralFee` are paired parameters. The preview still omits `taker` and rejects transaction material. Provider evidence must match Raven's reviewed referral identity, fee rate, fee asset and router. Input-denominated amounts use the existing exact-in fee validator; an absent output-denominated fee amount remains unknown until simulation. Quotes report the estimated fee separately from actual collected fees, which remain zero. Unknown costs remain unknown; fee collection is not certified by a quote.

The prepared-minimum guard is unchanged. Regression tests show the old fee-free minimum rejecting a stable fee-inclusive ticket, the corrected minimum passing, and a worse prepared minimum still rejecting. Worker tests cover fee-inclusive entry/exit output, fee-free source valuation, absence of signing material, and free quote requests. All 107 affected quote, fee-policy, referral, preflight and execution tests pass before deployment.

## Authorized production test

The owner deposited SOL and requested a 0.005 SOL buy, then approved an approximately $1 buy when informed of the existing $1 minimum. The selected test market is SQUIRE/SOL on PumpSwap, token `EN2nnxrg8uUi6x2sJkzNPd2eT6rB9rdSoQNNaENA4RZA`, pool `4CPVihvjKUUsXq3HFrS8wniUKffbpDqz2h6jHKjeXoYD`. The signed-in Raven wallet displayed 0.05164987 SOL after the deposit. Saved slippage is 50 basis points. This authority covers one manual test buy; it does not authorize a sell, autonomous execution or additional trades. The rejected Base STONKEX path remains excluded.

At this commit no buy has been submitted. Release, actual quote and settlement evidence must be appended after verification. Actual Raven fee-account credit, journal and cashback reconciliation remain open.
