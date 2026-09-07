# Raven Shielded Reserve — architecture spike

Research observed September 6, 2026 local / September 7 UTC. Operator prototype only; not a customer launch. No transaction was signed or submitted.

## Decision

Recommend **B: a small user-controlled Shielded Reserve beta, after the gates below**. Both deployment and return quotes work, so there is no measured reason to deliberately exclude returns. Keep the current release at research/shadow stage until an external-wallet settlement/refund canary, security review and counsel review establish the missing properties. A stable-value reserve should wait for production shielded-asset infrastructure; current reserve value is ZEC exposure.

The product home is **Portfolio → capital-management helper**. Reserve visibility, funding plans, working-capital targets and excess-capital returns belong together. Agents may eventually propose these actions using the same accounting, but this is not a separate Zcash wallet product or an immediately spendable USDC balance.

## What is implemented

- Provider-neutral shadow intents for deploy, return and fixed-recipient-amount send; a real anonymous NEAR 1Click adapter. Only token discovery and `dry: true` quote requests exist. No submission, spend-key, wallet-provisioning or deposit-address path exists.
- Pinned official SDK 0.1.25 verifies the provider's quote signature. Echoed route/amount/recipient/refund fields must match the constructed research request. Unknown assets, stale prices/signatures, redirects, unexpected deposit addresses, oversized responses and invalid signatures fail closed.
- Exact canonical USDC contracts and chain identities. Robinhood never aliases Base or another chain. Hyperliquid quotes explicitly target its perps balance, not HyperEVM or spot.
- Explicit privacy facts, source-shield and destination-shield proof states, metadata exposure, timing/amount risks, conditional refund semantics, and unknown fee components. Unknown never becomes a Shielded promise.
- Precise ZEC valuation and four Portfolio compartments: public, shielded, in transit, unresolved. Existing economic-lot identity removes duplicate source/destination observations. All nonpublic compartments have zero immediately executable capital.
- Copy readiness uses existing Portfolio capital inspection. Shielded reserve backing cannot meet a hot-capital requirement. Excess-capital returns and delay choices are simulations only.
- An interactive local prototype with real Deploy/Return/Send quotes, minimum receive, marked costs, timing, privacy evidence, fee scenarios and Portfolio/Copy simulation. No customer addresses or balances are requested.
- Hash-linked append-only research journals, timestamped token catalogs, route matrix and standard-versus-two-leg comparisons. No database migration or duplicate customer wallet/rewards ledger.

## Capabilities and maturity

| Capability | Status | Evidence and limitation |
|---|---|---|
| Orchard shielded ZEC | LIVE protocol capability | Orchard protects shielded note data; Raven has not integrated a signer. [ZIP 224](https://zips.z.cash/zip-0224), [key design](https://zcash.github.io/orchard/design/keys.html) |
| External user-controlled wallet | LIVE outside Raven | Zodl provides recovery and CrossPay. Raven connection/recovery is not implemented. [Wallet creation](https://support.zodl.com/article/23-creating-your-zodl-wallet), [CrossPay](https://support.zodl.com/article/24-using-crosspay-to-spend-zec) |
| NEAR forward and reverse quotes | LIVE read-only API; Raven research adapter | Signed forward/reverse dry responses succeeded with a shielded-only research Unified Address. This does not prove actual shielded settlement. [Quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote), [signature verification](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature) |
| Privy Zcash wallet | UNAVAILABLE in this integration | Do not infer Orchard support from generic key curves or EVM/Solana support. Keep a future external signer behind the Raven wallet abstraction. [Privy chains](https://docs.privy.io/wallets/overview/chains) |
| Zwap | EXPERIMENTAL / claimed early access | Founder describes $1–$100 early access and internal reviews with external audit planned; no audited provider SDK integration established. App reachability timed out in this run. Do not conflate unrelated same-name hackathon repositories. [Founder thread](https://forum.zcashcommunity.com/t/zwap-trustless-shielded-atomic-swaps-for-zcash-early-access/55874), [provider](https://zwap.exchange/) |
| Zcash Shielded Assets / swaps | PROPOSED / draft | ZIPs 226–228 do not establish production shielded USDC. ZIP 220 is withdrawn. Do not use roadmap assets in balances or routes. [226](https://zips.z.cash/zip-0226), [227](https://zips.z.cash/zip-0227), [228](https://zips.z.cash/zip-0228), [220](https://zips.z.cash/zip-0220) |
| Confidential Intents | Separate documented provider capability, NOT TESTED | Not requested by this adapter and not grounds to strengthen its privacy classification. [Provider documentation](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps) |
| Stable-value shielded reserve / private performance proof | RESEARCH | No production stablecoin or new cryptography built. |

Zodl's public iOS implementation uses the private Unified Address in its swap flow. Source reviewed at commit `7cb54efd696bf78a3a135a4d50d52ad80c33ee94`: [SwapAndPayStore](https://github.com/zodl-inc/zodl-ios/blob/7cb54efd696bf78a3a135a4d50d52ad80c33ee94/secant/Sources/Features/SwapAndPayForm/SwapAndPayStore.swift), [Near1Click](https://github.com/zodl-inc/zodl-ios/blob/7cb54efd696bf78a3a135a4d50d52ad80c33ee94/secant/Sources/Dependencies/SwapAndPay/sources/Near1Click.swift). No private partner keys were used. Generic NEAR chain-support text describing transparent Zcash addresses conflicts with the accepted shielded-UA quote behavior; do not generalize the quote result to every bridge path.

## Empirical results

Verified run: `2026-09-07T03-10-09.261Z-eddcc403`, completed `2026-09-07T03:13:43.165Z`.

Seven sizes: $25, $100, $500, $1,000, $5,000, $10,000, $50,000. Nine deployment destinations and five reverse routes = 98 primary matrix records. Three comparison legs at each size add 21 records; two $500 fixed-output Send probes add two. Total **121 records; 107 actual provider requests; 105 successful signed quotes**, 14 unsupported Robinhood combinations and two provider rejections. This is a 98.1% success snapshot for attempted requests, not an uptime or settlement-success measurement.

$50,000 ZEC→Base ETH and ZEC→Avalanche USDC were rejected. The provider did not supply a usable global size-limit contract; these failures do not establish permanent maxima. Robinhood stable value is absent from the observed supported catalog. All seven Hyperliquid funding quotes and both Send probes succeeded.

Across all successful requests, median quote latency was **3,204 ms**, provider settlement estimate **452 sec**, and marked friction **0.1381%**. That mixed-purpose median is not a fee schedule. The route table below uses only primary matrix rows so repeated comparison/Send requests do not bias route medians.

| Route | Successful / tested | Median marked friction | Median quote latency | Provider settlement estimate |
|---|---:|---:|---:|---:|
| zec->solana_usdc | 7 / 7 | 0.0984% | 3221 ms | 452 sec |
| zec->solana_sol | 7 / 7 | 0.0000% | 3200 ms | 452 sec |
| zec->base_eth | 6 / 7 | 0.0144% | 3184 ms | 457 sec |
| zec->robinhood_usdc | 0 / 7 | Unavailable | — | — |
| zec->base_usdc | 7 / 7 | 0.0120% | 3196 ms | 457 sec |
| zec->arbitrum_usdc | 7 / 7 | 0.0008% | 3198 ms | 454 sec |
| zec->ethereum_usdc | 7 / 7 | 0.1174% | 3183 ms | 462 sec |
| zec->hyperliquid_usdc | 7 / 7 | 0.0920% | 3210 ms | 465 sec |
| zec->avalanche_usdc | 6 / 7 | 0.0000% | 3256 ms | 458 sec |
| base_usdc->zec | 7 / 7 | 0.5643% | 3210 ms | 150 sec |
| robinhood_usdc->zec | 0 / 7 | Unavailable | — | — |
| solana_usdc->zec | 7 / 7 | 0.4648% | 3265 ms | 135 sec |
| ethereum_usdc->zec | 7 / 7 | 0.4942% | 3180 ms | 160 sec |
| arbitrum_usdc->zec | 7 / 7 | 0.5155% | 3189 ms | 140 sec |


Some marked friction values are zero or negative because provider input/output USD marks differ or move. They do not prove zero network/provider fees or a guaranteed arbitrage. ZEC price movement materially changed the first and final research passes.

### Standard versus reserve round-trip economics

For the same approximate $5,000 economic goal, Base USDC→Solana USDC quoted **4,995.129877 USDC**, marked friction **0.1139%**, provider time **32 sec**. Base USDC→shielded-recipient ZEC→Solana USDC quoted **4,975.429102 USDC**, marked friction **0.5079%**, combined provider estimates **602 sec**.

The two legs are independently quoted, not atomic. Leg two uses leg one's expected output, not its guaranteed minimum; there is no locked combined quote. An actual external wallet may require an additional incoming-fund spendability wait, approximately 10 blocks / 750 seconds under the documented wallet policy. Whether provider estimates already include part of that wait is unresolved. Do not promise a fixed end-to-end time. At $25, the corresponding marked frictions were 1.2350% direct and 2.8741% through the two-leg reserve path.

[Zodl spendability guidance](https://support.zodl.com/article/35-when-are-funds-spendable) describes approximately 75-second blocks, ten confirmations for incoming funds and three for change. These are wallet policy/estimates, not irreversible finality guarantees.

### Fees and quote lifetime

- The experiment requests no Raven fee. The 1% native execution fee, Pro 30% cashback, Copy pricing and Hyperliquid economics are unchanged.
- Scenario rates 0/10/25/50/100 bps are hypothetical, separately labelled and require requoting before any future real use. No production reserve fee was chosen.
- Observed anonymous responses included a **10 bps provider-injected app fee**. The public authentication guidance described 20 bps. Resolve this discrepancy commercially before relying on margins. [Authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication), [fee configuration](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config).
- Record output-denominated withdrawal fees and source-denominated refund fees; do not add them again to an already net receive amount. Solver fee, network breakdown, FX spread and privacy premium are unknown rather than invented.
- Dry quotes return no executable deposit address/reservation expiry. Raven records a local 30-second research freshness limit, distinct from a provider commitment.

## Exact privacy boundary

**Strongest proven end-to-end classification in this spike: UNKNOWN.** The quote supports a conditional shielded-source or shielded-destination path, but Raven did not witness a shielded spend or receipt. An actual verified shielded spend could support SHIELDED_SOURCE; neither REDUCED_LINKABILITY nor STRONG_SHIELDED is established here.

| Fact | Current evidence |
|---|---|
| Reserve asset | ZEC; USD-equivalent valuation changes with ZEC and USDC/USD prices. |
| Source shielded balance | Unknown; no wallet or viewing-key import. |
| Unified Address | Official public test-vector address with Sapling and Orchard receivers and no transparent receiver. A `u1` prefix alone is not proof of shielding. |
| Public intermediate | Zcash deposit/bridge leg remains public; source shielded sender is hidden only if the actual wallet spends from shielded notes. |
| Public destination | Solana/EVM destination address, received asset and subsequent transactions remain public. Hyperliquid account funding remains observable through its venue. |
| Provider visibility | Quote amount, destination/refund information, request time and requester network address. Production server mediation would change the observed IP, not remove Raven's ability to correlate requests. |
| Solver visibility | Amount available; exact recipient exposure to each solver was not proven and remains unknown. |
| Timing / amount correlation | High risk, including distinctive amounts and closely timed cross-chain legs. Anonymity set and unique-amount rarity are unmeasured. |
| Relayer / confidential intent | Not established / not requested. |
| Viewing keys | None ingested. No spend authority inferred from future viewing authority. |
| Final cryptographic receipt | Not observed. Quote signatures authenticate provider responses, not settlement or privacy. |

No address reuse, memo, amount splitting, batching or timing-delay strategy earns an automatic privacy upgrade. Delays of 0/30/120/300 seconds are scenario inputs only; they do not measure an anonymity set. No randomized scheduler, pooled balance, mixer or custody is implemented.

[ZIP 316](https://zips.z.cash/zip-0316) distinguishes receiver composition and viewing-key scopes. Full/incoming/outgoing visibility differs; some scopes reveal amounts, recipients and memos. Do not place identifiers or sensitive metadata in memos by default. [ZIP 315](https://zips.z.cash/zip-0315) is draft best-practice guidance; changing a sharing preference cannot erase a viewing key already copied by an observer.

## Wallet, Portfolio and Copy architecture

Preferred next wallet architecture: **external user-controlled Zcash wallet plus optional local/watch-only analytics**, behind Raven's existing account/asset/venue abstractions. No Raven spend keys, omnibus wallet or pooled reserve. User recovery belongs to the chosen wallet and its recovery material. Native Zcash SDK/lightwalletd infrastructure requires scanning, note-state handling and recovery verification; the older web light-client demo is not a production Raven wallet implementation. [Light-client support](https://zcash.readthedocs.io/en/latest/rtd_pages/lightclient_support.html).

Valuation uses integer zatoshis and micro-USD, explicit USDC/USD conversion and downward rounding. Reserve observations retain ZEC as the underlying asset; they are not fabricated USDC balances. Portfolio compartments preserve existing economic-lot deduplication. Simulation transitions are hash-linked and refuse duplicate transitions and unjustified arrival states. Current transitions move whole lots; partial allocations, transaction-based confirmations and production reconciliation remain beta work. Simulated arrival remains non-executable without real evidence.

Copy assesses public verified working capital separately from reserve backing. A $10,000 allocation with only $2,400 ready cannot meet a $5,000 hot reserve target merely because shielded capital exists. Deployment is unsuitable for sub-second Copy execution. Realized-profit identification and automated sweeps are not implemented; the excess-capital control is only a scenario.

Public Community data is unchanged. No shielded values, wallet identifiers or viewing material are added to profiles. A future private auditor could issue signed performance attestations, but a signature proves who attested, not completeness or absence of omitted losses. ZK performance verification remains research; Raven builds no cryptography here. Protected Execution remains distinct: reduced pre-trade exposure does not make the final public-chain transaction private.

## Provider and failure risks

NEAR lists Zcash under a **proof-of-authority bridge**. Raven being noncustodial does not make the provider's bridge/solver path trustless. Bridge operator, contract, solver availability, compliance screening, quote staleness and unresolved settlement risks remain. [Bridge overview](https://docs.near-intents.org/integration/bridging/overview), [risk/compliance](https://docs.near-intents.org/security-compliance/risk-and-compliance).

Refund support is conditional. Exact fees are retained when returned, but no guaranteed refund deadline, impossible-refund recovery or cross-chain failure recovery was observed. No balance becomes available merely because the source transaction would confirm. Destination failure/delay maps to in-transit or unresolved and requires reconciliation. [Zodl swap status](https://support.zodl.com/article/11-checking-swap-status).

Provider failures, expiry, unsupported assets/chains, invalid signature/identity, stale catalog price, minimum receive, maximum delay/friction, unknown privacy and source-balance uncertainty are covered by guards/tests. Provider health is captured per request (latency, availability, reason, estimates); this is a research dataset, not a production settlement monitor. No alternate provider was quietly used.

## Legal and privacy inventory

Internal counsel review was extended, without publishing new effective customer terms or changing assent:

- Raven's routing role and noncustody characterization; money transmission/MSB analysis appropriate to actual jurisdictions and activity.
- Sanctions, geographic restrictions, provider screening, source-of-funds and recordkeeping; whether any Travel Rule duties apply.
- Bridge/solver contracts, refund liability, disclosures and jurisdiction gating.
- Viewing-key scope and irreversible prior disclosure, identifiers, destination addresses, timing/network metadata and retention/access controls.
- Private payments and possible affiliate payouts need separate policy review. No affiliate ledger or payout architecture is coupled to Zcash.

Ordinary Zcash fees follow the active ZIP-317 action-based model; the conventional minimum is not a universal fixed fee for arbitrary note counts. Pool/upgrade activation, wallet version and supported receivers must be rediscovered before a beta, including current Orchard/Ironwood guidance. [ZIP 317](https://zips.z.cash/zip-0317), [ZIP 258](https://zips.z.cash/zip-0258). The latter's draft status and wallet migration documentation should not be collapsed into an unverified chain-activation claim.

## Rollout and test evidence

All six shielded feature flags default off; live execution remains hard false even if an environment variable says otherwise. Operator opt-in is loopback-only with same-origin and ephemeral request-token checks, bounded inputs and requests, public research fixtures, no-store/CSP protections and no arbitrary destination or secret ingestion. Normal login does not depend on this service. Customer Pro entitlement/routing integration is future rollout work, not simulated by an unauthenticated public route.

Baseline: 109 existing tests passed before changes. Integrated regression run: **191 passed**, spanning Portfolio, Governor, Universal USDC, native fees, Privy, Copy, Pro rewards, Community, identity and the deployed wallet-view adapter. Within this work, 40 Shielded Reserve/server tests cover accounting, precision, guards, privacy, provider normalization, signature handling, feature disable and HTTP boundaries. Desktop/mobile prototype interaction used real signed provider quotes, no horizontal overflow and no console errors. No production transaction test was attempted.

Files: `lib/customer_trade/shielded_{reserve,route_providers,portfolio}.mjs`; existing `lib/agentic_trading/{identity,unified_portfolio}.mjs` and `lib/customer_trade/wallet_copy.mjs`; `scripts/{research,serve}-shielded-reserve.mjs`; `prototypes/shielded-reserve/*`; tests; configuration; pinned SDK dependency; internal counsel/privacy inventory. No migrations. Prototype is not included in customer assets or production routing.

## Before a beta

1. Provider confirmation of shielded recipient/refund support, commercial fee discrepancy, size limits, quote lifetime and exact bridge/solver disclosures.
2. External wallet interface and receiver/pool capability discovery; recovery/export and optional watch-only scope review. Keep viewing-key ingestion off until storage, consent, retention and nonrevocability are addressed.
3. Explicitly authorized tiny external-wallet forward and reverse canaries, including delayed/failed destination and refund reconciliation. No canary is authorized or sent in this spike.
4. Security and counsel review; jurisdiction policy and customer disclosures; signing isolation and bounded user confirmation.
5. Customer Pro-gated Portfolio helper backed by actual private balance/evidence sources, partial-lot accounting and production reconciliation. Keep Community exports private by default and Copy hot-capital rules intact.
6. Broader time-distributed quote/settlement observations. A few minutes of dry responses do not establish reliability or anonymity. Offer ZEC price exposure transparently; wait for actual production shielded stable assets before claiming stable reserve capital.
