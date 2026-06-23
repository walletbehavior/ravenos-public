# RavenOS Product Audit

Date: 2026-06-23

Scope: RavenOS public product surfaces including Terminal, Research / Structure Lab, Perps, Atlas, Alerts, Watchlists, Pricing, Account / Upgrade, chart overlays, access controls, explanation/replay/participant modules, coverage/confidence systems, and the in-progress Degen discovery surface.

Objective: prepare RavenOS for first paying customers by making the product answer four questions within 60 seconds:

- What is happening?
- Why is it happening?
- How confident is Raven?
- What changed?

## Executive Read

RavenOS now has strong product ingredients, but the experience still reads like several feature builds stitched together. The strongest product center is the Terminal plus Structure Lab plus Perps Intelligence loop: current structure, explanation, replay, and research. The weakest areas are information hierarchy, repeated controls, inconsistent page headers, and technical infrastructure language leaking into user-facing pages.

The recommended product direction is not more modules. It is one coherent workflow:

1. Search or choose an instrument.
2. See current structure in one chart and one summary.
3. Understand why through explanation, replay, and participants.
4. Save or monitor through watchlists and alerts.
5. Review what Raven learned in Research.
6. Use Atlas for broader regime context.

## Critical Issues

### 1. No Single Product Frame Across Pages

Problem: Terminal, Research, Perps, Atlas, Alerts, Watchlists, Pricing, and Degen use different header layouts, navigation order, button styles, and account/access placement. The Terminal header was improved, but other pages still have older local nav patterns.

Affected pages: Terminal, Research, Perps, Atlas, Alerts, Watchlists, Pricing, Account, Upgrade, Degen.

Recommended fix: create one shared product shell pattern for all app pages:

- Global nav: Terminal, Research, Perps, Atlas, Alerts, Watchlists
- Workspace context: search/current instrument/coverage/confidence/updated
- Account/access: Wallet, Account, Upgrade

Expected user impact: users stop re-learning navigation on every page and can move through RavenOS like one system.

### 2. Two Search Concepts Compete In Terminal

Problem: Terminal now has one global Dexscreener lookup, but the market table still has a second search field for filtering rows. This is useful, but visually it reads as another token search. First-time users may not know which search changes the chart and which only filters a table.

Affected pages: Terminal.

Recommended fix: rename table filtering to "Filter visible rows" and visually subordinate it. Keep only the global search in the workspace header for instrument lookup.

Expected user impact: users can find any token/contract quickly without confusion.

### 3. High-Value Reads Are Buried Below Controls

Problem: Explanation, replay outcomes, participant intelligence, and perps conditions are valuable, but they sit below score rows, CTAs, access status, and sometimes locked preview panels. The product's best "why" content is not always visible in the first screen.

Affected pages: Terminal, Perps, Research, Watchlists, Alerts.

Recommended fix: promote a compact "Raven Read" block near the top of each core page with:

- Current read
- Why
- Confidence
- What changed

Expected user impact: first-time users understand RavenOS faster and perceive it as intelligence, not just dashboards.

### 4. Coverage Language Is Still Inconsistent

Problem: The system has universal coverage contracts, but UI labels vary between Live, Public, Sample, Preview, Limited coverage, Coverage developing, delayed context, and API unavailable. Some pages still expose technical status as product copy.

Affected pages: Terminal, Atlas, Alerts, Watchlists, Degen, Pricing copy indirectly.

Recommended fix: standardize product-facing coverage labels:

- Live context
- Indexed context
- Public context
- Delayed context
- Limited context
- Sample context
- Unavailable

Keep raw provider state in developer mode or tooltips only.

Expected user impact: users know how much to trust the view without seeing infrastructure details.

## High Issues

### 5. Score Naming Changes By Page

Problem: Flow Score, Pressure Score, Replay Similarity, Fresh Survival, Attention Velocity, Participation, Liquidity Attraction, Risk Rating, and Confidence all appear, but the hierarchy is not consistent. Some pages lead with Flow, others with Pressure, others with research metrics.

Affected pages: Terminal, Perps, Research, Degen, Alerts, Watchlists.

Recommended fix: define a score hierarchy:

- Primary state score: Flow, Pressure, Survival, or Regime depending on module
- Explanation drivers: participation, liquidity, attention, replay
- Trust layer: confidence and coverage

Expected user impact: users understand which metric is the headline and which metrics explain it.

### 6. Chart Overlays Are Improved But Need One Legend Contract

Problem: The chart refactor reduced persistent labels, but legend behavior and overlay identities need to be shared across all chart-using pages. Perps, Degen, and Atlas should use the same control grammar.

Affected pages: Terminal, Perps, future Degen chart surfaces, future Atlas chart surfaces.

Recommended fix: make overlay legend categories first-class:

- Perps: Pressure, Liquidity Attraction, Replay
- Degen: Survival, Attention, Participation, Replay
- Atlas: Regime, Breadth, Liquidity

Expected user impact: users can identify market state in seconds without reading every overlay.

### 7. Research Still Has Too Much Table Gravity

Problem: Structure Lab has been improved into findings, but the data table remains the dominant interaction. It still exposes research rows and developer metrics in ways that feel more internal than customer-facing.

Affected pages: Research / Structure Lab.

Recommended fix: make report cards the default view and move raw tables behind "Details" or developer mode. Lead with Key Findings, What Worked, What Failed, Highest Confidence, and What Changed.

Expected user impact: Research feels like Raven learned something, not like a CSV viewer.

### 8. Perps Intelligence Needs A Clearer Flagship Flow

Problem: Perps has the right modules, but the page should tell one story: pressure, source, replay, outcome conditions, and forward paper status. Candidate lanes and research details can distract from the current read.

Affected pages: Perps, Terminal perps mode, Research.

Recommended fix: structure Perps as:

1. Current pressure state
2. What is driving it
3. Replay context
4. Conditions improving/weakening
5. Research status and paper tracking

Expected user impact: perps becomes a differentiated product instead of another multi-panel analytics page.

### 9. Access And Upgrade Messaging Appears In Too Many Places

Problem: Wallet, Upgrade, pricing, locked previews, Pro/Founder/Atlas mentions, and token-holder access appear across the product. The access model is valid, but it can feel noisy.

Affected pages: Terminal, Atlas, Pricing, Upgrade, Account, Alerts, Watchlists, Research.

Recommended fix: centralize access messaging in Account/Access controls and use compact locked previews inside modules. Avoid repeating wallet/token/subscription copy in every panel.

Expected user impact: users see product value before paywall mechanics.

## Medium Issues

### 10. Degen Discovery Is Valuable But Not Yet Product-Integrated

Problem: Degen Terminal v2 exists locally as a behavioral discovery surface, but it is not fully registered, tested, committed, or integrated into navigation and feature registry. It also uses its own header pattern.

Affected pages: Degen, Terminal, Pricing, feature registry.

Recommended fix: either finish Degen as a Pro crypto-discovery module under Terminal/Research, or keep it hidden until it matches the product shell and feature-gating model.

Expected user impact: avoids exposing a promising but isolated experience.

### 11. Table Columns Are Dense But Not Prioritized

Problem: Many tables show instrument, market, price, flow, attention, participant, liquidity, risk, coverage, updated, and actions. Density is appropriate, but priority is unclear on smaller screens.

Affected pages: Terminal, Watchlists, Degen, Research, Perps.

Recommended fix: create table column presets:

- Compact: Instrument, State, Confidence, Coverage
- Standard: add Flow/Pressure, Replay, Risk
- Full: all diagnostics

Expected user impact: mobile and mid-size screens become usable without removing features.

### 12. Confidence Is Not Always Visible Where Decisions Are Made

Problem: Confidence exists in the model and explanation components, but not every score or page presents it adjacent to the key read.

Affected pages: Terminal, Watchlists, Alerts, Degen, Perps, Atlas.

Recommended fix: pair every primary read with a compact confidence badge: Low, Developing, Moderate, High.

Expected user impact: users know whether Raven is showing a strong read or a developing read.

### 13. "What Changed" Is Underdeveloped

Problem: Structure Tape exists, alerts exist, and explanations exist, but the product does not consistently answer "what changed since the last update" or "since my last visit."

Affected pages: Terminal, Alerts, Watchlists, Research, future My Raven.

Recommended fix: add a small "Changed" field to the Raven Read model and reuse it across pages.

Expected user impact: RavenOS feels alive and useful between sessions.

### 14. Atlas Feels Like A Separate Product But Needs Better Boundaries

Problem: Atlas is correctly positioned as high-tier context, but it still shares visual and copy patterns with standard app pages. It needs a calmer executive-regime format.

Affected pages: Atlas, Pricing, Account.

Recommended fix: make Atlas use a regime memo layout: Market Regime, Liquidity Conditions, Breadth Quality, Volatility Environment, Cross-Market Posture. Keep diagnostics collapsed.

Expected user impact: Atlas feels worth a separate premium tier.

## Low Issues

### 15. Some Copy Still Uses Internal Module Names

Problem: Names like candidate lanes, setup families, and paper tracking are useful internally but can feel procedural to a new customer.

Affected pages: Research, Perps, Pricing.

Recommended fix: translate internal terms:

- Candidate lanes -> developing structures
- Setup families -> structure families
- Paper tracking -> forward research tracking

Expected user impact: product feels more polished without losing rigor.

### 16. Legal/Safety Copy Is Repeated But Not Standardized

Problem: Multiple pages include safety language with slight differences.

Affected pages: Terminal, Research, Watchlists, Degen, Pricing, Atlas.

Recommended fix: use one shared legal footer string across all pages.

Expected user impact: less copy noise and more professional consistency.

### 17. Pricing Mentions Many Features Without Showing The Product Loop

Problem: Pricing lists the feature set but could better explain the actual workflow RavenOS unlocks.

Affected pages: Pricing, Upgrade, Pro.

Recommended fix: frame pricing around product outcomes:

- Explore markets
- Understand structure
- Monitor changes
- Research outcomes
- Review regime context

Expected user impact: paid plans feel coherent and easier to justify.

### 18. Developer Mode Is Useful But Not Discoverable

Problem: Developer mode hides raw metrics in Research/Atlas, but there is no consistent indication that diagnostics exist for operators.

Affected pages: Research, Atlas.

Recommended fix: add a small diagnostics affordance for authenticated/internal users only.

Expected user impact: power users retain access without confusing normal users.

## Recommended Cleanup Sequence

1. Product shell unification across app pages.
2. One Raven Read model across Terminal, Perps, Research, Watchlists, Alerts, Atlas.
3. Coverage/confidence naming cleanup.
4. Terminal search/filter distinction.
5. Structure Lab report-first layout.
6. Perps flagship flow polish.
7. Finish or hide Degen until it uses the shared shell.
8. Mobile table density presets.
9. Pricing/upgrade copy alignment.

## Product Standard Going Forward

Every RavenOS module should answer:

- Current state: what is happening?
- Explanation: why is it happening?
- Confidence: how much should I trust it?
- Change: what changed?
- Coverage: what kind of data supports it?
- Action surface: save, monitor, research, or upgrade.

Avoid adding new pages until the existing pages follow this contract.
