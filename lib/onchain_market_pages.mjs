import { createHash } from 'node:crypto';

export const ONCHAIN_MARKET_PAGE_SIZE = 500;
export function validOnchainMarketCursor(cursor) {
  if (!/^[a-f0-9]{24}\.[1-9]\d{0,4}$/.test(cursor || '')) return false;
  const offset = Number(cursor.split('.')[1]);
  return offset < 10_000 && offset % ONCHAIN_MARKET_PAGE_SIZE === 0;
}
export function onchainMarketPages(pulse) {
  const rows = pulse.rows || [];
  const snapshot = createHash('sha256').update(JSON.stringify([pulse.generated_at, pulse.chains, pulse.duration,
    rows.map(row => [row.instrument_id, row.observed_at])])).digest('hex').slice(0, 24);
  const pages = [];
  for (let offset = 0; offset < Math.max(1, rows.length); offset += ONCHAIN_MARKET_PAGE_SIZE) {
    const selected = rows.slice(offset, offset + ONCHAIN_MARKET_PAGE_SIZE);
    const next = offset + selected.length;
    pages.push({ ...pulse, rows: selected,
      discovery_radar: { ...pulse.discovery_radar, row_count: selected.length },
      pagination: { schema_version: 'ravenos.onchain_market_page.v1', snapshot_id: snapshot, offset,
        total_rows: rows.length, page_size: ONCHAIN_MARKET_PAGE_SIZE,
        next_cursor: next < rows.length ? `${snapshot}.${next}` : null },
    });
  }
  return pages;
}
