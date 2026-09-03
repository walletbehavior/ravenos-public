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

The registry key is the canonical exact-market `instrument_id`, including chain and pool address. Symbol and token name are display fields only. Exact markets never merge in evidence or storage. The customer list selects one best current exact pool per canonical chain/token so the same token is not repeated; its Terminal handoff still carries the selected pool identity. A market that leaves a provider trending feed is retained under its original identity until the bounded retention policy expires.

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
- `notability`
- `sample_evidence`
- `ranking`

Only the primary behavioral state is mutually exclusive. Independently evidenced risk flags can coexist. A provider rank or Velocity score can never create a Raven signal.

## Cold start and hysteresis

The first real observation starts history. It does not backfill a synthetic series. Until at least two stored observations and the required rolling windows exist, acceleration and ranking availability remain `insufficient_history`, lifecycle remains forming, and missing fields remain unavailable.

Primary-state changes require two consecutive qualified observations, except an exact availability failure. Classifier version changes create a separate `classifier_rebaseline` event, suppress market-transition notifications, and preserve the old/new version distinction.

The behavioral lifecycle classifier continues to report a forming evaluation state and is not Monitor-eligible. A separate exact-market Raven observer may publish a bounded current read only after the retained server-side registry has at least two real observations, a developing or robust sample, and an independently qualified material move, participation change, or confirmed lifecycle transition. Provider rank and Velocity score are explicitly excluded from that admission decision. Monitor evaluation and external notifications remain disabled until transition volume, provider load, same-symbol isolation, and notification-storm simulations are reviewed.

The registry distinguishes a high observed since Raven admission from an independently qualified all-time high. A cold-start observed high never creates an ATH label; ATH distance remains unavailable until qualified market history supports it.

## Scores

Velocity and Flow quality are ranking scores on a 0–99 scale. They are not Raven confidence, win probability, calibrated alpha, expected return, or proof Raven selected a market.

Every score carries its kind, value, scale, grade, classifier version, observation time, freshness, availability, supported components, penalties, and any score cap. A missing or insufficient score is displayed as unavailable, never zero. Letter grades appear only in expanded evidence.

Cross-cohort ordering remains server-derived. It combines behavioral strength with explicit sample maturity, evidence coverage, novelty, persistence, qualified exact-route usability, and risk penalties. Pool liquidity alone is not relabeled as route capacity, and absolute volume is never a tie-breaker. A strong move from a fragile four-transaction sample remains visibly fragile rather than being presented with the authority of a robust observation set.

Discover defaults to the full ranked `Everything` view so current markets are visible without first discovering a hidden filter. The optional Opportunities lane is a server-qualified shortlist, not a synonym for every provider input. An exact market qualifies through at least one of: a supported activity-backed move of 5% in 5m, 10% in 1h, or 25% in 24h; a qualified participation or lifecycle transition; or exact Raven evidence. The strongest qualifying window is shown as the row trigger even when another timeframe is selected. Ordinary activity remains visible without being relabeled an opportunity.

Known or reference-like majors, wrapped majors, stable assets, staking assets, and tokenized assets remain outside the primary speculative queue. Those markets remain available under Majors, asset-class filters, Everything, and universal exact-market search. Unknown assets remain `speculative_or_unclassified`; RavenOS does not assert that every unknown token is a meme. Provider rank cannot satisfy notability, and extreme or fragile moves require exact-chart verification instead of being presented as confirmed.

## Candidate admission and retention

Admissions are deterministic and versioned. Supported lanes include Raven observations, bounded saved/monitored exact-market admissions, short-window anomalies, qualified migration evidence, breakout/continuation, pullback/absorption, capitulation/resurrection, renewed mature-market activity, and recently removed provider candidates.

Provider trending is an input, not the registry. Pool age is a cohort feature, not an eligibility veto. Broad scans are bounded to five supported chains—Solana, Robinhood Chain, Base, BNB Chain, and Ethereum—and three windows, with a fixed call budget, timeout, circuit breaker, cooldown, candidate ceiling, and retention policy.

The current discovery pull treats provider page 1 as the required fresh primary set and pages 2–3 as optional supplements. Supplemental rows prioritize meaningful sub-$100K markets and old pools with a low prior activity baseline. Each chain contributes at most 44 exact markets, cached supplemental evidence expires after 90 seconds, and failure of a supplemental page is reported in discovery coverage without discarding a valid primary set.

The `Trading again` scan is classifier version `2026-09-03.2`. It requires a market at least 30 days old, current liquidity, at least three transactions and two observed participants in the current hour (or five transactions where participants are unavailable), no more than 24 transactions in the preceding 23 hours, and at least a four-times increase over that prior hourly rate. A zero-activity prior baseline is retained separately as exact dormancy. The latest five-minute window is disclosed but no longer has to contain the entire revival, and a lone print cannot qualify.

## Continuous publication and health

The lightweight exact-market registry is supervised continuously and publishes on a persistent 12-minute cadence. It is deliberately independent of the heavier aggregate opportunity census, so a delayed census cannot discard a current spot radar or spot Raven read. A missed machine restart is caught by the persistent scheduler rather than waiting for a user request.

`ravenos.spot_raven_health.v1` reports the observer timestamp, age, expected cadence, tracked exact-market count, qualified current-read count, and covered chains. Zero qualified reads is a healthy and truthful market outcome. A missing observer or an observation older than 30 minutes degrades product health; the UI then says Raven is refreshing instead of presenting a healthy empty queue.

Each qualified spot read expires after one hour unless a new exact-market observation renews it. Historical reads are never substituted as current, and a provider rank cannot keep a read alive.

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
