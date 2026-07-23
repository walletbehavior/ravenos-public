import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = String(process.env.RAVENOS_CAPTURE_BASE_URL || "https://ravenos.xyz").replace(/\/+$/, "");
const output = resolve(process.argv[2] || "artifacts/ravenos_overnight_baseline_20260723");
mkdirSync(output, { recursive: true });

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
];

const scenarios = [
  { name: "landing", path: "/" },
  { name: "discover", path: "/discover/" },
  { name: "terminal-hyperliquid", path: "/terminal/?asset=BTC-PERP&instrument_id=hyperliquid%3Aperp%3ABTC&timeframe=15m" },
  { name: "terminal-retire-solana", path: "/terminal/?lane=spot&asset=RETIRE%2FSOL&instrument_id=solana%3Apool%3A6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw&instrument_type=exact_pool&timeframe=15m" },
  { name: "terminal-cbbtc-base", path: "/terminal/?lane=spot&asset=cbBTC%2FUSDC&instrument_id=base%3Apool%3A0x4e962BB3889Bf030368F56810A9c96B83CB3E778&instrument_type=exact_pool&timeframe=15m" },
  { name: "terminal-weth-ethereum", path: "/terminal/?lane=spot&asset=WETH%2FUSDC&instrument_id=ethereum%3Apool%3A0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640&instrument_type=exact_pool&timeframe=15m" },
  { name: "portfolio", path: "/portfolio/" },
  { name: "atlas-aapl", path: "/atlas/?entity_id=equity%3Aus%3AAAPL&symbol=AAPL" },
  { name: "unsupported-robinhood", path: "/terminal/?lane=spot&asset=RUNNER%2FWETH&instrument_id=robinhood%3Apool%3A0x602633428507BBAA848E6D0c3127cda15eEAE6a9&instrument_type=exact_pool&timeframe=15m" },
];

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      const failedRequests = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
      });
      page.on("requestfailed", (request) => {
        failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "request_failed" });
      });

      const startedAt = Date.now();
      let status = null;
      let navigationError = null;
      try {
        const response = await page.goto(`${baseUrl}${scenario.path}`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        status = response?.status() ?? null;
        await page.waitForTimeout(scenario.name.startsWith("terminal-") ? 6_000 : 3_500);
      } catch (error) {
        navigationError = String(error?.message || error).slice(0, 800);
      }

      const layout = await page.evaluate(() => ({
        title: document.title,
        bodyWidth: document.body?.scrollWidth || 0,
        documentWidth: document.documentElement?.scrollWidth || 0,
        viewportWidth: innerWidth,
        overflowX: Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0) > innerWidth + 1,
        chartCanvases: document.querySelectorAll("canvas").length,
        visibleText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1_500),
      })).catch(() => null);

      const filename = `${scenario.name}-${viewport.name}.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: false });
      results.push({
        scenario: scenario.name,
        viewport: viewport.name,
        url: page.url(),
        status,
        durationMs: Date.now() - startedAt,
        navigationError,
        layout,
        consoleErrors,
        failedRequests,
        screenshot: filename,
      });
      console.log(`${scenario.name} ${viewport.name} status=${status ?? "n/a"} canvas=${layout?.chartCanvases ?? "n/a"} overflow=${layout?.overflowX ?? "n/a"}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const manifest = {
  capturedAt: new Date().toISOString(),
  baseUrl,
  output,
  count: results.length,
  results,
};
writeFileSync(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, output, count: results.length }, null, 2));
