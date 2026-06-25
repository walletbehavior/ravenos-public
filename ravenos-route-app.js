const routeConfigNode = document.getElementById("ravenosRouteConfig");
const routeConfig = routeConfigNode ? JSON.parse(routeConfigNode.textContent) : null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value, fallback = "sample forming") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtWhen(value) {
  if (!value) return "sample forming";
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
  if (!Number.isFinite(num)) return "sample forming";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: num >= 100 ? 0 : 2 }).format(num);
}

function fmtPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "sample forming";
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
  return parts.length ? titleCase(parts.join(" · ")) : "Public market context";
}

function sampleLabel(sample) {
  if (!sample) return "sample forming";
  const usable = sample.usable ?? sample.settled ?? sample.observed ?? null;
  const unit = text(sample.unit, "").trim();
  if (usable === null || usable === undefined) return "sample forming";
  return `${fmtNumber(usable)}${unit ? ` ${unit}` : ""}`;
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
  if (typeof data.evidence_bridge === "string" && data.evidence_bridge) return data.evidence_bridge;
  if (slug === "opportunity" && data.current_opportunity) {
    const current = data.current_opportunity;
    const settled = Array.isArray(data.outcomes_context) ? data.outcomes_context.find((row) => row.claim_id === current.claim_id || row.origin_claim_id === current.origin_claim_id) : null;
    if (settled && current.validation_status !== settled.current_validation_status) {
      return "Opportunity is a leading structural read. Outcomes is lagging validation. Current structure can improve before settled evidence confirms it.";
    }
  }
  return "Current reads, historical context, and settled validation use declared windows so differences can be understood rather than treated as contradictions.";
}

function renderEvidenceStrip(payload) {
  const contract = getEvidenceContract(payload);
  const detail = {
    role: titleCase(contract?.evidence_mode || payload?.data?.evidence_role || routeConfig.evidence_role || "current synthesis"),
    asOf: fmtWhen(contract?.as_of || payload?.generated_at || payload?.updated_at || payload?.data?.generated_at),
    window: text(contract?.observation_window?.label, "declared by read"),
    sample: contract?.sample ? `${fmtNumber(contract.sample.usable)} ${text(contract.sample.unit, "").trim()}` : "sample forming",
    freshness: contract?.freshness?.state ? `${titleCase(contract.freshness.state)} · ${text(contract.freshness.target_seconds, "n/a")}s target` : "checking",
    confidence: titleCase(contract?.confidence?.label || payload?.data?.confidence?.label || "developing"),
    settlement: text(contract?.settlement_window?.label, "pending or not applicable"),
    population: text(contract?.population?.label, "public aggregate market context"),
    weighting: text(contract?.weighting?.description || contract?.weighting?.mode, "equal row"),
    source: text(contract?.source?.public_label || payload?.source || payload?.data?.source, "verified Raven feed"),
    observedSettled: contract?.sample ? `${fmtNumber(contract.sample.observed)} / ${fmtNumber(contract.sample.settled ?? 0)}` : "0 / 0",
    validation: titleCase(contract?.validation_status || payload?.data?.validation_status || "pending"),
    artifact: text(contract?.artifact_version || payload?.schema_version || payload?.data?.artifact_version, "unversioned")
  };
  document.querySelector('[data-evidence-field="role"]').textContent = detail.role;
  document.querySelector('[data-evidence-field="as_of"]').textContent = detail.asOf;
  document.querySelector('[data-evidence-field="window"]').textContent = detail.window;
  document.querySelector('[data-evidence-field="sample"]').textContent = detail.sample;
  document.querySelector('[data-evidence-field="freshness"]').textContent = detail.freshness;
  document.querySelector('[data-evidence-field="confidence"]').textContent = detail.confidence;
  document.querySelector('[data-evidence-field="bridge"]').innerHTML = `<strong>Evidence bridge:</strong> ${escapeHtml(getEvidenceBridge(payload, routeConfig.slug))}`;
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

function proofCard(row, { legacy = false } = {}) {
  const status = row.current_validation_status || row.validation_status || row.settled_result || "pending";
  const settledAt = row.settled_at ? fmtWhen(row.settled_at) : null;
  const claimHref = row.claim_id ? claimLink(row.claim_id) : "";
  const sourceHref = sourceRouteForSurface(row.surface, row);
  return `
    <article class="route-proof-card">
      <div class="route-panel-head">
        <div>
          <div class="route-chip-label">${escapeHtml(titleCase(row.surface || "claim"))}</div>
          <h3>${escapeHtml(row.headline || row.public_read || "Claim forming")}</h3>
        </div>
        <span class="route-pill ${statusClass(status)}">${escapeHtml(titleCase(status))}</span>
      </div>
      <p class="route-copy">${escapeHtml(row.plain_language_status || row.public_summary || "Validation context is forming.")}</p>
      <div class="route-proof-meta">
        <div class="route-meta"><strong>Claim ID</strong><span>${escapeHtml(row.claim_id || "legacy_unlinked")}</span></div>
        <div class="route-meta"><strong>Issued</strong><span>${escapeHtml(fmtWhen(row.issued_at))}</span></div>
        <div class="route-meta"><strong>Evidence role</strong><span>${escapeHtml(titleCase(row.evidence_role || "leading"))}</span></div>
        <div class="route-meta"><strong>Validation window</strong><span>${escapeHtml(text(row.expected_validation_window, "pending"))}</span></div>
        <div class="route-meta"><strong>Market scope</strong><span>${escapeHtml(marketScopeLabel(row))}</span></div>
        <div class="route-meta"><strong>Issue sample</strong><span>${escapeHtml(sampleLabel(row.sample))}</span></div>
        <div class="route-meta"><strong>Settled result</strong><span>${escapeHtml(titleCase(row.settled_result || status))}</span></div>
        <div class="route-meta"><strong>Settled at</strong><span>${escapeHtml(settledAt || "pending")}</span></div>
        <div class="route-meta"><strong>Methodology</strong><span>${escapeHtml(text(row.methodology_version, "public definitions"))}</span></div>
      </div>
      <div class="route-next">
        ${claimHref ? `<a class="primary" href="${claimHref}">View claim details</a>` : ""}
        <a href="${sourceHref}">Open source page</a>
        ${legacy ? "" : `<a href="/outcomes/">Open Outcomes</a>`}
      </div>
    </article>
  `;
}

function renderFallbackMessage(message) {
  const heroSummary = document.getElementById("routeHeroSummary");
  if (heroSummary) heroSummary.textContent = message;
}

function renderBrief(payload) {
  const data = payload?.data || {};
  document.getElementById("routeHeadline").textContent = data.one_sentence_read || "Current read forming.";
  document.getElementById("routeHeroSummary").textContent = `Current read: ${data.one_sentence_read || "sample forming"}`;
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Best Surface", data.best_surface || data.best_opportunity_surface || "sample forming"),
    routeStateCard("Participation", data.participation_change || "sample forming"),
    routeStateCard("Reward", data.reward_change || "sample forming"),
    routeStateCard("Replay", `${fmtNumber(data.historical_analog_count)} similar structures`)
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Raven's Read</div><h2>Current Market Read</h2></div></div>
    <p class="route-summary">${escapeHtml(data.one_sentence_read || "Current public brief is forming.")}</p>
    <div class="route-metric-row" style="margin-top:12px;">
      ${summaryMetric("Best Surface", data.best_surface || "sample forming")}
      ${summaryMetric("What Changed", data.reward_change || "sample forming")}
      ${summaryMetric("Pressure", data.pressure_change || "sample forming")}
      ${summaryMetric("Most Similar Regime", data.most_similar_regime || "sample forming")}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Open Opportunity</a><a href="/outcomes/">View validation status</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Why Raven Believes This</div><h2>Evidence and Caveats</h2></div></div>
    <div class="route-card-grid">
      ${summaryMetric("Participation change", data.participation_change || "sample forming")}
      ${summaryMetric("Reward condition", data.reward_change || "sample forming")}
      ${summaryMetric("Pressure context", data.pressure_change || "sample forming")}
    </div>
  `;
}

function renderOpportunity(payload) {
  const data = payload || {};
  const current = data.current_opportunity || data.data?.current_opportunity || null;
  document.getElementById("routeHeadline").textContent = current?.headline || "Current opportunity surface forming.";
  document.getElementById("routeHeroSummary").textContent = current?.summary || "Opportunity is a leading structural read, not settled validation.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Current Surface", titleCase([current?.market_scope?.chain, current?.market_scope?.cap_band].filter(Boolean).join(" · ")) || "sample forming"),
    routeStateCard("Status", titleCase(current?.validation_status || "pending")),
    routeStateCard("Sample", current?.sample ? `${fmtNumber(current.sample.usable)} ${current.sample.unit}` : "sample forming"),
    routeStateCard("Expected Validation", current?.expected_validation_window || "pending")
  ].join("");
  const settled = Array.isArray(data.outcomes_context) ? data.outcomes_context.find((row) => row.claim_id === current?.claim_id || row.origin_claim_id === current?.origin_claim_id) : null;
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Current Read</div><h2>Where Raven Would Investigate</h2></div>${current ? `<span class="route-pill ${statusClass(current.validation_status)}">${escapeHtml(titleCase(current.validation_status))}</span>` : ""}</div>
    <p class="route-summary">${escapeHtml(current?.summary || "Current opportunity surface is forming.")}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Claim", current?.headline || "sample forming")}
      ${summaryMetric("Confidence", titleCase(current?.confidence?.label || "sample forming"))}
      ${summaryMetric("Observation window", current?.observation_window?.label || "sample forming")}
    </div>
    <div class="route-next">
      ${current?.claim_id ? `<a class="primary" href="${claimLink(current.claim_id)}">View claim details</a>` : ""}
      <a href="/outcomes/">View settlement status</a>
      <a href="/terminal/">Open Terminal</a>
    </div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Settled Context</div><h2>Why Leading and Settled Reads Can Differ</h2></div></div>
    <p class="route-bridge">${escapeHtml(settled?.plain_language_status || "Current structure can improve before settled outcomes confirm it.")}</p>
    ${settled ? `<div class="route-proof-grid" style="margin-top:12px;">${proofCard(settled)}</div>` : `<p class="route-caveat">Settled validation is still forming for the active opportunity surface.</p>`}
  `;
}

function renderReplay(payload) {
  const data = payload?.data || {};
  const comparables = Array.isArray(data.comparables) ? data.comparables.slice(0, 6) : [];
  document.getElementById("routeHeadline").textContent = comparables[0]?.public_read || "Historical analogue context is forming.";
  document.getElementById("routeHeroSummary").textContent = "Replay is historical analogue context. It explains what looked similar before and what followed, without turning analogue outcomes into forecasts.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Comparable rows", fmtNumber(comparables.length)),
    routeStateCard("Best analogue", comparables[0] ? `${titleCase(comparables[0].chain)} · ${titleCase(comparables[0].cap_band)}` : "sample forming"),
    routeStateCard("Top similarity", comparables[0] ? fmtPct(comparables[0].similarity_score) : "sample forming"),
    routeStateCard("Window", comparables[0]?.window || "sample forming")
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Historical Analogue</div><h2>What Happened Before</h2></div></div>
    <div class="route-table-wrap"><table class="route-table"><thead><tr><th>Comparable</th><th>Similarity</th><th>After Window</th><th>Why It Matches</th></tr></thead><tbody>${
      comparables.map((row) => `<tr><td><strong>${escapeHtml(titleCase(row.chain))}</strong><br>${escapeHtml(titleCase(row.cap_band))}</td><td>${escapeHtml(fmtPct(row.similarity_score))}</td><td>${escapeHtml(titleCase(row.after_window_summary))}</td><td>${escapeHtml((row.match_reasons || []).join(", "))}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-next"><a class="primary" href="/opportunity/">Find current surfaces with similar structure</a><a href="/memory/">Open Memory</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Caveat</div><h2>How To Use Replay</h2></div></div><p class="route-caveat">Replay similarity explains why prior structures are relevant. It does not imply that a historical analogue outcome is a forecast.</p>`;
}

function renderMemory(payload) {
  const data = payload?.data || {};
  const families = Object.entries(data.frequent_condition_families || {}).slice(0, 6);
  document.getElementById("routeHeadline").textContent = titleCase(data.dominant_condition_family || "Current memory family forming");
  document.getElementById("routeHeroSummary").textContent = "Memory tracks how often this public structure repeats, whether it broadens, and when it remains unusual or unstable.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Dominant family", titleCase(data.dominant_condition_family || "sample forming")),
    routeStateCard("Consistency trend", titleCase(data.consistency_trend || "sample forming")),
    routeStateCard("Condition stability", titleCase(data.condition_stability || "sample forming")),
    routeStateCard("Window", data.window_hours ? `${fmtNumber(data.window_hours)}h` : "sample forming")
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Historical Frequency</div><h2>How Common This Regime Is</h2></div></div>
    <div class="route-card-grid">${families.map(([name, count]) => summaryMetric(titleCase(name), `${fmtNumber(count)} records`)).join("")}</div>
    <div class="route-next"><a class="primary" href="/opportunity/">See where this regime is active</a><a href="/replay/">Open Replay</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">What To Watch</div><h2>Transition Context</h2></div></div>
    ${(data.cards || []).slice(0, 2).map((card) => `<div class="route-card"><h3>${escapeHtml(card.title || "Memory card")}</h3><p class="route-copy">${escapeHtml(card.summary || "Current memory card is forming.")}</p><p class="route-caveat" style="margin-top:8px;">${escapeHtml(card.what_to_watch || "")}</p></div>`).join("")}
  `;
}

function renderBehavior(payload) {
  const data = payload?.data || {};
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 8) : [];
  const top = rows[0];
  document.getElementById("routeHeadline").textContent = top?.plain_language_summary || "Participation context is forming.";
  document.getElementById("routeHeroSummary").textContent = "Behavior is a leading participation read. It explains who is active, how broad participation is, and whether the current mix is constructive or still concentrated.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Top context", top ? `${titleCase(top.chain)} · ${titleCase(top.cap_band)}` : "sample forming"),
    routeStateCard("Window", data.metadata?.timeframe || top?.window || "sample forming"),
    routeStateCard("Sample unit", top?.sample_summary?.unit || "market rows"),
    routeStateCard("Rows", fmtNumber(data.count))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Who Is Participating?</div><h2>Current Behavior Read</h2></div></div>
    <div class="route-table-wrap"><table class="route-table"><thead><tr><th>Surface</th><th>Read</th><th>Window</th><th>Sample</th><th>Weighting</th></tr></thead><tbody>${
      rows.map((row) => `<tr><td><strong>${escapeHtml(titleCase(row.chain))}</strong><br>${escapeHtml(titleCase(row.cap_band))}</td><td>${escapeHtml(row.plain_language_summary)}</td><td>${escapeHtml(row.window || row.timeframe || "live")}</td><td>${escapeHtml(`${fmtNumber(row.sample_summary?.usable || row.usable_sample)} / ${fmtNumber(row.sample_summary?.observed || row.observed_sample)} ${row.sample_summary?.unit || "market rows"}`)}</td><td>${escapeHtml("equal row")}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="route-next"><a class="primary" href="/opportunity/">See where participation is becoming actionable</a><a href="/outcomes/">Compare settled outcomes</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Evidence Caveat</div><h2>What This Percentage Means</h2></div></div><p class="route-caveat">Behavior rows are public aggregate observations. Each row shows a declared window, usable sample, and unit so “constructive” or “mixed” is never detached from its denominator.</p>`;
}

function renderResearch(payload) {
  const data = payload || {};
  const state = data.research_state || "unavailable";
  const summary = data.data?.summary || {};
  document.getElementById("routeHeadline").textContent = summary.strongest_condition || "Current public research snapshot unavailable";
  document.getElementById("routeHeroSummary").textContent = summary.caveat || "Research is evidence context only and does not generate trade recommendations.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Research state", titleCase(state)),
    routeStateCard("Findings reviewed", fmtNumber(summary.findings_reviewed)),
    routeStateCard("Forward observations", fmtNumber(summary.forward_observations)),
    routeStateCard("Sample", summary.sample_depth ? fmtNumber(summary.sample_depth) : "No zero should be interpreted as measured evidence")
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Latest Completed Research Cohort</div><h2>Research Product State</h2></div></div>
    <p class="route-summary">${escapeHtml(summary.strongest_condition || "Current public research snapshot unavailable")}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Weakest condition", summary.weakest_condition || "sample forming")}
      ${summaryMetric("Source", data.source || "last known research snapshot")}
      ${summaryMetric("Validation window", data.validation_window?.label || "pending")}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Apply findings to Opportunity</a><a href="/outcomes/">Check Outcomes</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">Current Forward Observations</div><h2>What Is Still Forming</h2></div></div><p class="route-caveat">${escapeHtml(data.current_forming_cohort?.expected_validation_window ? `Current forward observations remain open. Next declared validation window: ${data.current_forming_cohort.expected_validation_window}.` : "No safe completed or forming research cohort is currently available.")}</p>`;
}

function renderPerps(payload) {
  const data = payload?.data || {};
  const grouped = data.outcome_attribution?.grouped?.instrument_group || [];
  const top = grouped[0];
  document.getElementById("routeHeadline").textContent = top ? `${top.group} are ${top.read}.` : "Perps context is forming.";
  document.getElementById("routeHeroSummary").textContent = "Perps show where derivatives pressure is building, fading, or staying mixed across the current public forward-observation set.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Venue", "Hyperliquid Perps"),
    routeStateCard("Coverage", titleCase(data.coverage || "developing")),
    routeStateCard("Observations", fmtNumber(data.forward_observation?.observations)),
    routeStateCard("Source age", fmtWhen(data.generated_at))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Live Perps Context</div><h2>Forward Observation</h2></div></div>
    <div class="route-card-grid">
      ${grouped.slice(0, 3).map((row) => summaryMetric(`${row.group} · ${row.label}`, `${row.read} · ${fmtNumber(row.sample_size)} observations`)).join("")}
    </div>
    <div class="route-next"><a class="primary" href="/terminal/">Open Perps Terminal context</a><a href="/outcomes/">View settled validation</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `<div class="route-panel-head"><div><div class="route-chip-label">How To Read Perps</div><h2>Pressure and Validation</h2></div></div><p class="route-caveat">${escapeHtml(data.legal_caveat || "Perps context is a live derivatives read. Use it as pressure context, then compare it with settled Outcomes before treating the move as confirmed.")}</p>`;
}

function renderOutcomes(payload) {
  const data = payload?.data || {};
  const recent = Array.isArray(data.recent_raven_reads) ? data.recent_raven_reads : [];
  const legacy = Array.isArray(data.legacy_unlinked) ? data.legacy_unlinked : [];
  const statusKeys = ["pending", "partially_settled", "confirmed", "mixed", "invalidated", "insufficient", "expired"];
  const counts = recent.reduce((acc, row) => {
    const key = row.current_validation_status || "pending";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  document.getElementById("routeHeadline").textContent = "Outcomes is RavenOS's public proof rail.";
  document.getElementById("routeHeroSummary").textContent = "RavenOS records observed market outcomes against previously issued public reads. This is descriptive research, not a performance guarantee or trading recommendation.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Pending", fmtNumber(counts.pending || 0)),
    routeStateCard("Partially settled", fmtNumber(counts.partially_settled || 0)),
    routeStateCard("Confirmed", fmtNumber(counts.confirmed || 0)),
    routeStateCard("Mixed", fmtNumber(counts.mixed || 0)),
    routeStateCard("Invalidated", fmtNumber(counts.invalidated || 0)),
    routeStateCard("Insufficient", fmtNumber(counts.insufficient || 0)),
    routeStateCard("Legacy unlinked", fmtNumber(legacy.length)),
    routeStateCard("Coverage", titleCase(data.coverage || "developing"))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Recent Raven Reads</div><h2>Claim-To-Outcome Loop</h2></div></div>
    <div class="route-card-grid" style="margin-bottom:12px;">
      ${statusKeys.map((key) => summaryMetric(titleCase(key), fmtNumber(counts[key] || 0))).join("")}
    </div>
    <div class="route-proof-grid">${recent.map((row) => proofCard(row)).join("") || `<p class="route-caveat">No current public claims are available.</p>`}</div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Legacy Historical Rows</div><h2>Visible But Unlinked</h2></div></div>
    <div class="route-proof-grid">${legacy.slice(0, 6).map((row) => proofCard(row, { legacy: true })).join("") || `<p class="route-caveat">No legacy-unlinked rows are currently published.</p>`}</div>
  `;
}

function renderClaimsList(payload) {
  const data = payload?.data || {};
  const claims = Array.isArray(data.current_claims) && data.current_claims.length ? data.current_claims : (data.claim_history || []).slice(0, 12);
  document.getElementById("routeHeadline").textContent = "Immutable public claims and their later validation.";
  document.getElementById("routeHeroSummary").textContent = "Claims are immutable public reads. Later observations and settlements attach to the issued claim rather than rewriting it.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Current claims", fmtNumber((data.current_claims || []).length)),
    routeStateCard("History", fmtNumber((data.claim_history || []).length)),
    routeStateCard("Observations", fmtNumber((data.claim_observations || []).length)),
    routeStateCard("Settlements", fmtNumber((data.claim_settlements || []).length))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Current Public Claims</div><h2>What Raven Said</h2></div></div>
    <div class="route-proof-grid">${claims.map((row) => proofCard(row)).join("")}</div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">How To Use Claims</div><h2>Open A Claim Detail</h2></div></div>
    <p class="route-caveat">Claim IDs are provenance, not the headline. Use them to inspect the original assertion, later evidence, supersession, and settlement.</p>
    <div class="route-next"><a class="primary" href="/outcomes/">Open Outcomes proof rail</a><a href="/opportunity/">Open Opportunity</a></div>
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
  document.getElementById("routeHeadline").textContent = claim.headline || "Claim detail";
  document.getElementById("routeHeroSummary").textContent = claim.summary || "Immutable claim detail.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Claim ID", claim.claim_id),
    routeStateCard("Origin claim", claim.origin_claim_id || claim.claim_id),
    routeStateCard("Surface", titleCase(claim.surface || "claim")),
    routeStateCard("Status", titleCase(claim.validation_status || "pending"))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Original Claim</div><h2>Immutable Issuance Snapshot</h2></div>${claim.validation_status ? `<span class="route-pill ${statusClass(claim.validation_status)}">${escapeHtml(titleCase(claim.validation_status))}</span>` : ""}</div>
    <div class="route-key-grid">
      ${summaryMetric("Claim key", claim.claim_key)}
      ${summaryMetric("Issued", fmtWhen(claim.issued_at))}
      ${summaryMetric("Origin claim", claim.origin_claim_id || claim.claim_id)}
      ${summaryMetric("Supersedes", claim.supersedes_claim_id || "first claim")}
      ${summaryMetric("Validation window", claim.expected_validation_window || "pending")}
      ${summaryMetric("Market scope", marketScopeLabel(claim))}
      ${summaryMetric("Observation window", claim.observation_window?.label || "sample forming")}
      ${summaryMetric("Confidence at issue", titleCase(claim.confidence?.label || "sample forming"))}
    </div>
    <p class="route-summary" style="margin-top:12px;">${escapeHtml(claim.summary || "No public summary was recorded for this claim.")}</p>
    <div class="route-next"><a class="primary" href="/outcomes/">Open Outcomes</a><a href="${sourceRouteForSurface(claim.surface, claim)}">Open source page</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Observation Timeline</div><h2>What Changed Later</h2></div></div>
    <div class="route-timeline">
      ${observations.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Observation</div><h3>${escapeHtml(fmtWhen(row.observed_at))}</h3><p class="route-copy">${escapeHtml(row.note || titleCase(row.current_validation_status || "evidence update"))}</p></article>`).join("")}
      ${settlements.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Settlement</div><h3>${escapeHtml(fmtWhen(row.settled_at))}</h3><p class="route-copy">${escapeHtml(row.outcome?.public_summary || titleCase(row.settlement_status || "settled"))}</p></article>`).join("")}
      ${related_recent_reads.map((row) => `<article class="route-timeline-card"><div class="route-timeline-label">Proof Rail</div><h3>${escapeHtml(titleCase(row.current_validation_status || "pending"))}</h3><p class="route-copy">${escapeHtml(row.plain_language_status || "Validation context attached in Outcomes.")}</p></article>`).join("")}
    </div>
  `;
}

function renderChain(payload) {
  const data = payload || {};
  const label = data.chain_label || routeConfig.title;
  document.getElementById("routeHeadline").textContent = data.current_summary || `${label} coverage is developing.`;
  document.getElementById("routeHeroSummary").textContent = data.current_read || "Current synthesis uses public behavior, replay, memory, and outcomes context when provider rows are available.";
  document.getElementById("routeStateStrip").innerHTML = [
    routeStateCard("Coverage", titleCase(data.coverage || "developing")),
    routeStateCard("Best surface", titleCase(data.best_surface || "sample forming")),
    routeStateCard("Weakest surface", titleCase(data.weakest_surface || "sample forming")),
    routeStateCard("Latest settled", titleCase(data.latest_validation?.validation_status || "sample forming"))
  ].join("");
  document.getElementById("routePrimaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Current Chain Read</div><h2>${escapeHtml(label)} Synthesis</h2></div></div>
    <p class="route-summary">${escapeHtml(data.current_read || "Developing coverage.")}</p>
    <div class="route-card-grid" style="margin-top:12px;">
      ${summaryMetric("Behavior context", data.behavior_context?.plain_language_summary || "sample forming")}
      ${summaryMetric("Replay context", data.replay_context?.public_read || "sample forming")}
      ${summaryMetric("Memory context", data.memory_context?.title || "sample forming")}
    </div>
    <div class="route-next"><a class="primary" href="/opportunity/">Open ${escapeHtml(label)} in Opportunity</a><a href="/outcomes/">View settled validation</a></div>
  `;
  document.getElementById("routeSecondaryPanel").innerHTML = `
    <div class="route-panel-head"><div><div class="route-chip-label">Claim Provenance</div><h2>Current and Settled Context</h2></div></div>
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
      sample: data.latest_validation.evidence_contract?.sample || { usable: data.latest_validation.sample_size, unit: "market rows" },
      methodology_version: data.latest_validation.evidence_contract?.artifact_version || "public definitions",
      plain_language_status: data.latest_validation.participant_outcome || "Settled validation context is forming."
    })}</div>` : ""}
  `;
}

function renderGeneric(payload) {
  document.getElementById("routeHeadline").textContent = routeConfig.title;
  document.getElementById("routeHeroSummary").textContent = "Current public read forming.";
  document.getElementById("routeStateStrip").innerHTML = routeStateCard("Status", "sample forming");
  document.getElementById("routePrimaryPanel").innerHTML = `<p class="route-caveat">This route is still forming its page-specific renderer.</p>`;
  document.getElementById("routeSecondaryPanel").innerHTML = "";
}

function renderRoute(payload) {
  renderEvidenceStrip(payload);
  const slug = routeConfig.slug;
  if (slug === "brief" || slug === "home") return renderBrief(payload);
  if (slug === "opportunity") return renderOpportunity(payload);
  if (slug === "replay") return renderReplay(payload);
  if (slug === "outcomes") return renderOutcomes(payload);
  if (slug === "claims") return renderClaimsList(payload);
  if (slug === "memory") return renderMemory(payload);
  if (slug === "behavior") return renderBehavior(payload);
  if (slug === "research") return renderResearch(payload);
  if (slug === "perps") return renderPerps(payload);
  if (slug.startsWith("chain-")) return renderChain(payload);
  return renderGeneric(payload);
}

async function fetchLivePayload() {
  const endpoint = routeConfig.api_endpoint;
  if (routeConfig.slug === "claims") {
    const claimId = new URL(window.location.href).searchParams.get("id");
    if (claimId) {
      const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`claims_${response.status}`);
      return await response.json();
    }
  }
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`${routeConfig.slug}_${response.status}`);
  return await response.json();
}

function renderHydrationState(message) {
  const stateHost = document.getElementById("routeHydrationState");
  if (stateHost) stateHost.textContent = message;
}

async function initRoute() {
  if (!routeConfig) return;
  if (routeConfig.fallback_payload) renderRoute(routeConfig.fallback_payload);
  renderHydrationState("Fallback shell loaded");
  try {
    const payload = await fetchLivePayload();
    renderRoute(payload);
    renderHydrationState("Live public API");
    if (routeConfig.slug === "claims" && new URL(window.location.href).searchParams.get("id")) {
      renderClaimDetail(payload);
    }
  } catch (error) {
    renderHydrationState("Using fallback shell");
    renderFallbackMessage(routeConfig.fallback_message || "Current read forming. Live API refresh failed, so the last verified fallback remains visible.");
    console.warn(`RavenOS route hydration failed for ${routeConfig.slug}:`, error);
  }
}

initRoute();
