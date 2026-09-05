# Raven Reads

Raven Reads are evidence-backed market interpretations. They are not trade instructions, signals, or execution prompts.

External providers supply observations: market data, chain activity, wallet enrichment, venue context, quotes, funding, open interest, books, and macro context. Raven generates the interpretation layer from those observations:

- market structure
- participation
- pressure
- survival and outcomes
- replay and memory
- freshness and confidence

The public claim is:

> RavenOS ingests public market, chain, wallet, and venue data, then generates proprietary behavioral reads from participation, pressure, survival, replay, and outcome evidence.

Every public Raven Read should answer:

- Setup: what is happening
- Edge: why this is worth attention
- Confirmation: what would strengthen the read
- Failure: what would weaken or invalidate the read
- Evidence: what supports it
- Freshness: how current it is
- Confidence: how much weight to give it

The chart-facing modes are:

- Structure
- Pressure
- Participation
- Replay
- Risk

## Technical context

The Terminal can add deterministic TA context from closed candles belonging to the selected exact market and timeframe:

- MACD 12/26/9 signal-line crosses, marked on the closed candle where the cross occurred
- accumulation-shaped ranges, requiring contraction plus constructive volume and range position
- 38.2%, 50%, and 61.8% Fibonacci retracement references from the latest qualified swing pivots

MACD and accumulation marks are shown by default when qualified. Fibonacci stays available in `Raven → TA` to avoid covering the chart with reference lines. Changing the market or timeframe recomputes the marks; a forming candle is excluded.

These are measured context, not execution instructions. An accumulation-shaped range does not establish wallet accumulation, and a Fibonacci level does not establish support or resistance. Missing volume, insufficient history, limited chart data, or unavailable provider evidence produces no mark rather than a guessed result.

Discover uses only its qualified market-flow and behavior evidence for short comments such as `Accumulation watch` or `Base watch`. It does not claim candle-level MACD or Fibonacci evidence when the Discover record does not contain exact-market candles.

Raven Reads must not use buy/sell/long/short/guaranteed/advice language. They identify where market behavior is changing and what would confirm or weaken Raven's interpretation.
