import { normalizeDexchToken } from "./dexch_discovery_provider.mjs";

export const DEXCH_DISCOVERY_STREAM_URL = "wss://api.dexch.art/ws";
export const DEXCH_DISCOVERY_STREAM_SCHEMA = "ravenos.dexch_stream_event.v1";

const GLOBAL_CHANNELS = new Set(["token:update", "trade:new", "token:created", "token:graduated"]);
const SCOPED_CHANNELS = new Set(["token:update", "trade:new"]);
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function clean(value, maximum = 180) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizedChain(value) {
  const chain = clean(value, 32).toLowerCase();
  if (!new Set(["solana", "robinhood", "bsc"]).has(chain)) throw new Error("dexch_stream_chain_unsupported");
  return chain;
}

function normalizedAddress(chain, value) {
  const address = clean(value, 80);
  const valid = chain === "solana" ? SOLANA_ADDRESS_RE.test(address) : EVM_ADDRESS_RE.test(address);
  if (!valid) throw new Error("dexch_stream_token_address_invalid");
  return chain === "solana" ? address : address.toLowerCase();
}

export function dexchStreamChannel(kind, { chain = null, address = null } = {}) {
  const channel = clean(kind, 40).toLowerCase();
  if (!GLOBAL_CHANNELS.has(channel)) throw new Error("dexch_stream_channel_unsupported");
  if (!chain && !address) return channel;
  if (!SCOPED_CHANNELS.has(channel) || !chain || !address) throw new Error("dexch_stream_scope_invalid");
  const canonicalChain = normalizedChain(chain);
  return `${channel}:${canonicalChain}:${normalizedAddress(canonicalChain, address)}`;
}

function parseChannel(value) {
  const channel = clean(value, 180);
  if (GLOBAL_CHANNELS.has(channel)) return { channel, kind: channel, scope: "rate_shaped_global_sample", chain: null, address: null };
  for (const kind of SCOPED_CHANNELS) {
    const prefix = `${kind}:`;
    if (!channel.startsWith(prefix)) continue;
    const [chainValue, addressValue, ...extra] = channel.slice(prefix.length).split(":");
    if (extra.length) break;
    const chain = normalizedChain(chainValue);
    const address = normalizedAddress(chain, addressValue);
    return { channel: `${kind}:${chain}:${address}`, kind, scope: "scoped_token_provider_stream", chain, address };
  }
  throw new Error("dexch_stream_channel_invalid");
}

function iso(value, fallbackMs) {
  const parsed = Date.parse(String(value || ""));
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString();
}

function eventDedupeKey(parsed, data, receivedAt) {
  const identity = clean(
    data?.id
    || data?.txHash
    || data?.transactionHash
    || data?.signature
    || `${data?.chain || parsed.chain || "unknown"}:${data?.address || data?.tokenAddress || parsed.address || "unknown"}`,
    220,
  );
  const timestamp = clean(data?.timestamp || data?.lastActivityAt || data?.migratedAt || data?.launchTime || receivedAt, 80);
  return `${parsed.channel}|${identity}|${timestamp}`;
}

export function normalizeDexchStreamFrame(input, { receivedAtMs = Date.now() } = {}) {
  let frame;
  try {
    frame = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("dexch_stream_frame_invalid_json");
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame) || !frame.data || typeof frame.data !== "object" || Array.isArray(frame.data)) {
    throw new Error("dexch_stream_frame_invalid");
  }
  const parsed = parseChannel(frame.channel);
  const receivedAt = new Date(receivedAtMs).toISOString();
  const data = { ...frame.data };
  data.chain = data.chain || parsed.chain;
  data.address = data.address || data.tokenAddress || parsed.address;
  const token = normalizeDexchToken(data, {
    endpoint: `websocket:${parsed.channel}`,
    retrievedAt: receivedAt,
    nowMs: receivedAtMs,
  });
  if (!token) throw new Error("dexch_stream_token_identity_unavailable");
  if (parsed.chain && (token.chain !== parsed.chain || token.address !== parsed.address)) {
    throw new Error("dexch_stream_token_identity_mismatch");
  }
  const eventAt = iso(data.timestamp || data.lastActivityAt || data.migratedAt || data.launchTime, receivedAtMs);
  const side = clean(data.side, 12).toLowerCase();
  if (parsed.kind === "trade:new" && !new Set(["buy", "sell"]).has(side)) {
    throw new Error("dexch_stream_trade_side_invalid");
  }
  const trade = parsed.kind === "trade:new" ? Object.freeze({
    provider_trade_id: clean(data.id, 220) || null,
    transaction_hash: clean(data.txHash || data.transactionHash || data.signature, 220) || null,
    side,
    source: clean(data.source, 60) || null,
    token_amount: Number.isFinite(Number(data.amountToken)) && Number(data.amountToken) >= 0 ? Number(data.amountToken) : null,
    quote_amount: Number.isFinite(Number(data.amountQuote)) && Number(data.amountQuote) >= 0 ? Number(data.amountQuote) : null,
    price_usd: Number.isFinite(Number(data.priceUsd)) && Number(data.priceUsd) >= 0 ? Number(data.priceUsd) : null,
    volume_usd: Number.isFinite(Number(data.volumeUsd)) && Number(data.volumeUsd) >= 0 ? Number(data.volumeUsd) : null,
    observed_at: eventAt,
    trader_address_exposed: false,
  }) : null;
  return Object.freeze({
    schema_version: DEXCH_DISCOVERY_STREAM_SCHEMA,
    provider: "dexch",
    channel: parsed.channel,
    event_type: parsed.kind,
    scope: parsed.scope,
    completeness: parsed.scope === "rate_shaped_global_sample"
      ? "sampled_not_ledger_complete"
      : "every_provider_frame_claim_not_chain_complete",
    chain: token.chain,
    chain_id: token.chain_id,
    token_address: token.address,
    canonical_asset_id: token.canonical_identity?.asset_id || null,
    event_at: eventAt,
    received_at: receivedAt,
    provider_token: token,
    provider_trade: trade,
    dedupe_key: eventDedupeKey(parsed, data, receivedAt),
    raw_frame_exposed: false,
    raven_verified: false,
    current_price_authority: false,
    execution_authority: false,
  });
}

export class DexchDiscoveryStream {
  constructor({
    webSocketFactory,
    onEvent = () => {},
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (handle) => clearTimeout(handle),
    maximumSubscriptions = 64,
    maximumDedupeEntries = 2_048,
  } = {}) {
    if (typeof webSocketFactory !== "function") throw new TypeError("dexch_websocket_factory_required");
    if (typeof onEvent !== "function") throw new TypeError("dexch_stream_event_handler_required");
    this.webSocketFactory = webSocketFactory;
    this.onEvent = onEvent;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.maximumSubscriptions = Math.max(1, Math.min(256, Number(maximumSubscriptions) || 64));
    this.maximumDedupeEntries = Math.max(32, Math.min(10_000, Number(maximumDedupeEntries) || 2_048));
    this.subscriptions = new Set();
    this.seen = new Map();
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.running = false;
    this.health = {
      state: "stopped",
      connected_at: null,
      last_frame_at: null,
      last_error_at: null,
      last_error_code: null,
      received_frames: 0,
      emitted_events: 0,
      duplicate_frames: 0,
      invalid_frames: 0,
      reconnects: 0,
    };
  }

  subscribe(...channels) {
    const normalized = channels.flat().map((channel) => parseChannel(channel).channel);
    const next = new Set([...this.subscriptions, ...normalized]);
    if (next.size > this.maximumSubscriptions) throw new Error("dexch_stream_subscription_limit");
    const added = normalized.filter((channel) => !this.subscriptions.has(channel));
    added.forEach((channel) => this.subscriptions.add(channel));
    if (added.length && this.socket?.readyState === 1) this.send("subscribe", added);
    return Object.freeze([...this.subscriptions]);
  }

  unsubscribe(...channels) {
    const removed = channels.flat().map((channel) => parseChannel(channel).channel).filter((channel) => this.subscriptions.delete(channel));
    if (removed.length && this.socket?.readyState === 1) this.send("unsubscribe", removed);
    return Object.freeze([...this.subscriptions]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    if (this.reconnectTimer !== null) this.cancel(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close?.(1000, "client_stop"); } catch { /* no-op */ }
    this.health.state = "stopped";
  }

  connect() {
    if (!this.running || this.socket) return;
    let socket;
    try {
      socket = this.webSocketFactory(DEXCH_DISCOVERY_STREAM_URL);
    } catch {
      this.noteError("dexch_stream_connect_failed");
      this.queueReconnect();
      return;
    }
    this.socket = socket;
    this.health.state = "connecting";
    socket.addEventListener("open", () => {
      if (socket !== this.socket) return;
      this.reconnectAttempt = 0;
      this.health.state = "connected";
      this.health.connected_at = new Date(this.now()).toISOString();
      if (this.subscriptions.size) this.send("subscribe", [...this.subscriptions]);
    });
    socket.addEventListener("message", (message) => {
      if (socket !== this.socket) return;
      this.health.received_frames += 1;
      this.health.last_frame_at = new Date(this.now()).toISOString();
      try {
        const event = normalizeDexchStreamFrame(message?.data, { receivedAtMs: this.now() });
        if (this.seen.has(event.dedupe_key)) {
          this.health.duplicate_frames += 1;
          return;
        }
        this.seen.set(event.dedupe_key, this.now());
        while (this.seen.size > this.maximumDedupeEntries) this.seen.delete(this.seen.keys().next().value);
        this.health.emitted_events += 1;
        this.onEvent(event);
      } catch (error) {
        this.health.invalid_frames += 1;
        this.noteError(clean(error?.message, 100) || "dexch_stream_frame_invalid");
      }
    });
    const disconnected = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (this.running) {
        this.health.state = "reconnecting";
        this.queueReconnect();
      }
    };
    socket.addEventListener("close", disconnected);
    socket.addEventListener("error", () => this.noteError("dexch_stream_socket_error"));
  }

  send(action, channels) {
    if (!this.socket || this.socket.readyState !== 1 || !channels.length) return false;
    this.socket.send(JSON.stringify({ action, channels }));
    return true;
  }

  noteError(code) {
    this.health.last_error_at = new Date(this.now()).toISOString();
    this.health.last_error_code = clean(code, 100) || "dexch_stream_error";
  }

  queueReconnect() {
    if (!this.running || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    this.health.reconnects += 1;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(5, this.reconnectAttempt - 1)));
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  healthSnapshot({ staleAfterMs = 60_000 } = {}) {
    const lastFrameMs = Date.parse(this.health.last_frame_at || "");
    const stale = this.health.state === "connected"
      && Number.isFinite(lastFrameMs)
      && this.now() - lastFrameMs > Math.max(1_000, Number(staleAfterMs) || 60_000);
    return Object.freeze({
      schema_version: "ravenos.provider_stream_health.dexch.v1",
      provider: "dexch",
      ...this.health,
      state: stale ? "stale" : this.health.state,
      subscriptions: this.subscriptions.size,
      dedupe_entries: this.seen.size,
      global_stream_completeness: "sampled_not_ledger_complete",
      scoped_stream_completeness: "every_provider_frame_claim_not_chain_complete",
      heartbeat_protocol: "not_documented_no_application_ping_sent",
    });
  }
}
