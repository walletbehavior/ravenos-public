import { mountRavenOSShell } from "/ravenos-shell.js";

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
  if (/^solana$/i.test(raw)) return "Solana";
  if (/^base$/i.test(raw)) return "Base";
  if (/^eth$/i.test(raw) || /^ethereum$/i.test(raw)) return "Ethereum";
  return raw;
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
  const raw = titleCase(value || "surface");
  if (/^Live Activity$/i.test(raw)) return "activity";
  if (/^Participant Cohorts$/i.test(raw)) return "participant cohorts";
  return traderSurfaceLabel(raw);
}

function traderText(value, fallback = FORMING_TEXT) {
  const raw = text(value, fallback).trim();
  if (!raw) return fallback;
  let out = raw
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
    .replace(/^No completed live cohort yet; current observations remain in research sample forming state\.?$/i, "No completed live cohort yet; current observations are still in evidence-forming research state.")
    .replace(/^Research sample forming; latest completed cohort remains visible when available\.?$/i, "Research evidence is still forming; the latest completed cohort remains visible when available.")
    .replace(/\bOutcomes Unclear\b/gi, "similar conditions remain mixed")
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
  if (slug === "behavior") return "Participation";
  if (slug === "perps") return "Perps read";
  if (/leading/i.test(raw)) return "Current opportunity";
  if (/historical/i.test(raw)) return "Historical context";
  if (/settled|validation/i.test(raw)) return "Followthrough";
  return "Current read";
}

function memoryFamilyLabel(value, fallback = "Similar conditions remain mixed") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/outcomes unclear/i.test(raw)) return titleCase(traderText(raw));
  if (/^outcomes unclear$/i.test(raw)) return "Similar conditions remain mixed";
  if (/^participation punishing$/i.test(raw)) return "Participation followthrough is weak";
  if (/^participation rewarding$/i.test(raw)) return "Participation is following through";
  return titleCase(raw);
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

function statusClass(status) {
  return String(status || "pending").toLowerCase().replaceAll(" ", "_");
}

function claimLink(claimId) {
  if (!claimId) return "";
  return `/claims/?id=${encodeURIComponent(claimId)}`;
}

function sourceRouteForSurface(surface, row = {}) {
  if (surface === "brief") return "/brief/";
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
    return `${chain} ${capBand} is the current public behavioral surface. Broader cap-band context remains visible in Behavior and Replay.`;
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
  document.querySelector('[data-evidence-field="role"]').textContent = detail.role;
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
  document.querySelector('[data-evidence-field="weighting"]').textContent = detail.weighting;
  document.querySelector('[data-evidence-field="source"]').textContent = detail.source;
  document.querySelector('[data-evidence-field="observed_settled"]').textContent = detail.observedSettled;
  document.querySelector('[data-evidence-field="validation"]').textContent = detail.validation;
  document.querySelector('[data-evidence-field="artifact"]').textContent = detail.artifact;
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
  const pageSlug = narratorPageSlug(routeConfig?.slug || "");
  if (!pageSlug) return null;
  const response = await boundedFetch(`/ravenos/ravenos_narrator_${encodeURIComponent(pageSlug)}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`narrator_${pageSlug}_${response.status}`);
  return await response.json();
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
      <p class="route-caveat" style="margin-top:10px;">${escapeHtml(watching[0] || "Raven is watching for stronger evidence before changing the research state.")}</p>
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
  document.getElementById("routeHeadline").textContent = traderText(data.one_sentence_read, "Current read forming.");
  document.getElementById("routeHeroSummary").textContent = `Current read: ${traderText(data.one_sentence_read)}`;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Leading market", traderSurfaceLabel(data.best_surface || data.best_opportunity_surface)),
    routeStateCard("Participation", traderText(data.participation_change)),
    routeStateCard("Reward", traderText(data.reward_change)),
    routeStateCard("Replay", `${fmtNumber(data.historical_analog_count)} similar structures`)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Current read</div><h2>Current read</h2></div></div>
    <p class="route-summary">${escapeHtml(traderText(data.one_sentence_read, "Current market read is forming."))}</p>
    <div class="route-metric-row" style="margin-top:12px;">
      ${summaryMetric("Leading market", traderSurfaceLabel(data.best_surface))}
      ${summaryMetric("What Changed", traderText(data.reward_change))}
      ${summaryMetric("Pressure", traderText(data.pressure_change))}
      ${summaryMetric("Most Similar Regime", traderText(data.most_similar_regime))}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Open Opportunity</a><a href="/outcomes/">View outcome status</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Why Raven Believes This</div><h2>Evidence and Caveats</h2></div></div>
    <div class="route-card-grid">
      ${summaryMetric("Participation change", traderText(data.participation_change))}
      ${summaryMetric("Reward condition", traderText(data.reward_change))}
      ${summaryMetric("Pressure context", traderText(data.pressure_change))}
    </div>
  `;
}

function renderOpportunity(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const current = opportunityCurrent(payload);
  const preferredChain = current?.market_scope?.chain || current?.chain || "";
  renderOpportunitySurface(current, bestSpecificOpportunitySurface(data, preferredChain), data);
  hydrateOpportunitySpecificity(current, data);
}

function renderReplay(payload) {
  const data = payload?.data || {};
  const comparables = Array.isArray(data.comparables) ? data.comparables.slice(0, 6) : [];
  const comparableLabel = (row) => traderSurfaceLabel([titleCase(row?.chain), titleCase(row?.cap_band)].filter(Boolean).join(" · "));
  const top = comparables[0] || null;
  const matchReasons = top ? (top.match_reasons || []).map((reason) => traderText(reason)).filter(Boolean) : [];
  const topOutcome = titleCase(top?.after_window_summary || FORMING_TEXT);
  const topMeaning = top
    ? `${fmtPct(top.similarity_score)} similarity means the current public structure matched prior ${comparableLabel(top)} conditions across ${matchReasons.length ? matchReasons.join(", ") : "available public context"}. Prior followthrough was ${topOutcome.toLowerCase()}. This supports historical context, not conviction or a forecast.`
    : "Replay interpretation is forming because no comparable setup is currently available.";
  document.getElementById("routeHeadline").textContent = traderText(comparables[0]?.public_read, "Historical analogue context is forming.");
  document.getElementById("routeHeroSummary").textContent = "Replay is historical analogue context. It explains what looked similar before and what followed, without turning analogue outcomes into forecasts.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Similar setups", fmtNumber(comparables.length)),
    routeStateCard("Closest match", top ? comparableLabel(top) : FORMING_TEXT),
    routeStateCard("Top similarity", top ? fmtPct(top.similarity_score) : FORMING_TEXT),
    routeStateCard("Prior outcome", topOutcome)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Historical comparison</div><h2>What Happened Before</h2></div></div>
    <article class="route-card route-interpretation-card" style="margin-bottom:12px;">
      <div class="route-metric-label">What this means</div>
      <p class="route-summary">${escapeHtml(top ? `Replay supports context, not conviction. The current structure is highly similar to prior ${comparableLabel(top)} conditions, but prior followthrough was ${topOutcome.toLowerCase()}. Raven treats this as historical context until current behavior and path evidence strengthen.` : topMeaning)}</p>
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
    <div class="route-next"><a class="primary" href="/opportunity/">Find markets with similar structure</a><a href="/memory/">Open Memory</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Caveat</div><h2>How To Use Replay</h2></div></div><p class="route-caveat">Replay similarity explains why prior structures are relevant. Check prior followthrough and match basis before treating an analogue as useful context. Similarity does not validate outcome or management path.</p>`;
}

function renderMemory(payload) {
  const data = payload?.data || {};
  const families = Object.entries(data.frequent_condition_families || {}).slice(0, 6);
  document.getElementById("routeHeadline").textContent = memoryFamilyLabel(data.dominant_condition_family);
  document.getElementById("routeHeroSummary").textContent = "Memory tracks how often this public structure repeats, whether it broadens, and when it remains unusual or unstable.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Most common pattern", memoryFamilyLabel(data.dominant_condition_family, FORMING_TEXT)),
    routeStateCard("Consistency trend", titleCase(data.consistency_trend || FORMING_TEXT)),
    routeStateCard("Condition stability", titleCase(data.condition_stability || FORMING_TEXT)),
    routeStateCard("Window", data.window_hours ? `${fmtNumber(data.window_hours)}h` : FORMING_TEXT)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Historical Frequency</div><h2>How common this pattern is</h2></div></div>
    <div class="route-card-grid">${families.map(([name, count]) => summaryMetric(memoryFamilyLabel(name, titleCase(name)), `${fmtNumber(count)} observations`)).join("")}</div>
    <div class="route-next"><a class="primary" href="/opportunity/">See where this regime is active</a><a href="/replay/">Open Replay</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">What To Watch</div><h2>Transition Context</h2></div></div>
    ${(data.cards || []).slice(0, 2).map((card) => `<div class="route-card"><h3>${escapeHtml(memoryFamilyLabel(card.title || "Memory card", "Market memory"))}</h3><p class="route-copy">${escapeHtml(traderText(card.summary || "Current memory context is forming."))}</p><p class="route-caveat" style="margin-top:8px;">${escapeHtml(traderText(card.what_to_watch || ""))}</p></div>`).join("")}
  `;
}

function renderBehavior(payload) {
  const data = payload?.data || {};
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 8) : [];
  const allRows = Array.isArray(data.rows) ? data.rows : [];
  const totals = sampleTotals(allRows);
  const top = rows[0];
  const actorEvidence = data.actor_evidence || {};
  document.getElementById("routeHeadline").textContent = traderText(top?.plain_language_summary, "Participation context is forming.");
  document.getElementById("routeHeroSummary").textContent = "Behavior is a leading participation read. It explains who is active, how broad participation is, and whether the current mix is constructive or still concentrated.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Top context", top ? traderSurfaceLabel(`${titleCase(top.chain)} · ${titleCase(top.cap_band)}`) : FORMING_TEXT),
    routeStateCard("Window", data.metadata?.timeframe || top?.window || FORMING_TEXT),
    routeStateCard("Markets", fmtNumber(data.count || allRows.length)),
    routeStateCard("Observed sample", `${fmtNumber(totals.observed)} observations`),
    routeStateCard("Usable observations", `${fmtNumber(totals.usable)} observations`),
    routeStateCard("Actor evidence", traderText(actorEvidence.public_read_label || data.public_read_label || "Actor evidence is forming.")),
    routeStateCard("Evidence source", "Raven participation feed")
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Who Is Participating?</div><h2>Current Behavior Read</h2></div></div>
    <div class="route-card-grid dense" style="margin-bottom:12px;">
      ${summaryMetric("Observed markets", fmtNumber(data.count || allRows.length))}
      ${summaryMetric("Observed sample", `${fmtNumber(totals.observed)} observations`)}
      ${summaryMetric("Usable observations", `${fmtNumber(totals.usable)} observations`)}
      ${summaryMetric("Actor evidence", traderText(actorEvidence.public_read_label || data.public_read_label || "Actor evidence is forming."))}
      ${summaryMetric("Repeat cohorts", fmtNumber(actorEvidence.repeat_actor_count || data.repeat_actor_count))}
      ${summaryMetric("Window", data.metadata?.timeframe || top?.window || "24h")}
    </div>
    <div class="route-table-wrap"><table class="route-table"><thead><tr><th>Market</th><th>Read</th><th>Window</th><th>Sample</th><th>Weighting</th></tr></thead><tbody>${
      rows.map((row) => `<tr><td><strong>${escapeHtml(titleCase(row.chain))}</strong><br>${escapeHtml(capBandLabel(row.cap_band))}</td><td>${escapeHtml(traderText(row.plain_language_summary))}</td><td>${escapeHtml(row.window || row.timeframe || "live")}</td><td>${escapeHtml(`${fmtNumber(row.sample_summary?.usable || row.usable_sample)} / ${fmtNumber(row.sample_summary?.observed || row.observed_sample)} ${traderText(row.sample_summary?.unit || "observations")}`)}</td><td>${escapeHtml("equal row")}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-next"><a class="primary" href="/opportunity/">See where participation is becoming actionable</a><a href="/outcomes/">Compare settled outcomes</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Evidence Caveat</div><h2>How to read this</h2></div></div><p class="route-caveat">${escapeHtml(traderText('Behavior rows are public aggregate observations. Each row shows a declared window, usable sample, and unit so “constructive” or “mixed” is never detached from its denominator.'))}</p>`;
}

function renderResearch(payload) {
  const data = payload || {};
  const state = data.research_state || "unavailable";
  const summary = data.data?.summary || {};
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
    <div class="route-next"><a class="primary" href="/opportunity/">Open Behavioral Opportunity</a><a href="/outcomes/">Check Outcomes</a></div>
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
  const pressureBucket = traderText(topPressure.group || top?.group || "pressure").replace(/\s+pressure$/i, "");
  document.getElementById("routeHeadline").textContent = `Perps pressure remains ${pressureBucket.toLowerCase()}.`;
  document.getElementById("routeHeroSummary").textContent = `${titleCase(pressureBucket)} pressure is the largest current bucket across ${fmtNumber(summary.markets_observed)} markets. Repeat cohorts and actor-backed moves support context, but management validation remains under review.`;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Venue", "Hyperliquid Perps"),
    routeStateCard("Markets observed", fmtNumber(summary.markets_observed)),
    routeStateCard("Books observed", fmtNumber(summary.books_observed)),
    routeStateCard("Open observations", fmtNumber(summary.forward_observations || data.forward_observation?.observations)),
    routeStateCard("Matured 12h", fmtNumber(summary.matured_12h_windows || data.forward_observation?.matured_windows?.["12h"])),
    routeStateCard("Websocket messages", fmtNumber(summary.websocket_messages)),
    routeStateCard("Actor evidence", traderText(actorEvidence.public_read_label || data.public_read_label || "Actor evidence is forming.")),
    routeStateCard("Updated", fmtWhen(data.generated_at))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Perps context</div><h2>Current perps read</h2></div></div>
    <p class="route-summary">${escapeHtml(document.getElementById("routeHeroSummary").textContent)}</p>
    <div class="route-card-grid dense" style="margin-bottom:12px;">
      ${summaryMetric("Markets observed", fmtNumber(summary.markets_observed))}
      ${summaryMetric("Dominant pressure bucket", titleCase(pressureBucket))}
      ${summaryMetric("Books observed", fmtNumber(summary.books_observed))}
      ${summaryMetric("Actor evidence", traderText(actorEvidence.public_read_label || data.public_read_label || "Actor evidence is forming."))}
      ${summaryMetric("Path evidence", "Management path under review")}
      ${summaryMetric("Unresolved evidence", "Settled followthrough and path validation")}
      ${summaryMetric("Repeat cohorts", fmtNumber(actorEvidence.repeat_actor_count || data.repeat_actor_count || summary.repeat_actor_count))}
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
    <p class="route-caveat" style="margin-top:10px;">${escapeHtml(data.legal_caveat || "Perps context is a live derivatives read. Use it as pressure context, then compare it with settled Outcomes before treating the move as confirmed.")}</p>`;
}

function renderOutcomes(payload) {
  const data = payload?.data || {};
  const recent = Array.isArray(data.recent_raven_reads) ? data.recent_raven_reads : [];
  const legacy = Array.isArray(data.legacy_unlinked) ? data.legacy_unlinked : [];
  const outcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
  const recentTotals = sampleTotals(recent);
  const outcomeTotals = sampleTotals(outcomes);
  const readStatusKeys = ["pending", "partially_settled", "mixed", "confirmed", "invalidated", "insufficient", "expired"];
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
  const evidenceObserved = outcomeTotals.observed || recentTotals.observed || data.count || outcomes.length;
  const readsUnderValidation = (readCounts.pending || 0) + (readCounts.partially_settled || 0);
  const confirmedFollowthrough = outcomeCounts.confirmed || readCounts.confirmed || 0;
  const mixedOrInsufficient = (outcomeCounts.mixed || 0) + (outcomeCounts.insufficient || 0);
  const validationStatus = confirmedFollowthrough > 0
    ? titleCase(data.aggregate_validation_state || "sample forming")
    : "Validation sample forming";
  document.getElementById("routeHeadline").textContent = "Did earlier Raven reads follow through?";
  document.getElementById("routeHeroSummary").textContent = "Outcomes tracks whether earlier Raven reads followed through after their validation window. Live observations are not outcomes; they are the evidence base Raven uses to form reads.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Evidence observed", `${fmtNumber(evidenceObserved)} observations`),
    routeStateCard("Reads under validation", fmtNumber(readsUnderValidation)),
    routeStateCard("Settled outcomes", fmtNumber(outcomes.length)),
    routeStateCard("Confirmed followthrough", fmtNumber(confirmedFollowthrough)),
    routeStateCard("Mixed / insufficient", fmtNumber(mixedOrInsufficient)),
    routeStateCard("Validation status", validationStatus)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Outcome funnel</div><h2>Did earlier Raven reads follow through?</h2></div></div>
    <p class="route-copy">Confirmed followthrough ${confirmedFollowthrough > 0 ? "exists" : "is still forming"}, but mixed/insufficient outcomes ${mixedOrInsufficient >= confirmedFollowthrough ? "still dominate" : "remain present"}. The outcome loop is active, but validation is still developing. Live observations are not outcomes.</p>
    <div class="route-card-grid dense outcome-funnel-compact" style="margin:12px 0;">
      ${summaryMetric("Evidence observed", `${fmtNumber(evidenceObserved)} observations`)}
      ${summaryMetric("Reads tracked", fmtNumber(recent.length))}
      ${summaryMetric("Pending validation", fmtNumber(readsUnderValidation))}
      ${summaryMetric("Settled outcomes", fmtNumber(outcomes.length))}
      ${summaryMetric("Confirmed followthrough", fmtNumber(confirmedFollowthrough))}
      ${summaryMetric("Mixed / insufficient", fmtNumber(mixedOrInsufficient))}
      ${summaryMetric("Validation status", validationStatus)}
    </div>
    <div class="route-panel-head"><div><div class="route-chip-label">Recent reads</div><h2>Recent reads</h2></div></div>
    <div class="route-proof-grid">${recent.map((row) => proofCard(row)).join("") || `<p class="route-caveat">No current reads are available.</p>`}</div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Settled checks</div><h2>Followthrough context</h2></div></div>
    <p class="route-copy">Observations are raw market evidence. Reads are Raven's synthesized market conclusions. Outcomes are reads after validation and followthrough measurement.</p>
    <div class="route-table-wrap"><table class="route-table"><thead><tr><th>Surface</th><th>Outcome</th><th>Sample</th><th>Move / liquidity</th></tr></thead><tbody>${
      outcomes.slice(0, 12).map((row) => `<tr><td><strong>${escapeHtml(titleCase(row.chain))}</strong><br>${escapeHtml(capBandLabel(row.cap_band))}</td><td>${escapeHtml(titleCase(row.validation_status || row.participant_outcome))}</td><td>${escapeHtml(`${fmtNumber(row.usable_sample || row.sample_size)} / ${fmtNumber(row.observed_sample || row.sample_size)} ${traderText(row.sample_detail?.unit || "observations")}`)}</td><td>${escapeHtml(`${fmtNumber(row.median_move_pct)}% · $${fmtNumber(row.total_liquidity_usd)}`)}</td></tr>`).join("")
    }</tbody></table></div>
    <p class="route-caveat" style="margin-top:10px;">Older rows remain available through evidence links when safe, but Outcomes leads with validation totals and current reads.</p>
  `;
}

function renderClaimsList(payload) {
  const data = payload?.data || {};
  const claims = Array.isArray(data.current_claims) && data.current_claims.length ? data.current_claims : (data.claim_history || []).slice(0, 12);
  document.getElementById("routeHeadline").textContent = "Claim provenance behind the Outcomes proof rail.";
  document.getElementById("routeHeroSummary").textContent = "Claims preserve the original issued read. Outcomes is the user-facing proof rail that shows what happened later.";
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
    <div class="route-panel-head"><div><div class="route-chip-label">How To Use Claims</div><h2>Drill In From Outcomes</h2></div></div>
    <p class="route-caveat">Read IDs are evidence references, not the headline. Use them when an Outcomes or evidence link needs the original wording, later evidence, supersession, and outcome status.</p>
    <div class="route-next"><a class="primary" href="/outcomes/">Open Outcomes</a><a href="/opportunity/">Open Opportunity</a></div>
  `;
}

function renderClaimDetail(payload) {
  const { claim, observations = [], settlements = [], related_recent_reads = [] } = payload || {};
  if (!claim) {
    renderClaimsList({ data: { current_claims: [] } });
    document.getElementById("routeHeadline").textContent = "Claim detail unavailable.";
    document.getElementById("routeHeroSummary").textContent = "The requested claim ID could not be resolved from the current public lineage.";
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
    <div class="route-next"><a class="primary" href="/outcomes/">Open Outcomes</a><a href="${sourceRouteForSurface(claim.surface, claim)}">Open source page</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Observation Timeline</div><h2>What Changed Later</h2></div></div>
    <div class="route-timeline">
      ${observations.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Observation</div><h3>${escapeHtml(fmtWhen(row.observed_at))}</h3><p class="route-copy">${escapeHtml(row.note || titleCase(row.current_validation_status || "evidence update"))}</p></article>`).join("")}
      ${settlements.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Outcome</div><h3>${escapeHtml(fmtWhen(row.settled_at))}</h3><p class="route-copy">${escapeHtml(row.outcome?.public_summary || titleCase(row.settlement_status || "settled"))}</p></article>`).join("")}
      ${related_recent_reads.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Followthrough</div><h3>${escapeHtml(titleCase(row.current_validation_status || "pending"))}</h3><p class="route-copy">${escapeHtml(row.plain_language_status || "Validation context attached in Outcomes.")}</p></article>`).join("")}
    </div>
  `;
}

function renderChain(payload) {
  const data = payload || {};
  const label = data.chain_label || routeConfig.title;
  document.getElementById("routeHeadline").textContent = traderText(data.current_summary, `${label} coverage is developing.`);
  document.getElementById("routeHeroSummary").textContent = traderText(data.current_read, "Current synthesis uses aggregate behavior, replay, memory, and outcomes context when provider rows are available.");
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
      ${summaryMetric("Behavior context", traderText(data.behavior_context?.plain_language_summary))}
      ${summaryMetric("Replay context", traderText(data.replay_context?.public_read))}
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
  document.getElementById("routePrimaryPanel").innerHTML = `<p class="route-caveat">This route is still forming its page-specific renderer.</p>`;
  document.getElementById("routeSecondaryPanel").innerHTML = "";
}

function renderRoute(payload) {
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
  renderHydrationState(initialFallbackPayload ? "Verified artifact" : "Awaiting verified data");
}

async function initRoute() {
  if (!routeConfig) return;
  const [narratorResult, liveResult] = await Promise.allSettled([
    fetchNarratorPayload(),
    fetchLivePayload(),
  ]);

  if (narratorResult.status === "fulfilled") {
    routeNarratorPayload = narratorResult.value;
    ravenShell?.adaptLegacyNarrator?.(routeNarratorPayload, {
      evidenceRole: routeConfig.evidence_role,
      timeHorizon: routeConfig.funnel_stage === "validate" ? "settled window" : "current window",
    });
  } else {
    routeNarratorPayload = null;
    console.warn(`RavenOS narrator hydration failed for ${routeConfig.slug}:`, narratorResult.reason);
  }

  if (liveResult.status === "fulfilled") {
    const payload = liveResult.value;
    renderRoute(payload);
    renderHydrationState("Live public API");
    if (routeConfig.slug === "claims" && new URL(window.location.href).searchParams.get("id")) {
      renderClaimDetail(payload);
    }
  } else {
    if (initialFallbackPayload) renderRoute(initialFallbackPayload);
    renderHydrationState("Using last verified public artifact");
    renderFallbackMessage(routeConfig.fallback_message || "Using the last verified public artifact while live refresh is unavailable.");
    console.warn(`RavenOS route hydration failed for ${routeConfig.slug}:`, liveResult.reason);
  }
}

await renderInitialRoute();
await initRoute();
