# RavenOS Robinhood Chain wallet execution v1

Status: production candidate. Activation remains controlled by the customer live-execution gate and an authenticated RavenOS account. RavenOS never receives a private key and cannot submit an arbitrary transaction.

## Scope

The first EVM wallet-execution lane is Robinhood Chain mainnet (`eip155:4663`). It uses the 0x Swap API v2 AllowanceHolder firm-quote endpoint for an exact-input route. RavenOS:

- revalidates the exact market, token bytecode, token decimals, chain ID, and official Robinhood Stock Token registry before quoting;
- refuses official Robinhood Stock Tokens in this release;
- binds the taker, recipient, tokens, amount, minimum output, fee recipient, fee amount, route expiry, and provider transaction to a short-lived ticket;
- requires a current reverse route to USDG before enabling a buy;
- returns provider calldata only to the authenticated browser and persists only its digest and economic evidence;
- asks the connected wallet to submit that exact transaction directly to Robinhood Chain;
- reconciles the transaction, receipt, output, fee transfer when observable, gas, and canonical block against chain state.

The lane supports native ETH or canonical USDG funding for buys and canonical USDG settlement for sells. ERC-20 allowance remains an explicit user-wallet prerequisite; RavenOS does not manufacture or automatically submit approvals.

## Raven fee

The provider-independent schedule selects the fee server-side:

- public/free: 100 bps (1.00%);
- Pro: 70 bps (0.70%).

The browser cannot override the tier, basis points, token, or collector. The 0x quote must return a matching integrator-fee record or the route is refused. The fee collector is chain-local and configured independently from any signing authority.

## Required server configuration

Secret:

- `RAVENOS_ZEROX_API_KEY`

Non-secret configuration:

- `RAVENOS_EVM_FEE_COLLECTOR_ADDRESS`
- `RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT` (must equal the EVM collector)
- `RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENABLE=1`
- `RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE=1`
- `RAVENOS_ROBINHOOD_ZEROX_FEE_TOKEN_SIDE=sell`
- `RAVENOS_CUSTOMER_TRADE_ROBINHOOD_LIVE_ENABLE=1`

The shared live controls must also be active, including the global enable, kill switch, and principal admission policy. The customer D1 migration `0027_customer_evm_live_execution.sql` must be applied before activation.

## Fail-closed cases

No wallet handoff occurs when the exact market changes, chain evidence is unavailable, the official stock-token registry is incomplete, token identity is unresolved, 0x reports an invalid source or incomplete simulation, allowance or balance is insufficient, the reverse exit is unavailable, the quote expires, the fee differs, the connected account changes, or the wallet changes networks.

An ambiguous wallet submission is never retried automatically. The UI directs the user to inspect wallet and chain state first.

## Next chain

BNB Chain (`eip155:56`) is the next adapter profile. It should reuse the same quote, fee, wallet-handoff, storage, and reconciliation contracts while supplying BNB-specific RPC, native gas, canonical settlement assets, and exact chain configuration. It must not be activated merely because 0x advertises chain support; a real read-only route, fee, reverse-exit, wallet-network, and reconciliation fixture must pass first.
