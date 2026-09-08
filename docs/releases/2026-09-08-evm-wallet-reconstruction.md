# EVM wallet reconstruction — 2026-09-08

This extends Raven's existing Alchemy wallet history and retained profile storage. It adds verified single-pool trading records on the existing Ethereum, Base, BNB and Robinhood chain profiles. No new data subscription, ledger, wallet system, migration or execution authority is introduced. Solana continues to use the existing Helius/history path.

## Evidence and accounting

The decoder verifies exact transaction/receipt/block identity, successful execution, complete receipt transfer logs, pool token identities and membership in a reviewed Uniswap/Pancake V2 or Uniswap V3 factory. Pool transfer amounts must match the pool's Swap event and connect to the wallet's two economic legs. Multi-pool, unsupported protocol, unrelated transfer, missing precision and incomplete native-value cases remain unresolved.

Native ETH/BNB requires a successful full call trace, including refunds and excluding reverted calls. A narrower fallback supports exact-input direct calls to official immutable Uniswap V2 Router02 deployments: decoded two-token path, wallet recipient, expected factory/WETH, one corresponding wrapped-token deposit/withdrawal (or the Robinhood canonical wrapper mint/burn) and an account without contract/delegated code. Router labels or method names alone are insufficient. Historical evidence cannot create Copy execution signals.

Starting token balances are read immediately before the admitted history window. Unknown or missing starting inventory occupies unknown-cost lots. Transfers in create unknown-cost lots; transfers out consume inventory. Sales match FIFO and report only the portion backed by observed acquisition costs in the same settlement currency. A partially matched sale is separately distinguished from a fully matched sale. Conflicting token precision invalidates that token's reconstruction.

USDC, USDG, Binance-Peg USDC, ETH, WETH, BNB and WBNB remain distinct units. Costs, proceeds, realized results, remaining cost and indicative marks use integer arithmetic; proportional allocation rounds down to the smallest settlement unit. ROI totals are unavailable across mixed currencies. Network fees are recorded separately and excluded from trade P&L.

Unrealized USD-equivalent P&L requires all remaining lots to have known canonical-USDC costs, reconstructed quantity to equal the current reported token balance exactly, and a valid USD mark. This is a marked subset, with covered/visible token counts. Native/other settlement costs need historical FX before any dollar conversion. No wallet-wide total P&L or executable liquidation value is claimed.

## Cache and provider budget

Opening a recent stored analysis uses the existing D1 profile envelope without RPC. The existing one-hour reuse, five-minute minimum refresh interval, 90-second shared lease and retained fallback remain. Consecutive overlapping scans merge only when an exact transaction and block hash overlap and the accounting window is complete. Repeated receipts do not duplicate trades. Gaps do not inherit old acquisition costs.

Each fresh scan admits up to 12 receipts, 32 token metadata records, 16 opening token balances and 36 pool-verification calls within the overall 120-RPC/25-second budget, plus one optional price batch. Retained accounting is bounded to 200 events; crossing this limit invalidates carried cost continuity rather than claiming an unbounded history. Pagination at the accounting boundary, missing receipts and provider failures invalidate starting-cost completeness. Profiles remain append-only under existing migration 0041.

Pool identities are cached by chain/pool for one hour. Public token metadata is shared for one hour (missing records for one minute). Alchemy price requests batch the held token contracts using the existing server-side connection; responses must match exact chain and requested contracts. Prices older than 15 minutes or dated in the future are excluded. Valid prices are shared for at most five minutes without extending provider freshness; missing records cache for one minute. Entire batch identities are checked before cache writes. Retained snapshots preserve original observation dates and are not live quotes.

## UX and rollout

The existing wallet overview shows period trades, matched P&L, costs, proceeds, hold duration, return distribution and per-token results. Holdings show supported unrealized marks with coverage. Full wallet addresses remain intact on desktop and mobile. The new flag is `RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED`; the existing lookup and provider flags also apply. Turning it off prevents new reconstruction RPCs; previously stored historical analyses remain readable.

All financial controls remain separate: native fee 100 bps, Pro cashback 30%, Hyperliquid policy unchanged. No broadcast, subscription change, reward claim or live Copy activation occurs.

## Remaining parity gaps

This is bounded verified history, not complete GMGN parity. Universal Router/V4, multi-hop and aggregator paths, smart-account native flows without supported tracing, deep archive pagination, tax/gas-inclusive P&L, historical FX and full mark coverage need further adapters/evidence. Wallet-wide profitability must not be inferred from the verified subset. Raven's thousands of observed wallets are candidate identities, not thousands of fully reconstructed histories.

## Primary references

- [Alchemy Transfers API](https://www.alchemy.com/docs/data/transfers-api): indexed participant history, supplemented with receipts.
- [Alchemy Prices API](https://www.alchemy.com/docs/data/prices-api/prices-api-endpoints/prices-api-endpoints/get-token-prices-by-address): exact network/address USD marks and observation timestamps.
- [Alchemy transaction traces](https://www.alchemy.com/docs/chains/debug-api/debug-api-endpoints/debug-trace-transaction): full call-tree semantics; availability depends on network/provider.
- [Robinhood connection and archive guidance](https://docs.robinhood.com/chain/connecting/).
- Official Uniswap deployment inventories: [Robinhood](https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/4663.md), [Base](https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/8453.md), [Ethereum](https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/1.md), [BNB](https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/56.md).
- [Uniswap V2 Router02 source](https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router02.sol), [Pancake V2 deployment addresses](https://developer.pancakeswap.finance/contracts/v2/addresses).

Verification and production version receipts are retained in workspace outputs, separately from this source report.

## Empirical check

A read-only check against Robinhood's official public RPC verified transaction `0x884b5d9f8822ba29452818ea86b0f45f003b869684bdcf195e64daa905b4a6fe`: the official Router02 and factory, canonical wrapper mint and pool transfer evidence agree on 0.277275376065377574 ETH input and 287179.811480931 output-token units. The exact public receipt is retained as a regression fixture. No transaction was constructed, signed or broadcast.

The public RPC returned method-not-found for `debug_traceTransaction`. Earlier mixed-route and delegated-account samples therefore stayed unresolved; the verified direct-router fallback is deliberately narrower. This limitation is separate from the deployed Alchemy endpoint, which is checked through the real account UI after promotion. [Canonical Robinhood token registry](https://docs.robinhood.com/chain/contracts/) supplies the WETH/USDG identities.

## Connection and display follow-up

Robinhood can reuse Raven's existing Alchemy Base app key on the exact official Robinhood endpoint if no chain-specific binding exists. Alchemy's network authorization and Raven's `eth_chainId` check still apply. Explicit Robinhood configuration takes precedence. Availability failures can use the existing Blockscout provider; integrity failures cannot. Fallback telemetry labels partial request counts instead of understating total provider work. No new subscription or API key is introduced.

Single-transfer receipt events preserve their exact amount, token label and provider provenance. The UI also reads older retained records' provider arrays. Cached metadata contains only bounded public token fields.
