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

  function normalize(input) {
    return {
      headline: input?.headline || "Market structure context",
      summary: input?.summary || "RavenOS is collecting evidence for this read.",
      confidence: clamp(input?.confidence ?? 50),
      positives: Array.isArray(input?.positives) ? input.positives : [],
      negatives: Array.isArray(input?.negatives) ? input.negatives : [],
      risks: Array.isArray(input?.risks) ? input.risks : [],
      evidence: Array.isArray(input?.evidence) ? input.evidence : [],
      coverage: input?.coverage || "Preview",
      lastUpdated: input?.lastUpdated || input?.last_updated || "sample",
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
      .raven-confidence { display: grid; gap: 5px; }
      .raven-confidence-track { height: 6px; background: rgba(148,163,184,.14); overflow: hidden; }
      .raven-confidence-fill { height: 100%; background: linear-gradient(90deg,#facc15,#34d399); }
      @media (max-width: 760px) { .raven-ex-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function ConfidenceBadge(explanation) {
    const ex = normalize(explanation);
    return `<div class="raven-confidence"><div class="raven-ex-row"><span>Confidence</span><b>${ex.confidence}/100</b></div><div class="raven-confidence-track"><div class="raven-confidence-fill" style="width:${ex.confidence}%"></div></div></div>`;
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
        ${ConfidenceBadge(ex)}
        <div class="raven-ex-grid">
          <div><span class="raven-ex-kicker">Breakdown</span>${ScoreBreakdown(ex)}</div>
          <div><span class="raven-ex-kicker">Evidence</span>${EvidenceList(ex)}</div>
        </div>
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
    EvidenceList,
    WhyThisChanged,
    render,
  };
})();
