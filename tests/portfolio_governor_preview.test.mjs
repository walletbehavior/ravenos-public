import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import { sha256 } from "../lib/customer_identity.mjs";
import { createUserPolicyVersion } from "../lib/portfolio_governor/domain.mjs";
import {
  analyzeSolanaPortfolioPreview,
  authorizedPortfolioPreviewWallets,
  PORTFOLIO_GOVERNOR_PREVIEW_ROUTE,
  PortfolioGovernorPreviewLimits,
  routePortfolioGovernorPreview,
} from "../lib/portfolio_governor/preview.mjs";
import {
  createPortfolioSolanaRpcRequest,
  fetchPortfolioExecutableObservations,
  fetchPortfolioPriceObservations,
  groupPortfolioExecutableCandidates,
  PortfolioPreviewProviderLimits,
  priceToMarkRatio,
} from "../lib/portfolio_governor/solana_preview_provider.mjs";
import {
  SOLANA_TOKEN_PROGRAMS,
  SOLANA_USDC_MINT,
  SOLANA_WRAPPED_SOL_MINT,
} from "../lib/portfolio_governor/solana_exposure.mjs";
import { runAuthorizedLiveValidation } from "../scripts/validate-portfolio-governor-live.mjs";

const ORIGIN = "https://app.ravenos.xyz";
const USER_ID = `usr_${"a".repeat(32)}`;
const SESSION_ID = `sespub_${"b".repeat(24)}`;
const RAW_SESSION = `ses_${"c".repeat(44)}`;
const RAW_CSRF = `csrf_${"d".repeat(44)}`;
const NOW_MS = Date.parse("2026-08-26T20:00:00.000Z");

function publicKey(seed) {
  return bs58.encode(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256));
}

const WALLET_ADDRESS = publicKey(10);
const WALLET_REFERENCE = "wpr_owner_beta_wallet_001";
const UNKNOWN_MINT = publicKey(70);
const TOKEN_2022_MINT = publicKey(90);

function tokenAccount({ accountSeed, mint, amount, decimals = 6, state = "initialized" }) {
  return {
    pubkey: publicKey(accountSeed),
    account: {
      data: {
        parsed: {
          info: {
            mint,
            state,
            tokenAmount: { amount, decimals, uiAmountString: null },
          },
        },
      },
    },
  };
}

class MemoryStore {
  constructor({ userId = USER_ID, sessionLimitOffset = 0 } = {}) {
    this.userId = userId;
    this.sessionLimitOffset = sessionLimitOffset;
    this.sessions = new Map();
    this.rateCounts = new Map();
    this.rateRows = [];
    this.events = [];
  }

  async seed() {
    this.sessions.set(await sha256(RAW_SESSION), {
      session_public_id: SESSION_ID,
      session_verifier: await sha256(RAW_SESSION),
      csrf_verifier: await sha256(RAW_CSRF),
      user_id: this.userId,
      credential_id: `crd_${"e".repeat(24)}`,
      user_state: "active",
      revoked_at: null,
      created_at: Math.floor(NOW_MS / 1000) - 60,
      authenticated_at: Math.floor(NOW_MS / 1000) - 60,
      last_seen_at: Math.floor(NOW_MS / 1000) - 20,
      idle_expires_at: Math.floor(NOW_MS / 1000) + 1_000,
      absolute_expires_at: Math.floor(NOW_MS / 1000) + 10_000,
      authentication_methods: JSON.stringify(["GoogleOAuth"]),
      authentication_strength: "federated",
      device_label: "Test browser",
      primary_email: "preview@example.com",
      display_name: "Preview Tester",
      user_created_at: Math.floor(NOW_MS / 1000) - 1_000,
    });
    return this;
  }

  async findSession(verifier) {
    return this.sessions.get(verifier) || null;
  }

  async touchSession(publicId, now, idleExpiresAt, csrfVerifier = null) {
    const row = [...this.sessions.values()].find((candidate) => candidate.session_public_id === publicId);
    if (!row) return;
    row.last_seen_at = now;
    row.idle_expires_at = idleExpiresAt;
    if (csrfVerifier) row.csrf_verifier = csrfVerifier;
  }

  async revokeSession() {
    return false;
  }

  async recordEvent(event) {
    this.events.push(event);
  }

  async rateLimit({ rateKey, action, windowSeconds, limit }) {
    const key = `${rateKey}:${action}`;
    const next = (this.rateCounts.get(key) || 0) + 1 + this.sessionLimitOffset;
    this.rateCounts.set(key, next - this.sessionLimitOffset);
    this.rateRows.push({ rateKey, action, windowSeconds, limit });
    return { allowed: next <= limit, retry_after_seconds: windowSeconds };
  }
}

function configuredEnv(overrides = {}) {
  return {
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: "1",
    RAVENOS_AUTH_ORIGIN: ORIGIN,
    RAVENOS_AUTH_REDIRECT_URI: `${ORIGIN}/api/v1/auth/callback`,
    WORKOS_CLIENT_ID: "client_test_ravenos",
    WORKOS_API_KEY: "sk_test_not_returned",
    RAVENOS_AUTH_HASH_PEPPER: "test-rate-pepper-not-returned",
    RAVENOS_CUSTOMER_DB: { prepare() {}, batch() {} },
    RAVENOS_PORTFOLIO_PREVIEW_ENABLE: "1",
    RAVENOS_SOLANA_RPC_URL: "https://solana-provider.invalid/rpc?key=server-only",
    JUPITER_API_KEY: "server-only-jupiter-key",
    ...overrides,
  };
}

function request(method = "POST", body = { wallet_reference: WALLET_REFERENCE }, {
  origin = ORIGIN,
  authenticated = true,
  csrf = true,
} = {}) {
  const headers = {
    accept: "application/json",
    origin,
    "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site",
    "cf-connecting-ip": "203.0.113.41",
  };
  if (authenticated) headers.cookie = `__Host-ravenos_session=${RAW_SESSION}; __Host-ravenos_csrf=${RAW_CSRF}`;
  if (method === "POST") {
    headers["content-type"] = "application/json";
    if (csrf) headers["x-ravenos-csrf"] = RAW_CSRF;
  }
  return new Request(`${origin}${PORTFOLIO_GOVERNOR_PREVIEW_ROUTE}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function walletResolver({ user_id: userId }) {
  if (userId !== USER_ID) return [];
  return [{
    wallet_reference: WALLET_REFERENCE,
    address: WALLET_ADDRESS,
    label: "Primary Solana beta wallet",
  }];
}

function rpcFixture(method, params) {
  if (method === "getBalance") return { context: { slot: 900 }, value: "1000000000" };
  const program = params[1].programId;
  if (program === SOLANA_TOKEN_PROGRAMS[0].program_id) {
    return {
      context: { slot: 900 },
      value: [
        tokenAccount({ accountSeed: 20, mint: SOLANA_WRAPPED_SOL_MINT, amount: "500000000", decimals: 9 }),
        tokenAccount({ accountSeed: 21, mint: SOLANA_USDC_MINT, amount: "25000000", decimals: 6 }),
        tokenAccount({ accountSeed: 22, mint: UNKNOWN_MINT, amount: "1000000000000", decimals: 6 }),
        tokenAccount({ accountSeed: 23, mint: publicKey(110), amount: "0", decimals: 6, state: "closed" }),
      ],
    };
  }
  return {
    context: { slot: 900 },
    value: [tokenAccount({ accountSeed: 24, mint: TOKEN_2022_MINT, amount: "1000000", decimals: 6 })],
  };
}

function liveProviderFixture(url) {
  const target = new URL(String(url));
  if (target.pathname === "/price/v3") {
    const ids = target.searchParams.get("ids").split(",");
    const payload = {};
    if (ids.includes(SOLANA_WRAPPED_SOL_MINT)) payload[SOLANA_WRAPPED_SOL_MINT] = { usdPrice: 150, decimals: 9, blockId: 900 };
    if (ids.includes(UNKNOWN_MINT)) payload[UNKNOWN_MINT] = { usdPrice: 0.0001, decimals: 6, blockId: 900 };
    if (ids.includes(SOLANA_USDC_MINT)) payload[SOLANA_USDC_MINT] = { usdPrice: 1, decimals: 6, blockId: 900 };
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  }
  if (target.pathname === "/swap/v2/order") {
    assert.equal(target.searchParams.has("taker"), false);
    const mint = target.searchParams.get("inputMint");
    const amount = target.searchParams.get("amount");
    const expected = mint === SOLANA_WRAPPED_SOL_MINT ? "225000000" : "100000000";
    const minimum = mint === SOLANA_WRAPPED_SOL_MINT ? "220000000" : "90000000";
    return new Response(JSON.stringify({
      inputMint: mint,
      outputMint: SOLANA_USDC_MINT,
      inAmount: amount,
      outAmount: expected,
      otherAmountThreshold: minimum,
      transaction: null,
    }), { headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected_provider:${target.pathname}`);
}

test("operator-authorized beta registry is account scoped and never returns raw addresses", () => {
  const env = configuredEnv({
    RAVENOS_PORTFOLIO_PREVIEW_WALLETS: JSON.stringify({
      [USER_ID]: [{ wallet_reference: WALLET_REFERENCE, address: WALLET_ADDRESS, label: "Private beta wallet" }],
    }),
  });
  const rows = authorizedPortfolioPreviewWallets(env, USER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, WALLET_ADDRESS);
  assert.deepEqual(authorizedPortfolioPreviewWallets(env, `usr_${"z".repeat(32)}`), []);
  assert.throws(() => authorizedPortfolioPreviewWallets({
    ...env,
    RAVENOS_PORTFOLIO_PREVIEW_WALLETS: JSON.stringify({ [USER_ID]: [{ wallet_reference: WALLET_REFERENCE, address: "not-a-key" }] }),
  }, USER_ID), /registry_invalid/);
});

test("live validation harness requires authorization and emits only structural diagnostics", async () => {
  const env = {
    RAVENOS_PORTFOLIO_VALIDATION_ACK: "authorized_read_only",
    RAVENOS_PORTFOLIO_VALIDATION_WALLETS: JSON.stringify([{ address: WALLET_ADDRESS }]),
    RAVENOS_SOLANA_RPC_URL: "https://solana-provider.invalid/rpc",
    JUPITER_API_KEY: "server-only",
  };
  let receivedAddress = null;
  const report = await runAuthorizedLiveValidation({
    env,
    now: () => NOW_MS,
    analyze: async ({ wallet }) => {
      receivedAddress = wallet.address;
      return {
        dto: {
          state: "partial",
          diagnostics: {
            resolved_position_count: 0,
            unresolved_position_count: 0,
            provider_call_counts: { total: 0 },
            provider_call_cap: 8,
            provider_failures: [],
            latency_ms: { total: 0 },
            price_mints: {},
            executable_quote_groups: {},
            invariant_refusal_triggered: false,
            portfolio_history_persisted: false,
          },
          policy: { state: "not_configured", targets_inferred: false, correction_calculated: false },
          boundaries: {
            read_only: true,
            execution_quote_created: false,
            transaction_material_created: false,
            signing_requested: false,
          },
        },
        analysis: {
          snapshot: { positions: [] },
          measurement: {
            total_marked_asset_value_minor: "0",
            unresolved_value_minor: "0",
            unresolved_unknown_value_count: 0,
            executable_coverage_bps: null,
            unavailable_liability_valuations: 0,
            net_equity_minor: "0",
          },
          conservation: { ok: true },
        },
      };
    },
  });
  assert.equal(receivedAddress, WALLET_ADDRESS);
  assert.equal(report.cases[0].boundaries.raw_wallet_identity_output, false);
  assert.equal(JSON.stringify(report).includes(WALLET_ADDRESS), false);
  await assert.rejects(() => runAuthorizedLiveValidation({ env: { ...env, RAVENOS_PORTFOLIO_VALIDATION_ACK: "" } }), /authorization_ack_required/);
});

test("sub-micro token prices preserve a rational mark instead of rounding to zero", () => {
  const ratio = priceToMarkRatio("0.000000000123", 6);
  assert.deepEqual(ratio, {
    price_numerator_minor: "123",
    price_denominator_base_units: "1000000000000",
  });
});

test("same-mint positions become one bounded executable quote group", () => {
  const grouped = groupPortfolioExecutableCandidates({
    positions: [
      { position_id: "native", asset_id: "solana:SOL", quantity_base_units: "1000000000", marked_value_minor: "150000000" },
      { position_id: "wrapped", asset_id: "solana:WSOL", quantity_base_units: "500000000", marked_value_minor: "75000000" },
    ],
    selected_position_ids: ["native", "wrapped"],
    maximum_groups: 4,
  });
  assert.equal(grouped.selected.length, 1);
  assert.equal(grouped.selected[0].input_amount_base_units, "1500000000");
  assert.equal(grouped.duplicate_position_quotes_avoided, 1);
});

test("in-flight RPC coalescing cannot mix two wallets that reuse an opaque label", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.params[0]);
    await Promise.resolve();
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { context: { slot: 900 }, value: body.params[0] === WALLET_ADDRESS ? "1" : "2" },
    }), { headers: { "content-type": "application/json" } });
  };
  const requestRpc = createPortfolioSolanaRpcRequest({
    rpc_url: "https://solana-provider.invalid/rpc",
    wallet_reference: WALLET_REFERENCE,
    fetch_impl: fetchImpl,
  });
  const secondWallet = publicKey(140);
  const [first, second] = await Promise.all([
    requestRpc("getBalance", [WALLET_ADDRESS, { commitment: "confirmed" }]),
    requestRpc("getBalance", [secondWallet, { commitment: "confirmed" }]),
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls), new Set([WALLET_ADDRESS, secondWallet]));
  assert.equal(first.value, "1");
  assert.equal(second.value, "2");
});

test("RPC and Jupiter payload byte ceilings reject oversized providers before JSON use", async () => {
  const rpc = createPortfolioSolanaRpcRequest({
    rpc_url: "https://solana-provider.invalid/rpc",
    wallet_reference: WALLET_REFERENCE,
    fetch_impl: async () => new Response("{}", {
      headers: { "content-type": "application/json", "content-length": String(PortfolioPreviewProviderLimits.maximum_balance_response_bytes + 1) },
    }),
  });
  await assert.rejects(() => rpc("getBalance", [WALLET_ADDRESS, { commitment: "confirmed" }]), /provider_response_too_large/);

  const priced = await fetchPortfolioPriceObservations({
    candidates: [{ mint: SOLANA_WRAPPED_SOL_MINT, decimals: 9, amount_base_units: "1000000000" }],
    api_key: "server-only",
    observed_at: new Date(NOW_MS).toISOString(),
    fetch_impl: async () => new Response("{}", {
      headers: { "content-type": "application/json", "content-length": String(PortfolioPreviewProviderLimits.maximum_price_response_bytes + 1) },
    }),
  });
  assert.equal(priced.observations.length, 0);
  assert.equal(priced.diagnostics.failure, "provider_response_invalid");
});

test("quote-only valuation refuses provider transaction material", async () => {
  const position = { position_id: "position_1", asset_id: "solana:WSOL", quantity_base_units: "1000000000" };
  const result = await fetchPortfolioExecutableObservations({
    groups: [{ input_mint: SOLANA_WRAPPED_SOL_MINT, input_amount_base_units: "1000000000", positions: [position] }],
    api_key: "server-only-key",
    now_ms: NOW_MS,
    fetch_impl: async (url) => {
      const target = new URL(String(url));
      assert.equal(target.searchParams.has("taker"), false);
      return new Response(JSON.stringify({
        inputMint: SOLANA_WRAPPED_SOL_MINT,
        outputMint: SOLANA_USDC_MINT,
        inAmount: "1000000000",
        outAmount: "150000000",
        otherAmountThreshold: "149000000",
        transaction: "unsigned-transaction-must-be-rejected",
      }), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.observations.length, 0);
  assert.equal(result.diagnostics.failed_groups, 1);
  assert.equal(result.diagnostics.transaction_material_received, false);
});

test("messy live-shaped wallet analysis is bounded, conservative, and address-free", async () => {
  let clock = NOW_MS;
  const result = await analyzeSolanaPortfolioPreview({
    user_id: USER_ID,
    wallet: walletResolver({ user_id: USER_ID })[0],
    rpc_request: async (method, params) => rpcFixture(method, params),
    jupiter_api_key: "server-only-jupiter-key",
    fetch_impl: async (url) => liveProviderFixture(url),
    now: () => (clock += 5),
  });
  const dtoText = JSON.stringify(result.dto);
  assert.equal(result.dto.ok, true);
  assert.equal(result.dto.state, "partial");
  assert.equal(result.dto.policy.state, "not_configured");
  assert.equal(result.dto.policy.portfolio_compliant, null);
  assert.equal(result.dto.summary.net_equity_minor, null);
  assert.equal(result.dto.summary.marked_portfolio_value_minor, "350000000");
  assert.equal(result.dto.diagnostics.observed_position_count, 5);
  assert.equal(result.dto.diagnostics.resolved_position_count, 3);
  assert.equal(result.dto.diagnostics.unresolved_position_count, 2);
  assert.equal(result.dto.diagnostics.provider_call_counts.solana_rpc, 3);
  assert.equal(result.dto.diagnostics.provider_call_counts.jupiter_price, 1);
  assert.equal(result.dto.diagnostics.provider_call_counts.jupiter_executable_quote, 2);
  assert(result.dto.diagnostics.provider_call_counts.total <= result.dto.diagnostics.provider_call_cap);
  assert.equal(result.dto.diagnostics.executable_quote_groups.duplicate_position_quotes_avoided, 1);
  assert.equal(result.dto.diagnostics.conservation.passed, true);
  assert.equal(result.dto.boundaries.read_only, true);
  assert.equal(result.dto.boundaries.rebalance_created, false);
  assert.equal(result.dto.boundaries.execution_quote_created, false);
  assert.equal(result.dto.boundaries.transaction_material_created, false);
  assert.equal(result.dto.provenance.persisted, false);
  assert.equal(dtoText.includes(WALLET_ADDRESS), false);
  assert.equal(dtoText.includes("server-only"), false);
  assert.equal(dtoText.includes("ExecutionQuote"), false);
  assert.equal(dtoText.includes("ExecutionIntent"), false);
  assert.equal(dtoText.includes("token_account:"), false);
});

test("sanitized live regression: five unknown SPL balances stay unresolved when only one dust mark exists", async () => {
  const mints = [150, 151, 152, 153, 154].map(publicKey);
  let executableCalls = 0;
  const result = await analyzeSolanaPortfolioPreview({
    user_id: USER_ID,
    wallet: walletResolver({ user_id: USER_ID })[0],
    jupiter_api_key: "server-only-key",
    now: () => NOW_MS,
    rpc_request: async (method, params) => {
      if (method === "getBalance") return { context: { slot: 901 }, value: "0" };
      const token2022 = params[1].programId === SOLANA_TOKEN_PROGRAMS[1].program_id;
      return {
        context: { slot: 901 },
        value: token2022
          ? [tokenAccount({ accountSeed: 170, mint: mints[4], amount: "1", decimals: 6 })]
          : mints.slice(0, 4).map((mint, index) => tokenAccount({ accountSeed: 160 + index, mint, amount: "1", decimals: 6 })),
      };
    },
    fetch_impl: async (url) => {
      const target = new URL(String(url));
      if (target.pathname === "/price/v3") {
        return new Response(JSON.stringify({ [mints[0]]: { usdPrice: 1, decimals: 6 } }), { headers: { "content-type": "application/json" } });
      }
      executableCalls += 1;
      throw new Error("dust_must_not_be_exit_quoted");
    },
  });
  assert.equal(result.dto.holdings.observed_position_count, 5);
  assert.equal(result.dto.diagnostics.resolved_position_count, 0);
  assert.equal(result.dto.diagnostics.unresolved_position_count, 5);
  assert.equal(result.dto.summary.unresolved_unknown_value_count, 4);
  assert.equal(result.dto.summary.net_equity_minor, null);
  assert.equal(result.dto.diagnostics.provider_call_counts.total, 4);
  assert.equal(executableCalls, 0);
  assert.equal(result.analysis.conservation.ok, true);
  assert.equal(JSON.stringify(result.dto).includes(WALLET_ADDRESS), false);
});

test("large dust inventories keep explicit totals while bounding holdings, prices, and exposure rows", async () => {
  const accounts = Array.from({ length: 120 }, (_, index) => tokenAccount({
    accountSeed: 130 + index,
    mint: publicKey(1 + index),
    amount: "1",
    decimals: 6,
  }));
  let requestedPriceMints = 0;
  const result = await analyzeSolanaPortfolioPreview({
    user_id: USER_ID,
    wallet: { ...walletResolver({ user_id: USER_ID })[0], address: publicKey(250) },
    jupiter_api_key: "server-only-key",
    now: () => NOW_MS,
    rpc_request: async (method, params) => {
      if (method === "getBalance") return { context: { slot: 902 }, value: "0" };
      return {
        context: { slot: 902 },
        value: params[1].programId === SOLANA_TOKEN_PROGRAMS[0].program_id ? accounts : [],
      };
    },
    fetch_impl: async (url) => {
      const target = new URL(String(url));
      requestedPriceMints = target.searchParams.get("ids").split(",").length;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.dto.holdings.observed_position_count, 120);
  assert.equal(result.dto.holdings.returned_position_count, PortfolioGovernorPreviewLimits.maximum_returned_holdings);
  assert.equal(result.dto.holdings.truncated, true);
  assert.equal(requestedPriceMints, 50);
  assert.equal(result.dto.diagnostics.price_mints.capacity_omitted, 70);
  assert.equal(result.dto.diagnostics.exposure_rows.instrument.total_count, 120);
  assert.equal(result.dto.diagnostics.exposure_rows.instrument.returned_count, PortfolioGovernorPreviewLimits.maximum_returned_exposures_per_dimension);
  assert.equal(result.dto.diagnostics.exposure_rows.instrument.truncated, true);
  assert.equal(result.dto.diagnostics.provider_call_counts.total, 4);
  assert.equal(result.analysis.conservation.ok, true);
});

test("preview fails closed if a provider-controlled instrument identifier could reveal the analyzed wallet", async () => {
  await assert.rejects(() => analyzeSolanaPortfolioPreview({
    user_id: USER_ID,
    wallet: walletResolver({ user_id: USER_ID })[0],
    now: () => NOW_MS,
    rpc_request: async (method, params) => {
      if (method === "getBalance") return { context: { slot: 903 }, value: "0" };
      return {
        context: { slot: 903 },
        value: params[1].programId === SOLANA_TOKEN_PROGRAMS[0].program_id
          ? [tokenAccount({ accountSeed: 240, mint: WALLET_ADDRESS, amount: "1", decimals: 6 })]
          : [],
      };
    },
    fetch_impl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  }), /portfolio_preview_wallet_address_leak/);
});

test("partial RPC failure remains explicit and cannot turn an incompletely observed wallet into complete state", async () => {
  let clock = NOW_MS;
  const result = await analyzeSolanaPortfolioPreview({
    user_id: USER_ID,
    wallet: walletResolver({ user_id: USER_ID })[0],
    rpc_request: async (method, params) => {
      if (method === "getTokenAccountsByOwner" && params[1].programId === SOLANA_TOKEN_PROGRAMS[1].program_id) throw new Error("timeout");
      return rpcFixture(method, params);
    },
    jupiter_api_key: "server-only-jupiter-key",
    fetch_impl: async (url) => liveProviderFixture(url),
    now: () => (clock += 5),
  });
  assert.equal(result.dto.diagnostics.observation_state, "partial");
  assert(result.dto.diagnostics.provider_failures.some((row) => row.stage === "wallet_observation" && row.reason === "provider_timeout"));
  assert.notEqual(result.dto.state, "complete");
});

test("preview route requires an authenticated canonical-origin session before wallet or provider resolution", async () => {
  const store = await new MemoryStore().seed();
  let resolverCalls = 0;
  const deps = {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets(args) {
      resolverCalls += 1;
      return walletResolver(args);
    },
  };
  const unauthenticated = await routePortfolioGovernorPreview(request("GET", null, { authenticated: false }), configuredEnv(), deps);
  assert.equal(unauthenticated.status, 401);
  assert.equal(resolverCalls, 0);

  const publicOrigin = await routePortfolioGovernorPreview(new Request(`https://ravenos.xyz${PORTFOLIO_GOVERNOR_PREVIEW_ROUTE}`, {
    headers: { cookie: `__Host-ravenos_session=${RAW_SESSION}` },
  }), configuredEnv(), deps);
  assert.equal(publicOrigin.status, 409);
  assert.equal(resolverCalls, 0);

  const missingCsrf = await routePortfolioGovernorPreview(request("POST", { wallet_reference: WALLET_REFERENCE }, { csrf: false }), configuredEnv(), deps);
  assert.equal(missingCsrf.status, 403);
  assert.equal(resolverCalls, 0);
});

test("authorized wallet discovery returns opaque selections and no address", async () => {
  const store = await new MemoryStore().seed();
  const response = await routePortfolioGovernorPreview(request("GET"), configuredEnv(), {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state, "available");
  assert.equal(body.wallets[0].wallet_reference, WALLET_REFERENCE);
  assert.equal(body.wallets[0].address_returned, false);
  assert.equal(JSON.stringify(body).includes(WALLET_ADDRESS), false);
  assert.equal(body.arbitrary_address_input_allowed, false);
  assert.equal(body.portfolio_history_persisted, false);
});

test("customer route rejects arbitrary addresses and cross-account wallet references before analysis", async () => {
  const store = await new MemoryStore().seed();
  let analysisCalls = 0;
  const deps = {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
    analyze: async () => {
      analysisCalls += 1;
      throw new Error("must_not_run");
    },
  };
  const arbitrary = await routePortfolioGovernorPreview(request("POST", {
    wallet_reference: WALLET_REFERENCE,
    wallet_address: WALLET_ADDRESS,
  }), configuredEnv(), deps);
  assert.equal(arbitrary.status, 400);

  const wrongWallet = await routePortfolioGovernorPreview(request("POST", { wallet_reference: "wpr_other_account_wallet" }), configuredEnv(), deps);
  assert.equal(wrongWallet.status, 404);
  assert.equal(analysisCalls, 0);
  assert.equal(store.rateRows.length, 0);
});

test("preview rate limits are keyed before provider analysis and return retry guidance", async () => {
  const store = await new MemoryStore().seed();
  let analysisCalls = 0;
  const dto = {
    ok: true,
    schema_version: "fixture",
    state: "partial",
    diagnostics: {
      latency_ms: { total: 1 },
      provider_call_counts: {},
      observed_position_count: 0,
      resolved_position_count: 0,
      unresolved_position_count: 0,
      conservation: { passed: true },
    },
  };
  const deps = {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
    analyze: async () => {
      analysisCalls += 1;
      return { dto };
    },
    telemetry() {},
  };
  for (let index = 0; index < PortfolioGovernorPreviewLimits.wallet_requests_per_5_minutes; index += 1) {
    const response = await routePortfolioGovernorPreview(request(), configuredEnv(), deps);
    assert.equal(response.status, 200);
  }
  const limited = await routePortfolioGovernorPreview(request(), configuredEnv(), deps);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "300");
  assert.equal((await limited.json()).error, "portfolio_preview_rate_limited");
  assert.equal(analysisCalls, PortfolioGovernorPreviewLimits.wallet_requests_per_5_minutes);
  assert(store.rateRows.every((row) => !row.rateKey.includes(USER_ID) && !row.rateKey.includes(WALLET_REFERENCE)));
});

test("accounting invariant failures refuse the normal portfolio DTO", async () => {
  const store = await new MemoryStore().seed();
  const response = await routePortfolioGovernorPreview(request(), configuredEnv(), {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
    analyze: async () => {
      throw new Error("portfolio_conservation_invariant_failed");
    },
    telemetry() {},
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.state, "invariant_failed");
  assert.equal(body.normal_portfolio_response_served, false);
  assert.equal(body.diagnostics.invariant_refusal_triggered, true);
  assert.equal(body.boundaries.customer_assets_can_move, false);
});

test("policy lookup failure refuses before wallet providers are called", async () => {
  const store = await new MemoryStore().seed();
  let analysisCalls = 0;
  const response = await routePortfolioGovernorPreview(request(), configuredEnv(), {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
    resolvePolicyVersion() { throw new Error("policy_store_unavailable"); },
    analyze: async () => { analysisCalls += 1; },
    telemetry() {},
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "portfolio_policy_unavailable");
  assert.equal(body.provider_calls_started, false);
  assert.equal(analysisCalls, 0);
});

test("an existing immutable user policy attaches read-only and uncertainty remains indeterminate", async () => {
  const store = await new MemoryStore().seed();
  let clock = NOW_MS;
  const response = await routePortfolioGovernorPreview(request(), configuredEnv(), {
    store,
    nowMs: NOW_MS,
    resolveAuthorizedWallets: walletResolver,
    rpcRequest: async (method, params) => rpcFixture(method, params),
    fetchImpl: async (url) => liveProviderFixture(url),
    now: () => (clock += 5),
    resolvePolicyVersion({ user_id: userId, portfolio_id: portfolioId }) {
      return createUserPolicyVersion({
        policy_id: "policy_preview_owner",
        policy_version_id: "policy_preview_owner_v1",
        version: 1,
        user_id: userId,
        portfolio_id: portfolioId,
        authored_at: "2026-08-26T19:00:00.000Z",
        authored_by: { type: "user", user_id: userId },
        allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 6500 }],
      });
    },
    telemetry() {},
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.policy.state, "indeterminate");
  assert.equal(body.policy.policy_version_id, "policy_preview_owner_v1");
  assert.equal(body.policy.findings[0].state, "indeterminate");
  assert.equal(body.policy.targets_inferred, false);
  assert.equal(body.policy.correction_calculated, false);
  assert.equal(body.policy.rebalance_created, false);
  assert.equal(body.boundaries.execution_quote_created, false);
});
