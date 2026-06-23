import assert from "node:assert/strict";
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlistItem,
  listWatchlists,
  watchlistLimits,
} from "../lib/ravenos_watchlists.mjs";

function memoryDb() {
  const watchlists = [];
  const items = [];
  return {
    watchlists,
    items,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => {
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlists")) {
                return { count: watchlists.filter((row) => row.user_id === params[0]).length };
              }
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlist_items")) {
                return { count: items.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]).length };
              }
              if (sql.includes("FROM watchlists")) {
                return watchlists.filter((row) => row.user_id === params[0]).sort((a, b) => a.created_at - b.created_at)[0] || null;
              }
              return null;
            },
            all: async () => {
              if (sql.includes("FROM watchlists")) return { results: watchlists.filter((row) => row.user_id === params[0]) };
              if (sql.includes("FROM watchlist_items")) return { results: items.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]) };
              return { results: [] };
            },
            run: async () => {
              if (sql.includes("INSERT INTO watchlists")) {
                watchlists.push({ id: params[0], user_id: params[1], name: params[2], created_at: params[3], updated_at: params[4] });
              } else if (sql.includes("INSERT INTO watchlist_items")) {
                const existing = items.find((row) => row.watchlist_id === params[1] && row.instrument === params[3] && row.market === params[4]);
                const next = {
                  id: existing?.id || params[0],
                  watchlist_id: params[1],
                  user_id: params[2],
                  instrument: params[3],
                  market: params[4],
                  price: params[5],
                  flow_score: params[6],
                  pressure_score: params[7],
                  replay_similarity: params[8],
                  risk: params[9],
                  coverage: params[10],
                  provider: params[11],
                  source_payload: params[12],
                  created_at: existing?.created_at || params[13],
                  updated_at: params[14],
                };
                if (existing) Object.assign(existing, next);
                else items.push(next);
              } else if (sql.includes("DELETE FROM watchlist_items")) {
                const idx = items.findIndex((row) => row.id === params[0] && row.user_id === params[1]);
                if (idx >= 0) items.splice(idx, 1);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

assert.deepEqual(watchlistLimits(["free"]), { watchlists: 1, itemsPerWatchlist: 5 });
assert.equal(watchlistLimits(["free", "pro"]).watchlists, 100);

const db = memoryDb();
const env = { RAVENOS_DB: db };
const list = await createWatchlist(env, { id: "wl_1", user_id: "wallet-free", name: "Primary" }, ["free"]);
assert.equal(list.name, "Primary");

await assert.rejects(
  () => createWatchlist(env, { id: "wl_2", user_id: "wallet-free", name: "Second" }, ["free"]),
  /watchlist_limit_reached/,
);

for (let i = 0; i < 5; i += 1) {
  await addWatchlistItem(env, {
    id: `item_${i}`,
    user_id: "wallet-free",
    watchlist_id: "wl_1",
    instrument: `ASSET-${i}`,
    market: "Crypto Spot",
    flowScore: 60 + i,
    risk: "Watch",
  }, ["free"]);
}

await assert.rejects(
  () => addWatchlistItem(env, { user_id: "wallet-free", watchlist_id: "wl_1", instrument: "ASSET-6", market: "Crypto Spot" }, ["free"]),
  /watchlist_item_limit_reached/,
);

const proItem = await addWatchlistItem(env, {
  user_id: "wallet-pro",
  instrument: "SOL-PERP",
  market: "Perpetual Futures",
  price: 69,
  flowScore: 84,
  coverage: "Live",
}, ["free", "pro"]);
assert.equal(proItem.instrument, "SOL-PERP");

const proLists = await listWatchlists(env, "wallet-pro");
assert.equal(proLists.length, 1);
assert.equal(proLists[0].items.length, 1);

await deleteWatchlistItem(env, "wallet-pro", proLists[0].items[0].id);
assert.equal((await listWatchlists(env, "wallet-pro"))[0].items.length, 0);
