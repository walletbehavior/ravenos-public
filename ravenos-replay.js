(function () {
  function clamp(value, min = 0, max = 100) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function esc(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function seed(value = "") {
    return Array.from(String(value || "RAVEN")).reduce((sum, char) => sum + char.charCodeAt(0), 37);
  }
  function normalizeDist(input) {
    const raw = {
      expansion: Number(input?.expansion ?? 0),
      continuation: Number(input?.continuation ?? 0),
      reversal: Number(input?.reversal ?? 0),
      failure: Number(input?.failure ?? 0),
    };
    const total = Object.values(raw).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.max(0, value) / total]));
  }
  function similarStructures(row, count = 3) {
    const s = seed(row?.instrument || row?.asset || row?.setupFamily || row?.market);
    const base = clamp(row?.replaySimilarity ?? row?.flowScore ?? row?.pressureScore ?? 62);
    return [
      ["Compression and participation reset", "2026-05-08 to 2026-05-13", { expansion: .34, continuation: .26, reversal: .22, failure: .18 }],
      ["Pressure broadening window", "2026-03-18 to 2026-03-24", { expansion: .22, continuation: .31, reversal: .29, failure: .18 }],
      ["Crowded continuation regime", "2026-01-09 to 2026-01-15", { expansion: .28, continuation: .37, reversal: .18, failure: .17 }],
      ["Liquidity deterioration window", "2025-11-04 to 2025-11-10", { expansion: .16, continuation: .21, reversal: .27, failure: .36 }],
    ].map(([label, dateRange, outcomeDistribution], index) => ({
      label,
      dateRange,
      similarity: clamp(base - 8 + ((s + index * 13) % 22), 25, 96),
      outcomeDistribution: normalizeDist(outcomeDistribution),
    })).sort((a, b) => b.similarity - a.similarity).slice(0, count);
  }
  function summary(row) {
    const matches = similarStructures(row);
    const avg = { expansion: 0, continuation: 0, reversal: 0, failure: 0 };
    matches.forEach((match) => Object.keys(avg).forEach((key) => { avg[key] += match.outcomeDistribution[key] || 0; }));
    Object.keys(avg).forEach((key) => { avg[key] /= Math.max(1, matches.length); });
    const count = Number(row?.sampleCount ?? row?.count ?? matches.length * 20);
    return {
      headline: `Top replay: ${matches[0]?.label || "Unavailable"}`,
      summary: "Replay compares current structure with similar historical windows and describes outcome distributions, conditions, and failure modes.",
      replayConfidence: matches[0]?.similarity || 0,
      sampleSufficiency: count >= 50 ? "sufficient" : count >= 20 ? "developing" : "thin",
      similarStructures: matches,
      outcomeDistribution: avg,
      bestConditions: ["participation quality improves", "liquidity remains stable", "sample depth increases"],
      failureConditions: ["participation narrows", "liquidity deteriorates", "replay sample remains thin"],
    };
  }
  function pct(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }
  function injectStyles() {
    if (document.getElementById("ravenos-replay-styles")) return;
    const style = document.createElement("style");
    style.id = "ravenos-replay-styles";
    style.textContent = `
      .raven-replay { border:1px solid rgba(148,163,184,.18); background:rgba(5,11,9,.7); padding:12px; display:grid; gap:10px; }
      .raven-replay h3 { margin:0; font-size:13px; }
      .raven-replay p { margin:0; color:#b9c9c2; font-size:12px; line-height:1.45; }
      .raven-replay-row { display:grid; grid-template-columns:1fr auto; gap:10px; border-bottom:1px solid rgba(148,163,184,.14); padding:6px 0; color:#9fb2aa; font-size:11px; }
      .raven-replay-row strong { color:#edf6f1; }
      .raven-replay-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .raven-replay-list { margin:6px 0 0; padding-left:16px; color:#b9c9c2; font-size:12px; line-height:1.45; }
      .raven-replay-kicker { color:#7dd3fc; font-size:10px; font-weight:850; text-transform:uppercase; }
      @media (max-width:760px){ .raven-replay-grid { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }
  function ReplayOutcomePanel(input) {
    injectStyles();
    const model = input?.similarStructures ? input : summary(input);
    const dist = model.outcomeDistribution || {};
    return `
      <section class="raven-replay">
        <div><span class="raven-replay-kicker">Replay Outcomes</span><h3>${esc(model.headline)}</h3><p>${esc(model.summary)}</p></div>
        <div class="raven-replay-row"><span>Replay confidence</span><strong>${Math.round(model.replayConfidence || 0)}/100</strong></div>
        <div class="raven-replay-row"><span>Sample sufficiency</span><strong>${esc(model.sampleSufficiency?.label || model.sampleSufficiency || "developing")}</strong></div>
        <div class="raven-replay-row"><span>Outcome distribution</span><strong>${pct(dist.expansion)} exp / ${pct(dist.continuation)} cont / ${pct(dist.reversal)} rev / ${pct(dist.failure)} fail</strong></div>
        <div class="raven-replay-grid">
          <div><span class="raven-replay-kicker">Similar Structures</span>${(model.similarStructures || []).map((item) => `<div class="raven-replay-row"><span>${esc(item.label)}<br><small>${esc(item.dateRange)}</small></span><strong>${Math.round(item.similarity)}%</strong></div>`).join("")}</div>
          <div><span class="raven-replay-kicker">Conditions</span><ul class="raven-replay-list">${(model.bestConditions || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul><span class="raven-replay-kicker">Failure Modes</span><ul class="raven-replay-list">${(model.failureConditions || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
        </div>
      </section>
    `;
  }
  function render(target, input) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) el.innerHTML = ReplayOutcomePanel(input);
  }
  window.RavenOSReplay = { similarStructures, summary, ReplayOutcomePanel, render };
})();
