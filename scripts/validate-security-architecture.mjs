import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const configPath = join(root, "config/customer_security.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

assert.equal(config.schema_version, "ravenos.customer_security_architecture.v1");
assert.equal(config.verification_baseline.standard, "OWASP ASVS");
assert.equal(config.verification_baseline.version, "5.0.0");
assert.equal(config.verification_baseline.minimum_level, 2);
assert.equal(config.current_stage, "stage_a_accounts_active");
assert.equal(config.customer_capabilities_enabled, true);
assert.equal(config.identity_provider.kind, "managed_identity");
assert.equal(config.identity_provider.implementation, "workos_authkit");
assert.equal(config.identity_provider.production_tenant_configured, true);
assert.equal(config.identity_provider.provider_tokens_retained_by_ravenos, false);
assert.equal(config.identity_provider.google_oauth_tokens_returned_to_ravenos, false);
assert.equal(config.identity_provider.passkeys_enabled, false);
for (const method of ["GoogleOAuth", "Password", "MagicAuth"]) {
  assert(config.identity_provider.requested_methods.includes(method), `missing active authentication method: ${method}`);
}

const requiredActiveCapabilities = new Set([
  "account_creation",
  "customer_authentication",
  "customer_sessions",
]);
const activeCapabilities = new Set(config.active_capabilities || []);
for (const capability of requiredActiveCapabilities) {
  assert(activeCapabilities.has(capability), `missing active customer capability: ${capability}`);
}

const requiredBlockedCapabilities = new Set([
  "wallet_linking",
  "persistent_portfolio",
  "subscription_checkout",
  "subscription_entitlements",
  "broker_account_linking",
  "operator_canary_submission",
  "customer_signing",
  "transaction_submission",
  "customer_position_monitoring",
  "saved_monitor_production_activation",
]);
const blockedCapabilities = new Set(config.blocked_capabilities || []);
for (const capability of requiredBlockedCapabilities) {
  assert(blockedCapabilities.has(capability), `missing blocked customer capability: ${capability}`);
}
for (const capability of requiredActiveCapabilities) {
  assert(!blockedCapabilities.has(capability), `active capability remains blocked: ${capability}`);
}

assert.equal(config.session_policy.kind, "opaque_revocable_server_side");
assert.equal(config.session_policy.cookie_name, "__Host-ravenos_session");
assert.equal(config.session_policy.domain_attribute_permitted, false);
assert.equal(config.session_policy.browser_storage_tokens_permitted, false);
for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) {
  assert(config.session_policy.cookie_attributes.includes(attribute), `missing required session cookie attribute: ${attribute}`);
}
assert.equal(config.portfolio_preview.implementation_status, "feature_flagged_read_only_beta");
assert.equal(config.portfolio_preview.authenticated_origin_only, true);
assert.equal(config.portfolio_preview.csrf_required_for_analysis, true);
assert.equal(config.portfolio_preview.raw_address_input_allowed, false);
assert.equal(config.portfolio_preview.durable_wallet_link_active, false);
assert.equal(config.portfolio_preview.portfolio_history_persisted, false);
assert.equal(config.portfolio_preview.policy_storage_active, false);
assert.equal(config.portfolio_preview.maximum_provider_calls_per_analysis, 8);
assert.equal(config.portfolio_preview.signing_available, false);
assert.equal(config.portfolio_preview.submission_available, false);
assert.equal(config.portfolio_preview.custody_available, false);
assert.equal(config.saved_monitor.implementation_status, "local_candidate_not_deployed");
assert.equal(config.saved_monitor.authenticated_origin_only, true);
assert.equal(config.saved_monitor.csrf_required_for_mutations, true);
assert.equal(config.saved_monitor.exact_market_identity_only, true);
assert.equal(config.saved_monitor.raw_provider_payloads_persisted, false);
assert.equal(config.saved_monitor.wallet_data_persisted, false);
assert.equal(config.saved_monitor.alerts_available, false);
assert.equal(config.saved_monitor.execution_available, false);
assert.equal(config.saved_monitor.production_activation_completed, false);
assert.equal(config.raven_monitor.implementation_status, "local_dormant_candidate_not_deployed");
assert.equal(config.raven_monitor.authenticated_origin_only, true);
assert.equal(config.raven_monitor.csrf_required_for_mutations, true);
assert.equal(config.raven_monitor.exact_market_identity_only, true);
assert.equal(config.raven_monitor.all_activation_controls_default_off, true);
assert.equal(config.raven_monitor.maximum_rules_per_account, 100);
assert.equal(config.raven_monitor.maximum_notification_history_per_account, 1000);
assert.equal(config.raven_monitor.notification_retention_days, 90);
assert.equal(config.raven_monitor.raw_provider_payloads_persisted, false);
assert.equal(config.raven_monitor.plan_prices_persisted, false);
assert.equal(config.raven_monitor.wallet_or_execution_data_persisted, false);
assert.equal(config.raven_monitor.out_of_app_delivery_active, false);
assert.equal(config.raven_monitor.scheduler_trigger_configured, true);
assert.equal(config.raven_monitor.scheduler_activation_flags_default_off, true);
assert.equal(config.raven_monitor.production_activation_completed, false);
assert.equal(config.shadow_route_sampling.aggregate_public_output_only, true);
assert.equal(config.shadow_route_sampling.exact_market_identity_required, true);
assert.equal(config.shadow_route_sampling.customer_identity_persisted, false);
assert.equal(config.shadow_route_sampling.wallet_or_network_address_persisted, false);
assert.equal(config.shadow_route_sampling.raw_provider_payloads_persisted, false);
assert.equal(config.shadow_route_sampling.plan_prices_persisted, false);
assert.equal(config.shadow_route_sampling.transaction_material_persisted, false);
assert.equal(config.shadow_route_sampling.signing_available, false);
assert.equal(config.shadow_route_sampling.submission_available, false);
assert.equal(config.shadow_route_sampling.fee_charging_available, false);
assert.equal(config.entitlement_foundation.implementation_status, "local_dormant_foundation");
assert.equal(config.entitlement_foundation.surface, "https://app.ravenos.xyz/account/intelligence/");
assert.equal(config.entitlement_foundation.authenticated_origin_only, true);
assert.equal(config.entitlement_foundation.all_activation_controls_default_off, true);
assert.equal(config.entitlement_foundation.coordinated_projection_split_required, true);
assert.deepEqual(config.entitlement_foundation.free_projection_limits, { perps_markets: 6, participant_conditions: 6 });
assert.deepEqual(config.entitlement_foundation.pro_projection_limits, { perps_rows_per_table: 40, participant_conditions: 160 });
assert.equal(config.entitlement_foundation.direct_public_artifact_aliases_projected_when_active, true);
assert.equal(config.entitlement_foundation.public_behavior_unchanged_while_off, true);
assert.equal(config.entitlement_foundation.customer_mutation_available, false);
assert.equal(config.entitlement_foundation.checkout_available, false);
assert.equal(config.entitlement_foundation.billing_available, false);
assert.equal(config.entitlement_foundation.shared_cache_allowed, false);
assert.equal(config.entitlement_foundation.atlas_display_rights_override_available, false);
assert.equal(config.entitlement_foundation.production_activation_completed, false);
assert.equal(config.wallet_copy.implementation_status, "staging_dormant_shared_observer_candidate");
assert.equal(config.wallet_copy.surface, "https://app.ravenos.xyz/account/copy/");
assert.equal(config.wallet_copy.capability, "wallet.copy");
assert.equal(config.wallet_copy.authenticated_origin_only, true);
assert.equal(config.wallet_copy.csrf_required_for_mutations, true);
assert.equal(config.wallet_copy.server_owned_pro_entitlement_required, true);
assert.deepEqual(config.wallet_copy.supported_chains, ["solana"]);
assert.equal(config.wallet_copy.maximum_watches_per_account, 25);
assert.equal(config.wallet_copy.maximum_history_transactions_per_refresh, 24);
assert.equal(config.wallet_copy.maximum_new_signals_per_refresh, 3);
assert.equal(config.wallet_copy.shared_source_observation, true);
assert.equal(config.wallet_copy.shared_observer_queue_implemented, true);
assert.deepEqual(config.wallet_copy.shared_observer_transport_contracts, ["rpc_poll", "geyser_grpc", "shredstream", "replay"]);
assert.equal(config.wallet_copy.constant_k_nexus_adapter_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_live_probe_completed, true);
assert.equal(config.wallet_copy.constant_k_nexus_receiver_contract_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_receiver_restart_rotation_tested, true);
assert.equal(config.wallet_copy.constant_k_nexus_watch_manifest_contract_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_maximum_wallet_universe, 25_000);
assert.equal(config.wallet_copy.constant_k_nexus_watch_manifest_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_persistent_receiver_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_authenticated_ingress_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_authenticated_ingress_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_exact_host_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_hmac_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_hmac_rotation_supported, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_access_service_token_supported, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_maximum_clock_skew_seconds, 90);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_maximum_deliveries_per_batch, 50);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_manifest_cache_seconds, 5);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_append_only_receipts, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_raw_provider_payload_allowed, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_transaction_material_allowed, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_checkpoint_after_durable_ack, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_exact_manifest_required, true);
assert.equal(config.wallet_copy.deep_history_backfill_contract_implemented, true);
assert.equal(config.wallet_copy.deep_history_backfill_active, false);
assert.equal(config.wallet_copy.deep_history_shared_per_source_wallet, true);
assert.equal(config.wallet_copy.deep_history_provider_page_size, 100);
assert.equal(config.wallet_copy.deep_history_scheduled_wallets_per_run, 4);
assert.equal(config.wallet_copy.deep_history_maximum_signatures_per_wallet, 10_000);
assert.equal(config.wallet_copy.deep_history_profile_snapshot_event_limit, 2_000);
assert.equal(config.wallet_copy.deep_history_completion_requires_provider_exhaustion, true);
assert.equal(config.wallet_copy.source_sell_mapping_contract_implemented, true);
assert.equal(config.wallet_copy.source_sell_mapping_active, false);
assert.equal(config.wallet_copy.source_sell_exact_balance_evidence_required, true);
assert.equal(config.wallet_copy.source_sell_maps_raven_created_lots_only, true);
assert.equal(config.wallet_copy.source_sell_partial_exits_proportional, true);
assert.equal(config.wallet_copy.pre_subscription_inventory_ignored, true);
assert.equal(config.wallet_copy.shadow_exit_evidence_append_only, true);
assert.equal(config.wallet_copy.shadow_exit_live_assets_held, false);
assert.equal(config.wallet_copy.maximum_mapped_positions_per_watch, 2_000);
assert.equal(config.wallet_copy.maximum_exit_history_per_position_view, 2_000);
assert.equal(config.wallet_copy.one_decode_per_source_transaction, true);
assert.equal(config.wallet_copy.subscriber_proportional_rpc_polling, false);
assert.equal(config.wallet_copy.provider_and_finality_deliveries_append_only, true);
assert.equal(config.wallet_copy.observer_queue_restart_safe, true);
assert.deepEqual(config.wallet_copy.observer_latency_percentiles_recorded, [50, 90, 95, 99]);
assert.equal(config.wallet_copy.subscriber_relationships_private, true);
assert.equal(config.wallet_copy.raw_provider_payloads_persisted, false);
assert.equal(config.wallet_copy.signer_material_persisted, false);
assert.equal(config.wallet_copy.transaction_material_persisted, false);
assert.equal(config.wallet_copy.source_and_follower_performance_separate, true);
assert.equal(config.wallet_copy.historical_and_prospective_evidence_separate, true);
assert.equal(config.wallet_copy.live_copy_source_level_disabled, true);
assert.equal(config.wallet_copy.signing_source_level_disabled, true);
assert.equal(config.wallet_copy.broadcasting_source_level_disabled, true);
assert.equal(config.wallet_copy.fee_collection_source_level_disabled, true);
assert.equal(config.wallet_copy.continuous_observer_active, false);
assert.equal(config.wallet_copy.scheduler_active, false);
assert.equal(config.wallet_copy.all_activation_controls_default_off, true);
assert.equal(config.wallet_copy.production_activation_completed, false);
assert.equal(config.public_holder_lists.implementation_status, "production_provider_validated");
assert.equal(config.public_holder_lists.free_tier_capability, true);
assert.equal(config.public_holder_lists.exact_pool_and_mint_identity_required, true);
assert.equal(config.public_holder_lists.maximum_public_owner_rows, 100);
assert.equal(config.public_holder_lists.maximum_census_source_token_accounts, 25_000);
assert.equal(config.public_holder_lists.partial_scan_rankings_returned, false);
assert.equal(config.public_holder_lists.private_rpc_fallback_allowed, false);
assert.equal(config.public_holder_lists.paid_provider_endpoint_validated, true);
assert.equal(config.public_holder_lists.production_activation_completed, true);
assert.equal(config.operator_solana_canary.implementation_status, "operator_unsigned_mainnet_preflight");
assert.equal(config.operator_solana_canary.surface, "operator_cli_only");
assert.equal(config.operator_solana_canary.exact_terminal_identity_required, true);
assert.equal(config.operator_solana_canary.exact_pool_identity_revalidated_server_side, true);
assert.equal(config.operator_solana_canary.separate_low_balance_wallet_required, true);
assert.equal(config.operator_solana_canary.maximum_buy_lamports, 50_000_000);
assert.equal(config.operator_solana_canary.maximum_canary_wallet_lamports, 100_000_000);
assert.equal(config.operator_solana_canary.maximum_slippage_bps, 300);
assert.equal(config.operator_solana_canary.maximum_price_impact_bps, 500);
assert.equal(config.operator_solana_canary.maximum_priority_fee_lamports, 50_000);
assert.equal(config.operator_solana_canary.maximum_network_fee_lamports, 70_000);
assert.equal(config.operator_solana_canary.maximum_rent_fee_lamports, 5_000_000);
assert.equal(config.operator_solana_canary.maximum_total_fee_lamports, 5_100_000);
assert.equal(config.operator_solana_canary.maximum_total_native_debit_lamports, 56_000_000);
assert.equal(config.operator_solana_canary.maximum_route_legs, 8);
assert.equal(config.operator_solana_canary.maximum_resolved_writable_accounts, 48);
assert.equal(config.operator_solana_canary.maximum_compute_units, 1_400_000);
assert.equal(config.operator_solana_canary.mainnet_genesis_hash_required, true);
assert.equal(config.operator_solana_canary.selected_mint_resolved_by_rpc, true);
assert.equal(config.operator_solana_canary.versioned_transaction_decoded, true);
assert.equal(config.operator_solana_canary.lookup_tables_resolved, true);
assert.equal(config.operator_solana_canary.recent_blockhash_validated, true);
assert.equal(config.operator_solana_canary.writable_account_prestate_loaded, true);
assert.equal(config.operator_solana_canary.exact_selected_token_delta_verified, true);
assert.equal(config.operator_solana_canary.wrapped_sol_economic_reconciliation_required, true);
assert.equal(config.operator_solana_canary.monotonic_rpc_context_required, true);
assert.equal(config.operator_solana_canary.unknown_programs_fail_closed, true);
assert.equal(config.operator_solana_canary.unsigned_mainnet_simulation_required, true);
assert.equal(config.operator_solana_canary.signature_use, "unavailable_preflight_only");
assert.equal(config.operator_solana_canary.secret_material_accepted, false);
assert.equal(config.operator_solana_canary.raw_transaction_returned, false);
assert.equal(config.operator_solana_canary.secret_material_returned, false);
assert.equal(config.operator_solana_canary.browser_signing_available, false);
assert.equal(config.operator_solana_canary.customer_submission_available, false);
assert.equal(config.operator_solana_canary.operator_submission_available, false);
assert.equal(config.operator_solana_canary.production_activation_completed, false);

for (const documentPath of config.required_documents || []) {
  const absolute = join(root, documentPath);
  assert(existsSync(absolute), `missing customer security document: ${documentPath}`);
  assert(statSync(absolute).size > 1000, `customer security document is unexpectedly small: ${documentPath}`);
}

const requiredScenarios = [
  "SEC-SES-001", "SEC-SES-002", "SEC-SES-003", "SEC-CSRF-001",
  "SEC-AUTHZ-001", "SEC-AUTHZ-002", "SEC-WAL-001", "SEC-WAL-002",
  "SEC-RSCH-001", "SEC-RSCH-002",
  "SEC-ENT-001", "SEC-ENT-002",
  "SEC-ALT-001", "SEC-ALT-002",
  "SEC-COPY-001", "SEC-COPY-002",
  "SEC-WAL-003", "SEC-WAL-004", "SEC-WAL-005", "SEC-WAL-006",
  "SEC-BIL-001", "SEC-BIL-002", "SEC-BIL-003", "SEC-ENUM-001",
  "SEC-EDGE-001", "SEC-XSS-001", "SEC-CSP-001", "SEC-LEAK-001",
  "SEC-TX-001", "SEC-TX-002", "SEC-TX-003", "SEC-TX-004",
  "SEC-TX-005", "SEC-TX-006", "SEC-TX-007", "SEC-REL-001",
];
const scenarioRows = config.verification_scenarios || [];
const scenarioIds = new Set(scenarioRows.map((row) => row.id));
assert.equal(scenarioIds.size, scenarioRows.length, "security scenario IDs must be unique");
for (const id of requiredScenarios) assert(scenarioIds.has(id), `missing required security scenario: ${id}`);
for (const row of scenarioRows) {
  assert(["verified_current", "verified_local_candidate", "required_not_implemented", "blocked", "external_review_required", "not_applicable"].includes(row.status), `invalid status for ${row.id}`);
  if (["stage_b", "stage_c", "stage_d", "stage_e"].includes(row.gate)) assert.notEqual(row.status, "verified_current", `${row.id} cannot be verified before its customer system exists`);
  if (row.status === "verified_current") assert(row.evidence || row.gate === "current", `${row.id} requires current evidence`);
  if (row.status === "not_applicable") assert(row.rationale, `${row.id} requires a not-applicable rationale`);
}
const stageARows = scenarioRows.filter((row) => row.gate === "stage_a");
assert(stageARows.length > 0, "Stage A security scenarios are missing");
assert(stageARows.every((row) => !["blocked", "required_not_implemented"].includes(row.status)), "active Stage A controls cannot remain blocked or unimplemented");

const worker = readFileSync(join(root, "worker.mjs"), "utf8");
assert(worker.includes('from "./lib/customer_identity.mjs"'), "Stage A managed identity router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_research_state.mjs"'), "Saved Monitor research-state router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_entitlements.mjs"'), "server-owned entitlement router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_monitor_alerts.mjs"'), "Raven Monitor router and evaluator are missing from the Worker graph");
assert(worker.includes('from "./lib/customer_wallet_copy.mjs"'), "Raven Copy authenticated router is missing from the Worker graph");
assert(worker.includes('const AUTHENTICATED_APP_HOST = "app.ravenos.xyz"'), "authenticated application origin boundary is missing");
assert(worker.includes("authenticatedAppBoundary(request)"), "authenticated application origin is not enforced in the Worker");
assert(worker.includes("routeCustomerResearchState(request, env"), "Saved Monitor route is not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerEntitlements(request, env"), "entitlement routes are not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerMonitorAlerts(request, env"), "Raven Monitor routes are not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerWalletCopy(request, env"), "Raven Copy routes are not wired through the authenticated Worker boundary");
assert(worker.includes("runCustomerMonitorEvaluator(env"), "Raven Monitor evaluator is not wired through the dormant scheduled boundary");
for (const importName of ["ravenos_access.mjs", "ravenos_subscriptions.mjs", "ravenos_stripe_webhooks.mjs", "solana_wallet_auth.mjs"]) {
  assert(!worker.includes(`from \"./lib/${importName}\"`), `legacy customer module remains in the Worker graph: ${importName}`);
}
for (const reason of ["legacy_customer_access_quarantined", "legacy_billing_quarantined"]) {
  assert(worker.includes(reason), `Worker is missing legacy quarantine response: ${reason}`);
}
const operatorCanary = readFileSync(join(root, "lib/customer_trade/operator_solana_canary.mjs"), "utf8");
const operatorCanaryCli = readFileSync(join(root, "scripts/run-solana-canary-dry-run.mjs"), "utf8");
assert.match(operatorCanary, /submission:\s*false/);
assert.match(operatorCanary, /signing_for_simulation:\s*false/);
assert.match(operatorCanary, /signing_material_not_accepted_by_preflight/);
assert.match(operatorCanary, /sigVerify:\s*false/);
assert.match(operatorCanary, /SOLANA_MAINNET_GENESIS_HASH/);
assert.doesNotMatch(operatorCanary, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
assert.doesNotMatch(operatorCanaryCli, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
assert.match(worker, /function customerAccountsEnabled\(\)\s*{\s*return false;\s*}/);
assert.match(worker, /function customerBillingEnabled\(\)\s*{\s*return false;\s*}/);
const identity = readFileSync(join(root, "lib/customer_identity.mjs"), "utf8");
assert.match(identity, /passkey:\s*false/);
assert.match(identity, /magic_auth:\s*available/);

const deployScript = readFileSync(join(root, "scripts/prepare-deploy-assets.mjs"), "utf8");
const runtimeBlock = deployScript.match(/const runtimeAssets = \[([\s\S]*?)\n\];/)?.[1] || "";
for (const asset of config.legacy_quarantine.client_assets_excluded_from_release || []) {
  assert(!runtimeBlock.includes(`\"${asset}\"`), `legacy customer asset remains deployable: ${asset}`);
}

const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
for (const activationFlag of [
  "RAVENOS_CUSTOMER_ACCOUNTS_ENABLE",
  "RAVENOS_AUTH_ENABLE",
  "RAVENOS_BILLING_ENABLE",
  "RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE",
  "RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE",
  ...config.entitlement_foundation.activation_controls,
  ...config.raven_monitor.activation_controls,
  ...config.wallet_copy.activation_controls,
]) {
  assert(!wrangler.includes(activationFlag), `customer activation flag must not be configured in Wrangler: ${activationFlag}`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(packageJson.scripts["validate:security"] || "", /validate-security-architecture\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_security_foundation\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_entitlements\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_monitor_alerts\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /solana_wallet_intelligence\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_trade_wallet_copy\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_wallet_copy\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_backfill\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_ingress\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_discovery_admission\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /constant_k_nexus_wallet_ingress_client\.test\.mjs/);
assert.equal(packageJson.scripts["validate:wallet-copy-live"], "node scripts/validate-wallet-copy-live.mjs");
const walletCopyLiveValidator = readFileSync(join(root, "scripts", "validate-wallet-copy-live.mjs"), "utf8");
assert(walletCopyLiveValidator.includes('mode: "authorized_read_only_manual_probe"'), "wallet-copy live validator must identify its read-only authority");
assert(walletCopyLiveValidator.includes("transaction_material_returned"), "wallet-copy live validator must reject transaction material");
for (const forbiddenWalletCopyAuthority of ["sendRawTransaction", "sendTransaction", "signTransaction", "privateKey", "seedPhrase"]) {
  assert(!walletCopyLiveValidator.includes(forbiddenWalletCopyAuthority), `wallet-copy live validator contains forbidden authority: ${forbiddenWalletCopyAuthority}`);
}
assert.equal(packageJson.scripts["validate:wallet-observer-live"], "node scripts/validate-wallet-observer-live.mjs");
const walletObserverLiveValidator = readFileSync(join(root, "scripts", "validate-wallet-observer-live.mjs"), "utf8");
const walletObserverTransports = readFileSync(join(root, "lib", "customer_trade", "source_wallet_transports.mjs"), "utf8");
const walletObserverIngress = readFileSync(join(root, "lib", "customer_trade", "source_wallet_ingress.mjs"), "utf8");
const walletObserverIngressProtocol = readFileSync(join(root, "lib", "customer_trade", "source_wallet_ingress_protocol.mjs"), "utf8");
const walletObserverIngressClient = readFileSync(join(root, "lib", "customer_trade", "constant_k_nexus_wallet_ingress_client.mjs"), "utf8");
const walletObserverReceiverDaemon = readFileSync(join(root, "scripts", "run-constant-k-wallet-observer-receiver.mjs"), "utf8");
const walletDiscoveryIngress = readFileSync(join(root, "lib", "customer_trade", "source_wallet_discovery_ingress.mjs"), "utf8");
const walletDiscoveryAdmission = readFileSync(join(root, "lib", "customer_trade", "source_wallet_discovery_admission.mjs"), "utf8");
assert(walletObserverLiveValidator.includes('mode: "authorized_read_only_manual_probe"'), "wallet-observer validator must identify its read-only authority");
assert(walletObserverLiveValidator.includes("prospective_detection_latency_measured: false"), "RPC catch-up must not be presented as prospective speed evidence");
assert(walletObserverTransports.includes('transport: "shredstream"') || walletObserverTransports.includes('"shredstream"'), "private shred adapter contract is missing");
assert(walletObserverTransports.includes("provider_catch_up_bound_exceeded"), "wallet observer must fail closed on a bounded catch-up gap");
assert(walletObserverIngress.includes("RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED"), "wallet ingress must have an independent default-off activation gate");
assert(walletObserverIngress.includes("RAVENOS_WALLET_OBSERVER_INGRESS_HOST"), "wallet ingress must require an exact configured host");
assert(walletObserverIngressProtocol.includes("globalThis.crypto.subtle.verify"), "wallet ingress HMAC must use Web Crypto verification");
assert(walletObserverIngressProtocol.includes("observer_ingress_transaction_material_forbidden"), "wallet ingress must reject normalized transaction material");
assert(walletObserverReceiverDaemon.includes("RAVENOS_WALLET_OBSERVER_RECEIVER_ENABLED"), "receiver daemon must have a separate local activation gate");
assert(walletObserverReceiverDaemon.includes("activeAck = normalizeSourceWalletWatchManifestAck"), "receiver daemon must require exact provider manifest acknowledgement");
assert(walletObserverReceiverDaemon.indexOf("ingressSummary = await postConstantKNexusDeliveries") < walletObserverReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "receiver must post durable ingress before checkpoint persistence");
assert(walletDiscoveryAdmission.includes("RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED"), "wallet discovery ingress must have an independent default-off gate");
assert(walletDiscoveryIngress.includes("RAVENOS_WALLET_DISCOVERY_INGRESS_HOST"), "wallet discovery ingress must require an exact configured host");
assert(walletDiscoveryAdmission.includes("RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED"), "wallet discovery evaluator must have an independent default-off gate");
assert(walletDiscoveryAdmission.includes("event.route_evidence?.swap_route_observed === true"), "wallet discovery admission must require Raven-confirmed route evidence");
assert(walletObserverReceiverDaemon.indexOf("posted = await postConstantKNexusWalletDiscoveryObservations") < walletObserverReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "receiver must durably post discovery evidence before checkpoint persistence");
for (const discoveryFlag of ["RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED", "RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED"]) {
  assert(!wrangler.includes(discoveryFlag), `wallet discovery activation flag must not be configured in Wrangler: ${discoveryFlag}`);
}
for (const forbiddenWalletObserverAuthority of ["sendRawTransaction", "sendTransaction", "signTransaction", "privateKey", "seedPhrase"]) {
  assert(!walletObserverLiveValidator.includes(forbiddenWalletObserverAuthority), `wallet-observer live validator contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverTransports.includes(forbiddenWalletObserverAuthority), `wallet-observer transport contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngress.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngressProtocol.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress protocol contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngressClient.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress client contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverReceiverDaemon.includes(forbiddenWalletObserverAuthority), `wallet-observer receiver daemon contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletDiscoveryIngress.includes(forbiddenWalletObserverAuthority), `wallet-discovery ingress contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletDiscoveryAdmission.includes(forbiddenWalletObserverAuthority), `wallet-discovery admission contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
}

console.log(JSON.stringify({
  ok: true,
  schema_version: config.schema_version,
  current_stage: config.current_stage,
  asvs: `v${config.verification_baseline.version}-L${config.verification_baseline.minimum_level}`,
  required_documents: config.required_documents.length,
  verification_scenarios: scenarioRows.length,
  current_verified_scenarios: scenarioRows.filter((row) => row.status === "verified_current").map((row) => row.id),
  future_required_scenarios: scenarioRows.filter((row) => row.status === "required_not_implemented").length,
  activation_blocked_scenarios: scenarioRows.filter((row) => row.status === "blocked").length,
  legacy_customer_routes: "quarantined",
  customer_capabilities_enabled: true
}, null, 2));
