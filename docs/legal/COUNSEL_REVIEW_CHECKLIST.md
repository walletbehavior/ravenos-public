# RavenOS counsel review checklist

Status: open; nothing in this file is a legal conclusion
Prepared: 2026-09-05

The review must start from `LEGAL_PRODUCT_INVENTORY.md` and the exact release/configuration proposed for launch. A technical label such as “user-signed,” “embedded,” “noncustodial,” “routing,” “copy,” “agent,” or “paper” does not decide legal classification.

## 1. Contracting entity and basic agreement choices

- [ ] Identify the contracting RavenOS entity, legal name, form, address, notice address, support address, and effective-date authority.
- [ ] Select governing law and forum based on entity and launch geography.
- [ ] Deliberately decide whether to use arbitration, a jury waiver, or class-action waiver. None is selected in the candidate.
- [ ] Review limitation of liability, liability cap, warranty exclusions, indemnification, injunctive relief, survival, assignment, severability, and force-majeure language.
- [ ] Confirm minimum age and implement the corresponding product control. Candidate proposes 18 plus age of majority; the audited flow does not enforce it.
- [ ] Define notice, material-change, and reacceptance standards. Engineering supports the designation; counsel owns the classification.
- [ ] Decide whether current users require migration acceptance and which features remain accessible while acceptance is missing.

## 2. Product classification and registrations

Obtain activity-specific analysis for:

- [ ] transaction preparation, routing, fee collection, and any discretion over route or asset;
- [ ] wallet screening, rankings, Raven Reads, Portfolio Governor, technical signals, alerts, and personalized or account-linked outputs;
- [ ] Mirror, Raven Copy, source selection, policy defaults, sizing, skipped trades, and compensation/conflicts;
- [ ] unattended or delegated signing, session keys, server authorization, and ability to affect user assets;
- [ ] Universal USDC, bridging, solver selection, fee collection, and transfer orchestration;
- [ ] Hyperliquid perpetuals and any commodity, derivatives, CTA/CPO, or exchange-related questions;
- [ ] tokenized equities, securities, options, lending, staking, LP/yield, and geographically restricted instruments;
- [ ] embedded-wallet architecture and any custody, control, fiduciary, bailment, safeguarding, or recovery implications;
- [ ] federal and state money-transmission/MSB questions, including the specific flow of funds and technical control;
- [ ] broker-dealer, investment-adviser, exchange/ATS, securities offering, solicitation, and financial-promotion questions;
- [ ] consumer-protection, unfair/deceptive-practice, gambling/gamification, and suitability/appropriateness issues.

Do not infer an exemption from the software architecture. FinCEN’s virtual-currency guidance is activity-specific and distinguishes users, exchangers, and administrators; counsel should map the exact RavenOS flows to current law and later guidance: <https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering>.

## 3. Eligibility, geography, sanctions, and market access

- [ ] Define launch countries/states and blocked regions per feature, provider, chain, instrument, and customer type.
- [ ] Design a risk-based sanctions program, including restricted persons, wallet/address signals, false positives, escalation, audit, and emergency handling.
- [ ] Confirm whether and when KYC/CIP, identity verification, beneficial-owner checks, source-of-funds checks, or suspicious-activity controls apply.
- [ ] Define controls for VPN/proxy use without making unsupported location guarantees.
- [ ] Confirm venue-specific restrictions for Hyperliquid, 0x routes, Jupiter routes, tokenized equities, Robinhood Chain assets, bridges, and onramps.
- [ ] Preserve withdrawals/export/recovery when permitted; define legally required holds separately from terms assent.

OFAC states that sanctions obligations apply to virtual-currency transactions and recommends a risk-based compliance program: <https://ofac.treasury.gov/recent-actions/20211015>. This checklist does not determine RavenOS’s specific obligations.

## 4. Trading, Copy, agentic, and performance disclosures

- [ ] Validate every fee, venue, asset, chain, and product statement against the exact release.
- [ ] Confirm that “execution available” means a current executable route, not a last price or provider claim.
- [ ] Require separate first-trade risk assent and first-live-Copy assent; review concise modal language and full disclosure.
- [ ] Preserve Historical Reconstruction, Shadow/Simulated, Source, Follower, Paper, and Live labels in legal and visual design.
- [ ] Review copyability methodology, benchmark assumptions, follower-size estimates, survivorship/selection bias, and marketing use.
- [ ] Review ranking and community-board methodology to prevent misleading exceptional-return claims.
- [ ] Define conflict disclosures for Raven fees, routing, provider payments, referral compensation, featured markets, and any future strategy compensation.
- [ ] Decide whether any model output is a recommendation and whether personalization changes the analysis.
- [ ] Review kill/pause/cancel representations: a control cannot reverse an already submitted or settled action.

Investor.gov highlights volatility, illiquidity, fraud, technical failure, lack of protections, and possible total loss in crypto-asset markets: <https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/crypto-asset-securities>. Product copy should remain accurate and not imply regulatory or insurance protections RavenOS has not established.

## 5. Wallets, custody, recovery, and user asset access

- [ ] Independently test and document Privy EVM and Solana creation, signing, export, recovery, provider outage, logout, account recovery, and Raven disappearance scenarios.
- [ ] Determine who can cause signatures under each configuration and whether Raven or a service provider can alter policies.
- [ ] Review Privy dashboard settings, allowed origins, key-quorum/recovery model, terms, DPA, subprocessor list, incident allocation, and termination/export plan.
- [ ] Ensure the UI does not promise “Raven never has control” or “no custody” without approved technical/legal support.
- [ ] Preserve a user-facing withdrawal/export/recovery path independent of Pro, Copy, or acceptance of updated trading terms.
- [ ] Define treatment of security holds, sanctions holds, account compromise, deceased/incapacitated users, and disputed control.
- [ ] For external wallets, disclose approvals, extension risk, lost keys, wrong networks, phishing, and the fact that disconnecting does not revoke onchain approvals.

Privy currently documents export flows for EVM and Solana embedded wallets, with important distinctions for server-created and smart wallets: <https://docs.privy.io/wallets/wallets/export>. RavenOS must test its own configuration rather than repeat general provider claims.

## 6. Fees, Raven Pro, billing, cancellation, and taxes

- [ ] Confirm the legal entity receiving Raven execution fees and the fee recipient for every chain.
- [ ] Review standard 100 bps, Pro 70 bps, Hyperliquid instrument-specific caps, fee token/side, refunds/reversals, partial fills, and failed transactions.
- [ ] Verify the confirmation and receipt separately display Raven, network, venue/protocol, bridge/solver, spread, slippage, price impact, gas, and funding where available.
- [ ] Finalize Raven Pro price, billing period, automatic renewal, tax, trial/promotion, proration, failed payment, cancellation effective date, refund policy, and support flow.
- [ ] Provide a simple cancellation mechanism before checkout is activated.
- [ ] Determine tax reporting and accounting for subscriptions, execution fees, referral compensation, and any onchain fee assets.

The FTC’s negative-option rule status and applicable federal/state subscription laws should be rechecked at launch; do not rely on a stale “click-to-cancel” summary. Current FTC rule materials: <https://www.ftc.gov/legal-library/browse/rules/negative-option-rule>.

## 7. Affiliates, referrals, endorsements, and community

- [ ] Define affiliate economics, eligible subscription event, attribution window/model, hold period, reversals, minimum payout, method, currency, tax forms, disputes, and termination.
- [ ] Keep the current uncompensated attribution record distinct from an earned commission.
- [ ] Provide required clear and conspicuous material-connection disclosures in product examples and affiliate guidance.
- [ ] Prohibit performance promises, misleading testimonials, fake reviews, spam, cookie stuffing, account farms, self-referral, and restricted-region targeting.
- [ ] Establish monitoring and enforcement proportional to the program.
- [ ] Complete Community report, urgent escalation, moderation, notice, evidence preservation, and appeal processes before open text publishing.
- [ ] Review public profile, wallet verification, username, publicity, defamation, impersonation, and user-content-license provisions.

FTC materials explain that compensated promoters should disclose material connections clearly and conspicuously: <https://www.ftc.gov/news-events/topics/truth-advertising/advertisement-endorsements> and <https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers>.

## 8. Privacy, data governance, and security

- [ ] Identify the controller/business and all processors/service providers in the exact production configuration.
- [ ] Map categories, purposes, legal bases where applicable, sources, recipients, international transfers, sale/sharing/targeted advertising, sensitive data, and automated decision-making.
- [ ] Determine whether public-wallet profiling is personal data under launch-region law and how rights apply to derived evidence.
- [ ] Define retention by table/category: account, auth state, session, security, legal acceptance, public profile, wallet link, execution, Copy, billing, referral, provider evidence, cache, log, backup.
- [ ] Build self-service deletion or a reviewed request workflow; document exceptions and backup aging.
- [ ] Define access/correction/deletion/portability/objection/restriction/appeal and identity-verification processes by region.
- [ ] Review cookie/local-storage inventory. A banner is not proposed while only strictly functional storage exists; reassess before non-essential analytics or advertising.
- [ ] Complete incident response, breach notification, vendor security review, least privilege, secrets management, log redaction, and tenant-isolation testing.
- [ ] Review cross-border transfers and provider DPAs.

## 9. Third-party contracts and data rights

- [ ] Confirm commercial, caching, display, attribution, derivative-data, retention, and termination rights for each market/data provider.
- [ ] Review WorkOS, Cloudflare, Privy, Stripe, Jupiter, 0x, Hyperliquid, Dexch, RPC/index providers, LI.FI/bridge providers, and any wallet-connect provider terms.
- [ ] Verify that Raven fees are permitted and technically reflected by the relevant provider response.
- [ ] Confirm that provider logos, names, links, and token metadata may be displayed as implemented.
- [ ] Establish replacement/degradation behavior so an enrichment outage does not become undisclosed execution failure.

## 10. Launch sign-off evidence

- [ ] Counsel-approved immutable HTML for every effective document.
- [ ] Exact SHA-256 values in registry and seed migration.
- [ ] Contracting entity, contacts, effective time, and approved dispute terms present.
- [ ] Database migration applied and backed up.
- [ ] Both activation flags deliberately set only after approval.
- [ ] Signup rejects unchecked/missing/changed assent server-side.
- [ ] Existing sign-in remains available.
- [ ] First live trade and first live Copy require their current contextual disclosures.
- [ ] Public-profile exposure increases require Community Guidelines; privacy reductions remain allowed.
- [ ] Affiliate enrollment requires the effective Affiliate Terms; ordinary referral attribution remains accurately described.
- [ ] Material reacceptance works without blocking account access or supported withdrawal/export/recovery.
- [ ] Evidence export can show user, document type, version, hash, accepted time, and method without unnecessary IP collection.
- [ ] Full security, migration, browser, accessibility, and release identity checks pass.

The candidate package should not be promoted merely because engineering tests pass. Qualified counsel and an accountable RavenOS owner must separately approve the exact content and launch configuration.
