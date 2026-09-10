import { planShieldedCapital } from "../lib/customer_trade/shielded_capital_planner.mjs";
import { readAccountSession } from '/ravenos-account-session.js';
const $ = id => document.getElementById(id);
const api = "/api/v1/portfolio/shielded";
const state = { csrf: "", config: null, action: "SHIELDED_DEPLOY", quote: null, abort: null, generation: 0, excess: null };
const comparisonState = { result: null, abort: null, generation: 0 };
const labels = {
  SHIELDED_DEPLOY: ["From reserve to opportunity.", "Deploy amount · USD equivalent", "Destination", "Preview deployment"],
  SHIELDED_RETURN: ["Bring working capital back.", "Return amount · USD equivalent", "Source", "Preview return"],
  SHIELDED_SEND: ["Plan a payment from your reserve.", "Recipient amount · USD equivalent", "Recipient network & asset", "Preview send"],
};
const reasonLabels = { unsupported_chain_or_asset: "This route is not supported by the current provider catalog.", provider_rate_limited: "The provider is busy. Try again shortly.", provider_quote_rejected: "The provider could not quote this size. Try a different amount or route.", price_stale_or_unavailable: "The reference price is stale. Reload the workspace for a current price.", maximum_delay_exceeded: "The route exceeds the one-hour preview delay limit.", maximum_friction_exceeded: "The route exceeds the preview cost limit.", provider_timeout: "The provider did not respond in time. Try again.", shielded_rate_limited: "Please wait a minute before requesting another preview.", shielded_request_invalid: "Enter a value between $1 and $50,000, with up to two decimals.", pro_required: "This preview needs active Pro access. Your account can show trial or subscription options.", authentication_required: "Sign in to use the Pro preview.", shielded_disabled: "The reserve preview is temporarily unavailable." };
const unavailable = code => reasonLabels[code] || "The route could not be verified right now. Try again shortly.";
Object.assign(reasonLabels, { comparison_expired: "The first quote expired while comparing routes. Try a fresh comparison.", shielded_comparison_rate_limited: "Two comparisons per minute are available. Wait a minute before trying again.", comparison_evidence_mismatch: "The route evidence did not match. No comparison is available." });
function text(id, value) { $(id).textContent = value; }
function precise(value, decimals = 6, keep = 2) {
  const n = BigInt(value), unit = 10n ** BigInt(decimals), digits = (n % unit).toString().padStart(decimals, "0").slice(0, keep);
  return `${(n / unit).toLocaleString("en-US")}${keep ? `.${digits}` : ""}`;
}
function usd(value) { return `$${precise(value)}`; }
function duration(seconds) { return seconds < 60 ? `~${seconds} sec` : `~${Math.ceil(seconds / 60)} min`; }
function ledger(root, rows) {
  root.replaceChildren();
  for (const [label, value] of rows) { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); root.append(row); }
}
function invalidateComparison() {
  comparisonState.generation++; comparisonState.abort?.abort(); comparisonState.result = null;
  $('reserveCompareResult').hidden = true; $('reserveCompareButton').disabled = false;
  $('reserveCompareResult').setAttribute('aria-busy', 'false'); text('reserveCompareStatus', '');
}
function comparisonFreshness() {
  if (!comparisonState.result) return;
  const fresh = Date.now() < Date.parse(comparisonState.result.research_expires_at);
  text('reserveCompareFreshness', fresh ? 'CURRENT PREVIEWS' : 'PREVIEWS EXPIRED');
  $('reserveCompareResult').dataset.stale = String(!fresh);
}
function renderComparison(c) {
  comparisonState.result = c; $('reserveCompareResult').hidden = false;
  const label = key => state.config.assets.find(a => a.key === key)?.label || key;
  text('reserveComparePath', `${label(c.source)} → ${label(c.destination)}`);
  const percent = ppm => `${(Number(ppm) / 10000).toFixed(3)}%`;
  ledger($('reserveCompareDirect'), [['Expected receive', `${c.direct.destination_amount} USDC`], ['Minimum in direct preview', `${c.direct.minimum_destination_amount} USDC`], ['Provider estimate', duration(c.direct.estimated_settlement_seconds)], ['Marked friction', percent(c.direct.all_in_marked_friction_ppm)]]);
  ledger($('reserveCompareShielded'), [['Expected receive', `${c.reserve.estimated_receive} USDC`], ['Combined minimum', 'Not guaranteed'], ['Provider estimates combined', `${duration(c.reserve.provider_time_sum_seconds)} + wallet wait`], ['Marked friction across both legs', percent(c.reserve.all_in_marked_friction_ppm)]]);
  const evidenceRoot = $('reserveCompareEvidence'); evidenceRoot.replaceChildren();
  for (const [name, q] of [['Direct', c.direct], ['Return to reserve', c.reserve.return], ['Deploy from reserve', c.reserve.deploy]]) {
    const title = document.createElement('h4'), dl = document.createElement('dl'); title.textContent = name;
    ledger(dl, [['Source amount', `${q.source_amount} ${q.source === 'zec' ? 'ZEC' : state.config.assets.find(a => a.key === q.source)?.symbol || 'USDC'}`], ['Expected receive', `${q.destination_amount} ${q.destination_symbol}`], ['Provider signature', q.trust.provider_signature_verified ? 'Verified' : 'Unverified'], ['Provider app fee', `${q.fee_components.provider_injected_app_fee_bps} bps included`], ['Privacy classification', q.privacy.classification], ['Quoted at', new Date(q.observed_at).toLocaleTimeString()], ['Evidence reference', q.quote_hash]]);
    evidenceRoot.append(title, dl);
  }
  text('reserveCompareStatus', 'Three provider previews verified. No funds moved.'); comparisonFreshness();
}
async function requestComparison(event) {
  event.preventDefault(); invalidateComparison();
  const source = $('reserveCompareSource').value, destination = $('reserveCompareDestination').value;
  if (source === destination) return text('reserveCompareStatus', 'Choose two different networks.');
  const generation = comparisonState.generation, controller = new AbortController(); comparisonState.abort = controller;
  $('reserveCompareButton').disabled = true; $('reserveCompareResult').setAttribute('aria-busy', 'true');
  text('reserveCompareStatus', 'Comparing direct, return and deployment quotes…');
  try {
    const r = await fetch(`${api}/compare`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-ravenos-csrf': state.csrf }, body: JSON.stringify({ source, destination, amount_usd: $('reserveCompareAmount').value.trim() }), signal: controller.signal });
    const payload = await r.json(); if (generation !== comparisonState.generation) return;
    if (!r.ok || !payload.ok || !payload.comparison?.available) throw Error(payload.error || payload.comparison?.reason);
    renderComparison(payload.comparison);
  } catch (error) { if (generation === comparisonState.generation && error.name !== 'AbortError') text('reserveCompareStatus', unavailable(error.message)); }
  finally { if (generation === comparisonState.generation) { $('reserveCompareButton').disabled = false; $('reserveCompareResult').setAttribute('aria-busy', 'false'); } }
}
function routeNames() {
  const name = state.config?.assets.find(a => a.key === $("reserveNetwork").value)?.label || "Destination";
  text("reserveFrom", state.action === "SHIELDED_RETURN" ? name : "ZEC reserve");
  text("reserveTo", state.action === "SHIELDED_RETURN" ? "ZEC reserve" : name);
}
function invalidate() {
  state.generation++; state.abort?.abort(); state.quote = null;
  $("reserveQuote").hidden = true; $("reserveEmpty").hidden = false;
  $("reserveResult").setAttribute("aria-busy", "false");
  $("reserveQuoteButton").disabled = false; text("reserveQuoteStatus", "");
}
function chooseAction(action) {
  state.action = action; invalidate();
  document.querySelectorAll("[data-reserve-action]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.reserveAction === action)));
  ["reserveRouteTitle", "reserveAmountLabel", "reserveNetworkLabel", "reserveQuoteButton"].forEach((id, i) => text(id, labels[action][i]));
  routeNames();
}
function evidence(q) {
  const root = $("reserveEvidence"); root.replaceChildren();
  const pairs = [
    ["Provider", "NEAR Intents · 1Click"], ["Signature", q.trust.provider_signature_verified ? "Provider response verified" : "Unverified"],
    ["End-to-end privacy", "Unknown · no shielded settlement proof"],
    ["Public destination", state.action === "SHIELDED_RETURN" ? "Shielded-only test address accepted; receipt unverified" : "Address, asset and activity are public"],
    ["Source shielding", state.action === "SHIELDED_RETURN" ? "Public source transaction" : "Requires a verified external shielded spend"],
    ["Public Zcash intermediate", "Transparent deposit / bridge leg"],
    ["Provider can see", "Amount, public test addresses, request time and Raven server IP"],
    ["Solver can see", "Amount; exact recipient exposure unverified"],
    ["Timing / amount correlation", `${q.privacy.timing_correlation_risk} / ${q.privacy.amount_correlation_risk}`],
    ["Bridge trust", "Proof-of-authority Zcash bridge; NEAR contracts and solvers"],
    ["Provider app fee", `${q.fee_components.provider_injected_app_fee_bps} bps included in route`],
    ["Destination", q.destination_location], ["Quote latency", `${q.quote_latency_ms.toLocaleString()} ms`],
    ["Quote validity", "30-second local freshness; no executable reservation"],
  ];
  for (const [name, value] of pairs) { const wrap = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = name; dd.textContent = value; wrap.append(dt, dd); root.append(wrap); }
}
function renderQuote(q, cached) {
  state.quote = q; $("reserveEmpty").hidden = true; $("reserveQuote").hidden = false;
  text("reserveReceive", `${q.destination_amount} ${q.destination_symbol}`);
  text("reserveSourceAmount", `From ${q.source_amount} ${state.action === "SHIELDED_RETURN" ? state.config.assets.find(a => a.key === q.source)?.symbol : "ZEC"} · ${usd(q.input_usd_micros)} reference value`);
  text("reserveMinimum", `${q.minimum_destination_amount} ${q.destination_symbol}`);
  const seconds = q.estimated_settlement_seconds;
  text("reserveTime", seconds < 60 ? `~${seconds} sec` : `~${Math.ceil(seconds / 60)} min`);
  text("reserveFriction", `${(Number(q.all_in_marked_friction_ppm) / 10000).toFixed(3)}%`);
  text("reservePrivacySummary", state.action === "SHIELDED_RETURN" ? "Public source. Shielded-only destination accepted for quoting; receipt is unverified." : "Conditional shielded source. Destination activity remains public. Amount and timing can still correlate.");
  evidence(q); text("reserveQuoteStatus", cached ? "Recent verified preview reused. No funds moved." : "Provider response verified. No funds moved.");
  updateFreshness();
}
function updateFreshness() {
  if (!state.quote) return;
  const fresh = Date.now() < Date.parse(state.quote.research_expires_at);
  text("reserveQuoteState", fresh ? "CURRENT PREVIEW" : "PREVIEW EXPIRED");
  text("reserveFreshness", fresh ? `Quoted ${new Date(state.quote.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Provider estimate; external wallet spendability can add time.` : "This preview has expired. Request a fresh route before comparing costs.");
  $("reserveQuote").dataset.stale = String(!fresh);
}
async function requestQuote(event) {
  event.preventDefault(); invalidate();
  const generation = state.generation, controller = new AbortController(); state.abort = controller;
  $("reserveQuoteButton").disabled = true; $("reserveResult").setAttribute("aria-busy", "true");
  text("reserveQuoteStatus", "Checking a live provider route…");
  try {
    const response = await fetch(`${api}/quote`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf }, body: JSON.stringify({ action: state.action, network: $("reserveNetwork").value, amount_usd: $("reserveAmount").value.trim() }), signal: controller.signal });
    const payload = await response.json(); if (generation !== state.generation) return;
    if (!response.ok || !payload.ok || !payload.quote?.available) throw Error(payload.error || payload.quote?.reason);
    renderQuote(payload.quote, payload.cached);
  } catch (error) { if (generation === state.generation && error.name !== "AbortError") text("reserveQuoteStatus", unavailable(error.message)); }
  finally { if (generation === state.generation) { $("reserveQuoteButton").disabled = false; $("reserveResult").setAttribute("aria-busy", "false"); } }
}
function plan(event) {
  event.preventDefault(); state.excess = null; $("reservePreviewExcess").hidden = true;
  const price = state.config?.zec_price;
  if (!price || Date.now() - Date.parse(price.observed_at) > 600000) return text("reservePlanResult", "Reload the workspace for a fresh ZEC reference price.");
  try {
    const result = planShieldedCapital({ reserve_zec: $("reservePlanZec").value.trim(), working_usdc: $("reservePlanWorking").value.trim(), target_usdc: $("reservePlanTarget").value.trim(), price_move_percent: Number($("reservePriceMove").value), zec_price_usd_micros: price.usd_micros });
    const root = $("reservePlanResult"); root.replaceChildren();
    const items = [["Scenario reserve value", usd(result.reserve_usd_micros)], ["After ZEC price scenario", usd(result.reserve_after_move_usd_micros)], ["Public working capital", `${precise(result.working_usdc_micros)} USDC`], ["Additional prepositioned capital needed", `${precise(result.shortfall_usdc_micros)} USDC`], ["Excess above target", `${precise(result.excess_usdc_micros)} USDC`]];
    const dl = document.createElement("dl"); dl.className = "reserve-plan-ledger";
    for (const [label, value] of items) { const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; row.append(dt, dd); dl.append(row); }
    const warning = document.createElement("p"); warning.textContent = result.copy_ready ? "The scenario meets your target. Real Copy readiness still needs verified chain-local funds and gas." : "Preposition working capital before Copy runs. Shielded deployment is too slow for instant following.";
    root.append(dl, warning); state.excess = result.excess_usdc_micros;
    $("reservePreviewExcess").hidden = BigInt(state.excess) < 1000000n || BigInt(state.excess) > 50000000000n;
  } catch { text("reservePlanResult", "Use positive decimal amounts: up to 8 decimals for ZEC and 6 for USDC."); }
}
async function boot() {
  if (location.hostname === "ravenos.xyz" || location.hostname === "www.ravenos.xyz") {
    text("reserveAccess", "Explore reserve routes and private capital scenarios with Raven Pro.");
    $("reserveAccount").href = "https://app.ravenos.xyz/portfolio/#shielded-reserve"; text("reserveAccount", "Open capital helper →"); $("reserveAccount").hidden = false; return;
  }
  try {
    const session = await readAccountSession({ onRetry: () => text('reserveAccess', 'Account check delayed. Retrying automatically…') });
    if (session.state === 'unavailable') {
      text('reserveAccess', 'Your account could not be checked. Reload to retry.');
      return;
    }
    if (session.state === 'signed_out') throw Error("authentication_required");
    state.csrf = session.payload.csrf_token;
    const r = await fetch(api, { credentials: "same-origin", cache: "no-store" }); const config = await r.json();
    if (!r.ok || !config.ok) throw Error(config.error);
    state.config = config; const select = $("reserveNetwork"); select.replaceChildren();
    for (const asset of config.assets) { const option = document.createElement("option"); option.value = asset.key; option.textContent = asset.label + (asset.supported ? "" : " · unavailable"); option.disabled = !asset.supported; select.append(option); }
    select.value = config.assets.find(a => a.supported)?.key || "";
    for (const [key, action] of [["deploy", "SHIELDED_DEPLOY"], ["return", "SHIELDED_RETURN"], ["send", "SHIELDED_SEND"]]) document.querySelector(`[data-reserve-action='${action}']`).disabled = !config.actions[key];
    const enabled = Object.entries(config.actions).find(([,v]) => v)?.[0];
    if (!enabled || !select.value) throw Error("shielded_disabled");
    chooseAction({ deploy: "SHIELDED_DEPLOY", return: "SHIELDED_RETURN", send: "SHIELDED_SEND" }[enabled]);
    text("reserveAccess", "Pro route previews are ready. Live transfers are not available yet."); $("reserveTools").hidden = false;
    const compareAssets = config.assets.filter(a => a.supported && config.comparison?.assets.includes(a.key));
    if (config.comparison?.enabled && compareAssets.length > 1) {
      for (const id of ['reserveCompareSource', 'reserveCompareDestination']) {
        $(id).replaceChildren();
        for (const a of compareAssets) { const option = document.createElement('option'); option.value = a.key; option.textContent = a.label; $(id).append(option); }
      }
      $('reserveCompareSource').value = compareAssets.some(a => a.key === 'base_usdc') ? 'base_usdc' : compareAssets[0].key;
      $('reserveCompareDestination').value = compareAssets.find(a => a.key !== $('reserveCompareSource').value).key;
      $('reserveComparison').hidden = false;
    }
    if (config.zec_price) { text("reservePrice", usd(config.zec_price.usd_micros)); text("reservePriceTime", `Provider reference · ${new Date(config.zec_price.observed_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`); }
  } catch (error) { text("reserveAccess", unavailable(error.message)); $("reserveAccount").hidden = false; }
}
document.querySelectorAll("[data-reserve-action]").forEach(b => b.addEventListener("click", () => chooseAction(b.dataset.reserveAction)));
$("reserveAmount").addEventListener("input", invalidate);
$("reserveNetwork").addEventListener("change", () => { invalidate(); routeNames(); });
$("reserveQuoteForm").addEventListener("submit", requestQuote);
$("reservePlanForm").addEventListener("submit", plan);
$('reserveCompareForm').addEventListener('submit', requestComparison);
$('reserveCompareForm').addEventListener('input', invalidateComparison);
$("reservePlanForm").addEventListener("input", () => { state.excess = null; $("reservePreviewExcess").hidden = true; text("reservePlanResult", "Recalculate to update this scenario."); });
$("reservePreviewExcess").addEventListener("click", () => {
  if (!state.excess) return; chooseAction("SHIELDED_RETURN");
  $("reserveAmount").value = (BigInt(state.excess) / 1000000n).toString() + "." + (BigInt(state.excess) % 1000000n).toString().padStart(6, "0").slice(0, 2);
  text("reserveQuoteStatus", "Excess copied as approximate USD value. Choose the source network and request a preview; USDC/USD can differ.");
  $("reserveQuoteForm").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); $("reserveNetwork").focus();
});
setInterval(() => { updateFreshness(); comparisonFreshness(); }, 1000);
boot();
