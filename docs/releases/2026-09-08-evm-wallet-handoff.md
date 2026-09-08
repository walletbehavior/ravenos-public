# EVM wallet handoff recovery

The EVM single-Buy path now selects the correct network before obtaining its final short-lived quote. Existing connected wallets are reused. External wallets can add an unconfigured supported network after an explicit unknown-network (4902) response. Cancellation, account changes, order edits and wrong-chain responses stop the handoff.

The production Privy SDK lacked Robinhood (4663) in its default chain list. Raven now extends that list with its existing EVM chain profiles, retaining Privy's defaults for the other networks. The custom Robinhood RPC is an explicit public endpoint allowed by the Account and Terminal/Discover CSP. Paid backend RPC credentials remain server-side.

Two bugs were reproduced using the shipped SDK rather than a wallet-method mock:

- Missing transaction type caused the SDK to default to EIP-1559 and discard a quoted legacy gas price. Both EVM executors now preserve explicit chain ID, transaction type and quote-bound fee fields.
- The SDK returns `bigint` from `eth_estimateGas`. Raven previously accepted only hex strings, rejecting valid embedded-wallet ERC20 approvals. Both exact formats now use the same gas bounds.

A required ERC20 allowance remains limited to the trade's amount. Raven checks its receipt and allowance before continuing. Native funding skips token approval. One Raven Buy initiates the sequence; wallet-controlled approval/signature prompts remain part of the wallet's authorization. The release does not change fees, cashback, custody, delegation or Hyperliquid execution.

## Validation

- Baseline: 105 EVM contract tests and 11 selected EVM/Solana browser tests passed before edits.
- Final contracts: 1,029 passed, including new network and gas-quantity cases. Product, auth, legal, wallet-history and other pretest checks passed.
- Full browser run: 413/414 passed initially. The sole failure was an existing Behavior Lab fixture lacking chain identity required by market-scope filtering. Adding the fixture's actual Robinhood/Solana identifiers preserved its assertions; the entire affected 11-test file then passed. No production Behavior Lab logic changed.
- Sixteen actual Privy SDK cases cover four chains, two wallet modes and legacy/EIP-1559 fees. Legacy cases also exercise exact ERC20 approval, gas estimation, receipt, allowance recheck and the fee-bound trade executor. All service calls and signatures are fixtures; no real network receives test transaction bytes.
- Single-Buy browser cases cover all four chains, approval versus existing allowance, native ETH, network selection before final ticket acquisition and cancellation after an order edit.
- Build, security boundary, response redaction and public-asset checks passed.

## Operational limits

Robinhood's public RPC is rate-limited. It is used for wallet connection/signing mechanics, not bulk wallet-history acquisition. A dedicated public-safe production wallet RPC may be appropriate as traffic grows; no server secret should enter a browser chain definition.

Production connection/quote verification is recorded separately after release. A simulated signature test is not evidence of a funded production fill, nor an on-device iPhone test.

## References

- Privy custom EVM networks: https://docs.privy.io/basics/react/advanced/configuring-evm-networks
- Robinhood wallet configuration: https://docs.robinhood.com/chain/add-network-to-wallet/
- Robinhood RPC constraints: https://docs.robinhood.com/chain/connecting/
- BNB public RPC endpoints: https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/
