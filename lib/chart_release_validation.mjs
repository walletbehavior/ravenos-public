import { validateDexscreenerChartSurface } from '../ravenos-chart-data-plane.js';

export function qualifiedChartSurface(chart, { chain, pairAddress, tokenAddress, quoteAddress, timeframe = '1m', nativeRequired = false } = {}) {
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && (chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase());
  if (!chart?.ok || !same(chart.market_identity, `${chain}:${pairAddress}`) || chart.instrument?.chain !== chain
      || !same(chart.instrument.pool_address, pairAddress) || !same(chart.instrument.token_address, tokenAddress)
      || !same(chart.quote_address, quoteAddress) || chart.timeframe !== timeframe
      || chart.provider_selection?.exact_market_preserved !== true || chart.attribution?.required !== true) return false;
  if (chart.chart_surface) {
    return !nativeRequired && chart.provider_selection.selected === 'dexscreener'
      && chart.chart_readiness?.state === 'provider_managed'
      && chart.chart_readiness?.one_minute_requirement === 'provider_managed_not_measured'
      && chart.chart_readiness?.bars === null && chart.candle_series == null && chart.candles?.length === 0
      && chart.lineage?.raven_observations_are_candles === false
      && validateDexscreenerChartSurface(chart.chart_surface, { chain, pairAddress, tokenAddress, quoteAddress, timeframe });
  }
  return chart.provider_selection.selected === 'dexch' && chart.candle_series?.provider === 'dexch'
    && chart.candle_series?.role === 'base_ohlcv' && chart.candle_series?.raven_observations_are_candles === false
    && chart.continuity?.identity?.state === 'verified' && chart.derivation?.interpolation_used === false
    && ['verified_current', 'verified_with_visible_staleness'].includes(chart.chart_readiness?.state)
    && Array.isArray(chart.candles) && chart.candles.length >= (timeframe === '1m' ? 120 : 2)
    && (timeframe !== '1m' || chart.chart_readiness?.one_minute_requirement === 'verified');
}
