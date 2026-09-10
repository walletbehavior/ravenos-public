import { createHash } from 'node:crypto';
import { normalizeSourceWalletChainIdentity, SourceWalletChainRegistry } from './source_wallet_chain_identity.mjs';

export const PUBLIC_WALLET_SNAPSHOT_SCHEMA = 'ravenos.public_wallet_cards.v2';
export const PUBLIC_WALLET_GROUP_PAGE_SCHEMA = 'ravenos.wallet_groups.v2';
export const PublicWalletSnapshotLimits = Object.freeze({ maxBytes: 8*1024*1024, cards: 10_000, groups: 200, memberships: 60_000, pageSize: 24,
  minimumMembers: 10, maximumMembers: 50, maxCurrentSnapshotAgeMs: 5*60_000 });

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
const explicitTime = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || at(value) === null) return false;
  const day = new Date(`${value.slice(0,10)}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value.slice(0,10);
};
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const opaqueId = identity => `wallet_${createHash('sha256').update(`${identity.chain}:${identity.address}`).digest('hex').slice(0,32)}`;
const identityOf = value => normalizeSourceWalletChainIdentity({ chain: value.chain, network: 'mainnet', address: value.address });

// Public contract validation is intentionally independent of internal theories.
// New sources can participate through the same approved projection without
// shipping their own taxonomy, free-form explanations or confidence formulas.
export function validatePublicWalletCard(input) {
  const fields = ['schema_version','profile_id','chain','address','display_name','categories','summary','data_status','actions'];
  if (input?.schema_version === 2) fields.push('expires_at');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw Error('wallet_card_invalid');
  const identity = identityOf(input);
  if (![1,2].includes(input.schema_version) || (input.schema_version === 2 && !explicitTime(input.expires_at))
    || !/^wallet_[A-Za-z0-9_-]{1,93}$/.test(input.profile_id || '')
    || !statuses.has(input.data_status) || !Array.isArray(input.categories) || input.categories.length > 6
    || input.categories.some(value => !categories.has(value)) || new Set(input.categories).size !== input.categories.length
    || !Array.isArray(input.actions) || input.actions.length > 2 || new Set(input.actions).size !== input.actions.length
    || input.actions.some(value => !['view_profile','open_copy_setup'].includes(value))) throw Error('wallet_card_invalid');
  for (const [key,max] of [['display_name',80],['summary',180]]) {
    if (typeof input[key] !== 'string' || input[key].length > max || (key === 'display_name' && !input[key].trim())
      || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(input[key])) throw Error('wallet_card_invalid');
  }
  return { schema_version: input.schema_version, ...(input.schema_version === 2 ? {expires_at:input.expires_at} : {}), profile_id: input.profile_id, chain: identity.chain, address: identity.address,
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
    if (card.schema_version === 2 && at(card.expires_at) <= now) card.data_status = 'historical';
    return { ...card, summary: summaryFor(card.categories,card.data_status),
      actions: copySetup && identity.chain === 'solana' && card.actions.includes('open_copy_setup') ? ['view_profile','open_copy_setup'] : ['view_profile'] };
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

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value,key))) throw Error('wallet_snapshot_invalid');
}
const groupId = value => typeof value === 'string' && /^group_[A-Za-z0-9_-]{1,94}$/.test(value);
const plain = (value,max) => typeof value === 'string' && value.trim() && value.length <= max
  && !/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);

// The snapshot is a separate, strict public document. A generic origin wrapper
// is not a privacy boundary, and generated_at cannot renew individual claims.
export function validatePublicWalletSnapshot(input, { now = Date.now() } = {}) {
  exactFields(input,['schema_version','generated_at','cards','groups']);
  const generated = at(input.generated_at);
  if (input.schema_version !== PUBLIC_WALLET_SNAPSHOT_SCHEMA || !explicitTime(input.generated_at)
    || generated === null || generated > now || !Array.isArray(input.cards) || input.cards.length > PublicWalletSnapshotLimits.cards
    || !Array.isArray(input.groups) || input.groups.length > PublicWalletSnapshotLimits.groups) throw Error('wallet_snapshot_invalid');
  const cards = [], byId = new Map(), identities = new Set(), groupIds = new Set();
  for (const row of input.cards) {
    const card = validatePublicWalletCard(row), identity = `${card.chain}:${card.address}`;
    if (card.schema_version !== 2 || card.chain !== row.chain || byId.has(card.profile_id) || identities.has(identity)) throw Error('wallet_snapshot_invalid');
    const age = now-generated;
    if (card.data_status === 'current' && age > 2*3600000) card.data_status = 'recent';
    if (['current','recent'].includes(card.data_status) && age > 7*86400000) card.data_status = 'historical';
    if (at(card.expires_at) <= now) card.data_status = 'historical';
    card.summary = summaryFor(card.categories,card.data_status);
    byId.set(card.profile_id,card); identities.add(identity); cards.push(card);
  }
  let memberships = 0;
  const groups = input.groups.map(row => {
    exactFields(row,['group_id','title','chain','profile_ids']);
    if (!groupId(row.group_id) || groupIds.has(row.group_id) || !plain(row.title,80)
      || (row.chain !== 'all' && !Object.hasOwn(SourceWalletChainRegistry,row.chain)) || !Array.isArray(row.profile_ids)
      || row.profile_ids.length > PublicWalletSnapshotLimits.cards || new Set(row.profile_ids).size !== row.profile_ids.length
      || row.profile_ids.some(id => !byId.has(id) || (row.chain !== 'all' && byId.get(id).chain !== row.chain))) throw Error('wallet_snapshot_invalid');
    memberships += row.profile_ids.length;
    if (memberships > PublicWalletSnapshotLimits.memberships) throw Error('wallet_snapshot_invalid');
    groupIds.add(row.group_id);
    return { group_id: row.group_id, title: row.title, chain: row.chain, profile_ids: [...row.profile_ids] };
  });
  return { schema_version: PUBLIC_WALLET_SNAPSHOT_SCHEMA, generated_at: input.generated_at, cards, groups };
}

export function normalizeWalletGroupQuery(params) {
  const allowed = ['chain','group_id','page','page_size','history'];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw Error('wallet_group_query_invalid');
  const chain = params.get('chain') || 'all', id = params.get('group_id') || null, history = params.get('history') || 'recent';
  const pageText = params.get('page') || '1', sizeText = params.get('page_size') || '12';
  if ((chain !== 'all' && !Object.hasOwn(SourceWalletChainRegistry,chain)) || (id && !groupId(id))
    || !['recent','all'].includes(history) || !/^[1-9]\d{0,3}$/.test(pageText) || !/^[1-9]\d?$/.test(sizeText)) throw Error('wallet_group_query_invalid');
  const page = Number(pageText), page_size = Number(sizeText);
  if (page > PublicWalletSnapshotLimits.cards || page_size > PublicWalletSnapshotLimits.pageSize) throw Error('wallet_group_query_invalid');
  return { chain, group_id: id, page, page_size, history };
}

export function publicWalletGroupPage(input, query, { now = Date.now(), copySetup = false } = {}) {
  const snapshot = validatePublicWalletSnapshot(input,{now});
  const snapshotDeadline = at(snapshot.generated_at) + PublicWalletSnapshotLimits.maxCurrentSnapshotAgeMs;
  const stale = query.history === 'recent' && snapshotDeadline <= now;
  const cards = new Map(snapshot.cards.filter(card => (query.chain === 'all' || card.chain === query.chain)
    && (query.history === 'all' || (!stale && ['current','recent'].includes(card.data_status) && at(card.expires_at) > now))).map(card => [card.profile_id,card]));
  const groups = snapshot.groups.filter(group => group.chain === query.chain)
    .map(group => ({...group,profile_ids:group.profile_ids.filter(id=>cards.has(id)).slice(0,PublicWalletSnapshotLimits.maximumMembers)}));
  const ready = group => group.profile_ids.length >= PublicWalletSnapshotLimits.minimumMembers;
  const available = groups.filter(ready);
  // A disappearing selection must not quietly switch the user to another list.
  const selected = query.group_id ? groups.find(group=>group.group_id===query.group_id) : available[0];
  const ids = selected && ready(selected) ? selected.profile_ids : [];
  const page = Math.min(query.page,Math.max(1,Math.ceil(ids.length/query.page_size))), start = (page-1)*query.page_size;
  const deadlines = query.history === 'recent' ? [snapshotDeadline,...available.flatMap(group=>group.profile_ids.map(id=>at(cards.get(id).expires_at)))] : [];
  return { ok: true, schema_version: PUBLIC_WALLET_GROUP_PAGE_SCHEMA, state: stale ? 'stale' : ids.length ? 'available' : groups.length ? 'building' : 'empty',
    generated_at: snapshot.generated_at, as_of:new Date(now).toISOString(), valid_until:deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null,
    scope: { chain: query.chain, history: query.history },
    groups: available.map(group=>({group_id:group.group_id,title:group.title,chain:group.chain,count:group.profile_ids.length})),
    selected_group_id: selected?.group_id || query.group_id || null,
    selected_group: selected ? {group_id:selected.group_id,title:selected.title,chain:selected.chain} : null,
    cards: ids.slice(start,start+query.page_size).map(id=>publicWalletCard(cards.get(id),{now,copySetup,coreCard:cards.get(id)})),
    pagination: { page, page_size: query.page_size, total: ids.length, total_pages: Math.ceil(ids.length/query.page_size),
      has_previous: page>1, has_next: start+query.page_size<ids.length } };
}
