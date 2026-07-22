import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import {
  mockTerminalLiveApis,
  openExactSpotSearch,
  waitForTerminalLive,
} from "../tests/browser/terminal-live-fixtures.mjs";

const baseUrl = String(process.env.RAVENOS_CAPTURE_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const output = resolve(process.argv[2] || "artifacts/ravenos_terminal_superiority_20260722");
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function capture(name, viewport, { spot = false } = {}) {
  const page = await browser.newPage({ viewport });
  await mockTerminalLiveApis(page);
  await page.goto(`${baseUrl}/terminal/`, { waitUntil: "domcontentloaded" });
  await waitForTerminalLive(page, { instrument: "SOL-PERP", timeframe: "1h" });
  if (spot) {
    await openExactSpotSearch(page, "JUP");
    await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });
  }
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  await page.close();
}

try {
  await capture("hyperliquid-terminal-1440x900", { width: 1440, height: 900 });
  await capture("hyperliquid-terminal-390x844", { width: 390, height: 844 });
  await capture("exact-pool-terminal-1440x900", { width: 1440, height: 900 }, { spot: true });
  await capture("exact-pool-terminal-390x844", { width: 390, height: 844 }, { spot: true });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  ok: true,
  output,
  captures: [
    "hyperliquid-terminal-1440x900.png",
    "hyperliquid-terminal-390x844.png",
    "exact-pool-terminal-1440x900.png",
    "exact-pool-terminal-390x844.png",
  ],
}, null, 2));
