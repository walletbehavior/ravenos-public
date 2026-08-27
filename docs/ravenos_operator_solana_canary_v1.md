# RavenOS operator Solana canary v1

Status: operator-only unsigned-mainnet preflight; no customer capability; no signing; no submission

## Purpose

This operator-only harness proves that RavenOS can take the exact token selected in an exact-pool Terminal URL through current quote, transaction-decode, address-lookup-table, and mainnet-simulation gates without enabling customer execution. It is a weekend canary preflight, not a public trading feature.

The chart pool remains the research and identity context. Jupiter may choose a different executable path, but the intended Solana token mint, wallet address, side, amount, and slippage cannot change. Symbols never select an asset.

## Current boundary

- Accepts only an HTTPS ravenos.xyz/terminal/ URL with an exact Solana spot instrument ID, pool address, selected token mint, and quote mint.
- Revalidates the pool/token/quote tuple through the production RavenOS exact-pair projection.
- Resolves the selected mint, program owner, decimals, supply, mint authority, and freeze authority through Solana RPC.
- Rejects Token-2022 until its extension semantics receive a separate review.
- Verifies the configured RPC is Solana mainnet-beta using the immutable genesis hash.
- Requires a protected Jupiter API credential before any network request; it is never returned.
- Requests a manual Metis order while excluding JupiterZ, Dflow, OKX, Hadron, and ZeroFi.
- Sets a 50,000-lamport priority-fee maximum at quote time and checks every returned fee payer.
- Decodes the actual unsigned v0 transaction, fee payer, signer set, top-level instructions, instruction fingerprints, writable accounts, and address lookup tables.
- Requires lookup tables to be active, warmed up, owned by the lookup-table program, and resolved at a current mainnet slot.
- Independently verifies the exact transaction blockhash is current at confirmed commitment, then runs simulateTransaction unsigned with signature verification and blockhash replacement both off.
- Loads every writable account before simulation and requires monotonically current RPC context slots through lookup, blockhash, pre-state, and simulation evidence.
- Decodes classic SPL Token account state and proves the exact selected mint is credited by at least the quoted minimum on buys or debited by exactly the authorized input on sells.
- Reconciles system-wallet SOL with wallet-owned native wrapped-SOL accounts, including account closure/refund behavior, then measures native settlement, compute use, and simulated network fee against source-level caps.
- Blocks failed simulations and unknown top-level or invoked programs.
- Returns hashes and bounded evidence, never the raw transaction or any secret material.
- Keeps browser signing, customer signing, operator signing, and all submission unavailable.

Solana documents that a transaction with a valid blockhash does not need to be signed for simulateTransaction. The preflight relies on that boundary. It rejects any supplied secret key before network access.

OperatorCanaryExecutionAuthorization.signing_for_simulation and .submission are both source-level false values. Environment flags cannot activate them. The harness contains no Jupiter execute, Solana send, transaction broadcast, or browser-wallet call.

## Hard caps

The current source and security contract enforce:

- Buy input: 0.001–0.05 SOL.
- Canary wallet native balance: no more than 0.1 SOL.
- Slippage: no more than 300 basis points.
- Price impact: no more than 500 basis points.
- Jupiter fee rate: no more than 100 basis points.
- Signature fee: no more than 20,000 lamports.
- Priority fee: no more than 50,000 lamports.
- Combined network fee: no more than 70,000 lamports.
- Rent estimate: no more than 5,000,000 lamports.
- Total estimated fees: no more than 5,100,000 lamports.
- Total simulated native debit: no more than 56,000,000 lamports.
- Jupiter route plan: no more than 8 connected legs from exact input mint to exact output mint.
- Resolved writable accounts: no more than 48.
- Simulated compute: no more than 1,400,000 units.
- Serialized transaction: no more than Solana's 1,232-byte network packet limit.

These are hard refusals, not UI warnings. Lower action-time limits can be chosen for the first live canary.

## Unsigned preflight command

The operator supplies provider credentials through the existing protected environment and only a public wallet address:

    node scripts/run-solana-canary-dry-run.mjs \
      --terminal-url '<exact RavenOS Terminal URL>' \
      --wallet-address '<public Solana address>' \
      --wallet-role reference_probe \
      --side buy \
      --amount-base-units 1000000 \
      --slippage-bps 50

The command emits a bounded JSON evidence packet. A successful infrastructure probe has:

- state: unsigned_mainnet_preflight_passed;
- simulation.state: passed;
- exact pool and selected-mint verification;
- current exact blockhash and monotonic account-state evidence;
- exact selected-token and bounded native-balance deltas;
- no unknown top-level or invoked programs;
- only non-execution boundary blockers.

A reference_probe wallet can prove route infrastructure but is never funding-eligible. A future run against the actual separate canary wallet must use wallet_role: canary, assert that it is a separate low-balance wallet, and pass the 0.1 SOL balance cap.

## Program policy

Reviewed program IDs are source-allowlisted. The current bounded set covers Solana System, Compute Budget, SPL Token, Associated Token Account, SPL Memo, Jupiter Aggregator v6, Orca Whirlpool, Raydium CLMM, and Meteora DLMM.

Program admission does not imply that every possible instruction is authorized. The preflight records the top-level instruction index, account counts, data length, data hash, and eight-byte prefix. Inner programs are recovered from complete simulation logs. Any new program blocks the preflight.

Hadron/AlphaQ remains blocked because its current on-chain program is mutable and lacks the verifiable public semantics needed for this canary. ZeroFi remains blocked pending the same review. They are explicitly excluded from the Jupiter request, and appearance despite that exclusion still fails closed.

## Weekend release gates

Before funding:

1. Pass fixture, malformed-transaction, mismatched-identity, devnet, stale-blockhash, stale-lifetime, token-delta, fee, compute, writable-account, cap, and malicious-program tests.
2. Run a current unsigned mainnet probe against the exact selected Terminal token.
3. Confirm that every top-level and invoked program is reviewed and that all lookup tables resolve.
4. Create a separate low-balance wallet through a protected operator procedure; do not reuse a Raven internal, browser, primary trading, or treasury wallet.
5. Record the canary public address and maximum funding amount without recording private material in RavenOS or source control.

Before any signing:

1. Fund only the separate canary wallet and keep it at or below the 0.1 SOL native-balance cap.
2. Repeat the exact unsigned preflight using wallet_role: canary.
3. Verify the expected token and native-balance deltas, rent, platform fee, network fee, transaction fingerprint, and current block-height lifetime.
4. Add an operator kill switch, at-most-once action record, and post-action reconciliation design.
5. Obtain explicit action-time owner authorization naming the Terminal instrument, mint, side, maximum input, maximum slippage, and wallet.
6. Introduce a separately reviewed signing-only simulation path. The current module cannot sign.

Before any submission:

1. Independently review the exact signing and submission implementation.
2. Require a fresh quote and byte-for-byte message binding after authorization.
3. Require idempotency, a source-level kill switch, post-submit signature reconciliation, balance reconciliation, and an unknown-state stop.
4. Obtain separate action-time authorization for one bounded submission.
5. Keep all public/customer signing and submission disabled.

No wallet should be funded merely because the fixture suite passes. A current live unsigned mainnet preflight and exact action-time limits are mandatory.

## Current unsigned mainnet evidence

On 2026-08-27 at 21:25:43Z, the operator harness completed an end-to-end reference_probe against the current exact JUP/SOL Terminal market `solana:pool:C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz`.

- Production RavenOS exact-pool identity: verified.
- Selected mint: `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`.
- Input: 1,000,000 lamports; slippage ceiling: 50 basis points.
- Current route: one Whirlpool leg; price impact: 0 basis points.
- Quoted minimum output: 455,451 base units; simulated exact-mint credit: 457,740 base units.
- Transaction: unsigned v0, 658 bytes, 7 instructions, 9 writable accounts, and 2 resolved lookup tables.
- Exact blockhash: current with 96 blocks remaining; replacement disabled.
- Simulation: passed at 46,161 compute units with a 5,088-lamport network fee and 1,005,088-lamport reconciled native debit.
- Unknown top-level programs: none; unknown invoked programs: none.
- Reference wallet address, provider credentials, raw transaction, full logs, and secret material were not emitted.
- Funding remained unauthorized; signing and submission remained unavailable.

The live probe also established why the 5,000,000-lamport rent cap and wrapped-SOL reconciliation are necessary. A standard output-token-account path quoted 4,078,560 lamports of rent, and another safe simulation closed a pre-existing wrapped-SOL account, temporarily increasing the system wallet balance during a buy. Both cases now remain bounded and explicitly reconciled rather than being mistaken for a failed direction check.

## Future customer Terminal

The operator harness is deliberately not the customer execution architecture. Customer execution still requires authenticated intent persistence, CSRF and ownership checks, recent reauthentication, wallet proof/linking, idempotency, wallet confirmation, provider reconciliation, incident controls, independent transaction-security review, and the Stage-E authorization gate documented in docs/ravenos_transaction_authorization_v1.md.

## Primary protocol references

- Jupiter Swap V2 order contract: https://developers.jup.ag/docs/api-reference/swap/order
- Solana simulateTransaction: https://solana.com/docs/rpc/http/simulatetransaction
- Solana isBlockhashValid: https://solana.com/docs/rpc/http/isblockhashvalid
- Solana getMultipleAccounts: https://solana.com/docs/rpc/http/getmultipleaccounts
- Classic SPL Token account layout: https://github.com/solana-program/token/blob/main/interface/src/state.rs
