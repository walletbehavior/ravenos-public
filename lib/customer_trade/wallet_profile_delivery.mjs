import { createHash } from "node:crypto";

export const WalletHoldingsDeliveryLimits = Object.freeze({ rows: 50, page_bytes: 48 * 1024 });
const encoder = new TextEncoder();

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

const tokenId = (row) => String(row?.mint || row?.contract || "");

// Only the response is paged. The immutable stored profile, aggregate values,
// cost basis and history retain every observation used by the analysis.
export function walletHoldingsPage(profile, { cursor = null } = {}) {
  const snapshot = profile?.holdings_snapshot;
  const rows = snapshot?.tokens || profile?.positions?.provider_reported_token_balances || [];
  if (!Array.isArray(rows)) fail("wallet_holdings_snapshot_invalid");
  const markCoverage = snapshot?.mark_coverage || profile?.mark_coverage;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    source: profile.source_wallet,
    observed_at: snapshot?.observed_at ?? profile.balances_observed_at ?? profile.generated_at,
    rows,
    mark_coverage: markCoverage,
  })).digest("hex");
  let offset = 0;
  if (cursor !== null) {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,240}$/.test(cursor)) fail("wallet_holdings_cursor_invalid");
    let decoded;
    try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { fail("wallet_holdings_cursor_invalid"); }
    if (decoded?.v !== 1 || !/^[a-f0-9]{64}$/.test(decoded.snapshot || "")
      || !Number.isSafeInteger(decoded.offset) || decoded.offset < 1) fail("wallet_holdings_cursor_invalid");
    if (decoded.snapshot !== fingerprint) fail("wallet_holdings_snapshot_changed");
    offset = decoded.offset;
    if (offset >= rows.length) fail("wallet_holdings_cursor_invalid");
  }
  const ordered = [...rows].sort((a, b) => {
    const aValue = Number.isFinite(a?.provider_mark_value_usd) ? a.provider_mark_value_usd : -1;
    const bValue = Number.isFinite(b?.provider_mark_value_usd) ? b.provider_mark_value_usd : -1;
    return bValue - aValue || tokenId(a).localeCompare(tokenId(b));
  });
  const tokens = [];
  let bytes = 0;
  for (const row of ordered.slice(offset, offset + WalletHoldingsDeliveryLimits.rows)) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
    if (rowBytes > WalletHoldingsDeliveryLimits.page_bytes) fail("wallet_holdings_row_too_large");
    if (bytes + rowBytes > WalletHoldingsDeliveryLimits.page_bytes) break;
    tokens.push(row);
    bytes += rowBytes;
  }
  const end = offset + tokens.length;
  const visibleIds = new Set(tokens.map(tokenId));
  return {
    tokens,
    mark_unavailable: (markCoverage?.unavailable || []).filter(row => visibleIds.has(tokenId(row))),
    pagination: {
      snapshot: fingerprint,
      total: rows.length,
      offset,
      returned: tokens.length,
      has_more: end < rows.length,
      next_cursor: end < rows.length ? Buffer.from(JSON.stringify({ v: 1, snapshot: fingerprint, offset: end })).toString("base64url") : null,
      observed_at: snapshot?.observed_at ?? profile.balances_observed_at ?? profile.generated_at ?? null,
      scope: "retained_holdings_snapshot",
    },
  };
}

export function projectWalletProfileDelivery(profile) {
  if (!profile?.source_wallet) return profile;
  const { retained_lookup: retainedLookup, ...projected } = profile;
  const page = walletHoldingsPage(projected);
  projected.holdings_page = page.pagination;
  if (Array.isArray(projected.holdings_snapshot?.tokens)) {
    projected.holdings_snapshot = { ...projected.holdings_snapshot, tokens: page.tokens };
    if (projected.holdings_snapshot.mark_coverage) projected.holdings_snapshot.mark_coverage = {
      ...projected.holdings_snapshot.mark_coverage, unavailable: page.mark_unavailable,
    };
  } else if (Array.isArray(projected.positions?.provider_reported_token_balances)) {
    projected.positions = { ...projected.positions, provider_reported_token_balances: page.tokens };
    if (projected.mark_coverage) projected.mark_coverage = { ...projected.mark_coverage, unavailable: page.mark_unavailable };
  }
  return projected;
}
