# Perps v2 Failure Mode Analysis

Generated: 2026-06-23T16:45:49.493Z

Purpose: explain why broad families failed while specific lanes succeeded. This is not optimization and does not create live rules.

## Top Positive Predictors
| Dimension | Value | Count | Weighted Avg Net % | Positive Group Rate | Candidate Group Rate |
| --- | --- | --- | --- | --- | --- |
| pressure_state | Exhausted | 246200 | 0.6602 | 0.5333 | 0.3833 |
| liquidity_attraction_band | moderate | 24435 | 0.5556 | 0.4952 | 0.3714 |
| market_regime | compressed | 339480 | 0.5508 | 0.4667 | 0.4286 |
| replay_similarity_band | 50_65 | 46640 | 0.4574 | 0.4381 | 0.381 |
| pressure_state | Constructive | 252845 | 0.4323 | 0.4842 | 0.4105 |
| pressure_composition | Smart Money | 4705 | 0.4294 | 0.4588 | 0.3765 |
| pressure_composition | Unknown | 405520 | 0.3898 | 0.41 | 0.31 |
| replay_similarity_band | under_50 | 665230 | 0.3683 | 0.41 | 0.36 |
| liquidity_attraction_band | weak | 687435 | 0.3677 | 0.41 | 0.35 |
| pressure_composition | Market Makers | 301495 | 0.3528 | 0.41 | 0.38 |
| market_regime | balanced | 177230 | 0.2878 | 0.3176 | 0.2824 |
| market_regime | vol_expanding | 108250 | 0.1727 | 0.4211 | 0.3474 |
| market_regime | uptrend | 33295 | 0.1284 | 0.475 | 0.3875 |
| market_regime | downtrend | 53550 | 0.0969 | 0.4 | 0.3067 |
| pressure_state | Elevated | 83800 | 0.0184 | 0.4353 | 0.3882 |
| pressure_state | Crowded | 128835 | -0.0539 | 0.4 | 0.3647 |

## Top Negative Predictors
| Dimension | Value | Count | Weighted Avg Net % | Positive Group Rate | Candidate Group Rate |
| --- | --- | --- | --- | --- | --- |
| pressure_state | Crowded | 128835 | -0.0539 | 0.4 | 0.3647 |
| pressure_state | Elevated | 83800 | 0.0184 | 0.4353 | 0.3882 |
| market_regime | downtrend | 53550 | 0.0969 | 0.4 | 0.3067 |
| market_regime | uptrend | 33295 | 0.1284 | 0.475 | 0.3875 |
| market_regime | vol_expanding | 108250 | 0.1727 | 0.4211 | 0.3474 |
| market_regime | balanced | 177230 | 0.2878 | 0.3176 | 0.2824 |
| pressure_composition | Market Makers | 301495 | 0.3528 | 0.41 | 0.38 |
| liquidity_attraction_band | weak | 687435 | 0.3677 | 0.41 | 0.35 |
| replay_similarity_band | under_50 | 665230 | 0.3683 | 0.41 | 0.36 |
| pressure_composition | Unknown | 405520 | 0.3898 | 0.41 | 0.31 |
| pressure_composition | Smart Money | 4705 | 0.4294 | 0.4588 | 0.3765 |
| pressure_state | Constructive | 252845 | 0.4323 | 0.4842 | 0.4105 |
| replay_similarity_band | 50_65 | 46640 | 0.4574 | 0.4381 | 0.381 |
| market_regime | compressed | 339480 | 0.5508 | 0.4667 | 0.4286 |
| liquidity_attraction_band | moderate | 24435 | 0.5556 | 0.4952 | 0.3714 |
| pressure_state | Exhausted | 246200 | 0.6602 | 0.5333 | 0.3833 |

## Lane Clustering
| Lane | Class | Count | Avg Net % | PF | Best | Worst |
| --- | --- | --- | --- | --- | --- | --- |
| volatility_expansion:long:TNSR-PERP:24h | provisional_candidate | 82 | 28.4205 | 8.6535 | TNSR-PERP | TNSR-PERP |
| oi_contraction:neutral:TNSR-PERP:24h | discovery_candidate | 35 | 21.3764 | 999 | TNSR-PERP | TNSR-PERP |
| funding_oi_divergence:long:RESOLV-PERP:24h | discovery_candidate | 36 | 17.0912 | 15.05 | RESOLV-PERP | RESOLV-PERP |
| volatility_expansion:long:RESOLV-PERP:24h | provisional_candidate | 63 | 15.3338 | 4.7706 | RESOLV-PERP | RESOLV-PERP |
| oi_expansion:long:TNSR-PERP:24h | provisional_candidate | 119 | 15.2428 | 2.9928 | TNSR-PERP | TNSR-PERP |
| volatility_expansion:long:TNSR-PERP:12h | provisional_candidate | 82 | 15.1917 | 7.3469 | TNSR-PERP | TNSR-PERP |
| pressure_collapse:long:TNSR-PERP:24h | discovery_candidate | 41 | 14.9113 | 16.1137 | TNSR-PERP | TNSR-PERP |
| compression_release:short:TNSR-PERP:24h | discovery_candidate | 28 | 14.8672 | 50.8537 | TNSR-PERP | TNSR-PERP |
| pressure_expansion:long:TNSR-PERP:12h | provisional_candidate | 69 | 14.6573 | 4.2545 | TNSR-PERP | TNSR-PERP |
| funding_oi_divergence:short:TNSR-PERP:24h | discovery_candidate | 43 | 14.5667 | 999 | TNSR-PERP | TNSR-PERP |
| oi_contraction:neutral:TNSR-PERP:12h | discovery_candidate | 35 | 14.084 | 11019.142 | TNSR-PERP | TNSR-PERP |
| participant_rotation:neutral:MET-PERP:24h | discovery_candidate | 31 | 13.9094 | 999 | MET-PERP | MET-PERP |
| oi_expansion:long:RESOLV-PERP:24h | provisional_candidate | 137 | 13.5004 | 5.2112 | RESOLV-PERP | RESOLV-PERP |
| basis_dislocation:short:TNSR-PERP:24h | discovery_candidate | 39 | 13.112 | 6.6967 | TNSR-PERP | TNSR-PERP |
| pressure_expansion:long:RESOLV-PERP:24h | provisional_candidate | 93 | 13.0381 | 5.4855 | RESOLV-PERP | RESOLV-PERP |
| oi_contraction:neutral:MET-PERP:24h | provisional_candidate | 55 | 12.8259 | 999 | MET-PERP | MET-PERP |
| participant_rotation:neutral:RESOLV-PERP:24h | discovery_candidate | 49 | 12.4714 | 999 | RESOLV-PERP | RESOLV-PERP |
| pressure_expansion:long:TNSR-PERP:24h | provisional_candidate | 69 | 12.2661 | 2.6769 | TNSR-PERP | TNSR-PERP |
| volatility_squeeze:neutral:RESOLV-PERP:24h | provisional_candidate | 114 | 12.0408 | 999 | RESOLV-PERP | RESOLV-PERP |
| compression_release:long:RESOLV-PERP:24h | provisional_candidate | 67 | 11.9308 | 8.3274 | RESOLV-PERP | RESOLV-PERP |

## Regime Clustering
| Dimension | Regime | Count | Weighted Avg Net % | Candidate Group Rate |
| --- | --- | --- | --- | --- |
| market_regime | compressed | 339480 | 0.5508 | 0.4286 |
| market_regime | balanced | 177230 | 0.2878 | 0.2824 |
| market_regime | vol_expanding | 108250 | 0.1727 | 0.3474 |
| market_regime | uptrend | 33295 | 0.1284 | 0.3875 |
| market_regime | downtrend | 53550 | 0.0969 | 0.3067 |

## Actual PerpSim Trade Flatness

Available trade window: 2026-04-22T19:24:36.590Z to 2026-05-06T08:12:43.995Z.

| Exit Rows | PnL USD | Avg PnL | Flat Rate | Positive Rate | Avg MFE % | Avg MAE % |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | 31.2231 | 1.301 | 0.25 | 0.3333 | 0.013822 | -0.006576 |

Mark quality:

| Marks | Fallback Rate | Flat Mark Rate |
| --- | --- | --- |
| 2361 | 0.0224 | 0.0191 |

No live trade recommendations are generated.
