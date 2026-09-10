import { calculateCapitalPlan, unitsLabel } from './ravenos-capital-plan.js';

const endpoint = '/api/v1/portfolio/preview';
const integer = value => /^-?\d+$/.test(String(value ?? ''));
const money = value => integer(value) ? '$' + unitsLabel(value, 6) : 'Unavailable';
const coveredMoney = (value, complete, scope) => complete ? money(value) : integer(value) && BigInt(value) > 0n ? `${money(value)} ${scope}` : 'Unavailable';
const text = (root, id, value) => { const el = root.querySelector('#' + id); if (el) el.textContent = value; };
const observed = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unknown time';

export function mountCapitalHelper(root) {
  if (!root) return;
  const wallet = root.querySelector('#capitalWallet'), refresh = root.querySelector('#capitalRefresh');
  const controls = root.querySelector('#capitalControls'), results = root.querySelector('#capitalResults');
  const targets = Object.fromEntries(['usdc', 'sol', 'concentration'].map(key => [key, root.querySelector(`[data-capital-target="${key}"]`)]));
  let csrf = '', wallets = [], payload = null, generation = 0, controller = null;
  const currentTargets = () => Object.fromEntries(Object.entries(targets).map(([key, el]) => [key, el.value]));
  const clear = () => {
    payload = null; results.hidden = true;
    for (const id of ['capitalBalanceSOL','capitalBalanceUSDC','capitalTotalSOL','capitalTotalUSDC','capitalMarked','capitalMarkedState','capitalObserved','capitalExitValue','capitalHoldingCount','capitalCoverage']) text(root,id,'');
    root.querySelector('#capitalHoldings').replaceChildren();root.querySelector('#capitalPlan').replaceChildren();
  };
  const start = () => { controller?.abort(); controller = new AbortController(); return ++generation; };
  async function read(url, init = {}) {
    const response = await fetch(url, {credentials:'same-origin',cache:'no-store',...init,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(18000)])});
    return {response, body:await response.json()};
  }
  function renderPlan() {
    if (!payload) return;
    const plan = calculateCapitalPlan(payload, currentTargets());
    if (plan.state === 'refresh_required') text(root,'capitalMarkedState','Refresh needed');
    root.querySelector('#capitalPlan').replaceChildren(...plan.rows.map(row => {
      const item = document.createElement('article'), title = document.createElement('strong'), detail = document.createElement('p');
      title.textContent = row.title; detail.textContent = row.detail; item.append(title, detail); return item;
    }));
  }
  function render(value) {
    payload = value;
    const assets = value.buying_power.assets;
    for (const symbol of ['SOL','USDC']) {
      const asset = assets.find(row => row.symbol === symbol);
      text(root, 'capitalBalance' + symbol, asset?.spendable_before_network_fees ?? 'Unavailable');
      text(root, 'capitalTotal' + symbol, asset?.amount !== null && asset?.amount !== asset?.spendable_before_network_fees ? `Total ${asset.amount} · usable shown` : 'Before network costs');
    }
    text(root, 'capitalMarked', coveredMoney(value.summary?.marked_portfolio_value_minor,value.summary?.marked_value_state === 'current' && value.diagnostics?.observation_state === 'complete','valued portion'));
    text(root, 'capitalMarkedState', value.diagnostics?.observation_state !== 'complete' ? 'Partial wallet observation' : value.freshness?.stale_value_present ? 'Some marks need an update' : value.summary?.marked_value_state === 'current' ? 'Current marks' : 'Some values unavailable');
    text(root, 'capitalExitValue', coveredMoney(value.summary?.executable_value_minor,value.summary?.executable_value_state === 'current' && value.diagnostics?.observation_state === 'complete','quoted portion'));
    text(root, 'capitalObserved', `Wallet observed ${observed(value.buying_power.observed_at)}. Marked value and exit estimates cover this Solana wallet.`);
    const rows = value.holdings?.rows || [];
    text(root, 'capitalHoldingCount', `${rows.length} shown · ${value.holdings?.observed_position_count ?? rows.length} observed positions`);
    root.querySelector('#capitalHoldings').replaceChildren(...rows.map(row => {
      const item = document.createElement('tr');
      const amount = integer(row.amount_base_units) && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 30 ? unitsLabel(row.amount_base_units, row.decimals) : 'Unavailable';
      const values = [row.instrument?.label || row.instrument?.symbol || 'Unresolved token',amount,money(row.marked_value_minor),money(row.executable_value_minor)];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; item.append(cell); }
      return item;
    }));
    text(root, 'capitalCoverage', `${value.diagnostics?.resolved_position_count ?? 0} of ${value.diagnostics?.observed_position_count ?? 0} positions resolved. Unavailable marks and exit routes remain excluded from confirmed values.`);
    results.hidden = false;
    renderPlan();
  }
  async function analyze() {
    const reference = wallet.value;
    if (!csrf || !wallets.some(row => row.wallet_reference === reference)) return;
    const version = start(); refresh.disabled = true;
    text(root, 'capitalStatus', payload ? 'Refreshing your wallet…' : 'Checking balances and exposure…');
    try {
      const {response, body} = await read(endpoint, {method:'POST',headers:{'content-type':'application/json','x-ravenos-csrf':csrf},body:JSON.stringify({wallet_reference:reference})});
      if (version !== generation) return;
      if ([401,403,404].includes(response.status)) { clear(); controls.hidden = true; text(root,'capitalStatus','Your wallet access changed. Reload access to continue.'); refresh.textContent = 'Reload access'; return; }
      if (!response.ok || !body?.ok) throw Error(response.status === 429 ? 'rate_limited' : 'unavailable');
      if (body.wallet?.wallet_reference !== reference || body.buying_power?.chain !== 'solana' || !Array.isArray(body.buying_power.assets) || body.boundaries?.read_only !== true || body.boundaries?.customer_assets_can_move !== false || body.boundaries?.transaction_material_created !== false) { clear(); throw Error('invalid'); }
      render(body);
      text(root,'capitalStatus',body.state === 'complete' ? 'Wallet view updated.' : 'Wallet view updated; some values could not be resolved.');
    } catch (error) {
      if (version !== generation) return;
      const age = Date.now() - Date.parse(payload?.buying_power?.observed_at);
      const retained = payload && age >= -30000 && age <= 300000;
      if (!retained) clear();
      else text(root,'capitalMarkedState','Retained marks');
      text(root,'capitalStatus',error.message === 'rate_limited' ? 'Checks are temporarily limited. Try again later.' : retained ? `Update delayed. Showing the wallet observation from ${observed(payload.buying_power.observed_at)}.` : 'The wallet check could not finish. Refresh to try again.');
      renderPlan();
    } finally { if (version === generation) refresh.disabled = false; }
  }
  async function loadAccess() {
    const version = start(); clear(); csrf = ''; wallets = []; controls.hidden = true; refresh.disabled = true; refresh.textContent = 'Refresh wallet';
    for (const input of Object.values(targets)) input.value = '';
    text(root,'capitalStatus','Loading your Raven wallet…');
    try {
      const session = await read('/api/v1/auth/session');
      if (version !== generation) return;
      if (!session.response.ok || !session.body.authenticated || !session.body.csrf_token) { text(root,'capitalStatus','Sign in to inspect your Raven wallet.'); return; }
      csrf = session.body.csrf_token;
      const capability = await read(endpoint);
      if (version !== generation) return;
      if (!capability.response.ok || !capability.body.ok) throw Error('unavailable');
      wallets = (capability.body.wallets || []).filter(row => /^wpr_[A-Za-z0-9_-]{8,80}$/.test(row.wallet_reference));
      if (!wallets.length) { text(root,'capitalStatus','Create your Raven Solana wallet in Account to inspect its balances and exposure.'); return; }
      wallet.replaceChildren(...wallets.map(row => { const option = document.createElement('option'); option.value = row.wallet_reference; option.textContent = row.label; return option; }));
      controls.hidden = false; wallet.disabled = wallets.length === 1;
      await analyze();
    } catch { if (version === generation) text(root,'capitalStatus','Wallet access could not be checked. Refresh to try again.'); }
    finally { if (version === generation) refresh.disabled = false; }
  }
  refresh.addEventListener('click', () => controls.hidden ? loadAccess() : analyze());
  wallet.addEventListener('change', () => { clear(); for (const el of Object.values(targets)) el.value = ''; analyze(); });
  for (const input of Object.values(targets)) input.addEventListener('input', renderPlan);
  window.addEventListener('ravenos:accountstate', event => {
    if (event.detail?.authenticated !== false) { loadAccess(); return; }
    start(); clear(); csrf = ''; wallets = []; controls.hidden = true; wallet.replaceChildren(); refresh.disabled = false;
    for (const input of Object.values(targets)) input.value = '';
    text(root,'capitalStatus','Sign in to inspect your Raven wallet.');
  });
  setInterval(() => { if (document.visibilityState === 'visible') renderPlan(); },30000);
  document.addEventListener('visibilitychange', renderPlan);
  window.addEventListener('focus', renderPlan);
  loadAccess();
}
