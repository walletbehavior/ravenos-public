(function () {
  const DEFAULT_INTERVALS = {
    "/api/terminal": 30000,
    "/api/opportunity": 60000,
    "/api/brief": 300000,
    "/api/replay": 900000,
    "/api/outcomes": 900000,
    "/api/memory": 900000,
    "/api/behavior": 900000,
    "/api/research": 300000,
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
    if (path === "/research") return "/api/research";
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dataFromPayload(payload) {
    return payload?.data || {};
  }

  function rowsFromPayload(payload) {
    const data = dataFromPayload(payload);
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.outcomes)) return data.outcomes;
    if (Array.isArray(data.comparables)) return data.comparables;
    if (Array.isArray(data.cards)) return data.cards;
    return [];
  }

  function rowRead(row) {
    return String(row?.derived_state || row?.participant_outcome || row?.read || row?.summary || "current read forming");
  }

  function marketVenueLabel(value) {
    const text = String(value || "market");
    return /^hyperliquid$/i.test(text) ? "Perps" : titleCase(text);
  }

  function capBandLabel(value) {
    const labels = {
      fresh_pairs: "Fresh Pairs",
      perps_all: "Perps",
      perps_alts: "Perps Alts",
      perps_large_alts: "Perps Large Alts",
      perps_majors: "Perps Majors",
    };
    return labels[String(value || "").toLowerCase()] || titleCase(value || "All");
  }

  function stateClassFor(read = "") {
    if (/improving|constructive|reward|favorable/i.test(read)) return "rewarding";
    if (/fragile|weak|punish|negative/i.test(read)) return "punishing";
    return "mixed";
  }

  function plainOpportunityRead(read = "") {
    return titleCase(read)
      .replace(/Punishing Outcomes/i, "Weak Outcome Evidence")
      .replace(/Rewarding Outcomes/i, "Constructive Outcome Evidence")
      .replace(/Outcomes Unclear/i, "Mixed Outcome Evidence")
      .replace(/Participation Punishing/i, "Participation Fragile")
      .replace(/Participation Rewarding/i, "Participation Constructive");
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
    const chain = marketVenueLabel(best.chain_label || best.chain || "Market");
    const band = capBandLabel(best.cap_band_label || best.cap_band || "Current");
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
    setText("oppParticipation", rewarding > punishing ? "Participation expanding" : punishing > rewarding ? "Participation fragile" : "Mixed participation");
    setText("oppConfidence", titleCase(best.confidence || (observed > 20 ? "moderate" : "developing")));
    setText("oppUsableSample", observed ? `${fmtNumber(observed)} rows` : "sample forming");
    setText("oppWhatChanged", summary.live_public_markets ? `${fmtNumber(summary.live_public_markets)} live public markets` : "public read refreshed");
    renderOpportunityTables(summary);
    renderOpportunityTiles(summary);
    renderOpportunityMatrix(summary);
    renderOpportunityDrilldown(summary);
  }

  function renderOpportunityTables(summary = {}) {
    const chainBody = document.getElementById("oppChainRows");
    if (chainBody && Array.isArray(summary.chain_rows)) {
      chainBody.innerHTML = summary.chain_rows.slice(0, 12).map((row) => {
        const edge = row.rewarding > row.punishing ? "High" : row.punishing > row.rewarding ? "Low" : "Medium";
        const edgeClass = edge === "High" ? "high" : edge === "Low" ? "low" : "medium";
        return `<tr><td>${escapeHtml(row.label)}</td><td class="edge ${edgeClass}">${edge}</td><td class="mono positive">${fmtNumber(row.rewarding)}</td><td class="mono negative">${fmtNumber(row.punishing)}</td><td>${escapeHtml(capBandLabel(row.top_row?.cap_band || row.key))}</td><td>${escapeHtml(plainOpportunityRead(row.read))}</td></tr>`;
      }).join("");
    }
    const capBody = document.getElementById("oppCapRows");
    if (capBody && Array.isArray(summary.cap_band_rows)) {
      capBody.innerHTML = summary.cap_band_rows.slice(0, 12).map((row) => {
        const activity = row.sample_size >= 1000 ? "Very High" : row.sample_size >= 250 ? "High" : row.sample_size >= 50 ? "Medium" : "Forming";
        return `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(marketVenueLabel(row.top_row?.chain || "Market"))}</td><td class="mono positive">${fmtNumber(row.rewarding)}</td><td class="mono negative">${fmtNumber(row.punishing)}</td><td>${activity}</td><td>${escapeHtml(plainOpportunityRead(row.read))}</td></tr>`;
      }).join("");
    }
  }

  function renderOpportunityTiles(summary = {}) {
    const host = document.getElementById("oppTopTiles");
    if (!host || !Array.isArray(summary.top_opportunities)) return;
    host.innerHTML = summary.top_opportunities.slice(0, 6).map((row) => {
      const positives = Array.isArray(row.what_is_working) ? row.what_is_working : [];
      const negatives = Array.isArray(row.what_could_fail) ? row.what_could_fail : [];
      const assets = Array.isArray(row.top_assets) && row.top_assets.length ? row.top_assets.join(", ") : "public sample forming";
      return `<article class="opportunity-tile">
        <span class="kicker">${escapeHtml(marketVenueLabel(row.chain_label || row.chain))} · ${escapeHtml(capBandLabel(row.cap_band_label || row.cap_band))}</span>
        <strong>${escapeHtml(plainOpportunityRead(row.read || row.why_now))}</strong>
        <span>${escapeHtml(row.why_now || "Current public read is forming.")}</span>
        <div class="score-drivers">
          <div><span class="kicker">Supports</span><ul>${positives.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
          <div><span class="kicker">Risks</span><ul>${negatives.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        </div>
        <div class="evidence-row"><span>Sample / assets</span><strong>${fmtNumber(row.sample_size)} · ${escapeHtml(assets)}</strong></div>
      </article>`;
    }).join("");
  }

  function renderOpportunityMatrix(summary = {}) {
    const host = document.getElementById("oppMatrix");
    if (!host || !Array.isArray(summary.matrix)) return;
    const chains = [...new Map(summary.matrix.map((row) => [row.chain, row.chain_label || row.chain])).entries()].slice(0, 6);
    const bands = [...new Map(summary.matrix.map((row) => [row.cap_band, row.cap_band_label || row.cap_band])).entries()].slice(0, 8);
    const byKey = new Map(summary.matrix.map((row) => [`${row.chain}:${row.cap_band}`, row]));
    const cells = [
      `<div class="matrix-cell header">Market</div>`,
      ...bands.map(([, label]) => `<div class="matrix-cell header">${escapeHtml(capBandLabel(label))}</div>`),
    ];
    for (const [chain, chainLabel] of chains) {
      cells.push(`<div class="matrix-cell header">${escapeHtml(marketVenueLabel(chainLabel))}</div>`);
      for (const [band] of bands) {
        const row = byKey.get(`${chain}:${band}`);
        if (!row) {
          cells.push(`<div class="matrix-cell mixed"><strong>--</strong><span>No read</span></div>`);
          continue;
        }
        const klass = stateClassFor(`${row.opportunity_label} ${row.outcome_direction} ${row.read}`);
        cells.push(`<button type="button" class="matrix-cell ${klass}" data-opp-cell="${escapeHtml(`${row.chain}:${row.cap_band}`)}"><strong>${escapeHtml(row.opportunity_label || "Mixed")}</strong><span>${escapeHtml(row.reward_punishment_status || row.read || "Read forming")}</span><em>${escapeHtml(row.confidence || "Developing")} · ${fmtNumber(row.sample_size)} sample</em></button>`);
      }
    }
    host.innerHTML = cells.join("");
    host.querySelectorAll("[data-opp-cell]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = byKey.get(button.getAttribute("data-opp-cell"));
        if (row) renderOpportunityDrilldown({ ...summary, selected_cell: row });
      });
    });
  }

  function renderOpportunityDrilldown(summary = {}) {
    const host = document.getElementById("oppDrilldown");
    if (!host) return;
    const row = summary.selected_cell || summary.matrix?.[0] || summary.top_opportunities?.[0] || {};
    const assets = Array.isArray(row.top_assets) && row.top_assets.length ? row.top_assets.join(", ") : "public sample forming";
    host.innerHTML = `<div class="evidence-grid" style="margin-top:10px;">
      <article class="evidence-card"><h4>What Raven Believes</h4><p>${escapeHtml(marketVenueLabel(row.chain_label || row.chain))} ${escapeHtml(capBandLabel(row.cap_band_label || row.cap_band))} is ${escapeHtml(String(row.opportunity_label || row.read || "forming").toLowerCase())}.</p><div class="evidence-row"><span>Sample</span><strong>${fmtNumber(row.sample_size || 0)}</strong></div></article>
      <article class="evidence-card"><h4>What Is Working</h4><p>${escapeHtml(row.participation_status || row.why_now || "Participation evidence is forming.")}</p><div class="evidence-row"><span>Assets</span><strong>${escapeHtml(assets)}</strong></div></article>
      <article class="evidence-card"><h4>What Is Weak</h4><p>${escapeHtml(row.outcome_direction === "weak" ? "Weak outcome evidence remains visible." : "Confirmation and survival still need followthrough.")}</p><div class="evidence-row"><span>Would weaken</span><strong>Survival fades</strong></div></article>
      <article class="evidence-card"><h4>Evidence</h4><p>Public aggregate participation, outcome quality, top public assets, and current refresh age.</p><div class="evidence-row"><span>Confidence</span><strong>${escapeHtml(row.confidence || "Developing")}</strong></div></article>
    </div>`;
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
        return `<tr><td>${marketVenueLabel(row.chain || "market")}</td><td>${titleCase(row.cap_band || "all")}</td><td>${fmtNumber(row.observed_sample || row.observed || sampleOf(row))}</td><td>${fmtNumber(row.clean_sample || sampleOf(row))}</td><td class="${stateClass}">${titleCase(read)}</td><td>${confidence}</td><td>${sampleOf(row) < 20 ? "Sample forming" : "Usable public sample"}</td></tr>`;
      }).join("");
    }
  }

  function renderChainLive(payload) {
    const summary = payload?.summary || {};
    const best = summary.best_surface || bestRows(payload)[0] || {};
    setText("chainTopSurface", capBandLabel(summary.best_cap_band?.label || best.cap_band || "Current surface"));
    setText("chainParticipation", best.read ? plainOpportunityRead(best.read) : "Current read forming");
    setText("chainSample", best.sample_size ? fmtNumber(best.sample_size) : fmtNumber(summary.observed_rows || rowsFromPayload(payload).length));
    setText("chainConfidence", titleCase(best.confidence || "developing"));
    setText("chainUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("chainCurrentRead", summary.current_read || "Current chain read is forming.");
    setText("chainWeakestArea", summary.weakest_cap_band?.label ? capBandLabel(summary.weakest_cap_band.label) : "Sample forming");
    setText("chainTopAssets", Array.isArray(summary.top_assets) && summary.top_assets.length ? summary.top_assets.slice(0, 8).join(", ") : "Public sample forming");
    const body = document.getElementById("chainCapRows");
    if (body && Array.isArray(summary.cap_band_rows)) {
      body.innerHTML = summary.cap_band_rows.slice(0, 12).map((row) => {
        const klass = stateClassFor(`${row.opportunity_label} ${row.read}`);
        return `<tr><td>${escapeHtml(capBandLabel(row.label))}</td><td class="${klass === "rewarding" ? "positive" : klass === "punishing" ? "negative" : "mixed"}">${escapeHtml(plainOpportunityRead(row.read))}</td><td>${fmtNumber(row.rewarding)}</td><td>${fmtNumber(row.punishing)}</td><td>${fmtNumber(row.sample_size)}</td><td>${escapeHtml(row.confidence)}</td></tr>`;
      }).join("");
    }
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

  function confidenceFromSample(sample, fallback = "developing") {
    const n = Number(sample);
    if (!Number.isFinite(n)) return titleCase(fallback);
    if (n >= 1000) return "High";
    if (n >= 100) return "Moderate";
    if (n >= 20) return "Developing";
    return "Low";
  }

  function renderBriefLive(payload) {
    const data = dataFromPayload(payload);
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const read = data.one_sentence_read || data.summary || "Current market read is forming.";
    const stale = payload?.stale;
    setText("briefReadTitle", titleCase(read));
    setText("briefReadSummary", stale
      ? "This brief is using the last verified public read while the next source artifact forms."
      : "This brief is hydrated from the current public artifact and refreshed without rebuilding the site.");
    setText("briefHeroSurface", data.best_surface || data.best_opportunity_surface || "Current surface forming");
    setText("briefBestSurface", data.best_surface || data.best_opportunity_surface || "Sample forming");
    setText("briefRisk", warnings.length ? titleCase(warnings[0]) : "Confirmation depth");
    setText("briefParticipation", data.participation_change || (warnings.length ? "Developing" : "Expanding"));
    setText("briefPressure", data.pressure_change || "Context forming");
    setText("briefReward", data.reward_change || "Observed outcomes forming");
    setText("briefRegime", data.most_similar_regime || data.regime || "Replay context forming");
    setText("briefUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("briefCoverage", payload?.coverage || "active");
    setText("briefAnalogCount", fmtNumber(data.historical_analog_count || data.analog_count || 0));
    setText("briefConfidenceReason", stale ? "Delayed context: freshness is the weakest input." : "Current artifact available with public-safe evidence.");
  }

  function renderReplayLive(payload) {
    const data = dataFromPayload(payload);
    const rows = Array.isArray(data.comparables) ? data.comparables : rowsFromPayload(payload);
    const expanded = rows.filter((row) => /expand|constructive|reward/i.test(String(row.after_window_summary || row.public_read || row.outcome || ""))).length;
    const failed = rows.filter((row) => /fail|weak|punish|deterior/i.test(String(row.after_window_summary || row.public_read || row.outcome || ""))).length;
    const stalled = Math.max(0, rows.length - expanded - failed);
    const best = rows[0] || {};
    setText("replayAnalogCount", rows.length ? `${fmtNumber(rows.length)} Similar Structures` : "Replay Set Forming");
    setText("replayExpanded", fmtNumber(expanded));
    setText("replayStalled", fmtNumber(stalled));
    setText("replayFailed", fmtNumber(failed));
    setText("replayConfidence", confidenceFromSample(rows.length, payload?.stale ? "low" : "developing"));
    setText("replayUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("replayCoverage", payload?.coverage || "active");
    setText("replayStrongestSignal", titleCase((best.match_reasons || [])[0] || "participation breadth"));
    setText("replayWeakestSignal", payload?.stale ? "Freshness" : "Confirmation depth");
    const tbody = document.getElementById("replayAnalogRows");
    if (tbody && rows.length) {
      tbody.innerHTML = rows.slice(0, 8).map((row) => {
        const similarity = Number(row.similarity_score);
        const pct = Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : "forming";
        const reasons = Array.isArray(row.match_reasons) ? row.match_reasons.slice(0, 3).map(titleCase).join(", ") : "Public structure features";
        const read = row.public_read || row.after_window_summary || "Comparable structure observed.";
        const outcome = /fail|weak/i.test(read) ? "Fragile" : /stall|mixed/i.test(read) ? "Stalled" : "Observed";
        const klass = outcome === "Fragile" ? "negative" : outcome === "Stalled" ? "mixed" : "positive";
        return `<tr><td>${escapeHtml(row.matched_window_start || row.window || "Historical window")}</td><td>${escapeHtml(pct)}</td><td>${escapeHtml(reasons)}</td><td class="${klass}">${escapeHtml(outcome)}</td><td>${escapeHtml(read)}</td></tr>`;
      }).join("");
    }
  }

  function renderMemoryLive(payload) {
    const data = dataFromPayload(payload);
    const families = data.frequent_condition_families || {};
    const entries = Object.entries(families).sort((a, b) => Number(b[1]) - Number(a[1]));
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const dominant = data.dominant_condition_family || entries[0]?.[0] || "memory forming";
    const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
    setText("memoryReadTitle", `${titleCase(dominant)} remains the dominant public memory family.`);
    setText("memoryReadSummary", cards[0]?.summary || "Market Memory is tracking whether current structures repeat, change, or disappear.");
    setText("memoryDominant", titleCase(dominant));
    setText("memoryFrequency", total ? fmtNumber(total) : "sample forming");
    setText("memoryRank", titleCase(data.condition_stability || "forming"));
    setText("memorySample", total ? `${fmtNumber(total)} public records` : "sample forming");
    setText("memoryFreshness", ageLabel(Number(payload?.freshness_age_seconds)));
    setText("memoryTrend", titleCase(data.consistency_trend || "mixed"));
    const tbody = document.getElementById("memoryCommonRows");
    if (tbody && entries.length) {
      tbody.innerHTML = entries.slice(0, 8).map(([name, count]) => {
        const confidence = confidenceFromSample(count);
        return `<tr><td>${escapeHtml(titleCase(name))}</td><td>${escapeHtml(fmtNumber(count))}</td><td>Tracked across public memory refreshes</td><td>${escapeHtml(confidence)}</td><td>Shows whether this condition keeps appearing or fades.</td></tr>`;
      }).join("");
    }
  }

  function renderBehaviorLive(payload) {
    const data = dataFromPayload(payload);
    const rows = rowsFromPayload(payload);
    const rewarding = rows.filter(isRewarding).length;
    const punishing = rows.filter(isPunishing).length;
    const mixed = Math.max(0, rows.length - rewarding - punishing);
    const best = bestRows(payload)[0] || {};
    setText("behaviorReadTitle", rows.length
      ? `${marketVenueLabel(best.chain || "Market")} ${titleCase(best.cap_band || "participation")} has the clearest behavior surface, but confirmation is still thin.`
      : "Behavior read is forming.");
    setText("behaviorReadSummary", rows.length
      ? `What Raven believes: participation is returning in visible pockets, but it remains concentrated until survival and rewarding outcomes broaden across more markets. Evidence comes from ${fmtNumber(rows.length)} aggregate public rows.`
      : "Behavior Explorer is waiting for a usable public participant artifact.");
    setText("behaviorState", rewarding > punishing ? "Constructive But Fragile" : punishing > rewarding ? "Early Participation Returning" : "Confirmation Still Thin");
    setText("behaviorNew", best.derived_state ? titleCase(best.derived_state).replace(/Outcomes Unclear/i, "Mixed Outcome Evidence") : "Early Participation Returning");
    setText("behaviorReturning", rows.length ? `${fmtNumber(rows.length)} aggregate rows` : "Sample forming");
    setText("behaviorConcentration", punishing > rewarding ? "Concentrated participation risk" : "Concentration manageable");
    setText("behaviorBreadth", mixed > rewarding ? "Broadening watch" : "Broadening selectively");
    setText("behaviorSurvival", data.metadata?.timeframe ? "Survival evidence forming" : "Followthrough forming");
    setText("behaviorUpdated", ageLabel(Number(payload?.freshness_age_seconds)));
    const tbody = document.getElementById("behaviorRows");
    if (tbody && rows.length) {
      tbody.innerHTML = bestRows(payload).slice(0, 12).map((row) => {
        const read = rowRead(row);
        const stateClass = isRewarding(row) ? "positive" : isPunishing(row) ? "negative" : "mixed";
        const behaviorState = titleCase(row.derived_state || "observable").replace(/Outcomes Unclear/i, "Mixed Outcome Evidence").replace(/Participation Punishing/i, "Participation Fragile").replace(/Participation Rewarding/i, "Participation Constructive");
        const outcomeLabel = titleCase(row.profitability_label || "mixed outcomes").replace(/Punishing Outcomes/i, "Weak Outcome Evidence").replace(/Rewarding Outcomes/i, "Constructive Outcome Evidence").replace(/Mixed Outcomes/i, "Mixed Outcome Evidence");
        return `<tr><td>${escapeHtml(marketVenueLabel(row.chain || "market"))}</td><td>${escapeHtml(titleCase(row.cap_band || "all"))}</td><td>${escapeHtml(behaviorState)}</td><td>${escapeHtml(titleCase(row.score_strength || "developing"))}</td><td>${escapeHtml(outcomeLabel)}</td><td class="${stateClass}">${escapeHtml(titleCase(read).replace(/Outcomes Unclear/i, "Mixed Outcome Evidence"))}</td><td>${escapeHtml(sampleOf(row) < 20 ? "Sample forming" : "Public aggregate")}</td></tr>`;
      }).join("");
    }
  }

  function applyPagePayload(endpoint, payload) {
    if (endpoint === "/api/opportunity") renderOpportunityLive(payload);
    if (endpoint === "/api/brief") renderBriefLive(payload);
    if (endpoint === "/api/replay") renderReplayLive(payload);
    if (endpoint === "/api/outcomes") renderOutcomesLive(payload);
    if (endpoint === "/api/memory") renderMemoryLive(payload);
    if (endpoint === "/api/behavior") renderBehaviorLive(payload);
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
