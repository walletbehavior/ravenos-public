import { expect, test } from "@playwright/test";

test("Terminal ships strict script policy and baseline browser security headers", async ({ page }) => {
  const response = await page.goto("/terminal/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const headers = response?.headers() || {};
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["content-security-policy"]).toContain("base-uri 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
});

test("stored instrument metadata renders as text and cannot become utility markup", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ravenos:selected-context:v2", JSON.stringify({
      schemaVersion: "ravenos.context.v2",
      subject: {
        id: "hyperliquid:perp:SOL",
        label: "SOL-PERP",
        assetClass: "crypto",
        instrumentType: "perpetual",
        identityScope: "exact_instrument",
        chain: "hyperliquid",
        venue: "hyperliquid",
        marketType: "perp",
      },
      history: [{
        subject: {
          id: "malicious\" onmouseover=\"window.__RAVENOS_XSS__=true",
          label: "<img src=x onerror=window.__RAVENOS_XSS__=true>",
          assetClass: "crypto",
          instrumentType: "perpetual",
          identityScope: "exact_instrument",
          chain: "hyperliquid",
          venue: "hyperliquid",
          marketType: "perp",
        },
      }],
    }));
  });
  await page.goto("/terminal/", { waitUntil: "domcontentloaded" });
  await page.locator("#rosProfileTrigger").click();
  await page.locator('#rosUtilityContent [data-ros-utility="watchlist"]').click();
  const drawer = page.locator("#rosUtilityContent");
  await expect(drawer).toContainText("<img src=x onerror=window.__RAVENOS_XSS__=true>");
  await expect(drawer.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__RAVENOS_XSS__ === true)).toBe(false);
});

test("legacy customer routes and current execution boundary remain fail closed", async ({ page }) => {
  await page.goto("/terminal/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const [access, flags] = await Promise.all([
      fetch("/api/access?wallet=must-not-echo", { cache: "no-store" }),
      fetch("/api/trade/flags", { cache: "no-store" }),
    ]);
    return {
      accessStatus: access.status,
      access: await access.json(),
      flagsStatus: flags.status,
      flags: await flags.json(),
    };
  });
  expect(result.accessStatus).toBe(503);
  expect(result.access.error).toBe("legacy_customer_access_quarantined");
  expect(JSON.stringify(result.access)).not.toContain("must-not-echo");
  expect(result.flagsStatus).toBe(200);
  expect(result.flags.quote_only).toBe(true);
  expect(result.flags.signing_available).toBe(false);
  expect(result.flags.submission_available).toBe(false);
  expect(result.flags.flags.RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE).toBe(false);
  expect(result.flags.flags.RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE).toBe(false);
});
