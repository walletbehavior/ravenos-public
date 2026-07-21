import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseDotenv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function cloudflareReleaseEnv(repoRoot, baseEnv = process.env) {
  const parentEnvPath = baseEnv.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env");
  const parentEnv = parseDotenv(parentEnvPath);
  const env = { ...baseEnv };
  const apiToken = baseEnv.CLOUDFLARE_API_TOKEN || parentEnv.CLOUDFLARE_API_TOKEN;
  const accountId = baseEnv.CLOUDFLARE_ACCOUNT_ID
    || baseEnv.CLOUDFLARE_API_ACCOUNT_ID
    || parentEnv.CLOUDFLARE_ACCOUNT_ID
    || parentEnv.CLOUDFLARE_API_ACCOUNT_ID;
  if (!apiToken) throw new Error("Required Cloudflare credential is not configured: CLOUDFLARE_API_TOKEN");
  if (!accountId) throw new Error("Required Cloudflare account scope is not configured");
  env.CLOUDFLARE_API_TOKEN = apiToken;
  env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return env;
}
