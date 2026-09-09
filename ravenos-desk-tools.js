import { ravenOSContext } from "./ravenos-context-store.js";
import { matchesMarketScope } from "./ravenos-market-scope.js";
import {
  normalizeChartInstrument,
  canonicalInstrumentId,
} from "./ravenos-chart-data-plane.js";
// Bounded, public-only desk preferences. Quotes and account data are never persisted.
const KEY = "ravenos.terminal.tools.v1";
const FRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const cleanName = (value) =>
  String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 32);
export function toolPreferences(value) {
  const names = new Set();
  const lists = (Array.isArray(value?.lists) ? value.lists : [])
    .slice(0, 8)
    .map((row) => ({
      name: cleanName(row?.name),
      keys: [
        ...new Set(
          (Array.isArray(row?.keys) ? row.keys : []).filter(
            (k) => typeof k === "string" && k.length < 240,
          ),
        ),
      ].slice(0, 20),
    }))
    .filter((row) => row.name && !names.has(row.name) && names.add(row.name));
  const workspaces = (Array.isArray(value?.workspaces) ? value.workspaces : [])
    .slice(0, 8)
    .filter((row) => cleanName(row?.name))
    .map((row) => ({
      name: cleanName(row.name),
      layout: ["balanced", "analysis", "focus"].includes(row.layout)
        ? row.layout
        : "balanced",
      split: row.split === true,
      linked: row.linked !== false,
      frame: FRAMES.includes(row.frame) ? row.frame : "4h",
      rail: row.rail !== false,
      marketKey:
        typeof row.marketKey === "string" ? row.marketKey.slice(0, 240) : "",
      list: cleanName(row.list),
      primaryFrame: FRAMES.includes(row.primaryFrame) ? row.primaryFrame : "1h",
    }));
  return {
    lists,
    workspaces,
    list: lists.some((row) => row.name === value?.list) ? value.list : "",
    sort: ["name", "change", "volume"].includes(value?.sort)
      ? value.sort
      : "recent",
    comparisonKey:
      typeof value?.comparisonKey === "string"
        ? value.comparisonKey.slice(0, 240)
        : "",
    split: value?.split === true,
    linked: value?.linked !== false,
    frame: FRAMES.includes(value?.frame) ? value.frame : "4h",
  };
}
export function marketRequest(market, timeframe = "1h") {
  if (market.lane === "perps")
    return {
      market: "perpetuals",
      asset: market.asset,
      chain: "hyperliquid",
      timeframe,
      instrumentScope: "exact_instrument",
      marketIdentity: `hyperliquid:perp:${market.asset.replace(/-PERP$/, "")}`,
      expectedIdentity: {
        instrumentType: "perpetual",
        identityScope: "venue_market",
        chain: "hyperliquid",
        venue: "hyperliquid",
        baseAsset: market.asset.replace(/-PERP$/, ""),
        quoteAsset: "USD",
      },
    };
  if (market.lane === "spot")
    return {
      market: "crypto_spot",
      asset: market.label,
      timeframe,
      chain: market.chain,
      pairAddress: market.pool,
      tokenAddress: market.token,
      quoteAddress: market.quote,
      instrumentScope: "exact_pool",
      marketIdentity: `${market.chain}:pool:${market.pool}`,
      expectedIdentity: {
        instrumentType: "spot_pool",
        identityScope: "exact_pool",
        chain: market.chain,
        poolAddress: market.pool,
        tokenAddress: market.token,
      },
    };
  return {
    market: "equities",
    asset: market.asset,
    timeframe,
    chain: "none",
    instrumentId: market.instrumentId,
    marketIdentity: market.instrumentId,
    instrumentScope: "exact_instrument",
    expectedIdentity: {
      canonicalId: market.instrumentId,
      instrumentType: market.instrumentId.split(":")[0],
      identityScope: "venue_market",
      chain: "none",
      venue: market.instrumentId.split(":")[1],
      baseAsset: market.asset,
      quoteAsset: "USD",
    },
  };
}
export function quoteMatchesMarket(market, payload) {
  if (payload?.ok !== true || !payload.instrument) return false;
  const instrument = normalizeChartInstrument(payload.instrument);
  const request = marketRequest(market);
  // The chart API also emits the legacy chain:pool key. Accept that alias
  // only alongside the exact chain, pool and token checks below.
  const identities = [request.marketIdentity, instrument.canonical_id];
  if (market.lane === "spot") identities.push(`${market.chain}:${market.pool}`);
  if (payload.market_identity && !identities.includes(payload.market_identity)) return false;
  if (market.lane === "perps")
    return (
      instrument.instrument_type === "perpetual" &&
      instrument.chain === "hyperliquid" &&
      instrument.venue === "hyperliquid" &&
      instrument.symbol === market.asset &&
      instrument.quote_asset === "USD" &&
      [request.marketIdentity, canonicalInstrumentId(instrument)].includes(
        instrument.canonical_id,
      )
    );
  if (market.lane === "equity")
    return (
      instrument.canonical_id === market.instrumentId &&
      instrument.symbol === market.asset &&
      ["equity", "etf"].includes(instrument.instrument_type)
    );
  const equal = (a, b) =>
    market.chain === "solana"
      ? a === b
      : String(a).toLowerCase() === String(b).toLowerCase();
  return (
    instrument.instrument_type === "spot_pool" &&
    instrument.identity_scope === "exact_pool" &&
    instrument.chain === market.chain &&
    equal(instrument.pool_address, market.pool) &&
    equal(instrument.token_address, market.token)
  );
}
export function quoteFromCandles(candles, observedAt, source) {
  const rows = (Array.isArray(candles) ? candles : [])
    .filter(
      (x) =>
        Number.isFinite(Number(x.close)) &&
        Number(x.close) > 0 &&
        Number.isFinite(Number(x.time)),
    )
    .sort((a, b) => a.time - b.time)
    .slice(-25);
  if (!rows.length) return null;
  const price = Number(rows.at(-1).close),
    first = Number(rows[0].close);
  return {
    price,
    change: rows.length > 1 ? (price / first - 1) * 100 : null,
    volume: rows.reduce(
      (n, r) =>
        n +
        (Number.isFinite(Number(r.volume)) ? Math.max(0, Number(r.volume)) : 0),
      0,
    ),
    points: rows.map((r) => Number(r.close)),
    observedAt,
    source: String(source || "Chart provider"),
    start: rows[0].time,
    end: rows.at(-1).time,
  };
}
export function quoteFromCurrentChart(market, state) {
  if (!market || !["live", "historical", "delayed", "provider_managed"].includes(state?.state)) return null;
  if (!quoteMatchesMarket(market, { ok: true, instrument: state.instrument, market_identity: state.marketIdentity })) return null;
  if (state.state === 'provider_managed') return quoteFromMarketSnapshot(state.marketState);
  return quoteFromCandles(state.candles, state.observedAt, state.source);
}
export function quoteFromMarketSnapshot(snapshot) {
  const price = Number(snapshot?.last);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(snapshot?.observed_at))) return null;
  return { price, observedAt: snapshot.observed_at, source: String(snapshot.source || 'Market snapshot'),
    kind: 'market_snapshot', change: null, volume: null, points: [], start: null, end: null };
}
const number = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(n) < 0.01 ? 8 : Math.abs(n) < 1 ? 6 : 2,
        notation: Math.abs(n) >= 1e6 ? "compact" : "standard",
      }).format(n)
    : "—";
export function enhanceDesk({
  root,
  toolbar,
  rail,
  dock,
  prefs,
  save,
  apply,
  render,
  openMarket,
  inspectPane,
}) {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  const tools = toolPreferences(stored),
    quotes = new Map();
  let primary = null,
    secondary = null,
    active = null,
    secondaryKey = tools.comparisonKey,
    lastRequest = "",
    refreshing = false,
    destroyed = false;
  const persist = () => {
    tools.comparisonKey = secondaryKey;
    try {
      localStorage.setItem(KEY, JSON.stringify(tools));
    } catch {}
  };
  const controls = document.createElement("details");
  controls.className = "desk-workspace-menu";
  controls.id = "deskWorkspaceMenu";
  controls.innerHTML = `<summary>Workspace</summary><div class="desk-workspace-options"><label><input id="deskSplit" type="checkbox"> Two charts</label><label><input id="deskLinked" type="checkbox"> Follow selected market</label><label>Comparison timeframe<select id="deskFrame">${FRAMES.map((x) => `<option>${x}</option>`).join("")}</select></label><label>Comparison market<select id="deskComparisonMarket"></select></label><label>Workspace name<input id="deskWorkspaceName" maxlength="32" placeholder="e.g. Morning research"></label><button id="deskSaveWorkspace" type="button">Save workspace</button><label>Saved workspaces<select id="deskSavedWorkspace"><option value="">Choose workspace</option></select></label><button id="deskDeleteWorkspace" type="button">Delete selected workspace</button><div id="deskWorkspaceStatus" role="status"></div></div>`;
  toolbar.querySelector(".desk-toolbar-end").prepend(controls);
  const listControls = document.createElement("div");
  listControls.className = "desk-list-controls";
  listControls.innerHTML = `<label class="sr-only" for="deskList">Watchlist</label><select id="deskList"><option value="">All markets</option></select><label class="sr-only" for="deskSort">Sort markets</label><select id="deskSort"><option value="recent">Recent</option><option value="name">Name</option><option value="change">Window change</option><option value="volume">Window volume</option></select><details><summary>Manage lists</summary><label>List name<input id="deskListName" maxlength="32" placeholder="e.g. Majors"></label><button id="deskCreateList" type="button">Create list</button><button id="deskAddToList" type="button">Add selected market</button><button id="deskRemoveFromList" type="button">Remove selected market</button><button id="deskDeleteList" type="button">Delete list</button><div id="deskListStatus" role="status"></div></details>`;
  rail.querySelector("header").after(listControls);
  const brief = document.createElement("section");
  brief.className = "desk-research-brief";
  brief.setAttribute("aria-label", "Market research brief");
  brief.innerHTML =
    '<details class="desk-brief-disclosure"><summary>Market brief <span>Show evidence</span></summary><p class="desk-brief-source"></p><dl></dl><p class="desk-brief-method">Calculated from the selected chart window. Direction, range and volume describe observed trading; they are not forecasts.</p></details>';
  dock.querySelector(".desk-dock-nav").after(brief);
  const status = document.createElement("div");
  status.className = "desk-feed-status";
  status.setAttribute("role", "status");
  status.innerHTML =
    '<span>Loading your trading desk…</span><button type="button" hidden>Retry data</button>';
  root.querySelector(".terminal-market-head").after(status);
  const comparison = document.createElement("section");
  comparison.className = "desk-comparison";
  comparison.hidden = true;
  comparison.innerHTML =
    '<header><strong>Comparison chart</strong><span>Research only · primary market controls trade review</span><button type="button" id="deskRetryComparison">Refresh chart</button></header><div id="deskComparisonChart"></div>';
  root.querySelector(".terminal-chart-panel").append(comparison);
  const get = (id) => document.getElementById(id);
  get("deskRetryComparison").addEventListener("click", () => {
    if (secondary?.lastRequest)
      secondary.load({ ...secondary.lastRequest, preserveChart: true });
  });
  function syncControls() {
    get("deskSplit").checked = tools.split;
    get("deskLinked").checked = tools.linked;
    get("deskFrame").value = tools.frame;
    get("deskComparisonMarket").disabled = tools.linked;
    get("deskList").replaceChildren(
      new Option("All markets", ""),
      ...tools.lists.map((x) => new Option(x.name, x.name)),
    );
    get("deskList").value = tools.list;
    get("deskSort").value = tools.sort;
    get("deskSavedWorkspace").replaceChildren(
      new Option("Choose workspace", ""),
      ...tools.workspaces.map((x, i) => new Option(x.name, String(i))),
    );
    get("deskComparisonMarket").replaceChildren(
      ...prefs.markets.filter(x => matchesMarketScope(x, ravenOSContext.getState().marketScope)).map((x) => new Option(x.label, x.key)),
    );
    get("deskComparisonMarket").value = secondaryKey || active?.key || "";
  }
  function change() {
    persist();
    syncControls();
    render();
    syncComparison();
  }
  async function syncComparison() {
    if (!primary) return;
    comparison.hidden = !tools.split;
    root.dataset.deskSplit = String(tools.split);
    if (!tools.split) {
      secondary?.destroy();
      secondary = null;
      lastRequest = "";
      requestAnimationFrame(() => primary.chartHandle?.resize?.());
      return;
    }
    const market = tools.linked
      ? active
      : prefs.markets.find((x) => x.key === secondaryKey) || active;
    if (!market) return;
    const request = marketRequest(market, tools.frame),
      signature = JSON.stringify(request);
    if (!secondary)
      secondary = window.RavenOSPriceWorkspace.create(
        get("deskComparisonChart"),
        {
          timeframe: tools.frame,
          fluidHeight: true,
          broadcastEvents: false,
          onTimeframeChange: (frame) => {
            tools.frame = frame;
            persist();
            syncControls();
            syncComparison();
          },
        },
      );
    comparison.querySelector("strong").textContent =
      `${market.label} · ${tools.frame}${tools.linked ? " · Linked" : ""}`;
    if (signature !== lastRequest) {
      lastRequest = signature;
      await secondary.load(request);
    }
    primary.chartHandle?.resize?.();
    secondary?.chartHandle?.resize?.();
  }
  for (const [id, key] of [
    ["deskSplit", "split"],
    ["deskLinked", "linked"],
  ])
    get(id).addEventListener("change", (e) => {
      tools[key] = e.target.checked;
      if (key === "linked" && !tools.linked) secondaryKey = active?.key || "";
      change();
    });
  get("deskFrame").addEventListener("change", (e) => {
    tools.frame = e.target.value;
    change();
  });
  get("deskComparisonMarket").addEventListener("change", (e) => {
    secondaryKey = e.target.value;
    persist();
    syncComparison();
  });
  get("deskList").addEventListener("change", (e) => {
    tools.list = e.target.value;
    change();
  });
  get("deskSort").addEventListener("change", (e) => {
    tools.sort = e.target.value;
    change();
  });
  get("deskCreateList").addEventListener("click", () => {
    const name = cleanName(get("deskListName").value);
    if (
      !name ||
      tools.lists.some((x) => x.name === name) ||
      tools.lists.length >= 8
    ) {
      get("deskListStatus").textContent =
        "Choose a unique name. Up to 8 lists are supported.";
      return;
    }
    tools.lists.push({ name, keys: active ? [active.key] : [] });
    tools.list = name;
    get("deskListName").value = "";
    get("deskListStatus").textContent = "List created.";
    change();
  });
  for (const [id, remove] of [
    ["deskAddToList", false],
    ["deskRemoveFromList", true],
  ])
    get(id).addEventListener("click", () => {
      const list = tools.lists.find((x) => x.name === tools.list);
      if (!list || !active) {
        get("deskListStatus").textContent =
          "Choose a named list and a market first.";
        return;
      }
      list.keys = remove
        ? list.keys.filter((x) => x !== active.key)
        : [...new Set([...list.keys, active.key])].slice(0, 20);
      change();
    });
  get("deskDeleteList").addEventListener("click", () => {
    tools.lists = tools.lists.filter((x) => x.name !== tools.list);
    tools.list = "";
    change();
  });
  get("deskSaveWorkspace").addEventListener("click", () => {
    const name = cleanName(get("deskWorkspaceName").value);
    if (!name) {
      get("deskWorkspaceStatus").textContent = "Enter a workspace name.";
      return;
    }
    if (
      !tools.workspaces.some((x) => x.name === name) &&
      tools.workspaces.length >= 8
    ) {
      get("deskWorkspaceStatus").textContent =
        "Up to 8 workspaces are supported.";
      return;
    }
    const record = {
      name,
      layout: prefs.layout,
      rail: prefs.rail,
      split: tools.split,
      linked: tools.linked,
      frame: tools.frame,
      primaryFrame: primary?.state.timeframe || "1h",
      marketKey: secondaryKey || active?.key || "",
      list: tools.list,
    };
    tools.workspaces = [
      ...tools.workspaces.filter((x) => x.name !== name),
      record,
    ];
    change();
    get("deskWorkspaceStatus").textContent = "Workspace saved on this browser.";
  });
  get("deskSavedWorkspace").addEventListener("change", (e) => {
    if (e.target.value === "") return;
    const record = tools.workspaces[Number(e.target.value)];
    if (!record) return;
    Object.assign(tools, {
      split: record.split,
      linked: record.linked,
      frame: record.frame,
      list: tools.lists.some((x) => x.name === record.list) ? record.list : "",
    });
    Object.assign(prefs, { layout: record.layout, rail: record.rail });
    secondaryKey = record.marketKey;
    if (record.primaryFrame && primary?.state.timeframe !== record.primaryFrame)
      primary?.options.onTimeframeChange?.(record.primaryFrame);
    save();
    apply();
    if (prefs.layout === "analysis") inspectPane("raven");
    change();
    get("deskSavedWorkspace").value = String(tools.workspaces.indexOf(record));
    get("deskWorkspaceName").value = record.name;
  });
  get("deskDeleteWorkspace").addEventListener("click", () => {
    const i = get("deskSavedWorkspace").value;
    if (i === "") return;
    tools.workspaces.splice(Number(i), 1);
    change();
  });
  status.querySelector("button").addEventListener("click", () => {
    if (primary?.lastRequest)
      primary.load({ ...primary.lastRequest, preserveChart: true });
    else if (active) openMarket(active);
    else location.reload();
  });
  function refreshBrief() {
    if (!primary) return;
    const s = primary.state,
      rows = s.candles || [],
      read = s.chartRead;
    const currentQuote = quoteFromCurrentChart(active, s);
    if (currentQuote && JSON.stringify(quotes.get(active.key)) !== JSON.stringify(currentQuote)) {
      quotes.set(active.key, currentQuote);
      render();
    }
    const unavailable = ["error", "data_unavailable", "empty"].includes(
        s.state,
      ),
      loading = s.state === "loading";
    const age = s.observedAt
      ? Math.max(0, (Date.now() - Date.parse(s.observedAt)) / 1000)
      : null;
    const stale =
      s.state === "delayed" ||
      ["degraded", "reconnecting"].includes(s.connectionState) ||
      (age !== null && age > 180 && s.capabilities?.live_bars);
    status.dataset.state = loading
      ? "loading"
      : unavailable
        ? "unavailable"
        : stale
          ? "stale"
          : "ready";
    status.hidden = !loading && !unavailable && !stale;
    status.querySelector("span").textContent = loading
      ? rows.length
        ? "Refreshing data · previous chart remains visible"
        : "Loading market data…"
      : unavailable
        ? active
          ? "Market data is unavailable. Retry or choose another market."
          : s.message || "Choose a market to begin."
        : stale
          ? "Updates are delayed · check the source timestamp before acting."
          : "Current market data";
    status.querySelector("button").hidden = loading;
    status.querySelector("button").textContent =
      primary.lastRequest || active ? "Retry data" : "Reload desk";
    brief.querySelector(".desk-brief-source").textContent =
      `${s.source || "Waiting for source"} · ${s.timeframe} · ${s.observedAt ? new Date(s.observedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Awaiting timestamp"}${stale ? " · Delayed" : ""}`;
    const entries = [];
    if (rows.length) {
      const first = Number(rows[0].close),
        last = Number(rows.at(-1).close);
      const high = Math.max(...rows.map((x) => Number(x.high))),
        low = Math.min(...rows.map((x) => Number(x.low)));
      entries.push([
        "What changed",
        `${((last / first - 1) * 100).toFixed(2)}% over ${rows.length} ${s.timeframe} candles.`,
      ]);
      entries.push([
        "Supporting evidence",
        read?.technical?.summary?.slice(0, 2).join(" · ") ||
          "No qualified technical setup in this window.",
      ]);
      const rsi = read?.facts?.rsi,
        volume = read?.facts?.volume_ratio;
      entries.push([
        "Checks and conflicts",
        [
          stale ? "Feed is delayed." : null,
          Number.isFinite(rsi) && rsi > 70
            ? "RSI is elevated."
            : Number.isFinite(rsi) && rsi < 30
              ? "RSI is depressed."
              : null,
          Number.isFinite(volume) && volume < 1
            ? "Volume is below its recent average."
            : null,
        ]
          .filter(Boolean)
          .join(" ") ||
          "No warning from the available RSI, volume and feed checks. Other risks may remain.",
      ]);
      entries.push([
        "Observed range",
        `Low ${number(low)} · High ${number(high)} · Last ${number(last)}`,
      ]);
    } else
      entries.push([
        "Market evidence",
        loading
          ? "Collecting the selected market’s chart and research."
          : "No chart evidence available for this selection.",
      ]);
    brief.querySelector("dl").replaceChildren(
      ...entries.flatMap(([label, text]) => {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = text;
        return [dt, dd];
      }),
    );
  }
  async function refreshQuotes() {
    if (refreshing || document.hidden || destroyed || !primary) return;
    refreshing = true;
    const list = tools.lists.find((x) => x.name === tools.list);
    const markets = prefs.markets.filter(
      (x) => matchesMarketScope(x, ravenOSContext.getState().marketScope) && (!list || list.keys.includes(x.key)),
    );
    let i = 0;
    await Promise.all(
      Array.from({ length: 2 }, async () => {
        while (i < markets.length && !destroyed) {
          const market = markets[i++];
          try {
            const request = marketRequest(market, "1h");
            const params = primary.requestParams({ ...request, limit: 25 });
            const response = await fetch(`/api/terminal/chart?${params}`, {
              signal: AbortSignal.timeout(12000),
            });
            const body = await response.json();
            const payload = body.data || body;
            if (!response.ok || !quoteMatchesMarket(market, payload)) continue;
            const quote = payload.chart_surface ? quoteFromMarketSnapshot(payload.market_state) : quoteFromCandles(
              payload.candles,
              payload.observed_at || payload.generated_at,
              payload.source_label || payload.source,
            );
            // The selected chart is the freshest identity-checked source when available.
            const selected = active?.key === market.key ? quoteFromCurrentChart(market, primary.state) : null;
            if (selected || quote) quotes.set(market.key, selected || quote);
          } catch {
            /* Existing observations retain their timestamp when a provider fails. */
          }
        }
      }),
    );
    refreshing = false;
    if (!destroyed) render();
  }
  const timer = setInterval(() => {
      refreshBrief();
    }, 10000),
    quoteTimer = setInterval(refreshQuotes, 60000);
  const visible = () => {
    if (!document.hidden) refreshQuotes();
  };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener(
    "pagehide",
    () => {
      destroyed = true;
      clearInterval(timer);
      clearInterval(quoteTimer);
      secondary?.destroy();
      document.removeEventListener("visibilitychange", visible);
    },
    { once: true },
  );
  controls.addEventListener("toggle", () => {
    if (controls.open) {
      get("deskMarketInfo").open = false;
      if (matchMedia("(max-width:820px)").matches) {
        prefs.rail = false;
        apply();
      }
    }
  });
  get("deskMarketInfo").addEventListener("toggle", () => {
    if (get("deskMarketInfo").open) controls.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && controls.open) {
      controls.open = false;
      controls.querySelector("summary").focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (controls.open && !controls.contains(e.target)) controls.open = false;
  });
  syncControls();
  return {
    attach(workspace) {
      primary = workspace;
      const previous = workspace.options.onStateChange;
      workspace.options.onStateChange = (s) => {
        previous?.(s);
        refreshBrief();
      };
      refreshBrief();
      syncComparison();
    },
    update(market) {
      const changed = active?.key !== market?.key;
      active = market;
      if (changed) {
        syncControls();
        syncComparison();
        refreshQuotes();
      }
      refreshBrief();
    },
    ordered(markets) {
      const list = tools.lists.find((x) => x.name === tools.list);
      const rows = markets.filter((x) => !list || list.keys.includes(x.key));
      return tools.sort === "recent"
        ? rows
        : rows.sort((a, b) =>
            tools.sort === "name"
              ? a.label.localeCompare(b.label)
              : (quotes.get(b.key)?.[tools.sort] ?? -Infinity) -
                (quotes.get(a.key)?.[tools.sort] ?? -Infinity),
          );
    },
    decorate(row, market) {
      const quote = quotes.get(market.key);
      const cell = document.createElement("div");
      cell.className = "desk-market-quote";
      if (!quote) {
        cell.textContent = "Price not loaded";
        cell.title = "No chart-price observation has loaded for this market. This is separate from a trade quote.";
        row.append(cell);
        return;
      }
      const stale =
        !Number.isFinite(Date.parse(quote.observedAt)) ||
        Date.now() - Date.parse(quote.observedAt) > 180000 ||
        Date.parse(quote.observedAt) - Date.now() > 60000;
      cell.dataset.stale = String(stale);
      cell.title = quote.kind === 'market_snapshot' ? `${quote.source} · ${quote.observedAt} · Market snapshot`
        : `${quote.source} · ${quote.observedAt || "Timestamp unavailable"} · Change and volume cover ${Math.round((quote.end - quote.start) / 3600)} hours of available candles. Volume is provider-reported units.`;
      const price = document.createElement("strong"),
        change = document.createElement("span"),
        vol = document.createElement("small");
      price.textContent = number(quote.price);
      change.textContent = `${quote.change >= 0 ? "+" : ""}${Number.isFinite(quote.change) ? quote.change.toFixed(2) : "—"}%`;
      change.dataset.direction = quote.change >= 0 ? "up" : "down";
      vol.textContent = `${quote.end - quote.start < 3600 ? `${Math.round((quote.end - quote.start) / 60)}m` : `${Math.round((quote.end - quote.start) / 3600)}h`} vol ${number(quote.volume)}${stale ? " · Stale" : ""}`;
      const observed = document.createElement("small");
      observed.className = "desk-quote-time";
      observed.textContent =
        quote.observedAt && Number.isFinite(Date.parse(quote.observedAt))
          ? `As of ${new Date(quote.observedAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "Timestamp unavailable";
      if (quote.kind === 'market_snapshot') {
        vol.textContent = `Snapshot${stale ? ' · Stale' : ''}`;
        cell.append(price, vol, observed);
        row.append(cell);
        return;
      }
      cell.append(price, change, vol, observed);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 80 22");
      svg.setAttribute("aria-label", "Price over available candle window");
      svg.setAttribute("role", "img");
      const path = document.createElementNS(svg.namespaceURI, "polyline");
      const min = Math.min(...quote.points),
        max = Math.max(...quote.points);
      path.setAttribute(
        "points",
        quote.points
          .map(
            (p, i) =>
              `${(i * 80) / Math.max(1, quote.points.length - 1)},${20 - ((p - min) / Math.max(max - min, 1e-12)) * 18}`,
          )
          .join(" "),
      );
      svg.append(path);
      cell.append(svg);
      row.append(cell);
    },
    retains(key) {
      return tools.lists.some((list) => list.keys.includes(key));
    },
    signature() {
      return JSON.stringify([tools.list, tools.sort, tools.lists, [...quotes]]);
    },
  };
}
