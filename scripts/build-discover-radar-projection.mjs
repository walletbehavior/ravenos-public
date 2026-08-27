import { buildDiscoverRadarProjection } from "../lib/discover_radar.mjs";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const chunks = [];
let bytes = 0;

for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > MAX_INPUT_BYTES) throw new Error("discover_radar_input_too_large");
  chunks.push(chunk);
}

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  throw new Error("discover_radar_input_malformed");
}

if (
  input?.schema_version !== "ravenos.discover_registry_input.v1"
  || !Array.isArray(input?.rows)
  || input.rows.length > 240
) throw new Error("discover_radar_input_contract_rejected");

const generatedAt = String(input.generated_at || new Date().toISOString());
const generatedMs = Date.parse(generatedAt);
if (!Number.isFinite(generatedMs)) throw new Error("discover_radar_generated_at_invalid");

const result = buildDiscoverRadarProjection(input.rows, {
  timeframe: ["5m", "1h", "24h"].includes(input.timeframe) ? input.timeframe : "5m",
  generatedAt,
  nowMs: generatedMs,
  sourceState: ["current", "degraded", "forming", "shadow"].includes(input.state) ? input.state : "shadow",
});

process.stdout.write(`${JSON.stringify(result)}\n`);
