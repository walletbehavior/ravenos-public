# Perps v2 Research Workflow

Raven Perps v2 research is split into four separate stages. These stages must not be collapsed into one another.

## Backtest Discovery

Backtest discovery evaluates historical structure and forward outcomes across setup families, symbols, timeframes, and context bands.

Outputs:
- `data/runtime/perps_v2_all_setup_7d_sweep.json`
- `data/runtime/perps_v2_all_setup_7d_summary.md`
- `data/runtime/perps_v2_candidate_lanes.json`

Discovery can classify lanes as `reject`, `insufficient_sample`, `discovery_candidate`, `provisional_candidate`, or `forward_track_candidate`.

Discovery cannot:
- alter approved forward-paper lanes
- promote a setup
- change sizing, caps, mirrors, or execution
- create live trade recommendations

## Forward Paper Tracking

Forward paper tracking observes explicitly approved lanes in live market time without execution.

Outputs:
- `data/runtime/perps_v2_forward_paper_config.json`
- `data/runtime/perps_v2_forward_paper_report.json`
- `data/runtime/perps_v2_forward_paper_summary.md`

Forward paper tracking records 15m, 1h, 4h, and 12h outcomes, plus pressure, replay, liquidity, participant composition, MAE, MFE, and net after assumed fees/slippage.

## Promotion Review

Promotion review is a future manual gate. A lane must have enough forward samples, positive forward expectancy after fees/slippage, acceptable drawdown, no single-symbol dependency, and stability across market regimes.

Current review floor:
- minimum 50 forward samples per lane
- profit factor above 1.20
- positive average net after fees/slippage
- no single-symbol dependency
- stable across at least three market regimes when available

## Live Execution

Live execution is a separate canary/live rail process. Perps v2 discovery and paper tracking do not enable live execution.

All Perps v2 research artifacts must keep:
- `diagnostic_only: true`
- `paper_only: true`
- `affects_live: false`
- `live_execution_enabled: false`
- `promotion_allowed: false`
