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

test("Stage A activates only managed accounts and revocable sessions", () => {
  assert.equal(security.schema_version, "ravenos.customer_security_architecture.v1");
  assert.equal(security.verification_baseline.version, "5.0.0");
  assert.equal(security.verification_baseline.minimum_level, 2);
  assert.equal(security.current_stage, "stage_a_accounts_active");
  assert.equal(security.customer_capabilities_enabled, true);
  assert.equal(security.identity_provider.implementation, "workos_authkit");
  assert.equal(security.identity_provider.production_tenant_configured, true);
  assert.equal(security.identity_provider.provider_tokens_retained_by_ravenos, false);
  assert.equal(security.identity_provider.google_oauth_tokens_returned_to_ravenos, false);
  assert.equal(security.identity_provider.passkeys_enabled, false);
  for (const capability of ["account_creation", "customer_authentication", "customer_sessions"]) {
    assert(security.active_capabilities.includes(capability));
    assert(!security.blocked_capabilities.includes(capability));
  }
  for (const capability of [
    "wallet_linking",
    "persistent_portfolio",
    "subscription_entitlements",
    "customer_signing",
    "transaction_submission",
  ]) {
    assert(security.blocked_capabilities.includes(capability));
  }
  assert.equal(security.portfolio_preview.implementation_status, "feature_flagged_read_only_beta");
  assert.equal(security.portfolio_preview.authenticated_origin_only, true);
  assert.equal(security.portfolio_preview.raw_address_input_allowed, false);
  assert.equal(security.portfolio_preview.durable_wallet_link_active, false);
  assert.equal(security.portfolio_preview.portfolio_history_persisted, false);
  assert.equal(security.portfolio_preview.maximum_provider_calls_per_analysis, 8);
  assert.equal(security.portfolio_preview.signing_available, false);
  assert.equal(security.portfolio_preview.submission_available, false);
  assert.equal(security.saved_monitor.implementation_status, "local_candidate_not_deployed");
  assert.equal(security.saved_monitor.authenticated_origin_only, true);
  assert.equal(security.saved_monitor.csrf_required_for_mutations, true);
  assert.equal(security.saved_monitor.exact_market_identity_only, true);
  assert.equal(security.saved_monitor.raw_provider_payloads_persisted, false);
  assert.equal(security.saved_monitor.wallet_data_persisted, false);
  assert.equal(security.saved_monitor.alerts_available, false);
  assert.equal(security.saved_monitor.execution_available, false);
  assert.equal(security.saved_monitor.production_activation_completed, false);
  assert(security.blocked_capabilities.includes("saved_monitor_production_activation"));
  assert.equal(security.raven_monitor.implementation_status, "local_dormant_candidate_not_deployed");
  assert.equal(security.raven_monitor.authenticated_origin_only, true);
  assert.equal(security.raven_monitor.csrf_required_for_mutations, true);
  assert.equal(security.raven_monitor.exact_market_identity_only, true);
  assert.equal(security.raven_monitor.all_activation_controls_default_off, true);
  assert.equal(security.raven_monitor.maximum_rules_per_account, 100);
  assert.equal(security.raven_monitor.maximum_notification_history_per_account, 1000);
  assert.equal(security.raven_monitor.notification_retention_days, 90);
  assert.equal(security.raven_monitor.raw_provider_payloads_persisted, false);
  assert.equal(security.raven_monitor.plan_prices_persisted, false);
  assert.equal(security.raven_monitor.wallet_or_execution_data_persisted, false);
  assert.equal(security.raven_monitor.out_of_app_delivery_active, false);
  assert.equal(security.raven_monitor.scheduler_trigger_configured, false);
  assert.equal(security.raven_monitor.production_activation_completed, false);
  assert(security.blocked_capabilities.includes("persistent_alerts_production_activation"));
  assert.equal(security.entitlement_foundation.implementation_status, "local_dormant_foundation");
  assert.equal(security.entitlement_foundation.surface, "https://app.ravenos.xyz/account/intelligence/");
  assert.equal(security.entitlement_foundation.all_activation_controls_default_off, true);
  assert.equal(security.entitlement_foundation.coordinated_projection_split_required, true);
  assert.deepEqual(security.entitlement_foundation.free_projection_limits, { perps_markets: 6, participant_conditions: 6 });
  assert.deepEqual(security.entitlement_foundation.pro_projection_limits, { perps_rows_per_table: 40, participant_conditions: 160 });
  assert.equal(security.entitlement_foundation.direct_public_artifact_aliases_projected_when_active, true);
  assert.equal(security.entitlement_foundation.public_behavior_unchanged_while_off, true);
  assert.equal(security.entitlement_foundation.customer_mutation_available, false);
  assert.equal(security.entitlement_foundation.checkout_available, false);
  assert.equal(security.entitlement_foundation.billing_available, false);
  assert.equal(security.entitlement_foundation.atlas_display_rights_override_available, false);
  assert.equal(security.entitlement_foundation.production_activation_completed, false);
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

test("all required security scenarios are explicit and future stages stay unverified", () => {
  const rows = security.verification_scenarios;
  assert.equal(rows.length, 34);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  const future = rows.filter((row) => ["stage_b", "stage_c", "stage_d", "stage_e"].includes(row.gate));
  assert(future.length >= 15);
  assert(future.every((row) => row.status !== "verified_current"));
  const stageA = rows.filter((row) => row.gate === "stage_a");
  assert(stageA.length > 0);
  assert(stageA.every((row) => !["blocked", "required_not_implemented"].includes(row.status)));
  assert(stageA.some((row) => row.status === "external_review_required"));
  for (const prefix of ["SEC-SES", "SEC-CSRF", "SEC-AUTHZ", "SEC-RSCH", "SEC-ENT", "SEC-ALT", "SEC-WAL", "SEC-BIL", "SEC-ENUM", "SEC-EDGE", "SEC-XSS", "SEC-CSP", "SEC-TX"]) {
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

test("the authenticated hostname exposes only approved account, Saved Monitor, and dormant entitlement candidates", async () => {
  const accountHtml = readFileSync("account/index.html", "utf8");
  const intelligenceHtml = readFileSync("account/intelligence/index.html", "utf8");
  const monitorHtml = readFileSync("monitor/index.html", "utf8");
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/account/") return new Response(accountHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/account/intelligence/") return new Response(intelligenceHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/monitor/") return new Response(monitorHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname.startsWith("/assets/") || ["/ravenos-account.js", "/ravenos-monitor.js", "/ravenos-monitor.css", "/ravenos-pro-intelligence.js", "/ravenos-pro-intelligence.css", "/ravenos-workspace.css"].includes(pathname)) return new Response("asset", { headers: { "content-type": pathname.endsWith(".css") ? "text/css" : "application/javascript" } });
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

  const intelligence = await worker.fetch(new Request("https://app.ravenos.xyz/account/intelligence/"), env);
  assert.equal(intelligence.status, 200);
  assert.match(intelligence.headers.get("cache-control") || "", /no-store/);
  assert.match(intelligence.headers.get("content-security-policy") || "", /default-src 'self'/);
  const intelligenceAsset = await worker.fetch(new Request("https://app.ravenos.xyz/ravenos-pro-intelligence.js"), env);
  assert.equal(intelligenceAsset.status, 200);

  const monitor = await worker.fetch(new Request("https://app.ravenos.xyz/monitor/"), env);
  assert.equal(monitor.status, 200);
  assert.match(monitor.headers.get("cache-control") || "", /no-store/);
  assert.match(monitor.headers.get("content-security-policy") || "", /default-src 'self'/);
  const researchState = await worker.fetch(new Request("https://app.ravenos.xyz/api/v1/research-state"), env);
  assert.equal(researchState.status, 503);
  assert.equal(JSON.parse(await researchState.text()).error, "account_activation_pending");

  const entitlements = await worker.fetch(new Request("https://app.ravenos.xyz/api/v1/entitlements", {
    headers: { origin: "https://app.ravenos.xyz", "sec-fetch-site": "same-origin" },
  }), env);
  assert.equal(entitlements.status, 503);
  assert.equal(JSON.parse(await entitlements.text()).error, "account_activation_pending");

  const publicMonitor = await worker.fetch(new Request("https://ravenos.xyz/monitor/?instrument_id=hyperliquid%3Aperp%3ASOL&wallet=untrusted"), env);
  assert.equal(publicMonitor.status, 308);
  const publicMonitorTarget = new URL(publicMonitor.headers.get("location"));
  assert.equal(publicMonitorTarget.origin, "https://app.ravenos.xyz");
  assert.equal(publicMonitorTarget.pathname, "/monitor/");
  assert.equal(publicMonitorTarget.searchParams.get("instrument_id"), "hyperliquid:perp:SOL");
  assert.equal(publicMonitorTarget.searchParams.has("wallet"), false);

  const preview = await worker.fetch(new Request("https://app.ravenos.xyz/api/v1/portfolio/preview"), env);
  assert.equal(preview.status, 503);
  const previewText = await preview.text();
  assert.equal(JSON.parse(previewText).error, "account_activation_pending");
  assert(!previewText.includes("must-not-echo"));

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

test("Portfolio Governor account UI accepts only an opaque selection and preserves read-only boundaries", () => {
  const html = readFileSync("account/index.html", "utf8");
  const client = readFileSync("ravenos-account.js", "utf8");
  assert(html.includes("Portfolio Governor preview"));
  assert(html.includes('id="accountGovernorWallet"'));
  assert(!html.match(/<input[^>]+(?:wallet|address)/i));
  assert(client.includes('JSON.stringify({ wallet_reference: walletReference })'));
  assert(!client.includes("localStorage"));
  assert(!client.includes("sessionStorage"));
  assert(!client.includes("innerHTML"));
  assert(client.includes("boundaries.customer_assets_can_move !== false"));
  assert(client.includes("boundaries.transaction_material_created !== false"));
  assert(client.includes("No policy saved"));
});

test("authenticated Pro workspace keeps authorization server-owned and renders without executable markup", () => {
  const html = readFileSync("account/intelligence/index.html", "utf8");
  const client = readFileSync("ravenos-pro-intelligence.js", "utf8");
  assert(html.includes("Available to approved Pro accounts"));
  assert(html.includes("Atlas availability stays separate"));
  assert(html.includes("This workspace cannot connect a wallet, place an order, or manage a position."));
  assert(!/<input[^>]+name=["'](?:owner|user|capability|plan|tier|token)["']/i.test(html));
  assert(!/<(?:a|button|form)[^>]*(?:checkout|subscribe|purchase|upgrade)/i.test(html));
  assert(!client.includes("innerHTML"));
  assert(!client.includes("localStorage"));
  assert(!client.includes("sessionStorage"));
  assert(!/authorization\s*:/i.test(client));
  assert(client.includes('credentials: "same-origin"'));
  assert(client.includes('cache: "no-store"'));
  assert(client.includes("textContent"));
  assert(client.includes("exactPerpInstrumentId"));
});

test("all required customer security documents exist as substantial architecture contracts", () => {
  assert.equal(security.required_documents.length, 11);
  for (const path of security.required_documents) assert(statSync(path).size > 1000, path);
});
