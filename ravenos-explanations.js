(function () {
  function clamp(value, min = 0, max = 100) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function list(items) {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    return rows.length ? `<ul class="raven-ex-list">${rows.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="raven-ex-muted">No additional evidence loaded.</p>`;
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function confidenceLabel(score) {
    const value = clamp(score);
    if (value >= 80) return "High";
    if (value >= 60) return "Moderate";
    if (value >= 35) return "Developing";
    return "Low";
  }

  function freshnessFrom(value) {
    const raw = String(value || "").trim();
    const lower = raw.toLowerCase();
    if (!raw || lower === "sample" || lower === "preview") {
      return { updatedAt: raw || "limited context", sampleWindow: "Current sample window", label: "Limited", age: "Not live" };
    }
    if (lower === "live" || lower === "now") {
      return { updatedAt: raw, sampleWindow: "Current session", label: "Current", age: "Within live session" };
    }
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) {
      const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const age = minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
      return { updatedAt: raw, sampleWindow: "Observed rolling window", label: seconds <= 3600 ? "Current" : "Stale", age };
    }
    return { updatedAt: raw, sampleWindow: "Observed window", label: titleCase(raw), age: raw };
  }

  function normalizeCoverageDetails(input) {
    const coverage = String(input?.coverage || "Limited");
    const observed = Number(input?.observedAssets ?? input?.observed_assets ?? input?.sampleCount ?? 0);
    const usable = Number(input?.usableAssets ?? input?.usable_assets ?? input?.sampleCount ?? 0);
    const chains = Array.isArray(input?.chains) ? input.chains : input?.chainVenue ? [input.chainVenue] : input?.chain ? [input.chain] : [];
    const capBands = Array.isArray(input?.capBands) ? input.capBands : input?.marketCapBand ? [input.marketCapBand] : [];
    const thin = (usable || observed) > 0 && (usable || observed) < 20;
    return {
      label: coverage,
      observedAssets: observed || "--",
      usableAssets: usable || "--",
      chains: chains.length ? chains.join(", ") : "Current market",
      capBands: capBands.length ? capBands.join(", ") : "Current segment",
      sampleWarning: input?.sampleWarning || (thin ? "Sample depth is thin; treat the read as developing." : "Sample depth is sufficient for this public read."),
    };
  }

  function confidenceReason(input) {
    const score = clamp(input?.confidence ?? 50);
    if (input?.confidenceReason) return input.confidenceReason;
    if (score >= 80) return "Supporting evidence is aligned across participation, liquidity, and replay context.";
    if (score >= 60) return "Evidence is useful, but one or more inputs still need confirmation.";
    if (score >= 35) return "The read is developing because sample depth, freshness, or confirmation is limited.";
    return "The read has low support and should be treated as exploratory context.";
  }

  function normalizeValidation(input) {
    const analogCount = Number(input?.historicalAnalogCount ?? input?.analogCount ?? input?.sampleCount ?? 0);
    return {
      historicalAnalogCount: analogCount || "--",
      priorSimilarOutcomes: input?.priorSimilarOutcomes || input?.outcomeContext || "Outcome history is still being accumulated for this public view.",
      confirm: input?.confirm || input?.whatWouldConfirm || "Participation breadth persists while liquidity and confirmation depth remain stable.",
      weaken: input?.weaken || input?.whatWouldWeaken || "Participation narrows, liquidity deteriorates, or replay similarity fails to hold.",
    };
  }

  function whyItMattersFor(input) {
    if (input?.whyItMatters) return input.whyItMatters;
    const type = String(input?.type || input?.scoreType || "").toLowerCase();
    if (type.includes("pressure")) return "Pressure helps explain whether positioning, participation, and liquidity are becoming more aligned or more fragile.";
    if (type.includes("replay")) return "Replay gives historical context for whether similar structures previously broadened, stalled, or failed.";
    if (type.includes("survival")) return "Survival shows whether new activity is persisting instead of fading after the first attention burst.";
    if (type.includes("participation")) return "Participation breadth helps separate broad structure from narrow, fragile activity.";
    if (type.includes("opportunity")) return "Opportunity reads combine participation, outcome quality, freshness, and failure conditions so users know where to investigate first.";
    return "This read connects current structure to supporting evidence, confidence, and failure conditions so users can judge the context quickly.";
  }

  function normalize(input) {
    const confidence = clamp(input?.confidence ?? 50);
    const freshness = input?.freshness || freshnessFrom(input?.lastUpdated || input?.last_updated);
    const coverageDetails = normalizeCoverageDetails(input);
    return {
      headline: input?.headline || "Market structure context",
      summary: input?.summary || "RavenOS is collecting evidence for this read.",
      confidence,
      confidenceLabel: input?.confidenceLabel || confidenceLabel(confidence),
      confidenceReason: confidenceReason({ ...input, confidence }),
      strongestSignal: input?.strongestSignal || input?.positives?.[0] || "Participation breadth",
      weakestSignal: input?.weakestSignal || input?.risks?.[0] || input?.negatives?.[0] || "Confirmation depth",
      positives: Array.isArray(input?.positives) ? input.positives : [],
      negatives: Array.isArray(input?.negatives) ? input.negatives : [],
      risks: Array.isArray(input?.risks) ? input.risks : [],
      evidence: Array.isArray(input?.evidence) ? input.evidence : [],
      coverage: input?.coverage || "Preview",
      lastUpdated: input?.lastUpdated || input?.last_updated || "sample",
      freshness,
      coverageDetails,
      validation: normalizeValidation(input),
      whyItMatters: whyItMattersFor(input),
      methodology: Array.isArray(input?.methodology) && input.methodology.length ? input.methodology : [
        "Participation breadth",
        "Pressure alignment",
        "Survival persistence",
        "Replay similarity",
        "Confirmation depth",
        "Failure conditions",
      ],
      breakdown: Array.isArray(input?.breakdown) ? input.breakdown : [],
    };
  }

  function scoreBreakdown(row) {
    const flow = clamp(row?.flowScore ?? row?.flow_score ?? row?.score);
    const attention = Number(row?.attentionVelocity ?? row?.attention_velocity ?? 0);
    const participant = String(row?.participantActivity || row?.participant_activity || "").toLowerCase();
    const liquidity = String(row?.liquidityPosture || row?.liquidity_posture || "").toLowerCase();
    return [
      { label: "participation breadth", value: flow >= 80 ? 24 : flow >= 70 ? 16 : 8 },
      { label: "participant activity", value: participant.includes("high") ? 18 : participant.includes("medium") ? 10 : 5 },
      { label: "attention velocity", value: attention >= 20 ? 10 : attention >= 5 ? 6 : attention < 0 ? -4 : 2 },
      { label: "liquidity posture", value: liquidity.includes("stable") || liquidity.includes("deep") ? 8 : liquidity.includes("thin") ? -7 : 3 },
      { label: "confirmation quality", value: row?.risk === "Stable" ? 6 : row?.risk === "Elevated" ? -8 : -3 },
    ];
  }

  function explanationForRow(row, type = "flow_score") {
    const flow = clamp(row?.flowScore ?? row?.flow_score ?? row?.score ?? row?.pressureScore ?? row?.replaySimilarity);
    const positives = [];
    const negatives = [];
    const risks = [];
    if (flow >= 75) positives.push("Participation or structure is broad relative to the visible sample.");
    else negatives.push("Confirmation remains developing in the visible sample.");
    if (Number(row?.attentionVelocity ?? row?.attention_velocity ?? 0) > 0) positives.push("Attention velocity is positive.");
    if (row?.risk === "Elevated") risks.push("Risk posture is elevated.");
    if (String(row?.coverage || "").toLowerCase().includes("sample")) risks.push("Coverage is sample or preview and should not be treated as live.");
    const label = type.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return normalize({
      headline: `${label}: ${flow >= 75 ? "constructive" : flow >= 50 ? "mixed" : "thin"} read`,
      summary: "This read explains structure, participation, replay, attention, risk, and evidence without producing trade calls.",
      type,
      confidence: clamp(45 + flow * 0.35 - (String(row?.coverage || "").toLowerCase().includes("sample") ? 12 : 0)),
      positives,
      negatives,
      risks,
      evidence: [
        `Flow score ${row?.flowScore ?? row?.flow_score ?? "n/a"}`,
        row?.pressureScore != null ? `Pressure score ${row.pressureScore}` : "",
        row?.replaySimilarity != null ? `Replay similarity ${row.replaySimilarity}` : "",
        row?.coverage ? `Coverage ${row.coverage}` : "",
        row?.lastUpdated || row?.updated_at ? `Updated ${row.lastUpdated || row.updated_at}` : "",
      ].filter(Boolean),
      coverage: row?.coverage || "Preview",
      lastUpdated: row?.lastUpdated || row?.updated_at || "sample",
      sampleCount: row?.sampleCount || row?.sample_count || (row?.coverage === "Indexed" ? 64 : 18),
      observedAssets: row?.observedAssets || row?.observed_assets || (row?.market === "Perpetual Futures" ? 157 : row?.chainVenue ? 50 : 18),
      usableAssets: row?.usableAssets || row?.usable_assets || (row?.market === "Perpetual Futures" ? 84 : row?.chainVenue ? 32 : 12),
      chains: row?.chainVenue ? [row.chainVenue] : row?.market === "Perpetual Futures" ? ["Hyperliquid"] : [],
      capBands: row?.marketCapBand ? [row.marketCapBand] : [],
      historicalAnalogCount: row?.historicalAnalogCount || row?.sampleCount || (flow >= 75 ? 12 : 6),
      priorSimilarOutcomes: row?.priorSimilarOutcomes || "Comparable structures are summarized as context only; they are not forecasts.",
      strongestSignal: positives[0] || "Participation breadth",
      weakestSignal: risks[0] || negatives[0] || "Confirmation depth",
      whatWouldConfirm: row?.whatWouldConfirm || "Participation breadth and liquidity context remain stable across the next observed window.",
      whatWouldWeaken: row?.whatWouldWeaken || "Participation narrows, liquidity weakens, or risk posture rises.",
      breakdown: scoreBreakdown(row),
    });
  }

  function injectStyles() {
    if (document.getElementById("ravenos-explanation-styles")) return;
    const style = document.createElement("style");
    style.id = "ravenos-explanation-styles";
    style.textContent = `
      .raven-ex-panel { border: 1px solid rgba(148,163,184,.18); background: rgba(5,11,9,.72); padding: 12px; display: grid; gap: 10px; }
      .raven-ex-panel h3 { margin: 0; font-size: 13px; line-height: 1.25; }
      .raven-ex-panel p { margin: 0; color: #b9c9c2; font-size: 12px; line-height: 1.45; }
      .raven-ex-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .raven-ex-kicker { color: #7dd3fc; font-size: 10px; font-weight: 850; text-transform: uppercase; }
      .raven-ex-row { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px solid rgba(148,163,184,.14); padding: 5px 0; color: #9fb2aa; font-size: 11px; }
      .raven-ex-row b { color: #edf6f1; }
      .raven-ex-list { margin: 6px 0 0; padding-left: 16px; color: #b9c9c2; font-size: 12px; line-height: 1.45; }
      .raven-ex-muted { color: #65786f; font-size: 11px; }
      .raven-provenance-strip { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); border: 1px solid rgba(148,163,184,.14); background: rgba(148,163,184,.12); gap: 1px; }
      .raven-prov-cell { background: rgba(5,11,9,.82); padding: 8px; min-width: 0; }
      .raven-prov-cell span { display: block; color: #65786f; font-size: 9px; font-weight: 850; text-transform: uppercase; }
      .raven-prov-cell b { display: block; color: #edf6f1; margin-top: 4px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .raven-evidence-card { border: 1px solid rgba(148,163,184,.14); background: rgba(125,211,252,.035); padding: 9px; display: grid; gap: 6px; }
      .raven-evidence-card h4 { margin: 0; color: #7dd3fc; font-size: 10px; text-transform: uppercase; }
      .raven-evidence-card p { font-size: 11px; }
      .raven-confidence { display: grid; gap: 5px; }
      .raven-confidence-track { height: 6px; background: rgba(148,163,184,.14); overflow: hidden; }
      .raven-confidence-fill { height: 100%; background: linear-gradient(90deg,#facc15,#34d399); }
      @media (max-width: 760px) { .raven-ex-grid, .raven-provenance-strip { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function ConfidenceBadge(explanation) {
    const ex = normalize(explanation);
    return `<div class="raven-confidence"><div class="raven-ex-row"><span>Confidence</span><b>${esc(ex.confidenceLabel)} · ${ex.confidence}/100</b></div><div class="raven-confidence-track"><div class="raven-confidence-fill" style="width:${ex.confidence}%"></div></div></div>`;
  }

  function ProvenanceStrip(explanation) {
    const ex = normalize(explanation);
    return `
      <div class="raven-provenance-strip">
        <div class="raven-prov-cell"><span>Freshness</span><b>${esc(ex.freshness.label)} · ${esc(ex.freshness.age)}</b></div>
        <div class="raven-prov-cell"><span>Sample Window</span><b>${esc(ex.freshness.sampleWindow)}</b></div>
        <div class="raven-prov-cell"><span>Coverage</span><b>${esc(ex.coverageDetails.usableAssets)}/${esc(ex.coverageDetails.observedAssets)} usable</b></div>
      </div>
    `;
  }

  function ConfidencePanel(explanation) {
    const ex = normalize(explanation);
    return `
      <div class="raven-evidence-card">
        <h4>Confidence Provenance</h4>
        ${ConfidenceBadge(ex)}
        <p>${esc(ex.confidenceReason)}</p>
        <div class="raven-ex-row"><span>Strongest signal</span><b>${esc(ex.strongestSignal)}</b></div>
        <div class="raven-ex-row"><span>Weakest signal</span><b>${esc(ex.weakestSignal)}</b></div>
      </div>
    `;
  }

  function EvidenceCard(explanation) {
    const ex = normalize(explanation);
    return `
      <div class="raven-evidence-card">
        <h4>Evidence & Validation</h4>
        <div class="raven-ex-row"><span>Observed assets</span><b>${esc(ex.coverageDetails.observedAssets)}</b></div>
        <div class="raven-ex-row"><span>Chains represented</span><b>${esc(ex.coverageDetails.chains)}</b></div>
        <div class="raven-ex-row"><span>Cap bands represented</span><b>${esc(ex.coverageDetails.capBands)}</b></div>
        <p>${esc(ex.coverageDetails.sampleWarning)}</p>
        <div class="raven-ex-row"><span>Historical analogs</span><b>${esc(ex.validation.historicalAnalogCount)}</b></div>
        <p>${esc(ex.validation.priorSimilarOutcomes)}</p>
      </div>
    `;
  }

  function MethodologyCard(explanation) {
    const ex = normalize(explanation);
    return `
      <div class="raven-evidence-card">
        <h4>Public Methodology</h4>
        ${list(ex.methodology)}
        <div class="raven-ex-row"><span>Would confirm</span><b>${esc(ex.validation.confirm)}</b></div>
        <div class="raven-ex-row"><span>Would weaken</span><b>${esc(ex.validation.weaken)}</b></div>
      </div>
    `;
  }

  function ScoreTransparency(explanation) {
    const ex = normalize(explanation);
    const positives = ex.positives.length ? ex.positives : ex.breakdown.filter((item) => Number(item.value) > 0).map((item) => `${item.value > 0 ? "+" : ""}${item.value} ${item.label}`);
    const negatives = [...ex.negatives, ...ex.risks].length ? [...ex.negatives, ...ex.risks] : ex.breakdown.filter((item) => Number(item.value) < 0).map((item) => `${item.value} ${item.label}`);
    return `
      <div class="raven-ex-grid">
        <div class="raven-evidence-card">
          <h4>Top Positive Contributors</h4>
          ${list(positives.slice(0, 4))}
        </div>
        <div class="raven-evidence-card">
          <h4>Top Negative Contributors</h4>
          ${list(negatives.slice(0, 4))}
        </div>
      </div>
    `;
  }

  function WhyItMatters(explanation) {
    const ex = normalize(explanation);
    return `
      <div class="raven-evidence-card">
        <h4>Why It Matters</h4>
        <p>${esc(ex.whyItMatters)}</p>
      </div>
    `;
  }

  function ScoreBreakdown(explanation) {
    const ex = normalize(explanation);
    return `<div>${ex.breakdown.map((item) => `<div class="raven-ex-row"><span>${esc(item.label)}</span><b>${Number(item.value) > 0 ? "+" : ""}${esc(item.value)}</b></div>`).join("")}</div>`;
  }

  function EvidenceList(explanation) {
    return list(normalize(explanation).evidence);
  }

  function WhyThisChanged(explanation) {
    const ex = normalize(explanation);
    return list([...ex.positives, ...ex.negatives, ...ex.risks]);
  }

  function ExplanationPanel(explanation) {
    injectStyles();
    const ex = normalize(explanation);
    return `
      <section class="raven-ex-panel">
        <div><span class="raven-ex-kicker">Why This Read</span><h3>${esc(ex.headline)}</h3><p>${esc(ex.summary)}</p></div>
        ${ProvenanceStrip(ex)}
        <div class="raven-ex-grid">
          ${ConfidencePanel(ex)}
          ${EvidenceCard(ex)}
        </div>
        <div class="raven-ex-grid">
          <div><span class="raven-ex-kicker">Breakdown</span>${ScoreBreakdown(ex)}</div>
          <div><span class="raven-ex-kicker">Evidence</span>${EvidenceList(ex)}</div>
        </div>
        ${ScoreTransparency(ex)}
        ${WhyItMatters(ex)}
        ${MethodologyCard(ex)}
        <div><span class="raven-ex-kicker">Context</span>${WhyThisChanged(ex)}</div>
        <div class="raven-ex-row"><span>Coverage</span><b>${esc(ex.coverage)}</b></div>
      </section>
    `;
  }

  function render(target, explanation) {
    injectStyles();
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) el.innerHTML = ExplanationPanel(explanation);
  }

  window.RavenOSExplanations = {
    normalize,
    explanationForRow,
    ExplanationPanel,
    ScoreBreakdown,
    ConfidenceBadge,
    ConfidencePanel,
    EvidenceCard,
    ProvenanceStrip,
    ScoreTransparency,
    WhyItMatters,
    EvidenceList,
    WhyThisChanged,
    render,
  };
})();
