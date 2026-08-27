# RavenOS Discover Radar v1

## Product boundary

Discover Radar is read-only Raven product intelligence. It is not customer portfolio state, an execution system, a calibrated probability model, or a source of customer-specific investment objectives.

The browser renders and filters a versioned public-safe projection. It does not create Raven evidence, lifecycle states, Velocity scores, Activity scores, or risk classifications.

## Runtime ownership and flow

```text
bounded public-safe market inputs
  -> Raven runtime exact-market registry
  -> append-only observations and events
  -> versioned server classifier
  -> bounded public-safe Discover projection
  -> Worker validation and exact-identity join
  -> Discover rendering and filters
```

The registry is owned by the Raven runtime and uses its own SQLite database. It is not stored in customer identity, Saved Monitor, Portfolio Governor, or alert tables. Customer saved-market ownership and read cursors remain on the authenticated `app.ravenos.xyz` boundary.

## Exact identity

The registry key is the canonical exact-market `instrument_id`, including chain and pool address. Symbol and token name are display fields only. Identically named tokens and pools never merge, and a market that leaves a provider trending feed is retained under its original identity until the bounded retention policy expires.

## State dimensions

The public market contract keeps these dimensions separate:

- `migration_cohort`
- `primary_behavior_state`
- `risk_flags`
- `raven_evidence_state`
- `velocity_state`
- `activity_state`
- `asset_taxonomy`
- `opportunity_lane`
- `sample_evidence`
- `ranking`

Only the primary behavioral state is mutually exclusive. Independently evidenced risk flags can coexist. A provider rank or Velocity score can never create a Raven signal.

## Cold start and hysteresis

The first real observation starts history. It does not backfill a synthetic series. Until at least two stored observations and the required rolling windows exist, acceleration and ranking availability remain `insufficient_history`, lifecycle remains forming, and missing fields remain unavailable.

Primary-state changes require two consecutive qualified observations, except an exact availability failure. Classifier version changes create a separate `classifier_rebaseline` event, suppress market-transition notifications, and preserve the old/new version distinction.

The v1 classifier runs internally in shadow evaluation while the public contract reports a forming state. It is not Monitor-eligible. Monitor evaluation and external notifications remain disabled until transition volume, provider load, same-symbol isolation, and notification-storm simulations are reviewed.

The registry distinguishes a high observed since Raven admission from an independently qualified all-time high. A cold-start observed high never creates an ATH label; ATH distance remains unavailable until qualified market history supports it.

## Scores

Velocity and Flow quality are ranking scores on a 0–99 scale. They are not Raven confidence, win probability, calibrated alpha, expected return, or proof Raven selected a market.

Every score carries its kind, value, scale, grade, classifier version, observation time, freshness, availability, supported components, penalties, and any score cap. A missing or insufficient score is displayed as unavailable, never zero. Letter grades appear only in expanded evidence.

Cross-cohort ordering remains server-derived. It combines behavioral strength with explicit sample maturity, evidence coverage, novelty, persistence, qualified exact-route usability, and risk penalties. Pool liquidity alone is not relabeled as route capacity, and absolute volume is never a tie-breaker. A strong move from a fragile four-transaction sample remains visibly fragile rather than being presented with the authority of a robust observation set.

The default Opportunities lane removes known or reference-like majors, wrapped majors, stable assets, staking assets, and tokenized assets from the primary speculative queue. Those markets remain available under Majors, asset-class filters, Everything, and universal exact-market search. Unknown assets remain `speculative_or_unclassified`; RavenOS does not assert that every unknown token is a meme.

## Candidate admission and retention

Admissions are deterministic and versioned. Supported lanes include Raven observations, bounded saved/monitored exact-market admissions, short-window anomalies, qualified migration evidence, breakout/continuation, pullback/absorption, capitulation/resurrection, renewed mature-market activity, and recently removed provider candidates.

Provider trending is an input, not the registry. Pool age is a cohort feature, not an eligibility veto. Broad scans are bounded to five supported chains—Solana, Robinhood Chain, Base, BNB Chain, and Ethereum—and three windows, with a fixed call budget, timeout, circuit breaker, cooldown, candidate ceiling, and retention policy.

## Future-sealed evidence

The registry stores the actual first-seen observation, append-only observations, candidate admission, classifier rebaselines, confirmed state transitions, and matured 1m/5m/15m/1h/4h/24h/7d checkpoint events. A checkpoint is sealed only after a real observation exists at or beyond its declared horizon.

Checkpoint evidence records mark-based endpoint return, MFE, MAE, liquidity change/loss, survival state, and explicit route/slippage/friction availability. Exact-route economics remain unavailable until a qualified route quote exists; mark values are never relabeled as executable values. Population removal tests and outlier-dependence checks remain pending until sufficient forward evidence exists.

## Bundle and control intelligence

Bundle, developer, insider, sniper, holder, and liquidity-control facts require an explicit reviewed provider/product display policy. Backend access, authentication, or payment does not create display rights. Raw observations remain private. Missing or unqualified facts are published as unavailable, never zero.

No qualified customer-display bundle/control feed is activated in v1, so these fields intentionally remain unavailable in production until separately reviewed.

## Public language

Provider-specific acquisition lanes are internal provenance. Public pages use behavioral language such as Velocity, activity acceleration, high-velocity tokens, accumulation, absorption, divergence, distribution, and lifecycle state. Internal labels such as `Jupiter velocity` must not appear in user-visible copy.

## Safety

The projection contains no wallet data, customer identity, provider credentials, raw provider payloads, private participant identities, plan prices, orders, signing material, or execution data. Discover remains research-only and preserves exact-pool Terminal handoff, evidence freshness, explicit limitations, and unavailable states.
