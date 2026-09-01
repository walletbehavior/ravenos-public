import { createHash } from "node:crypto";

import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";
import { identifySolanaSwapPrograms } from "./solana_program_registry.mjs";

export const CONSTANT_K_NEXUS_WALLET_DISCOVERY_SCHEMA = "ravenos.constant_k_nexus_wallet_discovery.v1";
export const CONSTANT_K_NEXUS_WALLET_CANDIDATE_SCHEMA = "ravenos.constant_k_nexus_wallet_candidate.v1";
export const CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA = "ravenos.constant_k_nexus_wallet_candidate_observation.v1";

export const ConstantKNexusWalletDiscoveryLimits = Object.freeze({
  maximum_event_rows: 50_000,
  maximum_event_bytes: 64 * 1024,
  maximum_signers_per_event: 64,
  maximum_programs_per_event: 64,
  maximum_candidate_observations: 50_000,
  maximum_candidate_mints: 2_000,
  maximum_mints_per_observation: 64,
  recurring_observations: 2,
  high_signal_observations: 5,
});

const textEncoder = new TextEncoder();
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const SIGNED_INTEGER_RE = /^-?(?:0|[1-9]\d*)$/;
const OBSERVATION_FIELDS = new Set([
  "schema_version", "observation_id", "candidate_id", "source_wallet_id",
  "source_wallet", "signature", "slot", "provider", "transport", "finality",
  "provider_observed_at", "route_programs", "economic_evidence",
  "evidence_reference", "provenance", "privacy", "execution_boundary",
]);
const SOURCE_WALLET_FIELDS = new Set(["chain", "network", "address"]);
const ROUTE_PROGRAM_FIELDS = new Set(["key", "program_id", "evidence"]);
const ECONOMIC_EVIDENCE_FIELDS = new Set([
  "evidence_kind", "exact_required_signer", "opposing_nonzero_balance_deltas",
  "reviewed_buy_instruction_observed", "complete_balance_delta_economics",
  "token_delta_count", "distinct_mint_count", "mints", "amounts_included",
  "trade_direction_claimed",
]);
const PROVENANCE_FIELDS = new Set([
  "source", "observation", "route_identity_reviewed", "exact_wallet_trade_not_yet_claimed",
]);
const PRIVACY_FIELDS = new Set([
  "raw_provider_payload_included", "subscriber_identity_included", "policy_included",
  "follower_count_included", "signer_material_included", "transaction_material_included",
]);
const EXECUTION_FIELDS = new Set([
  "signing", "submission", "broadcasting", "custody", "live_copy", "fee_collection",
]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function exactFalseObject(value, fields, code) {
  const row = exactObject(value, fields, code);
  for (const field of fields) if (row[field] !== false) fail(code);
  return row;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function clean(value, field, maximum = 180) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > maximum) fail(`${field}_invalid`);
  return text;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function slot(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("constant_k_discovery_slot_invalid");
  return parsed;
}

function signature(value) {
  const normalized = clean(value, "constant_k_discovery_signature", 100);
  if (!SOLANA_SIGNATURE_RE.test(normalized)) fail("constant_k_discovery_signature_invalid");
  return normalized;
}

function eventBytes(row) {
  try {
    return textEncoder.encode(JSON.stringify(row)).byteLength;
  } catch {
    fail("constant_k_discovery_event_invalid");
  }
}

function integerDelta(value) {
  const text = String(value ?? "");
  if (!SIGNED_INTEGER_RE.test(text)) return null;
  try { return BigInt(text); } catch { return null; }
}

function walletId(address) {
  return `sw_sol_${digest(["solana", "mainnet", address])}`;
}

function candidateId(address) {
  return `swc_${digest(["solana", "mainnet", address])}`;
}

function observationId(address, transactionSignature, transactionSlot) {
  return `swco_${digest(["constant_k_nexus", address, transactionSignature, String(transactionSlot)])}`;
}

function candidateTier(observationCount, distinctMintCount) {
  if (observationCount >= ConstantKNexusWalletDiscoveryLimits.high_signal_observations && distinctMintCount >= 2) return "high_signal";
  if (observationCount >= ConstantKNexusWalletDiscoveryLimits.recurring_observations) return "recurring";
  return "single_observation";
}

function sortCandidates(left, right) {
  return right.qualification_observation_count - left.qualification_observation_count
    || right.active_day_count - left.active_day_count
    || right.distinct_mint_count - left.distinct_mint_count
    || Date.parse(right.last_observed_at) - Date.parse(left.last_observed_at)
    || left.source_wallet.address.localeCompare(right.source_wallet.address);
}

function walletEconomicEvidence(row, signerAddress, routePrograms) {
  if (
    row.joint_entity_required_signer_accounts_complete !== true
    || row.joint_entity_token_balance_deltas_complete !== true
    || row.joint_entity_token_balance_delta_economics_complete !== true
  ) return null;
  const deltas = [];
  for (const raw of Array.isArray(row.joint_entity_token_balance_deltas) ? row.joint_entity_token_balance_deltas : []) {
    if (!raw || typeof raw !== "object" || raw.token_balance_economics_complete !== true) continue;
    let owner;
    let mint;
    try {
      owner = normalizeSolanaWalletAddress(raw.owner);
      mint = normalizeSolanaWalletAddress(raw.mint);
    } catch {
      continue;
    }
    if (owner !== signerAddress) continue;
    const amount = integerDelta(raw.delta_raw);
    if (amount === null || amount === 0n) continue;
    deltas.push({ mint, amount });
  }
  const distinctMints = [...new Set(deltas.map((row) => row.mint))].sort();
  const opposing = distinctMints.length >= 2 && deltas.some((row) => row.amount < 0n) && deltas.some((row) => row.amount > 0n);
  const pumpBuy = row.pumpfun_buy_instruction === true
    && routePrograms.some((program) => program.key === "pump_bonding_curve")
    && deltas.some((row) => row.amount > 0n);
  if (!opposing && !pumpBuy) return null;
  return freeze({
    evidence_kind: opposing ? "exact_opposing_token_deltas" : "reviewed_pump_buy_instruction",
    exact_required_signer: true,
    opposing_nonzero_balance_deltas: opposing,
    reviewed_buy_instruction_observed: pumpBuy,
    complete_balance_delta_economics: true,
    token_delta_count: deltas.length,
    distinct_mint_count: distinctMints.length,
    mints: freeze(distinctMints),
    amounts_included: false,
    trade_direction_claimed: false,
  });
}

function candidateObservation({ row, address, transactionSignature, transactionSlot, observedAt, routePrograms, economics }) {
  return freeze({
    schema_version: CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA,
    observation_id: observationId(address, transactionSignature, transactionSlot),
    candidate_id: candidateId(address),
    source_wallet_id: walletId(address),
    source_wallet: { chain: "solana", network: "mainnet", address },
    signature: transactionSignature,
    slot: transactionSlot,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    finality: "processed",
    provider_observed_at: observedAt,
    route_programs: freeze(routePrograms.map((program) => freeze({
      key: program.key,
      program_id: program.program_id,
      evidence: program.evidence,
    }))),
    economic_evidence: economics,
    evidence_reference: `solana:signature:${transactionSignature}`,
    provenance: {
      source: "constant_k_compact_economics",
      observation: "provider_claim_pending_raven_hydration",
      route_identity_reviewed: true,
      exact_wallet_trade_not_yet_claimed: true,
    },
    privacy: {
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      policy_included: false,
      follower_count_included: false,
      signer_material_included: false,
      transaction_material_included: false,
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

export function normalizeConstantKNexusWalletCandidateObservation(input) {
  const row = exactObject(input, OBSERVATION_FIELDS, "constant_k_candidate_observation_invalid");
  if (row.schema_version !== CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA) {
    fail("constant_k_candidate_observation_invalid");
  }
  const source = exactObject(row.source_wallet, SOURCE_WALLET_FIELDS, "constant_k_candidate_source_invalid");
  if (source.chain !== "solana" || source.network !== "mainnet") fail("constant_k_candidate_source_invalid");
  const address = normalizeSolanaWalletAddress(source.address);
  const transactionSignature = signature(row.signature);
  const transactionSlot = slot(row.slot);
  const observedAt = timestamp(row.provider_observed_at, "constant_k_candidate_observed_at");
  if (row.provider !== "constant_k_nexus" || row.transport !== "geyser_grpc" || row.finality !== "processed") {
    fail("constant_k_candidate_source_invalid");
  }
  if (
    row.source_wallet_id !== walletId(address)
    || row.candidate_id !== candidateId(address)
    || row.observation_id !== observationId(address, transactionSignature, transactionSlot)
    || row.evidence_reference !== `solana:signature:${transactionSignature}`
  ) fail("constant_k_candidate_identity_mismatch");

  if (!Array.isArray(row.route_programs) || !row.route_programs.length || row.route_programs.length > ConstantKNexusWalletDiscoveryLimits.maximum_programs_per_event) {
    fail("constant_k_candidate_route_invalid");
  }
  const routePrograms = [];
  const seenPrograms = new Set();
  for (const inputProgram of row.route_programs) {
    const program = exactObject(inputProgram, ROUTE_PROGRAM_FIELDS, "constant_k_candidate_route_invalid");
    const reviewed = identifySolanaSwapPrograms([program.program_id])[0];
    if (
      !reviewed
      || program.key !== reviewed.key
      || program.evidence !== reviewed.evidence
      || seenPrograms.has(reviewed.program_id)
    ) fail("constant_k_candidate_route_invalid");
    seenPrograms.add(reviewed.program_id);
    routePrograms.push(reviewed);
  }

  const evidence = exactObject(row.economic_evidence, ECONOMIC_EVIDENCE_FIELDS, "constant_k_candidate_economics_invalid");
  if (!Array.isArray(evidence.mints) || !evidence.mints.length || evidence.mints.length > ConstantKNexusWalletDiscoveryLimits.maximum_mints_per_observation) {
    fail("constant_k_candidate_economics_invalid");
  }
  const mints = [...new Set(evidence.mints.map(normalizeSolanaWalletAddress))].sort();
  if (
    mints.length !== evidence.mints.length
    || !Number.isSafeInteger(evidence.token_delta_count)
    || evidence.token_delta_count < mints.length
    || evidence.token_delta_count > 128
    || !Number.isSafeInteger(evidence.distinct_mint_count)
    || typeof evidence.opposing_nonzero_balance_deltas !== "boolean"
    || typeof evidence.reviewed_buy_instruction_observed !== "boolean"
  ) {
    fail("constant_k_candidate_economics_invalid");
  }
  if (evidence.distinct_mint_count !== mints.length) fail("constant_k_candidate_economics_invalid");
  const exactShape = evidence.evidence_kind === "exact_opposing_token_deltas";
  const pumpBuy = evidence.evidence_kind === "reviewed_pump_buy_instruction";
  if (!exactShape && !pumpBuy) fail("constant_k_candidate_economics_invalid");
  if (
    evidence.exact_required_signer !== true
    || evidence.complete_balance_delta_economics !== true
    || evidence.amounts_included !== false
    || evidence.trade_direction_claimed !== false
    || (exactShape && evidence.opposing_nonzero_balance_deltas !== true)
    || (pumpBuy && evidence.opposing_nonzero_balance_deltas !== false)
    || (pumpBuy && evidence.reviewed_buy_instruction_observed !== true)
    || (pumpBuy && !routePrograms.some((program) => program.key === "pump_bonding_curve"))
  ) fail("constant_k_candidate_economics_invalid");

  const provenance = exactObject(row.provenance, PROVENANCE_FIELDS, "constant_k_candidate_provenance_invalid");
  if (
    provenance.source !== "constant_k_compact_economics"
    || provenance.observation !== "provider_claim_pending_raven_hydration"
    || provenance.route_identity_reviewed !== true
    || provenance.exact_wallet_trade_not_yet_claimed !== true
  ) fail("constant_k_candidate_provenance_invalid");
  exactFalseObject(row.privacy, PRIVACY_FIELDS, "constant_k_candidate_privacy_invalid");
  exactFalseObject(row.execution_boundary, EXECUTION_FIELDS, "constant_k_candidate_execution_boundary_invalid");

  return freeze({
    schema_version: CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA,
    observation_id: row.observation_id,
    candidate_id: row.candidate_id,
    source_wallet_id: row.source_wallet_id,
    source_wallet: { chain: "solana", network: "mainnet", address },
    signature: transactionSignature,
    slot: transactionSlot,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    finality: "processed",
    provider_observed_at: observedAt,
    route_programs: freeze(routePrograms.map((program) => freeze({
      key: program.key,
      program_id: program.program_id,
      evidence: program.evidence,
    }))),
    economic_evidence: freeze({
      evidence_kind: evidence.evidence_kind,
      exact_required_signer: true,
      opposing_nonzero_balance_deltas: evidence.opposing_nonzero_balance_deltas,
      reviewed_buy_instruction_observed: evidence.reviewed_buy_instruction_observed === true,
      complete_balance_delta_economics: true,
      token_delta_count: evidence.token_delta_count,
      distinct_mint_count: mints.length,
      mints: freeze(mints),
      amounts_included: false,
      trade_direction_claimed: false,
    }),
    evidence_reference: `solana:signature:${transactionSignature}`,
    provenance: {
      source: "constant_k_compact_economics",
      observation: "provider_claim_pending_raven_hydration",
      route_identity_reviewed: true,
      exact_wallet_trade_not_yet_claimed: true,
    },
    privacy: Object.fromEntries([...PRIVACY_FIELDS].map((field) => [field, false])),
    execution_boundary: Object.fromEntries([...EXECUTION_FIELDS].map((field) => [field, false])),
  });
}

export function discoverConstantKNexusWalletCandidates({
  events = [],
  watched_wallets: watchedWallets = [],
  now = () => new Date(),
} = {}) {
  if (!Array.isArray(events) || events.length > ConstantKNexusWalletDiscoveryLimits.maximum_event_rows) {
    fail("constant_k_discovery_events_invalid");
  }
  const generatedAt = timestamp(typeof now === "function" ? now() : now, "constant_k_discovery_generated_at");
  const generatedAtMs = Date.parse(generatedAt);
  const watched = new Set((Array.isArray(watchedWallets) ? watchedWallets : []).map(normalizeSolanaWalletAddress));
  const observations = [];
  const observationKeys = new Set();
  const stats = {
    event_rows: events.length,
    transaction_rows: 0,
    invalid_rows: 0,
    wrong_provider_rows: 0,
    failed_or_vote_rows: 0,
    no_reviewed_route_rows: 0,
    incomplete_economics_rows: 0,
    watched_signer_observations: 0,
    duplicate_observations: 0,
    candidate_observations: 0,
  };

  for (const row of events) {
    try {
      if (!row || typeof row !== "object" || Array.isArray(row) || eventBytes(row) > ConstantKNexusWalletDiscoveryLimits.maximum_event_bytes) {
        fail("constant_k_discovery_event_invalid");
      }
      if (row.event !== "solana_grpc_transaction") continue;
      stats.transaction_rows += 1;
      if (row.provider !== "constant_k") {
        stats.wrong_provider_rows += 1;
        continue;
      }
      if (row.failed === true || row.is_vote === true) {
        stats.failed_or_vote_rows += 1;
        continue;
      }
      const programs = Array.isArray(row.programs) ? row.programs : [];
      if (programs.length > ConstantKNexusWalletDiscoveryLimits.maximum_programs_per_event) fail("constant_k_discovery_programs_invalid");
      const routePrograms = identifySolanaSwapPrograms(programs);
      if (!routePrograms.length) {
        stats.no_reviewed_route_rows += 1;
        continue;
      }
      const transactionSignature = signature(row.signature);
      const transactionSlot = slot(row.slot);
      const observedAt = timestamp(row.ts, "constant_k_discovery_observed_at");
      if (Date.parse(observedAt) > generatedAtMs + 5 * 60 * 1_000) fail("constant_k_discovery_observed_at_future");
      const signers = Array.isArray(row.signer_accounts) ? row.signer_accounts : [];
      if (!signers.length || signers.length > ConstantKNexusWalletDiscoveryLimits.maximum_signers_per_event) fail("constant_k_discovery_signers_invalid");
      let exactEconomicSigner = false;
      const rowCandidates = [];
      let watchedSignerObservations = 0;
      for (const rawAddress of new Set(signers)) {
        const address = normalizeSolanaWalletAddress(rawAddress);
        const economics = walletEconomicEvidence(row, address, routePrograms);
        if (!economics) continue;
        exactEconomicSigner = true;
        if (watched.has(address)) {
          watchedSignerObservations += 1;
          continue;
        }
        rowCandidates.push({ address, economics });
      }
      stats.watched_signer_observations += watchedSignerObservations;
      for (const { address, economics } of rowCandidates) {
        const key = `${address}:${transactionSignature}:${transactionSlot}`;
        if (observationKeys.has(key)) {
          stats.duplicate_observations += 1;
          continue;
        }
        if (observations.length >= ConstantKNexusWalletDiscoveryLimits.maximum_candidate_observations) {
          fail("constant_k_discovery_observation_overflow");
        }
        observationKeys.add(key);
        observations.push(candidateObservation({
          row,
          address,
          transactionSignature,
          transactionSlot,
          observedAt,
          routePrograms,
          economics,
        }));
      }
      if (!exactEconomicSigner) stats.incomplete_economics_rows += 1;
    } catch (error) {
      if (error?.code === "constant_k_discovery_observation_overflow") throw error;
      stats.invalid_rows += 1;
    }
  }

  const aggregates = new Map();
  for (const observation of observations) {
    const address = observation.source_wallet.address;
    let aggregate = aggregates.get(address);
    if (!aggregate) {
      aggregate = {
        observation_ids: new Set(),
        signatures: new Set(),
        days: new Set(),
        mints: new Set(),
        programs: new Map(),
        exact_swap_shape_observations: 0,
        reviewed_buy_instruction_observations: 0,
        first_observed_at: observation.provider_observed_at,
        last_observed_at: observation.provider_observed_at,
      };
      aggregates.set(address, aggregate);
    }
    aggregate.observation_ids.add(observation.observation_id);
    if (observation.economic_evidence.evidence_kind === "exact_opposing_token_deltas") aggregate.exact_swap_shape_observations += 1;
    if (observation.economic_evidence.evidence_kind === "reviewed_pump_buy_instruction") aggregate.reviewed_buy_instruction_observations += 1;
    aggregate.signatures.add(observation.signature);
    aggregate.days.add(observation.provider_observed_at.slice(0, 10));
    for (const mint of observation.economic_evidence.mints) {
      if (aggregate.mints.size < ConstantKNexusWalletDiscoveryLimits.maximum_candidate_mints) aggregate.mints.add(mint);
    }
    for (const program of observation.route_programs) aggregate.programs.set(program.program_id, program);
    if (Date.parse(observation.provider_observed_at) < Date.parse(aggregate.first_observed_at)) aggregate.first_observed_at = observation.provider_observed_at;
    if (Date.parse(observation.provider_observed_at) > Date.parse(aggregate.last_observed_at)) aggregate.last_observed_at = observation.provider_observed_at;
  }

  const candidates = [...aggregates.entries()].map(([address, aggregate]) => {
    const observationCount = aggregate.observation_ids.size;
    const distinctMintCount = aggregate.mints.size;
    const tier = candidateTier(observationCount, distinctMintCount);
    return freeze({
      schema_version: CONSTANT_K_NEXUS_WALLET_CANDIDATE_SCHEMA,
      candidate_id: candidateId(address),
      source_wallet_id: walletId(address),
      source_wallet: { chain: "solana", network: "mainnet", address },
      state: "provider_candidate_pending_raven_hydration",
      evidence_tier: tier,
      qualification_observation_count: observationCount,
      exact_swap_shape_observation_count: aggregate.exact_swap_shape_observations,
      reviewed_buy_instruction_observation_count: aggregate.reviewed_buy_instruction_observations,
      active_day_count: aggregate.days.size,
      distinct_mint_count: distinctMintCount,
      first_observed_at: aggregate.first_observed_at,
      last_observed_at: aggregate.last_observed_at,
      route_programs: freeze([...aggregate.programs.values()].sort((left, right) => left.key.localeCompare(right.key))),
      admission: {
        eligible_for_bounded_history_backfill: observationCount >= ConstantKNexusWalletDiscoveryLimits.recurring_observations,
        eligible_for_copyability_claim: false,
        source_performance_available: false,
        follower_performance_available: false,
        required_next_evidence: "Raven-confirmed transaction hydration, economic normalization, and bounded history reconstruction.",
      },
      ranking: {
        deterministic_order: "qualification_observations_desc_active_days_desc_distinct_mints_desc_recency_desc_address_asc",
        opaque_score_used: false,
      },
    });
  }).sort(sortCandidates);

  stats.candidate_observations = observations.length;
  return freeze({
    schema_version: CONSTANT_K_NEXUS_WALLET_DISCOVERY_SCHEMA,
    generated_at: generatedAt,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    state: stats.invalid_rows || stats.wrong_provider_rows ? "degraded" : stats.transaction_rows ? "current" : "idle",
    counts: freeze({
      ...stats,
      unique_candidates: candidates.length,
      recurring_candidates: candidates.filter((row) => row.evidence_tier !== "single_observation").length,
      high_signal_candidates: candidates.filter((row) => row.evidence_tier === "high_signal").length,
    }),
    candidates: freeze(candidates),
    observations: freeze(observations),
    claim_boundary: {
      provider_candidate_is_normalized_trade: false,
      provider_candidate_is_profitable_wallet: false,
      provider_candidate_is_copyable_wallet: false,
      backfill_eligibility_is_admission: false,
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

export function summarizeConstantKNexusWalletDiscovery(discovery) {
  if (discovery?.schema_version !== CONSTANT_K_NEXUS_WALLET_DISCOVERY_SCHEMA) fail("constant_k_discovery_invalid");
  return freeze({
    schema_version: "ravenos.constant_k_nexus_wallet_discovery_summary.v1",
    generated_at: discovery.generated_at,
    provider: discovery.provider,
    transport: discovery.transport,
    state: discovery.state,
    counts: discovery.counts,
    leading_candidates: freeze(discovery.candidates.slice(0, 25).map((candidate) => freeze({
      candidate_id: candidate.candidate_id,
      evidence_tier: candidate.evidence_tier,
      qualification_observation_count: candidate.qualification_observation_count,
      exact_swap_shape_observation_count: candidate.exact_swap_shape_observation_count,
      reviewed_buy_instruction_observation_count: candidate.reviewed_buy_instruction_observation_count,
      active_day_count: candidate.active_day_count,
      distinct_mint_count: candidate.distinct_mint_count,
      route_program_keys: freeze(candidate.route_programs.map((program) => program.key)),
      eligible_for_bounded_history_backfill: candidate.admission.eligible_for_bounded_history_backfill,
      address_included: false,
      signature_included: false,
    }))),
    privacy: {
      addresses_included: false,
      signatures_included: false,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
    },
    claim_boundary: discovery.claim_boundary,
    execution_boundary: discovery.execution_boundary,
  });
}
