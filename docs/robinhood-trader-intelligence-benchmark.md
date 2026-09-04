# Robinhood trader intelligence benchmark

Reviewed against the public Robinhood Trenches product on 2026-09-04. This is a product benchmark, not a data-source dependency. RavenOS does not scrape, import, or trust Trenches calculations.

| Public Trenches surface | Apparent meaning | RavenOS equivalent | Raven data source | Confidence | Milestone status | Raven advantage / gap |
| --- | --- | --- | --- | --- | --- | --- |
| Live Tape | Recent buys and sells by tracked wallets | Smart Money / RH activity | Raven normalized RH source-wallet events | Exact event identity; indexed-wallet coverage only | Implemented, feature-gated | Preserves finality, provider confirmation, and unknown dollar size; broader indexing remains a gap |
| Traders | Ranked trader rows | Chain-neutral wallet screener, RH scope | Raven wallet profiles and materialized screener rows | Depends on reconstruction coverage | Existing basic surface | Raven separates unavailable P&L from zero; full RH lot reconstruction remains a gap |
| P/L on sells | Realized trade result | Realized P&L | Raven lot accounting | Unavailable unless cost basis is known | Model exists; RH coverage incomplete | Inbound transfers never become free inventory |
| P/L open bags | Marked open inventory | Marked and executable open-position value | Raven portfolio plus current quote evidence | Provider-qualified | Not yet complete for RH wallets | Raven will keep marked value separate from executable liquidation value |
| Volume / fills / wins / closed | Activity and outcome counts | Activity and performance dimensions | Normalized events and closed lots | Sample/coverage qualified | Partially available | Raven exposes coverage and profit concentration instead of one opaque rank |
| Best / worst | Extreme closed outcomes | Best / worst known closed lot | Raven lot accounting | Requires adequate cost-basis coverage | Not yet complete for RH | Raven will not rank a wallet from one moonshot without sample gates |
| Time windows | 1h, 24h, 7d, 30d, all | Bounded query windows | Event time / Raven observation time | Exact where chain time exists; otherwise labeled observation time | 1h–30d supported in first activity API | All-history requires bounded materialized history |
| Tokens being bought | Token-centric wallet flow | Clustered activity | Exact contract entries by distinct indexed wallets | Correlation only | Implemented, feature-gated | No insider or coordination claim; route handoff requires a fresh executable quote |
| Who followed who | Repeated wallet ordering | Observed lead/lag relationships | Exact-token entry chronology | Correlation only | Implemented for Pro, feature-gated | Reports sample, lead rate, and lag distribution; never labels copying as fact |
| Fresh pools | New pools / launches | Raven Discover + Dexch enrichment + direct RH observation | Dexch provider evidence plus Raven chain evidence | Provider-qualified | Existing discovery work | Dexch remains replaceable and cannot become execution or wallet-accounting authority |
| Wallet/profile links | Address drilldown | Wallet profile, watch, Terminal handoff | Canonical chain/network/address identity | Exact public-chain identity | Partial | Raven username association requires voluntary signature proof |

## First milestone boundaries

- One shared chain-neutral event ledger feeds RH activity; there is no second wallet screener or copy engine.
- Activity, clusters, and lead/lag are read-only intelligence. They never authorize an execution.
- USD trade size remains unavailable until decimals and contemporaneous price evidence are verified.
- Clustered activity means distinct indexed wallets entered the same exact contract in the selected window. It does not establish coordination.
- Lead/lag is an observed ordering relationship. It does not establish copying or causation.
- Basic RH activity and clustered activity are intended for signed-in users. Advanced lead/lag remains Raven Pro.
- The index is progressive and demand-driven. It does not claim complete coverage of all Robinhood Chain wallets.

## Next RH data milestone

Complete incremental RH lot accounting from normalized swaps, transfers, gas, and verified settlement assets; add materialized trader snapshots; then expose basic trader cards and Pro comparisons. Direct sequencer/RPC evidence remains authoritative, 0x supplies executable routing evidence, and Dexch supplies replaceable discovery/lifecycle enrichment.
