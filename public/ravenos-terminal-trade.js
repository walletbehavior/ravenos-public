const PAIRS = Object.freeze({
  SOL_USDC: Object.freeze({
    chain: "solana",
    input: { chain: "solana", symbol: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9 },
    output: { chain: "solana", symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    defaultDisplayAmount: "0.10",
  }),
  USDC_SOL: Object.freeze({
    chain: "solana",
    input: { chain: "solana", symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    output: { chain: "solana", symbol: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9 },
    defaultDisplayAmount: "1.00",
  }),
});

const state = {
  flags: null,
  quotePhase: "idle",
  quote: null,
  quoteError: null,
  inspectionPhase: "idle",
  inspection: null,
  inspectionError: null,
  reviewPhase: "draft",
  review: null,
  reviewProof: null,
  reviewError: null,
  wallet: {
    detected: [],
    snapshot: null,
    provider: null,
    unbind: null,
    error: null,
  },
  op: {
    quote: 0,
    inspect: 0,
    review: 0,
  },
};

function $(id) {
  return document.getElementById(id);
}

function nowIso() {
  return new Date().toISOString();
}

function shortAddress(value) {
  const text = String(value || "").trim();
  return text ? `${text.slice(0, 4)}...${text.slice(-4)}` : "Not connected";
}

function parseDisplayToBaseUnits(displayAmount, decimals) {
  const text = String(displayAmount || "").trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error("invalid_display_amount");
  const [whole, fractional = ""] = text.split(".");
  if (fractional.length > decimals) throw new Error("display_amount_precision_exceeds_decimals");
  return `${whole}${fractional.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "") || "0";
}

function formatBaseUnits(baseUnits, decimals) {
  const raw = String(baseUnits || "0");
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function riskClassForText(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("blocked") || lower.includes("invalid") || lower.includes("unavailable")) return "status-bad";
  if (lower.includes("recover") || lower.includes("stale") || lower.includes("warn") || lower.includes("degraded")) return "status-warn";
  return "status-good";
}

function detectedWallets() {
  const out = [];
  const scope = window;
  if (scope?.phantom?.solana) out.push({ family: "phantom", provider: scope.phantom.solana });
  if (scope?.solflare) out.push({ family: "solflare", provider: scope.solflare });
  if (scope?.solana && (scope.solana.isPhantom || scope.solana.isSolflare)) {
    const family = scope.solana.isPhantom ? "phantom" : "solflare";
    if (!out.some((entry) => entry.provider === scope.solana)) out.push({ family, provider: scope.solana });
  }
  return out;
}

function providerCapabilities(provider = {}) {
  return {
    connect: typeof provider.connect === "function",
    disconnect: typeof provider.disconnect === "function",
    sign_transaction: typeof provider.signTransaction === "function",
    sign_and_send_transaction: typeof provider.signAndSendTransaction === "function",
    sign_all_transactions: typeof provider.signAllTransactions === "function",
    versioned_transactions: Boolean(provider.supportedTransactionVersions?.has?.(0) || provider.supportsVersionedTransactions || provider.isPhantom),
  };
}

function snapshotForProvider(provider, family, publicAddress = null) {
  const capabilities = providerCapabilities(provider);
  const warnings = [];
  let stateLabel = "detected_not_connected";
  if (publicAddress) stateLabel = capabilities.versioned_transactions ? "connected_read_only" : "unsupported_transaction_version";
  if (publicAddress && !capabilities.versioned_transactions) warnings.push("unsupported_transaction_version");
  return {
    schema_version: "customer_trade_wallet_capability_snapshot.v1",
    state: stateLabel,
    wallet_family: family || "unknown",
    wallet_adapter_version: null,
    supported_chain: "solana",
    supported_transaction_versions: capabilities.versioned_transactions ? ["legacy", "v0"] : ["legacy"],
    address_lookup_table_support: capabilities.versioned_transactions,
    message_signing_available: typeof provider.signMessage === "function",
    transaction_signing_available: capabilities.sign_transaction,
    connection_state: publicAddress ? "connected" : "disconnected",
    public_address: publicAddress,
    observation_timestamp: nowIso(),
    freshness_state: "fresh",
    warnings,
  };
}

function currentPair() {
  return PAIRS[$("tradeDirectionSelect").value] || PAIRS.SOL_USDC;
}

function currentMarketContext() {
  const chart = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__ || {};
  return {
    chain: "solana",
    market: $("marketSelect")?.value || "perpetuals",
    asset: $("assetSelect")?.value || chart.asset || null,
    source: chart.sourceLabel || "terminal_chart_context",
    observed_at: chart.observedAt || null,
    freshness_state: chart.freshnessState || "unknown",
    age_seconds: null,
    warnings: [],
  };
}

function quoteExpired(quote) {
  return Boolean(quote?.quote_expiry && Date.parse(quote.quote_expiry) <= Date.now());
}

function setLiveMessage(text, klass = "") {
  const el = $("quoteStatusLive");
  el.textContent = text;
  el.className = `trade-live ${klass}`.trim();
}

function updateWalletDom() {
  const snapshot = state.wallet.snapshot;
  const walletState = snapshot?.state || (state.wallet.detected.length ? "detected_not_connected" : "not_detected");
  const walletFamily = snapshot?.wallet_family || (state.wallet.detected[0]?.family || "None detected");
  $("walletReviewState").textContent = walletState.replace(/_/g, " ");
  $("walletReviewFamily").textContent = walletFamily;
  $("walletVersionedState").textContent = snapshot ? (snapshot.address_lookup_table_support ? "Supported" : "Legacy only") : "Pending";
  $("walletPublicAddress").textContent = snapshot?.public_address ? shortAddress(snapshot.public_address) : "Not connected";
  $("walletCapabilityDetail").textContent = state.wallet.error
    ? state.wallet.error
    : snapshot?.public_address
      ? "Connected for read-only compatibility review. Signing remains disabled."
      : state.wallet.detected.length
        ? "Wallet detected. Connect explicitly for read-only compatibility review."
        : "No supported wallet detected. Quotes and route inspection still work without a wallet.";
  $("walletConnectionState").textContent = snapshot?.public_address ? "Connected for read-only review" : (state.wallet.detected.length ? "Wallet detected" : "Not connected");
  $("disconnectWalletButton").disabled = !snapshot?.public_address;
}

function renderQuote() {
  const quote = state.quote;
  $("tradeQuoteState").value = state.quotePhase === "loading"
    ? "Loading"
    : state.quotePhase === "ready"
      ? (quoteExpired(quote) ? "Expired" : "Ready")
      : state.quotePhase === "error"
        ? "Unavailable"
        : "Awaiting request";
  $("quoteExpectedOutput").textContent = quote
    ? `${formatBaseUnits(quote.expected_output_amount_base_units, currentPair().output.decimals)} ${currentPair().output.symbol}`
    : "Pending";
  $("quoteMinimumOutput").textContent = quote
    ? `${formatBaseUnits(quote.minimum_output_amount_base_units, currentPair().output.decimals)} ${currentPair().output.symbol}`
    : "Pending";
  $("quotePriceImpact").textContent = quote ? `${quote.price_impact_bps} bps` : "Pending";
  $("quoteExpiry").textContent = quote?.quote_expiry ? new Date(quote.quote_expiry).toISOString().slice(11, 19) + " UTC" : "Pending";
  $("getQuoteButton").disabled = state.quotePhase === "loading";
  $("refreshQuoteButton").disabled = !quote;
  $("inspectRouteButton").disabled = !quote || quoteExpired(quote) || state.inspectionPhase === "loading";
  if (state.quoteError) {
    setLiveMessage(state.quoteError, "status-bad");
  } else if (quote) {
    setLiveMessage(
      quoteExpired(quote)
        ? "Quote expired. Refresh explicitly before inspection or review."
        : `Quote ready from ${quote.provider_provenance?.source || "provider"}.`,
      quoteExpired(quote) ? "status-warn" : "status-good",
    );
  } else {
    setLiveMessage("Request a current quote to begin route review.");
  }
}

function renderInspection() {
  const inspection = state.inspection;
  $("inspectionState").textContent = state.inspectionPhase === "loading"
    ? "Loading"
    : inspection
      ? (inspection.quote_to_transaction_consistency_result === "matched" ? "Ready" : "Blocked")
      : "Not requested";
  $("inspectionVenues").textContent = state.quote?.route_legs?.map((leg) => leg.venue).join(", ") || "Pending";
  $("inspectionPreviewHash").textContent = inspection?.transaction_hash_or_preview_hash
    ? inspection.transaction_hash_or_preview_hash.slice(0, 16)
    : "Pending";
  $("inspectionWarnings").textContent = inspection?.warnings?.length ? inspection.warnings.join(", ") : "None";
  $("inspectionSummary").textContent = state.inspectionError
    ? state.inspectionError
    : inspection
      ? (inspection.quote_to_transaction_consistency_result === "matched"
          ? "Route preview matches the reviewed quote inputs and minimum output constraints."
          : "Route preview is blocked. Review the warnings and blocking reasons before generating evidence.")
      : "Inspection checks will validate route consistency, signer requirements, lookup tables, and unknown instructions before review.";
  $("createReviewButton").disabled = !inspection || state.reviewPhase === "loading";
}

function renderReview() {
  const review = state.review;
  $("reviewState").textContent = review?.state || state.reviewPhase || "draft";
  $("reviewEvidenceId").textContent = review?.evidence_id || "Pending";
  $("reviewPersistenceState").textContent = review?.persistence_state || "Pending";
  $("reviewBlockingReasons").textContent = review?.packet?.blocking_reasons?.length
    ? review.packet.blocking_reasons.join(", ")
    : (review?.proof?.packet?.blocking_reasons?.join(", ") || "None");
  $("viewEvidenceButton").disabled = !review?.proof_url && !review?.evidence_id;
  $("exportReviewButton").disabled = !review?.packet;
  $("reviewProofBox").textContent = state.reviewError
    ? state.reviewError
    : state.reviewProof
      ? JSON.stringify(state.reviewProof, null, 2)
      : review
        ? `Evidence ${review.evidence_id} created. Quote-only: ${review.packet.quote_only ? "yes" : "no"}. Signing disabled: ${review.packet.signing_disabled ? "yes" : "no"}.`
        : "Immutable review packet pending. The proof record will remain quote-only and redacted.";
  $("tradeFeatureState").textContent = review?.state === "blocked" ? "Quote-only review blocked" : "Quote-only preview";
}

function renderAll() {
  updateWalletDom();
  renderQuote();
  renderInspection();
  renderReview();
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function refreshFlags() {
  const { payload } = await fetchJson("/api/trade/flags", { cache: "no-store" });
  state.flags = payload || null;
}

async function detectWallets() {
  state.wallet.detected = detectedWallets();
  state.wallet.error = null;
  if (state.wallet.detected.length && !state.wallet.snapshot) {
    const first = state.wallet.detected[0];
    state.wallet.snapshot = snapshotForProvider(first.provider, first.family);
    state.wallet.provider = first.provider;
  }
  renderAll();
}

function unbindWalletEvents() {
  if (typeof state.wallet.unbind === "function") state.wallet.unbind();
  state.wallet.unbind = null;
}

function bindWalletEvents(provider, family) {
  unbindWalletEvents();
  const listeners = [];
  const on = typeof provider.on === "function" ? provider.on.bind(provider) : null;
  const off = typeof provider.off === "function" ? provider.off.bind(provider) : null;
  if (!on || !off) return;
  const accountChanged = (nextKey) => {
    const publicAddress = typeof nextKey?.toBase58 === "function" ? nextKey.toBase58() : String(nextKey || "");
    state.wallet.snapshot = snapshotForProvider(provider, family, publicAddress || null);
    renderAll();
  };
  const disconnected = () => {
    state.wallet.snapshot = snapshotForProvider(provider, family, null);
    renderAll();
  };
  on("accountChanged", accountChanged);
  on("disconnect", disconnected);
  listeners.push(["accountChanged", accountChanged], ["disconnect", disconnected]);
  state.wallet.unbind = () => {
    for (const [event, handler] of listeners) off(event, handler);
  };
}

async function connectWallet(family) {
  await detectWallets();
  const target = state.wallet.detected.find((entry) => entry.family === family);
  if (!target || typeof target.provider.connect !== "function") {
    state.wallet.error = `${family} wallet not detected`;
    renderAll();
    return;
  }
  try {
    const result = await target.provider.connect({});
    const publicAddress = String(
      result?.publicKey?.toBase58?.() ||
      result?.publicKey?.toString?.() ||
      target.provider.publicKey?.toBase58?.() ||
      target.provider.publicKey?.toString?.() ||
      "",
    );
    state.wallet.provider = target.provider;
    state.wallet.snapshot = snapshotForProvider(target.provider, family, publicAddress || null);
    state.wallet.error = null;
    bindWalletEvents(target.provider, family);
  } catch (error) {
    state.wallet.error = error instanceof Error ? error.message : "wallet_connection_failed";
  }
  renderAll();
}

async function disconnectWallet() {
  try {
    await state.wallet.provider?.disconnect?.();
  } catch {}
  unbindWalletEvents();
  state.wallet.snapshot = state.wallet.provider
    ? snapshotForProvider(state.wallet.provider, state.wallet.snapshot?.wallet_family || "unknown", null)
    : null;
  renderAll();
}

async function requestQuote(refresh = false) {
  const opId = ++state.op.quote;
  const pair = currentPair();
  let exactInputAmountBaseUnits;
  try {
    exactInputAmountBaseUnits = parseDisplayToBaseUnits($("tradeAmountInput").value, pair.input.decimals);
  } catch (error) {
    state.quoteError = "Invalid amount format.";
    renderQuote();
    return;
  }
  const payload = {
    client_request_id: `terminal_${Date.now()}`,
    chain: pair.chain,
    input_asset: pair.input,
    output_asset: pair.output,
    exact_input_amount_base_units: exactInputAmountBaseUnits,
    display_amount: $("tradeAmountInput").value,
    asset_decimals: pair.input.decimals,
    slippage_bps: Number($("tradeSlippageInput").value || 50),
    wallet_capability_context: state.wallet.snapshot || null,
  };
  state.quotePhase = "loading";
  state.quoteError = null;
  if (refresh) {
    state.inspection = null;
    state.inspectionPhase = "idle";
    state.review = null;
    state.reviewProof = null;
    state.reviewPhase = "draft";
  }
  renderAll();
  const { response, payload: out } = await fetchJson("/api/trade/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (opId !== state.op.quote) return;
  if (!response.ok || !out?.ok) {
    state.quotePhase = "error";
    state.quote = null;
    state.quoteError = out?.public_error?.message || out?.message || "Quote provider unavailable.";
    renderAll();
    return;
  }
  state.quotePhase = "ready";
  state.quote = out.quote;
  state.quoteError = null;
  state.inspection = null;
  state.inspectionPhase = "idle";
  state.review = null;
  state.reviewProof = null;
  state.reviewPhase = "draft";
  renderAll();
}

async function requestInspection() {
  if (!state.quote) return;
  const opId = ++state.op.inspect;
  state.inspectionPhase = "loading";
  state.inspectionError = null;
  renderAll();
  const { response, payload } = await fetchJson("/api/trade/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quote: state.quote,
      wallet_capability_snapshot: state.wallet.snapshot || null,
    }),
  });
  if (opId !== state.op.inspect) return;
  if (!response.ok || !payload?.ok) {
    state.inspectionPhase = "error";
    state.inspection = null;
    state.inspectionError = payload?.public_error?.message || payload?.message || "Route inspection unavailable.";
    renderAll();
    return;
  }
  state.quote = payload.quote;
  state.inspection = payload.inspection;
  state.inspectionPhase = payload.inspection.quote_to_transaction_consistency_result === "matched" ? "ready" : "blocked";
  state.inspectionError = null;
  state.review = null;
  state.reviewProof = null;
  state.reviewPhase = "draft";
  renderAll();
}

async function createReview() {
  if (!state.quote || !state.inspection) return;
  const opId = ++state.op.review;
  state.reviewPhase = "loading";
  state.reviewError = null;
  renderAll();
  const { response, payload } = await fetchJson("/api/trade/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quote: state.quote,
      transaction_inspection: state.inspection,
      wallet_capability_snapshot: state.wallet.snapshot || null,
      market_context_reference: currentMarketContext(),
      supersedes_evidence_id: state.review?.evidence_id || null,
    }),
  });
  if (opId !== state.op.review) return;
  if (!payload) return;
  state.review = payload;
  state.reviewPhase = payload.state || (payload.ok ? "ready" : "blocked");
  state.reviewError = payload.ok ? null : (payload.message || "Review packet unavailable.");
  if (!response.ok && !payload.ok) {
    renderAll();
    return;
  }
  renderAll();
}

async function viewEvidence() {
  const evidenceId = state.review?.evidence_id;
  if (!evidenceId) return;
  const { payload } = await fetchJson(`/api/trade/review?id=${encodeURIComponent(evidenceId)}`, { cache: "no-store" });
  state.reviewProof = payload?.proof || null;
  renderAll();
}

function exportReview() {
  if (!state.review?.packet) return;
  const blob = new Blob([`${JSON.stringify(state.review.packet, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.review.evidence_id || "review_packet"}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function applyPairDefaults() {
  $("tradeAmountInput").value = currentPair().defaultDisplayAmount;
}

function bindDom() {
  $("tradeDirectionSelect").addEventListener("change", () => {
    applyPairDefaults();
    state.quote = null;
    state.quoteError = null;
    state.quotePhase = "idle";
    state.inspection = null;
    state.inspectionPhase = "idle";
    state.review = null;
    state.reviewProof = null;
    state.reviewPhase = "draft";
    renderAll();
  });
  $("tradeAmountInput").addEventListener("input", () => {
    if (state.quote) {
      state.quotePhase = "idle";
      state.quote = null;
      state.inspection = null;
      state.review = null;
      state.reviewProof = null;
      state.reviewPhase = "draft";
      renderAll();
    }
  });
  $("tradeSlippageInput").addEventListener("input", () => {
    if (state.quote) {
      state.quotePhase = "idle";
      state.quote = null;
      state.inspection = null;
      state.review = null;
      state.reviewProof = null;
      state.reviewPhase = "draft";
      renderAll();
    }
  });
  $("getQuoteButton").addEventListener("click", () => requestQuote(false));
  $("refreshQuoteButton").addEventListener("click", () => requestQuote(true));
  $("inspectRouteButton").addEventListener("click", requestInspection);
  $("createReviewButton").addEventListener("click", createReview);
  $("viewEvidenceButton").addEventListener("click", viewEvidence);
  $("exportReviewButton").addEventListener("click", exportReview);
  $("detectWalletButton").addEventListener("click", detectWallets);
  $("connectPhantomButton").addEventListener("click", () => connectWallet("phantom"));
  $("connectSolflareButton").addEventListener("click", () => connectWallet("solflare"));
  $("disconnectWalletButton").addEventListener("click", disconnectWallet);
}

async function init() {
  await refreshFlags().catch(() => {});
  applyPairDefaults();
  bindDom();
  detectWallets();
  renderAll();
  window.setInterval(() => {
    if (state.quote && quoteExpired(state.quote)) renderAll();
  }, 1000);
}

document.addEventListener("DOMContentLoaded", init);
