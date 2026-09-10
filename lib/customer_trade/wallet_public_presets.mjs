// Server-only mapping. Public navigation names do not expose the admission
// predicates or the internal research taxonomy used to build each list.
export const PublicWalletPresets = Object.freeze([
  Object.freeze({ id: 'trading_history', label: 'Trading history', internal_id: 'evidence_first' }),
  Object.freeze({ id: 'recorded_profits', label: 'Recorded profits', internal_id: 'consistent_winners' }),
  Object.freeze({ id: 'multiple_profits', label: 'Multiple profitable positions', internal_id: 'broad_edge' }),
  Object.freeze({ id: 'swing_trades', label: 'Swing trades', internal_id: 'active_swing' }),
  Object.freeze({ id: 'fast_trades', label: 'Fast trades', internal_id: 'fast_systematic' }),
]);

export function internalWalletPreset(id) {
  return PublicWalletPresets.find(row => row.id === id)?.internal_id || id;
}

export function publicWalletPresets(presets) {
  const available = new Set((presets || []).map(row => row.id));
  return PublicWalletPresets.filter(row => available.has(row.internal_id) || available.has(row.id))
    .map(({ id, label }) => ({ id, label }));
}
