import assert from "node:assert/strict";
import test from "node:test";

import {
  DEXCH_DISCOVERY_STREAM_URL,
  DexchDiscoveryStream,
  dexchStreamChannel,
  normalizeDexchStreamFrame,
} from "../lib/dexch_discovery_stream.mjs";

const NOW = Date.parse("2026-09-03T20:00:00.000Z");
const TOKEN = "0x2112a316a2e56d7300092e5a41d2a84dd11d3bd6";

function tokenFrame(overrides = {}) {
  return {
    channel: `token:update:robinhood:${TOKEN}`,
    data: {
      chain: "robinhood",
      address: TOKEN,
      name: "Chart",
      symbol: "CHART",
      launchTime: "2026-09-03T19:00:00.000Z",
      lastActivityAt: "2026-09-03T19:59:59.000Z",
      txns24h: 10,
      holderCount: 4,
      ...overrides,
    },
  };
}

class FakeSocket extends EventTarget {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data) {
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

test("stream channels preserve exact token identity and global sampling semantics", () => {
  assert.equal(dexchStreamChannel("token:update"), "token:update");
  assert.equal(dexchStreamChannel("token:update", { chain: "robinhood", address: TOKEN }), `token:update:robinhood:${TOKEN}`);
  assert.throws(() => dexchStreamChannel("token:created", { chain: "robinhood", address: TOKEN }), /scope_invalid/);
  const global = normalizeDexchStreamFrame({ ...tokenFrame(), channel: "token:update" }, { receivedAtMs: NOW });
  assert.equal(global.scope, "rate_shaped_global_sample");
  assert.equal(global.completeness, "sampled_not_ledger_complete");
  assert.equal(global.execution_authority, false);
  const scoped = normalizeDexchStreamFrame(tokenFrame(), { receivedAtMs: NOW });
  assert.equal(scoped.scope, "scoped_token_provider_stream");
  assert.equal(scoped.token_address, TOKEN);
  assert.equal(scoped.canonical_asset_id, `eip155:4663/erc20:${TOKEN}`);
  assert.equal(scoped.raw_frame_exposed, false);
});

test("sampled trade frames retain exact asset identity without exposing the trader", () => {
  const event = normalizeDexchStreamFrame({
    channel: "trade:new",
    data: {
      chain: "robinhood",
      id: "provider-trade-1",
      tokenAddress: TOKEN,
      txHash: `0x${"ab".repeat(32)}`,
      trader: `0x${"cd".repeat(20)}`,
      side: "buy",
      source: "uniswap",
      amountToken: "1250.5",
      amountQuote: "0.25",
      priceUsd: "0.0002",
      volumeUsd: "25",
      timestamp: "2026-09-03T19:59:59.000Z",
    },
  }, { receivedAtMs: NOW });
  assert.equal(event.scope, "rate_shaped_global_sample");
  assert.equal(event.chain_id, "eip155:4663");
  assert.equal(event.token_address, TOKEN);
  assert.equal(event.canonical_asset_id, `eip155:4663/erc20:${TOKEN}`);
  assert.equal(event.provider_trade.side, "buy");
  assert.equal(event.provider_trade.volume_usd, 25);
  assert.equal(event.provider_trade.trader_address_exposed, false);
  assert.equal(JSON.stringify(event).includes(`0x${"cd".repeat(20)}`), false);
  assert.throws(() => normalizeDexchStreamFrame({
    channel: "trade:new",
    data: { chain: "robinhood", tokenAddress: TOKEN, side: "unknown" },
  }, { receivedAtMs: NOW }), /trade_side_invalid/);
});

test("stream client bounds subscriptions, suppresses duplicates, and reconnects with backoff", () => {
  const sockets = [];
  const scheduled = [];
  const events = [];
  const stream = new DexchDiscoveryStream({
    webSocketFactory(url) {
      assert.equal(url, DEXCH_DISCOVERY_STREAM_URL);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onEvent: (event) => events.push(event),
    now: () => NOW,
    schedule(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    cancel() {},
    maximumSubscriptions: 2,
  });
  stream.subscribe("token:created", `token:update:robinhood:${TOKEN}`);
  assert.throws(() => stream.subscribe("token:graduated"), /subscription_limit/);
  stream.start();
  sockets[0].open();
  assert.deepEqual(sockets[0].sent[0], {
    action: "subscribe",
    channels: ["token:created", `token:update:robinhood:${TOKEN}`],
  });
  const frame = JSON.stringify(tokenFrame());
  sockets[0].message(frame);
  sockets[0].message(frame);
  assert.equal(events.length, 1);
  assert.equal(stream.healthSnapshot().duplicate_frames, 1);
  sockets[0].close();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_000);
  scheduled[0].callback();
  assert.equal(sockets.length, 2);
  stream.stop();
  assert.equal(stream.healthSnapshot().state, "stopped");
});
