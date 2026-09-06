# Professional desk upgrade — September 6, 2026

The Terminal now includes a consistent control system, named watchlists, a compact research brief, unified panel navigation, linked/independent comparison charts, saved workspaces, and explicit loading/recovery states.

## Behavior

- Watchlists support up to 20 tracked public market identities and 8 named lists. Rows show observed price, window percentage change, provider-reported volume, a sparkline, source details, and timestamps. Quote windows are explicitly labeled; they are not presented as interchangeable cross-market dollar volume. Sorting supports name, window change, window volume, and recency. Arrow/Home/End navigation preserves focus through quote refreshes.
- Quote snapshots refresh once per minute with at most two concurrent requests. Hidden tabs stop starting requests. Exact market identity is checked before attaching prices. Provider failures retain the previous observation with its timestamp; prices are not persisted in browser storage.
- The research brief derives price change, technical evidence, warning checks, and the observed range from the primary chart. It identifies source, timeframe, and observation time. It does not turn observed levels into predictions.
- The existing pane strip is the single visible navigation home for chart, activity, trade, research, and account panels. Desktop duplicate dock tabs are hidden.
- Workspace controls enable two charts, choose a comparison timeframe, and switch between following the primary market and independently selecting a tracked market. Comparison charts use existing validated chart requests and live subscriptions. Their events and diagnostics cannot overwrite the primary chart's trading or research context. Closing the comparison destroys its subscriptions.
- Up to eight named workspaces store layout, rail visibility, primary/comparison timeframes, comparison identity/linking, and selected watchlist. Preferences remain local to the browser and contain no account, wallet, order, or quote state.
- Initial boot presents loading, provider failures offer recovery, and delayed updates are distinguished from loading. Failure to load the market directory ends the loading state and offers a reload action.

## Validation

- Full existing browser suite plus initial new scenarios: 260 passed.
- Final focused checks against the actual fingerprinted deployment assets: 9 passed, including desktop/mobile, storage denial, delayed selection, linked/independent charts, comparison failure/recovery, named lists, workspace restore, initial loading, and directory failure.
- Existing 907 contract tests plus 3 new preference/identity/quote-window tests.
- Build, security validation, and public-data leakage checks passed.
- The new module is registered in source mirroring, deployment asset generation, and build validation.

The upgrade reuses the existing public market/chart APIs. It does not change execution authority, trading activation settings, provider configuration, or infrastructure routes.
