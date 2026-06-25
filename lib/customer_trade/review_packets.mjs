import { createHash } from "node:crypto";

import {
  createDataProvenance,
  createTerminalMarketContext,
  createTerminalReviewPacket,
  createWalletCapabilitySnapshot,
} from "./contracts.mjs";
import { privacySafeWalletAddress } from "./wallet_capabilities.mjs";

const IN_MEMORY_REVIEW_STORE = new Map();

function reviewDb(env = {}) {
  return env.RAVENOS_DB || env.DB || null;
}

function nowUnixSeconds(now = Date.now()) {
  return Math.floor(now / 1000);
}

function evidenceIdForPacket(packet) {
  return `review_${createHash("sha256").update(packet.evidence_hash).digest("hex").slice(0, 24)}`;
}

function deriveReviewState(packet) {
  const expiryMs = packet.quote_expiry ? Date.parse(packet.quote_expiry) : null;
  if (expiryMs && expiryMs <= Date.now()) return "expired";
  if (Array.isArray(packet.blocking_reasons) && packet.blocking_reasons.length) return "blocked";
  return "ready";
}

function redactWalletSnapshot(snapshot = null) {
  if (!snapshot) return null;
  const normalized = createWalletCapabilitySnapshot(snapshot);
  return {
    ...normalized,
    public_address: normalized.public_address ? privacySafeWalletAddress(normalized.public_address) : null,
  };
}

function redactInspection(inspection = null) {
  if (!inspection) return null;
  const redactAddress = (value) => value ? privacySafeWalletAddress(String(value)) : value;
  return {
    ...inspection,
    fee_payer_effects: inspection.fee_payer_effects
      ? {
          ...inspection.fee_payer_effects,
          fee_payer: inspection.fee_payer_effects.fee_payer ? redactAddress(inspection.fee_payer_effects.fee_payer) : null,
        }
      : null,
    signer_requirements: Array.isArray(inspection.signer_requirements)
      ? inspection.signer_requirements.map((value) => redactAddress(value))
      : [],
    address_lookup_tables: Array.isArray(inspection.address_lookup_tables)
      ? inspection.address_lookup_tables.map((entry) => ({
          ...entry,
          resolved_addresses: Array.isArray(entry.resolved_addresses)
            ? entry.resolved_addresses.map((value) => redactAddress(value))
            : [],
        }))
      : [],
  };
}

export function createProofSafeReviewProjection(packet, {
  evidenceId = "",
  state = null,
  persistenceState = "memory",
  supersedesEvidenceId = null,
} = {}) {
  return {
    evidence_id: evidenceId,
    state: state || deriveReviewState(packet),
    supersedes_evidence_id: supersedesEvidenceId || null,
    persistence_state: persistenceState,
    packet: {
      schema_version: packet.schema_version,
      build_id: packet.build_id,
      created_at: packet.created_at,
      quote_expiry: packet.quote_expiry,
      evidence_hash: packet.evidence_hash,
      quote_only: Boolean(packet.quote_only),
      signing_disabled: Boolean(packet.signing_disabled),
      submission_disabled: Boolean(packet.submission_disabled),
      market_context_reference: packet.market_context_reference,
      quote: packet.quote ? {
        canonical_quote_id: packet.quote.canonical_quote_id,
        chain: packet.quote.chain,
        input_amount_base_units: packet.quote.input_amount_base_units,
        expected_output_amount_base_units: packet.quote.expected_output_amount_base_units,
        minimum_output_amount_base_units: packet.quote.minimum_output_amount_base_units,
        effective_price: packet.quote.effective_price,
        price_impact_bps: packet.quote.price_impact_bps,
        quote_timestamp: packet.quote.quote_timestamp,
        quote_expiry: packet.quote.quote_expiry,
        warnings: packet.quote.warnings || [],
      } : null,
      route: Array.isArray(packet.route) ? packet.route.map((leg) => ({
        leg_index: leg.leg_index,
        input_asset: leg.input_asset,
        output_asset: leg.output_asset,
        venue: leg.venue,
        proportion_bps: leg.proportion_bps,
        input_amount_base_units: leg.input_amount_base_units,
        expected_output_base_units: leg.expected_output_base_units,
        fee_amount_base_units: leg.fee_amount_base_units,
        fee_asset: leg.fee_asset,
        venue_known: leg.venue_known,
      })) : [],
      execution_cost_preview: packet.execution_cost_preview,
      provider_provenance: packet.provider_provenance ? createDataProvenance(packet.provider_provenance) : null,
      provider_freshness: packet.provider_freshness ? createDataProvenance(packet.provider_freshness) : null,
      wallet_capability_snapshot: redactWalletSnapshot(packet.wallet_capability_snapshot),
      transaction_inspection: redactInspection(packet.transaction_inspection),
      simulation_state: packet.simulation_state,
      warnings: packet.warnings || [],
      blocking_reasons: packet.blocking_reasons || [],
    },
  };
}

function memoryPut(record) {
  IN_MEMORY_REVIEW_STORE.set(record.evidence_id, record);
  return record;
}

function memoryGet(evidenceId) {
  return IN_MEMORY_REVIEW_STORE.get(evidenceId) || null;
}

async function dbPut(db, record) {
  await db
    .prepare(`
      INSERT OR REPLACE INTO terminal_review_packets (
        evidence_id,
        evidence_hash,
        build_id,
        schema_version,
        state,
        quote_expiry,
        supersedes_evidence_id,
        created_at_unix,
        redacted_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      record.evidence_id,
      record.packet.evidence_hash,
      record.packet.build_id,
      record.packet.schema_version,
      record.state,
      record.packet.quote_expiry || null,
      record.supersedes_evidence_id || null,
      nowUnixSeconds(Date.parse(record.packet.created_at || new Date().toISOString())),
      JSON.stringify(record),
    )
    .run();
  if (record.supersedes_evidence_id) {
    await db
      .prepare("UPDATE terminal_review_packets SET state = ? WHERE evidence_id = ?")
      .bind("superseded", record.supersedes_evidence_id)
      .run();
  }
}

async function dbGet(db, evidenceId) {
  const row = await db
    .prepare("SELECT redacted_payload_json FROM terminal_review_packets WHERE evidence_id = ? LIMIT 1")
    .bind(evidenceId)
    .first();
  if (!row?.redacted_payload_json) return null;
  return JSON.parse(String(row.redacted_payload_json));
}

export async function createAndPersistReviewPacket(rawInput = {}, {
  env = {},
  buildId = "",
  marketContext = null,
} = {}) {
  const packet = createTerminalReviewPacket({
    build_id: buildId,
    created_at: rawInput.created_at || new Date().toISOString(),
    market_context_reference: marketContext ? createTerminalMarketContext(marketContext) : (rawInput.market_context_reference || null),
    quote: rawInput.quote,
    quote_expiry: rawInput.quote_expiry || rawInput.quote?.quote_expiry,
    route: rawInput.route || rawInput.quote?.route_legs || [],
    execution_cost_preview: rawInput.execution_cost_preview || rawInput.quote?.execution_cost_preview || null,
    provider_provenance: rawInput.provider_provenance || rawInput.quote?.provider_provenance || null,
    provider_freshness: rawInput.provider_freshness || rawInput.quote?.freshness_metadata || null,
    wallet_capability_snapshot: rawInput.wallet_capability_snapshot || null,
    transaction_inspection: rawInput.transaction_inspection || null,
    simulation_state: rawInput.simulation_state || null,
    warnings: rawInput.warnings || [],
    blocking_reasons: rawInput.blocking_reasons || rawInput.quote?.blocked_reasons || [],
    quote_only: true,
    signing_disabled: true,
    submission_disabled: true,
  });
  const evidenceId = evidenceIdForPacket(packet);
  const state = deriveReviewState(packet);
  const record = createProofSafeReviewProjection(packet, {
    evidenceId,
    state,
    persistenceState: reviewDb(env) ? "persisted" : "memory",
    supersedesEvidenceId: rawInput.supersedes_evidence_id || null,
  });
  const db = reviewDb(env);
  try {
    if (db) {
      await dbPut(db, record);
    } else {
      memoryPut(record);
      if (record.supersedes_evidence_id) {
        const previous = memoryGet(record.supersedes_evidence_id);
        if (previous) previous.state = "superseded";
      }
    }
    return {
      ok: true,
      evidence_id: evidenceId,
      state,
      proof_url: `/api/trade/review?id=${encodeURIComponent(evidenceId)}`,
      packet,
      proof: record,
      persistence_state: db ? "persisted" : "memory",
    };
  } catch (error) {
    return {
      ok: false,
      error: "review_persistence_failed",
      evidence_id: evidenceId,
      state,
      packet,
      proof: record,
      persistence_state: "failed",
      message: "Review packet generated but persistence failed.",
      details: { reason: String(error?.message || error) },
    };
  }
}

export async function lookupReviewPacket(evidenceId, { env = {} } = {}) {
  const db = reviewDb(env);
  if (db) return dbGet(db, evidenceId);
  return memoryGet(evidenceId);
}
