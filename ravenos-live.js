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

  function fmtNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  }

  function titleCase(value) {
    return String(value || "Current")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function rowsFromPayload(payload) {
    const data = payload?.data || {};
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.outcomes)) return data.outcomes;
    return [];
  }

  function rowRead(row) {
    return String(row?.derived_state || row?.participant_outcome || row?.read || row?.summary || "current read forming");
  }

  function isRewarding(row) {
    return /reward|favorable|improving|constructive/i.test(rowRead(row));
  }

  function isPunishing(row) {
    return /punish|struggling|weakening|fragile/i.test(rowRead(row));
  }

  function sampleOf(row) {
    return Number(row?.sample_size || row?.clean_sample || row?.observed_sample || row?.observed || 0) || 0;
  }

  function bestRows(payload) {
    const rows = rowsFromPayload(payload);
    return [...rows].sort((a, b) => {
      const aScore = (isRewarding(a) ? 100 : isPunishing(a) ? -20 : 10) + sampleOf(a);
      const bScore = (isRewarding(b) ? 100 : isPunishing(b) ? -20 : 10) + sampleOf(b);
      return bScore - aScore;
    });
  }

  function renderOpportunityLive(payload) {
    const summary = payload?.summary || {};
    const best = summary.best_surface || bestRows(payload)[0] || {};
    const chain = titleCase(best.chain || "Market");
    const band = titleCase(best.cap_band || "Current");
    const surface = `${chain} ${band}`.trim();
    const rewarding = Number(summary.rewarding_count);
    const punishing = Number(summary.punishing_count);
    const observed = Number(summary.observed_rows || rowsFromPayload(payload).length);
    const mixed = Number(summary.mixed_count);
    setText("oppHotSector", surface);
    setText("oppBestChain", chain);
    setText("oppBestBand", band);
    setText("oppRewarding", Number.isFinite(rewarding) ? fmtNumber(rewarding) : "forming");
    setText("oppPunishing", Number.isFinite(punishing) ? fmtNumber(punishing) : "forming");
    setText("oppUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("oppHeroSurface", surface);
    setText("oppHeroDetail", best.read || best.summary || "Current public participation read is forming from live public context.");
    setText("oppParticipation", rewarding > punishing ? "Expanding" : punishing > rewarding ? "Fragile" : "Mixed");
    setText("oppConfidence", titleCase(best.confidence || (observed > 20 ? "moderate" : "developing")));
    setText("oppUsableSample", observed ? `${fmtNumber(observed)} rows` : "sample forming");
    setText("oppWhatChanged", summary.live_public_markets ? `${fmtNumber(summary.live_public_markets)} live public markets` : "public read refreshed");
  }

  function renderOutcomesLive(payload) {
    const rows = rowsFromPayload(payload);
    const rewarding = rows.filter(isRewarding).length;
    const punishing = rows.filter(isPunishing).length;
    const mixed = rows.filter((row) => !isRewarding(row) && !isPunishing(row)).length;
    const observed = rows.reduce((sum, row) => sum + sampleOf(row), 0);
    setText("outGenerated", payload?.generated_at ? new Date(payload.generated_at).toISOString().slice(0, 16).replace("T", " ") : "current read forming");
    setText("outHeroBadge", rewarding > punishing ? "Rewarding / Forming" : punishing > rewarding ? "Punishing / Forming" : "Mixed / Forming");
    setText("outHeroSummary", rows.length
      ? `Current public outcome layer has ${fmtNumber(rows.length)} aggregate rows and ${fmtNumber(observed)} observed samples.`
      : "Outcome sample is forming from public artifacts.");
    setText("outRewardingCount", fmtNumber(rewarding));
    setText("outPunishingCount", fmtNumber(punishing));
    setText("outMixedCount", fmtNumber(mixed));
    setText("outInsufficientCount", rows.length ? fmtNumber(rows.filter((row) => sampleOf(row) < 20).length) : "forming");
    const tbody = document.getElementById("outBreakdownRows");
    if (tbody && rows.length) {
      tbody.innerHTML = rows.slice(0, 12).map((row) => {
        const read = rowRead(row);
        const confidence = titleCase(row.confidence || (sampleOf(row) >= 50 ? "moderate" : "developing"));
        const stateClass = isRewarding(row) ? "positive" : isPunishing(row) ? "negative" : "mixed";
        return `<tr><td>${titleCase(row.chain || "market")}</td><td>${titleCase(row.cap_band || "all")}</td><td>${fmtNumber(row.observed_sample || row.observed || sampleOf(row))}</td><td>${fmtNumber(row.clean_sample || sampleOf(row))}</td><td class="${stateClass}">${titleCase(read)}</td><td>${confidence}</td><td>${sampleOf(row) < 20 ? "Sample forming" : "Usable public sample"}</td></tr>`;
      }).join("");
    }
  }

  function renderChainLive(payload) {
    const summary = payload?.summary || {};
    const best = summary.best_surface || bestRows(payload)[0] || {};
    setText("chainTopSurface", titleCase(best.cap_band || "Current surface"));
    setText("chainParticipation", best.read ? titleCase(best.read) : "Current read forming");
    setText("chainSample", best.sample_size ? fmtNumber(best.sample_size) : fmtNumber(summary.observed_rows || rowsFromPayload(payload).length));
    setText("chainConfidence", titleCase(best.confidence || "developing"));
    setText("chainUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
  }

  function renderTerminalLive(payload) {
    const summary = payload?.summary || {};
    setText("tickerUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("tickerCoverage", payload?.coverage || "active");
    if (summary.perps?.count) {
      const hot = document.querySelector(".hot-sector strong");
      if (hot) hot.textContent = `${fmtNumber(summary.perps.count)} live perps`;
    }
  }

  function applyPagePayload(endpoint, payload) {
    if (endpoint === "/api/opportunity") renderOpportunityLive(payload);
    if (endpoint === "/api/outcomes") renderOutcomesLive(payload);
    if (endpoint === "/api/terminal") renderTerminalLive(payload);
    if (endpoint.startsWith("/api/chains/")) renderChainLive(payload);
  }

  function applyPayload(endpoint, payload) {
    document.querySelectorAll("[data-live-field='updated']").forEach((node) => {
      node.textContent = ageLabel(Number(payload?.freshness_age_seconds));
    });
    document.querySelectorAll("[data-live-field='coverage']").forEach((node) => {
      node.textContent = payload?.coverage || "active";
    });
    setStrip(payload, false);
    applyPagePayload(endpoint, payload);
  }

  async function poll(endpoint) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok && !payload) throw new Error(`http_${response.status}`);
      applyPayload(endpoint, payload);
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
