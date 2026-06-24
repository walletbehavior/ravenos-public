# RavenOS Public Methodology

Last updated: June 2026

RavenOS is a market intelligence platform built around structure, pressure, replay, participation, rotation, and market context. This document explains the public-safe methodology language used across RavenOS without exposing proprietary model weights, private data sources, wallet identities, trading rules, or execution systems.

## Public Read Loop

RavenOS pages are organized around a simple loop:

1. What is happening?
2. Why does Raven believe it?
3. How fresh is the read?
4. How much evidence supports it?
5. What would weaken the read?

The product should not ask users to trust a score without context. Major reads should include freshness, coverage, confidence, evidence, and caveats.

## Core Concepts

## Public Evidence Contract

Every major public read should declare the same evidence fields:

- **Evidence role:** current synthesis, leading read, settled validation, historical analogue, market memory, behavior context, research validation, or live market context.
- **As of:** the public timestamp attached to the read.
- **Observation window:** the period Raven used to form the read.
- **Settlement window:** the later period used to evaluate whether an earlier public read was confirmed, mixed, invalidated, or still insufficient.
- **Population:** the public market group being summarized, such as a chain, cap band, perps venue, or aggregate cohort.
- **Sample:** observed, usable, settled, and excluded counts with a declared unit.
- **Weighting:** public-safe description of how rows are summarized. The default public label is equal row unless stated otherwise.
- **Freshness:** whether the read is live, fresh, stale, degraded, or using the last verified public artifact.
- **Source category:** public product language such as Live market feeds, Verified Raven feed, or Historical Raven artifact.

Opportunity is a leading structural read. Outcomes is lagging settled validation. Those pages can differ without contradiction when they use different windows, populations, or evidence stages.

## Public Metric Definitions

### Rewarding

A settled public observation whose measured followthrough cleared the public outcome threshold within its declared settlement window.

Unit: cohorts, observations, or structures as declared by the evidence contract.

Denominator: settled usable observations in the same population and window.

Caveat: rewarding describes prior observed behavior. It is not a forecast or performance guarantee.

### Punishing

A settled public observation whose measured followthrough weakened beyond the public outcome threshold within its declared settlement window.

Unit: cohorts, observations, or structures as declared by the evidence contract.

Denominator: settled usable observations in the same population and window.

Caveat: punishing evidence is retained publicly and is not removed from the proof rail.

### Mixed

A settled or observed public row that does not cleanly classify as rewarding or punishing, or where positive and negative evidence remain balanced.

Unit: rows, cohorts, structures, or records as declared.

Caveat: mixed is a valid research result, not an error state.

### Observed

A public-safe row Raven recorded during an observation window.

Unit: markets, observations, cohorts, structures, or records.

Denominator: all rows in the declared population before usability filters.

### Usable

An observed row with enough public context for the current page to summarize it.

Unit: same as the page sample unit.

Caveat: usable does not mean confirmed.

### Excluded

Observed rows not used in a specific public summary because they lacked enough public-safe context, fell outside the declared population, or were not compatible with the page window.

### Clean

A usable row with sufficient public context to support aggregate validation.

Caveat: clean does not imply favorable.

### Settled

An earlier public observation whose declared validation window has elapsed and can be classified as confirmed, mixed, invalidated, or insufficient.

### Pending

A public claim or observation whose validation window has not elapsed.

### MFE

Maximum favorable excursion. Public RavenOS usage describes the largest favorable movement observed after a public observation window.

Unit: percent where displayed.

Caveat: MFE is descriptive research and does not account for whether a user entered, exited, or could have captured the movement.

### MAE

Maximum adverse excursion. Public RavenOS usage describes the largest adverse movement observed after a public observation window.

Unit: percent where displayed.

### Breadth

How widely activity or participation is distributed across the declared market population.

### Concentration

How much activity is clustered in a narrow set of assets, cohorts, venues, or structures.

### Survival

Whether activity, liquidity, or participation persists beyond the initial observation window.

### Followthrough

What happened after Raven recorded the public observation, measured within the declared settlement window.

### Replay Similarity

How closely a current structure resembles prior public-safe structures using descriptive features such as participation breadth, pressure context, survival, liquidity posture, chain/cap context, and outcome persistence.

### Opportunity Score

A public-facing summary of current leading structure quality. It can include participation, breadth, pressure, survival, replay context, liquidity posture, and outcome quality. RavenOS does not publish proprietary weights.

### Sample Forming

The public read exists, but sample depth, freshness, or settlement is not yet strong enough for a higher-confidence label.

### Current Synthesis

A page-level read combining current leading context and the latest available validation context.

### Leading Read

A current structural observation that may become useful but is not yet settled.

### Settled Validation

Lagging proof-rail evidence showing what happened after prior public observations.

### Historical Analogue

Replay or memory context based on prior observed structures. It describes precedent, not prediction.

### Structure Proxy

A chart or visualization that represents Raven structure context when provider-backed market candles are unavailable. Structure proxy views must not be labeled as live market price.

### Structure

Structure describes the condition of a market. Examples include participation broadening, participation narrowing, pressure building, liquidity deteriorating, reward persistence improving, or confirmation weakening.

Structure is descriptive context. It is not a buy or sell recommendation.

### Participation

Participation describes how activity is distributed across a market, chain, cap band, instrument group, or cohort. RavenOS uses public-safe language such as breadth, returning participation, new participation, concentration, and followthrough.

RavenOS does not expose private participant identifiers, wallet addresses, or private cohort labels.

### Pressure

Pressure describes how market forces are building or fading. Public pressure reads can include funding/OI context for perps, liquidity posture, volume context, positioning pressure, and participant alignment.

Pressure is one input into market context. It is not a trade signal.

### Replay

Replay asks: “Have we seen this before?”

RavenOS compares current structures against prior public-safe market tapes using features such as participation breadth, pressure alignment, reward persistence, liquidity posture, chain/cap context, survival, and confirmation depth.

Replay outputs are descriptive historical context. Historical similarity does not guarantee future outcomes.

### Outcomes

Outcome pages summarize what has recently been rewarding, punishing, mixed, or too thin to judge across public aggregate structures.

Outcome labels describe observed historical behavior. They are not forecasts and do not imply future performance.

## Score Transparency

Every major score should be explainable with:

- Top positive contributors
- Top negative contributors
- Confidence label
- Sample depth
- Freshness
- What would confirm the read
- What would weaken the read

RavenOS does not publish proprietary weights. Public explanations are intended to make the read understandable without exposing private model internals.

## Confidence

User-facing confidence labels:

- Low
- Developing
- Moderate
- High

Confidence can consider sample depth, data freshness, coverage quality, replay quality, confirmation depth, and outcome history. Confidence is not certainty.

## Coverage

User-facing coverage labels:

- Limited
- Developing
- Indexed
- Deep Raven
- Active

Coverage describes research depth and data availability. It does not imply accuracy, certainty, profitability, or investment merit.

Developer and infrastructure states are intentionally translated into product language on public pages. Raw provider or artifact status belongs in diagnostics, not primary user copy.

## Data Freshness

The public site is designed as a static frontend shell with live public-safe JSON endpoints:

- Terminal / structure tape: roughly 15-60 seconds where live public providers are available
- Opportunity: roughly 60-120 seconds
- Brief: roughly 5-15 minutes when source artifacts are current
- Replay / Memory / Outcomes / Behavior: artifact freshness based

If an artifact is stale or unavailable, RavenOS should keep the last verified public artifact and label the read clearly rather than blanking the page or pretending stale data is live.

## Public-Safe Boundaries

RavenOS public artifacts must not expose:

- Private wallet data
- Private participant identifiers
- Token targets
- Raw trade intent
- Execution internals
- Private operational credentials or financial operations data
- Private runtime artifacts
- Proprietary model weights

Allowed public language includes:

- Participation breadth
- Pressure alignment
- Reward persistence
- Survival
- Replay similarity
- Confidence
- Sample depth
- Chain
- Cap band
- Structure
- Outcome

## User Responsibility

RavenOS provides research, analytics, market context, and software. It does not provide investment advice, brokerage, custody, investment management, trade execution, buy recommendations, or sell recommendations.
