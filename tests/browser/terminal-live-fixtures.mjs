export function providerCandles(asset, timeframe = "1h") {
  const spec = {
    "1m": [60, 80],
    "5m": [300, 72],
    "15m": [900, 64],
    "1h": [3600, 56],
    "4h": [14400, 48],
    "1d": [86400, 42],
    "1w": [604800, 36],
    "1M": [2592000, 30],
  }[timeframe] || [3600, 56];
  const [step, count] = spec;
  const seed = [...`${asset}:${timeframe}`].reduce((sum, character) => sum + character.charCodeAt(0), 17);
  const end = 1_784_592_000;
  let close = asset.includes("BTC") ? 67_500 : asset.includes("SPOT") || asset.includes("JUP") ? 1.12 : 148;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = Math.max(0.0001, open * (1 + Math.sin(index * 0.37 + seed) * 0.006 + (index - count / 2) * 0.00005));
    return {
      time: end - (count - 1 - index) * step,
      open: Number(open.toFixed(8)),
      high: Number((Math.max(open, close) * 1.004).toFixed(8)),
      low: Number((Math.min(open, close) * 0.996).toFixed(8)),
      close: Number(close.toFixed(8)),
      volume: 900_000 + seed * 100 + index * 11_000,
    };
  });
}

function bullishSpotCandles(asset, timeframe = "1h") {
  const timeline = providerCandles(asset, timeframe);
  let close = 1.12;
  return timeline.map((row, index) => {
    const open = close;
    const finalBar = index === timeline.length - 1;
    const change = finalBar ? 0.012 : index % 3 === 0 ? -0.0025 : 0.0018;
    close = open * (1 + change);
    return {
      ...row,
      open: Number(open.toFixed(8)),
      high: Number((Math.max(open, close) * 1.0025).toFixed(8)),
      low: Number((Math.min(open, close) * 0.9975).toFixed(8)),
      close: Number(close.toFixed(8)),
      volume: finalBar ? 2_800_000 : 900_000 + index * 8_000,
    };
  });
}

export const ROBINHOOD_CONTRACT = "0x230442c8133a9efb4c278b3723043444749ca08b";
// Robinhood Chain v4 pools are bytes32 pool IDs, not 20-byte account addresses.
export const ROBINHOOD_POOL = "0x602633428507bbaa848e6d0c3127cda15eeae6a9000000000000000000000000";
export const ROBINHOOD_QUOTE = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const BNB_MEMESTOCK_CONTRACT = "0x6ff45323817d1d53bbb8a8dfba9245ae74057777";
export const BNB_MEMESTOCK_POOL = "0x7bdc9582aca6ca25e5db1f2c8e59003b880672cb";
export const HYPERLIQUID_ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

export function hyperliquidAccountSnapshotFixture(address = HYPERLIQUID_ACCOUNT_ADDRESS) {
  const observedAt = new Date().toISOString();
  return {
    ok: true,
    schema_version: "ravenos.hyperliquid_account_snapshot.v1",
    state: "observed",
    observed_at: observedAt,
    venue: "hyperliquid",
    account: { address: String(address).toLowerCase(), address_source: "viewer_supplied_public_address", ownership_asserted: false, persisted: false },
    summary: {
      account_value_usdc: 12_500.25,
      withdrawable_usdc: 2_780.25,
      position_notional_usdc: 8_100,
      margin_used_usdc: 1_620,
      maintenance_margin_usdc: 405,
      margin_utilization_ratio: 0.12959741,
      account_leverage: 0.64798704,
      cash_balance_usdc: 4_400.25,
      cross_account_value_usdc: 12_500.25,
      cross_margin_used_usdc: 1_620,
      cross_maintenance_margin_used_usdc: 405,
      spot_usdc_total: 4_500,
      spot_usdc_available: 4_420,
      position_count: 2,
      open_order_count: 1,
      recent_fill_count: 2,
    },
    positions: [
      { market: "SOL", side: "long", size: 42.5, signed_size: 42.5, entry_price: 142.25, mark_notional_usdc: 6_301, unrealized_pnl_usdc: 36.125, return_on_equity: 0.0223, liquidation_price: 112.5, margin_used_usdc: 1_216.35, leverage: 5, leverage_mode: "cross", maximum_leverage: 20, funding: { since_open_usdc: -2.25, since_change_usdc: -0.75, all_time_usdc: -9.5 } },
      { market: "BTC", side: "short", size: 0.026, signed_size: -0.026, entry_price: 68_100, mark_notional_usdc: 1_755, unrealized_pnl_usdc: 15.75, return_on_equity: 0.038, liquidation_price: 78_500, margin_used_usdc: 351, leverage: 5, leverage_mode: "cross", maximum_leverage: 40, funding: { since_open_usdc: 1.15, since_change_usdc: 0.35, all_time_usdc: 4.75 } },
    ],
    balances: [
      { asset: "USDC", total: 4_500, on_hold: 80, available: 4_420, entry_notional_usdc: 4_500 },
      { asset: "HYPE", total: 125.5, on_hold: 0, available: 125.5, entry_notional_usdc: 3_600 },
    ],
    open_orders: [{ market: "SOL", side: "sell", size: 10, original_size: 25, limit_price: 155, trigger_price: null, order_type: "Limit", time_in_force: "gtc", reduce_only: true, is_trigger: false, placed_at: observedAt }],
    fills: [
      { market: "SOL", side: "buy", direction: "Open Long", size: 3.5, price: 142.2, closed_pnl_usdc: 0, fee_paid: 0.21, fee_asset: "USDC", liquidity: "taker", filled_at: observedAt },
      { market: "BTC", side: "sell", direction: "Open Short", size: 0.026, price: 68_100, closed_pnl_usdc: 0, fee_paid: 0.44, fee_asset: "USDC", liquidity: "maker", filled_at: observedAt },
    ],
    funding: [
      { market: "SOL", side: "long", since_open_usdc: -2.25, since_change_usdc: -0.75, all_time_usdc: -9.5 },
      { market: "BTC", side: "short", since_open_usdc: 1.15, since_change_usdc: 0.35, all_time_usdc: 4.75 },
    ],
    privacy: { address_persisted: false, transaction_hashes_exposed: false, provider_order_ids_exposed: false },
    execution_boundary: { public_account_observation_only: true, wallet_connected: false, signing_available: false, submission_available: false },
  };
}

function spotFixtureRows(query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (normalized === BNB_MEMESTOCK_CONTRACT || normalized.includes("memestock")) {
    return [{
      chainId: "bsc",
      dexId: "pancakeswap",
      pairAddress: BNB_MEMESTOCK_POOL,
      tokenAddress: BNB_MEMESTOCK_CONTRACT,
      quoteTokenAddress: "0x46ceefda28dd7207059ed19b0acdc026955bb15c",
      symbol: "MEMESTOCK",
      name: "memestock",
      quoteSymbol: "GMEB",
      priceUsd: 0.0042113,
      liquidityUsd: null,
      volume24h: 548_095,
      txns24h: 3_639,
      marketCap: null,
      fdv: null,
      priceChange24h: 11.12,
      coverage: "Exact provider pool",
      isSample: false,
      lastUpdated: "2026-08-27T12:13:31Z",
    }];
  }
  if (normalized === ROBINHOOD_CONTRACT || normalized.includes("runner")) {
    return [{
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: ROBINHOOD_POOL,
      tokenAddress: ROBINHOOD_CONTRACT,
      quoteTokenAddress: ROBINHOOD_QUOTE,
      symbol: "RUNNER",
      name: "The Runner",
      quoteSymbol: "WETH",
      priceUsd: 0.0003219,
      liquidityUsd: 68_960.64,
      volume24h: 14_200,
      txns24h: 241,
      marketCap: 321_900,
      fdv: 321_900,
      priceChange24h: -1.8,
      coverage: "Public lookup snapshot",
      isSample: false,
      lastUpdated: "2026-07-21T12:20:00Z",
    }];
  }
  if (normalized && !normalized.includes("jup") && !normalized.includes("jupiter")) return [];
  return [{
    chainId: "solana",
    dexId: "fixture-dex",
    pairAddress: "fixture-pair-address",
    tokenAddress: "fixture-token-address",
    quoteTokenAddress: "fixture-quote-address",
    symbol: "JUP",
    name: "Jupiter",
    quoteSymbol: "USDC",
    priceUsd: 1.12,
    liquidityUsd: 4_200_000,
    volume24h: 16_500_000,
    txns24h: 12_400,
    marketCap: 3_100_000_000,
    fdv: 7_800_000_000,
    priceChange24h: 3.4,
    coverage: "Public lookup snapshot",
    isSample: false,
    lastUpdated: "2026-07-21T12:20:00Z",
  }];
}

export async function selectUniversalInstrument(page, label) {
  await page.locator("#terminalInstrumentTrigger, #rosCommandTrigger").first().click();
  const input = page.locator("#rosCommandInput");
  await input.fill(label);
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: label }).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.waitForURL((url) => url.pathname === "/terminal/" && url.searchParams.get("asset") === label);
}

export async function openExactSpotSearch(page, query) {
  await page.locator("#terminalInstrumentTrigger, #rosCommandTrigger").first().click();
  await page.locator("#rosCommandInput").fill(query);
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: query }).filter({ hasText: "Exact pool" }).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.waitForURL((url) => url.pathname === "/terminal/" && String(url.searchParams.get("instrument_id") || "").includes(":pool:"));
}

function marketRow(asset, overrides = {}) {
  const coin = asset.replace(/-PERP$/, "");
  const mark = asset === "BTC-PERP" ? 67_500 : 148.25;
  return {
    asset,
    symbol: coin,
    instrument_id: `hyperliquid:perp:${coin}`,
    instrument_scope: "exact_instrument",
    market_type: "perpetual",
    venue: "hyperliquid",
    venue_label: "Hyperliquid",
    last_price: mark,
    mark_price: mark,
    oracle_price: mark - 0.05,
    funding_rate: -0.000012,
    open_interest_usd: asset === "BTC-PERP" ? 820_000_000 : 192_000_000,
    day_notional_volume_usd: asset === "BTC-PERP" ? 1_400_000_000 : 480_000_000,
    day_change_pct: asset === "BTC-PERP" ? -0.8 : 2.4,
    max_leverage: asset === "BTC-PERP" ? 40 : 20,
    observed_at: "2026-07-21T12:20:00Z",
    provider: "Hyperliquid public info endpoint",
    coverage: "live",
    freshness_state: "fresh",
    is_live: true,
    is_synthetic: false,
    ...overrides,
  };
}

function contextPayload(asset) {
  const coin = asset.replace(/-PERP$/, "");
  return {
    ok: true,
    schema_version: "ravenos.perp_terminal_context.v1",
    instrument: { instrument_id: `hyperliquid:perp:${coin}`, asset, symbol: coin },
    raven_context: {
      public_context_id: `context:${coin}:fixture`,
      instrument_id: `hyperliquid:perp:${coin}`,
      context_available: true,
      context_state: "fresh",
      observed_at: "2026-07-21T12:18:00Z",
      observed_side: "long",
      behavior_family: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup",
      pressure_state: asset === "BTC-PERP" ? "Balanced pressure" : "Mixed pressure",
      current_path: asset === "BTC-PERP" ? "Reset forming" : "Followthrough forming",
      entry_reference: { price: 148, observed_at: "2026-07-21T12:18:00Z", source: "decision-time mark" },
      outcomes: { evidence_maturity: "matured", sample_size: asset === "BTC-PERP" ? 84 : 128 },
    },
    raven_read: {
      headline: `${asset} · ${asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup"}`,
      summary: "A timestamped market observation is joined to this exact venue instrument.",
      why_raven_noticed: "Behavior changed while provider-backed pressure remained observable.",
      what_would_strengthen: ["Pressure broadens without immediate fade."],
      what_would_weaken: ["The observed path loses confirmation."],
    },
    matured_comparables: {
      evidence_maturity: "matured",
      sample_size: asset === "BTC-PERP" ? 84 : 128,
      median_observed_change_pct: 1.4,
      median_favorable_excursion_pct: 3.1,
      median_adverse_excursion_pct: -1.2,
      positive_followthrough_rate: 0.531,
      matured_through: "2026-07-20T12:00:00Z",
    },
    plan_preview: {
      schema_version: "ravenos.plan_preview.v1",
      plan_id: `context:${coin}:fixture:plan:v1`,
      state: "research_only",
      enabled_by_default: false,
      opt_in_required: true,
      instrument_id: `hyperliquid:perp:${coin}`,
      direction: "long",
      as_of: "2026-07-21T12:18:00Z",
      frozen_context_id: `context:${coin}:fixture`,
      sample_size: asset === "BTC-PERP" ? 84 : 128,
      evidence_maturity: "matured",
      review_horizon: "24h research window",
      levels: {
        entry_reference: { price: 148, observed_at: "2026-07-21T12:18:00Z", source: "decision-time mark" },
        target_reference: { price: 152.588, excursion_pct: 3.1, source: "median favorable excursion" },
        risk_reference: { price: 146.224, excursion_pct: -1.2, source: "median adverse excursion" },
      },
      production_qualified: false,
      personalized: false,
      executable: false,
      signing_available: false,
      submission_available: false,
    },
    chart_event: {
      event_id: `event:${coin}:fixture`,
      instrument_id: `hyperliquid:perp:${coin}`,
      label: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup",
      observed_at: "2026-07-20T12:00:00Z",
      lineage: { public_context_id: `context:${coin}:fixture` },
      inspection: {
        source_evidence: { label: "Timestamped Raven observation", observed_at: "2026-07-20T12:00:00Z", public_reference: `context:${coin}:fixture` },
        evidence_maturity: "matured",
        path_transition: { behavior: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup", pressure: asset === "BTC-PERP" ? "Balanced pressure" : "Mixed pressure", observed_side: "long", state: "fresh" },
        historical_outcome: { sample_size: asset === "BTC-PERP" ? 84 : 128, median_change_pct: 1.4, matured_through: "2026-07-20T12:00:00Z" },
        support: ["Pressure broadens without immediate fade."],
        contradiction: ["The observed path loses confirmation."],
      },
    },
    market_data: {
      generated_at: "2026-07-21T12:20:00Z",
      book: {
        observed_at: "2026-07-21T12:20:00Z",
        summary: { best_bid: 148.23, best_ask: 148.27, spread_bps: 2.664, bid_notional_usd: 32_000, ask_notional_usd: 25_500, imbalance_pct: 11.3 },
        bids: [
          { price: 148.23, size: 80.96, order_count: 12, notional_usd: 12_000 },
          { price: 148.2, size: 53.98, order_count: 8, notional_usd: 8_000 },
          { price: 148.16, size: 47.25, order_count: 9, notional_usd: 7_000 },
          { price: 148.1, size: 33.76, order_count: 5, notional_usd: 5_000 },
        ],
        asks: [
          { price: 148.27, size: 67.44, order_count: 10, notional_usd: 10_000 },
          { price: 148.3, size: 47.2, order_count: 7, notional_usd: 7_000 },
          { price: 148.35, size: 37.75, order_count: 6, notional_usd: 5_600 },
          { price: 148.41, size: 19.54, order_count: 4, notional_usd: 2_900 },
        ],
      },
      tape: {
        trades: [
          { observed_at: "2026-07-21T12:20:00Z", book_side: "bid", price: 148.26, size: 8.4, notional_usd: 1_245.38 },
          { observed_at: "2026-07-21T12:19:58Z", book_side: "ask", price: 148.24, size: 3.1, notional_usd: 459.54 },
          { observed_at: "2026-07-21T12:19:55Z", book_side: "bid", price: 148.27, size: 12.7, notional_usd: 1_883.03 },
          { observed_at: "2026-07-21T12:19:51Z", book_side: "ask", price: 148.23, size: 5.8, notional_usd: 859.73 },
        ],
      },
      components: { market: "fresh", book: "fresh", tape: "fresh" },
    },
    chart_overlays: {
      schema_version: "ravenos.chart_overlays.v1",
      instrument_id: `hyperliquid:perp:${coin}`,
      role: "annotation_only",
      candle_replacement_allowed: false,
      overlays: [
        { id: `context:${coin}:fixture:plan:v1:plan-entry`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-entry", label: "Decision reference", summary: "decision-time mark", severity: "info", priceMin: 148, priceMax: 148, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
        { id: `context:${coin}:fixture:plan:v1:plan-target`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-target", label: "Historical favorable reference", summary: "median favorable excursion", severity: "success", priceMin: 152.588, priceMax: 152.588, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
        { id: `context:${coin}:fixture:plan:v1:plan-risk`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-risk", label: "Historical adverse reference", summary: "median adverse excursion", severity: "danger", priceMin: 146.224, priceMax: 146.224, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
      ],
    },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

function accountHistoryFixture(address = HYPERLIQUID_ACCOUNT_ADDRESS) {
  const observedAt = new Date().toISOString();
  return {
    ok: true,
    schema_version: "ravenos.hyperliquid_account_history.v1",
    state: "observed",
    observed_at: observedAt,
    venue: "hyperliquid",
    account: { address: String(address).toLowerCase(), address_source: "viewer_supplied_public_address", ownership_asserted: false, persisted: false },
    orders: [
      { market: "SOL", side: "buy", original_size: 12, remaining_size: 0, filled_size: 12, limit_price: 141.5, trigger_price: null, order_type: "Limit", time_in_force: "gtc", reduce_only: false, is_trigger: false, status: "filled", status_at: observedAt },
      { market: "BTC", side: "sell", original_size: 0.01, remaining_size: 0, filled_size: 0.01, limit_price: 69_000, trigger_price: null, order_type: "Limit", time_in_force: "alo", reduce_only: false, is_trigger: false, status: "canceled", status_at: observedAt },
    ],
    privacy: { address_persisted: false, transaction_hashes_exposed: false, provider_order_ids_exposed: false },
    execution_boundary: { public_account_observation_only: true, cancellation_available: false, signing_available: false, submission_available: false },
  };
}

function accountScenarioFixture(input = {}) {
  const snapshot = hyperliquidAccountSnapshotFixture(input.address);
  const coin = String(input.instrument_id || "hyperliquid:perp:SOL").split(":").pop();
  const side = input.side === "short" ? "short" : "long";
  const orderType = ["market", "limit", "trigger"].includes(input.order_type) ? input.order_type : "market";
  const notional = Number(input.notional_usdc || 500);
  const leverage = Number(input.leverage || 3);
  const marginMode = input.margin_mode === "isolated" ? "isolated" : "cross";
  const reduceOnly = input.reduce_only === true;
  const mid = coin === "BTC" ? 67_500 : 148.25;
  const reference = orderType === "limit"
    ? Number(input.limit_price)
    : orderType === "trigger"
      ? Number(input.trigger_price)
      : side === "long" ? mid * 1.00008 : mid * 0.99992;
  const baseSize = notional / reference;
  const current = snapshot.positions.find((position) => position.market === coin) || null;
  const before = Number(current?.signed_size || 0);
  const delta = side === "long" ? baseSize : -baseSize;
  const projected = Math.abs(before + delta) < 1e-7 ? 0 : before + delta;
  const effect = before === 0
    ? "open"
    : Math.sign(before) === Math.sign(delta)
      ? "increase"
      : projected === 0
        ? "close"
        : Math.sign(projected) === Math.sign(before) ? "reduce" : "flip";
  const openingNotional = ["open", "increase"].includes(effect) ? notional : effect === "flip" ? Math.abs(projected) * reference : 0;
  const fee = notional * 0.0004;
  const incrementalMargin = openingNotional / leverage;
  const required = incrementalMargin + fee;
  const withdrawable = snapshot.summary.withdrawable_usdc;
  const settingsChange = !["reduce", "close"].includes(effect) && Boolean(current) && (current.leverage !== leverage || current.leverage_mode !== marginMode);
  const blockers = [
    ...(withdrawable < required ? ["insufficient_current_withdrawable"] : []),
    ...(settingsChange ? ["venue_margin_settings_change_required"] : []),
  ];
  const observedAt = new Date().toISOString();
  const entryState = orderType === "market" ? "current_book_fill_estimate" : orderType === "limit" ? "resting_limit" : "conditional_stop_entry";
  return {
    ok: true,
    schema_version: "ravenos.hyperliquid_account_scenario.v1",
    state: blockers.length ? "account_scenario_blocked" : "account_scenario_available",
    scenario_id: `hlas_fixture_${coin}_${side}_${orderType}_${notional}_${leverage}_${marginMode}_${reduceOnly}`,
    generated_at: observedAt,
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    instrument: { instrument_id: input.instrument_id, exact_market_id: coin, symbol: `${coin}-PERP`, venue: "hyperliquid", instrument_type: "perpetual", identity_scope: "exact_instrument", collateral_asset: "USDC" },
    intent: { side, order_type: orderType, time_in_force: orderType === "limit" ? input.time_in_force || "gtc" : null, requested_notional_usdc: notional, leverage, limit_price: orderType === "limit" ? reference : null, trigger_price: orderType === "trigger" ? reference : null, estimated_initial_margin_usdc: notional / leverage, planned_base_size: baseSize, margin_mode: marginMode, reduce_only: reduceOnly },
    entry_model: { state: entryState, marketable: orderType === "market", fill_guaranteed: false, reference_price: reference, reference_source: orderType === "market" ? "current_live_book_vwap" : orderType === "limit" ? "user_limit_price" : "user_trigger_price", distance_from_mid_bps: orderType === "market" ? null : ((reference - mid) / mid) * 10_000 },
    ...(orderType === "market" ? { fill_estimate: { base_size: baseSize, vwap_price: reference, worst_price: side === "long" ? reference * 1.00002 : reference * 0.99998, mid_price: mid, best_bid: mid * 0.99995, best_ask: mid * 1.00005, spread_bps: 1, price_impact_bps: 0.8, visible_levels_consumed: 2 } } : {}),
    market_reference: { mid_price: mid, best_bid: mid * 0.99995, best_ask: mid * 1.00005, spread_bps: 1 },
    account_context: { address: snapshot.account.address, ownership_asserted: false, observed_at: observedAt, account_value_usdc: snapshot.summary.account_value_usdc, withdrawable_usdc: withdrawable, margin_used_usdc: snapshot.summary.margin_used_usdc, maintenance_margin_usdc: snapshot.summary.maintenance_margin_usdc, current_position: current },
    position_effect: { effect, before_signed_size: before, order_delta_signed_size: delta, projected_signed_size: projected, projected_side: projected > 0 ? "long" : projected < 0 ? "short" : "flat", projected_size: Math.abs(projected), projected_notional_usdc: Math.abs(projected) * reference, liquidation_projection_included: false },
    fee_estimate: { liquidity_assumption: "taker", account_fee_rate: 0.0004, estimated_entry_fee_usdc: fee, bracket_exit_fees_included: false },
    margin_check: { state: withdrawable >= required ? "passes_current_snapshot" : "insufficient_current_withdrawable", withdrawable_before_usdc: withdrawable, estimated_incremental_notional_usdc: openingNotional, estimated_incremental_margin_usdc: incrementalMargin, estimated_entry_fee_usdc: fee, estimated_required_withdrawable_usdc: required, estimated_withdrawable_after_usdc: withdrawable - required, existing_exposure_netting_modeled: true },
    venue_settings: { requested_margin_mode: marginMode, requested_leverage: leverage, current_margin_mode: current?.leverage_mode || null, current_leverage: current?.leverage || null, settings_change_required: settingsChange, settings_action_prepared: false },
    provenance: { provider: "Hyperliquid", market_source: "live_l2_book", market_observed_at: observedAt, account_observed_at: observedAt, exact_identity: true },
    review: { state: blockers.length ? "blocked" : "account_scenario_ready", blockers, immutable_binding_hash: "fixture-account-binding", immutable_binding_included: true, prepared_payload_included: false, user_confirmation_recorded: false },
    execution_boundary: { account_scenario_only: true, public_account_observation: true, ownership_asserted: false, prepared_order_available: false, wallet_confirmation_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
  };
}

export async function mockTerminalLiveApis(page, {
  chartFailure = false,
  flagsEnabled = false,
  sparseTimeframe = null,
  liveBars = false,
  quietSpot = false,
  spotRavenContext = true,
  bullishSpotPlan = false,
  spotControls = true,
  velocitySpotContext = false,
  perpPlanIdentityMismatch = false,
  stalePerpPlan = false,
  includeContextPressureOverlay = false,
  holderRowCount = 2,
  holderRiskLevel = "watch",
  profileIdentityMismatch = false,
  spotVelocityState = "upside_velocity",
  chartDelayTimeframe = null,
  chartDelayMs = 0,
  chartFailureTimeframe = null,
  splitChartEnrichment = false,
  chartEnrichmentDelayTimeframe = null,
  chartEnrichmentDelayMs = 0,
  spotTradePrice = null,
  spotTradeDelayMs = 0,
  spotLateOlderPrice = null,
  spotChartCurrent = false,
  spotQuotePreview = false,
  spotQuoteTtlMs = 20_000,
  spotExitQuoteTtlMs = spotQuoteTtlMs,
  spotQuoteDelayMs = 0,
  spotQuoteOutputMint = null,
} = {}) {
  const calls = [];
  const holderCalls = [];
  const tradeCalls = [];
  const spotQuoteCalls = [];
  const markets = [marketRow("SOL-PERP"), marketRow("BTC-PERP")];
  const effectiveSpotTradePrice = spotTradePrice !== null && spotTradePrice !== undefined && spotTradePrice !== "" && Number.isFinite(Number(spotTradePrice))
    ? Number(spotTradePrice)
    : bullishSpotPlan ? 1.165 : 1.12;
  await page.route("https://assets.geckoterminal.com/token-fixture.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, schema_version: "ravenos.hyperliquid.markets.v2", provider: "Hyperliquid", coverage: "Live", count: markets.length, results: markets }),
  }));
  await page.route("**/api/perps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { instrument_context: { rows: [{ instrument: "SOL-PERP", context_available: true, context_state: "fresh", context_age_seconds: 30, outcomes: { sample_size: 128 } }] } } }),
  }));
  await page.route("**/api/perps/instrument**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") || "SOL-PERP";
    const payload = contextPayload(symbol);
    if (perpPlanIdentityMismatch) payload.plan_preview.instrument_id = "hyperliquid:perp:DIFFERENT";
    if (stalePerpPlan) {
      payload.raven_context.context_state = "stale";
      payload.delivery.freshness_state = "stale";
    }
    if (includeContextPressureOverlay) {
      payload.chart_overlays.overlays.push({
        id: `${payload.raven_context.public_context_id}:pressure:v1`,
        instrument_id: payload.instrument.instrument_id,
        type: "pressure-zone",
        label: "Current pressure zone",
        summary: "Exact-market observed pressure range",
        severity: "info",
        priceMin: 147,
        priceMax: 149,
        startTime: 1_784_592_000,
        observed_at: "2026-07-21T12:18:00Z",
        lineage: { public_context_id: payload.raven_context.public_context_id },
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/onchain/holders**", (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get("chain") || "solana";
    const poolAddress = url.searchParams.get("pair_address");
    const tokenAddress = url.searchParams.get("token_address");
    const quoteAddress = url.searchParams.get("quote_address");
    holderCalls.push({ poolAddress, tokenAddress, quoteAddress });
    const evm = chain !== "solana";
    const evmExplorer = {
      robinhood: "https://robinhoodchain.blockscout.com/address/",
      base: "https://basescan.org/address/",
      bsc: "https://bscscan.com/address/",
      ethereum: "https://etherscan.io/address/",
    }[chain];
    const evmOwner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const evmContract = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const evmOtherOwner = "0xdddddddddddddddddddddddddddddddddddddddd";
    const unresolvedPoolId = evm && /^0x[a-f0-9]{64}$/i.test(String(poolAddress || ""));
    const holderEvidenceSource = evm ? "Blockscout indexed holders" : "Solana on-chain accounts";
    const baseHolderRows = evm ? [
      { rank: 1, holder_address: evmOwner, token_account_address: evmOwner, token_account_count: 1, balance: "123456789.25", supply_share_pct: 12.345, classification: "owner", excluded_from_wallet_concentration: false, explorer_url: `${evmExplorer}${evmOwner}` },
      unresolvedPoolId
        ? { rank: 2, holder_address: evmOtherOwner, token_account_address: evmOtherOwner, token_account_count: 1, balance: "85000000", supply_share_pct: 8.5, classification: "owner", excluded_from_wallet_concentration: false, explorer_url: `${evmExplorer}${evmOtherOwner}` }
        : { rank: 2, holder_address: poolAddress, token_account_address: poolAddress, token_account_count: 1, balance: "85000000", supply_share_pct: 8.5, classification: "exact_pool_account", excluded_from_wallet_concentration: true, explorer_url: `${evmExplorer}${poolAddress}` },
      { rank: 3, holder_address: evmContract, token_account_address: evmContract, token_account_count: 1, balance: "42000000", supply_share_pct: 4.2, classification: "contract", excluded_from_wallet_concentration: false, explorer_url: `${evmExplorer}${evmContract}` },
    ] : [
      { rank: 1, holder_address: "Stake11111111111111111111111111111111111111", token_account_address: "SysvarRent111111111111111111111111111111111", token_account_count: 2, balance: "123456789.25", supply_share_pct: 12.345, classification: "owner", excluded_from_wallet_concentration: false, explorer_url: "https://solscan.io/account/Stake11111111111111111111111111111111111111" },
      { rank: 2, holder_address: "Vote111111111111111111111111111111111111111", token_account_address: "SysvarC1ock11111111111111111111111111111111", token_account_count: 1, balance: "85000000", supply_share_pct: 8.5, classification: "exact_pool_account", excluded_from_wallet_concentration: true, explorer_url: "https://solscan.io/account/Vote111111111111111111111111111111111111111" },
    ];
    const holderRows = Array.from({ length: Math.max(1, Math.min(100, holderRowCount)) }, (_, index) => ({
      ...baseHolderRows[index % baseHolderRows.length],
      rank: index + 1,
      balance: String(Math.round(123_456_789.25 / (index + 1))),
      supply_share_pct: Number(Math.max(0.001, 12.345 / (index + 1)).toFixed(6)),
      classification: index === 1 && !unresolvedPoolId ? "exact_pool_account" : (evm && index === 2 ? "contract" : "owner"),
      excluded_from_wallet_concentration: index === 1 && !unresolvedPoolId,
    }));
    const actionBlockingRisk = ["high", "severe"].includes(holderRiskLevel);
    const holderRiskFactors = unresolvedPoolId ? [] : actionBlockingRisk ? [
      { id: "exact_pool_liquidity_effectively_gone", label: "Exact-pool liquidity effectively gone", detail: "The latest exact-pool observation reports no usable USD liquidity.", severity: "critical", dimension: "market_integrity", source: "Exact pool market observation", observed_at: new Date().toISOString() },
      { id: "developer_supply_critical", label: "Developer controls most supply", detail: "The provider-listed developer address holds 96.6% of supply after an independent on-chain balance check.", severity: "critical", dimension: "control", source: holderEvidenceSource, observed_at: new Date().toISOString() },
      { id: "top_10_wallet_concentration_critical", label: "Top wallets dominate supply", detail: "The top 10 non-pool wallets hold 98.6% of supply.", severity: "critical", dimension: "control", source: holderEvidenceSource, observed_at: new Date().toISOString() },
    ] : [
      { id: "top_10_wallet_concentration_watch", label: "Holder concentration watch", detail: "The top 10 non-pool wallets hold 26.2% of supply.", severity: "elevated", dimension: "control", source: holderEvidenceSource, observed_at: new Date().toISOString() },
    ];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        safe_public: true,
        schema_version: "ravenos.onchain_holder_list.v2",
        state: "available",
        identity: { chain, pool_address: poolAddress, token_address: tokenAddress, quote_token_address: quoteAddress },
        observed_at: new Date().toISOString(),
        slot: evm ? null : 42,
        coverage: evm
          ? { scope: "provider_ranked_top_holders", scan_state: "indexed_partial", maximum_source_accounts: 50, scanned_source_accounts: holderRows.length, returned_owner_rows: holderRows.length, total_owner_rows: 314, complete_holder_census: false, owners_aggregated_across_all_accounts: true, pool_account_exclusion_state: unresolvedPoolId ? "unresolved_pool_id" : "resolved_contract_address" }
          : { scope: "all_nonzero_token_accounts", scan_state: "complete", maximum_source_accounts: 25_000, scanned_source_accounts: 4_856, returned_owner_rows: holderRows.length, total_owner_rows: 4_850, complete_holder_census: true, owners_aggregated_across_all_accounts: true, page_count: 5, slot_min: 40, slot_max: 42 },
        summary: { holder_count: evm ? 314 : 4_850, token_account_count: evm ? null : 4_856, top_10_supply_pct: 29.9, top_20_supply_pct: 42.4, top_50_supply_pct: 56.1, top_100_supply_pct: evm ? null : 64.8, largest_non_pool_wallet_supply_pct: unresolvedPoolId ? null : 12.345, top_3_wallet_supply_pct: unresolvedPoolId ? null : 18.5175, top_10_wallet_supply_pct: unresolvedPoolId ? null : 26.2 },
        token_controls: evm
          ? { source: "blockscout_token_index", state: "unavailable", token_standard: "ERC-20", mint_authority: "unknown", freeze_authority: "unknown" }
          : { source: "solana_mint_account", state: "available", mint_authority: "disabled", freeze_authority: "disabled" },
        holders: holderRows,
        risk_screen: {
          ok: true,
          safe_public: true,
          schema_version: "ravenos.market_control_risk.v1",
          state: "available",
          identity: { chain, pool_address: poolAddress, token_address: tokenAddress, quote_token_address: quoteAddress, instrument_id: `${chain}:pool:${poolAddress}` },
          observed_at: new Date().toISOString(),
          level: holderRiskLevel,
          title: actionBlockingRisk ? `${holderRiskLevel === "severe" ? "Severe" : "High"} control risk` : "Risk watch",
          summary: unresolvedPoolId
            ? "Pool-excluded wallet concentration is unresolved for this v4 market."
            : actionBlockingRisk
            ? "Usable liquidity has disappeared while developer and top-wallet supply control remain extreme. Review the exact evidence before using any setup."
            : "Holder concentration warrants review. Measured top-10 wallet concentration is 26.2% after excluding the exact pool.",
          risk_factors: holderRiskFactors,
          mitigating_checks: evm ? [] : [
            { id: "mint_authority_disabled", label: "Mint authority disabled", detail: "Mint authority is disabled on the exact token mint.", severity: "positive", dimension: "control", source: "Solana mint account", observed_at: new Date().toISOString() },
            { id: "freeze_authority_disabled", label: "Freeze authority disabled", detail: "Freeze authority is disabled on the exact token mint.", severity: "positive", dimension: "control", source: "Solana mint account", observed_at: new Date().toISOString() },
            ...(!actionBlockingRisk ? [{ id: "developer_holding_bounded", label: "Low listed-developer balance", detail: "The provider-listed developer address holds 1.7% of supply after an independent on-chain balance check.", severity: "positive", dimension: "control", source: "Solana on-chain accounts", observed_at: new Date().toISOString() }] : []),
          ],
          measured_facts: [],
          unmeasured: ["Bundled-launch concentration", "Insider and sniper classification", "Liquidity ownership, lock, and burn provenance"],
          metrics: { top_3_wallet_supply_pct: unresolvedPoolId ? null : actionBlockingRisk ? 98.1 : 18.5175, top_10_wallet_supply_pct: unresolvedPoolId ? null : actionBlockingRisk ? 98.6 : 26.2, largest_non_pool_wallet_supply_pct: unresolvedPoolId ? null : actionBlockingRisk ? 96.6 : 12.345, developer_supply_pct: actionBlockingRisk ? 96.6 : 1.74, volume_to_valuation_multiple: 5.3, pool_age_ms: 15_552_000_000 },
          coverage: { measured_check_count: actionBlockingRisk ? 5 : 4, risk_factor_count: holderRiskFactors.length, mitigating_check_count: evm ? 0 : actionBlockingRisk ? 2 : 3, unmeasured_count: 3, complete: false },
          interpretation: { technical_control_screen: true, scam_or_rug_determination: false, numeric_probability: false, safe_controls_mean_safe_token: false, holder_distribution_state: unresolvedPoolId ? "unresolved" : actionBlockingRisk ? "highly_concentrated" : "concentrated" },
        },
        source: evm
          ? { label: "Blockscout indexed holders", network: chain, method: "indexed_top_holders", raw_provider_included: false }
          : { label: "Solana on-chain accounts", network: "mainnet-beta", method: "indexed_program_account_scan", raw_rpc_included: false },
        limitations: [evm ? "Current indexed top holders; not a complete holder census." : "Current nonzero token accounts are aggregated by on-chain owner."],
      }),
    });
  });
  await page.route("**/api/onchain/trades**", async (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get("chain") || "solana";
    const poolAddress = url.searchParams.get("pair_address");
    const tokenAddress = url.searchParams.get("token_address");
    const quoteAddress = url.searchParams.get("quote_address");
    tradeCalls.push({ chain, poolAddress, tokenAddress, quoteAddress });
    const tradeRequestNumber = tradeCalls.length;
    if (spotTradeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, spotTradeDelayMs));
    const observedAt = new Date();
    const evm = chain !== "solana";
    const evmExplorer = {
      robinhood: "https://robinhoodchain.blockscout.com",
      base: "https://basescan.org",
      bsc: "https://bscscan.com",
      ethereum: "https://etherscan.io",
    }[chain];
    const traderAddresses = evm ? [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0xcccccccccccccccccccccccccccccccccccccccc",
    ] : [
      "Stake11111111111111111111111111111111111111",
      "Vote111111111111111111111111111111111111111",
      "SysvarRent111111111111111111111111111111111",
    ];
    const trades = Array.from({ length: 36 }, (_, index) => {
      const trader = traderAddresses[index % traderAddresses.length];
      const side = index % 3 === 1 ? "sell" : "buy";
      const volume = 120 + (36 - index) * 95;
      const transaction = evm
        ? `0x${(index + 1).toString(16).padStart(64, "0")}`
        : `${"3".repeat(80)}${String(index + 1).padStart(4, "3")}`;
      return {
        event_id: spotLateOlderPrice !== null && tradeRequestNumber > 1 && index === 2
          ? `fixture-late-swap-${tradeRequestNumber}`
          : `fixture-swap-${index + 1}`,
        observed_at: new Date(observedAt.getTime() - index * 20_000).toISOString(),
        side,
        price_usd: spotLateOlderPrice !== null && tradeRequestNumber > 1 && index === 2
          ? Number(spotLateOlderPrice)
          : effectiveSpotTradePrice + index / 100_000,
        token_amount: volume / effectiveSpotTradePrice,
        quote_amount: volume,
        volume_usd: volume,
        trader_address: trader,
        transaction_hash: transaction,
        block_number: 250_000_000 + index,
        trader_explorer_url: evm ? `${evmExplorer}/address/${trader}` : `https://solscan.io/account/${trader}`,
        transaction_explorer_url: evm ? `${evmExplorer}/tx/${transaction}` : `https://solscan.io/tx/${transaction}`,
        sample_size_tier: index < 4 ? "largest_10_pct" : "standard",
      };
    });
    const activeTraders = traderAddresses.map((trader, index) => ({
      rank: index + 1,
      trader_address: trader,
      trade_count: 12,
      buy_count: index === 1 ? 4 : 8,
      sell_count: index === 1 ? 8 : 4,
      buy_volume_usd: index === 1 ? 4_200 : 8_600 - index * 600,
      sell_volume_usd: index === 1 ? 7_400 : 3_200 + index * 300,
      total_volume_usd: 11_600 - index * 900,
      net_buy_volume_usd: index === 1 ? -3_200 : 5_400 - index * 900,
      first_seen_at: trades.at(-1).observed_at,
      last_seen_at: trades[index].observed_at,
      explorer_url: evm ? `${evmExplorer}/address/${trader}` : `https://solscan.io/account/${trader}`,
      recurrence: "repeat",
      direction: index === 1 ? "sell_dominant" : "buy_dominant",
    }));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        safe_public: true,
        schema_version: "ravenos.onchain_pool_trades.v1",
        state: "available",
        identity: { chain, pool_address: poolAddress, token_address: tokenAddress, quote_token_address: quoteAddress, instrument_id: `${chain}:pool:${poolAddress}` },
        observed_at: observedAt.toISOString(),
        freshness: { state: "live", latest_trade_at: trades[0].observed_at },
        coverage: { scope: "exact_pool_last_24h_bounded", provider_row_limit: 300, returned_trade_rows: trades.length, returned_trader_rows: activeTraders.length, complete_history: false },
        summary: {
          windows: {
            m5: { trade_count: 16, buy_count: 11, sell_count: 5, volume_usd: 42_400, buy_volume_usd: 31_200, sell_volume_usd: 11_200, net_buy_volume_usd: 20_000, buy_volume_share_pct: 73.5849, unique_trader_count: 3 },
            h1: { trade_count: 36, buy_count: 24, sell_count: 12, volume_usd: 67_410, buy_volume_usd: 46_100, sell_volume_usd: 21_310, net_buy_volume_usd: 24_790, buy_volume_share_pct: 68.3875, unique_trader_count: 3 },
            h24: { trade_count: 36, buy_count: 24, sell_count: 12, volume_usd: 67_410, buy_volume_usd: 46_100, sell_volume_usd: 21_310, net_buy_volume_usd: 24_790, buy_volume_share_pct: 68.3875, unique_trader_count: 3 },
          },
          repeat_trader_count: 3,
          repeat_trader_volume_share_pct: 100,
          largest_trade_usd: trades[0].volume_usd,
        },
        trades,
        active_traders: activeTraders,
        source: { label: "Data provided by CoinGecko", attribution_url: "https://www.coingecko.com/en/api" },
        limitations: ["This is a bounded exact-pool tape, not complete lifetime history."],
        privacy: { public_chain_addresses_only: true, customer_account_joined: false, private_labels_included: false },
        execution_boundary: { research_only: true, signing_available: false, submission_available: false },
      }),
    });
  });
  await page.route("**/api/opportunity**", (route) => {
    const instrumentId = new URL(route.request().url()).searchParams.get("instrument_id") || "";
    const exactSpot = instrumentId === "solana:pool:fixture-pair-address" && spotRavenContext;
    const observedAt = new Date(Date.now() - 45_000).toISOString();
    const selectedDiscoveryMarket = exactSpot ? {
      instrument_id: instrumentId,
      symbol: "JUP",
      name: "Jupiter",
      discovery: {
        exact_identity: {
          instrument_id: instrumentId,
          identity_scope: "exact_pool",
          chain: "solana",
          venue: "fixture-dex",
          pool_address: "fixture-pair-address",
          token_address: "fixture-token-address",
          quote_token_address: "fixture-quote-address",
          quote_asset: "USDC",
        },
        primary_behavior_state: { value: "reacceleration" },
        velocity_state: {
          value: spotVelocityState,
          availability: "available",
          observed_at: observedAt,
          freshness: "current",
        },
        raven_evidence_state: {
          availability: "available",
          qualified: true,
          state: "qualified",
          raven_signal: true,
          observed_at: observedAt,
          freshness: "current",
          why_raven_noticed: "Raven recorded this market 20m before broader attention appeared.",
          what_changed: "Price rose while volume, buyers, and active traders expanded.",
          behavioral_evidence: ["Buy participation expanded without losing exact-pool liquidity."],
          confidence_maturity: "developing",
          contradictions: ["Short-window movement still needs follow-through."],
          lineage: { public_artifact_id: "raven-spot-fixture" },
        },
        decision_support: {
          what_changed: "Price rose while volume, buyers, and active traders expanded.",
          why_now: "Participation accelerated at the exact market.",
          what_strengthens: "Buy participation and usable depth persist.",
          what_weakens: "Liquidity thins or expanded participation fades.",
          next_checkpoint: "Review the next qualified 5m observation.",
        },
      },
    } : null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.opportunity_workspace.v2",
        generated_at: new Date().toISOString(),
        selected_opportunity: null,
        selected_discovery_market: selectedDiscoveryMarket,
        selection: { requested: true, state: "not_present", silently_replaced: false },
        discovery_selection: { requested: true, state: selectedDiscoveryMarket ? "matched" : "not_present", silently_replaced: false },
        census: { discovery_radar: { rows: selectedDiscoveryMarket ? [selectedDiscoveryMarket] : [] } },
        delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
      }),
    });
  });
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    const asset = url.searchParams.get("asset") || "SOL-PERP";
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const market = url.searchParams.get("market") || "perpetuals";
    const pairAddress = url.searchParams.get("pair_address");
    const tokenAddress = url.searchParams.get("token_address");
    const quoteAddress = url.searchParams.get("quote_address");
    const instrumentId = url.searchParams.get("instrument_id");
    const chain = url.searchParams.get("chain");
    const limit = Number(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    const includeEnrichment = url.searchParams.get("include_enrichment") === "1";
    calls.push({ asset, timeframe, market, pairAddress, instrumentId, limit, before, includeEnrichment });
    if (chartDelayMs > 0 && timeframe === chartDelayTimeframe && !includeEnrichment) {
      await new Promise((resolve) => setTimeout(resolve, chartDelayMs));
    }
    if (chartEnrichmentDelayMs > 0 && timeframe === chartEnrichmentDelayTimeframe && includeEnrichment) {
      await new Promise((resolve) => setTimeout(resolve, chartEnrichmentDelayMs));
    }
    if (chartFailure || (chartFailureTimeframe === timeframe && !includeEnrichment)) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "provider_unavailable", freshness_state: "data_unavailable", candles: [] }) });
    const perp = asset.endsWith("-PERP");
    const traditional = market === "equities";
    const spotChain = chain || "solana";
    const quietExactPool = Boolean(pairAddress && quietSpot);
    let candleRows = pairAddress && bullishSpotPlan
      ? bullishSpotCandles(asset, timeframe)
      : providerCandles(asset, timeframe);
    if (pairAddress && spotChartCurrent) {
      const step = ({ "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 })[timeframe] || 3_600;
      const end = Math.floor(Date.now() / 1_000 / step) * step;
      candleRows = candleRows.map((row, index) => ({ ...row, time: end - (candleRows.length - 1 - index) * step }));
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: perp ? "Hyperliquid" : traditional ? "Yahoo Finance" : "DexPaprika",
        source_label: perp ? "Live perps market price" : traditional ? "Live market price" : "Exact public pool",
        freshness_state: "fresh",
        provider_freshness_state: pairAddress ? "current" : null,
        candle_freshness_state: pairAddress ? quietExactPool ? "delayed" : "current" : null,
        market_activity_state: pairAddress ? quietExactPool ? "no_recent_trades" : "active" : null,
        last_candle_at: pairAddress ? "2026-07-21T11:58:00Z" : null,
        last_candle_age_seconds: pairAddress ? quietExactPool ? 1_320 : 0 : null,
        market_health: pairAddress ? {
          schema_version: "ravenos.onchain_market_state.v1",
          provider_delivery_state: "current",
          market_snapshot_state: "current",
          candle_recency_state: quietExactPool ? "delayed" : "current",
          market_activity_state: quietExactPool ? "no_recent_trades" : "active",
          chart_state: quietExactPool ? "current_no_recent_trades" : "current",
          operator_label: quietExactPool ? "No recent txns" : "Current",
          last_candle_age_seconds: quietExactPool ? 1_320 : 0,
        } : null,
        timeframe,
        observed_at: "2026-07-21T12:20:00Z",
        market_identity: traditional ? instrumentId : pairAddress ? `${spotChain}:pool:${pairAddress}` : `hyperliquid:perp:${asset.replace(/-PERP$/, "")}`,
        instrument_scope: pairAddress ? "exact_pool" : "exact_instrument",
        available_scopes: pairAddress ? { exact_pool: true, token_aggregate: true } : {},
        instrument: traditional
          ? { canonical_id: instrumentId, instrument_type: String(instrumentId || "").startsWith("etf:") ? "etf" : "equity", identity_scope: "exact_instrument", chain: "none", venue: String(instrumentId || "").split(":")[1] || "traditional", symbol: asset, quote_asset: "USD" }
          : perp
          ? { instrument_type: "perpetual", chain: "hyperliquid", venue: "hyperliquid", symbol: asset }
          : { instrument_type: "spot_pool", chain: spotChain, venue: "fixture-dex", symbol: asset.split("/")[0], quote_asset: asset.split("/")[1] || "USDC", pair_address: pairAddress, token_address: tokenAddress },
        capabilities: { live_bars: liveBars, older_bar_backfill: false, live_trades: liveBars && perp },
        candle_series: {
          schema_version: "ravenos.chart_candle_series.v1",
          role: "base_ohlcv",
          provider: perp ? "hyperliquid_native" : traditional ? "atlas_listed_market" : "dexpaprika",
          provider_market_id: traditional ? instrumentId : pairAddress || `hyperliquid:${asset.replace(/-PERP$/, "")}`,
          timeframe,
          source_interval: timeframe,
          freshness_state: "fresh",
          derivation: { state: "direct", source_interval: timeframe, target_interval: timeframe, interpolation_used: false, missing_buckets_filled: 0 },
          raven_observations_are_candles: false,
        },
        continuity: pairAddress ? {
          schema_version: "ravenos.chart_continuity.v1",
          state: "verified",
          exact_pool_fingerprint: `${spotChain}:${pairAddress}:${tokenAddress}:${quoteAddress || "fixture-quote"}`,
          token_orientation: "selected_token_usd",
          selected_token_decimals: 9,
          quote_token_decimals: 6,
          candles: { state: "verified", missing_source_buckets: 0, conflicting_duplicates: 0, freshness_state: "fresh", age_seconds: 0 },
        } : null,
        derivation: { state: "direct", source_interval: timeframe, target_interval: timeframe, interpolation_used: false, missing_buckets_filled: 0 },
        provider_usage: { provider: perp ? "hyperliquid_native" : traditional ? "atlas_listed_market" : "dexpaprika", interval: timeframe, source_interval: timeframe, cache_hit: false, candle_mode: "direct", fallback_event: false },
        market_anatomy: pairAddress && (!splitChartEnrichment || includeEnrichment) ? {
          schema_version: "ravenos.market_anatomy.v1",
          exact_identity: true,
          pool_fingerprint: `${spotChain}:${pairAddress}:${tokenAddress}:${quoteAddress || "fixture-quote"}`,
          liquidity_usd: 4_200_000,
          volume_24h_usd: 16_500_000,
          transactions_24h: 12_400,
          buys_24h: 7_300,
          sells_24h: 5_100,
          market_cap_usd: 3_100_000_000,
          pool_age_ms: 180 * 86_400_000,
          holder_distribution: {
            state: "available",
            scope: "exact_token",
            observed_at: new Date().toISOString(),
            holder_count: 4_852,
            top_10_pct: 29.95,
            next_10_pct: 12.4593,
            next_20_pct: 15.1691,
            rest_pct: 42.4216,
            change_5m_pct: spotRavenContext && spotChain === "solana" ? 1.8 : null,
            change_1h_pct: spotRavenContext && spotChain === "solana" ? 6.4 : null,
            change_24h_pct: spotRavenContext && spotChain === "solana" ? 18.2 : null,
          },
          market_profile: {
            schema_version: "ravenos.onchain_market_profile.v1",
            identity: {
              state: "exact",
              chain: spotChain,
              pool_address: pairAddress,
              token_address: profileIdentityMismatch ? "different-profile-token-address" : tokenAddress,
              quote_token_address: quoteAddress,
            },
            token: {
              name: asset.split("/")[0],
              symbol: asset.split("/")[0],
              decimals: 9,
              image_url: "https://assets.geckoterminal.com/token-fixture.png",
              description: "Jupiter is a Solana liquidity platform and routing project.",
              description_role: "project_description",
            },
            holder_distribution: {
              state: "available",
              holder_count: 4_852,
              observed_at: new Date().toISOString(),
              top_10_pct: 29.95,
              next_10_pct: 12.4593,
              next_20_pct: 15.1691,
              rest_pct: 42.4216,
            },
            token_controls: spotControls ? {
              mint_authority: "disabled",
              freeze_authority: "disabled",
              honeypot: "not_flagged",
              developer_holding_pct: 1.74,
            } : {},
            launch: { completed: true, completed_at: new Date().toISOString() },
            links: [
              { kind: "website", label: "jup.ag", url: "https://jup.ag/" },
              { kind: "x", label: "X", url: "https://x.com/JupiterExchange" },
              { kind: "telegram", label: "Telegram", url: "https://t.me/jupiterexchange" },
            ],
            attribution: {
              required: true,
              label: "Data provided by CoinGecko",
              url: "https://www.coingecko.com/en/api",
            },
          },
          current_activity: spotRavenContext && spotChain === "solana" ? {
            observed_at: new Date().toISOString(),
            market_age_seconds: 180 * 86_400,
            volume_usd_5m: 140_000,
            volume_usd_1h: 2_100_000,
            volume_usd_24h: 16_500_000,
            buys_5m: 64,
            sells_5m: 26,
            traders_5m: 72,
            buys_1h: 320,
            sells_1h: 130,
            traders_1h: 240,
            buys_24h: 7_300,
            sells_24h: 5_100,
            traders_24h: 2_800,
          } : null,
          raven_context: spotRavenContext && spotChain === "solana" ? {
            schema_version: "ravenos.spot_market_context.v1",
            state: "current",
            evidence_scope: velocitySpotContext ? "exact_token" : "exact_pool",
            scope_label: velocitySpotContext ? "Token-wide activity" : "This exact pool",
            chain: "solana",
            token_address: tokenAddress,
            selected_pool_address: pairAddress,
            evidence_pool_address: velocitySpotContext ? null : pairAddress,
            symbol: asset.split("/")[0],
            name: asset.split("/")[0],
            observed_at: new Date(Date.now() - 45_000).toISOString(),
            projection_generated_at: new Date().toISOString(),
            source_age_seconds: 5,
            movement_state: "Activity accelerating",
            what_changed: "Price rose while volume, buyers, and active traders expanded.",
            risk: "Short-window movement still needs follow-through.",
            market: {
              holder_count: 1_240,
              holder_change_1h_pct: 6.4,
              volume_usd_5m: 140_000,
              buys_5m: 64,
              sells_5m: 26,
              traders_5m: 72,
            },
            broader_attention: {
              state: "raven_observed_first",
              raven_observed_first: true,
              lead_seconds: 1_200,
              observed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
              summary: "Raven recorded this market 20m before broader attention appeared.",
            },
            evidence_state: "observed",
            research_only: true,
            actionable: false,
            execution_available: false,
            signing_available: false,
            submission_available: false,
          } : null,
          route: { state: spotChain === "solana" ? "review_capability_check_required" : "unavailable", signing_available: false, submission_available: false },
          provider_freshness_state: "current",
          candle_freshness_state: quietExactPool ? "delayed" : "current",
          market_activity_state: quietExactPool ? "no_recent_trades" : "active",
          last_candle_at: "2026-07-21T11:58:00Z",
          last_candle_age_seconds: quietExactPool ? 1_320 : 0,
        } : null,
        raven_annotations: pairAddress && spotChain === "solana" && (!splitChartEnrichment || includeEnrichment) ? {
          schema_version: "ravenos.chart_annotations.v1",
          role: "annotation_only",
          identity_scope: "exact_pool",
          instrument_id: `spot_pool:solana:fixture-dex:JUP:USDC:${pairAddress}`,
          market_identity: `solana:pool:${pairAddress}`,
          price_unit: "usd_per_token",
          price_axis_compatible: true,
          candle_replacement_allowed: false,
          events: [{ type: "raven-observation", severity: "info", time: candleRows[10].time, exact_observed_at: "2026-07-21T12:00:00Z", event_id: "public-raven-event" }],
          overlays: [],
          lineage: { source: "Raven exact observations", observed_at: "2026-07-21T12:00:00Z" },
        } : null,
        candles: sparseTimeframe === timeframe ? candleRows.slice(-12) : candleRows,
      }),
    });
  });
  await page.route("**/api/dexscreener/search**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: spotFixtureRows(query) }) });
  });
  await page.route("**/api/dexscreener/pair**", (route) => {
    const url = new URL(route.request().url());
    const chainId = url.searchParams.get("chainId");
    const rows = chainId === "robinhood"
      ? spotFixtureRows(ROBINHOOD_CONTRACT)
      : chainId === "bsc" ? spotFixtureRows(BNB_MEMESTOCK_CONTRACT) : spotFixtureRows("JUP");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: rows }) });
  });
  await page.route("**/api/trade/flags", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      quote_only: true,
      market_preview_available: true,
      market_preview_markets: ["hyperliquid_perpetual"],
      order_plan_available: true,
      order_plan_markets: ["hyperliquid_perpetual"],
      order_plan_types: ["market", "limit", "trigger"],
      public_account_view_available: true,
      public_account_view_venues: ["hyperliquid"],
      browser_wallet_connection_available: true,
      wallet_connection_scope: "public_address_observation_only",
      wallet_signature_requested: false,
      wallet_connection_persisted: false,
      account_scenario_available: true,
      account_scenario_venues: ["hyperliquid"],
      account_history_available: true,
      account_history_types: ["orders"],
      signing_available: false,
      submission_available: false,
      spot_quote_preview_available: spotQuotePreview,
      spot_quote_preview_chains: spotQuotePreview ? ["solana"] : [],
      trade_adapter_states: {
        solana: spotQuotePreview ? "quote_review" : "unavailable",
        hyperliquid: "quote_review",
        base: "adapter_pending",
        bsc: "adapter_pending",
        ethereum: "adapter_pending",
        robinhood: "adapter_pending",
        arbitrum: "adapter_pending",
        optimism: "adapter_pending",
        polygon: "adapter_pending",
        avalanche: "adapter_pending",
        tron: "adapter_pending",
        sui: "adapter_pending",
      },
      spot_fee_preview: {
        provider: "jupiter",
        free_fee_bps: 100,
        pro_fee_bps: 70,
        pro_discount_pct: 30,
        actual_fee_bps: 0,
        enabled: false,
      },
      flags: {
        RAVENOS_CUSTOMER_TRADE_UI_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE: false,
        RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE: false,
      },
    }),
  }));
  await page.route("**/api/trade/spot-quote-preview", async (route) => {
    const input = route.request().postDataJSON();
    spotQuoteCalls.push(input);
    if (spotQuoteDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, spotQuoteDelayMs));
    const now = Date.now();
    const sell = input.side === "sell";
    const percent = Number(input.sell_percent || 0);
    const requestedPreference = sell ? input.settlement_preference : input.funding_preference;
    const selectedPreference = requestedPreference === "native" ? "native" : "canonical_usdc";
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const nativeMint = "So11111111111111111111111111111111111111112";
    const inputMint = sell ? input.token_address : selectedPreference === "native" ? nativeMint : usdcMint;
    const outputMint = spotQuoteOutputMint || (sell ? selectedPreference === "native" ? nativeMint : usdcMint : input.token_address);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.solana_spot_quote_review.v1",
        state: "quote_review_available",
        review_available: true,
        asset_preference: {
          schema_version: "ravenos.spot_asset_preference_selection.v1",
          side: input.side,
          requested: requestedPreference,
          selected: selectedPreference,
          selected_symbol: selectedPreference === "native" ? "SOL" : "USDC",
          resolution: requestedPreference === "auto" ? "chain_local_canonical_usdc_baseline" : "user_selected",
          cross_chain_funding_evaluated: false,
          canonical_usdc_identity_verified: selectedPreference === "canonical_usdc",
        },
        intent: {
          exact_market: {
            instrument_id: input.instrument_id,
            pool_address: input.pool_address,
            token_address: input.token_address,
            quote_address: input.quote_address,
          },
          side: input.side,
          input_mint: inputMint,
          output_mint: outputMint,
          amount: { kind: sell ? "sell_percentage" : selectedPreference === "native" ? "native_sol" : "canonical_usdc", sell_percentage_bps: sell ? percent * 100 : null },
        },
        quote: {
          quote_id: `fixture-spot-${input.side}-${sell ? percent : input.display_amount}`,
          expected_output_display: sell ? "0.42" : "8450.25",
          minimum_output_display: sell ? "0.4179" : "8408",
          output_mint: outputMint,
          price_impact_bps: 18,
          route: { policy: "exact_selected_token", leg_count: 2, venues: ["Raydium", "Meteora"] },
        },
        fee_disclosure: {
          configured: { enabled: false, fee_bps: 100 },
          actual: { charged: false, fee_bps: 0, amount_base_units: "0" },
        },
        timing: {
          quoted_at: new Date(now).toISOString(),
          received_at: new Date(now + 80).toISOString(),
          expires_at: new Date(now + spotQuoteTtlMs).toISOString(),
          provider_latency_ms: 80,
          freshness: "current",
        },
        balance: sell ? { available: true, amount: { display: "100000", symbol: "JUP" }, source: "current_exact_mint_balance", persisted: false } : { available: false, reason: "wallet_not_connected" },
        shadow_execution: sell ? null : {
          schema_version: "ravenos.universal_shadow_execution.v1",
          mode: "shadow",
          route_state: "exit_verified",
          source_valuation_route: selectedPreference === "native" ? { expires_at: new Date(now + spotExitQuoteTtlMs).toISOString() } : null,
          round_trip: {
            state: "friction_incomplete",
            expires_at: new Date(now + spotExitQuoteTtlMs).toISOString(),
            exit_verified: true,
            trade_available: false,
            current_executable_liquidation_usdc: 73.84,
            minimum_executable_liquidation_usdc: 73.12,
            quote_only_round_trip_loss_pct: 1.5466666667,
            round_trip_friction_pct: null,
            unavailable_cost_components: ["entry_network_or_route_cost", "exit_network_or_route_cost"],
            marked_value_used_as_liquidation_value: false,
          },
          execution: { allowed: false, shadow_only: true, signing_available: false, submission_available: false, transaction_material_available: false },
        },
        execution_boundary: { quote_only: true, review_only: true, signing_available: false, submission_available: false, transaction_material_available: false },
        signing_available: false,
        submission_available: false,
        transaction_material_available: false,
      }),
    });
  });
  await page.route("**/api/trade/account-snapshot", async (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hyperliquidAccountSnapshotFixture(input.address)),
    });
  });
  await page.route("**/api/trade/account-history", async (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(accountHistoryFixture(input.address)),
    });
  });
  await page.route("**/api/trade/account-scenario", async (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(accountScenarioFixture(input)),
    });
  });
  await page.route("**/api/trade/order-plan", async (route) => {
    const input = route.request().postDataJSON();
    const coin = String(input.instrument_id || "hyperliquid:perp:SOL").split(":").pop();
    const side = input.side === "short" ? "short" : "long";
    const orderType = ["market", "limit", "trigger"].includes(input.order_type) ? input.order_type : "market";
    const notional = Number(input.notional_usdc || 500);
    const leverage = Number(input.leverage || 3);
    const mid = coin === "BTC" ? 67_500 : 148.25;
    const bestBid = mid * 0.99995;
    const bestAsk = mid * 1.00005;
    const vwap = side === "long" ? mid * 1.00008 : mid * 0.99992;
    const limitPrice = orderType === "limit" ? Number(input.limit_price) : null;
    const triggerPrice = orderType === "trigger" ? Number(input.trigger_price) : null;
    const marketable = orderType === "market" || (orderType === "limit" && (side === "long" ? limitPrice >= bestAsk : limitPrice <= bestBid));
    const entryReference = orderType === "market" ? vwap : orderType === "limit" ? limitPrice : triggerPrice;
    const takeProfit = Number(input.take_profit_price) || null;
    const stopLoss = Number(input.stop_loss_price) || null;
    const rewardPct = takeProfit ? Math.abs(takeProfit - entryReference) / entryReference * 100 : null;
    const riskPct = stopLoss ? Math.abs(stopLoss - entryReference) / entryReference * 100 : null;
    const observedAt = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.hyperliquid_order_plan.v1",
        state: "order_plan_available",
        plan_id: `hlop_fixture_${coin}_${side}_${orderType}_${notional}_${leverage}`,
        generated_at: observedAt,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        instrument: { instrument_id: input.instrument_id, exact_market_id: coin, symbol: `${coin}-PERP`, venue: "hyperliquid", instrument_type: "perpetual", identity_scope: "exact_instrument", collateral_asset: "USDC" },
        intent: {
          side,
          order_type: orderType,
          time_in_force: orderType === "limit" ? input.time_in_force || "gtc" : null,
          requested_notional_usdc: notional,
          leverage,
          limit_price: limitPrice,
          trigger_price: triggerPrice,
          estimated_initial_margin_usdc: notional / leverage,
          planned_base_size: notional / entryReference,
          margin_estimate_excludes_existing_exposure: true,
        },
        entry_model: {
          state: orderType === "market" ? "current_book_fill_estimate" : orderType === "trigger" ? "conditional_stop_entry" : marketable ? "currently_marketable_limit" : "resting_limit",
          marketable,
          fill_guaranteed: false,
          reference_price: entryReference,
          reference_source: orderType === "market" || marketable ? "current_live_book_vwap" : orderType === "limit" ? "user_limit_price" : "user_trigger_price",
          distance_from_mid_bps: orderType === "market" ? null : ((entryReference - mid) / mid) * 10_000,
          future_fill_price_estimated: orderType === "trigger" ? false : undefined,
        },
        ...(marketable ? { fill_estimate: { base_size: notional / vwap, vwap_price: vwap, worst_price: side === "long" ? vwap * 1.00002 : vwap * 0.99998, mid_price: mid, best_bid: bestBid, best_ask: bestAsk, spread_bps: 1, price_impact_bps: 0.8, visible_levels_consumed: 2 } } : {}),
        ...(takeProfit || stopLoss ? { risk_bracket: { configured: true, take_profit_price: takeProfit, stop_loss_price: stopLoss, reward_pct: rewardPct, risk_pct: riskPct, reward_to_risk: rewardPct && riskPct ? rewardPct / riskPct : null, target_pnl_usdc: rewardPct ? notional * rewardPct / 100 : null, stop_pnl_usdc: riskPct ? -notional * riskPct / 100 : null, fees_and_slippage_included: false, orders_prepared: false } } : {}),
        market_reference: { mid_price: mid, best_bid: bestBid, best_ask: bestAsk, spread_bps: 1 },
        provenance: { provider: "Hyperliquid", source: "live_l2_book", observed_at: observedAt, age_ms: 0, freshness: "current", exact_identity: true },
        review: { state: "order_plan_only", prepared_payload_included: false, account_state_included: false, user_confirmation_recorded: false },
        execution_boundary: { order_plan_only: true, account_connected: false, prepared_order_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
      }),
    });
  });
  await page.route("**/api/trade/market-preview", async (route) => {
    const request = route.request();
    const input = request.postDataJSON();
    const coin = String(input.instrument_id || "hyperliquid:perp:SOL").split(":").pop();
    const side = input.side === "short" ? "short" : "long";
    const notional = Number(input.notional_usdc || 500);
    const leverage = Number(input.leverage || 3);
    const mid = coin === "BTC" ? 67_500 : 148.25;
    const vwap = side === "long" ? mid * 1.00008 : mid * 0.99992;
    const observedAt = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.hyperliquid_market_preview.v1",
        state: "market_preview_available",
        preview_id: `hlmp_fixture_${coin}_${side}_${notional}_${leverage}`,
        generated_at: observedAt,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        instrument: {
          instrument_id: input.instrument_id,
          exact_market_id: coin,
          symbol: `${coin}-PERP`,
          venue: "hyperliquid",
          instrument_type: "perpetual",
          identity_scope: "exact_instrument",
          collateral_asset: "USDC",
          price_denominator: "USD reference",
        },
        intent: {
          side,
          requested_notional_usdc: notional,
          leverage,
          estimated_initial_margin_usdc: notional / leverage,
          margin_estimate_excludes_existing_exposure: true,
        },
        fill_estimate: {
          base_size: notional / vwap,
          vwap_price: vwap,
          worst_price: side === "long" ? vwap * 1.00002 : vwap * 0.99998,
          mid_price: mid,
          best_bid: mid * 0.99995,
          best_ask: mid * 1.00005,
          spread_bps: 1,
          price_impact_bps: 0.8,
          visible_levels_consumed: 2,
          visible_side_notional_usdc: 500_000,
        },
        route: {
          venue: "hyperliquid",
          exact_market_id: coin,
          consumed_book_side: side === "long" ? "asks" : "bids",
          order_assumption: "immediate_or_cancel_market_equivalent",
          market_order_submitted: false,
        },
        provenance: {
          provider: "Hyperliquid",
          source: "live_l2_book",
          observed_at: observedAt,
          age_ms: 0,
          freshness: "current",
          exact_identity: true,
          levels_available: 20,
        },
        review: {
          state: "market_preview_only",
          review_ready: false,
          blockers: ["venue_account_required", "account_fee_tier_required"],
        },
        execution_boundary: {
          market_preview_only: true,
          account_connected: false,
          prepared_order_available: false,
          signing_available: false,
          submission_available: false,
          position_monitoring_available: false,
        },
      }),
    });
  });
  return { calls, holderCalls, tradeCalls, spotQuoteCalls, markets };
}

export async function waitForTerminalLive(page, expected = {}) {
  await page.waitForFunction((wanted) => {
    const terminal = window.__RAVENOS_TERMINAL__?.getState?.();
    if (!terminal || terminal.candleCount < 20 || !document.querySelector("#terminalChart canvas")) return false;
    if (wanted.instrument && terminal.instrument !== wanted.instrument) return false;
    if (wanted.timeframe && terminal.timeframe !== wanted.timeframe) return false;
    if (wanted.lane && terminal.lane !== wanted.lane) return false;
    return true;
  }, expected);
}
