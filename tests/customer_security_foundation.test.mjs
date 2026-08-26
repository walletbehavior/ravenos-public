import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";

import worker from "../worker.mjs";
import {
  CustomerExecutionAuthorization,
  resolveCustomerTradeFlags,
  signingEnabled,
} from "../lib/customer_trade/feature_flags.mjs";

const security = JSON.parse(readFileSync("config/customer_security.json", "utf8"));

test("Stage A account implementation stays gated until provider and preview verification", () => {
  assert.equal(security.schema_version, "ravenos.customer_security_architecture.v1");
  assert.equal(security.verification_baseline.version, "5.0.0");
  assert.equal(security.verification_baseline.minimum_level, 2);
  assert.equal(security.current_stage, "stage_a_implementation_pending_activation");
  assert.equal(security.customer_capabilities_enabled, false);
  assert.equal(security.identity_provider.implementation, "workos_authkit");
  assert.equal(security.identity_provider.production_tenant_configured, false);
  assert.equal(security.identity_provider.provider_tokens_retained_by_ravenos, false);
  for (const capability of [
    "customer_authentication",
    "customer_sessions",
    "wallet_linking",
    "persistent_portfolio",
    "subscription_entitlements",
    "customer_signing",
    "transaction_submission",
  ]) {
    assert(security.blocked_capabilities.includes(capability));
  }
});

test("account session wallet entitlement and transaction authority remain separate contracts", () => {
  const architecture = readFileSync("docs/ravenos_security_architecture_v1.md", "utf8");
  for (const principal of [
    "RavenOS account",
    "Authentication credential",
    "Server session",
    "Wallet connection",
    "Wallet proof",
    "Wallet link",
    "Entitlement",
    "Transaction authorization",
  ]) {
    assert(architecture.includes(principal), `missing distinct principal: ${principal}`);
  }
  assert.match(architecture, /wallet\.connect\(\).*proves none/i);
});

test("opaque host-only session contract cannot move into browser storage", () => {
  const policy = security.session_policy;
  assert.equal(policy.kind, "opaque_revocable_server_side");
  assert.equal(policy.cookie_name, "__Host-ravenos_session");
  assert.equal(policy.domain_attribute_permitted, false);
  assert.equal(policy.browser_storage_tokens_permitted, false);
  assert(policy.minimum_entropy_bits >= 256);
  for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) assert(policy.cookie_attributes.includes(attribute));
});

test("all required future security scenarios are explicit and no Stage A control is falsely reported verified", () => {
  const rows = security.verification_scenarios;
  assert.equal(rows.length, 28);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  const future = rows.filter((row) => row.gate !== "current");
  assert(future.length > 20);
  assert(future.every((row) => row.status !== "verified_current"));
  assert(future.some((row) => row.gate === "stage_a" && row.status === "blocked"));
  for (const prefix of ["SEC-SES", "SEC-CSRF", "SEC-AUTHZ", "SEC-WAL", "SEC-BIL", "SEC-ENUM", "SEC-EDGE", "SEC-XSS", "SEC-CSP", "SEC-TX"]) {
    assert(rows.some((row) => row.id.startsWith(prefix)), `missing scenario family: ${prefix}`);
  }
});

test("legacy address-centric customer and billing routes stay quarantined even if old flags are set", async () => {
  const env = {
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: "1",
    RAVENOS_AUTH_ENABLE: "1",
    RAVENOS_BILLING_ENABLE: "1",
    STRIPE_SECRET_KEY: "must-never-be-returned",
    STRIPE_WEBHOOK_SECRET: "must-never-be-returned",
    RAVENOS_SOLANA_MINT: "must-never-be-returned",
    RAVENOS_SOLANA_RPC_URL: "https://private.invalid",
    RAVENOS_DB: { prepare() { throw new Error("legacy store must not be touched"); } },
  };
  const requests = [
    ["GET", "/api/access?wallet=customer-wallet-must-not-echo", "legacy_customer_access_quarantined"],
    ["POST", "/api/access", "legacy_customer_access_quarantined"],
    ["POST", "/api/stripe/checkout", "legacy_billing_quarantined"],
    ["POST", "/api/stripe/portal", "legacy_billing_quarantined"],
    ["POST", "/api/stripe/webhook", "legacy_billing_quarantined"],
  ];
  for (const [method, path, expectedError] of requests) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify({ wallet: "customer-wallet-must-not-echo" }) : undefined,
    }), env);
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.match(response.headers.get("cache-control") || "", /no-store/i);
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(body.error, expectedError);
    assert.equal(body.customer_system.authentication, "not_configured");
    assert.equal(body.customer_system.signing, "disabled");
    assert.equal(body.customer_system.submission, "disabled");
    assert(!text.includes("customer-wallet-must-not-echo"));
    assert(!text.includes("must-never-be-returned"));
  }
});

test("legacy wallet and transaction clients are not release assets", () => {
  const source = readFileSync("scripts/prepare-deploy-assets.mjs", "utf8");
  const runtimeAssets = source.match(/const runtimeAssets = \[([\s\S]*?)\n\];/)?.[1] || "";
  for (const asset of security.legacy_quarantine.client_assets_excluded_from_release) {
    assert(!runtimeAssets.includes(`\"${asset}\"`), asset);
  }
  const workerSource = readFileSync("worker.mjs", "utf8");
  for (const moduleName of ["ravenos_access", "ravenos_subscriptions", "ravenos_stripe_webhooks", "solana_wallet_auth"]) {
    assert(!workerSource.includes(`./lib/${moduleName}.mjs`), moduleName);
  }
});

test("signing and submission cannot be activated by environment flags", () => {
  const flags = resolveCustomerTradeFlags({
    RAVENOS_CUSTOMER_TRADE_UI_ENABLE: "1",
    RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: "1",
    RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE: "1",
    RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE: "1",
  });
  assert.equal(CustomerExecutionAuthorization.signing, false);
  assert.equal(CustomerExecutionAuthorization.submission, false);
  assert.equal(flags.RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE, false);
  assert.equal(flags.RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE, false);
  assert.equal(signingEnabled(flags), false);
});

test("Worker APIs receive baseline security headers and authenticated surfaces reject inline script execution", async () => {
  const terminalHtml = readFileSync("terminal/index.html", "utf8");
  const accountHtml = readFileSync("account/index.html", "utf8");
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/terminal/") return new Response(terminalHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/account/") return new Response(accountHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        return new Response("not found", { status: 404 });
      },
    },
  };
  const terminal = await worker.fetch(new Request("https://ravenos.xyz/terminal/"), env);
  assert.equal(terminal.status, 200);
  assert.equal(terminal.headers.get("x-content-type-options"), "nosniff");
  assert.equal(terminal.headers.get("x-frame-options"), "DENY");
  assert.equal(terminal.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(terminal.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.match(terminal.headers.get("strict-transport-security") || "", /max-age=31536000/);
  const csp = terminal.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert(!csp.includes("unsafe-inline"));
  assert(!csp.includes("unsafe-eval"));

  const account = await worker.fetch(new Request("https://ravenos.xyz/account/"), env);
  assert.equal(account.status, 200);
  assert.match(account.headers.get("cache-control") || "", /no-store/);
  const accountCsp = account.headers.get("content-security-policy") || "";
  assert.match(accountCsp, /default-src 'self'/);
  assert.match(accountCsp, /frame-ancestors 'none'/);
  assert.match(accountCsp, /script-src 'self'/);
  assert(!accountCsp.includes("unsafe-inline"));

  const api = await worker.fetch(new Request("https://ravenos.xyz/api/access"), env);
  assert.equal(api.headers.get("x-content-type-options"), "nosniff");
  assert.equal(api.headers.get("referrer-policy"), "no-referrer");
  assert.match(api.headers.get("permissions-policy") || "", /camera=\(\)/);
});

test("the authenticated hostname exposes only account assets and account/session APIs", async () => {
  const accountHtml = readFileSync("account/index.html", "utf8");
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/account/") return new Response(accountHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname.startsWith("/assets/") || pathname === "/ravenos-account.js") return new Response("asset", { headers: { "content-type": "application/javascript" } });
        return new Response("public surface", { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    },
    RAVENOS_AUTH_ORIGIN: "https://app.ravenos.xyz",
    RAVENOS_AUTH_REDIRECT_URI: "https://app.ravenos.xyz/api/v1/auth/callback",
  };

  const account = await worker.fetch(new Request("https://app.ravenos.xyz/account/"), env);
  assert.equal(account.status, 200);
  assert.match(account.headers.get("content-security-policy") || "", /default-src 'self'/);

  const config = await worker.fetch(new Request("https://app.ravenos.xyz/api/v1/auth/config"), env);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).available, false);

  const asset = await worker.fetch(new Request("https://app.ravenos.xyz/ravenos-account.js"), env);
  assert.equal(asset.status, 200);

  const terminal = await worker.fetch(new Request("https://app.ravenos.xyz/terminal/?code=must-not-cross-origins"), env);
  assert.equal(terminal.status, 308);
  assert.equal(terminal.headers.get("location"), "https://ravenos.xyz/terminal/");
  assert(!terminal.headers.get("location").includes("must-not-cross-origins"));

  const marketApi = await worker.fetch(new Request("https://app.ravenos.xyz/api/hyperliquid/perps?token=must-not-echo"), env);
  assert.equal(marketApi.status, 404);
  assert.equal(await marketApi.text(), "Not found");

  const unknown = await worker.fetch(new Request("https://app.ravenos.xyz/provider/callback?code=must-not-echo"), env);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("location"), null);
  assert.equal(await unknown.text(), "Not found");
});

test("all required customer security documents exist as substantial architecture contracts", () => {
  assert.equal(security.required_documents.length, 7);
  for (const path of security.required_documents) assert(statSync(path).size > 1000, path);
});
