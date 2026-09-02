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
  await expect(page.getByText("Paused · no order submitted", { exact: true })).toBeVisible();
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

test("owner creates, validates, starts, and pauses an exact two-venue paper agent", async ({ page }) => {
  let created = false;
  let lifecycle = "draft";
  let createRequest = null;
  const transitionRequests = [];
  const paperAgent = () => ({
    agent_id: "agt_browser_created_agent_001",
    name: "SOL Basis Guard",
    strategy_type: "spot_perp_basis_hedge",
    state: lifecycle,
    autonomy: "policy_gated",
    data_health: "No current run",
    venues: ["jupiter", "hyperliquid"],
    capital: [
      { venue: "Solana · Jupiter", available: "500 USDC", reserved: "0", gas: "0.05 SOL", state: "paper" },
      { venue: "Hyperliquid · Perps", available: "500 USDC", reserved: "0", gas: "Venue settled", state: "paper" },
    ],
    configuration: {
      specification_hash: "5b1ed0fb89648c83bec2bc26fbe01471f01913dd60cce96954fa185cb496c04f",
      policy_hash: "f61ed0fb89648c83bec2bc26fbe01471f01913dd60cce96954fa185cb496c04f",
      instruments: [
        { display_symbol: "SOL/USDC", venue: "jupiter", chain_id: "solana:mainnet-beta" },
        { display_symbol: "SOL-PERP", venue: "hyperliquid", chain_id: "hyperliquid:mainnet" },
      ],
      entry_basis_bps: 30,
      exit_basis_bps: 10,
      notional_usdc: "100",
      cadence: "Every 5 minutes",
      schedule_state: lifecycle === "paper" ? "active" : lifecycle === "paper_paused" ? "paused" : "draft",
      user_policy_adopted: true,
    },
    plan: null,
    policy: {
      result: "adopted",
      rules: [
        { name: "Per leg", result: "Adopted", detail: "$100" },
        { name: "Slippage", result: "Adopted", detail: "0.75% max" },
      ],
    },
    events: [{ at: "now", type: `agent_${lifecycle}`, detail: "No order submitted" }],
  });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: true, csrf_token: "csrf_agents_create_fixture" }),
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
      agents: created ? [paperAgent()] : [],
      radar: { freshness_state: "Radar disabled", entries: [] },
    }),
  }));
  await page.route("**/api/v1/agents/drafts", async (route) => {
    createRequest = route.request();
    created = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, agent_id: "agt_browser_created_agent_001", state: "draft", live_execution_enabled: false }),
    });
  });
  for (const action of ["validate", "start-paper", "pause"]) {
    await page.route(`**/api/v1/agents/agt_browser_created_agent_001/${action}`, async (route) => {
      transitionRequests.push(route.request());
      lifecycle = action === "validate" ? "validated" : action === "start-paper" ? "paper" : "paper_paused";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: lifecycle }) });
    });
  }

  await page.goto("/agents/");
  await page.locator("#agentNew").click();
  await expect(page.getByRole("heading", { name: "SOL Basis Guard" })).toBeVisible();
  await page.getByText("I adopt this paper-only policy").click();
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page.getByRole("heading", { name: "SOL Basis Guard" })).toBeVisible();
  await expect(page.getByText("SOL/USDC + SOL-PERP")).toBeVisible();
  const createHeaders = await createRequest.allHeaders();
  expect(createHeaders["x-ravenos-csrf"]).toBe("csrf_agents_create_fixture");
  const createBody = createRequest.postDataJSON();
  expect(createBody).toMatchObject({
    schema_version: "ravenos.agentic.paper_agent_draft_request.v1",
    template: "solana_hyperliquid_sol_hedge",
    notional_usdc: "100",
    solana_capital_usdc: "500",
    hyperliquid_capital_usdc: "500",
    adopt_policy: true,
  });
  expect(createBody).not.toHaveProperty("live_execution_enabled");
  expect(createBody).not.toHaveProperty("calldata");

  await page.locator("#agentValidate").click();
  await expect(page.locator("#agentState")).toHaveText("validated");
  await page.locator("#agentStart").click();
  await expect(page.locator("#agentState")).toHaveText("paper");
  await page.locator("#agentPause").click();
  await expect(page.locator("#agentState")).toHaveText("paper_paused");
  expect(transitionRequests.map((request) => request.method())).toEqual(["POST", "POST", "POST"]);
  for (const request of transitionRequests) {
    const requestHeaders = await request.allHeaders();
    expect(requestHeaders["x-ravenos-csrf"]).toBe("csrf_agents_create_fixture");
  }
  await expect(page.getByText("Paused · no order submitted", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Connect signer");
});
