import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1CustomerIdentityStore } from "../lib/customer_identity.mjs";

import {
  CustomerLegalContract,
  requireCustomerLegalCapability,
  routeCustomerLegal,
} from "../lib/customer_legal.mjs";
import {
  CustomerLegalDocuments,
  CustomerLegalRegistryContract,
  currentLegalAcceptanceSubmission,
  legalAcceptanceSatisfies,
  legalDocumentsForCapability,
  publicCustomerLegalManifest,
  resolveCustomerLegalRuntime,
  validateLegalAcceptances,
} from "../lib/customer_legal_registry.mjs";

const ORIGIN = "https://app.ravenos.xyz";
const NOW = 1_788_652_800;
const REVIEW_DOCUMENTS = CustomerLegalDocuments.map(document => ({...document,status:"review_candidate",effective_at:null}));
const EFFECTIVE_DOCUMENTS = CustomerLegalDocuments.map((document) => Object.freeze({
  ...document,
  status: "effective",
  effective_at: "2026-09-06T00:00:00.000Z",
  published_at: "2026-09-06T00:00:00.000Z",
}));

function enabledEnv() {
  return {
    RAVENOS_LEGAL_ACCEPTANCE_ENABLED: "1",
    RAVENOS_LEGAL_COUNSEL_APPROVED: "1",
    RAVENOS_CUSTOMER_DB: { prepare() {}, batch() {} },
  };
}

class MemoryLegalStore {
  constructor() {
    this.rows = [];
  }

  async listAcceptances(userId) {
    return this.rows.filter((row) => row.user_id === userId && row.revoked_at == null);
  }

  async recordAcceptances({ user_id: userId, acceptances, acceptance_method: method, accepted_at: acceptedAt }) {
    for (const acceptance of acceptances) {
      if (this.rows.some((row) => row.user_id === userId
        && row.document_type === acceptance.document_type
        && row.document_version === acceptance.version
        && row.content_hash === acceptance.content_hash)) continue;
      this.rows.push({
        user_id: userId,
        document_type: acceptance.document_type,
        document_version: acceptance.version,
        content_hash: acceptance.content_hash,
        acknowledgement: acceptance.acknowledgement,
        accepted_at: acceptedAt,
        acceptance_method: method,
        revoked_at: null,
      });
    }
    return this.listAcceptances(userId);
  }
}

class SqliteD1Statement {
  constructor(database, sql) {
    this.statement = database.prepare(sql);
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    return this.statement.run(...this.values);
  }

  async first() {
    return this.statement.get(...this.values) || null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }
}

class SqliteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function authorization() {
  return {
    principal: { user_id: "usr_legal_test", session_public_id: "sespub_legal_test" },
    now: NOW,
    response_headers: new Headers(),
  };
}

function request(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

test("legal runtime requires explicit enable, counsel approval, database, and effective immutable documents", () => {
  assert.equal(resolveCustomerLegalRuntime({}).state, "disabled");
  assert.equal(resolveCustomerLegalRuntime({ RAVENOS_LEGAL_ACCEPTANCE_ENABLED: "1" }).state, "counsel_review_required");
  assert.equal(resolveCustomerLegalRuntime({
    RAVENOS_LEGAL_ACCEPTANCE_ENABLED: "1",
    RAVENOS_LEGAL_COUNSEL_APPROVED: "1",
  }).state, "database_unavailable");
  const candidate = resolveCustomerLegalRuntime(enabledEnv(), {documents:REVIEW_DOCUMENTS});
  assert.equal(candidate.state, "documents_not_effective");
  assert.equal(candidate.ready, false);
  assert.equal(resolveCustomerLegalRuntime(enabledEnv(), { documents: EFFECTIVE_DOCUMENTS.slice(0, -1) }).state, "document_registry_incomplete");
  assert.equal(resolveCustomerLegalRuntime(enabledEnv(), {
    documents: EFFECTIVE_DOCUMENTS.map((document, index) => index ? document : { ...document, canonical_path: "//evil.example/" }),
  }).state, "document_registry_invalid");
  const enabled = resolveCustomerLegalRuntime(enabledEnv(), { documents: EFFECTIVE_DOCUMENTS });
  assert.equal(enabled.state, "enforced");
  assert.equal(enabled.ready, true);
  assert.equal(enabled.withdrawals_blocked_by_legal_acceptance, false);
  assert.equal(CustomerLegalRegistryContract.counsel_review_required_before_activation, true);
});

test("capability requirements are exact and recovery-sensitive paths stay unblocked", () => {
  assert.deepEqual(legalDocumentsForCapability("account_creation").map((document) => document.document_type), ["terms", "privacy"]);
  assert.deepEqual(legalDocumentsForCapability("copy_activation").map((document) => document.document_type), ["terms", "privacy", "trading_risk", "copy_trading"]);
  assert.deepEqual(legalDocumentsForCapability("withdrawal"), []);
  assert.deepEqual(legalDocumentsForCapability("wallet_export"), []);
  assert.deepEqual(legalDocumentsForCapability("wallet_recovery"), []);
  assert.equal(CustomerLegalContract.withdrawal_exempt, true);
});

test("informational successors preserve only explicitly named predecessor assent", () => {
  const current = EFFECTIVE_DOCUMENTS.find((document) => document.document_type === "terms");
  const acceptance = {
    document_type: "terms",
    document_version: current.version,
    content_hash: current.content_hash,
    acknowledgement: "agreed",
    revoked_at: null,
  };
  const informational = {
    ...current,
    version: "2026-10-01.informational-1",
    content_hash: "1".repeat(64),
    update_classification: "informational_update",
    requires_reacceptance: false,
    accepted_predecessors: [{ version: current.version, content_hash: current.content_hash }],
  };
  assert.equal(legalAcceptanceSatisfies(informational, acceptance), true);
  assert.equal(legalAcceptanceSatisfies({ ...informational, accepted_predecessors: [] }, acceptance), false);
  assert.equal(resolveCustomerLegalRuntime(enabledEnv(), {
    documents: EFFECTIVE_DOCUMENTS.map((document) => document.document_type === "terms" ? informational : document),
  }).ready, true);
  assert.equal(resolveCustomerLegalRuntime(enabledEnv(), {
    documents: EFFECTIVE_DOCUMENTS.map((document) => document.document_type === "terms"
      ? { ...informational, requires_reacceptance: true }
      : document),
  }).state, "document_registry_invalid");
});

test("legal submissions bind exact version, hash, and acknowledgement", () => {
  const exact = currentLegalAcceptanceSubmission("trading_activation");
  assert.equal(validateLegalAcceptances("trading_activation", exact).length, 3);
  assert.throws(() => validateLegalAcceptances("trading_activation", exact.slice(0, 2)), /legal_acceptance_incomplete/);
  assert.throws(() => validateLegalAcceptances("trading_activation", [...exact, exact[0]]), /legal_acceptance_duplicate/);
  assert.throws(() => validateLegalAcceptances("trading_activation", exact.map((row, index) => index ? row : { ...row, content_hash: "0".repeat(64) })), /legal_document_changed/);
  assert.throws(() => validateLegalAcceptances("account_creation", currentLegalAcceptanceSubmission("account_creation").map((row) => (
    row.document_type === "privacy" ? { ...row, acknowledgement: "agreed" } : row
  ))), /legal_acceptance_invalid/);
  assert.throws(() => validateLegalAcceptances("account_creation", currentLegalAcceptanceSubmission("account_creation").map((row, index) => (
    index === 0 ? { ...row, user_id: "usr_client_supplied" } : row
  ))), /legal_acceptance_invalid/);
});

test("public manifest reports effective documents while enforcement remains independently controlled", async () => {
  const manifest = publicCustomerLegalManifest({});
  assert.equal(manifest.acceptance_enforced, false);
  assert.equal(manifest.documents.length, 6);
  assert(manifest.documents.every((document) => document.status === "effective"));
  assert.equal(manifest.safeguards.withdrawal_survives_decline, true);

  const response = await routeCustomerLegal(request("/api/v1/legal/documents"), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /public/);
  assert.equal((await response.json()).state, "disabled");

  const accidentallyFlagged = publicCustomerLegalManifest(enabledEnv(), {documents:REVIEW_DOCUMENTS});
  assert.equal(accidentallyFlagged.state, "documents_not_effective");
  assert.equal(accidentallyFlagged.acceptance_enforced, false);
  assert(accidentallyFlagged.documents.every((document) => document.status === "review_candidate"));
});

test("authenticated contextual acceptance is append-only, idempotent, and satisfies only the exact capability", async () => {
  const store = new MemoryLegalStore();
  const deps = {
    legalStore: store,
    authorizeRequest: async () => authorization(),
    documents: EFFECTIVE_DOCUMENTS,
  };
  const acceptances = currentLegalAcceptanceSubmission("trading_activation", { documents: EFFECTIVE_DOCUMENTS });
  const injectedIdentity = await routeCustomerLegal(request("/api/v1/legal/acceptances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability: "trading_activation", acceptances, user_id: "usr_client_supplied" }),
  }), enabledEnv(), deps);
  assert.equal(injectedIdentity.status, 400);
  assert.equal(store.rows.length, 0);
  const response = await routeCustomerLegal(request("/api/v1/legal/acceptances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability: "trading_activation", acceptances }),
  }), enabledEnv(), deps);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.capability.satisfied, true);
  assert.equal(store.rows.length, 3);

  const duplicate = await routeCustomerLegal(request("/api/v1/legal/acceptances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability: "trading_activation", acceptances }),
  }), enabledEnv(), deps);
  assert.equal(duplicate.status, 200);
  assert.equal(store.rows.length, 3);

  const trading = await requireCustomerLegalCapability(request("/api/trade/live/base/prepare", { method: "POST" }), enabledEnv(), "trading_activation", deps, { require_csrf: true });
  assert.equal(trading.allowed, true);
  store.rows.find((row) => row.document_type === "terms").acknowledgement = "acknowledged";
  const wrongAcknowledgement = await requireCustomerLegalCapability(request("/api/trade/live/base/prepare", { method: "POST" }), enabledEnv(), "trading_activation", deps, { require_csrf: true });
  assert.equal(wrongAcknowledgement.allowed, false);
  assert.equal(wrongAcknowledgement.response.status, 428);
  store.rows.find((row) => row.document_type === "terms").acknowledgement = "agreed";
  const copy = await requireCustomerLegalCapability(request("/api/v1/copy/activate", { method: "POST" }), enabledEnv(), "copy_activation", deps, { require_csrf: true });
  assert.equal(copy.allowed, false);
  assert.equal(copy.response.status, 428);
});

test("requested enforcement fails closed if counsel approval disappears, without applying to disabled runtime", async () => {
  const requested = await requireCustomerLegalCapability(request("/api/trade/live/base/prepare", { method: "POST" }), {
    ...enabledEnv(),
    RAVENOS_LEGAL_COUNSEL_APPROVED: "0",
  }, "trading_activation", {});
  assert.equal(requested.allowed, false);
  assert.equal(requested.response.status, 503);

  const disabled = await requireCustomerLegalCapability(request("/api/trade/live/base/prepare", { method: "POST" }), {}, "trading_activation", {});
  assert.equal(disabled.allowed, true);
  assert.equal(disabled.state, "not_enforced");
});

test("legal migration appends exact effective versions and makes documents and acceptances append-only", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0033_customer_legal.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0035_customer_pro_rewards_legal.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0037_customer_effective_legal.sql", "utf8"));
  const documents = database.prepare("SELECT * FROM ravenos_legal_documents ORDER BY document_type").all();
  assert.equal(documents.length, CustomerLegalDocuments.length + 11);
  for (const current of CustomerLegalDocuments) assert(documents.some(row => row.document_type === current.document_type && row.document_version === current.version && row.content_hash === current.content_hash));
  assert.equal(documents.filter(document => document.status === "effective").length, 6);
  assert.equal(documents.filter(document => document.status === "review_candidate").length, 11);
  assert(documents.every((document) => /^[0-9a-f]{64}$/.test(document.content_hash)));
  assert(documents.every((document) => document.accepted_predecessor_json === "[]"));
  database.prepare(`
    INSERT INTO ravenos_users (user_id, state, primary_email, display_name, created_at, updated_at, last_authenticated_at)
    VALUES ('usr_legal', 'active', 'legal@example.com', NULL, 1, 1, 1)
  `).run();
  const terms = CustomerLegalDocuments.find((document) => document.document_type === "terms");
  database.prepare(`
    INSERT INTO ravenos_legal_acceptances (
      acceptance_id, user_id, document_type, document_version, content_hash,
      acknowledgement, accepted_at, acceptance_method, revoked_at
    ) VALUES (?, 'usr_legal', ?, ?, ?, 'agreed', ?, 'account_creation', NULL)
  `).run(`lac_${"a".repeat(20)}`, terms.document_type, terms.version, terms.content_hash, NOW);
  assert.throws(() => database.prepare(`
    INSERT INTO ravenos_legal_acceptances (
      acceptance_id, user_id, document_type, document_version, content_hash,
      acknowledgement, accepted_at, acceptance_method, revoked_at
    ) VALUES (?, 'usr_legal', ?, ?, ?, 'agreed', ?, 'account_creation', NULL)
  `).run(`lac_${"b".repeat(20)}`, terms.document_type, terms.version, "0".repeat(64), NOW), /FOREIGN KEY/);
  assert.throws(() => database.prepare("UPDATE ravenos_legal_acceptances SET acknowledgement = 'acknowledged'").run(), /legal_acceptance_append_only/);
  assert.throws(() => database.prepare("DELETE FROM ravenos_legal_acceptances").run(), /legal_acceptance_append_only/);
  assert.throws(() => database.prepare("UPDATE ravenos_legal_documents SET title = 'Changed'").run(), /legal_document_immutable/);
  database.close();
});

test("new identity and account-creation assent commit atomically", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0028_customer_username.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0033_customer_legal.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0035_customer_pro_rewards_legal.sql", "utf8"));
  database.exec(readFileSync("customer-migrations/0037_customer_effective_legal.sql", "utf8"));
  const store = createD1CustomerIdentityStore(new SqliteD1Database(database));
  const identity = {
    issuer: "https://api.workos.com/user_management",
    provider_subject: "user_atomic_legal",
    email: "atomic@example.com",
    display_name: null,
    authentication_method: "GoogleOAuth",
    now: NOW,
  };
  await assert.rejects(() => store.resolveOrCreateIdentity(identity, {
    legalAcceptances: [{
      document_type: "missing_document",
      version: "2026-09-05.missing",
      content_hash: "0".repeat(64),
      acknowledgement: "agreed",
    }],
  }), /identity_resolution_failed/);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ravenos_users").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ravenos_credentials").get().count, 0);

  const account = await store.resolveOrCreateIdentity(identity, {
    legalAcceptances: currentLegalAcceptanceSubmission("account_creation"),
  });
  assert.equal(account.created, true);
  assert.equal(account.legal_acceptance_recorded, true);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ravenos_users").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ravenos_legal_acceptances").get().count, 2);
  database.close();
});
