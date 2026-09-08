// Device-only presentation choices. Never store identity, balances, credentials,
// wallet destinations, execution settings or legal acceptance in this record.
export const PREFERENCE_KEY = "ravenos:display-preferences:v1";
export const PREFERENCE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const chains = ["solana", "base", "ethereum", "robinhood", "bsc"];
const choices = Object.freeze({
  returning: [true],
  balanceNetwork: chains,
  walletChain: ["all", ...chains],
  walletPeriod: ["h24", "d7", "d30", "all_available"],
  discoverChain: ["all", ...chains],
  discoverTimeframe: ["5m", "1h", "24h"],
  discoverSort: ["velocity", "raven", "activity"],
});
function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function allowed(values) {
  return Object.fromEntries(Object.entries(choices)
    .filter(([key, valuesAllowed]) => valuesAllowed.includes(values?.[key]))
    .map(([key]) => [key, values[key]]));
}
export function readPreferences({ storage = browserStorage(), now = Date.now() } = {}) {
  try {
    const raw = storage?.getItem(PREFERENCE_KEY);
    if (!raw || raw.length > 2048) return {};
    const record = JSON.parse(raw);
    if (record?.version !== 1 || !Number.isFinite(record.savedAt) || record.savedAt > now || now - record.savedAt >= PREFERENCE_TTL_MS) return {};
    return allowed(record.values);
  } catch { return {}; }
}
export function getPreference(key, fallback, options) {
  return readPreferences(options)[key] ?? fallback;
}
export function setPreference(key, value, { storage = browserStorage(), now = Date.now() } = {}) {
  if (!Object.hasOwn(choices, key) || !choices[key].includes(value)) return false;
  try {
    if (!storage) return false;
    storage.setItem(PREFERENCE_KEY, JSON.stringify({ version: 1, savedAt: now, values: { ...readPreferences({ storage, now }), [key]: value } }));
    return true;
  } catch { return false; }
}
export function resetPreferences({ storage = browserStorage() } = {}) {
  try { storage?.removeItem(PREFERENCE_KEY); return Boolean(storage); } catch { return false; }
}

// Resume a known workspace, including its query and anchor, without allowing
// external redirects or API/asset routes. An explicit URL beats device defaults.
const workspaces = new Set(["/account/", "/account/copy/", "/account/intelligence/", "/portfolio/", "/terminal/", "/monitor/", "/discover/", "/agents/", "/community/", "/atlas/", "/lab/"]);
export function accountReturnPath(value) {
  if (typeof value !== "string" || value.length > 1600 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/account/";
  try {
    const url = new URL(value, "https://ravenos.invalid");
    if (url.origin !== "https://ravenos.invalid" || !workspaces.has(url.pathname)) return "/account/";
    url.searchParams.delete("auth");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/account/"; }
}
