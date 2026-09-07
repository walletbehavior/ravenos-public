const $ = id => document.getElementById(id);
let action = "SHIELDED_DEPLOY", token = "", quote = null, scenarioState = "shielded";
const format = micros => {
  if (micros == null) return "Unknown";
  const n = BigInt(micros); return `$${(n / 1000000n).toLocaleString("en-US")}.${((n % 1000000n) / 10000n).toString().padStart(2,"0")}`;
};
const ppm = value => { const n = BigInt(value); return `${n < 0n ? "−" : ""}${(n < 0n ? -n : n) / 10000n}.${(((n < 0n ? -n : n) % 10000n) / 100n).toString().padStart(2,"0")}%`; };
const request = async (url, body) => {
  const response = await fetch(url, { method: body ? "POST" : "GET", credentials: "omit", cache: "no-store", headers: body ? { "content-type": "application/json", "x-raven-research": token } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); if (!response.ok) throw Error(data.error || "Research service unavailable"); return data;
};
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => {
  action = button.dataset.action; quote = null; $("quoteResult").hidden = true; $("emptyQuote").hidden = false;
  document.querySelectorAll("[data-action]").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
  const back = action === "SHIELDED_RETURN", send = action === "SHIELDED_SEND";
  $("flowEyebrow").textContent = back ? "BACK TO SHIELDED RESERVE" : send ? "SEND FROM SHIELDED RESERVE" : "FROM SHIELDED RESERVE";
  $("flowTitle").textContent = back ? "Make room for the next move." : send ? "A payment, with context." : "Put capital to work.";
  $("amountUnit").textContent = send ? "Recipient USD equivalent" : "USD equivalent";
  $("networkLabel").textContent = back ? "From public wallet" : "Destination";
  $("quoteButton").textContent = back ? "Shadow return ↗" : send ? "Shadow send ↗" : "Shadow deploy ↗";
  $("amountHelp").textContent = back ? "Public source transaction remains visible. Shielded receipt has not been settlement-tested." : send ? "Quotes a fixed recipient amount at the current price. Research recipient only." : "Converted to a ZEC amount for the quote. Your reserve is exposed to ZEC price changes.";
  $("routeStatus").textContent = "Ready to explore. No executable deposit address will be created.";
}));
$("routeForm").addEventListener("submit", async event => {
  event.preventDefault(); $("quoteButton").disabled = true; $("routeStatus").textContent = "Requesting a read-only quote…";
  $("quoteResult").hidden = true; $("emptyQuote").hidden = false;
  try {
    quote = await request("/api/quote", { action, amount_usd: $("amount").value, network: $("network").value, maximum_delay_seconds: Number($("maxDelay").value) });
    if (!quote.available) { $("routeStatus").textContent = `Route unavailable: ${quote.reason.replaceAll("_", " ")}. No funds moved.`; return; }
    $("emptyQuote").hidden = true; $("quoteResult").hidden = false;
    $("receiveValue").textContent = `${quote.destination_amount} ${action === "SHIELDED_RETURN" ? "ZEC" : $("network").value.endsWith("_usdc") ? "USDC" : $("network").value.endsWith("_sol") ? "SOL" : "ETH"}`;
    $("minimumValue").textContent = `Minimum ${quote.minimum_destination_amount} ${quote.destination_symbol} · marked value ${format(quote.output_usd_micros)}`;
    $("frictionValue").textContent = ppm(quote.all_in_marked_friction_ppm);
    $("timeValue").textContent = `${Math.floor(quote.estimated_settlement_seconds / 60)}m ${quote.estimated_settlement_seconds % 60}s · estimate`;
    $("latencyValue").textContent = `${quote.quote_latency_ms} ms`;
    $("boundaryText").textContent = action === "SHIELDED_RETURN" ? "Source transaction public. Shielded-only recipient accepted by the quote API; receipt remains unverified." : "Source shielding depends on an external shielded wallet. Destination transaction is public. Linkage can still be inferred.";
    if ($("network").value === "hyperliquid_usdc") $("boundaryText").textContent += " Destination is the Hyperliquid perps balance.";
    $("evidenceJson").textContent = JSON.stringify(quote, null, 2);
    $("routeStatus").textContent = "Quote received and provider signature verified. Research only—no funds moved.";
    refreshExpiry();
  } catch { $("routeStatus").textContent = "The research quote could not be completed. No funds moved."; }
  finally { $("quoteButton").disabled = false; }
});
function refreshExpiry() {
  if (!quote?.research_expires_at) return;
  $("expiryValue").textContent = Date.now() >= Date.parse(quote.research_expires_at) ? "Historical · refresh before comparing" : "Current research sample · no executable reservation";
}
setInterval(refreshExpiry, 1000);
async function scenario() {
  try {
    const result = await request("/api/scenario", { hot_usdc: $("hotUsdc").value, reserve_zec: $("reserveZec").value, required_usdc: $("requiredUsdc").value, state: scenarioState });
    $("availableValue").textContent = format(result.public_usd_micros);
    $("reserveValue").textContent = `~${format(result.shielded_usd_micros)}`;
    $("transitValue").textContent = `~${format(result.transit_usd_micros)}`;
    $("reserveDetail").textContent = `${$("reserveZec").value} ZEC scenario · ${format(result.zec_price_usd_micros)} / ZEC`;
    $("copyReadiness").textContent = result.copy.ready ? "The scenario has enough public working capital. Shielded capital is not used for fast execution." : "Shielded deployment is too slow for this Copy strategy. Prepositioned public capital is required.";
    $("capitalTotal").textContent = `Total marked economic capital: ~${format(result.total_usd_micros)}. Unresolved: ${format(result.unresolved_usd_micros)}. Source and destination share one economic lot; no duplicate balance is counted. These are gross asset values, not net equity.`;
  } catch { $("copyReadiness").textContent = "Scenario unavailable. Check the amounts and research service."; }
}
$("scenarioForm").addEventListener("submit", event => { event.preventDefault(); scenario(); });
$("simulateTransit").addEventListener("click", () => { scenarioState = "in_transit"; scenario(); });
$("simulateUnresolved").addEventListener("click", () => { scenarioState = "unresolved"; scenario(); });
$("resetScenario").addEventListener("click", () => { scenarioState = "shielded"; scenario(); });
request("/api/status").then(status => { token = status.token; if (status.enabled) scenario(); else { $("quoteButton").disabled = true; $("routeStatus").textContent = "Shadow research is disabled."; } }).catch(() => { $("quoteButton").disabled = true; $("routeStatus").textContent = "Local research service unavailable."; });
