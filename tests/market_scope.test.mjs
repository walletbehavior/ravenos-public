import test from "node:test";
import assert from "node:assert/strict";
import { instrumentMarketScope, marketScopeFromSearch, matchesMarketScope, participationMarketScope } from "../ravenos-market-scope.js";
import { contextFromSearch, createRavenOSContextStore } from "../ravenos-context-store.js";
import { buildDeskFrame } from "../ravenos-discover-intelligence.js";

const perp = { id: "hyperliquid:perp:BONK", label: "BONK-PERP", instrumentType: "perpetual", chain: "hyperliquid", marketType: "perp", tokenAddress: "", poolAddress: "" };
const spot = { id: "solana:pool:exact", label: "BONK/SOL", instrumentType: "exact_pool", chain: "solana", marketType: "spot", tokenAddress: "BonkToken", poolAddress: "exact" };

test("market family follows the exact instrument, including meme-named perps", () => {
  assert.equal(instrumentMarketScope(perp), "perps");
  assert.equal(instrumentMarketScope(spot), "memecoins");
  assert.equal(instrumentMarketScope({ instrument_id: "hyperliquid:perp:BONK", market_type: "spot" }), "perps");
  assert.equal(instrumentMarketScope({ instrument_id: "equity:nasdaq:tsla" }), "equities");
  assert.equal(instrumentMarketScope({ symbol: "BONK" }), null);
  assert.equal(matchesMarketScope({ symbol: "BONK" }, "memecoins"), false);
});
test("explicit section, legacy links and fixed market routes are deterministic", () => {
  assert.equal(marketScopeFromSearch("", "/discover/"), "memecoins");
  assert.equal(marketScopeFromSearch("?asset=SOL-PERP"), "perps");
  assert.equal(marketScopeFromSearch("?market_scope=memecoins", "/perps/"), "perps");
  assert.equal(marketScopeFromSearch("", "/atlas/", "perps"), "equities");
  assert.equal(marketScopeFromSearch("?market_scope=made-up", "", "perps"), "perps");
});
test("switching section clears the incompatible instrument and its read evidence", () => {
  const result = contextFromSearch("?market_scope=memecoins", { subject: perp, marketScope: "perps", detectionId: "prior-read", outcomeId: "prior-outcome" });
  assert.equal(result.subject.id, "unselected");
  assert.equal(result.detectionId, null);
  assert.equal(result.outcomeId, null);
  assert.equal(result.marketScope, "memecoins");
});
test("a new exact URL cannot inherit the old chain, token or pool", () => {
  const result = contextFromSearch("?instrument_id=hyperliquid:perp:BONK&instrument_type=perpetual&asset=BONK-PERP&chain=hyperliquid", { subject: spot });
  assert.equal(result.marketScope, "perps");
  assert.equal(result.subject.poolAddress, "");
  assert.equal(result.subject.tokenAddress, "");
  assert.equal(result.subject.chain, "hyperliquid");
});
function fixture() {
  const data = new Map(), events = new Map();
  return { data, events, location: { pathname: "/discover/", search: "", origin: "https://ravenos.xyz" }, localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }, addEventListener: (event, fn) => events.set(event, fn), history: { replaceState() {}, pushState() {} } };
}
test("navigation preserves a section while an explicit section switch discards foreign identity", () => {
  const windowRef = fixture(), store = createRavenOSContextStore({ windowRef });
  store.setSelection({ subject: perp }, { updateUrl: false });
  assert.equal(store.getState().marketScope, "perps");
  const regular = new URL(store.decorateHref("/discover/"), windowRef.location.origin);
  assert.equal(regular.searchParams.get("market_scope"), "perps");
  const switched = new URL(store.decorateHref("/discover/?market_scope=memecoins"), windowRef.location.origin);
  assert.equal(switched.searchParams.get("market_scope"), "memecoins");
  assert.equal(switched.searchParams.has("instrument_id"), false);
  const exact = new URL(store.decorateHref("/terminal/?instrument_id=solana:pool:exact&instrument_type=exact_pool&market=spot"), windowRef.location.origin);
  assert.equal(exact.searchParams.get("market_scope"), "memecoins");
  assert.equal(exact.searchParams.has("chain"), false);
});
test("another browser tab cannot switch the active section or active instrument", () => {
  const windowRef = fixture(), store = createRavenOSContextStore({ windowRef });
  store.setSelection({ subject: spot }, { updateUrl: false });
  windowRef.events.get("storage")({ key: "ravenos:selected-context:v2", newValue: JSON.stringify({ subject: perp, marketScope: "perps", history: [] }) });
  assert.equal(store.getState().marketScope, "memecoins");
  assert.equal(store.getState().subject.id, spot.id);
});
test("working/punishing cohorts preserve family identity and unknown cannot enter either section", () => {
  assert.equal(participationMarketScope({ insight_id: "participation:solana:fresh_pairs:rewarding" }), "memecoins");
  assert.equal(participationMarketScope({ chain: "hyperliquid", cap_band: "perps_majors" }), "perps");
  assert.equal(participationMarketScope({ subject: "All markets are working" }), null);
});
test("a memecoin desk never uses perp breadth or unscoped aggregate prose as fallback", () => {
  const frame = buildDeskFrame({ marketScope: "memecoins", brief: { one_sentence_read: "BTC-PERP is leading" }, markets: Array.from({ length: 6 }, () => ({ last_price: 1, day_notional_volume_usd: 100, day_change_pct: 2, open_interest_usd: 1000, funding_rate: .01 })), opportunityRows: [{ instrument_id: perp.id, market_type: "perpetual" }] });
  assert.deepEqual(frame.cards, []);
  assert.equal(frame.summary, "");
  assert.deepEqual(frame.signals, []);
});
