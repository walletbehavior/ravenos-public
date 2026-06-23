export const FEATURE_TIERS = {
  free: 0,
  pro: 1,
  founder: 2,
  atlas: 3,
};

export const FEATURE_REGISTRY = {
  free_token_lookup: {
    requiredTier: "free",
    displayName: "Universal Token Lookup",
    description: "Search public token, pair, symbol, and contract coverage.",
    previewBehavior: "Full public lookup available.",
    upgradeCta: "Open Terminal",
  },
  basic_chart: {
    requiredTier: "free",
    displayName: "Basic Chart",
    description: "View public chart context and baseline market structure.",
    previewBehavior: "Available with limited or developing coverage labels.",
    upgradeCta: "Open Terminal",
  },
  basic_overlays: {
    requiredTier: "free",
    displayName: "Basic Overlays",
    description: "Public overlay context for liquidity, compression, and risk posture.",
    previewBehavior: "Limited public overlays.",
    upgradeCta: "Open Terminal",
  },
  market_cap_heatmap: {
    requiredTier: "free",
    displayName: "Market Cap Heatmap",
    description: "One public market-cap heatmap view.",
    previewBehavior: "Free users see a limited public heatmap.",
    upgradeCta: "Unlock Full Heatmaps",
  },
  limited_structure_tape: {
    requiredTier: "free",
    displayName: "Limited Structure Tape",
    description: "A compact feed of market structure observations.",
    previewBehavior: "Limited tape items.",
    upgradeCta: "Unlock Full Structure Tape",
  },
  research_preview: {
    requiredTier: "free",
    displayName: "Research Preview",
    description: "Preview Structure Lab findings without full detail depth.",
    previewBehavior: "Limited rows and summary context.",
    upgradeCta: "Unlock Full Research",
  },
  full_heatmaps: {
    requiredTier: "pro",
    displayName: "Full Heatmaps",
    description: "Full crypto spot, perps, cap, chain, venue, and segment heatmaps.",
    previewBehavior: "Locked preview cards and limited rows.",
    upgradeCta: "Upgrade to Pro",
  },
  degen_terminal: {
    requiredTier: "free",
    displayName: "Degen Terminal",
    description: "Behavioral crypto discovery across survival, participation, attention, replay, rotation, and leadership.",
    previewBehavior: "Free users can review one bucket at a time with limited rows. Pro unlocks all buckets, chains, sectors, replay, and rotation context.",
    upgradeCta: "Open Degen Terminal",
  },
  full_structure_tape: {
    requiredTier: "pro",
    displayName: "Full Structure Tape",
    description: "Expanded continuous behavioral observations and linked evidence.",
    previewBehavior: "Free users see a limited tape.",
    upgradeCta: "Upgrade to Pro",
  },
  full_replay_engine: {
    requiredTier: "pro",
    displayName: "Full Replay Engine",
    description: "Historical structure similarity and outcome distribution context.",
    previewBehavior: "Replay summary preview only.",
    upgradeCta: "Upgrade to Pro",
  },
  full_research: {
    requiredTier: "pro",
    displayName: "Full Research / Structure Lab",
    description: "Full Structure Lab views across setup families, replay, symbols, and failures.",
    previewBehavior: "Limited research preview.",
    upgradeCta: "Upgrade to Pro",
  },
  failure_analysis: {
    requiredTier: "pro",
    displayName: "Failure Analysis",
    description: "Research explaining why broad structures failed or flattened.",
    previewBehavior: "Locked failure panels.",
    upgradeCta: "Upgrade to Pro",
  },
  candidate_lanes: {
    requiredTier: "pro",
    displayName: "Candidate Lanes",
    description: "Diagnostic candidate lanes for future forward tracking review.",
    previewBehavior: "Locked candidate lane table.",
    upgradeCta: "Upgrade to Pro",
  },
  attribution: {
    requiredTier: "pro",
    displayName: "Attribution",
    description: "Feature, regime, symbol, and setup family attribution.",
    previewBehavior: "Locked attribution panels.",
    upgradeCta: "Upgrade to Pro",
  },
  alerts: {
    requiredTier: "pro",
    displayName: "Alerts",
    description: "Monitoring for RavenOS market structure and context changes.",
    previewBehavior: "Locked alert preview.",
    upgradeCta: "Upgrade to Pro",
  },
  watchlists: {
    requiredTier: "free",
    displayName: "Watchlists",
    description: "Save instruments, pairs, perps, and market groups for research context.",
    previewBehavior: "Free users can keep one compact watchlist. Pro expands practical limits.",
    upgradeCta: "Open Watchlists",
  },
  perps_intelligence: {
    requiredTier: "pro",
    displayName: "Perps Intelligence",
    description: "Pressure, replay, liquidity attraction, and participant context for perpetual futures.",
    previewBehavior: "Limited current pressure preview.",
    upgradeCta: "Upgrade to Pro",
  },
  participant_intelligence: {
    requiredTier: "pro",
    displayName: "Participant Intelligence",
    description: "Participant contribution, direction, velocity, conflict, concentration, distribution risk, and accumulation context.",
    previewBehavior: "Free users see a basic participant summary.",
    upgradeCta: "Upgrade to Pro",
  },
  founder_experiments: {
    requiredTier: "founder",
    displayName: "Founder Experiments",
    description: "Experimental overlays, replay, pressure v3, participant models, and new structure families.",
    previewBehavior: "Founder-only experimental preview.",
    upgradeCta: "Founder Access Required",
  },
  atlas_context: {
    requiredTier: "atlas",
    displayName: "Atlas Context",
    description: "Macro regime, liquidity regime, cross-asset, and institutional context layer.",
    previewBehavior: "Limited or delayed context while coverage expands.",
    upgradeCta: "Start Atlas",
  },
};

export function tierEntitlements({ tier = "free", stripePlanType = "", tokenTier = "" } = {}) {
  const entitlements = new Set(["free"]);
  const plan = String(stripePlanType || "").toLowerCase();
  const resolved = String(tier || "free").toLowerCase();
  const token = String(tokenTier || "").toLowerCase();
  if (resolved === "pro" || resolved === "founder" || token === "pro" || token === "founder") entitlements.add("pro");
  if (resolved === "founder" || token === "founder") {
    entitlements.add("pro");
    entitlements.add("founder");
  }
  if (resolved === "atlas" || plan.startsWith("atlas")) entitlements.add("atlas");
  return [...entitlements];
}

export function canAccessFeature(featureKey, access = {}) {
  const feature = FEATURE_REGISTRY[featureKey];
  if (!feature) return false;
  const entitlements = new Set(access.entitlements || tierEntitlements(access));
  return entitlements.has(feature.requiredTier);
}

export function resolveFeatureAccess(featureKey, access = {}) {
  const feature = FEATURE_REGISTRY[featureKey];
  if (!feature) {
    return {
      key: featureKey,
      exists: false,
      allowed: false,
      requiredTier: "pro",
      displayName: "Unknown Feature",
      description: "This feature is not registered.",
      previewBehavior: "Unavailable.",
      upgradeCta: "Upgrade",
    };
  }
  return {
    key: featureKey,
    exists: true,
    allowed: canAccessFeature(featureKey, access),
    ...feature,
  };
}

export function lockedPreviewModel(featureKey, access = {}) {
  const resolved = resolveFeatureAccess(featureKey, access);
  return {
    feature: featureKey,
    locked: !resolved.allowed,
    title: resolved.displayName,
    description: resolved.description,
    preview: resolved.previewBehavior,
    cta: resolved.upgradeCta,
    requiredTier: resolved.requiredTier,
  };
}
