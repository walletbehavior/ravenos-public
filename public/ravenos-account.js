const page = document.querySelector(".account-page");
const authWorkspace = document.getElementById("accountAuthWorkspace");
const dashboard = document.getElementById("accountDashboard");
const actions = document.getElementById("accountAuthActions");
const activation = document.getElementById("accountActivation");
const serviceState = document.getElementById("accountServiceState");
const authStatus = document.getElementById("accountAuthStatus");
const governorPanel = document.getElementById("accountGovernorPanel");
const governorControls = document.getElementById("accountGovernorControls");
const governorWallet = document.getElementById("accountGovernorWallet");
const governorAnalyze = document.getElementById("accountGovernorAnalyze");
const governorResults = document.getElementById("accountGovernorResults");
const proPanel = document.getElementById("accountProPanel");
const proCapabilities = document.getElementById("accountProCapabilities");
const referralPanel = document.getElementById("accountReferralPanel");
const referralControls = document.getElementById("accountReferralControls");
const state = {
  config: null,
  session: null,
  csrf: "",
  intent: "sign_up",
  previewWallets: [],
  entitlements: null,
  referral: null,
  privy: { config: null, client: null, wallets: [] },
  pendingReferral: "",
  browserWallet: { chain: null, address: null, provider: null, listenersBound: false },
};

function renderPrivyWallets(wallets = []) {
  const stage = document.getElementById("accountPrivyWallets");
  const rows = Array.isArray(wallets) ? wallets : [];
  stage.hidden = rows.length === 0;
  stage.replaceChildren(...rows.map((wallet) => {
    const row = document.createElement("article");
    row.className = "account-privy-wallet";
    const label = document.createElement("span");
    const address = document.createElement("strong");
    const detail = document.createElement("small");
    label.textContent = wallet.ecosystem === "solana" ? "Solana" : "EVM · shared across supported EVM chains";
    address.textContent = wallet.address;
    address.title = wallet.address;
    detail.textContent = "Embedded · user controlled";
    row.append(label, address, detail);
    return row;
  }));
}

function renderPrivyState(payload) {
  const panel = document.getElementById("accountPrivyPanel");
  const button = document.getElementById("accountPrivyCreate");
  if (!payload?.available) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const wallets = Array.isArray(payload.wallets) ? payload.wallets : [];
  const capabilities = payload.capabilities || {};
  const enabledEcosystems = [capabilities.evm && "EVM", capabilities.solana && "Solana"].filter(Boolean);
  const walletLabel = enabledEcosystems.length === 2
    ? "Solana and EVM wallets"
    : enabledEcosystems.length === 1 ? `${enabledEcosystems[0]} wallet` : "trading wallet";
  state.privy.wallets = wallets;
  panel.dataset.state = payload.linked ? "linked" : "available";
  setText("accountPrivyState", payload.linked ? "Ready" : "Optional");
  setText("accountPrivyTitle", payload.linked ? "Your Raven Wallet" : "Create wallets when you want to trade.");
  setText("accountPrivyStatus", payload.linked
    ? `${wallets.length} ${wallets.length === 1 ? "wallet" : "wallets"} ready. Raven login remains separate.`
    : `Creates your ${walletLabel} without changing your login.`);
  button.hidden = payload.linked;
  renderPrivyWallets(wallets);
}

async function loadPrivyFactory() {
  if (globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__?.create) return globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__;
  const { response, payload } = await getJson("/ravenos_asset_manifest.json");
  const assetUrl = String(payload?.assets?.["ravenos-privy-wallet.js"]?.url || "");
  if (!response.ok || !/^\/assets\/ravenos-privy-wallet\.[0-9a-f]{16}\.js$/.test(assetUrl)) {
    throw new Error("privy_sdk_unavailable");
  }
  await import(assetUrl);
  if (!globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__?.create) throw new Error("privy_sdk_unavailable");
  return globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__;
}

async function loadPrivyWallets() {
  try {
    const { response, payload } = await getJson("/api/v1/wallets/privy");
    if (!response.ok) return renderPrivyState(null);
    state.privy.config = payload;
    renderPrivyState(payload);
  } catch {
    renderPrivyState(null);
  }
}

async function createPrivyWallets() {
  const button = document.getElementById("accountPrivyCreate");
  const status = document.getElementById("accountPrivyStatus");
  if (!state.csrf || !state.privy.config?.available) return;
  button.disabled = true;
  status.dataset.tone = "";
  status.textContent = "Creating secure wallets…";
  try {
    const factory = await loadPrivyFactory();
    const session = await getJson("/api/v1/wallets/privy/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: "{}",
    });
    if (!session.response.ok || !session.payload?.token) throw new Error(session.payload?.error || "privy_session_unavailable");
    const client = state.privy.client || factory.create({
      appId: state.privy.config.app_id,
      clientId: state.privy.config.client_id,
    });
    state.privy.client = client;
    await client.sync(session.payload.token);
    await client.provision(session.payload.wallets || {});
    const identityToken = await client.identityToken();
    const linked = await getJson("/api/v1/wallets/privy/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ravenos-csrf": state.csrf,
        "privy-id-token": identityToken,
      },
      body: "{}",
    });
    if (!linked.response.ok || !linked.payload?.linked) throw new Error(linked.payload?.error || "privy_link_failed");
    renderPrivyState({ ...state.privy.config, ...linked.payload, available: true });
  } catch (error) {
    status.dataset.tone = "error";
    status.textContent = error?.message === "privy_identity_conflict"
      ? "This wallet identity is already linked to another Raven account."
      : "Wallet setup could not finish. Your Raven login is unchanged.";
  } finally {
    button.disabled = false;
  }
}

const PRO_CAPABILITY_DISPLAY = Object.freeze({
  "intelligence.perps_advanced": Object.freeze({ label: "Advanced Perps Intelligence", route: "/api/v1/intelligence/perps" }),
  "intelligence.participant_advanced": Object.freeze({ label: "Behavior Lab", route: "/api/v1/intelligence/participants" }),
  "wallet.copy": Object.freeze({ label: "Advanced Wallet Intelligence", route: "/api/v1/wallet-copy" }),
  "agents.paper": Object.freeze({ label: "Agent Workspace", route: "/api/v1/agents/workspace" }),
});

async function getJson(url, init = {}) {
  const { headers = {}, ...rest } = init;
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...rest, headers: { accept: "application/json", ...headers } });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function initial(value) {
  return String(value || "R").trim().charAt(0).toUpperCase() || "R";
}

function normalizedUsername(account = {}) {
  const username = String(account?.username || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,23}$/.test(username) ? username : "";
}

function renderAccountIdentity(account = {}) {
  const username = normalizedUsername(account);
  const label = username ? `@${username}` : "Raven user";
  const panel = document.getElementById("accountUsernamePanel");
  const input = document.getElementById("accountUsername");
  const status = document.getElementById("accountUsernameStatus");
  document.getElementById("accountDisplayName").textContent = label;
  document.getElementById("accountEmail").textContent = account?.email || "";
  document.getElementById("accountProfileMark").textContent = initial(username || "R");
  document.getElementById("accountUsernameTitle").textContent = username ? `@${username}` : "Choose a username";
  document.getElementById("accountUsernameState").textContent = username ? "Active" : "Required";
  document.getElementById("accountUsernameSave").textContent = username ? "Update username" : "Save username";
  panel.dataset.state = username ? "active" : "required";
  input.value = username;
  status.dataset.tone = "";
  status.textContent = username ? "This is the name RavenOS shows." : "Choose the name other RavenOS users will see.";
  window.dispatchEvent(new CustomEvent("ravenos:accountstate", {
    detail: { authenticated: true, username, display_name: label },
  }));
}

function formatSeen(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Active session";
  return `Active ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed)}`;
}

function formatTimestamp(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

function formatUsdMinor(value) {
  const raw = String(value ?? "");
  if (!/^-?\d+$/.test(raw)) return "Unavailable";
  const amount = BigInt(raw);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 1_000_000n;
  const cents = (absolute % 1_000_000n) / 10_000n;
  return `${negative ? "−" : ""}$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

function formatAmount(value, decimals) {
  const raw = String(value ?? "");
  const places = Number(decimals);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(places) || places < 0 || places > 30) return "Amount unavailable";
  const padded = raw.padStart(places + 1, "0");
  const whole = places ? padded.slice(0, -places) : padded;
  const fraction = places ? padded.slice(-places).slice(0, 6).replace(/0+$/, "") : "";
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function formatBps(value) {
  const bps = Number(value);
  if (!Number.isFinite(bps)) return "Share unavailable";
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function integerString(value) {
  const raw = String(value ?? "");
  return /^-?\d+$/.test(raw) ? raw : null;
}

function formatUnitPriceFromMinor(valueMinor, amountBaseUnits, decimals) {
  const valueRaw = integerString(valueMinor);
  const amountRaw = integerString(amountBaseUnits);
  const places = Number(decimals);
  if (valueRaw === null || amountRaw === null || !Number.isSafeInteger(places) || places < 0 || places > 30) return "Unavailable";
  const amount = BigInt(amountRaw);
  if (amount <= 0n) return "Unavailable";
  const value = BigInt(valueRaw);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const displayScale = 100_000_000n;
  const scaled = (absolute * (10n ** BigInt(places)) * displayScale) / (amount * 1_000_000n);
  if (scaled === 0n && absolute > 0n) return `${negative ? "−" : ""}<$0.00000001`;
  const whole = scaled / displayScale;
  const rawFraction = (scaled % displayScale).toString().padStart(8, "0");
  const maximumDecimals = whole >= 1_000n ? 2 : whole >= 1n ? 4 : 8;
  const fraction = rawFraction.slice(0, maximumDecimals).replace(/0+$/, "");
  const suffix = fraction ? `.${fraction}` : ".00";
  return `${negative ? "−" : ""}$${whole.toLocaleString("en-US")}${suffix}`;
}

function readableState(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function referralCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(normalized) ? normalized : "";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function shortWalletAddress(value) {
  const address = String(value || "");
  return address.length > 16 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
}

function solanaWalletProvider() {
  const candidates = [
    ["Phantom", globalThis.phantom?.solana],
    ["Solflare", globalThis.solflare],
    ["Backpack", globalThis.backpack?.solana],
    ["Solana", globalThis.solana],
  ];
  const [name, provider] = candidates.find(([, candidate]) => typeof candidate?.connect === "function") || [];
  return provider ? { name, provider } : null;
}

function evmWalletProvider() {
  return typeof globalThis.ethereum?.request === "function"
    ? { name: "EVM", provider: globalThis.ethereum }
    : null;
}

function solanaAddress(value) {
  const address = String(value?.toBase58?.() || value?.toString?.() || value || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
}

function evmAddress(accounts) {
  return Array.isArray(accounts)
    ? accounts.find((value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || ""))) || null
    : null;
}

function renderBrowserWallet(message = "") {
  const wallet = state.browserWallet;
  const connected = Boolean(wallet.address);
  setText("accountWalletConnectionTitle", connected ? shortWalletAddress(wallet.address) : "No wallet connected");
  setText("accountWalletConnectionDetail", connected ? `${wallet.chain} · this tab only` : "Address only. No signing.");
  setText("accountWalletConnectionState", connected ? "Connected" : "Read only");
  setText("accountWalletOwnershipState", connected ? "Not proven" : "Not linked");
  setText("accountWalletConnectStatus", message);
  const solana = document.getElementById("accountConnectSolana");
  const evm = document.getElementById("accountConnectEvm");
  const clear = document.getElementById("accountDisconnectWallet");
  if (solana) solana.dataset.connected = String(wallet.chain === "Solana" && connected);
  if (evm) evm.dataset.connected = String(wallet.chain === "EVM" && connected);
  if (clear) clear.hidden = !connected;
}

function clearBrowserWallet(message = "Cleared. Nothing retained.") {
  state.browserWallet = { chain: null, address: null, provider: null, listenersBound: false };
  const status = document.getElementById("accountWalletConnectStatus");
  if (status) status.dataset.tone = "";
  renderBrowserWallet(message);
}

function bindBrowserWalletEvents(chain, provider) {
  if (state.browserWallet.listenersBound || typeof provider?.on !== "function") return;
  state.browserWallet.listenersBound = true;
  if (chain === "EVM") {
    provider.on("accountsChanged", (accounts) => {
      if (state.browserWallet.chain !== "EVM" || state.browserWallet.provider !== provider) return;
      const address = evmAddress(accounts);
      if (!address) return clearBrowserWallet("Wallet disconnected.");
      state.browserWallet.address = address;
      renderBrowserWallet("Address updated.");
    });
    provider.on?.("disconnect", () => {
      if (state.browserWallet.chain === "EVM") clearBrowserWallet("Wallet disconnected.");
    });
  } else {
    provider.on("accountChanged", (publicKey) => {
      if (state.browserWallet.chain !== "Solana" || state.browserWallet.provider !== provider) return;
      const address = solanaAddress(publicKey);
      if (!address) return clearBrowserWallet("Wallet disconnected.");
      state.browserWallet.address = address;
      renderBrowserWallet("Address updated.");
    });
    provider.on?.("disconnect", () => {
      if (state.browserWallet.chain === "Solana") clearBrowserWallet("Wallet disconnected.");
    });
  }
}

async function connectBrowserWallet(chain) {
  const status = document.getElementById("accountWalletConnectStatus");
  if (status) status.dataset.tone = "";
  const selected = chain === "Solana" ? solanaWalletProvider() : evmWalletProvider();
  if (!selected) {
    if (status) status.dataset.tone = "error";
    return renderBrowserWallet(`${chain} wallet not detected.`);
  }
  renderBrowserWallet("Connecting…");
  try {
    let address = null;
    if (chain === "Solana") {
      const result = await selected.provider.connect();
      address = solanaAddress(result?.publicKey || selected.provider.publicKey);
    } else {
      address = evmAddress(await selected.provider.request({ method: "eth_requestAccounts" }));
    }
    if (!address) throw new Error("wallet_address_unavailable");
    state.browserWallet = { chain, address, provider: selected.provider, listenersBound: false };
    bindBrowserWalletEvents(chain, selected.provider);
    renderBrowserWallet(`${selected.name} connected · no signature`);
  } catch {
    if (status) status.dataset.tone = "error";
    clearBrowserWallet("Connection canceled.");
    if (status) status.dataset.tone = "error";
  }
}

function proCapabilityNode(capability, projectionPayload = null) {
  const display = PRO_CAPABILITY_DISPLAY[capability.capability] || { label: "Unavailable capability", route: null };
  const row = document.createElement("article");
  row.className = "account-pro-capability";
  row.dataset.state = String(capability.state || "unavailable");
  row.setAttribute("role", "listitem");

  const heading = document.createElement("div");
  const label = document.createElement("strong");
  const status = document.createElement("span");
  label.textContent = display.label;
  status.textContent = readableState(capability.state || "unavailable");
  heading.append(label, status);

  const detail = document.createElement("p");
  if (!capability.available || !projectionPayload?.ok) {
    detail.textContent = capability.state === "expired"
      ? "Pro access expired."
      : capability.state === "revoked"
        ? "Pro access removed."
        : capability.state === "suspended"
          ? "Pro access paused."
          : "Not enabled for this account.";
  } else if (capability.capability === "wallet.copy") {
    detail.textContent = "Cohorts, behavior, profit quality, deep history, and copyability evidence.";
  } else if (capability.capability === "agents.paper") {
    const agents = Array.isArray(projectionPayload.agents) ? projectionPayload.agents : [];
    detail.textContent = `${agents.length} paper agent${agents.length === 1 ? "" : "s"} · policy and reconciliation ready`;
  } else if (capability.capability === "intelligence.perps_advanced") {
    const advanced = projectionPayload.projection?.advanced || {};
    const freshness = projectionPayload.projection?.provenance?.freshness?.state || "unavailable";
    detail.textContent = `${advanced.positioning?.length || 0} positioning markets · ${advanced.pressure_and_crowding?.length || 0} pressure markets · ${readableState(freshness)}`;
  } else {
    const advanced = projectionPayload.projection?.advanced || {};
    const freshness = projectionPayload.projection?.provenance?.freshness?.state || "unavailable";
    detail.textContent = `${advanced.condition_matrix?.length || 0} aggregate conditions · ${readableState(freshness)} evidence`;
  }

  const boundary = document.createElement("small");
  boundary.textContent = capability.available && projectionPayload?.ok
    ? capability.capability === "wallet.copy"
      ? "Deep analysis · Raven Copy remains free"
      : capability.capability === "agents.paper"
        ? "Paper only · live automation off"
        : "Private · read only"
    : "No restricted data";
  row.append(heading, detail, boundary);
  return row;
}

function unavailableProCapabilities(stateLabel = "server_disabled") {
  return Object.keys(PRO_CAPABILITY_DISPLAY).map((capability) => ({ capability, available: false, state: stateLabel }));
}

async function loadProIntelligenceCapabilities() {
  if (!proPanel || !proCapabilities) return;
  try {
    const { response, payload } = await getJson("/api/v1/entitlements");
    if (!response.ok || !Array.isArray(payload?.capabilities)) {
      proPanel.dataset.proState = "unavailable";
      setText("accountProState", "Unavailable");
      setText("accountProStatus", "Pro access isn’t available for this account yet. Public Intelligence still works.");
      proCapabilities.replaceChildren(...unavailableProCapabilities(payload?.state || "server_disabled").map((capability) => proCapabilityNode(capability)));
      return;
    }

    state.entitlements = payload;
    const capabilities = Object.keys(PRO_CAPABILITY_DISPLAY).map((key) => payload.capabilities.find((row) => row.capability === key) || { capability: key, available: false, state: "unavailable" });
    const responses = new Map();
    await Promise.all(capabilities.filter((capability) => capability.available).map(async (capability) => {
      const route = PRO_CAPABILITY_DISPLAY[capability.capability]?.route;
      if (!route) return;
      const result = await getJson(route);
      responses.set(capability.capability, result.response.ok ? result.payload : null);
      if (!result.response.ok && result.payload?.state) capability.state = result.payload.state;
    }));
    proCapabilities.replaceChildren(...capabilities.map((capability) => proCapabilityNode(capability, responses.get(capability.capability))));
    const availableCount = capabilities.filter((capability) => capability.available && responses.get(capability.capability)?.ok).length;
    proPanel.dataset.proState = availableCount ? "available" : "unavailable";
    setText("accountProState", availableCount ? `${availableCount} available` : "Unavailable");
    setText("accountProStatus", availableCount
      ? "Your available Pro workspaces are ready below. They remain read-only; live trade authority is separate."
      : "Pro access isn’t available for this account yet. Public Intelligence still works.");
  } catch {
    proPanel.dataset.proState = "unavailable";
    setText("accountProState", "Unavailable");
    setText("accountProStatus", "We couldn’t verify Pro access. Public Intelligence remains available.");
    proCapabilities.replaceChildren(...unavailableProCapabilities("unavailable").map((capability) => proCapabilityNode(capability)));
  }
}

function renderReferralProgram(referral = {}) {
  state.referral = referral;
  const code = referralCode(referral.referral_code);
  const attributionRecorded = referral.attribution?.state === "recorded";
  referralPanel.dataset.referralState = attributionRecorded ? "recorded" : code ? "active" : "not_created";
  setText("accountReferralState", attributionRecorded ? "Attributed" : code ? "Active" : "Ready");
  setText("accountReferralStatus", attributionRecorded
    ? "Your referral is recorded. Qualification still requires verified Raven Pro subscription evidence."
    : code
      ? "Your private link is ready. Rewards remain unavailable until billing and a reward policy are approved."
      : "Create an opaque link. Raven never uses trade volume, returns, or follower losses to calculate a referral.");
  setText("accountReferralAccounts", Number(referral.referred_accounts || 0).toLocaleString());
  setText("accountReferralQualified", Number(referral.qualified_pro_subscriptions || 0).toLocaleString());
  setText("accountReferralRewards", referral.economics?.reward_policy_state === "configured" ? "Configured" : "Not configured");
  const link = document.getElementById("accountReferralLink");
  const create = document.getElementById("accountReferralCreate");
  const copy = document.getElementById("accountReferralCopy");
  const claim = document.getElementById("accountReferralClaimForm");
  link.value = code && referral.referral_url ? String(referral.referral_url) : "Not created";
  create.hidden = Boolean(code);
  copy.hidden = !code;
  claim.hidden = attributionRecorded;
  const pending = referralCode(state.pendingReferral);
  const claimInput = document.getElementById("accountReferralClaimCode");
  if (!claimInput.value && pending) claimInput.value = pending;
  referralControls.hidden = false;
}

function renderReferralUnavailable(message = "Referrals are not open yet.") {
  referralPanel.dataset.referralState = "unavailable";
  setText("accountReferralState", "Not available");
  setText("accountReferralStatus", message);
  referralControls.hidden = true;
}

async function loadReferralProgram() {
  if (!referralPanel || !referralControls) return;
  try {
    const { response, payload } = await getJson("/api/v1/referrals/me");
    if (!response.ok || !payload?.referral) return renderReferralUnavailable();
    renderReferralProgram(payload.referral);
  } catch {
    renderReferralUnavailable("Referral access could not be checked. Nothing was attributed.");
  }
}

async function createReferralLink() {
  if (!state.csrf) return renderReferralUnavailable("Refresh and sign in again before creating a link.");
  const button = document.getElementById("accountReferralCreate");
  button.disabled = true;
  setText("accountReferralStatus", "Creating your private link…");
  try {
    const { response, payload } = await getJson("/api/v1/referrals/code", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: "{}",
    });
    if (!response.ok || !payload?.referral) {
      setText("accountReferralStatus", payload?.error === "username_required" ? "Choose a Raven username first." : "A referral link could not be created.");
      return;
    }
    renderReferralProgram(payload.referral);
  } catch {
    setText("accountReferralStatus", "A referral link could not be created.");
  } finally {
    button.disabled = false;
  }
}

async function claimReferral(event) {
  event.preventDefault();
  const input = document.getElementById("accountReferralClaimCode");
  const button = document.getElementById("accountReferralClaim");
  const code = referralCode(input.value);
  if (!code) return setText("accountReferralStatus", "Enter a valid Raven referral code.");
  if (!state.csrf) return setText("accountReferralStatus", "Refresh and sign in again before applying a code.");
  button.disabled = true;
  setText("accountReferralStatus", "Recording attribution…");
  try {
    const { response, payload } = await getJson("/api/v1/referrals/claim", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: JSON.stringify({ referral_code: code }),
    });
    if (!response.ok || !payload?.referral) {
      const message = payload?.error === "self_referral_not_allowed" ? "You cannot use your own referral code."
        : payload?.error === "referral_already_attributed" ? "This account already has a different referral."
          : payload?.error === "referral_code_not_found" ? "That referral code is not active."
            : "The referral could not be recorded.";
      setText("accountReferralStatus", message);
      return;
    }
    state.pendingReferral = "";
    renderReferralProgram(payload.referral);
  } catch {
    setText("accountReferralStatus", "The referral could not be recorded.");
  } finally {
    button.disabled = false;
  }
}

async function copyReferralLink() {
  const link = document.getElementById("accountReferralLink");
  if (!state.referral?.referral_url) return;
  try {
    await navigator.clipboard.writeText(state.referral.referral_url);
    setText("accountReferralStatus", "Referral link copied.");
  } catch {
    link.focus();
    link.select();
    setText("accountReferralStatus", "Link selected. Copy it from the field.");
  }
}

function governorChip(label, tone = "neutral") {
  const chip = document.createElement("span");
  chip.className = "account-governor-chip";
  chip.dataset.tone = tone;
  chip.textContent = readableState(label);
  return chip;
}

function governorEmpty(message, tone = "neutral") {
  const row = document.createElement("p");
  row.className = "account-governor-empty";
  row.dataset.tone = tone;
  row.textContent = message;
  return row;
}

function governorMetric(label, value, stateLabel) {
  const card = document.createElement("article");
  const key = document.createElement("span");
  const amount = document.createElement("strong");
  const status = document.createElement("small");
  key.textContent = label;
  amount.textContent = value;
  status.textContent = readableState(stateLabel);
  card.append(key, amount, status);
  return card;
}

function governorRow({ title, detail, values = [], states = [] }) {
  const row = document.createElement("article");
  row.className = "account-governor-row";
  const identity = document.createElement("div");
  const name = document.createElement("strong");
  const description = document.createElement("span");
  name.textContent = title;
  description.textContent = detail;
  identity.append(name, description);
  row.append(identity);
  for (const entry of values) {
    const value = document.createElement("div");
    const label = document.createElement("span");
    const amount = document.createElement("strong");
    label.textContent = entry.label;
    amount.textContent = entry.value;
    value.append(label, amount);
    row.append(value);
  }
  const status = document.createElement("div");
  status.className = "account-governor-row-state";
  const renderedStates = states.length ? states : ["resolved"];
  for (const entry of renderedStates.slice(0, 4)) {
    const normalized = String(entry || "unknown");
    const tone = /unresolved|unavailable|unsupported|failed|violation/.test(normalized)
      ? "attention"
      : /stale|partial|unknown|indeterminate|unrouteable/.test(normalized) ? "warning" : "positive";
    status.append(governorChip(normalized, tone));
  }
  row.append(status);
  return row;
}

function renderGovernorSummary(summary = {}) {
  const container = document.getElementById("accountGovernorSummary");
  container.replaceChildren(
    governorMetric("Marked value", formatUsdMinor(summary.marked_portfolio_value_minor), summary.marked_value_state),
    governorMetric("Executable value", formatUsdMinor(summary.executable_value_minor), summary.executable_value_state),
    governorMetric("Net equity", formatUsdMinor(summary.net_equity_minor), summary.net_equity_state),
    governorMetric("Gross exposure", formatUsdMinor(summary.gross_exposure_minor), "calculated"),
    governorMetric("Liabilities", formatUsdMinor(summary.liabilities_minor), summary.liability_value_state),
    governorMetric("Unresolved value", formatUsdMinor(summary.unresolved_value_minor), summary.unresolved_unknown_value_count ? "plus unknown value" : "measured"),
  );
}

function renderGovernorHoldings(holdings = {}) {
  const container = document.getElementById("accountGovernorHoldings");
  const rows = Array.isArray(holdings.rows) ? holdings.rows : [];
  setText("accountGovernorHoldingCount", `${holdings.returned_position_count || 0} shown`);
  if (!rows.length) return container.replaceChildren(governorEmpty("No material visible positions were returned."));
  container.replaceChildren(...rows.map(governorHoldingRow));
}

function holdingMetric(label, value, detail, state = "available") {
  const metric = document.createElement("div");
  metric.className = "account-holding-metric";
  metric.dataset.label = label;
  metric.dataset.state = state;
  const primary = document.createElement("strong");
  primary.textContent = value;
  const secondary = document.createElement("span");
  secondary.textContent = detail;
  metric.append(primary, secondary);
  return metric;
}

function governorHoldingRow(row) {
  const instrument = row.instrument || {};
  const holding = document.createElement("article");
  holding.className = "account-holding-row";
  const identity = document.createElement("div");
  identity.className = "account-holding-identity";
  const name = document.createElement("strong");
  name.textContent = instrument.symbol || instrument.label || "Unresolved instrument";
  const detail = document.createElement("span");
  const identityDetail = instrument.label && instrument.label !== name.textContent
    ? instrument.label
    : instrument.mint ? shortWalletAddress(instrument.mint) : "Token holding";
  detail.textContent = [identityDetail, row.protocol, row.resolution_state ? readableState(row.resolution_state) : null].filter(Boolean).join(" · ");
  identity.append(name, detail);

  const formattedAmount = formatAmount(row.amount_base_units, row.decimals);
  const amountAvailable = formattedAmount !== "Amount unavailable";
  const supplyShareRaw = row.supply_share_bps;
  const supplyShare = supplyShareRaw !== null && supplyShareRaw !== undefined && supplyShareRaw !== "" && Number.isFinite(Number(supplyShareRaw))
    ? formatBps(supplyShareRaw)
    : "Unavailable";
  const markedPrice = formatUnitPriceFromMinor(row.marked_value_minor ?? row.liability_value_minor, row.amount_base_units, row.decimals);
  const executablePrice = formatUnitPriceFromMinor(row.executable_value_minor, row.amount_base_units, row.decimals);
  const hasMarkedPrice = markedPrice !== "Unavailable";
  const hasExecutablePrice = executablePrice !== "Unavailable";
  const currentPrice = hasMarkedPrice ? markedPrice : executablePrice;
  const currentState = hasMarkedPrice ? "marked" : hasExecutablePrice ? "executable" : "unavailable";
  const currentDetail = hasMarkedPrice
    ? hasExecutablePrice ? `Marked · executable ${executablePrice}` : "Marked"
    : hasExecutablePrice ? "Executable estimate" : "No current valuation";
  const averageEntry = integerString(row.average_entry_price_minor) === null ? "Unavailable" : formatUsdMinor(row.average_entry_price_minor);
  const pnlMinor = row.current_pnl_minor ?? row.unrealized_pnl_minor;
  const pnlAvailable = integerString(pnlMinor) !== null;
  const pnl = pnlAvailable ? formatUsdMinor(pnlMinor) : "Unavailable";

  holding.append(
    identity,
    holdingMetric("Amount", amountAvailable ? formattedAmount : "Unavailable", amountAvailable ? "Current balance" : "Balance unavailable", amountAvailable ? "available" : "unavailable"),
    holdingMetric("Supply", supplyShare, supplyShare === "Unavailable" ? "Supply denominator unavailable" : "Of circulating supply", supplyShare === "Unavailable" ? "unavailable" : "available"),
    holdingMetric("Current price", currentPrice, currentDetail, currentState),
    holdingMetric("Avg entry", averageEntry, averageEntry === "Unavailable" ? "Cost basis unavailable" : "Average bought", averageEntry === "Unavailable" ? "unavailable" : "available"),
    holdingMetric("Current P&L", pnl, pnlAvailable ? "Current position" : "Cost basis unavailable", pnlAvailable ? BigInt(String(pnlMinor)) >= 0n ? "positive" : "negative" : "unavailable"),
  );
  return holding;
}

function exposureTitle(identity) {
  return String(identity || "Unresolved exposure").replace(/^solana:/, "").replaceAll("_", " ");
}

function renderGovernorExposure(exposure = {}) {
  const container = document.getElementById("accountGovernorExposure");
  const rows = Array.isArray(exposure.assets) ? exposure.assets : [];
  if (!rows.length) return container.replaceChildren(governorEmpty("No asset exposure could be resolved."));
  container.replaceChildren(...rows.map((row) => governorRow({
    title: exposureTitle(row.identity),
    detail: `${row.contributing_instruments?.length || 0} contributing instrument${row.contributing_instruments?.length === 1 ? "" : "s"}`,
    values: [
      { label: "Exposure", value: formatUsdMinor(row.marked_value_minor) },
      { label: "Portfolio share", value: formatBps(row.allocation_bps) },
    ],
    states: row.resolution_states || [],
  })));
}

function renderGovernorDependencies(payload = {}) {
  const container = document.getElementById("accountGovernorDependencies");
  const rows = [
    ...(payload.protocol_exposure || []).map((row) => ({ ...row, dimension: "Protocol" })),
    ...(payload.stablecoin_exposure?.issuers || []).map((row) => ({ ...row, dimension: "Stablecoin issuer" })),
    ...(payload.stablecoin_exposure?.dependencies || []).map((row) => ({ ...row, dimension: "Stablecoin dependency" })),
  ];
  if (!rows.length) return container.replaceChildren(governorEmpty("No protocol or stablecoin dependency exposure was resolved."));
  container.replaceChildren(...rows.map((row) => governorRow({
    title: exposureTitle(row.identity),
    detail: `${row.dimension} · ${row.contributing_instruments?.length || 0} position${row.contributing_instruments?.length === 1 ? "" : "s"}`,
    values: [
      { label: "Exposure", value: formatUsdMinor(row.marked_value_minor) },
      { label: "Portfolio share", value: formatBps(row.allocation_bps) },
    ],
    states: row.resolution_states || [],
  })));
}

function renderGovernorUnresolved(section = {}) {
  const container = document.getElementById("accountGovernorUnresolved");
  const rows = Array.isArray(section.positions) ? section.positions : [];
  const unsupported = Array.isArray(section.unsupported_capabilities) ? section.unsupported_capabilities : [];
  setText("accountGovernorUnresolvedCount", `${rows.length} position${rows.length === 1 ? "" : "s"}`);
  const nodes = rows.map((row) => governorRow({
    title: row.instrument?.symbol || row.instrument?.label || "Unresolved instrument",
    detail: `${formatAmount(row.amount_base_units, row.decimals)} · evidence remains incomplete`,
    values: [
      { label: "Marked", value: formatUsdMinor(row.marked_value_minor ?? row.liability_value_minor) },
      { label: "Executable", value: formatUsdMinor(row.executable_value_minor) },
    ],
    states: [...new Set([row.resolution_state, ...(row.evidence_state || [])].filter(Boolean))],
  }));
  for (const capability of unsupported) nodes.push(governorEmpty(`Unsupported: ${readableState(capability)}`, "warning"));
  if (!nodes.length) nodes.push(governorEmpty("No material unresolved position was returned for this observation.", "positive"));
  container.replaceChildren(...nodes);
}

function renderGovernorPolicy(policy = {}) {
  const container = document.getElementById("accountGovernorPolicy");
  setText("accountGovernorPolicyState", policy.state === "not_configured" ? "No policy saved" : readableState(policy.state || "not ready"));
  if (policy.state === "not_configured") {
    return container.replaceChildren(governorEmpty("No portfolio policy is saved. Raven has not inferred targets or a compliance result."));
  }
  const findings = Array.isArray(policy.findings) ? policy.findings : [];
  if (!findings.length) return container.replaceChildren(governorEmpty("This saved policy contains no rules Raven can evaluate."));
  container.replaceChildren(...findings.map((finding) => {
    const range = [
      finding.configured_minimum_bps === null ? null : `minimum ${formatBps(finding.configured_minimum_bps)}`,
      finding.configured_maximum_bps === null ? null : `maximum ${formatBps(finding.configured_maximum_bps)}`,
    ].filter(Boolean).join(" · ");
    return governorRow({
      title: exposureTitle(finding.scope_id),
      detail: `${readableState(finding.rule_kind)}${range ? ` · Your configured ${range}` : ""}`,
      values: [
        { label: "Possible minimum", value: formatBps(finding.possible_minimum_bps) },
        { label: "Possible maximum", value: formatBps(finding.possible_maximum_bps) },
      ],
      states: [finding.state, ...(finding.reason_codes || [])],
    });
  }));
}

function renderGovernorEvidence(payload = {}) {
  const freshness = payload.freshness || {};
  const diagnostics = payload.diagnostics || {};
  const calls = diagnostics.provider_call_counts || {};
  const exposureRowsTruncated = Object.values(diagnostics.exposure_rows || {}).some((row) => row?.truncated === true);
  const evidence = document.getElementById("accountGovernorEvidence");
  const facts = [
    `Observed ${formatTimestamp(freshness.observed_at)}`,
    `Priced ${formatTimestamp(freshness.priced_at)}`,
    `Exit values ${formatTimestamp(freshness.quoted_at)}`,
    `${diagnostics.resolved_position_count || 0}/${diagnostics.observed_position_count || 0} positions resolved`,
    `${calls.total || 0}/${diagnostics.provider_call_cap || 0} provider calls`,
    `${diagnostics.latency_ms?.total || 0} ms`,
    diagnostics.conservation?.passed ? "Conservation passed" : "Conservation unavailable",
    ...(payload.holdings?.truncated === true || exposureRowsTruncated ? ["Display rows limited; totals preserved"] : []),
    "Not persisted",
  ];
  evidence.replaceChildren(...facts.map((fact) => governorChip(fact, fact === "Conservation passed" ? "positive" : "neutral")));
}

function renderGovernorPreview(payload) {
  const boundaries = payload?.boundaries || {};
  if (boundaries.read_only !== true || boundaries.customer_assets_can_move !== false || boundaries.transaction_material_created !== false || boundaries.signing_requested !== false) {
    throw new Error("portfolio_preview_boundary_invalid");
  }
  if (payload?.provenance?.raw_wallet_address_in_records !== false) throw new Error("portfolio_preview_privacy_boundary_invalid");
  renderGovernorSummary(payload.summary);
  renderGovernorHoldings(payload.holdings);
  renderGovernorExposure(payload.economic_exposure);
  renderGovernorDependencies(payload);
  renderGovernorUnresolved(payload.unresolved_and_unsupported);
  renderGovernorPolicy(payload.policy);
  renderGovernorEvidence(payload);
  governorPanel.dataset.previewState = payload.state || "partial";
  setText("accountGovernorState", readableState(payload.state || "partial"));
  setText("accountGovernorStatus", payload.state === "complete"
    ? "The current portfolio view is ready. Estimated or unavailable values are labeled below."
    : "Some portfolio details could not be resolved. Anything missing, old, or unavailable is labeled below.");
  governorResults.hidden = false;
}

function previewFailureMessage(response, payload) {
  if (response.status === 429) return "Portfolio checks are temporarily limited. Wait for the displayed retry time, then try again.";
  if (payload?.state === "invariant_failed") return "Raven could not verify the portfolio total, so it did not show the result.";
  if (payload?.error === "portfolio_preview_timeout") return "The portfolio check took too long. Try again; no incomplete result was shown.";
  return "The live portfolio view is unavailable. RavenOS did not fill in any missing values.";
}

async function analyzePortfolioPreview() {
  const walletReference = governorWallet.value;
  if (!state.csrf || !state.previewWallets.some((wallet) => wallet.wallet_reference === walletReference)) return;
  governorAnalyze.disabled = true;
  governorResults.hidden = true;
  governorPanel.dataset.previewState = "loading";
  setText("accountGovernorState", "Observing");
  setText("accountGovernorStatus", "Checking balances, underlying exposure, and the positions large enough to review…");
  try {
    const { response, payload } = await getJson("/api/v1/portfolio/preview", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: JSON.stringify({ wallet_reference: walletReference }),
    });
    if (!response.ok || !payload?.ok) {
      governorPanel.dataset.previewState = payload?.state || "unavailable";
      setText("accountGovernorState", readableState(payload?.state || "unavailable"));
      setText("accountGovernorStatus", previewFailureMessage(response, payload));
      return;
    }
    renderGovernorPreview(payload);
  } catch {
    governorPanel.dataset.previewState = "unavailable";
    setText("accountGovernorState", "Unavailable");
    setText("accountGovernorStatus", "We couldn’t load the portfolio view. No portfolio data was shown.");
  } finally {
    governorAnalyze.disabled = false;
  }
}

async function loadPortfolioPreviewCapability() {
  try {
    const { response, payload } = await getJson("/api/v1/portfolio/preview");
    if (!response.ok || !payload?.ok) {
      governorPanel.dataset.previewState = payload?.state || "not_configured";
      setText("accountGovernorState", "Not available");
      setText("accountPortfolioAnalysisState", "Not available");
      setText("accountGovernorStatus", "Portfolio Governor isn’t available for this account yet. RavenOS is not searching for wallets.");
      governorControls.hidden = true;
      return;
    }
    state.previewWallets = Array.isArray(payload.wallets) ? payload.wallets : [];
    if (!state.previewWallets.length) {
      governorPanel.dataset.previewState = "no_authorized_wallet";
      setText("accountGovernorState", "No wallet available");
      setText("accountPortfolioAnalysisState", "Not available");
      setText("accountGovernorStatus", "No Solana wallet is available for this account. RavenOS is not searching for wallets.");
      governorControls.hidden = true;
      return;
    }
    governorWallet.replaceChildren(...state.previewWallets.map((wallet) => {
      const option = document.createElement("option");
      option.value = wallet.wallet_reference;
      option.textContent = `${wallet.label} · Solana`;
      return option;
    }));
    governorControls.hidden = false;
    governorPanel.dataset.previewState = "available";
    setText("accountGovernorState", "Ready");
    setText("accountPortfolioAnalysisState", "Read only");
    if (!state.browserWallet.address) {
      setText("accountWalletConnectionTitle", `${state.previewWallets.length} saved wallet${state.previewWallets.length === 1 ? "" : "s"}`);
      setText("accountWalletConnectionDetail", "Public portfolio view available.");
      setText("accountWalletConnectionState", "View only");
      setText("accountWalletOwnershipState", "Not proven");
    }
    setText("accountGovernorStatus", "Select a wallet to inspect current public account data. RavenOS does not save portfolio history.");
  } catch {
    governorPanel.dataset.previewState = "unavailable";
    setText("accountGovernorState", "Unavailable");
    setText("accountPortfolioAnalysisState", "Unavailable");
    setText("accountGovernorStatus", "Portfolio Governor access could not be checked. Please try again.");
    governorControls.hidden = true;
  }
}

function setIntent(intent) {
  state.intent = intent === "sign_in" ? "sign_in" : "sign_up";
  document.querySelectorAll("[data-account-intent]").forEach((button) => {
    const active = button.dataset.accountIntent === state.intent;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll('.account-auth-actions input[name="intent"]').forEach((input) => { input.value = state.intent; });
  const action = state.intent === "sign_up" ? "Create your account" : "Sign in to your desk";
  serviceState.textContent = state.config?.available ? action : serviceState.textContent;
}

function renderActivationPending() {
  page.dataset.accountState = "pending";
  serviceState.textContent = "Sign-in temporarily unavailable";
  actions.hidden = true;
  activation.hidden = false;
  authWorkspace.hidden = false;
  dashboard.hidden = true;
}

function sessionRowNode(session) {
  const row = document.createElement("article");
  row.className = "account-session-row";
  const mark = document.createElement("span");
  mark.className = "account-provider-mark";
  mark.textContent = session.current ? "●" : "S";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${session.device_label}${session.current ? " · This session" : ""}`;
  const detail = document.createElement("span");
  detail.textContent = `${formatSeen(session.last_seen_at)} · ${String(session.authentication_strength || "managed").replaceAll("_", " ")}`;
  copy.append(title, detail);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = session.current ? "Sign out" : "Revoke";
  button.addEventListener("click", () => revokeSession(session.session_public_id));
  row.append(mark, copy, button);
  return row;
}

async function loadSessions() {
  const { response, payload } = await getJson("/api/v1/sessions");
  if (!response.ok || !Array.isArray(payload?.sessions)) return;
  if (payload.csrf_token) state.csrf = payload.csrf_token;
  document.getElementById("accountSessionCount").textContent = `${payload.sessions.length} ${payload.sessions.length === 1 ? "session" : "sessions"}`;
  const list = document.getElementById("accountSessionList");
  list.replaceChildren(...payload.sessions.map(sessionRowNode));
}

function renderAuthenticated(payload) {
  state.session = payload;
  state.csrf = payload.csrf_token || "";
  page.dataset.accountState = "authenticated";
  serviceState.textContent = "Signed in securely";
  authWorkspace.hidden = true;
  dashboard.hidden = false;
  renderAccountIdentity(payload.account || {});
  renderBrowserWallet();
  loadSessions();
  loadProIntelligenceCapabilities();
  loadPortfolioPreviewCapability();
  loadReferralProgram();
  loadPrivyWallets();
}

async function saveUsername(event) {
  event.preventDefault();
  const input = document.getElementById("accountUsername");
  const button = document.getElementById("accountUsernameSave");
  const status = document.getElementById("accountUsernameStatus");
  const username = String(input.value || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
    status.dataset.tone = "error";
    status.textContent = "Use 3–24 characters, starting with a letter.";
    input.focus();
    return;
  }
  if (!state.csrf) {
    status.dataset.tone = "error";
    status.textContent = "Refresh and sign in again.";
    return;
  }
  button.disabled = true;
  status.dataset.tone = "";
  status.textContent = "Saving…";
  const { response, payload } = await getJson("/api/v1/account/username", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    body: JSON.stringify({ username }),
  });
  button.disabled = false;
  if (!response.ok || !payload?.account) {
    status.dataset.tone = "error";
    status.textContent = payload?.error === "username_reserved"
      ? "That username is reserved."
      : payload?.error === "username_unavailable"
        ? "That username is already taken."
        : payload?.error === "username_update_rate_limited"
          ? "Too many changes today. Try again later."
          : "Username could not be saved.";
    return;
  }
  state.session = { ...(state.session || {}), account: payload.account };
  renderAccountIdentity(payload.account);
  status.textContent = "Username saved.";
}

async function revokeSession(sessionPublicId) {
  if (!state.csrf) return;
  const { response, payload } = await getJson(`/api/v1/sessions/${encodeURIComponent(sessionPublicId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    body: "{}",
  });
  if (!response.ok || !payload?.revoked) {
    authStatus.dataset.tone = "error";
    authStatus.textContent = payload?.error === "recent_authentication_required" ? "Sign in again before revoking another session." : "That session could not be revoked.";
    return;
  }
  if (payload.current) location.assign("/account/");
  else loadSessions();
}

async function logout() {
  if (!state.csrf) return;
  const button = document.getElementById("accountLogout");
  button.disabled = true;
  try {
    let client = state.privy.client;
    if (!client && state.privy.config?.available) {
      const factory = await loadPrivyFactory();
      client = factory.create({ appId: state.privy.config.app_id, clientId: state.privy.config.client_id });
    }
    await Promise.race([
      client?.logout(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch { /* Raven logout must still complete if Privy is unavailable. */ }
  const { response } = await getJson("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    body: "{}",
  });
  if (response.ok) location.assign("/account/");
  else button.disabled = false;
}

async function submitAuth(form) {
  if (!state.config?.available) return renderActivationPending();
  if (!state.config.on_authenticated_origin) {
    const canonical = new URL("/account/", state.config.canonical_origin);
    canonical.searchParams.set("intent", state.intent === "sign_in" ? "sign_in" : "sign_up");
    location.assign(canonical.toString());
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  authStatus.dataset.tone = "";
  authStatus.textContent = "Opening secure sign-in…";
  try {
    const values = Object.fromEntries(new FormData(form));
    const { response, payload } = await getJson("/api/v1/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const target = new URL(payload?.authorization_url || "");
    if (!response.ok || target.protocol !== "https:" || target.hostname !== "api.workos.com") throw new Error("authorization_unavailable");
    location.assign(target.toString());
  } catch {
    button.disabled = false;
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Secure sign-in could not be opened. Please try again.";
  }
}

function bindAuthForms() {
  for (const form of [document.getElementById("accountGoogleForm"), document.getElementById("accountManagedForm")]) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuth(form);
    });
  }
}

async function initialize() {
  const query = new URLSearchParams(location.search);
  const suppliedReferral = referralCode(query.get("ref"));
  state.pendingReferral = suppliedReferral;
  const requestedIntent = query.get("intent");
  if (requestedIntent === "sign_in") state.intent = "sign_in";
  const requestedReturnTo = String(query.get("return_to") || "");
  const safeReturnTo = suppliedReferral
    ? `/account/?ref=${encodeURIComponent(suppliedReferral)}`
    : /^(?:\/terminal\/|\/account\/copy\/|\/account\/intelligence\/)(?:\?[^#]*)?$/.test(requestedReturnTo)
      ? requestedReturnTo
      : "/account/";
  document.querySelectorAll('.account-auth-actions input[name="return_to"]').forEach((input) => { input.value = safeReturnTo; });
  document.querySelectorAll("[data-account-intent]").forEach((button) => button.addEventListener("click", () => setIntent(button.dataset.accountIntent)));
  document.getElementById("accountLogout").addEventListener("click", logout);
  document.getElementById("accountUsernameForm").addEventListener("submit", saveUsername);
  document.getElementById("accountConnectSolana").addEventListener("click", () => connectBrowserWallet("Solana"));
  document.getElementById("accountConnectEvm").addEventListener("click", () => connectBrowserWallet("EVM"));
  document.getElementById("accountDisconnectWallet").addEventListener("click", () => clearBrowserWallet());
  document.getElementById("accountPrivyCreate").addEventListener("click", createPrivyWallets);
  document.getElementById("accountReferralCreate").addEventListener("click", createReferralLink);
  document.getElementById("accountReferralCopy").addEventListener("click", copyReferralLink);
  document.getElementById("accountReferralClaimForm").addEventListener("submit", claimReferral);
  governorAnalyze.addEventListener("click", analyzePortfolioPreview);
  bindAuthForms();
  setIntent(state.intent);

  const authResult = new URLSearchParams(location.search).get("auth");
  if (authResult === "failed") {
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Sign-in could not be completed. Nothing was connected or authorized; please try again.";
  }
  if (authResult) history.replaceState({}, "", "/account/");

  const { response, payload } = await getJson("/api/v1/auth/config");
  if (!response.ok || !payload) return renderActivationPending();
  state.config = payload;
  if (!payload.available) return renderActivationPending();
  page.dataset.accountState = "available";
  serviceState.textContent = state.intent === "sign_up" ? "Ready to create your account" : "Ready to sign in";
  actions.hidden = false;
  activation.hidden = true;
  if (!payload.on_authenticated_origin) return;

  const session = await getJson("/api/v1/auth/session");
  if (session.response.ok && session.payload?.authenticated) {
    renderAuthenticated(session.payload);
    if (query.has("ref")) {
      query.delete("ref");
      history.replaceState({}, "", `${location.pathname}${query.toString() ? `?${query}` : ""}`);
    }
  }
}

window.__RAVENOS_ACCOUNT__ = Object.freeze({
  schemaVersion: "ravenos.account_surface.v1",
  walletConnectionIsAuthentication: false,
  walletLinkingAvailable: false,
  browserWalletConnectionAvailable: true,
  privyEmbeddedWalletsOptional: true,
  walletConnectionScope: "public_address_observation_only",
  walletConnectionPersisted: false,
  portfolioPreviewReadOnly: true,
  arbitraryPortfolioAddressInput: false,
  portfolioHistoryPersisted: false,
  proEntitlementsDormantByDefault: true,
  proCheckoutAvailable: false,
  referralAttributionRequiresUserAction: true,
  referralClaimCreatesEntitlement: false,
  referralRewardsAvailable: false,
  atlasDisplayRightsOverrideAvailable: false,
  signingAvailable: false,
  submissionAvailable: false,
});

initialize().catch(renderActivationPending);
