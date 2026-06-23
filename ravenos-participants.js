(function () {
  function clamp(value, min = 0, max = 100) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function esc(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
  function seed(value = "") {
    return Array.from(String(value || "RAVEN")).reduce((sum, char) => sum + char.charCodeAt(0), 41);
  }
  function label(category) {
    return { smart_money: "Smart Money", retail: "Retail", market_makers: "Market Makers", unknown: "Unknown" }[category] || "Unknown";
  }
  function direction(value) {
    if (value > 8) return "expanding";
    if (value < -8) return "contracting";
    return "steady";
  }
  function breakdown(row) {
    const s = seed(row?.instrument || row?.asset || row?.market);
    const flow = clamp(row?.flowScore ?? row?.pressureScore ?? 55);
    const attention = Number(row?.attentionVelocity || 0);
    const smartRaw = clamp(flow * .42 + (row?.risk === "Stable" ? 12 : 0) + (s % 14));
    const retailRaw = clamp(flow * .25 + Math.max(0, attention) * 1.2 + ((s + 7) % 18));
    const makerRaw = clamp(45 + (/deep|stable/i.test(row?.liquidityPosture || "") ? 20 : 0) + ((s + 11) % 12));
    const unknownRaw = clamp(35 + (row?.risk === "Elevated" ? 18 : 0) + ((s + 19) % 10));
    const total = smartRaw + retailRaw + makerRaw + unknownRaw || 1;
    return [
      ["smart_money", smartRaw, smartRaw - retailRaw],
      ["retail", retailRaw, attention],
      ["market_makers", makerRaw, makerRaw - flow],
      ["unknown", unknownRaw, unknownRaw - makerRaw],
    ].map(([category, raw, bias]) => ({
      category,
      label: label(category),
      contribution: Math.round(raw / total * 100),
      direction: direction(bias),
      velocity: Math.round(clamp(Math.abs(bias) + raw / 10)),
    }));
  }
  function intelligence(row) {
    const participants = breakdown(row);
    const lead = [...participants].sort((a, b) => b.contribution - a.contribution)[0];
    const smart = participants.find((item) => item.category === "smart_money") || {};
    const retail = participants.find((item) => item.category === "retail") || {};
    const concentrationChange = lead.contribution >= 45 || row?.risk === "Elevated" ? "increasing" : lead.contribution <= 28 ? "decreasing" : "stable";
    const distributionRisk = row?.risk === "Elevated" || (retail.direction === "expanding" && smart.direction === "contracting") ? "elevated" : smart.direction === "expanding" ? "contained" : "moderate";
    const accumulationState = smart.direction === "expanding" && distributionRisk !== "elevated" ? "accumulating" : smart.direction === "contracting" ? "reducing" : "neutral";
    return {
      headline: `${lead.label} contribution leads participant read`,
      summary: "Participant Intelligence describes which behavior groups are contributing to pressure and structure. Wallet addresses are not exposed.",
      participants,
      leadParticipant: lead,
      conflictState: smart.direction !== retail.direction && smart.contribution >= 20 && retail.contribution >= 20 ? "conflicted" : "aligned",
      concentrationChange,
      distributionRisk,
      accumulationState,
    };
  }
  function injectStyles() {
    if (document.getElementById("ravenos-participant-styles")) return;
    const style = document.createElement("style");
    style.id = "ravenos-participant-styles";
    style.textContent = `
      .raven-participant { border:1px solid rgba(148,163,184,.18); background:rgba(5,11,9,.7); padding:12px; display:grid; gap:10px; }
      .raven-participant h3 { margin:0; font-size:13px; }
      .raven-participant p { margin:0; color:#b9c9c2; font-size:12px; line-height:1.45; }
      .raven-participant-row { display:grid; grid-template-columns:1fr auto; gap:8px; color:#9fb2aa; font-size:11px; border-bottom:1px solid rgba(148,163,184,.14); padding:6px 0; }
      .raven-participant-row strong { color:#edf6f1; }
      .raven-participant-track { height:6px; background:rgba(148,163,184,.14); margin-top:5px; }
      .raven-participant-fill { height:100%; background:linear-gradient(90deg,#7dd3fc,#34d399); }
      .raven-participant-kicker { color:#7dd3fc; font-size:10px; font-weight:850; text-transform:uppercase; }
    `;
    document.head.appendChild(style);
  }
  function ParticipantPanel(row) {
    injectStyles();
    const model = row?.participants ? row : intelligence(row);
    return `
      <section class="raven-participant">
        <div><span class="raven-participant-kicker">Participant Intelligence</span><h3>${esc(model.headline)}</h3><p>${esc(model.summary)}</p></div>
        ${(model.participants || []).map((item) => `<div>
          <div class="raven-participant-row"><span>${esc(item.label)} · ${esc(item.direction)}</span><strong>${item.contribution}% · v${item.velocity}</strong></div>
          <div class="raven-participant-track"><div class="raven-participant-fill" style="width:${item.contribution}%"></div></div>
        </div>`).join("")}
        <div class="raven-participant-row"><span>Conflict state</span><strong>${esc(model.conflictState)}</strong></div>
        <div class="raven-participant-row"><span>Concentration change</span><strong>${esc(model.concentrationChange)}</strong></div>
        <div class="raven-participant-row"><span>Distribution risk</span><strong>${esc(model.distributionRisk)}</strong></div>
        <div class="raven-participant-row"><span>Accumulation state</span><strong>${esc(model.accumulationState)}</strong></div>
      </section>
    `;
  }
  function render(target, row) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) el.innerHTML = ParticipantPanel(row);
  }
  window.RavenOSParticipants = { breakdown, intelligence, ParticipantPanel, render };
})();
