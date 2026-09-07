import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CustomerLegalDocuments } from "../lib/customer_legal_registry.mjs";
import { scanPublicTextFile } from "../scripts/validate-public-no-leak.mjs";

function fileFor(document) {
  return `${document.canonical_path.replace(/^\//, "")}index.html`;
}

test("every effective legal document is present, visibly dated, and content-hash bound", () => {
  for (const document of CustomerLegalDocuments) {
    const path = fileFor(document);
    const bytes = readFileSync(path);
    const source = bytes.toString("utf8");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), document.content_hash, path);
    assert.equal(document.status, "effective");
    assert.match(source, /Effective September 7, 2026/i, path);
    assert.doesNotMatch(source, /Not effective|counsel-review candidate/i, path);
    assert.match(source, new RegExp(document.version.replaceAll(".", "\\.")), path);
    assert(!/RavenOS is definitively not (?:a )?(?:broker|custodian|investment adviser|money transmitter)/i.test(source), path);
    assert(!/RavenOS is not (?:a )?(?:bank|broker-dealer|investment adviser|custodian|fiduciary|money transmitter)/i.test(source), path);
  }
});

test("effective package preserves the critical product and risk distinctions", () => {
  const terms = readFileSync("terms/index.html", "utf8");
  const privacy = readFileSync("privacy/index.html", "utf8");
  const risk = readFileSync("legal/trading-risk/index.html", "utf8");
  const copy = readFileSync("legal/copy-trading/index.html", "utf8");
  const affiliate = readFileSync("legal/affiliate/index.html", "utf8");
  const community = readFileSync("legal/community-guidelines/index.html", "utf8");

  assert.match(terms, /user’s selected external wallet signs/i);
  assert.match(terms, /explicitly authorize recurring monthly billing/i);
  assert.match(terms, /30-day Raven Pro trial at account creation/i);
  assert.match(terms, /Rewards do not expire/i);
  assert.match(terms, /withdrawal, export, or recovery/i);
  assert.match(privacy, /public Raven profile is separately opt-in/i);
  assert.match(privacy, /no third-party behavioral-advertising tracker/i);
  assert.match(risk, /Unknown is not zero/i);
  assert.match(risk, /aggregate USDC amount is not one instantly available balance/i);
  assert.match(copy, /Source performance is never follower performance/i);
  assert.match(copy, /Live Copy disabled/i);
  assert.match(affiliate, /25% of actual net qualifying Raven Pro subscription cash revenue/i);
  assert.match(affiliate, /12 calendar months from the first qualifying paid conversion/i);
  assert.match(affiliate, /60-day attribution window/i);
  assert.match(affiliate, /Free trials and trading activity do not generate commission/i);
  assert.match(community, /Reward process—not outrage/i);
  assert.match(community, /make a profile private without first accepting/i);
});

test("current documents retain access to the immutable earlier drafts", () => {
  const hub = readFileSync("legal/index.html", "utf8");
  assert.match(hub, /Current public documents/);
  assert.match(hub, /Archived documents/i);
  assert.match(readFileSync("legal/review/terms/index.html", "utf8"), /Not effective/i);
  assert.doesNotThrow(() => readFileSync("legal/archive/2026-08-26/terms/index.html"));
  assert.doesNotThrow(() => readFileSync("terms/index.html"));
  assert.doesNotThrow(() => readFileSync("privacy/index.html"));
});

test("public leak scanning allows review vocabulary only inside the legal desk", () => {
  const legalCopy = "<main>Counsel-review candidate for Mirror behavior.</main>";
  assert.deepEqual(scanPublicTextFile(legalCopy, "legal/review/copy-trading/index.html"), []);
  const findings = scanPublicTextFile(legalCopy, "discover/index.html");
  assert.deepEqual(findings.map((finding) => finding.term).sort(), ["candidate", "mirror"]);
});

test("Terminal contextual assent is unchecked, document-linked, and retries only the protected prepare request", () => {
  const terminal = readFileSync("ravenos-terminal-live.js", "utf8");
  const client = readFileSync("ravenos-legal-client.js", "utf8");
  const styles = readFileSync("ravenos-shell.css", "utf8");
  const account = readFileSync("ravenos-account.js", "utf8");
  const community = readFileSync("ravenos-community.js", "utf8");
  const worker = readFileSync("worker.mjs", "utf8");
  assert.match(client, /checkbox\.checked = false/);
  assert.match(client, /I agree to the Terms of Service and acknowledge the Privacy Policy and Digital Asset & Trading Risk Disclosure/);
  assert.match(client, /\/api\/v1\/legal\/acceptances/);
  assert.match(terminal, /capability: "trading_activation"/);
  assert.match(terminal, /first\.response\.status !== 428/);
  assert.match(terminal, /fetchTradingActivationRequest\("\/api\/trade\/live\/solana\/prepare"/);
  assert.match(terminal, /fetchTradingActivationRequest\("\/api\/trade\/live\/hyperliquid\/prepare"/);
  assert.match(terminal, /fetchTradingActivationRequest\(endpoint/);
  assert.match(styles, /\.ravenos-legal-dialog/);
  assert.match(account, /"embedded_wallet_activation"/);
  assert.match(community, /"community_publication"/);
  for (const path of ["hyperliquid", "solana", "robinhood", "bsc", "base", "ethereum"]) {
    assert.match(worker, new RegExp(`/api/trade/live/${path}/prepare`));
  }
  assert.match(worker, /requireCustomerLegalCapability\(request, env, "trading_activation"/);
  assert.doesNotMatch(worker, /livePreparePaths\.has\(url\.pathname\)[\s\S]{0,300}\/report/);
  assert.doesNotMatch(terminal, /withdraw[^\n]{0,80}legal_acceptance_required/i);
});
