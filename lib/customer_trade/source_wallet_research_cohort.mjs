import { createHash } from "node:crypto";

import {
  SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA,
} from "./source_wallet_discovery_admission.mjs";

export const SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA = "ravenos.source_wallet_research_cohort_admission.v1";

export const SourceWalletResearchCohortLimits = Object.freeze({
  maximum_research_wallets: 20_000,
  minimum_observations: 2,
  maximum_observations: 1_000_000,
  maximum_distinct_mints: 1_000_000,
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function flag(value) {
  return String(value || "") === "1";
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function priorityScore(candidate) {
  const tier = candidate.evidence_tier === "high_signal" ? 800 : 600;
  const recurrence = Math.min(120, candidate.observation_count * 8);
  const breadth = Math.min(80, candidate.distinct_mint_count * 10);
  return Math.min(1_000, tier + recurrence + breadth);
}

export function resolveSourceWalletResearchCohortActivation(env = {}) {
  const requested = flag(env.RAVENOS_WALLET_RESEARCH_COHORT_ENABLED);
  const intelligence = flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED);
  const observer = flag(env.RAVENOS_WALLET_OBSERVER_ENABLED);
  const observerIngress = flag(env.RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED);
  const discoveryIngress = flag(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED);
  const discoveryEvaluator = flag(env.RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED);
  const backfill = flag(env.RAVENOS_WALLET_BACKFILL_ENABLED);
  return freeze({
    requested,
    admission: requested && intelligence && discoveryIngress && discoveryEvaluator && backfill,
    manifest: requested && intelligence && observer && observerIngress,
    maximum_research_wallets: SourceWalletResearchCohortLimits.maximum_research_wallets,
    subscriber_identity_included: false,
    signing: false,
    submission: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
    fee_collection: false,
  });
}

export function createSourceWalletResearchCohortAdmission({ candidate, admitted_at: admittedAt = new Date().toISOString() } = {}) {
  if (candidate?.schema_version !== SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA) fail("wallet_research_cohort_candidate_invalid");
  if (!new Set(["recurring", "high_signal"]).has(candidate.evidence_tier)) fail("wallet_research_cohort_candidate_ineligible");
  const observationCount = integer(candidate.observation_count, "wallet_research_cohort_observation_count", {
    minimum: SourceWalletResearchCohortLimits.minimum_observations,
    maximum: SourceWalletResearchCohortLimits.maximum_observations,
  });
  const distinctMintCount = integer(candidate.distinct_mint_count, "wallet_research_cohort_mint_count", {
    maximum: SourceWalletResearchCohortLimits.maximum_distinct_mints,
  });
  const qualifiedAt = timestamp(admittedAt, "wallet_research_cohort_admitted_at");
  return freeze({
    schema_version: SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA,
    admission_version: 1,
    admission_id: `swrca_${digest([candidate.candidate_id, candidate.source_wallet_id, qualifiedAt])}`,
    source_wallet_id: candidate.source_wallet_id,
    source_wallet: candidate.source_wallet,
    candidate_id: candidate.candidate_id,
    state: "active",
    admission_basis: "constant_k_nexus_verified_trade",
    evidence_tier: candidate.evidence_tier,
    priority_score: priorityScore({ ...candidate, observation_count: observationCount, distinct_mint_count: distinctMintCount }),
    qualified_observation_count: observationCount,
    distinct_mint_count: distinctMintCount,
    qualified_at: qualifiedAt,
    claim_boundary: {
      profitable_wallet_claimed: false,
      copyable_wallet_claimed: false,
      subscriber_interest_claimed: false,
      admission_means_continuous_research_only: true,
    },
    privacy: {
      public_wallet_address_only: true,
      subscriber_identity_included: false,
      follower_count_included: false,
      policy_included: false,
      signer_material_included: false,
    },
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}

export const SourceWalletResearchCohortContract = Object.freeze({
  schema_version: SOURCE_WALLET_RESEARCH_COHORT_ADMISSION_SCHEMA,
  activation_flag: "RAVENOS_WALLET_RESEARCH_COHORT_ENABLED",
  maximum_research_wallets: SourceWalletResearchCohortLimits.maximum_research_wallets,
  user_watches_reserved_before_research: true,
  source_performance_claimed: false,
  copyability_claimed: false,
  subscriber_identity_included: false,
  live_copy: false,
  signing: false,
  broadcasting: false,
  custody: false,
  fee_collection: false,
});
