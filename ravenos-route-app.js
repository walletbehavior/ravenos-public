import { mountRavenOSShell } from "/ravenos-shell.js";
import { ravenOSContext } from "/ravenos-context-store.js";

const routeConfigNode = document.getElementById("ravenosRouteConfig");
const routeConfig = routeConfigNode ? JSON.parse(routeConfigNode.textContent) : null;
const ravenShell = mountRavenOSShell({ slug: routeConfig?.slug });
const FORMING_TEXT = "evidence forming";
const SOURCE_ACTIVITY_LABEL = ["Live", "Activity"].join("\\s+");
const SOURCE_ACTIVITY_TEXT = ["Live", "Activity"].join(" ");
const SOURCE_SURFACE_TEXT = ["Current", "Surface"].join(" ");
const SOURCE_SAMPLE_TEXT = ["Issue", "Sample"].join(" ");
const SOURCE_MARKET_ROWS_TEXT = ["market", "rows"].join(" ");
const SOURCE_ORIGINAL_CLAIM_TEXT = ["original", "public", "claim"].join(" ");
const SOURCE_PUBLIC_READ_TEXT = ["public", "read", "is", "mixed"].join(" ");
const SOURCE_CLEAREST_SURFACE_TEXT = ["clearest", "current", "surface"].join(" ");
let routeNarratorPayload = null;
let behaviorExplorerModel = null;
let behaviorExplorerBound = false;

function sourceRegex(pattern, flags = "i") {
  return new RegExp(pattern, flags);
}

function replaceSourcePhrase(value, phrase, replacement) {
  return value.replace(sourceRegex(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi"), replacement);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value, fallback = FORMING_TEXT) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function publicMarketLabel(value) {
  const raw = text(value, "").trim();
  if (!raw) return raw;
  if (/^all$/i.test(raw)) return "All chains";
  if (/^solana$/i.test(raw)) return "Solana";
  if (/^base$/i.test(raw)) return "Base";
  if (/^(bnb|bsc)$/i.test(raw)) return "BNB";
  if (/^(rh|robinhood)$/i.test(raw)) return "RH";
  if (/^hyperliquid$/i.test(raw)) return "Hyperliquid";
  if (/^hyperevm$/i.test(raw)) return "HyperEVM";
  if (/^eth$/i.test(raw) || /^ethereum$/i.test(raw)) return "Ethereum";
  const labels = {
    arbitrum: "Arbitrum",
    blast: "Blast",
    cronos: "Cronos",
    fantom: "Fantom",
    near: "NEAR",
    optimism: "Optimism",
    polkadot: "Polkadot",
    polygon: "Polygon",
    pulsechain: "PulseChain",
    sonic: "Sonic",
    stepnetwork: "Step Network",
    ton: "TON",
    tron: "TRON",
    xrpl: "XRPL",
  };
  return labels[raw.toLowerCase()] || titleCase(raw);
}

function traderSurfaceLabel(value, fallback = "market context") {
  const raw = text(value, fallback).trim();
  if (!raw) return fallback;
  const normalized = raw
    .replace(/_/g, " ")
    .replace(/\beth\b/i, "Ethereum");
  const humanized = normalized
    .split(/\s+·\s+/)
    .map((part) => publicMarketLabel(part))
    .join(" · ");
  return humanized
    .replace(/\bJupiter Velocity\b/gi, "High-velocity tokens")
    .replace(/^Current public participation regime$/i, "Current markets are mixed, not uniformly strong")
    .replace(sourceRegex(`^(.+?) · ${SOURCE_ACTIVITY_LABEL}$`), "$1")
    .replace(sourceRegex(`^(.+?) ${SOURCE_ACTIVITY_LABEL}$`), "$1 activity")
    .replace(/^(.+?) · Participant Cohorts$/i, "$1 participation")
    .replace(/^(.+?) Participant Cohorts$/i, "$1 participation");
}

function naturalOpportunitySurface(value) {
  const raw = traderSurfaceLabel(value || "current market surface").trim();
  if (/^Solana participation$/i.test(raw)) return "Solana participant cohorts";
  if (/^Base participation$/i.test(raw)) return "Base participant cohorts";
  if (/^Ethereum participation$/i.test(raw)) return "Ethereum participant cohorts";
  return raw;
}

function surfaceVerb(value) {
  return /\b(cohorts|markets|pairs|tokens|perps)\b/i.test(String(value || "")) ? "are" : "is";
}

function capBandLabel(value) {
  const key = String(value || "surface").trim().toLowerCase();
  const plainLabels = {
    all: "Broad market",
    broad: "Broad market",
    fresh_pairs: "Fresh pairs",
    micro: "Micro caps",
    small: "Small caps",
    mid: "Mid caps",
    large: "Large caps",
    mega: "Mega caps",
    perps_all: "All perps",
    perps_majors: "Major perps",
    perps_large_alts: "Large-cap alt perps",
    perps_alts: "Alt perps",
    participant_cohorts: "Broad participation",
    live_activity: "Market activity",
    jupiter_velocity: "High-velocity tokens",
  };
  if (plainLabels[key]) return plainLabels[key];
  const raw = titleCase(key);
  if (/^Jupiter Velocity$/i.test(raw)) return "high-velocity tokens";
  if (/^Live Activity$/i.test(raw)) return "activity";
  if (/^Participant Cohorts$/i.test(raw)) return "participant cohorts";
  return traderSurfaceLabel(raw);
}

function traderText(value, fallback = FORMING_TEXT) {
  const raw = text(value, fallback).trim();
  if (!raw) return fallback;
  let out = raw
    .replace(/\bJupiter Velocity\b/gi, "High-velocity token")
    .replace(sourceRegex(`^(.+?)\\s+${SOURCE_ACTIVITY_LABEL} shows the clearest public opportunity read while weaker cohorts remain selective\\.$`), "$1 is leading current opportunity, but followthrough remains selective.")
    .replace(sourceRegex(`^(.+?)\\s+${SOURCE_ACTIVITY_LABEL} looks most favorable now\\.$`), "$1 is leading current opportunity, but followthrough is still mixed.")
    .replace(sourceRegex(`^(.+?)\\s+${SOURCE_ACTIVITY_LABEL} is the ${SOURCE_CLEAREST_SURFACE_TEXT} because participation is expanding and the ${SOURCE_PUBLIC_READ_TEXT}\\.$`), "Participation is expanding on $1, but settled followthrough is not fully confirmed yet.")
    .replace(/^Solana Participant Cohorts shows the clearest public opportunity read while weaker cohorts remain selective\.$/i, "Solana participation is leading current opportunity, but followthrough remains selective.")
    .replace(/^(.+?) participation is the current opportunity read\.$/i, "$1 is leading current opportunity, but followthrough remains selective.")
    .replace(/^(.+?) participation is the clearest current market because participation is returning cohorts visible and validation is favorable\.$/i, "Participation is expanding on $1, but settled followthrough is not fully confirmed yet.")
    .replace(sourceRegex(`^(.+?) ${SOURCE_ACTIVITY_LABEL} is the clearest current public context\\.$`), "$1 is leading current opportunity.")
    .replace(sourceRegex(`^(.+?) ${SOURCE_ACTIVITY_LABEL} is active, but confirmation remains mixed\\.$`), "$1 activity is active, but confirmation remains mixed.")
    .replace(sourceRegex(`^${SOURCE_ACTIVITY_LABEL} participation on (.+?) is mixed or still unclear\\.$`), "Participation on $1 is mixed or still unclear.")
    .replace(/^Participant Cohorts participation on (.+?) is mixed or still unclear\.$/i, "$1 participant cohorts are visible, but followthrough remains mixed.")
    .replace(/^Participant Cohorts participation on (.+?) is producing stronger public outcomes than most rows\.$/i, "$1 participant cohorts are showing stronger public followthrough than most observed rows.")
    .replace(/^(.+?) Participant Cohorts is active, but confirmation remains mixed\.$/i, "$1 participant cohorts are visible, but confirmation remains mixed.")
    .replace(/^(.+?) Participant Cohorts is (.+?)\.$/i, "$1 participant cohorts are $2.")
    .replace(/^Reward improving where sample depth is usable\.?$/i, "Cleaner cohorts are following through.")
    .replace(/^Pressure context forming from public participation and outcome data\.?$/i, "Pressure is still forming; participation and outcomes are not fully aligned yet.")
    .replace(/^Current public brief is forming\.?$/i, "Current market read is forming.")
    .replace(/^Current public research snapshot unavailable$/i, "Current research snapshot unavailable")
    .replace(/^Current public research snapshot is forming while the latest completed cohort remains available\.?$/i, "Current research evidence is forming while the latest completed cohort remains available.")
    .replace(/^No completed live cohort yet; current observations remain in research sample forming state\.?$/i, "No completed live sample yet; current observations are still forming.")
    .replace(/^Research sample forming; latest completed cohort remains visible when available\.?$/i, "Research evidence is still forming; the latest completed cohort remains visible when available.")
    .replace(/^Raven preserved an independently admitted decision-time market observation\.?$/i, "Independent evidence confirmed a new market behavior at this exact instrument.")
    .replace(
      /^Raven (?:froze|observed)\s+(?:an?\s+)?(.+?)(?:\s+observation)?\s+while\s+(.+?)\s+was present\.?$/i,
      (_match, behavior, context) => `${titleCase(behavior)} appeared while ${String(context || "").trim().replace(/\s+visible$/i, "")} was in place.`,
    )
    .replace(/\bRaven (?:froze|observed)\b/gi, "Recorded")
    .replace(/\bfrozen decision observation\b/gi, "timestamped market observation")
    .replace(/\bfrozen observation\b/gi, "timestamped observation")
    .replace(/\bindependently admitted decision-time market observation\b/gi, "independently confirmed market behavior")
    .replace(/\bOutcomes Unclear\b/gi, "similar conditions remain mixed")
    .replace(/\bReplay\b/gi, "similar history")
    .replace(/\bOutcomes\b/gi, "followthrough")
    .replace(/^Behavior rows are public aggregate observations\. Each row shows a declared window, usable sample, and unit so “constructive” or “mixed” is never detached from its denominator\.$/i, "Participation is measured across current market surfaces and refreshed as new observations arrive.")
    .replace(/^Settled validation currently reads mixed against the original Raven read\.?$/i, "Followthrough is mixed against the original Raven read.")
    .replace(/\bConclusion first, evidence second, methodology expandable\.?/gi, "Raven shows the read first, then what confirms or weakens it.")
    .replace(/\bEvery material public read should link to later validation, mixed results, or insufficient evidence\.?/gi, "Raven tracks whether earlier reads followed through, failed, or need more evidence.")
    .replace(/\bOpen Opportunity as the next investigative surface\.?/gi, "Check the current opportunity page for the strongest active market.")
    .replace(/\bcurrent outcome set\b/gi, "current outcome history")
    .replace(/\bcurrent forward observation\b/gi, "current observation")
    .replace(/\bforward observation\b/gi, "open observation")
    .replace(/\bsample depth is public-safe\b/gi, "sample depth is sufficient")
    .replace(/\bpublic-safe\b/gi, "available")
    .replace(/\bclosest comparable\b/gi, "closest prior case")
    .replace(/\bcomparable setup\b/gi, "prior setup")
    .replace(/\bpublic proof rail\b/gi, "followthrough record")
    .replace(/\bpublic opportunity read\b/gi, "current opportunity read")
    .replace(/\bCurrent public participation regime\b/g, "Current markets are mixed, not uniformly strong")
    .replace(/\bPublic market context\b/g, "Market context")
    .replace(/\bpublic market context\b/g, "market context")
    .replace(/\bpublic research\b/gi, "research")
    .replace(/\bpublic brief\b/gi, "market read")
    .replace(/\bpublic summary\b/gi, "market summary")
    .replace(/\bdeclared\s+by\s+read\b/gi, "read-defined window")
    .replace(/\bsample forming\b/gi, FORMING_TEXT);
  out = replaceSourcePhrase(out, SOURCE_PUBLIC_READ_TEXT, "validation is mixed");
  out = replaceSourcePhrase(out, SOURCE_ORIGINAL_CLAIM_TEXT, "original Raven read");
  out = replaceSourcePhrase(out, SOURCE_SAMPLE_TEXT, "Sample");
  out = replaceSourcePhrase(out, SOURCE_MARKET_ROWS_TEXT, "observations");
  out = replaceSourcePhrase(out, SOURCE_SURFACE_TEXT, "Leading market");
  out = out.replace(sourceRegex(`\\b(.+?)\\s+${SOURCE_ACTIVITY_LABEL}\\b`, "gi"), "$1 activity");
  return out;
}

function publicReadType(value, slug = routeConfig?.slug) {
  const raw = String(value || "").trim();
  if (slug === "opportunity") return "Current opportunity";
  if (slug === "replay") return "Historical context";
  if (slug === "memory") return "Market memory";
  if (slug === "outcomes") return "Followthrough";
  if (slug === "behavior") return "Behavior read";
  if (slug === "perps") return "Perps read";
  if (/leading/i.test(raw)) return "Current opportunity";
  if (/historical/i.test(raw)) return "Historical context";
  if (/settled|validation/i.test(raw)) return "Followthrough";
  return "Current read";
}

function memoryFamilyLabel(value, fallback = "Similar conditions remain mixed") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^thin_sample$/i.test(raw)) return "Thin evidence dominates";
  if (/^broad_but_unconfirmed$/i.test(raw)) return "Broad participation, not confirmed";
  if (/^high_risk_low_clarity$/i.test(raw)) return "High risk, low clarity";
  if (/^mixed_signal_environment$/i.test(raw)) return "Mixed signal environment";
  if (/^thin_but_improving$/i.test(raw)) return "Thin evidence, improving";
  if (/outcomes unclear/i.test(raw)) return titleCase(traderText(raw));
  if (/^outcomes unclear$/i.test(raw)) return "Similar conditions remain mixed";
  if (/^participation punishing$/i.test(raw)) return "Participation followthrough is weak";
  if (/^participation rewarding$/i.test(raw)) return "Participation is following through";
  return titleCase(raw);
}

function memoryConditionLabel(value) {
  const raw = String(value || "")
    .replace(/_(current|live|\d+h)$/i, "")
    .replaceAll("_", " ")
    .trim();
  return traderSurfaceLabel(titleCase(raw || "market condition"));
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtWhen(value) {
  if (!value) return FORMING_TEXT;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(dt) + " UTC";
}

function fmtNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return FORMING_TEXT;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: num >= 100 ? 0 : 2 }).format(num);
}

function fmtPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return FORMING_TEXT;
  return `${num > 1 ? num.toFixed(2) : (num * 100).toFixed(2)}%`;
}

function fmtOptionalNumber(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  return fmtNumber(value);
}

function fmtOptionalPct(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  return fmtPct(value);
}

function fmtOptionalUsd(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(num) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(num) >= 1_000_000 ? 1 : 0,
  }).format(num);
}

function statusClass(status) {
  return String(status || "pending").toLowerCase().replaceAll(" ", "_");
}

function claimLink(claimId) {
  if (!claimId) return "";
  return `/claims/?id=${encodeURIComponent(claimId)}`;
}

function sourceRouteForSurface(surface, row = {}) {
  if (surface === "brief") return "/discover/";
  if (surface === "opportunity") return "/opportunity/";
  if (surface === "perps") return "/perps/";
  if (surface === "chain" || String(surface || "").startsWith("chain")) {
    const chain = String(row.market_scope?.chain || row.chain || "").toLowerCase();
    if (chain === "solana") return "/chains/solana/";
    if (chain === "base") return "/chains/base/";
    if (chain === "eth" || chain === "ethereum") return "/chains/ethereum/";
    return "/opportunity/";
  }
  return "/outcomes/";
}

function marketScopeLabel(row = {}) {
  const scope = row.market_scope || {};
  const primary = scope.chain || scope.venue || scope.market || row.chain || row.market || row.venue || null;
  const capBand = scope.cap_band || row.cap_band || null;
  const parts = [primary, capBand].filter(Boolean);
  return parts.length ? traderSurfaceLabel(titleCase(parts.join(" · "))) : "Market context";
}

function sampleLabel(sample) {
  if (!sample) return FORMING_TEXT;
  const usable = sample.usable ?? sample.settled ?? sample.observed ?? null;
  const unit = text(sample.unit, "").trim();
  if (usable === null || usable === undefined) return FORMING_TEXT;
  return `${fmtNumber(usable)}${unit ? ` ${unit}` : ""}`;
}

function opportunityCurrent(payload = {}) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (data.current_opportunity) return data.current_opportunity;
  const currentClaims = Array.isArray(data.current_claims) ? data.current_claims : [];
  return currentClaims.find((row) => row.surface === "opportunity") || currentClaims[0] || null;
}

function rowUsableSample(row = {}) {
  return Number(row.sample?.usable ?? row.sample_summary?.usable ?? row.usable_sample ?? row.sample_size ?? 0);
}

function rowObservedSample(row = {}) {
  return Number(row.sample?.observed ?? row.sample_summary?.observed ?? row.observed_sample ?? row.sample_size ?? 0);
}

function finiteCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function sampleMaturityLabel(value) {
  const sample = finiteCount(value) || 0;
  if (sample < 20) return "Too early";
  if (sample < 50) return "Early";
  if (sample < 200) return "Developing";
  return "Broader sample";
}

function behaviorSliceLabel(row = {}) {
  const chain = publicMarketLabel(row.chain || row.market_scope?.chain || "All");
  const band = capBandLabel(row.cap_band || row.capitalization_band || row.market_scope?.cap_band || "broad");
  const rawWindow = row.window || row.timeframe || "Current";
  const windowName = /^live$/i.test(rawWindow) ? "Current" : rawWindow;
  return traderSurfaceLabel(`${titleCase(chain)} · ${band} · ${windowName}`);
}

function behaviorSampleLabel(row = {}) {
  const usable = finiteCount(row.sample_summary?.usable ?? rowUsableSample(row)) || 0;
  const observed = finiteCount(row.sample_summary?.observed ?? rowObservedSample(row)) || 0;
  const ratio = observed > 0 ? `${Math.round((usable / observed) * 100)}%` : "coverage unavailable";
  return `${fmtNumber(usable)} usable of ${fmtNumber(observed)} observed (${ratio}) · ${sampleMaturityLabel(usable)}`;
}

function behaviorOutcomeCounts(row = {}) {
  const positive = finiteCount(row.positive_count ?? row.rewarding_count ?? row.rewarding);
  const mixed = finiteCount(row.mixed_count ?? row.mixed);
  const negative = finiteCount(row.negative_count ?? row.punishing_count ?? row.punishing);
  let measured = finiteCount(row.measured_count ?? row.outcome_sample_size ?? row.settled_sample);
  if (measured === null && positive !== null && mixed !== null && negative !== null) measured = positive + mixed + negative;
  if (positive === null || measured === null || measured <= 0 || positive > measured) return null;
  if (mixed !== null && negative !== null && positive + mixed + negative !== measured) return null;
  return { positive, mixed, negative, measured };
}

function behaviorOutcomeLabel(row = {}) {
  const counts = behaviorOutcomeCounts(row);
  if (!counts) return "No directional edge measured";
  const share = counts.positive / counts.measured;
  return `${fmtNumber(counts.positive)} of ${fmtNumber(counts.measured)} (${(share * 100).toFixed(1)}%) ended positive`;
}

function behaviorNarrative(row = {}) {
  const counts = behaviorOutcomeCounts(row);
  const trend = titleCase(row.trend || row.participation_trend || "forming").toLowerCase();
  const source = traderText(row.plain_language_summary || row.interpretation, `${titleCase(trend)} participation is forming.`);
  if (counts) return `${source} ${behaviorOutcomeLabel(row)} during the measured window.`;
  if (/reward|punish|success|win[- ]?rate|followthrough|positive outcome|negative outcome|stronger .*outcome/i.test(source)) {
    return `${titleCase(trend)} participation in this slice. No directional edge measured.`;
  }
  return `${source} No directional edge measured.`;
}

function behaviorStrengthScore(row = {}) {
  const strength = String(row.outcome_strength || "").toLowerCase();
  const trend = String(row.trend || row.participation_trend || "").toLowerCase();
  const strengthScore = behaviorOutcomeCounts(row)
    ? { strong: 4, rewarding: 4, mixed: 1, building: 0, weak: -3, punishing: -4 }[strength] ?? 0
    : 0;
  const trendScore = { expanding: 2, improving: 2, reaccelerating: 2, stable: 0, selective: -1, fading: -2, weakening: -2 }[trend] ?? 0;
  return strengthScore + trendScore;
}

function chooseBehaviorInsights(inputRows = []) {
  const rows = inputRows.filter(Boolean);
  const spotRows = rows.filter((row) => {
    const chain = String(row.chain || "").toLowerCase();
    const band = String(row.cap_band || row.capitalization_band || "").toLowerCase();
    return chain !== "hyperliquid" && !band.startsWith("perps_");
  });
  const pool = spotRows.length ? spotRows : rows;
  const supported = pool
    .filter((row) => rowUsableSample(row) >= 20)
    .sort((a, b) => behaviorStrengthScore(b) - behaviorStrengthScore(a) || rowUsableSample(b) - rowUsableSample(a));
  const broad = pool
    .filter((row) => /^(all|broad|live_activity|participant_cohorts)$/i.test(String(row.cap_band || row.capitalization_band || "")))
    .sort((a, b) => {
      const aAll = /^all$/i.test(String(a.chain || "")) ? 1 : 0;
      const bAll = /^all$/i.test(String(b.chain || "")) ? 1 : 0;
      return bAll - aAll || rowUsableSample(b) - rowUsableSample(a);
    })[0]
    || null;
  const strongest = supported.find((row) => row !== broad)
    || broad
    || [...pool].sort((a, b) => rowUsableSample(b) - rowUsableSample(a))[0]
    || null;
  const weakest = [...supported]
    .reverse()
    .find((row) => row !== strongest && behaviorStrengthScore(row) < behaviorStrengthScore(strongest || {}))
    || null;
  return { broad, strongest, weakest };
}

function behaviorInsightRail(rows = []) {
  const insights = chooseBehaviorInsights(rows);
  const cards = [
    ["Broad regime", insights.broad],
    ["Strongest supported slice", insights.strongest],
    ["Weakest supported slice", insights.weakest],
  ].filter(([, row], index, all) => row && all.findIndex(([, candidate]) => candidate === row) === index);
  if (!cards.length) return "";
  return `<section class="behavior-focus behavior-insight-rail" aria-label="Current behavior summary">
    ${cards.map(([role, row]) => `<article class="behavior-insight-card" data-insight-role="${escapeHtml(statusClass(role))}">
      <span>${escapeHtml(role)}</span>
      <h3>${escapeHtml(behaviorSliceLabel(row))}</h3>
      <p>${escapeHtml(behaviorNarrative(row))}</p>
      <dl>
        <div><dt>Participation</dt><dd>${escapeHtml(titleCase(row.trend || row.participation_trend || "forming"))}</dd></div>
        <div><dt>Directional edge</dt><dd>${escapeHtml(behaviorOutcomeLabel(row))}</dd></div>
        <div><dt>Coverage</dt><dd>${escapeHtml(behaviorSampleLabel(row))}</dd></div>
      </dl>
    </article>`).join("")}
  </section>`;
}

function currentBehaviorPayoff(value) {
  if (
    value?.schema_version !== "ravenos.participation_payoff.v1"
    || value?.state !== "current"
    || value?.public_safe !== true
    || value?.measurement?.causal_claim !== false
    || !Array.isArray(value?.insights)
  ) return null;
  const insights = value.insights.filter((row) => (
    ["rewarding", "fragile", "punishing"].includes(String(row?.state || "").toLowerCase())
    && String(row?.subject || "").trim()
    && Number(row?.usable_sample) >= 20
  )).slice(0, 4);
  return insights.length ? { ...value, insights } : null;
}

function behaviorPayoffLeaders(payoff) {
  const insights = payoff?.insights || [];
  return {
    working: insights.find((row) => row.state === "rewarding") || null,
    fragile: insights.find((row) => row.state === "fragile") || null,
    punishing: insights.find((row) => row.state === "punishing") || null,
  };
}

function behaviorPayoffHeadline(payoff, fallback) {
  const { working, fragile, punishing } = behaviorPayoffLeaders(payoff);
  if (working && punishing) return `${working.subject} are working; ${punishing.subject} are punishing recent participation.`;
  if (working && fragile) return `${working.subject} are working; ${fragile.subject} remain fragile.`;
  if (working) return `${working.subject} have the cleanest measured followthrough.`;
  if (punishing) return `${punishing.subject} are punishing recent participation.`;
  if (fragile) return `${fragile.subject} remain fragile despite pockets of strength.`;
  return fallback;
}

function behaviorPayoffPanel(payoff) {
  if (!payoff) return "";
  return `<section class="behavior-payoff" aria-label="Measured participation payoff">
    <header>
      <div><span>Measured followthrough</span><h3>Where participation is working—and where it is not</h3><p>${escapeHtml(payoff.summary || "Qualified market slices are compared using settled public outcomes.")}</p></div>
      <small>${escapeHtml(payoff.measurement?.display_window || "Latest samples")} · descriptive, not a forecast</small>
    </header>
    <div class="behavior-payoff-grid">
      ${payoff.insights.map((row) => `<article data-payoff-state="${escapeHtml(row.state)}">
        <span>${escapeHtml(row.state === "rewarding" ? "Working" : row.state === "fragile" ? "Fragile" : "Punishing")}</span>
        <strong>${escapeHtml(row.subject)}</strong>
        <p>${escapeHtml(row.plain_read || "Measured followthrough is available for this slice.")}</p>
        <dl><div><dt>What followed</dt><dd>${escapeHtml(row.operator_detail || "Measured outcome available")}</dd></div><div><dt>Settled sample</dt><dd>${escapeHtml(`${fmtNumber(row.usable_sample)} observations`)}</dd></div></dl>
        ${behaviorPayoffInsightActions(row)}
      </article>`).join("")}
    </div>
  </section>`;
}

const BEHAVIOR_SCOPE_VALUE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const BEHAVIOR_AGE_COHORTS = new Set(["fresh_pairs", "new_pairs", "new", "migrated", "mature", "post_migration"]);

function cleanBehaviorScopeValue(value) {
  const clean = String(value || "").trim().toLowerCase();
  return BEHAVIOR_SCOPE_VALUE.test(clean) ? clean : "";
}

function normalizeBehaviorWindow(value) {
  const clean = cleanBehaviorScopeValue(value);
  return clean === "live" ? "current" : clean;
}

function behaviorRowChain(row = {}) {
  return cleanBehaviorScopeValue(row.chain || row.market_scope?.chain);
}

function behaviorRowCohort(row = {}) {
  return cleanBehaviorScopeValue(row.cap_band || row.capitalization_band || row.market_scope?.cap_band);
}

function behaviorRowAgeCohort(row = {}) {
  return cleanBehaviorScopeValue(row.age_cohort || row.age_band || row.market_age_band || row.lifecycle_cohort);
}

function behaviorRowWindow(row = {}) {
  return normalizeBehaviorWindow(
    row.window
    || row.timeframe
    || row.observation_window?.label
    || row.evidence_contract?.observation_window?.label,
  );
}

function behaviorScopeFromUrl() {
  const params = new URL(window.location.href).searchParams;
  return {
    chain: cleanBehaviorScopeValue(params.get("chain")) || "all",
    cohort: cleanBehaviorScopeValue(params.get("cap_band")) || "all",
    age: cleanBehaviorScopeValue(params.get("age_cohort")) || "all",
    window: normalizeBehaviorWindow(params.get("window")) || "all",
  };
}

function behaviorScopeActive(scope = {}) {
  return [scope.chain, scope.cohort, scope.age, scope.window].some((value) => value && value !== "all");
}

function behaviorCohortLabel(value) {
  const clean = cleanBehaviorScopeValue(value);
  if (!clean || clean === "all") return "All market cohorts";
  if (BEHAVIOR_AGE_COHORTS.has(clean)) return `Age · ${capBandLabel(clean)}`;
  if (["micro", "small", "mid", "large", "mega"].includes(clean)) return `Market cap · ${capBandLabel(clean)}`;
  return capBandLabel(clean);
}

function behaviorScopeLabel(scope = {}) {
  const parts = [];
  if (scope.chain && scope.chain !== "all") parts.push(publicMarketLabel(scope.chain));
  if (scope.cohort && scope.cohort !== "all") parts.push(behaviorCohortLabel(scope.cohort).replace(/^(?:Market cap|Age) · /, ""));
  if (scope.age && scope.age !== "all") parts.push(`Age ${titleCase(scope.age)}`);
  if (scope.window && scope.window !== "all") parts.push(scope.window === "current" ? "Current" : scope.window);
  return parts.length ? parts.join(" · ") : "All supported slices";
}

function behaviorSliceScope(row = {}) {
  return {
    chain: behaviorRowChain(row) || "all",
    cohort: behaviorRowCohort(row) || "all",
    age: behaviorRowAgeCohort(row) || "all",
    window: behaviorRowWindow(row) || "all",
  };
}

function behaviorScopedHref(path, scope = {}) {
  const url = new URL(path, window.location.origin);
  if (scope.chain && scope.chain !== "all") url.searchParams.set("chain", scope.chain);
  if (scope.cohort && scope.cohort !== "all") url.searchParams.set("cap_band", scope.cohort);
  if (scope.age && scope.age !== "all") url.searchParams.set("age_cohort", scope.age);
  if (scope.window && scope.window !== "all") url.searchParams.set("window", scope.window);
  url.searchParams.set("source", "behavior");
  return `${url.pathname}${url.search}`;
}

function behaviorScopeMatches(row = {}, scope = {}) {
  if (scope.chain && scope.chain !== "all" && behaviorRowChain(row) !== scope.chain) return false;
  if (scope.cohort && scope.cohort !== "all" && behaviorRowCohort(row) !== scope.cohort) return false;
  if (scope.age && scope.age !== "all" && behaviorRowAgeCohort(row) !== scope.age) return false;
  if (scope.window && scope.window !== "all" && behaviorRowWindow(row) !== normalizeBehaviorWindow(scope.window)) return false;
  return true;
}

function behaviorPayoffInsightScope(insight = {}) {
  const parts = String(insight.insight_id || "").toLowerCase().split(":");
  if (parts.length < 4 || parts[0] !== "participation") return null;
  const chain = cleanBehaviorScopeValue(parts[1]);
  const cohort = cleanBehaviorScopeValue(parts[2]);
  if (!chain || !cohort) return null;
  return {
    chain,
    cohort,
    age: "all",
    window: normalizeBehaviorWindow(insight.observation_window) || "all",
  };
}

function behaviorPayoffInsightForRow(row = {}, payoff = null) {
  const rowScope = behaviorSliceScope(row);
  return (payoff?.insights || []).find((insight) => {
    const scope = behaviorPayoffInsightScope(insight);
    if (!scope || scope.chain !== rowScope.chain || scope.cohort !== rowScope.cohort) return false;
    return scope.window === "all" || rowScope.window === "all" || scope.window === rowScope.window;
  }) || null;
}

function behaviorSettledEvidence(row = {}, payoff = null) {
  const counts = behaviorOutcomeCounts(row);
  if (counts) {
    const positiveShare = counts.positive / counts.measured;
    return {
      score: positiveShare,
      label: `${fmtNumber(counts.positive)} of ${fmtNumber(counts.measured)} (${(positiveShare * 100).toFixed(1)}%) ended positive`,
      detail: "Completed outcomes in this market group and time window",
      sample: counts.measured,
      state: "measured",
    };
  }
  const insight = behaviorPayoffInsightForRow(row, payoff);
  if (!insight) return null;
  const order = { punishing: 0, fragile: 1, rewarding: 2 };
  return {
    score: order[String(insight.state || "").toLowerCase()] ?? 1,
    label: traderText(insight.plain_read, "Measured results are available."),
    detail: traderText(insight.operator_detail, "Measured outcome available"),
    sample: finiteCount(insight.usable_sample),
    state: String(insight.state || "measured").toLowerCase(),
  };
}

function behaviorSliceQualified(row = {}) {
  return rowUsableSample(row) >= 20
    && Boolean(behaviorRowChain(row) && behaviorRowCohort(row) && behaviorRowWindow(row));
}

function behaviorSliceActions(row = {}) {
  if (!behaviorSliceQualified(row)) return "";
  const scope = behaviorSliceScope(row);
  const label = behaviorSliceLabel(row);
  return `<nav class="behavior-slice-actions" aria-label="Historical evidence for ${escapeHtml(label)}"><a aria-label="Open similar history for ${escapeHtml(label)}" href="${escapeHtml(behaviorScopedHref("/replay/", scope))}">Similar history</a><a aria-label="Open measured results for ${escapeHtml(label)}" href="${escapeHtml(behaviorScopedHref("/outcomes/", scope))}">Measured results</a></nav>`;
}

function behaviorPayoffInsightActions(insight = {}) {
  const scope = behaviorPayoffInsightScope(insight);
  if (!scope || Number(insight.usable_sample) < 20) return "";
  const label = insight.subject || "this market slice";
  return `<nav class="behavior-slice-actions" aria-label="Historical evidence for ${escapeHtml(label)}"><a aria-label="Open similar history for ${escapeHtml(label)}" href="${escapeHtml(behaviorScopedHref("/replay/", scope))}">Similar history</a><a aria-label="Open measured results for ${escapeHtml(label)}" href="${escapeHtml(behaviorScopedHref("/outcomes/", scope))}">Measured results</a></nav>`;
}

function behaviorExplorerFollowthrough(row = {}, payoff = null) {
  return behaviorSettledEvidence(row, payoff)?.label || "No directional edge measured";
}

function behaviorExplorerNarrative(row = {}, payoff = null) {
  const evidence = behaviorSettledEvidence(row, payoff);
  const current = traderText(row.plain_language_summary || row.interpretation, `${titleCase(row.trend || row.participation_trend || "forming")} participation is forming.`);
  if (!evidence) {
    if (/reward|punish|success|win[- ]?rate|followthrough|positive outcome|negative outcome|stronger .*outcome/i.test(current)) {
      return `${titleCase(row.trend || row.participation_trend || "forming")} participation in this slice. No completed outcome comparison is attached.`;
    }
    return `${current} No completed outcome comparison is attached.`;
  }
  return `${current} ${evidence.label}.`;
}

function behaviorExplorerHighlightRail(rows = [], payoff = null) {
  const supported = rows.filter((row) => rowUsableSample(row) >= 20);
  if (!supported.length) return `<section class="behavior-focus behavior-insight-rail"><article class="behavior-insight-card"><span>Evidence forming</span><h3>No supported comparison in this view</h3><p>Widen the filters or wait for more usable observations. Thin slices are not ranked.</p></article></section>`;
  const measured = supported
    .map((row) => ({ row, evidence: behaviorSettledEvidence(row, payoff) }))
    .filter((item) => item.evidence)
    .sort((a, b) => b.evidence.score - a.evidence.score || rowUsableSample(b.row) - rowUsableSample(a.row));
  let cards;
  if (measured.length) {
    const strongest = measured[0];
    const weakest = [...measured].reverse().find((item) => item.row !== strongest.row) || null;
    cards = [["Best measured result", strongest], ["Weakest measured result", weakest]].filter(([, item]) => item);
  } else {
    const insights = chooseBehaviorInsights(supported);
    cards = [
      ["Strongest supported slice", insights.strongest ? { row: insights.strongest, evidence: null } : null],
      ["Weakest supported slice", insights.weakest ? { row: insights.weakest, evidence: null } : null],
    ].filter(([, item]) => item);
  }
  return `<section class="behavior-focus behavior-insight-rail" aria-label="Filtered behavior summary">
    ${cards.map(([role, item]) => `<article class="behavior-insight-card" data-insight-role="${escapeHtml(statusClass(role))}">
      <span>${escapeHtml(role)}</span>
      <h3>${escapeHtml(behaviorSliceLabel(item.row))}</h3>
      <p>${escapeHtml(behaviorExplorerNarrative(item.row, payoff))}</p>
      <dl>
        <div><dt>Participation</dt><dd>${escapeHtml(titleCase(item.row.trend || item.row.participation_trend || "forming"))}</dd></div>
        <div><dt>Directional edge</dt><dd>${escapeHtml(item.evidence?.label || "No directional edge measured")}</dd></div>
        <div><dt>Coverage</dt><dd>${escapeHtml(behaviorSampleLabel(item.row))}</dd></div>
      </dl>
      ${behaviorSliceActions(item.row)}
    </article>`).join("")}
  </section>`;
}

function behaviorMatrixCard(row = {}, payoff = null, { detailed = false } = {}) {
  const qualityMetric = detailed
    ? `<div><dt>Evidence quality</dt><dd>${escapeHtml(titleCase(row.confidence || "forming"))}</dd></div>`
    : `<div><dt>Window</dt><dd>${escapeHtml(row.window || row.timeframe || "current")}</dd></div>`;
  return `<article data-strength="${escapeHtml(statusClass(row.outcome_strength || row.participation_trend || "building"))}" data-behavior-chain="${escapeHtml(behaviorRowChain(row))}" data-behavior-cohort="${escapeHtml(behaviorRowCohort(row))}" data-behavior-window="${escapeHtml(behaviorRowWindow(row))}">
    <header><span>${escapeHtml(behaviorSliceLabel(row))}</span><b>${escapeHtml(sampleMaturityLabel(rowUsableSample(row)))}</b></header>
    <p>${escapeHtml(behaviorExplorerNarrative(row, payoff))}</p>
    <dl class="behavior-row-metrics" data-columns="4"><div><dt>Participation</dt><dd>${escapeHtml(titleCase(row.trend || row.participation_trend || "forming"))}</dd></div><div><dt>Directional edge</dt><dd>${escapeHtml(behaviorExplorerFollowthrough(row, payoff))}</dd></div>${qualityMetric}<div><dt>Coverage</dt><dd>${escapeHtml(behaviorSampleLabel(row))}</dd></div></dl>
    <div class="behavior-card-foot"><span>Aggregate market behavior</span>${behaviorSliceActions(row)}</div>
  </article>`;
}

function behaviorPayoffSubset(payoff, rows, scope) {
  if (!payoff || !behaviorScopeActive(scope)) return payoff;
  const insights = payoff.insights.filter((insight) => rows.some((row) => behaviorPayoffInsightForRow(row, { ...payoff, insights: [insight] })));
  return insights.length ? { ...payoff, insights } : null;
}

function setBehaviorFilterOptions(select, values, selected, labeler, allLabel) {
  if (!select) return;
  const options = [new Option(allLabel, "all")];
  for (const value of values) options.push(new Option(labeler(value), value));
  if (selected !== "all" && !values.includes(selected)) options.push(new Option(`${labeler(selected)} · unavailable`, selected));
  select.replaceChildren(...options);
  select.value = selected;
}

function syncBehaviorExplorerUrl(filters) {
  const url = new URL(window.location.href);
  for (const [key, value] of [["chain", filters.chain], ["cap_band", filters.cohort], ["age_cohort", filters.age], ["window", filters.window]]) {
    if (!value || value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  url.searchParams.delete("source");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function renderBehaviorExplorerResults({ syncUrl = false } = {}) {
  const model = behaviorExplorerModel;
  if (!model) return;
  const filters = {
    chain: document.getElementById("behaviorChainFilter")?.value || "all",
    cohort: document.getElementById("behaviorCohortFilter")?.value || "all",
    age: document.getElementById("behaviorAgeFilter")?.value || "all",
    window: document.getElementById("behaviorWindowFilter")?.value || "all",
  };
  model.filters = filters;
  const rows = model.rows.filter((row) => behaviorScopeMatches(row, filters));
  const visibleRows = rows.slice(0, model.displayLimit);
  const scopeLabel = behaviorScopeLabel(filters);
  const measured = rows.map((row) => behaviorSettledEvidence(row, model.payoff)).filter(Boolean);
  const summary = document.getElementById("behaviorExplorerSummary");
  if (summary) {
    const ageNote = model.ages.length ? "" : " This view does not yet separate markets by age.";
    summary.textContent = rows.length
      ? `${scopeLabel}: ${visibleRows.length < rows.length ? `showing ${visibleRows.length} of ${rows.length} matching slices` : `showing ${rows.length} of ${model.rows.length} current slices`}. ${measured.length} have qualified measured results; each sample remains separate.${ageNote}`
      : `${scopeLabel}: no current slice matches these filters. Broader cohorts were not substituted.${ageNote}`;
  }
  const payoffHost = document.getElementById("behaviorExplorerPayoff");
  if (payoffHost) payoffHost.innerHTML = behaviorPayoffPanel(behaviorPayoffSubset(model.payoff, rows, filters));
  const highlightHost = document.getElementById("behaviorExplorerHighlights");
  if (highlightHost) highlightHost.innerHTML = behaviorExplorerHighlightRail(rows, model.payoff);
  const matrix = document.getElementById("behaviorExplorerMatrix");
  if (matrix) {
    matrix.innerHTML = rows.length
      ? visibleRows.map((row) => behaviorMatrixCard(row, model.payoff, { detailed: model.detailed })).join("")
      : `<div class="route-unavailable behavior-explorer-empty"><strong>No supported market slice in this view</strong><p>Change a filter to see more current market groups. RavenOS will not replace an empty result with a broader or older rate.</p></div>`;
  }
  const strongestMeasured = measured.sort((a, b) => b.score - a.score)[0] || null;
  const weakestMeasured = [...measured].sort((a, b) => a.score - b.score)[0] || null;
  const stateStrip = document.getElementById("routeStateStrip");
  stateStrip.dataset.columns = "4";
  stateStrip.innerHTML = [
    routeStateCard("Slices shown", `${fmtNumber(rows.length)} of ${fmtNumber(model.rows.length)}`),
    routeStateCard("Best measured result", strongestMeasured?.label || "No qualified comparison"),
    routeStateCard("Weakest measured result", weakestMeasured && weakestMeasured !== strongestMeasured ? weakestMeasured.label : "No qualified comparison"),
    routeStateCard("Current data", titleCase(model.freshness)),
  ].join("");
  if (behaviorScopeActive(filters)) {
    document.getElementById("routeHeadline").textContent = rows.length ? `${scopeLabel}: participation under review.` : `${scopeLabel}: current evidence unavailable.`;
    document.getElementById("routeHeroSummary").textContent = measured.length
      ? "This view contains qualified completed outcomes. They describe prior results, not a forecast or calibrated probability."
      : "Current participation is visible where available, but no completed directional comparison is attached to this exact slice.";
  } else {
    document.getElementById("routeHeadline").textContent = model.baseHeadline;
    document.getElementById("routeHeroSummary").textContent = model.baseSummary;
  }
  if (syncUrl) syncBehaviorExplorerUrl(filters);
}

function mountBehaviorExplorer(rows, payoff, { detailed = false, freshness = "unavailable", baseHeadline = "Behavior Lab", baseSummary = "" } = {}) {
  const root = document.getElementById("behaviorExplorer");
  if (!root) return;
  const filters = behaviorScopeFromUrl();
  const chains = [...new Set(rows.map(behaviorRowChain).filter(Boolean))].sort();
  const cohorts = [...new Set(rows.map(behaviorRowCohort).filter(Boolean))].sort();
  const ages = [...new Set(rows.map(behaviorRowAgeCohort).filter(Boolean))].sort();
  const windows = [...new Set(rows.map(behaviorRowWindow).filter(Boolean))].sort();
  behaviorExplorerModel = { rows, payoff, detailed, freshness, baseHeadline, baseSummary, ages, filters, displayLimit: detailed ? 24 : 6 };
  root.hidden = false;
  setBehaviorFilterOptions(document.getElementById("behaviorChainFilter"), chains, filters.chain, publicMarketLabel, "All chains");
  setBehaviorFilterOptions(document.getElementById("behaviorCohortFilter"), cohorts, filters.cohort, behaviorCohortLabel, "All market cohorts");
  setBehaviorFilterOptions(document.getElementById("behaviorWindowFilter"), windows, filters.window, (value) => value === "current" ? "Current" : value, "All windows");
  const ageField = document.getElementById("behaviorAgeFilterField");
  if (ageField) ageField.hidden = !ages.length && filters.age === "all";
  setBehaviorFilterOptions(document.getElementById("behaviorAgeFilter"), ages, filters.age, titleCase, "All age cohorts");
  if (!behaviorExplorerBound) {
    behaviorExplorerBound = true;
    document.getElementById("behaviorExplorerControls")?.addEventListener("change", () => renderBehaviorExplorerResults({ syncUrl: true }));
    document.getElementById("behaviorExplorerControls")?.addEventListener("reset", (event) => {
      event.preventDefault();
      for (const id of ["behaviorChainFilter", "behaviorCohortFilter", "behaviorAgeFilter", "behaviorWindowFilter"]) {
        const select = document.getElementById(id);
        if (select) select.value = "all";
      }
      renderBehaviorExplorerResults({ syncUrl: true });
    });
  }
  renderBehaviorExplorerResults();
}

function hideBehaviorExplorer() {
  behaviorExplorerModel = null;
  const root = document.getElementById("behaviorExplorer");
  if (root) root.hidden = true;
}

function evidenceContextIsCurrent(evidence = {}, fallbackState = "unavailable", maxAgeSeconds = 86_400) {
  const state = String(evidence.actor_evidence_freshness || evidence.freshness || fallbackState || "").toLowerCase();
  if (!["fresh", "current"].includes(state)) return false;
  const observedAt = evidence.observed_at ? new Date(evidence.observed_at).getTime() : Number.NaN;
  if (!Number.isFinite(observedAt)) return true;
  return Math.max(0, Date.now() - observedAt) <= maxAgeSeconds * 1000;
}

function opportunitySurfaceRowLabel(row = {}) {
  const chain = publicMarketLabel(row.chain || row.market_scope?.chain || "market");
  const band = traderSurfaceLabel(row.cap_band || row.market_scope?.cap_band || "surface");
  if (/^all$/i.test(chain)) return band;
  return `${chain} ${band}`;
}

function opportunitySurfaceScore(row = {}) {
  const capBand = String(row.cap_band || row.market_scope?.cap_band || "").toLowerCase();
  if (!capBand || /live_activity|all|broad/i.test(capBand)) return -Infinity;
  const sample = rowUsableSample(row);
  const observed = rowObservedSample(row);
  if (sample < 10 && observed < 20) return -Infinity;
  const outcome = Number(row.outcome_score ?? 0);
  const participation = Number(row.participant_success_rate ?? 0);
  const specificity = /fresh|micro|meme|mid|small|perps|participant/.test(capBand) ? 1.5 : 1;
  const chainBoost = /^solana$/i.test(row.chain || row.market_scope?.chain || "") ? 0.2 : 0;
  return specificity + chainBoost + Math.log10(Math.max(sample, 1)) * 0.35 + outcome + participation * 0.5;
}

function bestSpecificOpportunitySurface(data = {}, preferredChain = "") {
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.behavior_rows) ? data.behavior_rows : [];
  const scopedRows = preferredChain
    ? rows.filter((row) => String(row.chain || row.market_scope?.chain || "").toLowerCase() === String(preferredChain).toLowerCase())
    : rows;
  const best = (scopedRows.length ? scopedRows : rows)
    .map((row) => ({ row, score: opportunitySurfaceScore(row) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)[0]?.row;
  return best || null;
}

function behavioralSurfaceLabel(row = {}) {
  const scope = row.market_scope || {};
  const chain = publicMarketLabel(scope.chain || row.chain || "");
  const capBand = String(scope.cap_band || row.cap_band || "").replace(/_/g, " ");
  if (chain && capBand && !/live activity/i.test(capBand)) return `${chain} ${capBand}`;
  if (chain && /live activity/i.test(capBand)) return `${chain} activity`;
  if (chain) return `${chain} behavioral surface`;
  return "Behavioral surface";
}

function opportunitySpecificityNote(row = {}) {
  const scope = row.market_scope || {};
  const chain = publicMarketLabel(scope.chain || row.chain || "");
  const capBand = String(scope.cap_band || "").replace(/_/g, " ");
  if (chain && capBand && !/live activity/i.test(capBand)) {
    return `${chain} ${capBand} is the clearest current behavioral surface. Broader context remains available in participant activity and similar history.`;
  }
  if (chain) {
    return `${chain} activity is the current public behavioral surface; finer cap-band detail is coverage developing.`;
  }
  return "Raven has a current behavioral opportunity read, but surface detail is coverage developing.";
}

function renderOpportunitySurface(current, specificRow, data = {}) {
  const chainLevel = behavioralSurfaceLabel(current || {});
  const surface = specificRow ? naturalOpportunitySurface(opportunitySurfaceRowLabel(specificRow)) : naturalOpportunitySurface(chainLevel);
  const cleanRead = specificRow
    ? `${surface} ${surfaceVerb(surface)} the clearest backed behavioral surface right now.`
    : opportunitySpecificityNote(current || {});
  const specificity = specificRow
    ? `This narrows the broader ${publicMarketLabel(specificRow.chain || "market")} read; it does not imply all ${publicMarketLabel(specificRow.chain || "market")} assets share the same behavior.`
    : opportunitySpecificityNote(current || {});
  const sample = specificRow
    ? `${fmtNumber(rowUsableSample(specificRow))} usable / ${fmtNumber(rowObservedSample(specificRow))} observed`
    : current?.sample ? `${fmtNumber(current.sample.usable)} ${traderText(current.sample.unit)}` : FORMING_TEXT;
  const behaviorRead = specificRow?.plain_language_summary || current?.summary || "Behavioral opportunity is forming.";
  const status = specificRow?.profitability_label || specificRow?.derived_state || current?.validation_status || "pending";
  const missingEvidence = specificRow
    ? "Asset-level actor detail and deeper followthrough are still measured separately."
    : /live activity/i.test(String(current?.market_scope?.cap_band || "")) ? "Cap-band detail coverage developing" : "Evidence depth forming";
  const settled = Array.isArray(data.outcomes_context) ? data.outcomes_context.find((row) => row.claim_id === current?.claim_id || row.origin_claim_id === current?.origin_claim_id) : null;
  const preferredChain = current?.market_scope?.chain || current?.chain || specificRow?.chain || "";
  const behaviorRows = Array.isArray(data.rows) ? data.rows : [];
  const surfaceRows = behaviorRows
    .filter((row) => !preferredChain || String(row.chain || "").toLowerCase() === String(preferredChain).toLowerCase())
    .filter((row) => !/^(all|live_activity)$/i.test(String(row.cap_band || "")))
    .sort((a, b) => opportunitySurfaceScore(b) - opportunitySurfaceScore(a))
    .slice(0, 4);
  const surfaceBreakdown = surfaceRows.length
    ? surfaceRows.map((row) => summaryMetric(opportunitySurfaceRowLabel(row), traderText(row.plain_language_summary || row.derived_state || FORMING_TEXT))).join("")
    : summaryMetric("Surface detail", "Coverage developing beyond the chain-level read");
  document.getElementById("routeHeadline").textContent = cleanRead;
  document.getElementById("routeHeroSummary").textContent = `${specificity} ${traderText(behaviorRead, "Behavioral opportunity is forming.")}`;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Specific surface", surface || FORMING_TEXT),
    routeStateCard("Broader read", chainLevel || FORMING_TEXT),
    routeStateCard("Followthrough", titleCase(status)),
    routeStateCard("Sample", sample)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Behavioral Opportunity</div><h2>Surface-specific deck</h2></div>${current ? `<span class="route-pill ${statusClass(current.validation_status)}">${escapeHtml(titleCase(current.validation_status))}</span>` : ""}</div>
    <p class="route-summary">${escapeHtml(specificity)}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Broader context", chainLevel)}
      ${summaryMetric("Followthrough", titleCase(status))}
      ${summaryMetric("Evidence depth", sample)}
      ${summaryMetric("Missing evidence", missingEvidence)}
      ${summaryMetric("Next inspection", "Open Terminal filtered to this surface")}
    </div>
    <div class="route-card-grid dense" style="margin-top:12px;">
      ${surfaceBreakdown}
    </div>
    <div class="route-next">
      ${current?.claim_id ? `<a class="primary" href="${claimLink(current.claim_id)}">View evidence</a>` : ""}
      <a href="/behavior/">Open Behavior</a>
      <a href="/terminal/">Open Terminal</a>
    </div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Evidence Context</div><h2>Research and followthrough</h2></div></div>
    <p class="route-bridge">${escapeHtml(traderText(settled?.plain_language_status, "Current behavior can strengthen before followthrough confirms it."))}</p>
    ${settled ? `<div class="route-proof-grid" style="margin-top:12px;">${proofCard(settled)}</div>` : `<p class="route-caveat">Followthrough review is still forming for the active opportunity surface.</p>`}
  `;
}

async function hydrateOpportunitySpecificity(current, data = {}) {
  try {
    const response = await fetch("/ravenos/behavior.json", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const behaviorData = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
    const preferredChain = current?.market_scope?.chain || current?.chain || "";
    const specific = bestSpecificOpportunitySurface(behaviorData, preferredChain);
    if (specific) renderOpportunitySurface(current, specific, { ...data, rows: behaviorData.rows || [] });
  } catch (error) {
    console.warn("RavenOS opportunity specificity hydration failed:", error);
  }
}

function getEvidenceContract(payload) {
  const data = payload?.data || payload || {};
  const census = censusFromPayload(payload);
  if (census) {
    return {
      evidence_mode: "decision-time observations",
      as_of: census.generated_at,
      observation_window: { label: "current public view" },
      sample: {
        observed: census.population?.decision_observations || 0,
        usable: census.population?.paths_with_evidence || 0,
        settled: census.population?.matured_path_windows || 0,
        unit: "decision observations",
      },
      freshness: { state: census.source_state || "unavailable" },
      confidence: { label: "research only" },
      settlement_window: { label: "declared future-only windows" },
      population: { label: "observed Raven decision population" },
      weighting: { description: "independence-adjusted upstream" },
      source: { public_label: "Raven current opportunity read" },
      validation_status: "research only",
      artifact_version: census.contract?.public_projection_version || "1.0",
    };
  }
  return (
    data.evidence_contract ||
    data.current_opportunity?.evidence_contract ||
    data.claim?.evidence_contract ||
    data.latest_validation?.evidence_contract ||
    null
  );
}

function getEvidenceBridge(payload, slug) {
  const data = payload?.data || payload || {};
  if (slug === "opportunity" && data.current_opportunity) {
    const current = data.current_opportunity;
    const settled = Array.isArray(data.outcomes_context) ? data.outcomes_context.find((row) => row.claim_id === current.claim_id || row.origin_claim_id === current.origin_claim_id) : null;
    if (settled && current.validation_status !== settled.current_validation_status) {
      return "Live reads can move before outcomes settle. We separate current opportunity from later followthrough checks.";
    }
  }
  return "Live reads can move before outcomes settle. We separate current opportunity from later followthrough checks.";
}

function renderEvidenceStrip(payload) {
  const contract = getEvidenceContract(payload);
  const detail = {
    role: titleCase(contract?.evidence_mode || payload?.data?.evidence_role || routeConfig.evidence_role || "current synthesis"),
    asOf: fmtWhen(contract?.as_of || payload?.generated_at || payload?.updated_at || payload?.data?.generated_at),
    window: traderText(text(contract?.observation_window?.label, "current window")).replace(/^current public window$/i, "current window"),
    sample: contract?.sample ? `${fmtNumber(contract.sample.usable)} ${traderText(text(contract.sample.unit, "").trim(), "").trim()}` : "see totals below",
    freshness: contract?.freshness?.state ? titleCase(contract.freshness.state) : "checking",
    confidence: titleCase(contract?.confidence?.label || payload?.data?.confidence?.label || "developing"),
    settlement: text(contract?.settlement_window?.label, "varies by read"),
    population: traderText(text(contract?.population?.label, "market observations")).replace(/^public aggregate market context$/i, "aggregate market context"),
    weighting: text(contract?.weighting?.description || contract?.weighting?.mode, "equal row"),
    source: traderText(text(contract?.source?.public_label || payload?.source || payload?.data?.source, "Raven feed")).replace(/\bpublic artifact\b/gi, "Raven feed"),
    observedSettled: contract?.sample ? `${fmtNumber(contract.sample.observed)} / ${fmtNumber(contract.sample.settled ?? 0)}` : "see page totals",
    validation: titleCase(contract?.validation_status || payload?.data?.validation_status || "pending"),
    artifact: text(contract?.artifact_version || payload?.schema_version || payload?.data?.artifact_version, "unversioned")
  };
  document.querySelector('[data-evidence-field="role"]').textContent = publicReadType(detail.role);
  const rawRole = document.querySelector('[data-evidence-field="raw_role"]');
  if (rawRole) rawRole.textContent = detail.role;
  document.querySelector('[data-evidence-field="as_of"]').textContent = detail.asOf;
  document.querySelector('[data-evidence-field="window"]').textContent = detail.window;
  document.querySelector('[data-evidence-field="sample"]').textContent = detail.sample;
  document.querySelector('[data-evidence-field="freshness"]').textContent = detail.freshness;
  document.querySelector('[data-evidence-field="confidence"]').textContent = detail.confidence;
  document.querySelector('[data-evidence-field="bridge"]').innerHTML = `<strong>Why reads can differ:</strong> ${escapeHtml(getEvidenceBridge(payload, routeConfig.slug))}`;
  document.querySelector('[data-evidence-field="settlement"]').textContent = detail.settlement;
  document.querySelector('[data-evidence-field="population"]').textContent = detail.population;
  const weighting = document.querySelector('[data-evidence-field="weighting"]');
  if (weighting) weighting.textContent = detail.weighting;
  document.querySelector('[data-evidence-field="source"]').textContent = detail.source;
  document.querySelector('[data-evidence-field="observed_settled"]').textContent = detail.observedSettled;
  document.querySelector('[data-evidence-field="validation"]').textContent = detail.validation;
  const artifact = document.querySelector('[data-evidence-field="artifact"]');
  if (artifact) artifact.textContent = detail.artifact;
}

function routeStateCard(label, value) {
  return `<div class="route-state-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function summaryMetric(label, value) {
  return `<div class="route-card"><div class="route-metric-label">${escapeHtml(label)}</div><div class="route-metric-value">${escapeHtml(value)}</div></div>`;
}

function summaryMetricHtml(label, html) {
  return `<div class="route-card"><div class="route-metric-label">${escapeHtml(label)}</div><div class="route-metric-value">${html}</div></div>`;
}

function replayBasisList(reasons) {
  const items = (Array.isArray(reasons) ? reasons : [])
    .map((reason) => traderText(reason))
    .filter(Boolean)
    .slice(0, 4);
  if (!items.length) return escapeHtml("coverage developing");
  return `<ul class="route-compact-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function sumBy(rows, selectors) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    for (const selector of selectors) {
      const value = selector(row);
      const num = Number(value);
      if (Number.isFinite(num)) return total + num;
    }
    return total;
  }, 0);
}

function sampleTotals(rows) {
  return {
    observed: sumBy(rows, [
      (row) => row.sample?.observed,
      (row) => row.sample_detail?.observed,
      (row) => row.sample_summary?.observed,
      (row) => row.observed_sample,
      (row) => row.sample_size,
    ]),
    usable: sumBy(rows, [
      (row) => row.sample?.usable,
      (row) => row.sample_detail?.usable,
      (row) => row.sample_summary?.usable,
      (row) => row.usable_sample,
      (row) => row.clean_sample,
      (row) => row.sample_size,
    ]),
    settled: sumBy(rows, [
      (row) => row.sample?.settled,
      (row) => row.settled_sample,
      (row) => row.clean_sample,
      (row) => row.sample_size,
    ]),
    underlying: sumBy(rows, [
      (row) => row.sample?.underlying_observations,
      (row) => row.underlying_observations,
      (row) => row.sample?.observed,
      (row) => row.observed_sample,
    ]),
  };
}

function proofCard(row, { legacy = false } = {}) {
  const status = row.current_validation_status || row.validation_status || row.settled_result || "pending";
  const settledAt = row.settled_at ? fmtWhen(row.settled_at) : null;
  const claimHref = row.claim_id ? claimLink(row.claim_id) : "";
  const sourceHref = sourceRouteForSurface(row.surface, row);
  const visibleSample = traderText(sampleLabel(row.sample), "evidence forming");
  const visibleWindow = traderText(row.expected_validation_window || row.observation_window?.label || "pending");
  return `
    <article class="route-proof-card">
      <div class="route-panel-head">
        <div>
          <div class="route-chip-label">${escapeHtml(titleCase(row.surface || "read"))}</div>
          <h3>${escapeHtml(traderText(row.headline || row.public_read || "Read forming"))}</h3>
        </div>
        <span class="route-pill ${statusClass(status)}">${escapeHtml(titleCase(status))}</span>
      </div>
      <p class="route-copy">${escapeHtml(traderText(row.plain_language_status || row.public_summary, "Validation context is forming."))}</p>
      <div class="route-card-grid route-proof-visible">
        ${summaryMetric("Window", visibleWindow)}
        ${summaryMetric("Observations", visibleSample)}
        ${summaryMetric("Outcome status", titleCase(row.settled_result || status))}
      </div>
      <div class="route-next">
        ${claimHref ? `<a class="primary" href="${claimHref}">View evidence</a>` : ""}
        <a href="${sourceHref}">Open market context</a>
        ${legacy ? "" : `<a href="/outcomes/">View outcome status</a>`}
      </div>
      <details class="route-evidence-details">
        <summary>Evidence details</summary>
        <div class="route-proof-meta">
          <div class="route-meta"><strong>Read ID</strong><span>${escapeHtml(row.claim_id || "legacy_unlinked")}</span></div>
          <div class="route-meta"><strong>Issued</strong><span>${escapeHtml(fmtWhen(row.issued_at))}</span></div>
          <div class="route-meta"><strong>Evidence role</strong><span>${escapeHtml(titleCase(row.evidence_role || "leading"))}</span></div>
          <div class="route-meta"><strong>Validation window</strong><span>${escapeHtml(text(row.expected_validation_window, "pending"))}</span></div>
          <div class="route-meta"><strong>Market scope</strong><span>${escapeHtml(marketScopeLabel(row))}</span></div>
          <div class="route-meta"><strong>Sample</strong><span>${escapeHtml(visibleSample)}</span></div>
          <div class="route-meta"><strong>Outcome result</strong><span>${escapeHtml(titleCase(row.settled_result || status))}</span></div>
          <div class="route-meta"><strong>Outcome time</strong><span>${escapeHtml(settledAt || "pending")}</span></div>
          <div class="route-meta"><strong>Evidence method</strong><span>${escapeHtml(text(row.methodology_version, "public definitions"))}</span></div>
        </div>
      </details>
    </article>
  `;
}

function renderFallbackMessage(message) {
  const heroSummary = document.getElementById("routeHeroSummary");
  if (heroSummary) heroSummary.textContent = message;
}

function narratorPageSlug(slug) {
  if (slug === "home") return "brief";
  if (["brief", "opportunity", "terminal", "atlas", "replay", "outcomes", "behavior", "research", "perps"].includes(slug)) return slug;
  return "";
}

async function fetchNarratorPayload() {
  // The legacy static narrator files are not part of the deployable artifact
  // and are materially older than the current projection. Route-specific,
  // deterministic language is rendered from the live structured contract.
  return null;
}

function renderNarratorPanel() {
  const payload = routeNarratorPayload;
  const host = document.getElementById("routeSecondaryPanel");
  if (!payload || !host) return;
  const ctx = payload.behavioral_authority_context || {};
  const missing = Array.isArray(payload.missing_evidence) ? payload.missing_evidence.slice(0, 4) : [];
  const supports = Array.isArray(payload.supporting_evidence) ? payload.supporting_evidence.slice(0, 3) : [];
  const weakens = Array.isArray(payload.weakening_evidence) ? payload.weakening_evidence.slice(0, 3) : [];
  const watching = Array.isArray(payload.what_raven_is_watching) ? payload.what_raven_is_watching.slice(0, 3) : [];
  const supported = Array.isArray(payload.what_is_supported) && payload.what_is_supported.length ? payload.what_is_supported.slice(0, 3) : supports;
  const missingReadable = Array.isArray(payload.what_is_missing) && payload.what_is_missing.length ? payload.what_is_missing.slice(0, 3) : missing;
  const publicSummary = traderText(ctx.public_summary || payload.current_read || "Research observation is forming.");
  const pathStatus = titleCase(ctx.path_evidence_status || "path capture forming");
  const managementStatus = titleCase(ctx.management_validation_status || "not validated");
  const researchStatus = titleCase(ctx.research_status || payload.research_status || "research observation");
  const authorityState = titleCase(ctx.authority_state || "forming");
  const narratorLabel = traderText(payload.narrator_label || "Raven research read");
  const blockers = Array.isArray(ctx.authority_blockers) ? ctx.authority_blockers.slice(0, 3).map(titleCase) : [];
  const panel = `
    <article class="route-card narrator-panel" aria-label="Raven research narrator">
      <div class="route-panel-head"><div><div class="route-chip-label">${escapeHtml(narratorLabel)}</div><h2>${escapeHtml(traderText(payload.headline, "Research observation"))}</h2></div></div>
      <p class="route-summary">${escapeHtml(publicSummary)}</p>
      <div class="route-card-grid" style="margin-top:12px;">
        ${summaryMetric("Why Raven is watching", traderText(payload.why_raven_is_watching || payload.current_read || "Research observation is forming."))}
        ${summaryMetric("What is supported", supported.length ? supported.map(traderText).join("; ") : "Evidence still forming")}
        ${summaryMetric("What is missing", missingReadable.length ? missingReadable.map(traderText).join("; ") : "Evidence still forming")}
        ${summaryMetric("What that means", traderText(payload.what_that_means || ctx.public_summary || "This remains descriptive research context."))}
      </div>
      <div class="route-card-grid dense" style="margin-top:12px;">
        ${summaryMetric("Behavioral authority", authorityState)}
        ${summaryMetric("Research status", researchStatus)}
        ${summaryMetric("Evidence completeness", titleCase(ctx.evidence_completeness || payload.evidence_completeness?.label || "forming"))}
        ${summaryMetric("Path evidence", pathStatus)}
        ${summaryMetric("Post-decision path", titleCase(ctx.post_decision_path_status || "forming"))}
        ${summaryMetric("Management path", managementStatus)}
      </div>
      <div class="route-card-grid" style="margin-top:12px;">
        ${summaryMetric("Authority blockers", blockers.length ? blockers.join("; ") : "No public blocker published")}
        ${summaryMetric("Why", traderText(ctx.why || payload.why_it_matters))}
        ${summaryMetric("Why not", traderText(ctx.why_not || weakens[0] || "Evidence remains incomplete"))}
      </div>
      <p class="route-caveat" style="margin-top:10px;">${escapeHtml(watching[0] || "Raven is watching for stronger evidence before updating its read.")}</p>
      ${supports.length ? `<p class="route-caveat">Supports: ${escapeHtml(supports.map(traderText).join("; "))}</p>` : ""}
      ${weakens.length ? `<p class="route-caveat">Weakens: ${escapeHtml(weakens.map(traderText).join("; "))}</p>` : ""}
    </article>
  `;
  if (!host.querySelector(".narrator-panel")) {
    host.insertAdjacentHTML("afterbegin", panel);
  } else {
    host.querySelector(".narrator-panel").outerHTML = panel;
  }
}

function renderBrief(payload) {
  const data = payload?.data || {};
  const read = traderText(data.one_sentence_read, "Current market evidence is forming.");
  const actorEvidence = data.actor_evidence || {};
  const selected = ravenOSContext.getState().subject;
  const selectedLabel = selected.id === "unselected" ? "Market-wide brief" : `${selected.label} selected · market-wide brief`;
  const warningLabels = {
    helius_profile_thin: "Some participant profiles remain incomplete.",
    outcome_pending: "Followthrough is still maturing.",
    raw_wallet_redacted: "Participant identities remain aggregated for privacy.",
    stale_sweep_dependency: "Some supporting market observations have not refreshed yet.",
  };
  const warnings = [...new Set((Array.isArray(data.warnings) ? data.warnings : []).slice(0, 4).map((item) => warningLabels[String(item || "").toLowerCase()] || "A source or maturity limitation remains attached to this read."))];
  const structuredThesis = `${titleCase(data.participation_quality || "forming")} participation. ${titleCase(data.outcome_status || "unproven")} followthrough.`;
  const changeRows = [
    ["Participation", data.participation_change, "No current participation delta was projected."],
    ["Pressure", data.pressure_change, "No current pressure delta was projected."],
    ["Reward", data.reward_change, "No current outcome delta was projected."],
  ];
  document.getElementById("routeHeadline").textContent = read;
  document.getElementById("routeHeroSummary").textContent = traderText(
    data.public_read_label || actorEvidence.public_read_label,
    "Raven is preserving the current market state while followthrough evidence matures.",
  );
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Updated", fmtWhen(data.generated_at || payload.generated_at)),
    routeStateCard("Actors observed", fmtNumber(data.actor_count)),
    routeStateCard("Cohorts", fmtNumber(data.cohort_count)),
    routeStateCard("Repeat actors", fmtNumber(data.repeat_actor_count)),
    routeStateCard("Participation", titleCase(data.participation_quality || "forming")),
    routeStateCard("Outcome state", titleCase(data.outcome_status || "unproven")),
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <article class="brief-document">
      <header class="brief-document-head">
        <div><span>Raven / current market brief</span><small>${escapeHtml(selectedLabel)}</small></div>
        <span class="route-pill ${statusClass(data.outcome_status)}">${escapeHtml(titleCase(data.outcome_status || "unproven"))}</span>
      </header>
      <section class="brief-thesis">
        <span>Evidence posture</span>
        <h2>${escapeHtml(structuredThesis)}</h2>
        <p>${escapeHtml(traderText(actorEvidence.public_read_label || data.public_read_label, "Raven is preserving the current evidence state while the next path matures."))}</p>
      </section>
      <section class="brief-change-grid" aria-label="What changed">
        ${changeRows.map(([label, value, fallback]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(traderText(value, fallback))}</strong></article>`).join("")}
      </section>
      <section class="brief-ledger" aria-label="Brief evidence ledger">
        <div><span>Participation quality</span><strong>${escapeHtml(titleCase(data.participation_quality || "forming"))}</strong></div>
        <div><span>Actor evidence</span><strong>${escapeHtml(`${fmtNumber(data.actor_count)} observed · ${fmtNumber(data.repeat_actor_count)} repeat`)}</strong></div>
        <div><span>Cohort context</span><strong>${escapeHtml(`${fmtNumber(data.cohort_count)} aggregate cohorts`)}</strong></div>
        <div><span>Outlier dependence</span><strong>${escapeHtml(titleCase(data.outlier_dependency || "not measured"))}</strong></div>
        <div><span>10% path events</span><strong>${escapeHtml(fmtNumber(data.actual_mfe10_count))}</strong></div>
        <div><span>25% path events</span><strong>${escapeHtml(fmtNumber(data.actual_mfe25_count))}</strong></div>
      </section>
      <footer class="brief-actions"><a class="primary" href="/discover/">Open Discover</a><a href="${escapeHtml(ravenOSContext.decorateHref("/terminal/"))}">Inspect selected instrument</a><a href="/outcomes/">Review followthrough</a></footer>
    </article>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <aside class="brief-notes">
      <header><span>Read boundary</span><h2>What this brief can support</h2></header>
      <dl>
        <div><dt>Observed</dt><dd>${escapeHtml(fmtWhen(data.generated_at || payload.generated_at))}</dd></div>
        <div><dt>Identity</dt><dd>Aggregate market and privacy-preserving actor context</dd></div>
        <div><dt>Independence</dt><dd>Adjusted upstream; raw relationship graphs remain private</dd></div>
        <div><dt>Outcome</dt><dd>${escapeHtml(titleCase(data.outcome_status || "unproven"))}; open evidence is not relabeled as settled</dd></div>
        <div><dt>Execution</dt><dd>Research only · signing and submission unavailable</dd></div>
      </dl>
      <section><span>Limitations attached to this read</span>${warnings.length ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>No public warning is attached to this read.</p>`}</section>
      <p class="brief-context-note">An exact instrument may be carried into this view for continuity, but the Brief remains market-wide. RavenOS does not fabricate an instrument-specific brief from aggregate evidence.</p>
    </aside>
  `;
}

function censusFromPayload(payload = {}) {
  if (payload.census && typeof payload.census === "object") return payload.census;
  if (payload.data?.schema_version === "ravenos_opportunity_census_public_v1") return payload.data;
  if (payload.schema_version === "ravenos_opportunity_census_public_v1") return payload;
  return null;
}

function opportunityEvidenceLabel(row = {}) {
  const comparable = row.matured_comparables || {};
  const sample = Number(comparable.sample_size || 0);
  if (!sample) return "No attached comparable sample";
  return `${fmtNumber(sample)} same-instrument paths · ${titleCase(comparable.evidence_maturity || "forming")}`;
}

function opportunityReviewLabel(row = {}) {
  const comparable = row.matured_comparables || {};
  if (!Number(comparable.sample_size || 0)) return "Exact outcome join unclaimed";
  const favorable = Number(comparable.median_favorable_excursion_pct);
  const adverse = Number(comparable.median_adverse_excursion_pct);
  if (!Number.isFinite(favorable) || !Number.isFinite(adverse)) return "Outcome distribution forming";
  return `${fmtNumber(favorable)}% favorable / ${fmtNumber(adverse)}% adverse`;
}

function opportunityTerminalHref(row = {}) {
  const instrument = String(row.instrument || "").trim().toUpperCase();
  const instrumentId = String(row.instrument_id || "").trim();
  const coin = instrument.replace(/-PERP$/, "");
  if (!coin || !instrument.endsWith("-PERP")) return "";
  if (!["exact_instrument", "exact venue instrument"].includes(String(row.identity_scope || "").toLowerCase())) return "";
  if (String(row.market_type || "") !== "perpetual") return "";
  if (String(row.venue || "").toLowerCase() !== "hyperliquid") return "";
  if (instrumentId !== `hyperliquid:perp:${coin}`) return "";
  const join = row.source_join || {};
  const exactCurrentContext = join.current_decision_context === true
    && String(join.join_scope || "").toLowerCase() === "exact instrument";
  if (join.census_row_joined !== true && !exactCurrentContext) return "";
  const params = new URLSearchParams({
    asset: instrument,
    instrument_id: instrumentId,
    instrument_type: "perpetual",
    asset_class: "crypto",
    identity_scope: "exact_instrument",
    venue: "hyperliquid",
    market: "perp",
    quote: "USD",
    settlement: "USDC",
    cash: "USDC",
    numeraire: "USDC",
  });
  return `/terminal/?${params.toString()}`;
}

function renderOpportunityCensus(payload, census) {
  const population = census.population || {};
  const opportunitySet = census.opportunities || {};
  const rows = Array.isArray(opportunitySet.rows) ? opportunitySet.rows : [];
  const top = rows[0] || null;
  const topFamily = top?.raven_atoms?.[0] || "decision context";
  const headline = top
    ? `${top.instrument} · ${topFamily}`
    : "Current opportunity rows are unavailable.";
  const summary = top
    ? traderText(top.why_raven_noticed, `${titleCase(topFamily)} appeared on ${top.instrument}.`)
    : "Raven has current aggregate market coverage, but no exact market can be shown.";
  document.getElementById("routeHeadline").textContent = headline;
  document.getElementById("routeHeroSummary").textContent = summary;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Current read", titleCase(census.source_state || "unavailable")),
    routeStateCard("Exact markets", fmtNumber(rows.length)),
    routeStateCard("Historical comparisons", fmtNumber(population.complete_matured_paths)),
    routeStateCard("Updated", fmtWhen(census.generated_at)),
  ].join("");

  const rowMarkup = rows.map((row) => {
    const instrument = text(row.instrument, "Unavailable");
    const direction = titleCase(row.observed_direction || "unavailable");
    const pressure = text(row.pressure_state, "Pressure unavailable");
    const family = row.raven_atoms?.[0] || "Behavior forming";
    const context = titleCase(row.context_state || "unavailable");
    const join = row.source_join?.census_row_joined === true
      ? "Independent evidence"
      : row.source_join?.current_decision_context === true
        ? "Exact decision context"
        : "Market context only";
    const href = opportunityTerminalHref(row);
    return `<tr>
      <td>${href ? `<a class="route-market-link" href="${escapeHtml(href)}"><strong>${escapeHtml(instrument)}</strong><span>${escapeHtml(fmtWhen(row.decision_at))}</span></a>` : `<div class="route-market-link"><strong>${escapeHtml(instrument)}</strong><span>Exact identity unavailable</span></div>`}</td>
      <td><span class="route-pill ${statusClass(row.context_state)}">${escapeHtml(context)}</span><small>${escapeHtml(join)}</small></td>
      <td><strong>${escapeHtml(family)}</strong><span>${escapeHtml(traderText(row.why_raven_noticed, "Decision context preserved."))}</span></td>
      <td><strong>${escapeHtml(direction)}</strong><span>${escapeHtml(pressure)}</span></td>
      <td><strong>${escapeHtml(opportunityEvidenceLabel(row))}</strong><span>${escapeHtml(opportunityReviewLabel(row))}</span></td>
      <td>${href ? `<a class="route-open-link" href="${escapeHtml(href)}">Open Terminal →</a>` : `<span class="route-pill unavailable">Unavailable</span>`}</td>
    </tr>`;
  }).join("");
  const mobileCard = (row) => {
    const instrument = text(row.instrument, "Unavailable");
    const href = opportunityTerminalHref(row);
    return `<article class="route-mobile-card route-opportunity-card">
      <header><div><span>${escapeHtml(titleCase(row.context_state || "unavailable"))}</span><h3>${escapeHtml(instrument)}</h3></div>${href ? `<a href="${escapeHtml(href)}">Terminal →</a>` : `<span>Unavailable</span>`}</header>
      <p>${escapeHtml(traderText(row.why_raven_noticed, "Decision context preserved."))}</p>
      <dl><div><dt>Behavior</dt><dd>${escapeHtml(row.raven_atoms?.[0] || "Forming")}</dd></div><div><dt>Pressure</dt><dd>${escapeHtml(text(row.pressure_state, "Unavailable"))}</dd></div><div><dt>Evidence</dt><dd>${escapeHtml(opportunityEvidenceLabel(row))}</dd></div></dl>
    </article>`;
  };
  const mobileRows = rows.slice(0, 5).map(mobileCard).join("");
  const mobileMore = rows.length > 5
    ? `<details class="route-mobile-more"><summary>Show ${escapeHtml(fmtNumber(rows.length - 5))} more observed instruments</summary><div>${rows.slice(5).map(mobileCard).join("")}</div></details>`
    : "";

  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Why now</div><h2>Current exact markets</h2></div><span class="route-pill ${statusClass(census.source_state)}">${escapeHtml(titleCase(census.source_state || "unavailable"))}</span></div>
    ${top ? `<section class="opportunity-focus"><div><span>Strongest current signal</span><h3>${escapeHtml(top.instrument)}</h3><p>${escapeHtml(summary)}</p></div><dl><div><dt>Path</dt><dd>${escapeHtml(titleCase(top.path_review?.state || top.context_state || "unavailable"))}</dd></div><div><dt>Pressure</dt><dd>${escapeHtml(text(top.pressure_state, "Unavailable"))}</dd></div><div><dt>Evidence</dt><dd>${escapeHtml(opportunityEvidenceLabel(top))}</dd></div><div><dt>Identity</dt><dd>${escapeHtml(top.instrument_id || "Unavailable")}</dd></div></dl>${opportunityTerminalHref(top) ? `<a href="${escapeHtml(opportunityTerminalHref(top))}">Inspect exact market →</a>` : `<span class="route-pill unavailable">Exact market unavailable</span>`}</section>` : ""}
    <p class="route-copy">Research only. A current signal is not an order, recommendation, or personalized plan.</p>
    ${rows.length ? `<div class="route-table-wrap route-opportunity-table"><table class="route-table"><thead><tr><th>Instrument</th><th>State</th><th>Why Raven noticed</th><th>Direction / pressure</th><th>Similar history</th><th></th></tr></thead><tbody>${rowMarkup}</tbody></table></div><div class="route-mobile-card-list">${mobileRows}${mobileMore}</div>` : `<div class="route-unavailable"><strong>No exact opportunities can be shown</strong><p>Raven will not fill this view with older or invented markets.</p></div>`}
  `;

  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Why a market can be missing</div><h2>Exact, current, or unavailable</h2></div></div>
    <div class="route-continuity-list">
      <div><span>Identity</span><strong>Exact market required</strong><small>No inferred pool, listing, or contract</small></div>
      <div><span>Recency</span><strong>A fresh market read is required</strong><small>Older observations do not substitute</small></div>
      <div><span>History</span><strong>Measured windows only</strong><small>Open observations remain open</small></div>
      <div><span>Action</span><strong>Research only</strong><small>No signing or order submission</small></div>
    </div>
  `;
}

function renderOpportunity(payload) {
  const census = censusFromPayload(payload);
  if (census) {
    renderOpportunityCensus(payload, census);
    return;
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const current = opportunityCurrent(payload);
  const preferredChain = current?.market_scope?.chain || current?.chain || "";
  renderOpportunitySurface(current, bestSpecificOpportunitySurface(data, preferredChain), data);
  hydrateOpportunitySpecificity(current, data);
}

function renderReplay(payload) {
  const data = payload?.data || {};
  const requestedScope = behaviorScopeFromUrl();
  const scoped = behaviorScopeActive(requestedScope);
  const availableComparables = Array.isArray(data.comparables) ? data.comparables : [];
  const comparables = (scoped ? availableComparables.filter((row) => behaviorScopeMatches(row, requestedScope)) : availableComparables).slice(0, 6);
  if (!comparables.length && (scoped || data.availability?.state === "unavailable" || data.status === "historical_comparables_unavailable")) {
    const scopeLabel = scoped ? behaviorScopeLabel(requestedScope) : "this market";
    document.getElementById("routeHeadline").textContent = `Similar history is unavailable for ${scopeLabel}.`;
    document.getElementById("routeHeroSummary").textContent = text(
      scoped ? "No historical match with the same chain, market group, age, and time window is available. Broader history was not substituted." : "Raven has not found a trustworthy historical match for this view yet.",
      "Raven has not found a trustworthy historical match for this view yet.",
    );
    document.getElementById("routeStateStrip").innerHTML = [
      ...(scoped ? [routeStateCard("Requested slice", scopeLabel)] : []),
      routeStateCard("Similar history", "Unavailable"),
      routeStateCard("Invented matches", data.availability?.synthetic_similarity_generated === false ? "Never" : "Not verified"),
      routeStateCard("Newer results reused", data.availability?.current_outcomes_substituted === false ? "Never" : "Not verified"),
      routeStateCard("Available analogues", "0"),
    ].join("");
    document.getElementById("routePrimaryPanel").innerHTML = `
      <div class="route-panel-head"><div><div class="route-chip-label">Similar history unavailable</div><h2>No invented analogues</h2></div><span class="route-pill unavailable">Unavailable</span></div>
      <div class="route-unavailable"><strong>No trustworthy match yet</strong><p>${escapeHtml(scoped ? `No historical match is available for ${scopeLabel}. RavenOS did not widen the chain, market group, age, or window to manufacture one.` : "Current historical comparisons are not available for this view.")}</p></div>
      <div class="route-next"><a class="primary" href="${escapeHtml(behaviorScopedHref("/outcomes/", requestedScope))}">Inspect measured followthrough</a><a href="${escapeHtml(behaviorScopedHref("/behavior/", requestedScope))}">Change Behavior filters</a><a href="/opportunity/">Return to current opportunities</a></div>`;
    document.getElementById("routeSecondaryPanel").innerHTML = `
      <div class="route-panel-head"><div><div class="route-chip-label">Why unavailable</div><h2>What Raven needs before showing similar history</h2></div></div>
      <div class="route-continuity-list">
        <div><span>Setup</span><strong>The same market conditions</strong><small>No looser category used to force a match</small></div>
        <div><span>Timing</span><strong>Only what was known then</strong><small>No later information added to the original setup</small></div>
        <div><span>Result</span><strong>The full window must finish</strong><small>Incomplete outcomes stay out of the comparison</small></div>
        <div><span>Evidence</span><strong>Traceable market history</strong><small>Private identities and thresholds stay private</small></div>
      </div>`;
    return;
  }
  const comparableLabel = (row) => traderSurfaceLabel([titleCase(row?.chain), titleCase(row?.cap_band)].filter(Boolean).join(" · "));
  const top = comparables[0] || null;
  const matchReasons = top ? (top.match_reasons || []).map((reason) => traderText(reason)).filter(Boolean) : [];
  const topOutcome = titleCase(top?.after_window_summary || FORMING_TEXT);
  const topMeaning = top
    ? `${fmtPct(top.similarity_score)} similarity means the current public structure matched prior ${comparableLabel(top)} conditions across ${matchReasons.length ? matchReasons.join(", ") : "available public context"}. Prior followthrough was ${topOutcome.toLowerCase()}. This supports historical context, not conviction or a forecast.`
    : "Historical interpretation is forming because no comparable setup is currently available.";
  document.getElementById("routeHeadline").textContent = scoped
    ? `${behaviorScopeLabel(requestedScope)}: what looked similar before?`
    : traderText(comparables[0]?.public_read, "Historical analogue context is forming.");
  document.getElementById("routeHeroSummary").textContent = scoped
    ? "Only as-of comparables matching the requested market slice are shown. Later data is never rewritten into the original comparison."
    : "Similar history explains what looked alike before and what followed, without turning prior results into a forecast.";
  document.getElementById("routeStateStrip").innerHTML = [
    ...(scoped ? [routeStateCard("Requested slice", behaviorScopeLabel(requestedScope))] : []),
    routeStateCard("Similar setups", fmtNumber(comparables.length)),
    routeStateCard("Closest match", top ? comparableLabel(top) : FORMING_TEXT),
    routeStateCard("Top similarity", top ? fmtPct(top.similarity_score) : FORMING_TEXT),
    routeStateCard("Prior outcome", topOutcome)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Historical comparison</div><h2>What Happened Before</h2></div></div>
    <article class="route-card route-interpretation-card" style="margin-bottom:12px;">
      <div class="route-metric-label">What this means</div>
      <p class="route-summary">${escapeHtml(top ? `Similar history supports context, not conviction. The current structure resembles prior ${comparableLabel(top)} conditions, but prior followthrough was ${topOutcome.toLowerCase()}. Raven treats this as historical context until current behavior and path evidence strengthen.` : topMeaning)}</p>
    </article>
    <div class="route-card-grid" style="margin:12px 0;">
      ${summaryMetric("Closest analogue", top ? comparableLabel(top) : FORMING_TEXT)}
      ${summaryMetricHtml("Similarity basis", replayBasisList(matchReasons))}
      ${summaryMetric("Prior followthrough", topOutcome)}
      ${summaryMetric("Interpretation", top ? "Analogue context, not a forecast" : FORMING_TEXT)}
    </div>
    <div class="route-table-wrap"><table class="route-table"><thead><tr><th>Similar setup</th><th>Similarity</th><th>Followthrough</th><th>Similarity basis</th></tr></thead><tbody>${
      comparables.map((row) => `<tr><td><strong>${escapeHtml(comparableLabel(row))}</strong></td><td>${escapeHtml(fmtPct(row.similarity_score))}</td><td>${escapeHtml(titleCase(row.after_window_summary))}</td><td>${replayBasisList(row.match_reasons || [])}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-next"><a class="primary" href="${escapeHtml(behaviorScopedHref("/outcomes/", requestedScope))}">Check measured followthrough</a>${scoped ? `<a href="${escapeHtml(behaviorScopedHref("/behavior/", requestedScope))}">Adjust market slice</a>` : ""}<a href="/opportunity/">Find markets with similar structure</a><a href="/memory/">Open Memory</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">How to use it</div><h2>History is context, not conviction</h2></div></div><p class="route-caveat">Similarity explains why prior structures may be relevant. Check what matched and what followed before treating an analogue as useful context. Similarity does not validate the current outcome or management path.</p>`;
}

function renderMemory(payload) {
  const data = payload?.data || {};
  const families = Object.entries(data.frequent_condition_families || {})
    .map(([name, count]) => [name, Number(count) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const familyTotal = families.reduce((total, [, count]) => total + count, 0);
  const persistent = Array.isArray(data.persistent_conditions) ? data.persistent_conditions.slice(0, 6) : [];
  const transitions = Number(data.transition_frequency);
  const transitionLabel = Number.isFinite(transitions) && transitions === 0
    ? "No family transitions recorded"
    : Number.isFinite(transitions)
      ? `${fmtNumber(transitions)} transitions recorded`
      : "Transition count unavailable";
  const dominant = memoryFamilyLabel(data.dominant_condition_family);
  document.getElementById("routeHeadline").textContent = `${dominant} in the recent memory window.`;
  document.getElementById("routeHeroSummary").textContent = "Memory measures recurrence and persistence across recent public observations. It does not invent historical analogues or imply that repetition predicts the next move.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Most common condition", dominant),
    routeStateCard("Consistency trend", titleCase(data.consistency_trend || FORMING_TEXT)),
    routeStateCard("Condition stability", titleCase(data.condition_stability || FORMING_TEXT)),
    routeStateCard("Memory window", data.window_hours ? `${fmtNumber(data.window_hours)}h` : FORMING_TEXT),
    routeStateCard("Family appearances", fmtNumber(familyTotal)),
    routeStateCard("Transitions", Number.isFinite(transitions) ? fmtNumber(transitions) : "Unavailable"),
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Recurrence profile</div><h2>What Raven keeps seeing</h2></div><span class="route-pill historical_observation">Recent memory</span></div>
    <section class="memory-thesis">
      <span>Most frequent condition</span>
      <h3>${escapeHtml(dominant)}</h3>
      <p>${escapeHtml(`${fmtNumber(families[0]?.[1] || 0)} of ${fmtNumber(familyTotal)} recorded family appearances carry this condition. Frequency is context, not confirmation.`)}</p>
    </section>
    <div class="memory-family-list" aria-label="Recent condition-family frequency">
      ${families.map(([name, count]) => {
        const shareFraction = familyTotal > 0 ? Math.max(0, Math.min(1, count / familyTotal)) : 0;
        return `<div class="memory-family-row"><div><strong>${escapeHtml(memoryFamilyLabel(name, titleCase(name)))}</strong><span>${escapeHtml(`${fmtNumber(count)} appearances`)}</span></div><div class="memory-family-track" aria-label="${escapeHtml(fmtPct(shareFraction))} of recent family appearances"><i style="width:${(shareFraction * 100).toFixed(2)}%"></i></div><b>${escapeHtml(fmtPct(shareFraction))}</b></div>`;
      }).join("")}
    </div>
    <div class="route-next"><a class="primary" href="/discover/">Find current opportunities</a><a href="/replay/">Check similar history</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Persistence ledger</div><h2>What has held through the window</h2></div></div>
    <div class="memory-transition"><span>Transition read</span><strong>${escapeHtml(transitionLabel)}</strong><small>${escapeHtml(`${titleCase(data.condition_stability || "forming")} conditions · ${titleCase(data.consistency_trend || "forming")} consistency`)}</small></div>
    <div class="route-continuity-list">
      ${persistent.length ? persistent.map((row) => `<div><span>Persistent</span><strong>${escapeHtml(memoryConditionLabel(row.condition_key))}</strong><small>${escapeHtml(`${fmtNumber(row.appearance_count)} appearances in the declared window`)}</small></div>`).join("") : `<div><span>Persistent</span><strong>No persistent public condition published</strong><small>RavenOS will not infer one.</small></div>`}
    </div>
    ${(data.cards || []).slice(0, 2).map((card) => `<article class="memory-watch"><span>What to watch</span><h3>${escapeHtml(memoryFamilyLabel(card.title || "Memory card", "Market memory"))}</h3><p>${escapeHtml(traderText(card.what_to_watch || card.summary || "Current memory context is forming."))}</p></article>`).join("")}
    <div class="route-boundary"><span>Memory boundary</span><strong>Recurrence is not similarity, causality, or a forecast.</strong></div>
  `;
}

function currentBehaviorProjection(payload) {
  const delivery = payload?.delivery || {};
  if (
    payload?.ok === true
    && payload?.schema_version === "ravenos.customer_intelligence_projection.v1"
    && payload?.intelligence_kind === "participants"
    && payload?.access_scope === "free"
    && payload?.advanced === null
    && ["fresh", "delayed"].includes(payload?.provenance?.freshness?.state)
    && ["fresh", "delayed"].includes(delivery.freshness_state)
    && Array.isArray(payload.participation_overview)
    && payload.participation_overview.length <= 6
  ) return { accessScope: "free", projection: payload };
  const data = payload?.data;
  const rows = data?.rows;
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.redaction_policy !== "aggregate_public_market_context_only"
    || payload?.schema_version !== "ravenos_behavior_public_origin_v1"
    || delivery.source !== "current_public_origin"
    || delivery.fallback !== false
    || !["fresh", "delayed"].includes(delivery.freshness_state)
    || data?.schema_version !== "ravenos_participant_heatmap_v0"
    || !Array.isArray(rows)
    || rows.some((row) => row?.public_safe !== true)
    || (data.actor_evidence && data.actor_evidence.public_safe !== true)
  ) return null;
  return { accessScope: "legacy_full", data };
}

function renderBehaviorUnavailable() {
  hideBehaviorExplorer();
  document.getElementById("routeHeadline").textContent = "Current Behavior Lab read unavailable.";
  document.getElementById("routeHeroSummary").textContent = "Current market-slice data is incomplete or out of date. Older behavior is not presented as a live read.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Market slices", "Unavailable"),
    routeStateCard("Older data shown", "No"),
    routeStateCard("Wallet identities", "Not shown"),
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Behavior Lab</div><h2>Current market behavior is unavailable</h2></div><span class="route-pill unavailable">Unavailable</span></div><div class="route-unavailable"><strong>Older behavior is not shown as current.</strong><p>RavenOS will restore this view when current, usable market-slice evidence is available.</p></div>`;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Privacy boundary</div><h2>Nothing private substituted</h2></div></div><div class="route-boundary"><span>Aggregate only</span><strong>No wallet identity, label, relationship graph, coordination claim, or smart-money ranking is exposed.</strong></div>`;
}

function renderBehaviorFree(payload, projection) {
  const sourceRows = Array.isArray(projection.participation_overview) ? projection.participation_overview : [];
  const spotRows = sourceRows.filter((row) => {
    const chain = String(row.chain || "").toLowerCase();
    const band = String(row.capitalization_band || "").toLowerCase();
    return chain !== "hyperliquid" && !band.startsWith("perps_");
  });
  const rows = spotRows.length ? spotRows : sourceRows;
  const insights = chooseBehaviorInsights(rows);
  const focus = insights.strongest || insights.broad || rows[0] || null;
  const focusLabel = focus
    ? behaviorSliceLabel(focus)
    : "Market behavior";
  const payoff = currentBehaviorPayoff(payload.participation_payoff);
  const payoffLeaders = behaviorPayoffLeaders(payoff);
  const freshness = projection.provenance?.freshness?.state || payload.delivery?.freshness_state || "unavailable";
  const baseHeadline = behaviorPayoffHeadline(payoff, focus
    ? `${focusLabel}: ${titleCase(focus.participation_trend || "forming")} participation.`
    : "Behavior Lab is forming.");
  const baseSummary = payoff
    ? "See the strongest and weakest settled followthrough first, then inspect the participation and sample behind each market slice. Mixed or default rates do not create an edge."
    : "Compare current participation across chains, size groups, and time windows. Every slice keeps its usable sample visible; no directional edge is shown without counted outcomes.";
  document.getElementById("routeHeadline").textContent = baseHeadline;
  document.getElementById("routeHeroSummary").textContent = baseSummary;
  const stateStrip = document.getElementById("routeStateStrip");
  stateStrip.dataset.columns = "4";
  stateStrip.innerHTML = [
    routeStateCard("Market slices", fmtNumber(rows.length)),
    routeStateCard("Working", payoffLeaders.working?.subject || "No qualified edge"),
    routeStateCard("Punishing", payoffLeaders.punishing?.subject || "No qualified edge"),
    routeStateCard("Current data", titleCase(freshness)),
  ].join("");

  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Behavior Lab</div><h2>What participation is doing now</h2></div><span class="route-pill ${escapeHtml(statusClass(freshness))}">${escapeHtml(titleCase(freshness))}</span></div>
    <div id="behaviorExplorerPayoff"></div>
    <div id="behaviorExplorerHighlights"></div>
    <div class="behavior-matrix" id="behaviorExplorerMatrix" aria-label="Current market slices"></div>
    <div class="route-next"><a class="primary" href="/discover/">See current opportunities</a><a href="/outcomes/">Check measured followthrough</a><a href="/perps/#perpsIntelligence">Compare perps separately</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Go deeper</div><h2>Compare more behavior in Pro</h2></div><span class="route-pill forming">Pro</span></div>
    <p class="route-summary">Explore more chains, size groups, and time windows without exposing wallet identities.</p>
    <div class="route-continuity-list participant-pro-metadata">
      <div><span>Compare</span><strong>More market slices side by side</strong><small>Chain, size group, and time window</small></div>
      <div><span>Evidence</span><strong>Counted followthrough where available</strong><small>Rates remain attached to their samples</small></div>
      <div><span>Coverage</span><strong>See excluded and unusable observations</strong><small>Missing evidence remains unavailable</small></div>
      <div><span>Workflow</span><strong>Challenge a setup, then return to its chart</strong><small>Broader context never replaces exact-market risk</small></div>
    </div>
    <div class="route-next"><a class="primary" href="https://app.ravenos.xyz/account/intelligence/?view=participants">Open Pro workspace</a><a href="/intelligence/">All Intelligence</a></div>
  `;
  mountBehaviorExplorer(rows, payoff, { detailed: false, freshness, baseHeadline, baseSummary });
}

function renderBehavior(payload) {
  const current = currentBehaviorProjection(payload);
  if (!current) {
    renderBehaviorUnavailable();
    return;
  }
  if (current.accessScope === "free") {
    renderBehaviorFree(payload, current.projection);
    return;
  }
  const data = current.data;
  const allRows = Array.isArray(data.rows) ? data.rows : [];
  const actorEvidence = data.actor_evidence || {};
  const strengthOrder = { strong: 3, mixed: 2, building: 1, weak: 0 };
  const sortedRows = [...allRows].sort((a, b) => {
    const strength = (strengthOrder[b.outcome_strength] || 0) - (strengthOrder[a.outcome_strength] || 0);
    if (strength) return strength;
    return rowUsableSample(b) - rowUsableSample(a);
  });
  const spotRows = sortedRows.filter((row) => {
    const chain = String(row.chain || "").toLowerCase();
    const band = String(row.cap_band || "").toLowerCase();
    return chain !== "hyperliquid" && !band.startsWith("perps_");
  });
  const rows = spotRows.length ? spotRows : sortedRows;
  const insights = chooseBehaviorInsights(rows);
  const focus = insights.strongest || insights.broad || rows[0] || null;
  const limitations = {
    helius_profile_thin: "Some participant profiles remain incomplete.",
    outcome_pending: "Directional follow-through is not yet proven.",
    raw_wallet_redacted: "Raw wallet identities remain private; this surface uses aggregates.",
    stale_sweep_dependency: "Some participant activity has not refreshed yet.",
  };
  const participantFreshness = actorEvidence.actor_evidence_freshness || data.actor_evidence_freshness || "unavailable";
  const participantContextCurrent = evidenceContextIsCurrent(actorEvidence, participantFreshness);
  const actorWarningIds = new Set(["helius_profile_thin", "raw_wallet_redacted", "stale_sweep_dependency"]);
  const currentDataWarnings = (data.warnings || []).filter((item) => participantContextCurrent || !actorWarningIds.has(item));
  const warnings = [...new Set([
    ...currentDataWarnings,
    ...(participantContextCurrent ? actorEvidence.warnings || [] : []),
  ].map((item) => limitations[item] || "A behavior-evidence limitation remains attached to this read."))];
  const focusLabel = focus ? behaviorSliceLabel(focus) : "Market behavior";
  const payoff = currentBehaviorPayoff(payload.participation_payoff);
  const payoffLeaders = behaviorPayoffLeaders(payoff);
  const baseHeadline = behaviorPayoffHeadline(payoff, focus
    ? `${focusLabel}: ${titleCase(focus.trend || "forming")} participation.`
    : "Behavior Lab is forming.");
  const baseSummary = payoff
    ? "See the strongest and weakest measured results first, then inspect current participation by chain and size group. Mixed or default rates do not create an edge."
    : "Compare where participation is broadening, selective, or fading across chains, size groups, and time windows. Directional edge appears only when explicit outcome counts support it.";
  document.getElementById("routeHeadline").textContent = baseHeadline;
  document.getElementById("routeHeroSummary").textContent = baseSummary;
  const stateStrip = document.getElementById("routeStateStrip");
  stateStrip.dataset.columns = "4";
  stateStrip.innerHTML = [
    routeStateCard("Market slices", fmtNumber(rows.length)),
    routeStateCard("Working", payoffLeaders.working?.subject || "No qualified edge"),
    routeStateCard("Punishing", payoffLeaders.punishing?.subject || "No qualified edge"),
    routeStateCard("Wallet-pattern history", participantContextCurrent ? "Current · aggregate" : "Not used because it is old"),
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Market slices</div><h2>What participation is doing now</h2></div><span class="route-pill ${escapeHtml(statusClass(sampleMaturityLabel(rowUsableSample(focus || {}))))}">${escapeHtml(sampleMaturityLabel(rowUsableSample(focus || {})))}</span></div>
    <div id="behaviorExplorerPayoff"></div>
    <div id="behaviorExplorerHighlights"></div>
    <div class="behavior-matrix" id="behaviorExplorerMatrix" aria-label="Current market slices"></div>
    <div class="route-next"><a class="primary" href="/discover/">See current opportunities</a><a href="/outcomes/">Check measured results</a><a href="/perps/#perpsIntelligence">Compare perps separately</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = participantContextCurrent ? `
    <div class="route-panel-head"><div><div class="route-chip-label">Wallet-pattern history</div><h2>A separate supporting signal</h2></div><span class="route-pill current">Current</span></div>
    <section class="participant-ledger">
      <div><span>Wallets sampled</span><strong>${escapeHtml(fmtNumber(actorEvidence.actor_count ?? data.actor_count))}</strong><small>Aggregate snapshot</small></div>
      <div><span>Cohorts tracked</span><strong>${escapeHtml(fmtNumber(actorEvidence.cohort_count ?? data.cohort_count))}</strong><small>Grouped without wallet labels</small></div>
      <div><span>Recurring wallets</span><strong>${escapeHtml(fmtNumber(actorEvidence.repeat_actor_count ?? data.repeat_actor_count))}</strong><small>Recurrence without identity disclosure</small></div>
      <div><span>Large-move overlap</span><strong>${escapeHtml(fmtNumber(actorEvidence.actor_backed_big_moves ?? data.actor_backed_big_moves))}</strong><small>Descriptive overlap, not causal attribution</small></div>
      <div><span>Reached +10% after observation</span><strong>${escapeHtml(fmtNumber(actorEvidence.actual_mfe10_count ?? data.actual_mfe10_count))}</strong><small>Observed path evidence</small></div>
      <div><span>Reached +25% after observation</span><strong>${escapeHtml(fmtNumber(actorEvidence.actual_mfe25_count ?? data.actual_mfe25_count))}</strong><small>Not capturable performance</small></div>
    </section>
    <div class="participant-read"><span>Repeated activity</span><strong>${escapeHtml(traderText(actorEvidence.public_read_label || data.public_read_label, "Repeated activity is forming."))}</strong><p>Measured ${escapeHtml(fmtWhen(actorEvidence.observed_at || data.generated_at))}. This market-wide pattern can challenge a setup; it does not identify a wallet or prove involvement in an exact market.</p></div>
    <ul class="route-limitations">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <div class="route-boundary"><span>What stays private</span><strong>No wallet names, labels, ownership claims, relationship graphs, coordination claims, or “smart money” ranking.</strong></div>
  ` : `
    <div class="route-panel-head"><div><div class="route-chip-label">Wallet-pattern history</div><h2>Not used in today’s result</h2></div><span class="route-pill unavailable">Not used</span></div>
    <div class="route-unavailable"><strong>Today’s market activity is current; this supporting history is not.</strong><p>Last measured ${escapeHtml(fmtWhen(actorEvidence.observed_at))}. Older wallet-pattern counts are hidden and do not affect the headline, strongest market group, weakest market group, or directional edge.</p></div>
    <ul class="route-limitations">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <div class="route-boundary"><span>What stays private</span><strong>No wallet names, labels, ownership claims, relationship graphs, coordination claims, or “smart money” ranking.</strong></div>
  `;
  mountBehaviorExplorer(rows, payoff, {
    detailed: true,
    freshness: payload.delivery?.freshness_state || "current",
    baseHeadline,
    baseSummary,
  });
}

function renderResearch(payload) {
  const data = payload?.data?.research_state ? payload.data : payload || {};
  const state = data.research_state || "unavailable";
  const summary = data.data?.summary || {};
  const generatedAt = data.generated_at || data.latest_completed_cohort?.completed_at || null;
  const generatedMs = generatedAt ? new Date(generatedAt).getTime() : Number.NaN;
  const ageSeconds = Number.isFinite(generatedMs) ? Math.max(0, (Date.now() - generatedMs) / 1000) : Number.POSITIVE_INFINITY;
  const freshnessTarget = Number(payload?.freshness_target_seconds || 900);
  const deliveryState = payload?.delivery?.freshness_state || "unavailable";
  const stale = data.stale === true
    || ageSeconds > freshnessTarget
    || ["stale", "unavailable"].includes(String(deliveryState).toLowerCase());
  const currentAvailable = !stale && state !== "unavailable" && Boolean(generatedAt);
  const archiveDate = generatedAt ? fmtWhen(generatedAt) : "No archived snapshot";

  if (!currentAvailable) {
    document.getElementById("routeHeadline").textContent = "Current research snapshot unavailable.";
    document.getElementById("routeHeroSummary").textContent = `The last completed research snapshot is dated ${archiveDate}. RavenOS keeps it clearly archived and does not use it as current intelligence.`;
    document.getElementById("routeStateStrip").innerHTML = [
      routeStateCard("Research state", "Unavailable"),
      routeStateCard("Archived snapshot", archiveDate),
      routeStateCard("Archived findings", fmtOptionalNumber(data.findings_count ?? summary.findings_reviewed)),
      routeStateCard("Archived sample", fmtOptionalNumber(data.sample_depth?.value ?? summary.sample_depth)),
      routeStateCard("Archived open observations", fmtOptionalNumber(data.forward_observations ?? summary.forward_observations)),
      routeStateCard("Current narrator", "Not used"),
    ].join("");
    document.getElementById("routePrimaryPanel").innerHTML = `
      <div class="route-panel-head"><div><div class="route-chip-label">Research availability</div><h2>No stale research presented as live</h2></div><span class="route-pill unavailable">Unavailable</span></div>
      <div class="research-unavailable">
        <span>The available research is too old</span>
        <h3>Research remains off until a new evidence-backed update is ready.</h3>
        <p>The archived cohort below can explain what Raven measured at that time. It cannot describe today, unlock a plan, rank an opportunity, or substitute for current opportunities and followthrough.</p>
      </div>
      <section class="research-archive" aria-label="Archived research record">
        <header><span>Archived record · ${escapeHtml(archiveDate)}</span><strong>Historical context only</strong></header>
        <dl>
          <div><dt>Strongest archived condition</dt><dd>${escapeHtml(traderSurfaceLabel(summary.strongest_condition || data.latest_completed_cohort?.strongest_condition || "Unavailable"))}</dd></div>
          <div><dt>Weakest archived condition</dt><dd>${escapeHtml(traderSurfaceLabel(summary.weakest_condition || data.latest_completed_cohort?.weakest_condition || "Unavailable"))}</dd></div>
          <div><dt>Findings reviewed</dt><dd>${escapeHtml(fmtOptionalNumber(data.findings_count ?? summary.findings_reviewed))}</dd></div>
          <div><dt>Observation sample</dt><dd>${escapeHtml(`${fmtOptionalNumber(data.sample_depth?.value ?? summary.sample_depth)} ${text(data.sample_depth?.unit, "archived observations")}`)}</dd></div>
          <div><dt>Validation window</dt><dd>${escapeHtml(data.validation_window?.label || "Unavailable")}</dd></div>
          <div><dt>Current authority</dt><dd>None</dd></div>
        </dl>
      </section>
      <div class="route-next"><a class="primary" href="/discover/">Open current Discover</a><a href="/outcomes/">Inspect followthrough</a></div>
    `;
    document.getElementById("routeSecondaryPanel").innerHTML = `
      <div class="route-panel-head"><div><div class="route-chip-label">What Raven needs</div><h2>Before the next research read</h2></div></div>
      <div class="route-continuity-list">
        <div><span>Current research</span><strong>A fresh completed study</strong><small>Finished within Raven’s current-data window</small></div>
        <div><span>Original inputs</span><strong>The evidence at the time is preserved</strong><small>Later data is never rewritten into an earlier read</small></div>
        <div><span>Later result</span><strong>Measured after the stated window</strong><small>Unfinished observations remain clearly open</small></div>
        <div><span>Raven read</span><strong>A clear current takeaway</strong><small>Market-level evidence only; no wallet identities</small></div>
      </div>
      <div class="route-boundary"><span>Current data required</span><strong>Raven Read and Plan Preview remain hidden when current research is unavailable.</strong></div>
    `;
    return;
  }

  document.getElementById("routeHeadline").textContent = traderText(summary.strongest_condition, "Current research snapshot unavailable");
  document.getElementById("routeHeroSummary").textContent = summary.caveat || "Research is evidence context only. It explains behavioral observations, uncertainty, and what still needs evidence.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Research state", titleCase(state)),
    routeStateCard("Findings reviewed", fmtNumber(summary.findings_reviewed)),
    routeStateCard("Open observations", fmtNumber(summary.forward_observations)),
    routeStateCard("Sample", summary.sample_depth ? fmtNumber(summary.sample_depth) : "No zero should be interpreted as measured evidence")
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Latest Completed Research Cohort</div><h2>Research Product State</h2></div></div>
    <p class="route-summary">${escapeHtml(traderText(summary.strongest_condition, "Current research snapshot unavailable"))}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Weakest condition", traderText(summary.weakest_condition))}
      ${summaryMetric("Evidence", data.source ? "Raven research feed" : "last known research snapshot")}
      ${summaryMetric("Validation window", data.validation_window?.label || "pending")}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Open current opportunity</a><a href="/outcomes/">Check followthrough</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Open observations</div><h2>What Is Still Forming</h2></div></div><p class="route-caveat">${escapeHtml(data.current_forming_cohort?.expected_validation_window ? `Open observations remain unsettled. Next validation window: ${data.current_forming_cohort.expected_validation_window}.` : "No safe completed or forming research cohort is currently available.")}</p>`;
}

function renderPerps(payload) {
  const data = payload?.data || {};
  const grouped = data.outcome_attribution?.grouped?.instrument_group || [];
  const pressureRows = data.outcome_attribution?.grouped?.pressure_bucket || [];
  const topVolume = data.tables?.top_volume || [];
  const summary = data.summary || {};
  const top = grouped[0];
  const topPressure = pressureRows[0] || {};
  const actorEvidence = data.actor_evidence || {};
  const actorContextCurrent = evidenceContextIsCurrent(actorEvidence, data.actor_evidence_freshness);
  const pressureBucket = traderText(topPressure.group || top?.group || "pressure").replace(/\s+pressure$/i, "");
  document.getElementById("routeHeadline").textContent = `Perps pressure remains ${pressureBucket.toLowerCase()}.`;
  document.getElementById("routeHeroSummary").textContent = `${titleCase(pressureBucket)} pressure is the largest current bucket across ${fmtNumber(summary.markets_observed)} markets. Forward evidence remains attached to its sample size; recurring-wallet context is used only when current.`;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Venue", "Hyperliquid Perps"),
    routeStateCard("Markets observed", fmtNumber(summary.markets_observed)),
    routeStateCard("Books observed", fmtNumber(summary.books_observed)),
    routeStateCard("Open observations", fmtNumber(summary.forward_observations || data.forward_observation?.observations)),
    routeStateCard("Matured 12h", fmtNumber(summary.matured_12h_windows || data.forward_observation?.matured_windows?.["12h"])),
    routeStateCard("Websocket messages", fmtNumber(summary.websocket_messages)),
    routeStateCard("Recurring-wallet context", actorContextCurrent ? "Current · aggregate" : "Excluded from this read"),
    routeStateCard("Updated", fmtWhen(data.generated_at))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Perps context</div><h2>Current perps read</h2></div></div>
    <p class="route-summary">${escapeHtml(document.getElementById("routeHeroSummary").textContent)}</p>
    <div class="route-card-grid dense" style="margin-bottom:12px;">
      ${summaryMetric("Markets observed", fmtNumber(summary.markets_observed))}
      ${summaryMetric("Dominant pressure bucket", titleCase(pressureBucket))}
      ${summaryMetric("Books observed", fmtNumber(summary.books_observed))}
      ${summaryMetric("Forward sample", sampleMaturityLabel(summary.forward_observations || data.forward_observation?.observations))}
      ${summaryMetric("What remains open", "More matured observations and friction-aware followthrough")}
      ${summaryMetric("Recurring-wallet context", actorContextCurrent ? "Current · aggregate" : "Excluded because it is stale")}
    </div>
    <div class="route-table-wrap"><table class="route-table route-perps-table"><thead><tr><th>Pressure bucket</th><th>Read</th><th>Sample</th><th>Path range</th></tr></thead><tbody>${
      pressureRows.slice(0, 8).map((row) => `<tr><td><strong>${escapeHtml(row.group)}</strong><br>${escapeHtml(row.label)}</td><td>${escapeHtml(traderText(row.read))}</td><td>${escapeHtml(`${fmtNumber(row.sample_size)} observations · ${titleCase(row.confidence)}`)}</td><td>${escapeHtml(`${fmtNumber(row.median_max_favorable_movement_pct)}% favorable / ${fmtNumber(row.median_max_adverse_movement_pct)}% adverse`)}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-mobile-card-list route-perps-cards">${
      pressureRows.slice(0, 8).map((row) => `<article class="route-mobile-card"><h3>${escapeHtml(row.group)}</h3><p>${escapeHtml(traderText(row.read))}</p><div><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(`${fmtNumber(row.sample_size)} observations · ${titleCase(row.confidence)}`)}</strong></div><div><span>Path range</span><strong>${escapeHtml(`${fmtNumber(row.median_max_favorable_movement_pct)}% favorable / ${fmtNumber(row.median_max_adverse_movement_pct)}% adverse`)}</strong></div></article>`).join("")
    }</div>
    <div class="route-next"><a class="primary" href="/terminal/">Open Perps Terminal context</a><a href="/outcomes/">View outcome status</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Market Tables</div><h2>Volume and Book Context</h2></div></div>
    <div class="route-card-grid" style="margin-bottom:12px;">
      ${grouped.slice(0, 3).map((row) => summaryMetric(`${row.group} · ${row.label}`, traderText(`${row.read} · ${fmtNumber(row.sample_size)} observations`))).join("")}
    </div>
    <div class="route-table-wrap"><table class="route-table route-perps-table"><thead><tr><th>Symbol</th><th>Volume</th><th>Open interest</th><th>Pressure</th></tr></thead><tbody>${
      topVolume.slice(0, 10).map((row) => `<tr><td><strong>${escapeHtml(row.symbol)}</strong><br>${escapeHtml(row.liquidity_quality || "context")}</td><td>${escapeHtml(`$${fmtNumber(row.day_volume_usd)}`)}</td><td>${escapeHtml(`$${fmtNumber(row.open_interest_usd)}`)}</td><td>${escapeHtml(row.pressure_state || row.pressure_direction || "forming")}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-mobile-card-list route-perps-cards">${
      topVolume.slice(0, 10).map((row) => `<article class="route-mobile-card"><h3>${escapeHtml(row.symbol)}</h3><div><span>Volume</span><strong>${escapeHtml(`$${fmtNumber(row.day_volume_usd)}`)}</strong></div><div><span>Open interest</span><strong>${escapeHtml(`$${fmtNumber(row.open_interest_usd)}`)}</strong></div><div><span>Pressure</span><strong>${escapeHtml(row.pressure_state || row.pressure_direction || "forming")}</strong></div><p>${escapeHtml(row.liquidity_quality || "Perps context forming.")}</p></article>`).join("")
    }</div>
    <p class="route-caveat" style="margin-top:10px;">${escapeHtml(data.legal_caveat || "Perpetual context is a live derivatives read. Use it as pressure context, then compare it with measured followthrough before treating the move as confirmed.")}</p>`;
}

function renderOutcomes(payload) {
  const data = payload?.data || {};
  const requestedScope = behaviorScopeFromUrl();
  const scoped = behaviorScopeActive(requestedScope);
  const allRecent = Array.isArray(data.recent_raven_reads) ? data.recent_raven_reads : [];
  const allOutcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
  const recent = scoped ? allRecent.filter((row) => behaviorScopeMatches(row, requestedScope)) : allRecent;
  const outcomes = scoped ? allOutcomes.filter((row) => behaviorScopeMatches(row, requestedScope)) : allOutcomes;
  const scopeLabel = behaviorScopeLabel(requestedScope);
  const recentTotals = sampleTotals(recent);
  const outcomeTotals = sampleTotals(outcomes);
  const readCounts = recent.reduce((acc, row) => {
    const key = row.current_validation_status || row.settled_result || row.status || "pending";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const outcomeCounts = outcomes.reduce((acc, row) => {
    const key = row.validation_status || row.settled_result || row.status || "insufficient";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const evidenceObserved = outcomeTotals.observed || recentTotals.observed || (scoped ? outcomes.length : data.count) || outcomes.length;
  const readsUnderValidation = (readCounts.pending || 0) + (readCounts.partially_settled || 0);
  const confirmedFollowthrough = outcomeCounts.confirmed || readCounts.confirmed || 0;
  const mixedOrInsufficient = (outcomeCounts.mixed || 0) + (outcomeCounts.insufficient || 0);
  const validationStatus = scoped && !outcomes.length
    ? "No settled match"
    : confirmedFollowthrough > 0
    ? titleCase(data.aggregate_validation_state || "sample forming")
    : "Validation sample forming";
  const confirmedShare = outcomes.length ? (confirmedFollowthrough / outcomes.length) * 100 : 0;
  const mixedCount = outcomeCounts.mixed || 0;
  const insufficientCount = outcomeCounts.insufficient || 0;
  const mixedShare = outcomes.length ? (mixedCount / outcomes.length) * 100 : 0;
  const insufficientShare = outcomes.length ? (insufficientCount / outcomes.length) * 100 : 0;
  const outcomeOrder = { confirmed: 3, mixed: 2, insufficient: 1 };
  const settledRows = [...outcomes].sort((a, b) => {
    const status = (outcomeOrder[b.validation_status] || 0) - (outcomeOrder[a.validation_status] || 0);
    if (status) return status;
    return rowUsableSample(b) - rowUsableSample(a);
  });
  const recentRow = (row) => {
    const status = row.current_validation_status || row.settled_result || row.status || "pending";
    const claimHref = row.claim_id ? claimLink(row.claim_id) : "";
    const sourceHref = sourceRouteForSurface(row.surface, row);
    return `<tr>
      <td><strong>${escapeHtml(traderText(row.headline || row.public_read || "Read forming"))}</strong><span>${escapeHtml(titleCase(row.surface || "read"))}</span></td>
      <td><span class="route-pill ${statusClass(status)}">${escapeHtml(titleCase(status))}</span><small>${escapeHtml(traderText(row.plain_language_status || row.public_summary, "Validation context is forming."))}</small></td>
      <td><strong>${escapeHtml(traderText(row.expected_validation_window || row.observation_window?.label || "pending"))}</strong><span>${escapeHtml(fmtWhen(row.issued_at))}</span></td>
      <td><strong>${escapeHtml(traderText(sampleLabel(row.sample), "evidence forming"))}</strong><span>${escapeHtml(titleCase(row.settled_result || status))}</span></td>
      <td><a class="route-open-link" href="${claimHref || sourceHref}">${claimHref ? "Evidence" : "Context"} →</a></td>
    </tr>`;
  };
  const settledRow = (row) => {
    const status = row.validation_status || row.participant_outcome || "insufficient";
    const scope = traderSurfaceLabel(`${titleCase(row.chain || "market")} · ${capBandLabel(row.cap_band)}`);
    const claimHref = row.claim_id ? claimLink(row.claim_id) : "";
    return `<tr>
      <td><strong>${escapeHtml(scope)}</strong><span>${escapeHtml(row.window || "declared window")}</span></td>
      <td><span class="route-pill ${statusClass(status)}">${escapeHtml(titleCase(status))}</span><small>${escapeHtml(titleCase(row.direction || "mixed"))} direction</small></td>
      <td><strong>${escapeHtml(`${fmtNumber(rowUsableSample(row))} / ${fmtNumber(rowObservedSample(row))}`)}</strong><span>${escapeHtml(traderText(row.sample_detail?.unit || "observations"))}</span></td>
      <td><strong>${escapeHtml(fmtOptionalPct(row.median_move_pct))}</strong><span>${escapeHtml(`${fmtOptionalPct(row.rewarding_pct)} rewarding · ${fmtOptionalPct(row.punishing_pct)} punishing`)}</span></td>
      <td><strong>${escapeHtml(fmtOptionalUsd(row.total_liquidity_usd))}</strong><span>${escapeHtml(titleCase(row.confidence || "forming"))} confidence</span></td>
      <td>${claimHref ? `<a class="route-open-link" href="${claimHref}">Evidence →</a>` : `<span>Evidence details unavailable</span>`}</td>
    </tr>`;
  };
  const settledMobileCard = (row) => {
    const status = row.validation_status || row.participant_outcome || "insufficient";
    const claimHref = row.claim_id ? claimLink(row.claim_id) : "";
    return `<article class="route-mobile-card route-outcome-card"><header><div><span>${escapeHtml(row.window || "declared window")}</span><h3>${escapeHtml(traderSurfaceLabel(`${titleCase(row.chain || "market")} · ${capBandLabel(row.cap_band)}`))}</h3></div>${claimHref ? `<a href="${claimHref}">Evidence →</a>` : ""}</header><dl><div><dt>Outcome</dt><dd>${escapeHtml(titleCase(status))}</dd></div><div><dt>Sample</dt><dd>${escapeHtml(`${fmtNumber(rowUsableSample(row))} / ${fmtNumber(rowObservedSample(row))} usable`)}</dd></div><div><dt>Median move</dt><dd>${escapeHtml(fmtOptionalPct(row.median_move_pct))}</dd></div><div><dt>Reward / punish</dt><dd>${escapeHtml(`${fmtOptionalPct(row.rewarding_pct)} / ${fmtOptionalPct(row.punishing_pct)}`)}</dd></div></dl></article>`;
  };
  const recentMobileCard = (row) => {
    const status = row.current_validation_status || row.settled_result || row.status || "pending";
    const href = row.claim_id ? claimLink(row.claim_id) : sourceRouteForSurface(row.surface, row);
    return `<article class="route-mobile-card route-outcome-card">
      <header><div><span>${escapeHtml(titleCase(row.surface || "read"))}</span><h3>${escapeHtml(traderText(row.headline || row.public_read || "Read forming"))}</h3></div><a href="${href}">Inspect →</a></header>
      <p>${escapeHtml(traderText(row.plain_language_status || row.public_summary, "Validation context is forming."))}</p>
      <dl><div><dt>Status</dt><dd>${escapeHtml(titleCase(status))}</dd></div><div><dt>Window</dt><dd>${escapeHtml(traderText(row.expected_validation_window || row.observation_window?.label || "pending"))}</dd></div><div><dt>Sample</dt><dd>${escapeHtml(traderText(sampleLabel(row.sample), "evidence forming"))}</dd></div></dl>
    </article>`;
  };
  const initialMobileReads = recent.slice(0, 4);
  const moreMobileReads = recent.slice(4);
  document.getElementById("routeHeadline").textContent = scoped ? `Followthrough for ${scopeLabel}.` : "Did earlier Raven reads follow through?";
  document.getElementById("routeHeroSummary").textContent = scoped
    ? "Only reads and settled outcomes matching this market slice are counted. Broader chains, cohorts, and windows are not substituted."
    : "Followthrough tracks what happened after earlier Raven reads reached their declared measurement window. Live observations remain open until then.";
  document.getElementById("routeStateStrip").innerHTML = [
    ...(scoped ? [routeStateCard("Requested slice", scopeLabel)] : []),
    routeStateCard("Evidence observed", `${fmtNumber(evidenceObserved)} observations`),
    routeStateCard("Reads under validation", fmtNumber(readsUnderValidation)),
    routeStateCard("Settled outcomes", fmtNumber(outcomes.length)),
    routeStateCard("Confirmed followthrough", fmtNumber(confirmedFollowthrough)),
    routeStateCard("Mixed / insufficient", fmtNumber(mixedOrInsufficient)),
    routeStateCard("Validation status", validationStatus)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Outcome proof</div><h2>${escapeHtml(scoped ? scopeLabel : "What happened after Raven issued the read")}</h2></div><span class="route-pill ${statusClass(scoped && !outcomes.length ? "unavailable" : data.aggregate_validation_state)}">${escapeHtml(validationStatus)}</span></div>
    <section class="outcome-proof-statement"><span>Confirmed followthrough</span><h3>${escapeHtml(`${fmtNumber(confirmedFollowthrough)} of ${fmtNumber(outcomes.length)} settled checks`)}</h3><p>${escapeHtml(scoped && !outcomes.length ? "No settled outcome matches every requested slice dimension. RavenOS did not count a broader market result. Live observations are not outcomes." : `Mixed or insufficient evidence still accounts for ${fmtNumber(mixedOrInsufficient)} checks. The outcome loop is active, but validation is still developing. Live observations are not outcomes.`)}</p></section>
    <div class="outcome-distribution" aria-label="Settled outcome distribution">
      <div class="outcome-distribution-track"><i class="confirmed" style="width:${confirmedShare.toFixed(2)}%"></i><i class="mixed" style="width:${mixedShare.toFixed(2)}%"></i><i class="insufficient" style="width:${insufficientShare.toFixed(2)}%"></i></div>
      <div class="outcome-distribution-legend"><span><i class="confirmed"></i>Confirmed <strong>${escapeHtml(fmtNumber(confirmedFollowthrough))}</strong></span><span><i class="mixed"></i>Mixed <strong>${escapeHtml(fmtNumber(mixedCount))}</strong></span><span><i class="insufficient"></i>Insufficient <strong>${escapeHtml(fmtNumber(insufficientCount))}</strong></span></div>
    </div>
    <div class="route-card-grid dense outcome-funnel-compact" style="margin:12px 0;">
      ${summaryMetric("Evidence observed", `${fmtNumber(evidenceObserved)} observations`)}
      ${summaryMetric("Reads tracked", fmtNumber(recent.length))}
      ${summaryMetric("Pending validation", fmtNumber(readsUnderValidation))}
      ${summaryMetric("Settled outcomes", fmtNumber(outcomes.length))}
      ${summaryMetric("Confirmed followthrough", fmtNumber(confirmedFollowthrough))}
      ${summaryMetric("Mixed / insufficient", fmtNumber(mixedOrInsufficient))}
    </div>
    <div class="route-panel-head"><div><div class="route-chip-label">Read tracker</div><h2>Current claims moving through validation</h2></div></div>
    ${recent.length ? `<div class="route-table-wrap route-outcome-table"><table class="route-table"><thead><tr><th>Read</th><th>Validation</th><th>Window</th><th>Sample</th><th></th></tr></thead><tbody>${recent.slice(0, 12).map(recentRow).join("")}</tbody></table></div><div class="route-mobile-card-list">${initialMobileReads.map(recentMobileCard).join("")}${moreMobileReads.length ? `<details class="route-mobile-more"><summary>Show ${escapeHtml(fmtNumber(moreMobileReads.length))} more reads</summary><div>${moreMobileReads.map(recentMobileCard).join("")}</div></details>` : ""}</div>` : `<p class="route-caveat">No current reads are available.</p>`}
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Settled evidence</div><h2>Measured cohort checks</h2></div></div>
    <div class="outcome-lesson"><span>How it is measured</span><strong>Observation → Raven read → declared window → measured result</strong><p>A read remains open until its declared future window can be measured. Open observations are never counted as followthrough.</p></div>
    ${settledRows.length ? `<div class="route-table-wrap route-outcome-table"><table class="route-table route-settled-table"><thead><tr><th>Surface</th><th>Outcome</th><th>Usable / observed</th><th>Median / tails</th><th>Liquidity</th><th></th></tr></thead><tbody>${settledRows.slice(0, 12).map(settledRow).join("")}</tbody></table></div><div class="route-mobile-card-list">${settledRows.slice(0, 8).map(settledMobileCard).join("")}</div>` : `<div class="route-unavailable"><strong>No settled outcome for this exact slice</strong><p>Broader outcome rows remain excluded. Change the Behavior filters to inspect another aggregate slice.</p></div>`}
    <div class="route-boundary"><span>Performance boundary</span><strong>Post-observation movement is descriptive evidence, not capturable return, a target, or an executable plan.</strong></div>
    <p class="route-caveat">${escapeHtml(scoped ? "Outcome coverage reflects only the requested market slice and its stated sample." : data.population_note || "Outcome coverage reflects the stated public sample.")}</p>
    ${scoped ? `<div class="route-next"><a class="primary" href="${escapeHtml(behaviorScopedHref("/replay/", requestedScope))}">Check similar history</a><a href="${escapeHtml(behaviorScopedHref("/behavior/", requestedScope))}">Change Behavior filters</a></div>` : ""}
  `;
}

function renderClaimsList(payload) {
  const data = payload?.data || {};
  const claims = Array.isArray(data.current_claims) && data.current_claims.length ? data.current_claims : (data.claim_history || []).slice(0, 12);
  document.getElementById("routeHeadline").textContent = "The original reads behind measured followthrough.";
  document.getElementById("routeHeroSummary").textContent = "Read history preserves what Raven said at the time so later followthrough can be judged against the original wording.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Current claims", fmtNumber((data.current_claims || []).length)),
    routeStateCard("History", fmtNumber((data.claim_history || []).length)),
    routeStateCard("Observations", fmtNumber((data.claim_observations || []).length)),
    routeStateCard("Outcome checks", fmtNumber((data.claim_settlements || []).length))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Read Evidence</div><h2>Original Issued Reads</h2></div></div>
    <div class="route-proof-grid">${claims.map((row) => proofCard(row)).join("")}</div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">How to use read history</div><h2>Start from followthrough</h2></div></div>
    <p class="route-caveat">Use a read reference when you need the original wording, later evidence, supersession, and measured status.</p>
    <div class="route-next"><a class="primary" href="/outcomes/">Open followthrough</a><a href="/opportunity/">Open current opportunities</a></div>
  `;
}

function renderClaimDetail(payload) {
  const { claim, observations = [], settlements = [], related_recent_reads = [] } = payload || {};
  if (!claim) {
    renderClaimsList({ data: { current_claims: [] } });
    document.getElementById("routeHeadline").textContent = "Raven read unavailable.";
    document.getElementById("routeHeroSummary").textContent = "That Raven read could not be found in the currently available history.";
    return;
  }
  document.getElementById("routeHeadline").textContent = traderText(claim.headline, "Read detail");
  document.getElementById("routeHeroSummary").textContent = traderText(claim.summary, "Evidence detail.");
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Read ID", claim.claim_id),
    routeStateCard("Origin read", claim.origin_claim_id || claim.claim_id),
    routeStateCard("Surface", titleCase(claim.surface || "read")),
    routeStateCard("Status", titleCase(claim.validation_status || "pending"))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Original read</div><h2>Issued read snapshot</h2></div>${claim.validation_status ? `<span class="route-pill ${statusClass(claim.validation_status)}">${escapeHtml(titleCase(claim.validation_status))}</span>` : ""}</div>
    <div class="route-key-grid">
      ${summaryMetric("Read key", claim.claim_key)}
      ${summaryMetric("Issued", fmtWhen(claim.issued_at))}
      ${summaryMetric("Origin read", claim.origin_claim_id || claim.claim_id)}
      ${summaryMetric("Supersedes", claim.supersedes_claim_id || "first read")}
      ${summaryMetric("Validation window", claim.expected_validation_window || "pending")}
      ${summaryMetric("Market scope", marketScopeLabel(claim))}
      ${summaryMetric("Window", traderText(claim.observation_window?.label))}
      ${summaryMetric("Confidence at issue", titleCase(claim.confidence?.label || FORMING_TEXT))}
    </div>
    <p class="route-summary" style="margin-top:12px;">${escapeHtml(traderText(claim.summary, "No market summary was recorded for this read."))}</p>
    <div class="route-next"><a class="primary" href="/outcomes/">Open followthrough</a><a href="${sourceRouteForSurface(claim.surface, claim)}">Open source page</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Observation Timeline</div><h2>What Changed Later</h2></div></div>
    <div class="route-timeline">
      ${observations.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Observation</div><h3>${escapeHtml(fmtWhen(row.observed_at))}</h3><p class="route-copy">${escapeHtml(row.note || titleCase(row.current_validation_status || "evidence update"))}</p></article>`).join("")}
      ${settlements.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Outcome</div><h3>${escapeHtml(fmtWhen(row.settled_at))}</h3><p class="route-copy">${escapeHtml(row.outcome?.public_summary || titleCase(row.settlement_status || "settled"))}</p></article>`).join("")}
      ${related_recent_reads.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Followthrough</div><h3>${escapeHtml(titleCase(row.current_validation_status || "pending"))}</h3><p class="route-copy">${escapeHtml(row.plain_language_status || "Measured followthrough is attached to this read.")}</p></article>`).join("")}
    </div>
  `;
}

function renderChain(payload) {
  const data = payload || {};
  const label = data.chain_label || routeConfig.title;
  document.getElementById("routeHeadline").textContent = traderText(data.current_summary, `${label} coverage is developing.`);
  document.getElementById("routeHeroSummary").textContent = traderText(data.current_read, "Raven combines aggregate behavior, similar history, memory, and followthrough when current market data is available.");
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Coverage", titleCase(data.coverage || "developing")),
    routeStateCard("Best surface", traderSurfaceLabel(titleCase(data.best_surface || FORMING_TEXT))),
    routeStateCard("Weakest surface", traderSurfaceLabel(titleCase(data.weakest_surface || FORMING_TEXT))),
    routeStateCard("Latest settled", titleCase(data.latest_validation?.validation_status || FORMING_TEXT))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Current Chain Read</div><h2>${escapeHtml(label)} Synthesis</h2></div></div>
    <p class="route-summary">${escapeHtml(traderText(data.current_read, "Developing coverage."))}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Behavior context", traderText(data.behavior_context?.plain_language_summary || data.behavior_context?.interpretation))}
      ${summaryMetric("Similar history", traderText(data.replay_context?.public_read))}
      ${summaryMetric("Memory context", traderText(data.memory_context?.title))}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Open ${escapeHtml(label)} in Opportunity</a><a href="/outcomes/">View outcome status</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Read evidence</div><h2>Current and settled context</h2></div></div>
    ${data.current_claim ? proofCard(data.current_claim) : `<p class="route-caveat">No current chain-specific claim is published yet. Verified public behavior and outcomes context remain visible while coverage develops.</p>`}
    ${data.latest_validation ? `<div class="route-proof-grid" style="margin-top:12px;">${proofCard({
      claim_id: data.latest_validation.claim_id,
      headline: `${label} · ${titleCase(data.latest_validation.cap_band || "current")} settled ${titleCase(data.latest_validation.settled_result || data.latest_validation.validation_status || "validation")}.`,
      issued_at: payload.generated_at,
      surface: "chain",
      evidence_role: "settled_validation",
      market_scope: { chain: String(data.chain || ""), cap_band: data.latest_validation.cap_band || null },
      expected_validation_window: data.latest_validation.evidence_contract?.settlement_window?.label || "pending",
      current_validation_status: data.latest_validation.validation_status || "pending",
      settled_result: data.latest_validation.settled_result || data.latest_validation.validation_status || "pending",
      settled_at: data.latest_validation.evidence_contract?.as_of || payload.generated_at,
      sample: data.latest_validation.evidence_contract?.sample || { usable: data.latest_validation.sample_size, unit: "observations" },
      methodology_version: data.latest_validation.evidence_contract?.artifact_version || "public definitions",
      plain_language_status: data.latest_validation.participant_outcome || "Settled validation context is forming."
    })}</div>` : ""}
  `;
}

function renderGeneric(payload) {
  document.getElementById("routeHeadline").textContent = routeConfig.title;
  document.getElementById("routeHeroSummary").textContent = "Current market read is forming.";
  document.getElementById("routeStateStrip").innerHTML = routeStateCard("Status", FORMING_TEXT);
  document.getElementById("routePrimaryPanel").innerHTML = `<p class="route-caveat">Current coverage is not available for this view.</p>`;
  document.getElementById("routeSecondaryPanel").innerHTML = "";
}

function renderDeliveryState(payload = {}) {
  const host = document.getElementById("routeDeliveryState");
  if (!host) return;
  const delivery = payload.delivery || {};
  const state = delivery.freshness_state || payload.data?.source_state || payload.source_state || "unavailable";
  const source = delivery.source || (payload.safe_public === true ? "embedded_snapshot" : "unavailable");
  const fallback = delivery.fallback === true || source === "embedded_snapshot";
  host.dataset.state = state;
  host.dataset.fallback = String(fallback);
  host.innerHTML = `<span>${escapeHtml(titleCase(state))}</span><strong>${escapeHtml(
    source === "current_public_origin"
      ? "Current Raven data"
      : fallback
        ? "Earlier verified snapshot"
        : "Current data unavailable",
  )}</strong><small>${escapeHtml(
    fallback
      ? "Older data is clearly labeled and never shown as current."
      : delivery.source_generated_at
        ? `Source ${fmtWhen(delivery.source_generated_at)}`
        : "Source timestamp unavailable",
  )}</small>`;
}

function syncShellFromRoute(payload = {}) {
  const census = censusFromPayload(payload);
  const rows = Array.isArray(census?.opportunities?.rows) ? census.opportunities.rows : [];
  const retainedSubject = ravenOSContext.getState().subject;
  const hasRetainedSubject = retainedSubject?.id !== "unselected" && retainedSubject?.label !== "No market selected";
  const selectedRow = hasRetainedSubject
    ? rows.find((row) => (
        row?.instrument_id === retainedSubject.id
        || String(row?.instrument || "").toUpperCase() === String(retainedSubject.label || retainedSubject.symbol || "").toUpperCase()
      )) || null
    : null;
  const activeRow = selectedRow || (hasRetainedSubject ? null : rows[0] || null);
  const observedAt = census?.generated_at || payload.generated_at || payload.updated_at || payload.data?.generated_at || null;
  const delivery = payload.delivery || {};
  const fallback = delivery.fallback === true || (!payload.delivery && payload.safe_public === true);
  const headline = document.getElementById("routeHeadline")?.textContent?.trim() || routeConfig.title;
  const summary = document.getElementById("routeHeroSummary")?.textContent?.trim() || "Current evidence is forming.";
  const subject = activeRow
    ? {
        id: activeRow.instrument_id,
        label: activeRow.instrument,
        symbol: activeRow.instrument,
        chain: "hyperliquid",
        venue: "hyperliquid",
        marketType: "perp",
      }
    : retainedSubject;
  if (activeRow) ravenOSContext.setSelection({ subject, detectionId: activeRow.public_opportunity_id || null });
  ravenShell?.setIntelligence?.({
    subject,
    marketState: {
      label: headline,
      direction: activeRow?.observed_direction || "neutral",
      regime: activeRow?.raven_atoms?.[0] || routeConfig.evidence_role || "current evidence",
    },
    setupState: {
      state: census ? "research observation" : routeConfig.funnel_stage || "forming",
      confirmation: census?.source_state || "forming",
    },
    thesis: summary,
    supportingEvidence: census
      ? [
          activeRow?.why_raven_noticed,
          `${fmtNumber(census.population?.paths_with_evidence)} tracked paths have evidence.`,
          `${fmtNumber(census.population?.matured_path_windows)} future-only windows have matured.`,
        ].filter(Boolean)
      : [summary],
    contradictingEvidence: census?.limitations || [],
    invalidation: census
      ? ["Raven does not claim exact followthrough for a row unless the source confirms the match."]
      : [],
    timeHorizon: census ? "declared future-only windows" : routeConfig.funnel_stage === "validate" ? "settled window" : "current window",
    confidence: census ? { label: "research only", sampleSize: census.population?.paths_with_evidence } : { label: "developing" },
    evidenceQuality: {
      state: census?.source_state || (payload.ok === false ? "unavailable" : "forming"),
      lineageComplete: Boolean(activeRow?.source_join?.census_row_joined),
    },
    freshness: {
      state: fallback ? "delayed" : delivery.freshness_state || census?.source_state || "unavailable",
      observedAt,
      liveMaxAgeSeconds: census ? 3600 : 900,
      delayedMaxAgeSeconds: census ? 14400 : 3600,
    },
    generatedAt: observedAt,
    nextExpectedTransition: census
      ? "Review current instrument context, then compare only matured future-only outcomes."
      : "Wait for the next timestamped Raven update.",
  });
  ravenShell?.setCapabilities?.({
    market: fallback ? "Earlier snapshot" : delivery.freshness_state ? `${titleCase(delivery.freshness_state)} Raven data` : "Raven data available",
    wallet: "No session",
    mode: "Read only",
    signing: "Sign off",
    broadcast: "Broadcast off",
    evidence: census ? "Census linked" : "Evidence linked",
  });
}

function renderRoute(payload) {
  renderDeliveryState(payload);
  renderEvidenceStrip(payload);
  const slug = routeConfig.slug;
  if (slug === "brief" || slug === "home") renderBrief(payload);
  else if (slug === "opportunity") renderOpportunity(payload);
  else if (slug === "replay") renderReplay(payload);
  else if (slug === "outcomes") renderOutcomes(payload);
  else if (slug === "claims") renderClaimsList(payload);
  else if (slug === "memory") renderMemory(payload);
  else if (slug === "behavior") renderBehavior(payload);
  else if (slug === "research") renderResearch(payload);
  else if (slug === "perps") renderPerps(payload);
  else if (slug.startsWith("chain-")) renderChain(payload);
  else renderGeneric(payload);
  renderNarratorPanel();
  syncShellFromRoute(payload);
}

async function fetchLivePayload() {
  const endpoint = routeConfig.api_endpoint;
  if (routeConfig.slug === "claims") {
    const claimId = new URL(window.location.href).searchParams.get("id");
    if (claimId) {
      const response = await boundedFetch(`/api/claims/${encodeURIComponent(claimId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`claims_${response.status}`);
      return await response.json();
    }
  }
  const response = await boundedFetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`${routeConfig.slug}_${response.status}`);
  return await response.json();
}

async function fetchFallbackPayload() {
  if (!routeConfig.fallback_artifact) return null;
  const response = await boundedFetch(routeConfig.fallback_artifact, { cache: "no-store" });
  if (!response.ok) throw new Error(`fallback_${response.status}`);
  return await response.json();
}

function renderHydrationState(message) {
  const stateHost = document.getElementById("routeHydrationState");
  if (stateHost) stateHost.textContent = message;
}

async function boundedFetch(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

let initialFallbackPayload = null;

async function renderInitialRoute() {
  if (!routeConfig) return;
  if (routeConfig.fallback_payload) {
    initialFallbackPayload = routeConfig.fallback_payload;
  } else {
    try {
      initialFallbackPayload = await fetchFallbackPayload();
    } catch (error) {
      console.warn(`RavenOS initial artifact hydration failed for ${routeConfig.slug}:`, error);
    }
  }
  if (initialFallbackPayload) renderRoute(initialFallbackPayload);
  renderHydrationState(initialFallbackPayload ? "Verified snapshot" : "Awaiting verified data");
}

async function initRoute() {
  if (!routeConfig) return;
  const [narratorResult, liveResult] = await Promise.allSettled([
    fetchNarratorPayload(),
    fetchLivePayload(),
  ]);

  if (narratorResult.status === "fulfilled" && narratorResult.value) {
    routeNarratorPayload = narratorResult.value;
    ravenShell?.adaptLegacyNarrator?.(routeNarratorPayload, {
      evidenceRole: routeConfig.evidence_role,
      timeHorizon: routeConfig.funnel_stage === "validate" ? "settled window" : "current window",
    });
  } else {
    routeNarratorPayload = null;
    if (narratorResult.status === "rejected") {
      console.warn(`RavenOS narrator hydration failed for ${routeConfig.slug}:`, narratorResult.reason);
    }
  }

  if (liveResult.status === "fulfilled") {
    const payload = liveResult.value;
    renderRoute(payload);
    renderHydrationState(
      payload.delivery?.source === "current_public_origin"
        ? "Current Raven data"
        : payload.delivery?.fallback
          ? "Earlier verified snapshot"
          : "Public API",
    );
    if (routeConfig.slug === "claims" && new URL(window.location.href).searchParams.get("id")) {
      renderClaimDetail(payload);
    }
  } else {
    if (initialFallbackPayload) renderRoute(initialFallbackPayload);
    renderHydrationState("Showing the last verified snapshot");
    renderFallbackMessage(routeConfig.fallback_message || "Showing the last verified snapshot while current data refreshes.");
    console.warn(`RavenOS route hydration failed for ${routeConfig.slug}:`, liveResult.reason);
  }
}

await renderInitialRoute();
await initRoute();
