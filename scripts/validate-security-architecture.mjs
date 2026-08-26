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
assert.equal(config.current_stage, "stage_a_implementation_pending_activation");
assert.equal(config.customer_capabilities_enabled, false);
assert.equal(config.identity_provider.kind, "managed_identity");
assert.equal(config.identity_provider.implementation, "workos_authkit");
assert.equal(config.identity_provider.production_tenant_configured, false);
assert.equal(config.identity_provider.provider_tokens_retained_by_ravenos, false);

const requiredBlockedCapabilities = new Set([
  "account_creation",
  "customer_authentication",
  "customer_sessions",
  "wallet_linking",
  "persistent_portfolio",
  "subscription_checkout",
  "subscription_entitlements",
  "broker_account_linking",
  "customer_signing",
  "transaction_submission",
  "customer_position_monitoring",
]);
const blockedCapabilities = new Set(config.blocked_capabilities || []);
for (const capability of requiredBlockedCapabilities) {
  assert(blockedCapabilities.has(capability), `missing blocked customer capability: ${capability}`);
}

assert.equal(config.session_policy.kind, "opaque_revocable_server_side");
assert.equal(config.session_policy.cookie_name, "__Host-ravenos_session");
assert.equal(config.session_policy.domain_attribute_permitted, false);
assert.equal(config.session_policy.browser_storage_tokens_permitted, false);
for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) {
  assert(config.session_policy.cookie_attributes.includes(attribute), `missing required session cookie attribute: ${attribute}`);
}

for (const documentPath of config.required_documents || []) {
  const absolute = join(root, documentPath);
  assert(existsSync(absolute), `missing customer security document: ${documentPath}`);
  assert(statSync(absolute).size > 1000, `customer security document is unexpectedly small: ${documentPath}`);
}

const requiredScenarios = [
  "SEC-SES-001", "SEC-SES-002", "SEC-SES-003", "SEC-CSRF-001",
  "SEC-AUTHZ-001", "SEC-AUTHZ-002", "SEC-WAL-001", "SEC-WAL-002",
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
  assert(["verified_current", "required_not_implemented", "blocked", "external_review_required", "not_applicable"].includes(row.status), `invalid status for ${row.id}`);
  if (row.gate !== "current") {
    assert.notEqual(row.status, "verified_current", `${row.id} cannot be verified before its customer system exists`);
  }
}

const worker = readFileSync(join(root, "worker.mjs"), "utf8");
assert(worker.includes('from "./lib/customer_identity.mjs"'), "Stage A managed identity router is missing from the Worker graph");
assert(worker.includes('const AUTHENTICATED_APP_HOST = "app.ravenos.xyz"'), "authenticated application origin boundary is missing");
assert(worker.includes("authenticatedAppBoundary(request)"), "authenticated application origin is not enforced in the Worker");
for (const importName of ["ravenos_access.mjs", "ravenos_subscriptions.mjs", "ravenos_stripe_webhooks.mjs", "solana_wallet_auth.mjs"]) {
  assert(!worker.includes(`from \"./lib/${importName}\"`), `legacy customer module remains in the Worker graph: ${importName}`);
}
for (const reason of ["legacy_customer_access_quarantined", "legacy_billing_quarantined"]) {
  assert(worker.includes(reason), `Worker is missing legacy quarantine response: ${reason}`);
}
assert.match(worker, /function customerAccountsEnabled\(\)\s*{\s*return false;\s*}/);
assert.match(worker, /function customerBillingEnabled\(\)\s*{\s*return false;\s*}/);

const deployScript = readFileSync(join(root, "scripts/prepare-deploy-assets.mjs"), "utf8");
const runtimeBlock = deployScript.match(/const runtimeAssets = \[([\s\S]*?)\n\];/)?.[1] || "";
for (const asset of config.legacy_quarantine.client_assets_excluded_from_release || []) {
  assert(!runtimeBlock.includes(`\"${asset}\"`), `legacy customer asset remains deployable: ${asset}`);
}

const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
for (const activationFlag of ["RAVENOS_CUSTOMER_ACCOUNTS_ENABLE", "RAVENOS_AUTH_ENABLE", "RAVENOS_BILLING_ENABLE", "RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE", "RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE"]) {
  assert(!wrangler.includes(activationFlag), `customer activation flag must not be configured in Wrangler: ${activationFlag}`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(packageJson.scripts["validate:security"] || "", /validate-security-architecture\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_security_foundation\.test\.mjs/);

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
  customer_capabilities_enabled: false
}, null, 2));
