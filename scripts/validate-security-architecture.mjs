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
assert.equal(config.entitlement_foundation.implementation_status, "local_dormant_foundation");
assert.equal(config.entitlement_foundation.authenticated_origin_only, true);
assert.equal(config.entitlement_foundation.all_activation_controls_default_off, true);
assert.equal(config.entitlement_foundation.customer_mutation_available, false);
assert.equal(config.entitlement_foundation.checkout_available, false);
assert.equal(config.entitlement_foundation.billing_available, false);
assert.equal(config.entitlement_foundation.shared_cache_allowed, false);
assert.equal(config.entitlement_foundation.atlas_display_rights_override_available, false);
assert.equal(config.entitlement_foundation.production_activation_completed, false);

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
assert(worker.includes('const AUTHENTICATED_APP_HOST = "app.ravenos.xyz"'), "authenticated application origin boundary is missing");
assert(worker.includes("authenticatedAppBoundary(request)"), "authenticated application origin is not enforced in the Worker");
assert(worker.includes("routeCustomerResearchState(request, env"), "Saved Monitor route is not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerEntitlements(request, env"), "entitlement routes are not wired through the authenticated Worker boundary");
for (const importName of ["ravenos_access.mjs", "ravenos_subscriptions.mjs", "ravenos_stripe_webhooks.mjs", "solana_wallet_auth.mjs"]) {
  assert(!worker.includes(`from \"./lib/${importName}\"`), `legacy customer module remains in the Worker graph: ${importName}`);
}
for (const reason of ["legacy_customer_access_quarantined", "legacy_billing_quarantined"]) {
  assert(worker.includes(reason), `Worker is missing legacy quarantine response: ${reason}`);
}
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
]) {
  assert(!wrangler.includes(activationFlag), `customer activation flag must not be configured in Wrangler: ${activationFlag}`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(packageJson.scripts["validate:security"] || "", /validate-security-architecture\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_security_foundation\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_entitlements\.test\.mjs/);

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
