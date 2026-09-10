import { createHash } from 'node:crypto';
import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';

// This module is server-only. The browser receives the result, never the
// classification inputs, qualifications, source names or ranking rules.
export const PUBLIC_WALLET_CATEGORIES = Object.freeze([
  'Accumulating', 'Adding to positions', 'Longer holds', 'Taking profits', 'Recently inactive',
  'Fast trades', 'Regular trading', 'Occasional trades', 'Early launch participation',
  'Repeat launch participant', 'Repeat early buyer', 'Historically before followed traders',
  'Recurring trading group', 'Ecosystem specialist', 'Liquidity provider', 'Larger positions',
  'Developer/launcher', 'Positions with recorded profits', 'Patient top holders',
]);
const statuses = new Set(['current', 'recent', 'historical', 'limited']);
const categories = new Set(PUBLIC_WALLET_CATEGORIES);
const at = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const opaqueId = identity => `wallet_${createHash('sha256').update(`${identity.chain}:${identity.address}`).digest('hex').slice(0,32)}`;
const identityOf = value => normalizeSourceWalletChainIdentity({ chain: value.chain, network: 'mainnet', address: value.address });

// Public contract validation is intentionally independent of internal theories.
// New sources can participate through the same approved projection without
// shipping their own taxonomy, free-form explanations or confidence formulas.
export function validatePublicWalletCard(input) {
  const fields = ['schema_version','profile_id','chain','address','display_name','categories','summary','data_status','actions'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw Error('wallet_card_invalid');
  const identity = identityOf(input);
  if (input.schema_version !== 1 || !/^wallet_[A-Za-z0-9_-]{1,93}$/.test(input.profile_id || '')
    || !statuses.has(input.data_status) || !Array.isArray(input.categories) || input.categories.length > 6
    || input.categories.some(value => !categories.has(value)) || new Set(input.categories).size !== input.categories.length
    || !Array.isArray(input.actions) || input.actions.length > 2 || new Set(input.actions).size !== input.actions.length
    || input.actions.some(value => !['view_profile','open_copy_setup'].includes(value))) throw Error('wallet_card_invalid');
  for (const [key,max] of [['display_name',80],['summary',180]]) {
    if (typeof input[key] !== 'string' || input[key].length > max || (key === 'display_name' && !input[key].trim())
      || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(input[key])) throw Error('wallet_card_invalid');
  }
  return { schema_version: 1, profile_id: input.profile_id, chain: identity.chain, address: identity.address,
    display_name: input.display_name, categories: [...input.categories], summary: input.summary,
    data_status: input.data_status, actions: [...input.actions] };
}

function dataStatus(time, now) {
  const stamp = at(time);
  if (stamp === null || stamp > now) return 'limited';
  const age = now - stamp;
  return age <= 2*3600000 ? 'current' : age <= 7*86400000 ? 'recent' : 'historical';
}
function summaryFor(labels, status) {
  if (!labels.length) return 'The available history does not yet establish a consistent trading style.';
  const summaries = {
    'Accumulating': 'Builds positions gradually.', 'Adding to positions': 'Adds to existing positions.',
    'Longer holds': 'Tends to hold positions longer.', 'Taking profits': 'Has reduced positions after gains.',
    'Recently inactive': 'No recent trading in the observed history.', 'Fast trades': 'Usually holds positions briefly.',
    'Regular trading': 'Trades regularly across the observed history.', 'Occasional trades': 'Trades less frequently.',
    'Early launch participation': 'Has traded early in token launches.', 'Repeat launch participant': 'Has participated in multiple launches.',
    'Repeat early buyer': 'Has repeatedly bought before substantial moves.',
    'Historically before followed traders': 'Has historically traded before widely followed wallets.',
    'Recurring trading group': 'Shows recurring participation alongside other wallets.',
    'Ecosystem specialist': 'Focuses its activity within a particular ecosystem.', 'Liquidity provider': 'Has provided market liquidity.',
    'Larger positions': 'Has taken larger positions.', 'Developer/launcher': 'Has created or launched tokens.',
    'Positions with recorded profits': 'Has recorded profitable closed positions.',
    'Patient top holders': 'Tends to remain among a token’s larger holders and hold positions for longer.',
  };
  const prefix = status === 'historical' ? 'Historical profile: ' : '';
  return (prefix + labels.slice(0,2).map(label => summaries[label]).join(' ')).slice(0,180);
}

export function publicWalletCard(profile, { now = Date.now(), copySetup = false, coreCard = null } = {}) {
  const identity = identityOf(profile.source_wallet || profile);
  // A current onchain refresh must never freshen an older research profile.
  if (coreCard) {
    const card = validatePublicWalletCard(coreCard);
    if (card.chain !== identity.chain || card.address !== identity.address) throw Error('wallet_card_identity_mismatch');
    return { ...card, actions: copySetup && identity.chain === 'solana' ? ['view_profile','open_copy_setup'] : ['view_profile'] };
  }
  const behavior = profile.behavior || {}, performance = profile.source_performance || {};
  const lastTrade = behavior.last_trade_at;
  const first = at(behavior.first_trade_at), last = at(lastTrade);
  const generated = at(profile.generated_at || profile.profile?.generated_at);
  const tradeCount = finite(behavior.trade_count), days = finite(behavior.active_days), hold = finite(behavior.median_hold_seconds);
  const closes = finite(performance.closed_observations ?? performance.closed_lots);
  const labels = [];
  const timelineValid = first !== null && last !== null && first <= last && last <= now && generated !== null && generated <= now && generated >= last;
  if (timelineValid && tradeCount >= 3 && days >= 2) {
    const spanDays = Math.max(1, (last-first)/86400000);
    if (tradeCount >= 10 && days >= 3 && days / spanDays >= .3) labels.push('Regular trading');
    else if (spanDays >= 14 && tradeCount / spanDays <= 1) labels.push('Occasional trades');
    if (closes >= 3 && hold !== null) {
      if (hold <= 300) labels.push('Fast trades');
      else if (hold >= 86400) labels.push('Longer holds');
    }
  }
  const pnl = performance.realized_pnl_by_basis || performance.realized_pnl || { usdc: performance.realized_pnl_usdc, sol: performance.realized_pnl_sol };
  const pnlValues = ['usdc','sol','eth','weth','usdg','bnb','wbnb'].map(key => pnl[key]);
  // Separate settlement bases; a positive MFE/score/proxy is never a PnL badge.
  if (timelineValid && closes >= 5 && pnlValues.some(value => finite(value) > 0)
    && pnlValues.every(value => finite(value) === null || finite(value) >= 0)) labels.push('Positions with recorded profits');
  const status = labels.length ? dataStatus(lastTrade, now) : 'limited';
  return { schema_version: 1, profile_id: opaqueId(identity), chain: identity.chain, address: identity.address,
    display_name: `${identity.address.slice(0,6)}…${identity.address.slice(-4)}`, categories: labels,
    summary: summaryFor(labels,status), data_status: status,
    actions: copySetup && identity.chain === 'solana' ? ['view_profile','open_copy_setup'] : ['view_profile'] };
}

export function publicWalletGroups(cards) {
  const groups = new Map();
  for (const raw of cards) {
    const card = validatePublicWalletCard(raw);
    for (const label of card.categories) {
      const key = `${card.chain}:${label}`;
      if (!groups.has(key)) groups.set(key, { group_id: `group_${createHash('sha256').update(key).digest('hex').slice(0,24)}`,
        chain: card.chain, title: label, profile_ids: [] });
      const group = groups.get(key);
      if (!group.profile_ids.includes(card.profile_id)) group.profile_ids.push(card.profile_id);
    }
  }
  return [...groups.values()];
}
