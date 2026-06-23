(function () {
  const FEATURES = {
    free_token_lookup: ["free", "Universal Token Lookup", "Search public token, pair, symbol, and contract coverage.", "Full public lookup available.", "Open Terminal"],
    basic_chart: ["free", "Basic Chart", "View chart context and baseline market structure.", "Available with limited or developing coverage labels.", "Open Terminal"],
    basic_overlays: ["free", "Basic Overlays", "Public overlay context for liquidity, compression, and risk posture.", "Limited public overlays.", "Open Terminal"],
    market_cap_heatmap: ["free", "Market Cap Heatmap", "One public market-cap heatmap view.", "Free users see a limited public heatmap.", "Unlock Full Heatmaps"],
    limited_structure_tape: ["free", "Limited Structure Tape", "A compact feed of market structure observations.", "Limited tape items.", "Unlock Full Structure Tape"],
    research_preview: ["free", "Research Preview", "Preview Structure Lab findings without full detail depth.", "Limited rows and summary context.", "Unlock Full Research"],
    full_heatmaps: ["pro", "Full Heatmaps", "Full crypto spot, perps, cap, chain, venue, and segment heatmaps.", "Locked preview cards and limited rows.", "Upgrade to Pro"],
    degen_terminal: ["free", "Degen Terminal", "Behavioral crypto discovery across survival, participation, attention, replay, rotation, and leadership.", "Free users can review one bucket at a time with limited rows. Pro unlocks all buckets, chains, sectors, replay, and rotation context.", "Open Degen Terminal"],
    full_structure_tape: ["pro", "Full Structure Tape", "Expanded continuous behavioral observations and linked evidence.", "Free users see a limited tape.", "Upgrade to Pro"],
    full_replay_engine: ["pro", "Full Replay Engine", "Historical structure similarity and outcome distribution context.", "Replay summary preview only.", "Upgrade to Pro"],
    full_research: ["pro", "Full Research / Structure Lab", "Full Structure Lab views across setup families, replay, symbols, and failures.", "Limited research preview.", "Upgrade to Pro"],
    failure_analysis: ["pro", "Failure Analysis", "Research explaining why broad structures failed or flattened.", "Locked failure panels.", "Upgrade to Pro"],
    candidate_lanes: ["pro", "Candidate Lanes", "Diagnostic candidate lanes for future forward tracking review.", "Locked candidate lane table.", "Upgrade to Pro"],
    attribution: ["pro", "Attribution", "Feature, regime, symbol, and setup family attribution.", "Locked attribution panels.", "Upgrade to Pro"],
    alerts: ["pro", "Alerts", "Monitoring for RavenOS market structure and context changes.", "Locked alert preview.", "Upgrade to Pro"],
    watchlists: ["free", "Watchlists", "Save instruments, pairs, perps, and market groups for research context.", "Free users can keep one compact watchlist. Pro expands practical limits.", "Open Watchlists"],
    perps_intelligence: ["pro", "Perps Intelligence", "Pressure, replay, liquidity attraction, and participant context for perpetual futures.", "Limited current pressure preview.", "Upgrade to Pro"],
    participant_intelligence: ["pro", "Participant Intelligence", "Participant contribution, direction, velocity, conflict, concentration, distribution risk, and accumulation context.", "Free users see a basic participant summary.", "Upgrade to Pro"],
    founder_experiments: ["founder", "Founder Experiments", "Experimental overlays, replay, pressure v3, participant models, and new structure families.", "Founder-only experimental preview.", "Founder Access Required"],
    atlas_context: ["atlas", "Atlas Context", "Macro regime, liquidity regime, cross-asset, and institutional context layer.", "Limited or delayed context while coverage expands.", "Start Atlas"],
  };

  function feature(key) {
    const row = FEATURES[key];
    if (!row) return null;
    return { key, requiredTier: row[0], displayName: row[1], description: row[2], previewBehavior: row[3], upgradeCta: row[4] };
  }

  function entitlements(access) {
    const state = access || window.RavenOSAccess?.getState?.() || {};
    if (Array.isArray(state.entitlements) && state.entitlements.length) return new Set(state.entitlements);
    const set = new Set(["free"]);
    const tier = String(state.tier || "free").toLowerCase();
    const plan = String(state.subscription?.plan_type || "").toLowerCase();
    if (tier === "pro" || tier === "founder") set.add("pro");
    if (tier === "founder") set.add("founder");
    if (tier === "atlas" || plan.startsWith("atlas")) set.add("atlas");
    return set;
  }

  function canAccess(key, access) {
    const item = feature(key);
    if (!item) return false;
    return entitlements(access).has(item.requiredTier);
  }

  function injectStyles() {
    if (document.getElementById("ravenos-feature-styles")) return;
    const style = document.createElement("style");
    style.id = "ravenos-feature-styles";
    style.textContent = `
      .feature-locked { position: relative; }
      .feature-locked > :not(.locked-preview) { opacity: 0.48; }
      .locked-preview { border: 1px solid rgba(250,204,21,0.34); background: rgba(10,15,13,0.96); color: #e5f0eb; padding: 12px; margin-top: 10px; display: grid; gap: 8px; }
      .locked-preview strong { color: #facc15; font-size: 12px; text-transform: uppercase; }
      .locked-preview p { color: #9fb2aa; font-size: 12px; line-height: 1.45; margin: 0; }
      .locked-preview a, .locked-preview button { width: fit-content; border: 1px solid rgba(125,211,252,0.38); background: rgba(125,211,252,0.08); color: #edf6f1; padding: 7px 9px; font-size: 11px; font-weight: 850; text-transform: uppercase; text-decoration: none; }
      .access-badge, .coverage-badge-ui { display: inline-flex; align-items: center; border: 1px solid rgba(148,163,184,0.2); background: rgba(125,211,252,0.07); color: #7dd3fc; min-height: 22px; padding: 3px 8px; font-size: 10px; font-weight: 850; text-transform: uppercase; }
      .coverage-badge-ui[data-coverage="Live"] { color: #34d399; }
      .coverage-badge-ui[data-coverage="Cached"], .coverage-badge-ui[data-coverage="Preview"], .coverage-badge-ui[data-coverage="Fallback"] { color: #facc15; }
    `;
    document.head.appendChild(style);
  }

  function upgradeHref(requiredTier) {
    return requiredTier === "atlas" ? "/atlas/" : "/pricing/";
  }

  function lockedPreview(key) {
    const item = feature(key) || feature("full_research");
    const box = document.createElement("div");
    box.className = "locked-preview";
    box.innerHTML = `<strong>${item.displayName}</strong><p>${item.previewBehavior}</p><p>${item.description}</p><a href="${upgradeHref(item.requiredTier)}">${item.upgradeCta}</a>`;
    return box;
  }

  function applyFeatureGates(root = document, access) {
    injectStyles();
    root.querySelectorAll("[data-feature]").forEach((el) => {
      const key = el.getAttribute("data-feature");
      const allowed = canAccess(key, access);
      el.classList.toggle("feature-locked", !allowed);
      el.classList.toggle("feature-unlocked", allowed);
      el.dataset.featureAccess = allowed ? "unlocked" : "locked";
      el.setAttribute("aria-disabled", allowed ? "false" : "true");
      let preview = el.querySelector(":scope > .locked-preview");
      if (!allowed && !preview) el.appendChild(lockedPreview(key));
      if (allowed && preview) preview.remove();
    });
    root.querySelectorAll("[data-access-badge]").forEach((el) => {
      const state = access || window.RavenOSAccess?.getState?.() || {};
      el.className = `${el.className || ""} access-badge`.trim();
      el.textContent = state.status === "connected" ? (state.tier || "free") : "free";
    });
    root.querySelectorAll("[data-coverage-badge]").forEach((el) => {
      const coverage = el.getAttribute("data-coverage") || el.textContent || "Preview";
      el.className = `${el.className || ""} coverage-badge-ui`.trim();
      el.dataset.coverage = coverage;
      el.textContent = coverage;
    });
  }

  function FeatureGate(featureKey, contentHtml = "") {
    const item = feature(featureKey);
    const allowed = canAccess(featureKey);
    return allowed ? contentHtml : `<div class="locked-preview"><strong>${item.displayName}</strong><p>${item.previewBehavior}</p><p>${item.description}</p><a href="${upgradeHref(item.requiredTier)}">${item.upgradeCta}</a></div>`;
  }

  window.RavenOSFeatures = {
    registry: FEATURES,
    feature,
    canAccess,
    entitlements,
    applyFeatureGates,
    FeatureGate,
    LockedPreview: lockedPreview,
    UpgradeCTA: (featureKey) => lockedPreview(featureKey).querySelector("a"),
    AccessBadge: (access) => {
      const badge = document.createElement("span");
      badge.className = "access-badge";
      badge.textContent = access?.tier || "free";
      return badge;
    },
    CoverageBadge: (coverage = "Preview") => {
      const badge = document.createElement("span");
      badge.className = "coverage-badge-ui";
      badge.dataset.coverage = coverage;
      badge.textContent = coverage;
      return badge;
    },
  };

  document.addEventListener("DOMContentLoaded", () => applyFeatureGates());
  window.addEventListener("ravenos:access", (event) => applyFeatureGates(document, event.detail));
})();
