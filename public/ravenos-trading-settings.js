import { readAccountSession, subscribeAccountSession } from './ravenos-account-session.js';
import { defaultTradingSettings, normalizeTradingSettings, normalizeExitStrategy } from './ravenos-trading-strategy.js';

const ROUTE = '/api/v1/trading-settings';
let snapshot = null, owner = null, generation = 0, pendingLoad = null;
const listeners = new Set();
const copy = value => JSON.parse(JSON.stringify(value));
function notify() { for (const callback of listeners) callback(snapshot ? copy(snapshot) : null); }
function clear() { generation++; snapshot = null; owner = null; pendingLoad = null; notify(); }
function ownerOf(payload) { return `${payload?.account?.username || ''}:${payload?.account?.email || ''}`; }
async function account() {
  const result = await readAccountSession();
  if (result.state !== 'authenticated') { if (result.state === 'signed_out') clear(); throw Error(result.state === 'signed_out' ? 'Sign in to save your settings.' : 'Account check unavailable. Try again.'); }
  const nextOwner = ownerOf(result.payload);
  if (owner && owner !== nextOwner) { clear(); throw Error('Account changed. Open settings again.'); }
  owner = nextOwner;
  return result.payload;
}
async function request(method, body, csrf) {
  const response = await fetch(ROUTE, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(8000), headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json', 'x-ravenos-csrf': csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    if (response.status === 401) clear();
    const error = Error(response.status === 409 ? 'Settings changed in another tab. Close and reopen to load them.' : response.status === 429 ? 'Settings were saved too often. Try again shortly.' : readableSettingsError(payload?.error));
    error.code = payload?.error; throw error;
  }
  return { revision: payload.revision, settings: normalizeTradingSettings(payload.settings), updated_at: payload.updated_at };
}
export async function loadTradingSettings() {
  if (pendingLoad) return pendingLoad;
  const token = generation;
  const work = (async () => { await account(); const next = await request('GET');
    if (token !== generation) throw Error('Account changed. Open settings again.'); snapshot = next; notify(); return copy(next); })();
  pendingLoad = work;
  try { return await work; } finally { if (pendingLoad === work) pendingLoad = null; }
}
export async function saveTradingSettings(settings, revision) {
  const normalized = normalizeTradingSettings(settings), token = generation;
  const auth = await account();
  if (token !== generation) throw Error('Account changed. Open settings again.');
  const next = await request('PUT', { settings: normalized, expected_revision: revision }, auth.csrf_token);
  if (token !== generation) throw Error('Account changed. Open settings again.');
  snapshot = next; notify(); return copy(next);
}
export function currentTradingSettings() { return snapshot ? copy(snapshot) : null; }
export function subscribeTradingSettings(callback) { listeners.add(callback); return () => listeners.delete(callback); }
subscribeAccountSession(summary => { if (summary.state === 'signed_out' || (owner && summary.state === 'authenticated' && owner.split(':')[0] !== summary.username)) clear(); });
window.addEventListener('ravenos:accountstate', event => { if (event.detail?.authenticated === false || (owner && event.detail?.username && owner.split(':')[0] !== event.detail.username)) clear(); });

export function readableSettingsError(code) {
  return ({ strategy_name_invalid: 'Give the strategy a name of 1–48 characters.', strategy_duplicate_name_or_id: 'Each strategy needs a different name.',
    strategy_rules_invalid: 'Add between 1 and 12 rules.', strategy_duplicate_trigger: 'Use one rule per trigger; combine its sell percentages.',
    strategy_take_profit_total_exceeds_100: 'Take-profit allocations cannot total more than 100%.',
    strategy_stop_loss_total_exceeds_100: 'Stop-loss allocations cannot total more than 100%.',
    strategy_trigger_invalid: 'Use a positive trigger percentage. Stop losses must stay below 100%.',
    strategy_allocation_invalid: 'Sell percentages must be greater than 0 and at most 100%.',
    quick_buy_amounts_invalid: 'Enter four increasing USD amounts between $1 and $100,000.',
    quick_native_amounts_invalid: 'Enter four increasing native amounts between 0.000001 and 50.',
    quick_sell_percentages_invalid: 'Enter four increasing sell percentages up to 100%.',
    trading_settings_slippage_invalid: 'Slippage must be between 0.25% and 10%.',
    strategy_limit_exceeded: 'You can save up to 20 strategies.',
    trading_settings_revision_conflict: 'Settings changed in another tab. Close and reopen to load them.',
    trading_settings_rate_limited: 'Settings were saved too often. Try again shortly.',
    authentication_required: 'Sign in to save your settings.',
  })[code] || 'Settings could not be saved. Check the values and try again.';
}
const element = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
function inputField(label, value, { min, max, step = 'any', type = 'number' } = {}) {
  const wrapper = element('label', null, 'ros-setting-field'), caption = element('span', label), input = document.createElement('input');
  input.type = type; input.value = value; input.setAttribute('aria-label', label);
  if (type === 'number') { input.inputMode = 'decimal'; input.step = step; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; }
  wrapper.append(caption, input); return { wrapper, input };
}
const button = (text, action, className) => { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };

export async function openTradingSettings({ tab = 'quick', chain = 'solana', symbol = 'SOL', onApplied, seed } = {}) {
  const existing = document.querySelector('dialog.ros-trading-settings');
  if (existing) { existing.focus(); return; }
  if (!document.querySelector('link[href="/ravenos-trading-settings.css"]')) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/ravenos-trading-settings.css'; document.head.append(style); }
  const focus = document.activeElement, dialog = element('dialog', null, 'ros-trading-settings');
  dialog.setAttribute('aria-label', 'Trading settings');
  const header = element('header'), title = element('strong', 'Trading settings');
  let unsubscribe;
  const close = () => { unsubscribe?.(); dialog.close(); dialog.remove(); focus?.focus?.({ preventScroll: true }); };
  unsubscribe = subscribeTradingSettings(value => { if (!value && dialog.isConnected) close(); });
  header.append(title, button('Close', close));
  const nav = element('nav'), body = element('div', null, 'ros-settings-body'), status = element('p', 'Loading your settings…', 'ros-settings-status');
  status.setAttribute('aria-live', 'polite');
  const footer = element('footer'), save = button('Save settings', async () => {
    if (!draft || busy) return;
    try {
      if (active === 'strategies' && editing) commitEditor();
      busy = true; save.disabled = true; status.textContent = 'Saving…';
      const next = await saveTradingSettings(draft, revision);
      revision = next.revision; draft = copy(next.settings); onApplied?.(next, { tab: active });
      status.textContent = 'Saved to your account.'; render();
    } catch (error) { status.textContent = error.code ? readableSettingsError(error.code) : error.message; }
    finally { busy = false; save.disabled = false; }
  }, 'ros-settings-save');
  save.disabled = true; footer.append(status, save); dialog.append(header, nav, body, footer); document.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.showModal();
  let draft, revision, active = tab, editing = null, fields = [], nameInput = null, busy = false;
  function failMessage(error) { status.textContent = readableSettingsError(error.code || error.message); }
  function commitEditor() {
    const strategy = normalizeExitStrategy({ id: editing.id, name: nameInput.value, version: editing.version,
      rules: fields.map(row => ({ id: row.id, kind: row.kind.value, trigger_pct: row.trigger.value, sell_pct: row.sell.value })) });
    const index = draft.strategies.findIndex(row => row.id === strategy.id);
    const next = copy(draft);
    if (index >= 0) next.strategies[index] = strategy; else next.strategies.push(strategy);
    draft = normalizeTradingSettings(next);
    editing = null;
  }
  function chooseTab(next) {
    try { if (editing) commitEditor(); active = next; status.textContent = ''; render(); } catch (error) { failMessage(error); }
  }
  function render() {
    if (!dialog.isConnected) return;
    nav.replaceChildren(...[['quick', 'Quick amounts'], ['strategies', 'TP/SL strategies'], ['slippage', 'Slippage']].map(([id, label]) => {
      const node = button(label, () => chooseTab(id)); node.setAttribute('aria-pressed', String(active === id)); return node;
    }));
    body.replaceChildren();
    if (active === 'quick') {
      for (const group of [{ label: 'Buy · USD', key: 'quick_buy_usdc', values: draft.quick_buy_usdc, min: 1, max: 100000 },
        { label: `Buy · ${symbol}`, key: 'quick_buy_native', values: draft.quick_buy_native[chain] || draft.quick_buy_native.solana, min: 0.000001, max: 50 },
        { label: 'Sell · % of balance', key: 'quick_sell_pct', values: draft.quick_sell_pct, min: 0.01, max: 100 }]) {
        body.append(element('h3', group.label)); const row = element('div', null, 'ros-quick-grid');
        group.values.forEach((value, i) => { const field = inputField(`${group.label} ${i + 1}`, value, group);
          field.input.addEventListener('input', () => { group.values[i] = field.input.value; }); row.append(field.wrapper); }); body.append(row);
      }
      body.append(element('p', 'These buttons fill the amount on your ticket. You still choose when to submit.', 'ros-settings-note'));
    } else if (active === 'slippage') {
      const field = inputField('Slippage %', draft.slippage_bps / 100, { min: 0.25, max: 10, step: 0.01 });
      const warning = element('p', null, 'ros-settings-warning');
      const sync = () => { draft.slippage_bps = Number.isFinite(Number(field.input.value)) && /^\d+(?:\.\d{1,2})?$/.test(field.input.value) ? Math.round(Number(field.input.value) * 100) : NaN; warning.textContent = Number(field.input.value) > 5 ? 'High slippage: your execution price may be more than 5% worse than the quote.' : ''; };
      field.input.addEventListener('input', sync); sync(); body.append(field.wrapper, warning, element('p', 'Your ticket also warns when quoted price impact exceeds 5%.', 'ros-settings-note'));
    } else if (editing) renderEditor();
    else {
      body.append(element('p', 'Save a set of exits, then choose it in Terminal or for each copied wallet.', 'ros-settings-note'));
      const off = button('No exit strategy', () => { draft.selected_strategy_id = null; render(); }); off.setAttribute('aria-pressed', String(draft.selected_strategy_id === null)); body.append(off);
      for (const strategy of draft.strategies) {
        const card = element('article', null, 'ros-strategy-card'), pick = button(strategy.name, () => { draft.selected_strategy_id = strategy.id; render(); });
        pick.setAttribute('aria-pressed', String(draft.selected_strategy_id === strategy.id));
        card.append(pick, element('p', strategy.rules.map(rule => `${rule.kind === 'take_profit' ? '+' : '−'}${rule.trigger_pct}% → sell ${rule.sell_pct}%`).join(' · ')));
        card.append(button(`Edit ${strategy.name}`, () => { editing = copy(strategy); render(); }), button(`Delete ${strategy.name}`, () => {
          draft.strategies = draft.strategies.filter(row => row.id !== strategy.id); if (draft.selected_strategy_id === strategy.id) draft.selected_strategy_id = null; render();
        })); body.append(card);
      }
      body.append(button('New strategy', () => { editing = { id: `strategy_${crypto.randomUUID()}`, name: '', version: 1, rules: [
        { id: 'tp1', kind: 'take_profit', trigger_pct: 50, sell_pct: 50 }, { id: 'tp2', kind: 'take_profit', trigger_pct: 100, sell_pct: 50 },
        { id: 'sl1', kind: 'stop_loss', trigger_pct: 20, sell_pct: 100 }] }; render(); }));
      body.append(element('p', 'Saved templates are not active orders. Copy applies the version you select to that wallet’s policy.', 'ros-settings-note'));
    }
  }
  function renderEditor() {
    const name = inputField('Strategy name', editing.name, { type: 'text' }); name.input.maxLength = 48; nameInput = name.input; body.append(name.wrapper);
    fields = [];
    const list = element('div', null, 'ros-strategy-rules');
    const capture = () => { editing.name = nameInput.value; editing.rules = fields.map(row => ({ id: row.id, kind: row.kind.value, trigger_pct: row.trigger.value, sell_pct: row.sell.value })); };
    editing.rules.forEach((rule, i) => {
      const row = element('div', null, 'ros-strategy-rule'), kind = document.createElement('select'); kind.setAttribute('aria-label', `Rule ${i + 1} type`);
      kind.append(new Option('Take profit', 'take_profit'), new Option('Stop loss', 'stop_loss')); kind.value = rule.kind;
      const trigger = inputField(`Rule ${i + 1} trigger %`, rule.trigger_pct, { min: 0.01, step: 0.01 });
      const sell = inputField(`Rule ${i + 1} sell %`, rule.sell_pct, { min: 0.01, max: 100, step: 0.01 });
      row.append(kind, trigger.wrapper, sell.wrapper, button(`Remove rule ${i + 1}`, () => { capture(); editing.rules.splice(i, 1); render(); }));
      fields.push({ id: rule.id, kind, trigger: trigger.input, sell: sell.input }); list.append(row);
    });
    body.append(list, button('Add rule', () => { if (editing.rules.length >= 12) { status.textContent = 'A strategy can contain up to 12 rules.'; return; } capture(); editing.rules.push({ id: `r_${crypto.randomUUID()}`, kind: 'take_profit', trigger_pct: '', sell_pct: '' }); render(); }));
    body.append(element('p', 'Triggers are price changes from your entry. Sell percentages use the starting position, capped by what remains. TP and SL totals each may be up to 100%.', 'ros-settings-note'));
    body.append(button('Use this strategy', () => { try { const id = editing.id; commitEditor(); draft.selected_strategy_id = id; status.textContent = 'Save settings to keep this strategy.'; render(); } catch (error) { failMessage(error); } }));
  }
  try {
    const loaded = await loadTradingSettings(); if (!dialog.isConnected) return;
    revision = loaded.revision; draft = copy(revision === 0 && seed ? normalizeTradingSettings(seed) : loaded.settings); status.textContent = ''; save.disabled = false; render();
  } catch (error) { status.textContent = error.message; body.append(button('Retry', () => { close(); void openTradingSettings({ tab, chain, symbol, onApplied, seed }); })); }
}
