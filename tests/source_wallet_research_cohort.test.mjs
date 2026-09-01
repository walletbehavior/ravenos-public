import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";
import { SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA } from "../lib/customer_trade/source_wallet_discovery_admission.mjs";
import {
  SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA,
  SourceWalletResearchCohortLimits,
  createSourceWalletResearchCohortAdmission,
  resolveSourceWalletResearchCohortActivation,
} from "../lib/customer_trade/source_wallet_research_cohort.mjs";

const NOW = "2026-09-01T15:00:00.000Z";

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function wallet(index) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index, 28);
  return bs58.encode(bytes);
}

function candidate(index = 1, overrides = {}) {
  const address = wallet(index);
  return {
    schema_version: SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA,
    candidate_id: `swc_${digest(["solana", "mainnet", address])}`,
    source_wallet_id: `sw_sol_${digest(["solana", "mainnet", address])}`,
    source_wallet: { chain: "solana", network: "mainnet", address },
    state: "leased",
    evidence_tier: "high_signal",
    observation_count: 8,
    exact_swap_shape_count: 6,
    reviewed_buy_instruction_count: 2,
    distinct_mint_count: 4,
    ...overrides,
  };
}

test("research cohort is separately gated and never grants execution authority", () => {
  assert.equal(resolveSourceWalletResearchCohortActivation({}).manifest, false);
  assert.equal(resolveSourceWalletResearchCohortActivation({ RAVENOS_WALLET_RESEARCH_COHORT_ENABLED: "1" }).admission, false);
  const active = resolveSourceWalletResearchCohortActivation({
    RAVENOS_WALLET_RESEARCH_COHORT_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_BACKFILL_ENABLED: "1",
  });
  assert.equal(active.admission, true);
  assert.equal(active.manifest, true);
  assert.equal(active.maximum_research_wallets, 20_000);
  assert.equal(active.live_copy, false);
  assert.equal(active.broadcasting, false);
});

test("only independently verified recurring candidates become transparent research admissions", () => {
  const admission = createSourceWalletResearchCohortAdmission({ candidate: candidate(), admitted_at: NOW });
  assert.equal(admission.schema_version, SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA);
  assert.equal(admission.state, "active");
  assert.equal(admission.admission_basis, "constant_k_nexus_verified_trade");
  assert.equal(admission.evidence_tier, "high_signal");
  assert.ok(admission.priority_score >= 800 && admission.priority_score <= 1_000);
  assert.equal(admission.claim_boundary.profitable_wallet_claimed, false);
  assert.equal(admission.claim_boundary.copyable_wallet_claimed, false);
  assert.equal(admission.privacy.subscriber_identity_included, false);
  assert.equal(admission.execution_boundary.live_copy, false);
  assert.doesNotMatch(JSON.stringify(admission), /user_id|watch_id|private_key|transaction_hash/i);
  assert.throws(() => createSourceWalletResearchCohortAdmission({
    candidate: candidate(2, { evidence_tier: "single_observation", observation_count: 1 }),
    admitted_at: NOW,
  }), /wallet_research_cohort_candidate_ineligible/);
});

test("cohort storage preserves protected wallets first and fills only bounded spare manifest capacity", async () => {
  const protectedWallets = [wallet(11), wallet(12)];
  const researchWallets = [wallet(21), wallet(22), wallet(23)];
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind(...bindings) {
          return {
            async all() {
              if (/ravenos_source_wallet_research_cohort c/i.test(sql)) {
                assert.deepEqual(bindings, [8]);
                return { results: researchWallets.map((address) => ({ address })) };
              }
              assert.deepEqual(bindings, [11]);
              return { results: protectedWallets.map((address) => ({ address })) };
            },
          };
        },
      };
    },
  };
  const result = await createD1CustomerWalletCopyStore(db).listObserverWatchUniverse(10, {
    include_research_cohort: true,
    maximum_research_wallets: SourceWalletResearchCohortLimits.maximum_research_wallets,
  });
  assert.deepEqual(result, protectedWallets.concat(researchWallets));
  assert.match(calls[0], /w\.state = 'active'/i);
  assert.match(calls[1], /c\.state = 'active'/i);
  assert.match(calls[1], /priority_score DESC/i);
  assert.doesNotMatch(calls.join("\n"), /SELECT\s+.*user_id/i);
});

test("cohort migration is bounded operational state with no subscriber or execution authority", () => {
  const sql = readFileSync(new URL("../customer-migrations/0016_source_wallet_research_cohort.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_research_cohort/i);
  assert.match(sql, /constant_k_nexus_verified_trade/i);
  assert.match(sql, /profitable_wallet_claimed/i);
  assert.match(sql, /copyable_wallet_claimed/i);
  assert.match(sql, /subscriber_identity_included/i);
  assert.match(sql, /live_copy/i);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signer_key|user_id/i);
});
