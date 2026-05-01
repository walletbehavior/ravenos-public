const DATA_URL = "./data/ravenos_summary.json";

function fmtDate(value) {
  if (!value) return "Unknown";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(dt);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pillClass(status) {
  if (!status) return "pill";
  const v = String(status).toLowerCase();
  if (["fresh", "positive", "available", "good", "healthy"].includes(v)) return "pill good";
  if (["stale", "degraded", "caution", "warning", "conflicting", "mixed"].includes(v)) return "pill warn";
  return "pill bad";
}

function renderWarnings(warnings) {
  const wrap = document.getElementById("warning-list");
  wrap.innerHTML = "";
  if (!warnings || !warnings.length) {
    wrap.innerHTML = '<span class="chip">No warnings</span>';
    return;
  }
  for (const warning of warnings) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = warning;
    wrap.appendChild(chip);
  }
}

function renderLanes(lanes) {
  const wrap = document.getElementById("lane-list");
  wrap.innerHTML = "";
  if (!lanes || !lanes.length) {
    wrap.innerHTML = '<div class="lane">No lane data available.</div>';
    return;
  }
  for (const lane of lanes) {
    const card = document.createElement("article");
    card.className = "lane";
    card.innerHTML = `
      <div class="lane-head">
        <div>
          <h3>${lane.chain || "Unknown"} ${lane.lane || "lane"}</h3>
          <div class="meta">${lane.followthrough_quality || "unknown"} follow-through</div>
        </div>
        <span class="${pillClass(lane.status)}">${lane.status || "unknown"}</span>
      </div>
      <div class="meta">
        Sample size: ${lane.sample_size ?? "n/a"}<br />
        Trust: ${lane.trust_level || "unknown"}<br />
        Outlier warning: ${lane.outlier_warning ? "yes" : "no"}
      </div>
    `;
    wrap.appendChild(card);
  }
}

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    setText("freshness", data.freshness?.status || "unknown");
    setText("read-mode", data.read_mode || data.behavior_guidance?.read_mode || "watchlist");
    setText("generated-at", fmtDate(data.generated_at));
    setText("public-read", data.public_read || data.regime_quality?.public_read || "Public-safe summary unavailable.");
    setText("regime-direction", data.regime?.direction || data.regime_quality?.latest_window_direction || "unknown");
    setText("regime-confirmation", data.regime?.confirmation || data.regime_quality?.longer_window_confirmation || "unknown");
    setText("regime-consistency", data.regime?.consistency || data.regime_quality?.consistency || "unknown");
    setText("regime-outlier", data.regime?.outlier_dependency || data.regime_quality?.outlier_dependency || "unknown");
    setText("source-status", data.source_quality?.status || "unknown");
    setText("source-label", data.source_quality?.label || "unknown");
    setText("source-age", `${Math.round(Number(data.freshness?.age_seconds ?? data.age_seconds ?? 0))}s`);
    setText("source-ttl", `${data.ttl_seconds || 900}s`);

    const statusPill = document.getElementById("status-pill");
    if (statusPill) {
      statusPill.className = pillClass(data.freshness?.status || data.source_quality?.status || "unknown");
      statusPill.textContent = data.freshness?.status || data.source_quality?.status || "unknown";
    }

    renderWarnings(data.warnings || data.operator_bias_risk || []);
    renderLanes(data.lane_quality || data.chains?.flatMap((chain) => chain.lanes || []) || []);
  } catch (err) {
    setText("freshness", "stale");
    setText("read-mode", "watchlist");
    setText("generated-at", "Awaiting sync");
    setText("public-read", "Public-safe summary is unavailable. The site is live, but the data sync has not yet populated a fresh snapshot.");
    setText("regime-direction", "unknown");
    setText("regime-confirmation", "unknown");
    setText("regime-consistency", "unknown");
    setText("regime-outlier", "unknown");
    setText("source-status", "missing");
    setText("source-label", "placeholder");
    setText("source-age", "n/a");
    setText("source-ttl", "900s");
    renderWarnings(["awaiting_public_safe_sync", "placeholder_mode"]);
    renderLanes([]);
    const statusPill = document.getElementById("status-pill");
    if (statusPill) {
      statusPill.className = "pill bad";
      statusPill.textContent = "awaiting data";
    }
    console.warn("RavenOS public summary load failed:", err);
  }
}

loadData();
