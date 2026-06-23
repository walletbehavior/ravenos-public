# Perps v2 Edge Attribution

Generated: 2026-06-23T16:58:15.264Z

Diagnostic research only. No live rules, no promotion, no execution changes.

## Strongest Positive Predictors
| Dimension | Value | Avg Net % | Candidate Rate |
| --- | --- | --- | --- |
| pressure_state | Exhausted | 0.6602 | 0.3833 |
| liquidity_attraction_band | moderate | 0.5556 | 0.3714 |
| market_regime | compressed | 0.5508 | 0.4286 |
| replay_similarity_band | 50_65 | 0.4574 | 0.381 |
| pressure_state | Constructive | 0.4323 | 0.4105 |
| pressure_composition | Smart Money | 0.4294 | 0.3765 |
| pressure_composition | Unknown | 0.3898 | 0.31 |
| replay_similarity_band | under_50 | 0.3683 | 0.36 |
| liquidity_attraction_band | weak | 0.3677 | 0.35 |
| pressure_composition | Market Makers | 0.3528 | 0.38 |
| market_regime | balanced | 0.2878 | 0.2824 |
| market_regime | vol_expanding | 0.1727 | 0.3474 |

## Strongest Negative Predictors
| Dimension | Value | Avg Net % | Candidate Rate |
| --- | --- | --- | --- |
| pressure_state | Crowded | -0.0539 | 0.3647 |
| pressure_state | Elevated | 0.0184 | 0.3882 |
| market_regime | downtrend | 0.0969 | 0.3067 |
| market_regime | uptrend | 0.1284 | 0.3875 |
| market_regime | vol_expanding | 0.1727 | 0.3474 |
| market_regime | balanced | 0.2878 | 0.2824 |
| pressure_composition | Market Makers | 0.3528 | 0.38 |
| liquidity_attraction_band | weak | 0.3677 | 0.35 |
| replay_similarity_band | under_50 | 0.3683 | 0.36 |
| pressure_composition | Unknown | 0.3898 | 0.31 |
| pressure_composition | Smart Money | 0.4294 | 0.3765 |
| pressure_state | Constructive | 0.4323 | 0.4105 |

## High Priority Forward-Track Research Candidates
| Lane | Count | Avg Net % | PF | Edge Score |
| --- | --- | --- | --- | --- |
| participant_rotation:neutral:LAYER-PERP:24h | 61 | 4.8547 | 435676.4747 | 3485447.5152 |
| volatility_squeeze:neutral:AXS-PERP:24h | 166 | 7.1324 | 50815.3553 | 406579.9016 |
| volatility_squeeze:neutral:RESOLV-PERP:4h | 114 | 6.0277 | 47180.6279 | 377493.2448 |
| oi_contraction:neutral:JTO-PERP:12h | 62 | 4.2072 | 39931.2109 | 319480.3048 |
| volatility_squeeze:neutral:AIXBT-PERP:24h | 123 | 4.0375 | 37854.4335 | 302867.768 |
| volatility_squeeze:neutral:2Z-PERP:24h | 158 | 4.9525 | 34382.4512 | 275099.2296 |
| oi_contraction:neutral:DYM-PERP:24h | 104 | 5.3232 | 26715.8734 | 213769.5728 |
| oi_contraction:neutral:PENDLE-PERP:24h | 129 | 4.346 | 25837.0607 | 206731.2536 |
| volatility_squeeze:neutral:PENDLE-PERP:24h | 122 | 3.5921 | 20180.6865 | 161474.2288 |
| participant_rotation:neutral:POPCAT-PERP:24h | 54 | 5.7144 | 19519.0765 | 156194.6472 |
| oi_contraction:neutral:SKR-PERP:24h | 174 | 3.6226 | 18709.2747 | 149703.1784 |
| volatility_squeeze:neutral:XPL-PERP:12h | 236 | 4.515 | 17813.8777 | 142547.1416 |
| oi_contraction:neutral:ORDI-PERP:24h | 132 | 4.3225 | 17499.738 | 140032.484 |
| volatility_squeeze:neutral:MEGA-PERP:24h | 123 | 5.9579 | 16804.5967 | 134484.4368 |
| volatility_squeeze:neutral:BIO-PERP:24h | 114 | 5.5533 | 14963.6194 | 119753.3816 |
| volatility_squeeze:neutral:SPX-PERP:24h | 148 | 4.5454 | 14928.2898 | 119462.6816 |
| volatility_squeeze:neutral:AERO-PERP:12h | 162 | 5.2029 | 14736.2203 | 117931.3856 |
| oi_contraction:neutral:LAYER-PERP:24h | 154 | 5.5129 | 13663.5214 | 109352.2744 |
| oi_contraction:neutral:JTO-PERP:24h | 62 | 4.1329 | 11879.0732 | 95062.6088 |
| oi_contraction:neutral:WLD-PERP:24h | 111 | 3.9396 | 11589.0839 | 92744.188 |

## Flatness Diagnosis
| Cause | Evidence |
| --- | --- |
| broad_family_dilution | Sweep shows family-level direction is weak unless filtered by symbol/regime/window. |
| wrong_holding_window | Many strong sweep lanes need 12h/24h; PerpSim exits often timed out or stopped before broad MFE capture. |
| wrong_symbol_concentration | Closed PerpSim symbols were ETH-PERP, SOL-PERP, while many candidate lanes cluster elsewhere. |
| exits_too_early_or_flat_target_logging | 6 closed rows were effectively flat; target rows in local artifacts include zero-PnL closes. |
| mae_before_mfe_path_risk | Stop exits averaged -0.012636 MAE with positive MFE still present in some stopped trades. |

No trade recommendations are generated.
