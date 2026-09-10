const block = value => {
  if (!/^0x[0-9a-f]{1,16}$/i.test(value || '')) return null;
  const number = Number(BigInt(value));
  return Number.isSafeInteger(number) ? number : null;
};
const bounded = value => Number.isSafeInteger(value) && value >= 0;

// A scan head can move ahead of receipt verification. Only the verified prefix
// may use the archive opening inventory, including while its extension retries.
export function verifiedEvmHistoryWindow(cursor) {
  if (!cursor || cursor.verification_invalidated) return null;
  const from = block(cursor.from_block), through = block(cursor.verified_through_block), head = block(cursor.head);
  if (!bounded(from) || !bounded(through) || !bounded(head) || from > through || through > head
    || !Number.isFinite(Date.parse(cursor.verified_through_at))) return null;
  if (cursor.verified_from_block != null) {
    if (block(cursor.verified_from_block) !== from) return null;
  } else {
    // Earlier v1 cursors had an immutable from_block but no duplicate marker.
    // Upgrade only their completed window, before an extension advances its head.
    if (through !== head || cursor.direction !== 'done' || cursor.unresolved_references
      || !cursor.direction_states?.in?.completed || !cursor.direction_states?.out?.completed) return null;
  }
  if (through < head && block(cursor.scan_from_block) !== through + 1) return null;
  return { from_block: from, through_block: through, verified_at: cursor.verified_through_at };
}

export function evmBackfillAccountingHistory(cursor) {
  const verified = verifiedEvmHistoryWindow(cursor);
  return {
    opening_balances: cursor?.opening_balances || {},
    window_start_block: block(cursor?.from_block),
    window_end_block: verified?.through_block ?? block(cursor?.head),
    verified_window: verified,
    verified_through_at: verified?.verified_at || null,
    verification_invalidated: Boolean(cursor?.verification_invalidated),
  };
}

// Shared by scheduled reconstruction and balance refresh. Recompute from current
// retained receipts; neither an earlier profit total nor a newer balance is proof
// of missing inventory. A truncated prefix cannot borrow the archive opening lot.
export function selectEvmHistoryAccounting(events, history, analysisLimit) {
  const from = history?.window_start_block, through = history?.window_end_block;
  const boundsValid = bounded(from) && bounded(through) && from <= through;
  const proof = history?.verified_window;
  const verified = !history?.verification_invalidated && boundsValid && (proof
    ? proof.from_block === from && proof.through_block === through && Number.isFinite(Date.parse(proof.verified_at))
    : !Object.hasOwn(history || {}, 'verified_window') && (history?.backfill_state || history?.state) === 'complete'
      && !history?.unresolved_references && Number.isFinite(Date.parse(history?.verified_through_at || history?.coverage_end_at)));
  const scoped = events.filter(event => {
    const number = event.chain_evidence?.block_number;
    return !bounded(number) || ((!bounded(from) || number >= from) && (!bounded(through) || number <= through));
  });
  const intact = events.length < analysisLimit && scoped.every(event => event.wallet_accounting?.version === 1 && bounded(event.chain_evidence?.block_number));
  return {
    events: scoped.filter(event => event.wallet_accounting?.version === 1 && bounded(event.chain_evidence?.block_number)),
    openingBalances: verified && intact ? history?.opening_balances || {} : {},
    verifiedWindow: verified ? proof || {from_block:from,through_block:through,verified_at:history?.verified_through_at || history?.coverage_end_at || null} : null,
    analysisTruncated: events.length >= analysisLimit,
  };
}
