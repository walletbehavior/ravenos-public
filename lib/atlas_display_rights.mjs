const PROVIDER_ALIASES = Object.freeze({
  polygon: "massive",
  polygon_io: "massive",
  massive_com: "massive",
  tradier_production: "tradier",
  tradier_sandbox: "tradier",
  yahoo: "yahoo_finance",
});

const HARD_DISPLAY_BLOCKS = Object.freeze({
  massive: Object.freeze({
    decision: "internal_only",
    reason: "massive_business_public_display_rights_not_configured",
  }),
  tradier: Object.freeze({
    decision: "restricted",
    reason: "tradier_partner_public_display_rights_not_configured",
  }),
  yahoo_finance: Object.freeze({
    decision: "unknown",
    reason: "yahoo_commercial_redistribution_rights_not_configured",
  }),
});

export function canonicalAtlasProvider(provider) {
  const normalized = String(provider || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return PROVIDER_ALIASES[normalized] || normalized || "unknown";
}

export function hardAtlasDisplayBlock(provider) {
  return HARD_DISPLAY_BLOCKS[canonicalAtlasProvider(provider)] || null;
}

function hardAtlasProductBlock(provider, entityId = "") {
  if (canonicalAtlasProvider(provider) === "fred" && /^fred:BAML/i.test(String(entityId || ""))) {
    return {
      decision: "internal_only",
      reason: "ice_bofa_fred_series_preapproval_not_configured",
    };
  }
  return null;
}

export function atlasObservationDecision(provider, upstreamPolicy = null, { entityId = "" } = {}) {
  const hardBlock = hardAtlasDisplayBlock(provider);
  if (hardBlock) return { ...hardBlock, source: "worker_hard_block" };
  const productBlock = hardAtlasProductBlock(provider, entityId);
  if (productBlock) return { ...productBlock, source: "worker_product_hard_block" };
  const evidenceRecorded = typeof upstreamPolicy?.decision_source === "string"
    && upstreamPolicy.decision_source.trim().length > 0
    && Number.isFinite(Date.parse(String(upstreamPolicy?.last_reviewed || "")));
  if (upstreamPolicy?.decision === "allowed" && upstreamPolicy?.raw_redistribution_allowed === true && evidenceRecorded) {
    return { decision: "allowed", reason: null, source: "qualified_upstream_policy" };
  }
  return {
    decision: upstreamPolicy?.decision || "unknown",
    reason: upstreamPolicy?.reason || (upstreamPolicy?.decision === "allowed" ? "public_display_evidence_not_recorded" : "public_display_rights_not_explicitly_qualified"),
    source: "fail_closed_default",
  };
}

export function atlasObservationAllowed(provider, upstreamPolicy = null, context = {}) {
  return atlasObservationDecision(provider, upstreamPolicy, context).decision === "allowed";
}
