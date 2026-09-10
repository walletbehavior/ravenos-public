// Draft arithmetic only. Targets are supplied by the user; no policy, order or
// transfer is created. Amounts stay in their original currency and integer scale.
export function decimalUnits(value, decimals) {
  const text = String(value ?? '').trim();
  if (!new RegExp(`^(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,${decimals}})?$`).test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

export function unitsLabel(value, decimals) {
  if (decimals === 0) return BigInt(value).toLocaleString('en-US');
  const units = BigInt(value), negative = units < 0n, digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals), fraction = digits.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '−' : ''}${BigInt(whole).toLocaleString('en-US')}${fraction ? '.' + fraction : ''}`;
}

export function calculateCapitalPlan(payload, targets = {}, now = Date.now()) {
  const rows = [], age = now - Date.parse(payload?.buying_power?.observed_at);
  if (!Number.isFinite(age) || age < -30000 || age > 120000) return {state:'refresh_required',rows:[{title:'Refresh your wallet',detail:'Current balances are needed to compare your draft targets.'}]};
  const assets = payload.buying_power.assets || [];
  for (const [field, symbol, decimals, label] of [['usdc','USDC',6,'Working USDC'],['sol','SOL',9,'Network buffer']]) {
    if (!String(targets[field] ?? '').trim()) continue;
    const target = decimalUnits(targets[field], decimals);
    if (target === null) { rows.push({title:`Check the ${symbol} target`,detail:`Enter a nonnegative amount with up to ${decimals} decimal places.`}); continue; }
    const asset = assets.find(row => row.symbol === symbol && row.decimals === decimals && (symbol === 'SOL' ? row.asset_id === 'native' : row.canonical_usdc === true));
    const available = decimalUnits(asset?.spendable_before_network_fees, decimals);
    if (available === null) { rows.push({title:`${label} needs a balance check`,detail:`Usable ${symbol} is unavailable; it has not been counted as zero.`}); continue; }
    const delta = available - target;
    rows.push({title:delta === 0n ? `${label} matches your target` : `${unitsLabel(delta < 0n ? -delta : delta, decimals)} ${symbol} ${delta < 0n ? 'below' : 'above'} your target`,
      detail:symbol === 'SOL' ? 'Compared with your chosen SOL buffer. Each trade still checks its actual network cost.' : 'Compared with usable wallet USDC. Frozen tokens and pending rewards are excluded; no funds move.'});
  }
  if (String(targets.concentration ?? '').trim()) {
    const maximum = decimalUnits(targets.concentration, 2), summary = payload.summary || {};
    if (maximum === null || maximum <= 0n || maximum > 10000n) rows.push({title:'Check the exposure limit',detail:'Enter a percentage above 0 and no greater than 100.'});
    else if (payload.diagnostics?.observation_state !== 'complete' || payload.buying_power.state !== 'available' || payload.freshness?.stale_value_present === true || !/^0+$/.test(String(summary.stale_value_minor ?? '0')) || summary.marked_value_state !== 'current' || summary.state !== 'available' || Number(summary.unresolved_unknown_value_count || 0) > 0 || !/^\d+$/.test(String(summary.marked_portfolio_value_minor || '')) || BigInt(summary.marked_portfolio_value_minor) === 0n) rows.push({title:'Exposure comparison needs complete values',detail:'Missing, old or unresolved values prevent a reliable percentage of this wallet.'});
    else {
      const total = BigInt(summary.marked_portfolio_value_minor);
      const exposures = (payload.economic_exposure?.assets || []).filter(row => /^\d+$/.test(String(row.marked_value_minor ?? '')));
      if (payload.diagnostics?.exposure_rows?.asset?.truncated || exposures.reduce((sum,row) => sum + BigInt(row.marked_value_minor),0n) !== total) {
        rows.push({title:'Exposure comparison needs complete coverage',detail:'The returned asset exposures do not cover the full marked wallet value.'});
        return {state:'draft',rows};
      }
      const over = exposures.filter(row => BigInt(row.marked_value_minor) * 10000n > total * maximum);
      for (const row of over) rows.push({title:`Review ${String(row.identity || 'asset').replace(/^solana:/,'')} exposure`,detail:`${unitsLabel(BigInt(row.marked_value_minor) * 10000n / total,2)}% of marked wallet value exceeds your ${targets.concentration}% draft limit.`});
      if (!over.length) rows.push({title:'Observed asset exposure is within your draft limit',detail:'This comparison covers the observed Solana wallet and its current marks.'});
    }
  }
  return {state:'draft',rows:rows.length ? rows : [{title:'Set your own targets',detail:'Add a working USDC target, SOL buffer or asset limit to compare against this wallet.'}]};
}
