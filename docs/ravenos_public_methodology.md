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
