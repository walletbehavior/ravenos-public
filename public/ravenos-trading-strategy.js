// Shared account settings and exit-rule contract. A saved strategy is not an order.
export const TRADING_SETTINGS_SCHEMA = 'ravenos.trading_settings.v1';
export const EXIT_STRATEGY_SCHEMA = 'ravenos.exit_strategy.v1';
export const TRADING_SETTINGS_LIMITS = Object.freeze({ strategies: 20, rules: 12, quickAmounts: 4 });
const CHAINS = ['solana', 'base', 'ethereum', 'bsc', 'robinhood'];
const fail = code => { const error = new Error(code); error.code = code; throw error; };
function object(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) fail(code);
  return value;
}
function number(value, min, max, code) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') fail(code);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(code);
  return n;
}
function percent(value, min, max, code) {
  const n = number(value, min, max, code), bps = Math.round(n * 100);
  if (Math.abs(n * 100 - bps) > 1e-7) fail(code);
  return bps / 100;
}
function identifier(value, code) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) fail(code);
  return value;
}
export function normalizeExitStrategy(input) {
  object(input, ['schema_version', 'id', 'name', 'version', 'rules'], 'strategy_invalid');
  if (input.schema_version !== undefined && input.schema_version !== EXIT_STRATEGY_SCHEMA) fail('strategy_invalid');
  const id = identifier(input.id, 'strategy_id_invalid');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 48 || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name)) fail('strategy_name_invalid');
  const version = number(input.version ?? 1, 1, 1000000, 'strategy_version_invalid');
  if (!Number.isSafeInteger(version)) fail('strategy_version_invalid');
  if (!Array.isArray(input.rules) || !input.rules.length || input.rules.length > TRADING_SETTINGS_LIMITS.rules) fail('strategy_rules_invalid');
  const ids = new Set(), triggers = new Set(), allocations = { take_profit: 0, stop_loss: 0 };
  const rules = input.rules.map(rule => {
    object(rule, ['id', 'kind', 'trigger_pct', 'sell_pct'], 'strategy_rule_invalid');
    const ruleId = identifier(rule.id, 'strategy_rule_id_invalid');
    if (ids.has(ruleId)) fail('strategy_duplicate_rule'); ids.add(ruleId);
    if (!Object.hasOwn(allocations, rule.kind)) fail('strategy_rule_kind_invalid');
    const trigger = percent(rule.trigger_pct, 0.01, rule.kind === 'stop_loss' ? 99.99 : 100000, 'strategy_trigger_invalid');
    const allocation = percent(rule.sell_pct, 0.01, 100, 'strategy_allocation_invalid');
    const key = `${rule.kind}:${trigger}`;
    if (triggers.has(key)) fail('strategy_duplicate_trigger'); triggers.add(key);
    allocations[rule.kind] += Math.round(allocation * 100);
    if (allocations[rule.kind] > 10000) fail(`strategy_${rule.kind}_total_exceeds_100`);
    return { id: ruleId, kind: rule.kind, trigger_pct: trigger, sell_pct: allocation };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.trigger_pct - b.trigger_pct || a.id.localeCompare(b.id));
  return { schema_version: EXIT_STRATEGY_SCHEMA, id, name, version, rules };
}

export function defaultTradingSettings() {
  return { schema_version: TRADING_SETTINGS_SCHEMA, strategies: [], selected_strategy_id: null,
    slippage_bps: 300,
    quick_buy_usdc: [25, 50, 100, 250], quick_sell_pct: [25, 50, 75, 100],
    quick_buy_native: Object.fromEntries(CHAINS.map(chain => [chain, chain === 'solana' ? [0.1, 0.5, 1, 2] : [0.01, 0.05, 0.1, 0.25]])) };
}
function amounts(values, min, max, code) {
  if (!Array.isArray(values) || values.length !== 4) fail(code);
  const rows = values.map(value => number(value, min, max, code));
  if (new Set(rows).size !== rows.length || rows.some((v, i) => i && v <= rows[i - 1])) fail(code);
  return rows;
}
export function normalizeTradingSettings(input) {
  object(input, ['schema_version', 'strategies', 'selected_strategy_id', 'quick_buy_usdc', 'quick_sell_pct', 'quick_buy_native', 'slippage_bps'], 'trading_settings_invalid');
  if (input.schema_version !== TRADING_SETTINGS_SCHEMA) fail('trading_settings_invalid');
  if (!Array.isArray(input.strategies) || input.strategies.length > TRADING_SETTINGS_LIMITS.strategies) fail('strategy_limit_exceeded');
  const strategies = input.strategies.map(normalizeExitStrategy);
  if (new Set(strategies.map(row => row.id)).size !== strategies.length || new Set(strategies.map(row => row.name.toLocaleLowerCase('en-US'))).size !== strategies.length) fail('strategy_duplicate_name_or_id');
  const selected = input.selected_strategy_id;
  if (selected !== null && !strategies.some(row => row.id === selected)) fail('strategy_selection_invalid');
  object(input.quick_buy_native, CHAINS, 'quick_native_amounts_invalid');
  const native = Object.fromEntries(CHAINS.map(chain => [chain, amounts(input.quick_buy_native[chain], 0.000001, 50, 'quick_native_amounts_invalid')]));
  const sell = amounts(input.quick_sell_pct, 0.01, 100, 'quick_sell_percentages_invalid');
  if (sell.some(n => Math.abs(n * 100 - Math.round(n * 100)) > 1e-7)) fail('quick_sell_percentages_invalid');
  const slippage = number(input.slippage_bps ?? 300, 25, 1000, 'trading_settings_slippage_invalid');
  if (!Number.isSafeInteger(slippage)) fail('trading_settings_slippage_invalid');
  return { schema_version: TRADING_SETTINGS_SCHEMA, strategies, selected_strategy_id: selected, slippage_bps: slippage,
    quick_buy_usdc: amounts(input.quick_buy_usdc, 1, 100000, 'quick_buy_amounts_invalid'), quick_sell_pct: sell, quick_buy_native: native };
}

export function exitStrategyLevels(strategy, entryPrice, { direction = 'long' } = {}) {
  const normalized = normalizeExitStrategy(strategy);
  const entry = number(entryPrice, Number.MIN_VALUE, 1e15, 'strategy_entry_price_required');
  if (!['long', 'short'].includes(direction)) fail('strategy_direction_invalid');
  const sign = direction === 'long' ? 1 : -1;
  const rules = normalized.rules.map(rule => ({ ...rule,
    price: Number((entry * (1 + sign * (rule.kind === 'take_profit' ? 1 : -1) * rule.trigger_pct / 100)).toPrecision(15)),
    allocation_bps: Math.round(rule.sell_pct * 100) }));
  if (rules.some(row => !Number.isFinite(row.price) || row.price <= 0)) fail('strategy_trigger_price_invalid');
  return { strategy: normalized, entry_price: entry, direction, rules,
    allocation_basis: 'initial_position_capped_by_remaining', authorizes_transaction: false };
}

// Deterministic proposal only. Callers must persist acknowledgements of actual fills,
// reserve in-flight quantities and obtain normal execution authority separately.
export function evaluateExitStrategy(strategy, { entry_price, current_price, initial_quantity, remaining_quantity, completed_rule_ids = [], pending_rule_ids = [], direction = 'long' } = {}) {
  const levels = exitStrategyLevels(strategy, entry_price, { direction });
  const current = number(current_price, Number.MIN_VALUE, 1e15, 'strategy_current_price_required');
  if (!/^[1-9][0-9]{0,77}$/.test(String(initial_quantity)) || !/^(0|[1-9][0-9]{0,77})$/.test(String(remaining_quantity))) fail('strategy_quantity_invalid');
  const initial = BigInt(initial_quantity); let remaining = BigInt(remaining_quantity);
  if (remaining > initial) fail('strategy_quantity_invalid');
  if (![completed_rule_ids, pending_rule_ids].every(rows => Array.isArray(rows) && rows.every(id => levels.rules.some(row => row.id === id)))) fail('strategy_rule_state_invalid');
  const used = new Set([...completed_rule_ids, ...pending_rule_ids]);
  if (pending_rule_ids.length) return { rules: [], state: 'waiting_for_pending_exit', authorizes_transaction: false };
  const proposals = [], totals = { take_profit: 0, stop_loss: 0 };
  for (const rule of levels.rules) {
    const previous = totals[rule.kind]; totals[rule.kind] += rule.allocation_bps;
    const quantity = initial * BigInt(totals[rule.kind]) / 10000n - initial * BigInt(previous) / 10000n;
    const above = (direction === 'long') === (rule.kind === 'take_profit');
    if (used.has(rule.id) || !(above ? current >= rule.price : current <= rule.price) || remaining === 0n || quantity === 0n) continue;
    const clipped = quantity < remaining ? quantity : remaining; remaining -= clipped;
    proposals.push({ rule_id: rule.id, kind: rule.kind, trigger_price: rule.price, quantity_base_units: String(clipped) });
  }
  return { rules: proposals, state: proposals.length ? 'review_required' : 'watching', authorizes_transaction: false };
}
