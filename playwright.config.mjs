import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1440, height: 1100 },
  },
  webServer: {
    command: `node scripts/playwright_terminal_server.mjs`,
    cwd: ".",
    url: `http://127.0.0.1:${port}/terminal/`,
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      PORT: String(port),
    },
  },
});
