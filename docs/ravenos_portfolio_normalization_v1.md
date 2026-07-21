# RavenOS Portfolio Normalization v1

Status: read-only architecture contract
Implementation: `lib/cross_market/portfolio.mjs`
Schema: `ravenos.portfolio.v1`

## Objective

Portfolio presents one economic view across wallets, perpetual venues, and brokers while preserving actual custody, collateral, settlement, and conversion truth.

The default display numeraire is USDC-equivalent. This does not mean every account holds USDC, that USD and USDC are always equal, or that a broker settles in USDC.

No connected customer account system is currently proven for public RavenOS. Until connectors exist, Portfolio must render a connection/unavailable state and never a fictional customer portfolio.

## Separate concepts

Portfolio must not collapse these distinct values:

| Concept | Example |
| --- | --- |
| Custody asset | USD cash at a broker, USDC in a wallet, collateral at Hyperliquid. |
| Settlement asset | USD for a Tradier security, USDC or venue collateral for a crypto trade. |
| Economic numeraire | The selected display basis, default USDC-equivalent. |
| Asset value | Current marked value of a spot holding or security. |
| Derivative notional | Directional exposure; not portfolio equity. |
| Collateral/equity | Capital supporting a derivative position. |
| Unrealized P/L | Change in economic value, not a second holding. |
| Conversion | Timestamped rate and source between custody value and display numeraire. |

## Contract

`normalizePortfolioSnapshot()` accepts:

- accounts;
- holdings;
- derivative positions;
- explicit currency conversions;
- a requested economic numeraire.

It emits:

- total normalized value;
- separate derivative notional;
- accounts and custody metadata;
- holdings and positions with source and normalized values;
- conversions and timestamps;
- deduplication results;
- explicit incomplete/unavailable warnings;
- `demonstration_data=false`.

## Valuation rules

### Currency conversion

Identity conversion is permitted only when source and target symbols are identical. USD to USDC requires an explicit rate, source, observation time, and freshness state. No hard-coded 1:1 assumption is permitted.

If a required conversion is absent, the holding remains visible with its source value, but normalized value is null and the portfolio becomes `partial`.

### Account equity precedence

When an account supplies authoritative account equity, that value is used once for portfolio total. Child cash and holdings remain visible but are not added again.

When authoritative equity is unavailable, the total may be built from child rows with valuation roles:

- `cash`;
- `asset_value`;
- `collateral`;
- `option_value`.

`derivative_exposure` is excluded from total value. Its absolute notional is reported separately.

### Perpetual positions

A perpetual's notional is exposure, not account value. Portfolio value should use venue account equity or collateral economics. Position rows retain side, quantity, entry/mark, leverage, liquidation, funding, margin, unrealized P/L, and exact instrument ID where available.

### Options

Option market value may contribute once as `option_value`. Underlying exposure, delta exposure, and contract notional are analytical exposures and do not contribute again to total value.

## Deduplication

Each economic lot should carry `economic_lot_id` or `custody_position_id`. Duplicate observations with the same key retain the freshest observation and record the dropped ID.

The key must distinguish legitimate separate lots while joining duplicate ingestion paths. Examples:

- one imported wallet seen through two RPC/indexer connectors uses the same custody position ID;
- wrapped and native representations use separate custody IDs unless a verified representation bridge explicitly proves one economic lot;
- broker account summary and broker child holdings do not share a lot ID; account-equity precedence prevents double counting;
- perp collateral and perp notional use different valuation roles, with notional excluded from equity.

RavenOS must not infer common ownership or deduplicate wallets merely because addresses or assets look related.

## Target account adapters

| Adapter | Current public status | Required normalized output |
| --- | --- | --- |
| On-chain wallet | Optional UI wallet state exists; no authenticated portfolio connector | Exact chain/account, balances, token/pool identity, custody IDs, price source/freshness. |
| Hyperliquid account | Live public market data exists; no customer account integration | Collateral/equity, positions, funding, margin, liquidation, exact contract IDs. |
| Tradier/broker | Private market/options provider exists; no customer broker account integration | USD cash/equity, holdings, options, pending-order reservation rules, settlement state. |

Unavailable adapters must render connection state and methodology—not illustrative holdings.

## Economic workflow

For supported on-chain spot:

```text
Buy:  USDC amount -> exact selected asset market -> asset received
Sell: exact selected asset amount -> route -> USDC received
```

Gas assets, wrappers, and intermediate hops are route details. They become prominent only when the user must supply gas, approve wrapping/bridging, or accept material route risk.

For brokered securities:

```text
Intent display: portfolio numeraire amount
Actual order/settlement: broker USD rules
Portfolio display: timestamped USD -> USDC conversion when available
```

For perpetuals:

```text
Intent: Long / Short exact venue contract
Actual economics: venue collateral + margin + leverage + funding
Portfolio display: normalized account equity and separate directional notional
```

## Freshness and unavailable semantics

Every valuation must retain:

- price/mark source;
- observation timestamp;
- conversion source and timestamp;
- freshness state;
- stale or unavailable reason.

Portfolio totals must not look exact when one material component is unavailable. The aggregate state becomes `partial`, and unavailable value counts remain visible.

## Position intelligence

Where real contracts exist, a position may join:

- current Raven path;
- evidence and maturation state;
- structural invalidation or monitoring state;
- current route/liquidity risk;
- Atlas event/session context;
- historical comparable outcomes.

Research-only plans remain labeled. No customer position-monitoring claim may be made until a persistent authenticated position system exists.

## Security and privacy

Public output must never expose:

- raw private wallet graphs;
- inferred ownership links;
- broker or wallet credentials;
- transaction payloads or signatures;
- private execution reservations;
- internal account identifiers unless replaced by customer-scoped opaque IDs;
- provider payloads or internal paths.

Persistent portfolios require real authentication and server-side authorization. Wallet UI state is not authentication.

## Required tests

- explicit USD/USDC conversion and stale-conversion behavior;
- authoritative account equity versus child holdings;
- wrapped/native and duplicate-wallet cases;
- collateral versus derivative notional;
- option value versus delta/notional exposure;
- pending-order and reserved-cash handling when that data exists;
- missing valuation and partial totals;
- exact instrument joins;
- provider outage isolation;
- no demonstration holdings in an unconnected account;
- no-leak scanning of all portfolio responses and bundles.
