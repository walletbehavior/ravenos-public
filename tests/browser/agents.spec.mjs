import { expect, test } from "@playwright/test";

test("Agents renders the two-venue partial paper path without implying live execution", async ({ page }) => {
  await page.goto("/agents/?fixture=two-venue");

  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.locator("#agentsStatus span")).toHaveText("Development fixture");
  await expect(page.getByText("Live off")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SOL Basis Guard" })).toBeVisible();
  await expect(page.getByText("partially executed", { exact: true })).toBeVisible();
  await expect(page.getByText("Solana spot leg filled")).toBeVisible();
  await expect(page.getByText("Hyperliquid hedge quote expired")).toBeVisible();
  await expect(page.getByText("Plan remains partial; no retry or unwind")).toBeVisible();
  await expect(page.getByText("No signing or order submission")).toBeVisible();

  await page.getByRole("button", { name: "Agent Radar" }).click();
  await expect(page.getByRole("heading", { name: "Agent Radar" })).toBeVisible();
  await expect(page.getByText("Verified facts")).toBeVisible();
  await expect(page.getByText("Project claims")).toBeVisible();
  await expect(page.getByText("Unknowns")).toBeVisible();
  await expect(page.getByText("Revenue attribution")).toBeVisible();
});

test("Agents never enables live controls in the local paper fixture", async ({ page }) => {
  await page.goto("/agents/?fixture=two-venue");
  await expect(page.locator("#agentPause")).toBeDisabled();
  await expect(page.locator("#agentKill")).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("Place live order");
  await expect(page.locator("body")).not.toContainText("Connect signer");
});

test("Agents keeps paper state and Agent Radar contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents/?fixture=two-venue");
  await expect(page.getByText("Live off")).toBeVisible();
  await expect(page.getByText("Plan remains partial; no retry or unwind")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Agent Radar" }).click();
  await expect(page.getByText("Revenue attribution")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("real paper agent pause uses CSRF and refreshes the append-only state", async ({ page }) => {
  let workspaceCalls = 0;
  let pauseRequest = null;
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: true, csrf_token: "csrf_agents_fixture" }),
  }));
  await page.route("**/api/v1/agents/workspace", (route) => {
    workspaceCalls += 1;
    const paused = workspaceCalls > 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.agentic.workspace.v1",
        demonstration_data: false,
        environment: "paper",
        live_execution_enabled: false,
        agents: [{
          agent_id: "agt_browser_paper_agent_001",
          name: "Browser paper agent",
          strategy_type: "typed_strategy",
          state: paused ? "paper_paused" : "paper",
          autonomy: "policy_gated",
          data_health: "Current",
          venues: ["Solana"],
          capital: [],
          plan: null,
          policy: { result: "indeterminate", rules: [] },
          events: paused ? [{ at: "now", type: "agent_paused", detail: "explicit owner request" }] : [],
        }],
        radar: { freshness_state: "No indexed evidence", entries: [] },
      }),
    });
  });
  await page.route("**/api/v1/agents/agt_browser_paper_agent_001/pause", async (route) => {
    pauseRequest = route.request();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "paper_paused" }) });
  });

  await page.goto("/agents/");
  await expect(page.getByRole("heading", { name: "Browser paper agent" })).toBeVisible();
  await page.locator("#agentPause").click();
  await expect(page.locator("#agentState")).toHaveText("paper_paused");
  expect(pauseRequest.method()).toBe("POST");
  const pauseHeaders = await pauseRequest.allHeaders();
  expect(pauseHeaders["content-type"]).toBe("application/json");
  expect(pauseHeaders["x-ravenos-csrf"]).toBe("csrf_agents_fixture");
  await expect(page.locator("#agentPause")).toBeDisabled();
  await expect(page.getByText("no order submitted", { exact: false })).toBeVisible();
});

test("draft agents expose kill but not an invalid pause transition", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: true, csrf_token: "csrf_agents_fixture" }),
  }));
  await page.route("**/api/v1/agents/workspace", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      schema_version: "ravenos.agentic.workspace.v1",
      demonstration_data: false,
      environment: "paper",
      live_execution_enabled: false,
      agents: [{
        agent_id: "agt_browser_draft_agent_001",
        name: "Draft agent",
        strategy_type: "typed_strategy",
        state: "draft",
        autonomy: "propose_only",
        data_health: "No current run",
        venues: [],
        capital: [],
        plan: null,
        policy: { result: "indeterminate", rules: [] },
        events: [],
      }],
      radar: { freshness_state: "Radar disabled", entries: [] },
    }),
  }));
  await page.goto("/agents/");
  await expect(page.locator("#agentPause")).toBeDisabled();
  await expect(page.locator("#agentKill")).toBeEnabled();
});
