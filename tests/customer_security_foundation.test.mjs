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
  assert.equal(security.customer_username.provider_name_used_as_public_identity, false);
  assert.equal(security.customer_username.provider_family_name_exposed, false);
  assert.equal(security.customer_username.user_selected, true);
  assert.equal(security.customer_username.globally_unique_case_insensitive, true);
  assert.equal(security.customer_username.csrf_required_for_mutations, true);
  assert.equal(security.community.implementation_status, "local_dormant_candidate_not_deployed");
  assert.equal(security.community.activation_default_off, true);
  assert.equal(security.community.public_participation_opt_in, true);
  assert.equal(security.community.username_creation_publishes_profile, false);
  assert.equal(security.community.all_disclosures_default_private, true);
  assert.equal(security.community.wallet_addresses_default_private, true);
  assert.equal(security.community.account_balance_public, false);
  assert.equal(security.community.email_public, false);
  assert.equal(security.community.legal_name_public, false);
  assert.equal(security.community.user_reported_performance_board_eligible, false);
  assert.equal(security.community.simulated_performance_board_eligible, false);
  assert.equal(security.community.popularity_affects_performance_rank, false);
  assert.deepEqual(security.community.positive_recognition_kinds, ["useful"]);
  assert.equal(security.community.negative_recognition_available, false);
  assert.equal(security.community.comments_available, false);
  assert.equal(security.community.direct_messages_available, false);
  assert.equal(security.community.execution_authority, false);
  assert.equal(security.community.production_activation_completed, false);
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
  assert.equal(security.raven_monitor.scheduler_trigger_configured, true);
  assert.equal(security.raven_monitor.scheduler_activation_flags_default_off, true);
  assert.equal(security.raven_monitor.production_activation_completed, false);
  assert.equal(security.shadow_route_sampling.aggregate_public_output_only, true);
  assert.equal(security.shadow_route_sampling.customer_identity_persisted, false);
  assert.equal(security.shadow_route_sampling.wallet_or_network_address_persisted, false);
  assert.equal(security.shadow_route_sampling.transaction_material_persisted, false);
  assert.equal(security.shadow_route_sampling.signing_available, false);
  assert.equal(security.shadow_route_sampling.submission_available, false);
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
  assert.equal(security.public_holder_lists.implementation_status, "production_provider_validated");
  assert.equal(security.public_holder_lists.free_tier_capability, true);
  assert.deepEqual(security.public_holder_lists.supported_chains, ["solana", "robinhood", "base", "bsc", "ethereum"]);
  assert.equal(security.public_holder_lists.evm_implementation_status, "production_provider_validated_activation_pending");
  assert.equal(security.public_holder_lists.evm_provider, "blockscout");
  assert.equal(security.public_holder_lists.evm_complete_holder_census_claimed, false);
  assert.equal(security.public_holder_lists.evm_real_token_staging_validation_completed, true);
  assert.equal(security.public_holder_lists.evm_candidate_ready_for_activation, true);
  assert.equal(security.public_holder_lists.evm_release_activation_enabled, true);
  assert.equal(security.public_holder_lists.evm_v4_pool_custody_exclusion_unresolved, true);
  assert.equal(security.public_holder_lists.evm_production_activation_completed, false);
  assert.equal(security.public_holder_lists.maximum_public_owner_rows, 100);
  assert.equal(security.public_holder_lists.maximum_census_source_token_accounts, 25_000);
  assert.equal(security.public_holder_lists.partial_scan_rankings_returned, false);
  assert.equal(security.public_holder_lists.private_rpc_fallback_allowed, false);
  assert.equal(security.public_holder_lists.paid_provider_endpoint_validated, true);
  assert.equal(security.public_holder_lists.production_activation_completed, true);
  assert.equal(security.operator_solana_canary.implementation_status, "operator_unsigned_mainnet_preflight");
  assert.equal(security.operator_solana_canary.surface, "operator_cli_only");
  assert.equal(security.operator_solana_canary.exact_terminal_identity_required, true);
  assert.equal(security.operator_solana_canary.exact_pool_identity_revalidated_server_side, true);
  assert.equal(security.operator_solana_canary.separate_low_balance_wallet_required, true);
  assert.equal(security.operator_solana_canary.maximum_buy_lamports, 50_000_000);
  assert.equal(security.operator_solana_canary.maximum_canary_wallet_lamports, 100_000_000);
  assert.equal(security.operator_solana_canary.maximum_slippage_bps, 300);
  assert.equal(security.operator_solana_canary.maximum_price_impact_bps, 500);
  assert.equal(security.operator_solana_canary.maximum_priority_fee_lamports, 50_000);
  assert.equal(security.operator_solana_canary.maximum_network_fee_lamports, 70_000);
  assert.equal(security.operator_solana_canary.maximum_rent_fee_lamports, 5_000_000);
  assert.equal(security.operator_solana_canary.maximum_total_fee_lamports, 5_100_000);
  assert.equal(security.operator_solana_canary.maximum_total_native_debit_lamports, 56_000_000);
  assert.equal(security.operator_solana_canary.maximum_route_legs, 8);
  assert.equal(security.operator_solana_canary.maximum_resolved_writable_accounts, 48);
  assert.equal(security.operator_solana_canary.maximum_compute_units, 1_400_000);
  assert.equal(security.operator_solana_canary.mainnet_genesis_hash_required, true);
  assert.equal(security.operator_solana_canary.selected_mint_resolved_by_rpc, true);
  assert.equal(security.operator_solana_canary.versioned_transaction_decoded, true);
  assert.equal(security.operator_solana_canary.lookup_tables_resolved, true);
  assert.equal(security.operator_solana_canary.recent_blockhash_validated, true);
  assert.equal(security.operator_solana_canary.writable_account_prestate_loaded, true);
  assert.equal(security.operator_solana_canary.exact_selected_token_delta_verified, true);
  assert.equal(security.operator_solana_canary.wrapped_sol_economic_reconciliation_required, true);
  assert.equal(security.operator_solana_canary.monotonic_rpc_context_required, true);
  assert.equal(security.operator_solana_canary.unknown_programs_fail_closed, true);
  assert.equal(security.operator_solana_canary.unsigned_mainnet_simulation_required, true);
  assert.equal(security.operator_solana_canary.signature_use, "unavailable_preflight_only");
  assert.equal(security.operator_solana_canary.secret_material_accepted, false);
  assert.equal(security.operator_solana_canary.raw_transaction_returned, false);
  assert.equal(security.operator_solana_canary.secret_material_returned, false);
  assert.equal(security.operator_solana_canary.browser_signing_available, false);
  assert.equal(security.operator_solana_canary.customer_submission_available, false);
  assert.equal(security.operator_solana_canary.operator_submission_available, false);
  assert.equal(security.operator_solana_canary.production_activation_completed, false);
  assert.equal(security.customer_live_execution_canary.implementation_status, "owner_canary_code_ready");
  assert.equal(security.customer_live_execution_canary.surface, "https://app.ravenos.xyz/terminal/");
  assert.equal(security.customer_live_execution_canary.authenticated_origin_only, true);
  assert.equal(security.customer_live_execution_canary.csrf_required_for_mutations, true);
  assert.equal(security.customer_live_execution_canary.recent_authentication_required, true);
  assert.equal(security.customer_live_execution_canary.explicit_user_allowlist_required, true);
  assert.equal(security.customer_live_execution_canary.wildcard_allowlist_for_initial_canary, false);
  assert.equal(security.customer_live_execution_canary.wildcard_allowlist_for_authenticated_public_release, true);
  assert.equal(security.customer_live_execution_canary.hyperliquid_wallet_signing_available, true);
  assert.equal(security.customer_live_execution_canary.hyperliquid_wallet_submission_available, true);
  assert.equal(security.customer_live_execution_canary.solana_wallet_signing_available, true);
  assert.equal(security.customer_live_execution_canary.solana_wallet_submission_available, true);
  assert.equal(security.customer_live_execution_canary.solana_exact_transaction_review_required, true);
  assert.equal(security.customer_live_execution_canary.solana_unsigned_simulation_required, true);
  assert.equal(security.customer_live_execution_canary.solana_onchain_economic_reconciliation_required, true);
  assert.equal(security.customer_live_execution_canary.solana_live_raven_fee_bps, 0);
  assert.equal(security.customer_live_execution_canary.solana_fee_collection_available, false);
  assert.equal(security.customer_live_execution_canary.evm_live_raven_fee_bps, 100);
  assert.equal(security.customer_live_execution_canary.evm_pro_raven_fee_bps, 70);
  assert.equal(security.customer_live_execution_canary.evm_fee_collection_available, true);
  assert.equal(security.customer_live_execution_canary.evm_fee_accounting_chain_local, true);
  assert.equal(security.customer_live_execution_canary.robinhood_chain_live_execution_candidate, true);
  assert.equal(security.customer_live_execution_canary.robinhood_stock_tokens_live_execution_available, false);
  assert.equal(security.customer_live_execution_canary.robinhood_reverse_exit_proof_required_for_buys, true);
  assert.equal(security.customer_live_execution_canary.bnb_chain_live_execution_candidate, true);
  assert.match(security.customer_live_execution_canary.bnb_chain_accounting_asset, /not Circle-native USDC/);
  assert.equal(security.customer_live_execution_canary.bnb_chain_reverse_exit_proof_required_for_buys, true);
  assert.equal(security.customer_live_execution_canary.base_live_execution_candidate, true);
  assert.match(security.customer_live_execution_canary.base_accounting_asset, /Circle-native USDC/);
  assert.equal(security.customer_live_execution_canary.base_reverse_exit_proof_required_for_buys, true);
  assert.equal(security.customer_live_execution_canary.ethereum_live_execution_candidate, true);
  assert.match(security.customer_live_execution_canary.ethereum_accounting_asset, /Circle-native USDC/);
  assert.equal(security.customer_live_execution_canary.ethereum_reverse_exit_proof_required_for_buys, true);
  assert.equal(security.customer_live_execution_canary.raven_signing_available, false);
  assert.equal(security.customer_live_execution_canary.raven_private_keys_available, false);
  assert.equal(security.customer_live_execution_canary.custody_available, false);
  assert.equal(security.customer_live_execution_canary.arbitrary_submission_available, false);
  assert.equal(security.customer_live_execution_canary.fee_policy_server_owned, true);
  assert.equal(security.customer_live_execution_canary.fee_recipient_server_owned, true);
  assert.equal(security.customer_live_execution_canary.hyperliquid_builder_fee_maximum_bps, 10);
  assert.equal(security.customer_live_execution_canary.builder_fee_user_approval_required, true);
  assert.equal(security.customer_live_execution_canary.builder_fee_approval_separate_from_order, true);
  assert.equal(security.customer_live_execution_canary.private_keys_or_signatures_persisted, false);
  assert.equal(security.customer_live_execution_canary.append_only_execution_evidence, true);
  assert.equal(security.customer_live_execution_canary.all_activation_controls_default_off, true);
  assert.equal(security.customer_live_execution_canary.production_activation_completed, false);
  assert(security.blocked_capabilities.includes("operator_canary_submission"));
  assert(security.blocked_capabilities.includes("community_production_activation"));
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
  assert.equal(rows.length, 43);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  const future = rows.filter((row) => ["stage_b", "stage_c", "stage_d", "stage_e"].includes(row.gate));
  assert(future.length >= 15);
  assert(future.every((row) => row.status !== "verified_current"));
  const stageA = rows.filter((row) => row.gate === "stage_a");
  assert(stageA.length > 0);
  assert(stageA.every((row) => !["blocked", "required_not_implemented"].includes(row.status)));
  assert(stageA.some((row) => row.status === "external_review_required"));
  for (const prefix of ["SEC-SES", "SEC-CSRF", "SEC-ID", "SEC-COM", "SEC-AUTHZ", "SEC-RSCH", "SEC-ENT", "SEC-ALT", "SEC-WAL", "SEC-WOBS", "SEC-COPY", "SEC-BIL", "SEC-ENUM", "SEC-EDGE", "SEC-XSS", "SEC-CSP", "SEC-TX"]) {
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

test("operator Solana canary preflight accepts no signing material and contains no submission path", () => {
  const operator = readFileSync("lib/customer_trade/operator_solana_canary.mjs", "utf8");
  const cli = readFileSync("scripts/run-solana-canary-dry-run.mjs", "utf8");
  assert.match(operator, /submission:\s*false/);
  assert.match(operator, /signing_for_simulation:\s*false/);
  assert.match(operator, /signing_material_not_accepted_by_preflight/);
  assert.match(operator, /sigVerify:\s*false/);
  assert.doesNotMatch(operator, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
  assert.doesNotMatch(cli, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
  assert.match(cli, /never submits/i);
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

test("the authenticated hostname exposes only approved account and reviewed dormant workspaces", async () => {
  const accountHtml = readFileSync("account/index.html", "utf8");
  const intelligenceHtml = readFileSync("account/intelligence/index.html", "utf8");
  const communityHtml = readFileSync("community/index.html", "utf8");
  const communityProfileHtml = readFileSync("community/profile/index.html", "utf8");
  const monitorHtml = readFileSync("monitor/index.html", "utf8");
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/account/") return new Response(accountHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/account/intelligence/") return new Response(intelligenceHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/community/" || pathname === "/community/index.html") return new Response(communityHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/community/profile/index.html") return new Response(communityProfileHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname === "/monitor/") return new Response(monitorHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (pathname.startsWith("/assets/") || ["/ravenos-account.js", "/ravenos-community.js", "/ravenos-community.css", "/ravenos-monitor.js", "/ravenos-monitor.css", "/ravenos-pro-intelligence.js", "/ravenos-pro-intelligence.css", "/ravenos-workspace.css"].includes(pathname)) return new Response("asset", { headers: { "content-type": pathname.endsWith(".css") ? "text/css" : "application/javascript" } });
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

  const community = await worker.fetch(new Request("https://app.ravenos.xyz/community/"), env);
  assert.equal(community.status, 200);
  assert.match(community.headers.get("cache-control") || "", /no-store/);
  assert.match(community.headers.get("content-security-policy") || "", /default-src 'self'/);
  const communityApi = await worker.fetch(new Request("https://app.ravenos.xyz/api/v1/community/boards"), env);
  assert.equal(communityApi.status, 503);
  assert.equal(JSON.parse(await communityApi.text()).error, "community_disabled");
  const publicProfile = await worker.fetch(new Request("https://ravenos.xyz/@chart_witch"), env);
  assert.equal(publicProfile.status, 200);
  assert.match(publicProfile.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(await publicProfile.text(), /Public Raven profile|Loading profile/);
  const appProfile = await worker.fetch(new Request("https://app.ravenos.xyz/@chart_witch?secret=must-not-stay-on-app"), env);
  assert.equal(appProfile.status, 308);
  assert.equal(appProfile.headers.get("location"), "https://ravenos.xyz/@chart_witch");

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
  assert.equal(terminal.status, 200);
  assert.equal(terminal.headers.get("location"), null);
  assert.match(terminal.headers.get("content-security-policy") || "", /default-src 'self'/);

  const ravenLab = await worker.fetch(new Request("https://app.ravenos.xyz/intelligence/?code=must-not-cross-origins"), env);
  assert.equal(ravenLab.status, 308);
  assert.equal(ravenLab.headers.get("location"), "https://ravenos.xyz/intelligence/");

  const marketApi = await worker.fetch(new Request("https://app.ravenos.xyz/api/trade/flags?token=must-not-echo"), env);
  assert.equal(marketApi.status, 200);
  assert.equal((await marketApi.text()).includes("must-not-echo"), false);

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
  assert.equal(security.required_documents.length, 16);
  for (const path of security.required_documents) assert(statSync(path).size > 1000, path);
});
