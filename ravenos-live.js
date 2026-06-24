(function () {
  const DEFAULT_INTERVALS = {
    "/api/terminal": 30000,
    "/api/opportunity": 60000,
    "/api/brief": 300000,
    "/api/replay": 900000,
    "/api/outcomes": 900000,
    "/api/memory": 900000,
    "/api/behavior": 900000,
    "/api/chains/solana": 120000,
    "/api/chains/base": 120000,
    "/api/chains/ethereum": 120000,
  };

  function ageLabel(seconds) {
    if (!Number.isFinite(seconds)) return "read forming";
    if (seconds < 60) return `updated ${Math.max(0, Math.floor(seconds))}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `updated ${minutes}m ago`;
    return `updated ${Math.floor(minutes / 60)}h ago`;
  }

  function endpointForPage() {
    const configured = document.documentElement.getAttribute("data-ravenos-api")
      || document.body?.getAttribute("data-ravenos-api");
    if (configured) return configured;
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/terminal") return "/api/terminal";
    if (path === "/opportunity") return "/api/opportunity";
    if (path === "/brief") return "/api/brief";
    if (path === "/replay") return "/api/replay";
    if (path === "/outcomes") return "/api/outcomes";
    if (path === "/memory") return "/api/memory";
    if (path === "/behavior") return "/api/behavior";
    if (path === "/chains/solana") return "/api/chains/solana";
    if (path === "/chains/base") return "/api/chains/base";
    if (path === "/chains/ethereum") return "/api/chains/ethereum";
    return "";
  }

  function ensureStrip() {
    let strip = document.querySelector("[data-ravenos-live-strip]");
    if (strip) return strip;
    strip = document.createElement("div");
    strip.setAttribute("data-ravenos-live-strip", "true");
    strip.style.cssText = [
      "border:1px solid rgba(148,163,184,.18)",
      "background:rgba(5,11,9,.92)",
      "color:#91a69d",
      "font:700 10px IBM Plex Mono,SFMono-Regular,ui-monospace,monospace",
      "letter-spacing:0",
      "text-transform:uppercase",
      "padding:7px 9px",
      "display:flex",
      "gap:10px",
      "align-items:center",
      "justify-content:space-between",
      "min-height:30px",
    ].join(";");
    const shell = document.querySelector(".shell") || document.querySelector("main") || document.body;
    const after = shell.querySelector("header");
    if (after && after.nextSibling) shell.insertBefore(strip, after.nextSibling);
    else shell.prepend(strip);
    return strip;
  }

  function setStrip(payload, error) {
    const strip = ensureStrip();
    const stale = payload?.stale || error;
    const status = error ? "Public read degraded" : stale ? "Using last verified public artifact" : "Live public read";
    const age = error ? "API unavailable" : ageLabel(Number(payload?.freshness_age_seconds));
    const coverage = payload?.coverage || (error ? "developing" : "active");
    strip.innerHTML = `<span>${status}</span><span>${age} · ${coverage}</span>`;
    strip.style.borderColor = stale ? "rgba(250,204,21,.35)" : "rgba(52,211,153,.30)";
  }

  function applyPayload(payload) {
    document.querySelectorAll("[data-live-field='updated']").forEach((node) => {
      node.textContent = ageLabel(Number(payload?.freshness_age_seconds));
    });
    document.querySelectorAll("[data-live-field='coverage']").forEach((node) => {
      node.textContent = payload?.coverage || "active";
    });
    setStrip(payload, false);
  }

  async function poll(endpoint) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok && !payload) throw new Error(`http_${response.status}`);
      applyPayload(payload);
      window.RavenOSLive = { endpoint, payload, updatedAt: new Date().toISOString() };
    } catch (error) {
      setStrip(null, true);
      window.RavenOSLive = { endpoint, error: String(error), updatedAt: new Date().toISOString() };
    }
  }

  function start() {
    const endpoint = endpointForPage();
    if (!endpoint) return;
    const baseInterval = DEFAULT_INTERVALS[endpoint] || 120000;
    poll(endpoint);
    window.setInterval(() => {
      if (document.hidden) return;
      poll(endpoint);
    }, baseInterval);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) poll(endpoint);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
