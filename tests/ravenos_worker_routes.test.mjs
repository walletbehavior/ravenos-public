import assert from "node:assert/strict";
import worker from "../worker.mjs";

const assetResponse = new Response("asset", { status: 200 });
const env = {
  ASSETS: { fetch: async () => assetResponse },
  RAVENOS_MARKET_CAP_STAGE: "growth",
  RAVENOS_PRO_THRESHOLD_GROWTH: "500000",
  RAVENOS_FOUNDER_THRESHOLD: "10000000",
};

const noWallet = await worker.fetch(new Request("https://ravenos.xyz/api/access"), env);
assert.equal(noWallet.status, 200);
const noWalletPayload = await noWallet.json();
assert.equal(noWalletPayload.tier, "free");
assert.equal(noWalletPayload.status, "disconnected");
assert.equal(noWalletPayload.tokenAccessConfigured, false);
assert.equal(noWalletPayload.thresholds.pro, 500_000);

const wallet = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=abc"), env);
assert.equal(wallet.status, 200);
const walletPayload = await wallet.json();
assert.equal(walletPayload.tier, "free");
assert.equal(walletPayload.wallet, "abc");
assert.equal(walletPayload.tokenAccessStatus, "not_configured");

const atlasEnv = {
  ...env,
  RAVENOS_DB: {
    prepare() {
      return {
        bind() {
          return {
            first: async () => ({
              status: "active",
              plan_type: "atlas_monthly",
              current_period_end: 1_800_000_000,
            }),
          };
        },
      };
    },
  },
};
const atlasWallet = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=atlas-wallet"), atlasEnv);
assert.equal(atlasWallet.status, 200);
const atlasPayload = await atlasWallet.json();
assert.equal(atlasPayload.tier, "atlas");
assert.equal(atlasPayload.reason, "Atlas Subscription");
assert.equal(atlasPayload.subscription.plan_type, "atlas_monthly");

const dotPath = await worker.fetch(new Request("https://ravenos.xyz/.git/HEAD"), env);
assert.equal(dotPath.status, 404);

const staticAsset = await worker.fetch(new Request("https://ravenos.xyz/terminal/"), env);
assert.equal(staticAsset.status, 200);
assert.equal(await staticAsset.text(), "asset");

function alertDb() {
  const alerts = [];
  const watchlists = [];
  const watchlistItems = [];
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => {
              if (sql.includes("FROM subscriptions")) {
                return {
                  user_id: params[0],
                  wallet_public_key: params[0],
                  status: "active",
                  plan_type: "monthly",
                  current_period_end: 1_800_000_000,
                };
              }
              if (sql.includes("FROM alerts")) return alerts.find((row) => row.id === params[0] && row.user_id === params[1]) || null;
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlists")) return { count: watchlists.filter((row) => row.user_id === params[0]).length };
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlist_items")) return { count: watchlistItems.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]).length };
              if (sql.includes("FROM watchlists")) return watchlists.filter((row) => row.user_id === params[0])[0] || null;
              return null;
            },
            all: async () => {
              if (sql.includes("FROM alerts")) return { results: alerts.filter((row) => row.user_id === params[0]) };
              if (sql.includes("FROM alert_events")) return { results: [] };
              if (sql.includes("FROM watchlists")) return { results: watchlists.filter((row) => row.user_id === params[0]) };
              if (sql.includes("FROM watchlist_items")) return { results: watchlistItems.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]) };
              return { results: [] };
            },
            run: async () => {
              if (sql.includes("INSERT INTO alerts")) {
                alerts.push({
                  id: params[0],
                  user_id: params[1],
                  instrument: params[2],
                  market: params[3],
                  alert_type: params[4],
                  condition: params[5],
                  threshold: params[6],
                  enabled: params[7],
                  created_at: params[8],
                  updated_at: params[9],
                });
              } else if (sql.includes("UPDATE alerts SET")) {
                const row = alerts.find((item) => item.id === params[7] && item.user_id === params[8]);
                if (row) Object.assign(row, { enabled: params[5], updated_at: params[6] });
              } else if (sql.includes("DELETE FROM alerts")) {
                const idx = alerts.findIndex((row) => row.id === params[0] && row.user_id === params[1]);
                if (idx >= 0) alerts.splice(idx, 1);
              } else if (sql.includes("INSERT INTO watchlists")) {
                watchlists.push({ id: params[0], user_id: params[1], name: params[2], created_at: params[3], updated_at: params[4] });
              } else if (sql.includes("INSERT INTO watchlist_items")) {
                watchlistItems.push({
                  id: params[0],
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
                  created_at: params[13],
                  updated_at: params[14],
                });
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

const alertEnv = { ...env, RAVENOS_DB: alertDb() };
const alertsList = await worker.fetch(new Request("https://ravenos.xyz/api/alerts?wallet=pro-wallet"), alertEnv);
assert.equal(alertsList.status, 200);
assert.deepEqual((await alertsList.json()).alerts, []);

const createdAlert = await worker.fetch(new Request("https://ravenos.xyz/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: "pro-wallet",
    instrument: "SOL-PERP",
    market: "Perpetual Futures",
    alert_type: "pressure_score_crosses_threshold",
    condition: "crosses_above",
    threshold: 75,
  }),
}), alertEnv);
assert.equal(createdAlert.status, 201);
const createdAlertPayload = await createdAlert.json();
assert.equal(createdAlertPayload.alert.instrument, "SOL-PERP");
assert.equal(createdAlertPayload.access.tier, "pro");

const events = await worker.fetch(new Request("https://ravenos.xyz/api/alerts/events?wallet=pro-wallet"), alertEnv);
assert.equal(events.status, 200);
assert.deepEqual((await events.json()).events, []);

const unavailableAlert = await worker.fetch(new Request("https://ravenos.xyz/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: "pro-wallet",
    instrument: "SOL-PERP",
    market: "Perpetual Futures",
    alert_type: "pressure_score_crosses_threshold",
    threshold: 75,
  }),
}), env);
assert.equal(unavailableAlert.status, 503);
assert.equal((await unavailableAlert.json()).error, "alerts_db_unavailable");

const watchlistCreate = await worker.fetch(new Request("https://ravenos.xyz/api/watchlists", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: "pro-wallet", name: "Perps" }),
}), alertEnv);
assert.equal(watchlistCreate.status, 201);
const watchlistCreatePayload = await watchlistCreate.json();
assert.equal(watchlistCreatePayload.watchlist.name, "Perps");

const watchlistItem = await worker.fetch(new Request(`https://ravenos.xyz/api/watchlists/${watchlistCreatePayload.watchlist.id}/items`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: "pro-wallet", instrument: "SOL-PERP", market: "Perpetual Futures", flowScore: 84 }),
}), alertEnv);
assert.equal(watchlistItem.status, 201);
assert.equal((await watchlistItem.json()).item.instrument, "SOL-PERP");

const watchlistsList = await worker.fetch(new Request("https://ravenos.xyz/api/watchlists?wallet=pro-wallet"), alertEnv);
assert.equal(watchlistsList.status, 200);
assert.equal((await watchlistsList.json()).watchlists[0].items.length, 1);
