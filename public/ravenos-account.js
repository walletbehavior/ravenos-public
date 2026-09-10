import { mountWalletBalances } from "./ravenos-wallet-balances.js";
import { readAccountSession, invalidateAccountSession } from './ravenos-account-session.js';
import { walletLaunchHref } from "./ravenos-wallet-connect.js";
import { requestLegalAcceptance } from "./ravenos-legal-client.js";
import { getPreference, setPreference, resetPreferences, accountReturnPath } from "./ravenos-preferences.js";

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
const legalAssent = document.getElementById("accountLegalAssent");
const legalAssentCheckbox = document.getElementById("accountLegalAssentCheckbox");
const walletFunds = mountWalletBalances(document.getElementById("accountWalletFunds"));

const state = {
  config: null,
  session: null,
  csrf: "",
  intent: getPreference("returning", false) ? "sign_in" : "sign_up",
  previewWallets: [],
  entitlements: null,
  referral: null,
  privy: { config: null, client: null, wallets: [] },
  pendingReferral: "",
  legal: { manifest: null, receiptsLoaded: false },
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
    const controls = document.createElement("div");
    controls.className = "account-wallet-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy address";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(wallet.address); copy.textContent = "Address copied"; }
      catch { copy.textContent = "Select the address to copy"; }
    });
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Secure export";
    exportButton.addEventListener("click", () => exportPrivyWallet(wallet, exportButton));
    const guide = document.createElement("details");
    guide.className = "account-wallet-funding";
    const summary = document.createElement("summary");
    summary.textContent = "Funding this wallet";
    const instructions = document.createElement("p");
    instructions.textContent = wallet.ecosystem === "solana"
      ? "Send SOL or canonical USDC on Solana to this address. Keep a little SOL for network fees. Choose Solana on the sending service and start with a small test transfer."
      : "Use this address on the supported EVM network you choose. Balances stay on that network. Match the network and token on the sending service, keep its native token for gas, and start with a small test transfer.";
    const bridging = document.createElement("p");
    bridging.textContent = "The same address does not move funds between networks. Cross-chain funding needs a separate route. Check the asset and network in Terminal before funding.";
    controls.append(copy, exportButton);
    guide.append(summary, instructions, bridging);
    row.append(label, address, detail, controls, guide);
    return row;
  }));
}

async function exportPrivyWallet(wallet, button) {
  if (!state.csrf || !state.privy.wallets.some(row => row.ecosystem === wallet.ecosystem && row.address === wallet.address)) return;
  button.disabled = true;
  button.textContent = "Opening secure export…";
  try {
    const { openSecureWalletExport } = await import("./ravenos-privy-export.js");
    const getExternalJwt = async () => {
      try {
        // Recovery/export for an already-linked identity is exempt from new
        // trading assent. No subscription or signing entitlement is required.
        const { response, payload } = await getJson("/api/v1/wallets/privy/session", {
          method: "POST", headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf }, body: "{}",
        });
        return response.ok && typeof payload?.token === "string" ? payload.token : undefined;
      } catch { return undefined; }
    };
    openSecureWalletExport({ appId: state.privy.config.app_id, clientId: state.privy.config.client_id, wallet, getExternalJwt });
    button.textContent = "Secure export";
  } catch { button.textContent = "Export unavailable · retry"; }
  finally { button.disabled = false; }
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
  const missing = ["solana", "evm"].filter((ecosystem) => capabilities[ecosystem] === true
    && !wallets.some((wallet) => wallet.ecosystem === ecosystem));
  const select = document.getElementById("accountPrivyEcosystem");
  const previous = select.value;
  const choices = missing.length === 2 ? ["both", ...missing] : missing;
  select.replaceChildren(...choices.map((value) => new Option(
    value === "both" ? "Solana + EVM" : value === "solana" ? "Solana" : "EVM", value,
  )));
  if (choices.includes(previous)) select.value = previous;
  document.getElementById("accountPrivyChoice").hidden = missing.length === 0;
  button.hidden = missing.length === 0;
  updatePrivyCreateLabel();
  renderPrivyWallets(wallets);
  walletFunds?.refresh();
}

function updatePrivyCreateLabel() {
  const selected = document.getElementById("accountPrivyEcosystem").value;
  const label = selected === "both" ? "Solana + EVM wallets" : selected === "solana" ? "Solana wallet" : "EVM wallet";
  document.getElementById("accountPrivyCreate").textContent = `${state.privy.wallets.length ? "Add" : "Create"} ${label}`;
}

async function loadPrivyFactory() {
  if (globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__?.create) return globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__;
  // Release packaging rewrites this dependency to its immutable asset URL.
  // The authenticated origin intentionally does not serve the build manifest.
  await import("./ravenos-privy-wallet.js");
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
  const select = document.getElementById("accountPrivyEcosystem");
  const selected = select.value;
  if (!["both", "solana", "evm"].includes(selected)) return;
  const requested = { evm: selected === "both" || selected === "evm", solana: selected === "both" || selected === "solana" };
  if (Object.keys(requested).some((key) => requested[key] && state.privy.config.capabilities?.[key] !== true)) return;
  button.disabled = true;
  select.disabled = true;
  let phase = "start";
  status.dataset.tone = "";
  status.textContent = "Preparing your wallet…";
  try {
    const factory = await loadPrivyFactory();
    const session = await getJsonWithLegalAcceptance("/api/v1/wallets/privy/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: "{}",
    }, "embedded_wallet_activation");
    if (!session.response.ok || !session.payload?.token) throw new Error(session.payload?.error || "privy_session_unavailable");
    const client = state.privy.client || factory.create({
      appId: state.privy.config.app_id,
      clientId: state.privy.config.client_id,
    });
    state.privy.client = client;
    if (Object.keys(requested).some((key) => requested[key] && session.payload.wallets?.[key] !== true)) {
      throw new Error("privy_wallet_capability_changed");
    }
    phase = "authenticate";
    await client.sync(session.payload.token);
    phase = "create";
    status.textContent = "Creating your selected wallet…";
    await client.provision(requested);
    phase = "link";
    const identityToken = await client.identityToken();
    const linked = await getJsonWithLegalAcceptance("/api/v1/wallets/privy/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ravenos-csrf": state.csrf,
        "privy-id-token": identityToken,
      },
      body: "{}",
    }, "embedded_wallet_activation");
    if (!linked.response.ok || !linked.payload?.linked) throw new Error(linked.payload?.error || "privy_link_failed");
    renderPrivyState({ ...state.privy.config, ...linked.payload, available: true });
  } catch (error) {
    status.dataset.tone = "error";
    status.textContent = error?.message === "privy_identity_conflict"
      ? "This wallet identity is already linked to another Raven account."
      : error?.message === "privy_wallet_capability_changed"
        ? "This wallet type is no longer available. Refresh to see current options."
        : phase === "authenticate" ? "The wallet service could not verify your session. Please try again."
          : phase === "link" ? "We could not finish linking your wallet. Retry to recover it without creating a duplicate."
            : phase === "create" ? "Wallet creation could not finish. Please retry; any wallet already created will be recovered."
              : "Wallet setup could not start. Your Raven login is unchanged.";
  } finally {
    button.disabled = false;
    select.disabled = false;
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

async function getJsonWithLegalAcceptance(url, init, capability) {
  const first = await getJson(url, init);
  if (first.response.status !== 428 || first.payload?.error !== "legal_acceptance_required") return first;
  const accepted = await requestLegalAcceptance(first.payload, { capability, csrfToken: state.csrf });
  return accepted ? getJson(url, init) : first;
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
  return address;
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
  const candidates = [
    ["EVM", globalThis.ethereum],
    ["Phantom", globalThis.phantom?.ethereum],
    ["Backpack", globalThis.backpack?.ethereum],
  ];
  const [name, provider] = candidates.find(([, candidate]) => typeof candidate?.request === "function") || [];
  return provider ? { name, provider } : null;
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

function openWalletAppChooser(chain, detected = null) {
  document.getElementById("accountWalletAppChooser")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "accountWalletAppChooser";
  dialog.className = "account-wallet-chooser";
  dialog.setAttribute("aria-labelledby", "accountWalletAppTitle");
  dialog.setAttribute("aria-describedby", "accountWalletAppDescription");
  const title = document.createElement("h3");
  title.id = "accountWalletAppTitle";
  title.textContent = `Connect a ${chain} wallet`;
  const description = document.createElement("p");
  description.id = "accountWalletAppDescription";
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  description.textContent = mobile
    ? "Choose your Raven Wallet here, or open Raven inside an external wallet app. An app handoff does not connect the wallet to your Chrome or Safari tab."
    : "Choose your Raven Wallet or an external wallet. Connecting reads your public address; it does not sign a transaction.";
  const choices = document.createElement("div");
  choices.className = "account-wallet-apps";
  const embedded = state.privy.wallets.find(wallet => wallet.ecosystem === chain.toLowerCase());
  if (embedded) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Raven Wallet · ${shortWalletAddress(embedded.address)}`;
    button.addEventListener("click", () => {
      state.browserWallet = { chain, address: embedded.address, provider: null, listenersBound: false };
      renderBrowserWallet("Raven Wallet connected · address only. Trading is reviewed in Terminal.");
      dialog.close();
    });
    choices.append(button);
  }
  if (detected) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Connect ${detected.name}`;
    button.addEventListener("click", async () => {
      dialog.close();
      await connectBrowserWallet(chain, { external: true });
    });
    choices.append(button);
  }
  for (const name of chain === "Solana" ? ["Phantom", "Solflare"] : ["MetaMask", "Phantom"]) {
    const link = document.createElement("a");
    link.href = walletLaunchHref(name, chain.toLowerCase(), "https://app.ravenos.xyz/account/");
    link.rel = "noopener noreferrer";
    link.textContent = `Open ${name}`;
    choices.append(link);
  }
  const help = document.createElement("p");
  help.textContent = embedded ? "Your existing wallet is preserved. No new wallet is created." : "You can create a Raven Wallet below. External wallet apps may ask you to sign in to Raven again.";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Back to account";
  close.addEventListener("click", () => dialog.close());
  dialog.append(title, description, choices, help, close);
  dialog.addEventListener("close", () => {
    dialog.remove();
    document.getElementById(chain === "Solana" ? "accountConnectSolana" : "accountConnectEvm")?.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function connectBrowserWallet(chain, { external = false } = {}) {
  const status = document.getElementById("accountWalletConnectStatus");
  if (status) status.dataset.tone = "";
  const selected = chain === "Solana" ? solanaWalletProvider() : evmWalletProvider();
  if (!external && state.privy.wallets.some(wallet => wallet.ecosystem === chain.toLowerCase())) {
    return openWalletAppChooser(chain, selected);
  }
  if (!selected) {
    renderBrowserWallet("Open Raven in your wallet app to connect.");
    return openWalletAppChooser(chain);
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
          : capability.state === "not_granted"
            ? "Included with an active Raven Pro membership."
            : capability.state === "server_disabled"
              ? "This workspace is temporarily unavailable."
              : "We couldn’t load this workspace. Refresh to retry.";
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

function unavailableProCapabilities(stateLabel = "unavailable") {
  return Object.keys(PRO_CAPABILITY_DISPLAY).map((capability) => ({ capability, available: false, state: stateLabel }));
}

async function loadProIntelligenceCapabilities() {
  if (!proPanel || !proCapabilities) return;
  try {
    const { response, payload } = await getJson("/api/v1/entitlements");
    if (!response.ok || !Array.isArray(payload?.capabilities)) {
      proPanel.dataset.proState = "unavailable";
      setText("accountProState", "Unavailable");
      setText("accountProStatus", "We couldn’t check your Pro features. Refresh to retry; your membership is shown below.");
      proCapabilities.replaceChildren(...unavailableProCapabilities(payload?.state || "unavailable").map((capability) => proCapabilityNode(capability)));
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
      : capabilities.some((capability) => capability.available)
        ? "Your Pro access is active, but the workspaces couldn’t load. Refresh to retry."
        : "No Pro workspaces are available right now. Check your membership below.");
  } catch {
    proPanel.dataset.proState = "unavailable";
    setText("accountProState", "Unavailable");
    setText("accountProStatus", "We couldn’t verify Pro access. Public Intelligence remains available.");
    proCapabilities.replaceChildren(...unavailableProCapabilities("unavailable").map((capability) => proCapabilityNode(capability)));
  }
}

function affiliateUsd(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return "—";
  const cents = BigInt(value);
  return `$${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, "0")}`;
}
function renderAffiliateProgram(referral) {
  const active = referral.state === "active";
  const policy = referral.policy;
  referralPanel.dataset.referralState = active ? "active" : "not_created";
  setText("accountReferralState", active ? "Active" : "Join when ready");
  setText("accountReferralStatus", active ? "Your link is ready. Commissions begin only after a qualifying paid Pro conversion." : "Joining is optional. Review the program and accept its terms to activate your link.");
  setText("accountAffiliateOffer", `Earn ${policy.commission_percent}% of qualifying Pro subscription revenue for up to ${policy.commission_months} months from the first qualifying paid conversion. Conversion must occur within ${policy.attribution_days} days of the first qualifying referral visit. Rewards, credits, discounts, refunds, and chargebacks reduce the commission basis.`);
  document.getElementById("accountAffiliateTerms").hidden = active;
  document.getElementById("accountReferralCreate").hidden = active;
  document.getElementById("accountReferralCreate").disabled = !policy.flags.enrollment;
  document.getElementById("accountReferralCopy").hidden = !active;
  document.getElementById("accountReferralLink").value = active ? referral.referral_url : "Join to activate your link";
  document.getElementById("accountReferralClaimForm").hidden = true;
  document.getElementById("accountAffiliateDisclosure").hidden = !active;
  document.getElementById("accountAffiliateProfilePreference").hidden = !active || !policy.flags.public_profile_cta;
  document.getElementById("accountAffiliateProfileCta").checked = referral.enrollment?.public_profile_cta === 1;
  const shareText = active ? `${referral.disclosure}\n${referral.referral_url}` : "";
  setText("accountAffiliateDisclosureText", referral.disclosure);
  document.getElementById("accountAffiliateShareText").value = shareText;
  document.getElementById("accountAffiliateShareX").href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  for (const [id,key] of [["accountReferralAccounts","accounts_created"],["accountReferralQualified","paid_conversions"],["accountAffiliateClicks","clicks"],["accountAffiliateTrials","active_trials"],["accountAffiliateActivePro","active_referred_pro"]]) {
    setText(id, Number.isSafeInteger(referral.metrics?.[key]) ? referral.metrics[key].toLocaleString() : "—");
  }
  for (const [id,key] of [["accountAffiliatePending","pending_cents"],["accountAffiliateAvailable","available_cents"],["accountAffiliateEarned","earned_cents"]]) setText(id, affiliateUsd(referral.balance?.[key]));
  setText("accountReferralRewards", referral.payout_state === "manual_review" ? "Manual review" : "Not enabled");
  document.querySelectorAll("[data-affiliate-metric]").forEach(node => { node.hidden = !active; });
  const events = document.getElementById("accountAffiliateEvents");
  events.replaceChildren(); events.hidden = !active;
  const heading = document.createElement("h4"); heading.textContent = "Commission activity"; events.append(heading);
  if (!referral.events?.length) { const empty=document.createElement("p"); empty.textContent="No commission events yet."; events.append(empty); }
  for (const event of referral.events || []) {
    const row = document.createElement("p");
    row.textContent = `${readableState(event.status)} · ${affiliateUsd(event.amount_cents)} commission · ${affiliateUsd(event.qualifying_revenue_cents)} qualifying revenue · ${new Date(event.created_at * 1000).toLocaleDateString()}`;
    events.append(row);
  }
  const recoverable=BigInt(referral.balance?.recoverable_cents || "0");
  if (recoverable > 0n) { const adjustment=document.createElement("p"); adjustment.textContent=`${affiliateUsd(recoverable.toString())} outstanding adjustment from reversed subscription payments. Future commission offsets this amount.`; events.append(adjustment); }
  referralControls.hidden = false;
}
function recordAffiliateUiEvent(eventType) {
  if (!state.referral?.policy || !state.csrf) return;
  getJson("/api/v1/referrals/events", { method: "POST", headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf }, body: JSON.stringify({ event: eventType, request_id: crypto.randomUUID() }) }).catch(() => {});
}
async function copyAffiliateDisclosure() {
  const text = document.getElementById("accountAffiliateShareText");
  try { await navigator.clipboard.writeText(text.value); setText("accountReferralStatus", "Disclosure and link copied."); recordAffiliateUiEvent("referral_link_copied"); }
  catch { text.focus(); text.select(); setText("accountReferralStatus", "Disclosure and link selected. Copy them from the field."); }
}

function renderReferralProgram(referral = {}) {
  state.referral = referral;
  if (referral.policy) return renderAffiliateProgram(referral);
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
  const affiliate = Boolean(state.referral?.policy);
  if (affiliate && !document.getElementById("accountAffiliateAccept").checked) {
    button.disabled = false;
    document.getElementById("accountAffiliateAccept").focus();
    return setText("accountReferralStatus", "Review and accept the Affiliate Terms to join.");
  }
  setText("accountReferralStatus", affiliate ? "Checking your Affiliate Terms acceptance…" : "Creating your referral link…");
  try {
    const { response, payload } = await getJsonWithLegalAcceptance(affiliate ? "/api/v1/referrals/join" : "/api/v1/referrals/code", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: affiliate ? JSON.stringify({ accept: true }) : "{}",
    }, "affiliate_enrollment");
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
    setText("accountReferralStatus", "Referral link copied. Include the required disclosure when sharing.");
    recordAffiliateUiEvent("referral_link_copied");
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
      setText("accountWalletOwnershipState", payload.authorization_boundary === 'account_bound_privy_wallet' ? 'Linked to your account' : 'Not proven');
    }
    setText("accountGovernorStatus", payload.authorization_boundary === 'account_bound_privy_wallet' ? 'Your Raven wallet is ready to inspect. Analyze its current balances and exposure.' : 'Select a wallet to inspect current public account data. RavenOS does not save portfolio history.');
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
  renderLegalAssent();
}

function accountCreationAcceptances() {
  const documents = Array.isArray(state.legal.manifest?.documents) ? state.legal.manifest.documents : [];
  const byType = new Map(documents.map((document) => [document.document_type, document]));
  return [
    { ...byType.get("terms"), acknowledgement: "agreed" },
    { ...byType.get("privacy"), acknowledgement: "acknowledged" },
  ].map((document) => ({
    document_type: document.document_type,
    version: document.version,
    content_hash: document.content_hash,
    acknowledgement: document.acknowledgement,
  }));
}

function renderLegalAssent() {
  if (!legalAssent || !state.config) return;
  const signup = state.intent === "sign_up";
  const required = Boolean(state.config.legal?.account_creation_acceptance_required);
  const blocked = Boolean(state.config.legal?.account_creation_blocked);
  const documents = Array.isArray(state.legal.manifest?.documents) ? state.legal.manifest.documents : [];
  for (const legalDocument of documents) {
    if (!["terms", "privacy"].includes(legalDocument.document_type)) continue;
    document.querySelectorAll(`[data-legal-document="${legalDocument.document_type}"]`).forEach((anchor) => {
      anchor.href = new URL(legalDocument.canonical_path, "https://ravenos.xyz").toString();
    });
  }
  legalAssent.hidden = !signup || !required;
  document.querySelectorAll(".account-auth-actions form button").forEach((button) => {
    button.disabled = signup && blocked;
  });
  if (signup && blocked) {
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Account creation is paused while the legal documents are finalized. Existing users can still sign in.";
  } else if (state.intent === "sign_in" && authStatus.textContent.includes("legal documents")) {
    authStatus.dataset.tone = "";
    authStatus.textContent = "Ready for secure sign-in.";
  }
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
  if (session.remember_device && session.absolute_expires_at) {
    detail.textContent += ` · Remembered until ${new Date(session.absolute_expires_at).toLocaleDateString()}`;
  }
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
  setPreference("returning", true);
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
  loadProductRewards();
  loadPortfolioPreviewCapability();
  loadReferralProgram();
  loadPrivyWallets();
}

async function loadLegalReceipts() {
  if (state.legal.receiptsLoaded) return;
  state.legal.receiptsLoaded = true;
  const status = document.getElementById("accountLegalReceiptStatus");
  const list = document.getElementById("accountLegalReceiptList");
  try {
    const { response, payload } = await getJson("/api/v1/legal/status?capability=account_creation");
    if (!response.ok || !payload?.ok) throw new Error("unavailable");
    const capability = payload.capabilities?.find(row => row.capability === "account_creation");
    const documents = capability?.required_documents;
    if (!Array.isArray(documents) || !documents.length) throw new Error("unavailable");
    status.textContent = capability.satisfied
      ? "Your current account terms are accepted. You do not need to accept them again when signing in."
      : "You can still sign in. Any required updated terms will appear before the action they apply to.";
    list.replaceChildren(...documents.map(({ document: doc, accepted }) => {
      const item = document.createElement("li"), link = document.createElement("a"), detail = document.createElement("span");
      // Only display document routes returned by the authenticated legal service.
      if (["/terms/", "/privacy/"].includes(doc.canonical_path)) link.href = doc.canonical_path;
      link.textContent = doc.title;
      const receipt = payload.acceptances?.find(row => row.document_type === doc.document_type && row.document_version === doc.version && row.content_hash === doc.content_hash);
      detail.textContent = ` · ${accepted ? "Accepted" : "Not accepted"} · ${doc.version}${receipt?.accepted_at ? ` · ${new Date(receipt.accepted_at).toLocaleDateString()}` : ""}`;
      item.append(link, detail); return item;
    }));
  } catch {
    state.legal.receiptsLoaded = false;
    status.textContent = "Acceptance history is temporarily unavailable. Your sign-in is unaffected.";
  }
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
  if (response.ok) { invalidateAccountSession(); location.assign("/account/"); }
  else button.disabled = false;
}

async function submitAuth(form) {
  if (!state.config?.available) return renderActivationPending();
  if (!state.config.on_authenticated_origin) {
    const canonical = new URL("/account/", state.config.canonical_origin);
    canonical.searchParams.set("intent", state.intent === "sign_in" ? "sign_in" : "sign_up");
    canonical.searchParams.set("return_to", accountReturnPath(form.elements.return_to?.value));
    location.assign(canonical.toString());
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  if (state.intent === "sign_up" && state.config.legal?.account_creation_blocked) {
    renderLegalAssent();
    return;
  }
  if (state.intent === "sign_up" && state.config.legal?.account_creation_acceptance_required) {
    if (!state.legal.manifest || !legalAssentCheckbox.checked) {
      legalAssent.hidden = false;
      legalAssentCheckbox.focus();
      authStatus.dataset.tone = "error";
      authStatus.textContent = "Agree to the Terms and acknowledge the Privacy Policy to create an account.";
      return;
    }
  }
  button.disabled = true;
  authStatus.dataset.tone = "";
  authStatus.textContent = "Opening secure sign-in…";
  try {
    const values = Object.fromEntries(new FormData(form));
    values.remember_device = state.config.session_policy?.remember_device_available === true
      && document.getElementById("accountRememberDevice").checked;
    if (state.intent === "sign_up" && state.config.legal?.account_creation_acceptance_required) {
      values.acceptances = accountCreationAcceptances();
    }
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
  if (["sign_in", "sign_up"].includes(requestedIntent)) state.intent = requestedIntent;
  const requestedReturnTo = String(query.get("return_to") || "");
  const safeReturnTo = suppliedReferral
    ? `/account/?ref=${encodeURIComponent(suppliedReferral)}`
    : accountReturnPath(requestedReturnTo);
  document.querySelectorAll('.account-auth-actions input[name="return_to"]').forEach((input) => { input.value = safeReturnTo; });
  document.querySelectorAll("[data-account-intent]").forEach((button) => button.addEventListener("click", () => setIntent(button.dataset.accountIntent)));
  document.getElementById("accountLogout").addEventListener("click", logout);
  document.getElementById("accountContinuity").addEventListener("toggle", event => {
    if (event.currentTarget.open && state.session?.authenticated) loadLegalReceipts();
  });
  document.getElementById("accountResetPreferences").addEventListener("click", () => {
    const cleared = resetPreferences();
    document.getElementById("accountPreferenceStatus").textContent = cleared
      ? "Display preferences cleared. Defaults return when you reload a workspace. Your session and accepted terms are unchanged."
      : "This browser did not allow preference storage. Your session and accepted terms are unchanged.";
  });
  document.getElementById("accountUsernameForm").addEventListener("submit", saveUsername);
  document.getElementById("accountConnectSolana").addEventListener("click", () => connectBrowserWallet("Solana"));
  document.getElementById("accountConnectEvm").addEventListener("click", () => connectBrowserWallet("EVM"));
  document.getElementById("accountDisconnectWallet").addEventListener("click", () => clearBrowserWallet());
  document.getElementById("accountPrivyCreate").addEventListener("click", createPrivyWallets);
  document.getElementById("accountReferralCreate").addEventListener("click", createReferralLink);
  document.getElementById("accountReferralCopy").addEventListener("click", copyReferralLink);
  document.getElementById("accountAffiliateProfileCta")?.addEventListener("change", async event => {
    const input=event.target;input.disabled=true;
    try {const result=await getJson("/api/v1/referrals/preference",{method:"PUT",headers:{"content-type":"application/json","x-ravenos-csrf":state.csrf},body:JSON.stringify({public_profile_cta:input.checked})});if(!result.response.ok)throw new Error();}
    catch {input.checked=!input.checked;setText("accountReferralStatus","The profile preference could not be saved.");} finally {input.disabled=false;}
  });
  document.getElementById("accountAffiliateCopyDisclosure")?.addEventListener("click", copyAffiliateDisclosure);
  document.getElementById("accountAffiliateShareX")?.addEventListener("click", () => recordAffiliateUiEvent("affiliate_share_x"));
  document.getElementById("accountReferralClaimForm").addEventListener("submit", claimReferral);
  governorAnalyze.addEventListener("click", analyzePortfolioPreview);
  bindAuthForms();
  setIntent(state.intent);

  const authResult = new URLSearchParams(location.search).get("auth");
  if (authResult === "failed") {
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Sign-in could not be completed. Nothing was connected or authorized; please try again.";
  }
  if (authResult) {
    const cleaned = new URL(location.href); cleaned.searchParams.delete("auth");
    history.replaceState({}, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  }

  const { response, payload } = await getJson("/api/v1/auth/config");
  if (!response.ok || !payload) return renderActivationPending();
  state.config = payload;
  document.getElementById("accountRememberDeviceChoice").hidden = payload.session_policy?.remember_device_available !== true;
  document.getElementById("accountRememberDevice").checked = payload.session_policy?.remember_device_default === true;
  const rememberDays = payload.session_policy?.remembered_device_days;
  if (Number.isSafeInteger(rememberDays) && rememberDays > 0) {
    setText("accountRememberDeviceLabel", "Keep me signed in on this device");
  }
  if (!payload.available) return renderActivationPending();
  page.dataset.accountState = "available";
  serviceState.textContent = state.intent === "sign_up" ? "Ready to create your account" : "Ready to sign in";
  actions.hidden = payload.on_authenticated_origin === true;
  activation.hidden = true;
  if (payload.legal?.account_creation_acceptance_required) {
    const legal = await getJson(payload.legal.documents_endpoint || "/api/v1/legal/documents");
    if (legal.response.ok && legal.payload?.acceptance_enforced) state.legal.manifest = legal.payload;
    else state.config.legal.account_creation_blocked = true;
  }
  renderLegalAssent();
  if (!payload.on_authenticated_origin) return;

  actions.hidden = true;
  serviceState.textContent = 'Checking your account…';
  const session = await readAccountSession({ onRetry: () => { serviceState.textContent = 'Account check delayed. Retrying automatically…'; } });
  if (session.state === 'authenticated') {
    renderAuthenticated(session.payload);
    if (query.has("ref")) {
      query.delete("ref");
      history.replaceState({}, "", `${location.pathname}${query.toString() ? `?${query}` : ""}`);
    }
  } else if (session.state === 'signed_out') {
    actions.hidden = false;
    serviceState.textContent = state.intent === 'sign_up' ? 'Ready to create your account' : 'Ready to sign in';
  } else {
    serviceState.textContent = 'Account check temporarily unavailable';
    authStatus.textContent = 'Your account could not be checked. Reload this page to retry.';
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

// Account-owned product/rewards controls. Currency arithmetic stays in integer
// micro-USDC; only text is formatted in the browser.
const rewardDialogState = { mode: null, idempotency: null, destination: null, quote: null };
function formatRewardMicros(value, places = 2) {
  const n = BigInt(String(value || "0"));
  const negative = n < 0n, absolute = negative ? -n : n;
  const fraction = (absolute % 1000000n).toString().padStart(6, "0").slice(0, places);
  return `${negative ? "−" : ""}${(absolute / 1000000n).toLocaleString("en-US")}${places ? `.${fraction}` : ""}`;
}
function parseRewardAmount(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(text)) throw new Error("Enter a USDC amount with up to six decimals.");
  const [whole, fraction = ""] = text.split(".");
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"))).toString();
}
const rewardMessages = {
  pro_billing_unavailable: "Pro billing is not available yet.",
  subscription_credit_unavailable: "Applying rewards to Pro is not available yet.",
  claim_recent_login_required: "Please sign in again before claiming cashback.",
  claim_below_minimum: "This amount is below the minimum for the selected network.",
  claim_network_cost_too_high: "Network costs are currently too high. Your rewards remain available.",
  claim_treasury_funding_unavailable: "Payout funding is temporarily unavailable on this network. Your rewards remain available.",
  rewards_treasury_unavailable: "Cashback payouts are temporarily unavailable. Your balance is unchanged.",
  stripe_result_indeterminate: "Stripe confirmation is pending. Your rewards are reserved; avoid starting another application.",
  billing_operation_in_progress: "A billing request is being reconciled. Please check back before starting another.",
  billing_operation_requires_reconciliation: "Your earlier billing request needs reconciliation. Your balance remains protected.",
  continue_pro_at_trial_end: "Your free trial has less than two days left. Continue with Pro when it ends to keep every free day; you will not be charged automatically.",
  next_pro_bill_already_credited: "Your next Pro bill already has credit. Apply a smaller amount or wait for that invoice.",
  reward_balance_insufficient: "That amount is no longer available. Refresh your rewards balance.",
  embedded_wallet_verification_required: "Reconnect your Raven Wallet before using it as a destination.",
  external_wallet_verification_required: "Verify your connected wallet again before claiming.",
  pro_subscription_already_exists: "You already have a Pro subscription. Use Manage subscription.",
  pro_subscription_confirmation_pending: "Stripe completed checkout. Raven is waiting for subscription confirmation.",
  product_rate_limited: "A few too many requests. Please wait a moment and try again.",
};
async function productMutation(path, body, { legal = false } = {}) {
  const init = { method: "POST", headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf }, body: JSON.stringify(body) };
  const { response, payload } = legal ? await getJsonWithLegalAcceptance(path, init, "pro_subscription") : await getJson(path, init);
  if (!response.ok || !payload?.ok) throw new Error(rewardMessages[payload?.error] || (payload?.error === "legal_acceptance_required" ? "Review the current Pro and rewards terms to continue." : "This request could not be completed. Your account remains available."));
  return payload;
}
async function loadProductRewards() {
  const panel = document.getElementById("accountRewardsPanel");
  if (!panel || !state.session) return;
  try {
    const { response, payload } = await getJson("/api/v1/pro");
    if (!response.ok || !payload?.ok) return;
    state.product = payload;
    document.getElementById("accountFinancePanel").hidden = !payload.finance_operator;
    panel.hidden = false;
    const { access, policy, rewards, flags } = payload;
    const trial = access.state === "PRO_TRIAL_ACTIVE";
    setText("accountProductTitle", trial ? "Raven Pro trial" : access.pro ? "Raven Pro" : "Raven Standard");
    setText("accountProductPrice", trial ? "$0 during your trial" : access.pro ? `$${policy.pro_monthly_price_usd} / month` : "$0 / month");
    document.getElementById("accountTrialWelcome").hidden = !trial;
    const trialDate = access.trial?.trial_ends_at ? new Date(access.trial.trial_ends_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    const choseSubscription = ["trialing", "active", "past_due", "incomplete"].includes(access.subscription?.status);
    setText("accountTrialStatus", trial ? `${access.trial.days_remaining} days remaining · Ends ${trialDate}. ${choseSubscription ? "You chose to continue with paid Pro after your trial. Manage billing below." : "No card required. You will not be charged automatically."}` : access.trial?.trial_status === "EXPIRED" ? "Your trial has ended. Your existing rewards are still yours." : access.subscription?.cancel_at_period_end ? "Pro stays active through your paid period. Your rewards remain yours after cancellation." : "Native trading and Raven Copy are available on Standard.");
    setText("accountProductFee", `Raven fee: ${(policy.standard_execution_fee_bps / 100).toFixed(2)}% on eligible native trades. No additional copy-trading surcharge.`);
    document.getElementById("accountCashbackExplanation").hidden = !flags.cashback;
    setText("accountCashbackExplanation", `Pro cashback: ${policy.pro_cashback_percent}% of Raven's confirmed execution fee, paid in USDC-denominated rewards. Hyperliquid is separate.`);
    const continueButton = document.getElementById("accountContinuePro");
    continueButton.hidden = choseSubscription;
    continueButton.disabled = !flags.billing;
    continueButton.textContent = trial ? `Keep Pro after trial — $${policy.pro_monthly_price_usd}/month` : `Continue with Pro — $${policy.pro_monthly_price_usd}/month`;
    document.getElementById("accountBillingPortal").hidden = !access.subscription;
    document.getElementById("accountBillingPortal").disabled = !flags.billing;
    document.getElementById("accountStartTrial").hidden = !payload.trial_can_request;
    for (const [field, node] of Object.entries({ available: "Available", pending: "Pending", reserved: "Reserved", earned: "Earned", applied: "Applied", claimed: "Claimed" })) setText(`accountRewards${node}`, `${formatRewardMicros(rewards[`${field}_micros`])} USDC`);
    const available = BigInt(rewards.available_micros);
    document.getElementById("accountClaimCashback").disabled = !rewards.claims_ready || !rewards.networks.some(n => available >= BigInt(n.minimum_claim_micros));
    document.getElementById("accountApplyCashback").disabled = !flags.subscription_credit || !flags.billing || available < 10000n;
    const auto = document.getElementById("accountRewardsAutoApply");
    auto.checked = rewards.auto_apply;
    auto.disabled = !rewards.auto_apply && (!flags.auto_apply || !flags.subscription_credit);
    const adjustment = document.getElementById("accountRewardsAdjustment");
    adjustment.hidden = BigInt(rewards.adjustment_micros) === 0n;
    adjustment.textContent = `${formatRewardMicros(rewards.adjustment_micros, 6)} USDC is an outstanding adjustment for a reversed Raven fee. Your available balance is shown separately.`;
    const coverage = document.getElementById("accountRewardsCoverage");
    coverage.hidden = !rewards.unvalued_fee_count;
    coverage.textContent = `${rewards.unvalued_fee_count} fee ${rewards.unvalued_fee_count === 1 ? "receipt is" : "receipts are"} awaiting verified USDC valuation. These amounts are not available to spend.`;
    const labels = { PENDING: "Estimated · awaiting fee confirmation", AVAILABLE: "Cashback earned", RESERVED: "Reserved for processing", CLAIMED: "Cashback claimed", APPLIED_TO_SUBSCRIPTION: "Applied to Pro invoice credit", REVERSED: "Fee adjustment", RELEASED: "Reservation released" };
    const history = document.getElementById("accountRewardsHistory");
    history.replaceChildren(...rewards.history.map(row => {
      const item = document.createElement("li"), label = document.createElement("span"), value = document.createElement("span");
      label.textContent = `${labels[row.status] || row.status} · ${new Date(row.created_at * 1000).toLocaleDateString()}`;
      value.textContent = `${formatRewardMicros(row.amount_micros, 6)} USDC`;
      item.append(label, value); return item;
    }));
    if (!history.childElementCount) { const item = document.createElement("li"); item.textContent = "Your confirmed fee rebates will appear here."; history.append(item); }
    const invoices = document.getElementById("accountProInvoices");
    invoices.replaceChildren(...payload.invoices.map(row => {
      const item = document.createElement("li");
      item.textContent = `${new Date(row.period_start * 1000).toLocaleDateString()} · Pro $${formatRewardMicros(BigInt(row.gross_cents) * 10000n)} · Rewards $${formatRewardMicros(BigInt(row.reward_credit_cents) * 10000n)} · External payment $${formatRewardMicros(BigInt(row.external_paid_cents) * 10000n)}`;
      return item;
    }));
    if (!invoices.childElementCount) { const item = document.createElement("li"); item.textContent = "No Pro invoices yet."; invoices.append(item); }
    if (!flags.cashback && available === 0n) setText("accountRewardsStatus", "Rewards are not enabled yet. Your Raven login and existing features are unchanged.");
    else if (flags.cashback && !rewards.claims_ready && (!flags.subscription_credit || !flags.billing)) setText("accountRewardsStatus", "Cashback accrual is live. Claims, subscription credits, and paid Pro checkout are not open yet. Your trial ends without an automatic charge.");
  } catch { /* Account login and wallet access never depend on rewards. */ }
}
function updateClaimNetwork() {
  const chain = document.getElementById("accountClaimNetwork").value;
  const rewards = state.product.rewards;
  const network = rewards.networks.find(n => n.chain === chain);
  const select = document.getElementById("accountClaimWallet");
  const ecosystem = chain === "solana" ? "solana" : "evm";
  select.replaceChildren();
  for (const wallet of rewards.wallets.filter(w => w.ecosystem === ecosystem)) {
    const option = document.createElement("option"); option.value = wallet.wallet_record_id; option.textContent = `Raven Wallet · ${shortWalletAddress(wallet.public_address)}`; select.append(option);
  }
  const external = document.createElement("option"); external.value = "external_connected"; external.textContent = "Verify a connected wallet"; select.append(external);
  setText("accountClaimEconomics", network ? `Canonical USDC on ${chain}. Minimum ${formatRewardMicros(network.minimum_claim_micros, 6)} USDC. Raven covers the network cost; we check current cost before confirming.` : "Choose an available network.");
  rewardDialogState.quote = null; rewardDialogState.destination = null;
}
function openRewardsDialog(mode) {
  if (!state.product) return;
  const dialog = document.getElementById("accountRewardsDialog");
  rewardDialogState.mode = mode; rewardDialogState.idempotency = crypto.randomUUID(); rewardDialogState.destination = null; rewardDialogState.quote = null;
  const checkout = mode === "checkout", claim = mode === "claim";
  setText("accountRewardsDialogTitle", checkout ? "Keep Raven Pro" : claim ? "Claim cashback" : "Apply to Raven Pro");
  setText("accountRewardsDialogCopy", checkout ? "Choose a paid subscription only when you are ready. Your remaining free trial is preserved; otherwise paid Pro starts after successful checkout." : claim ? "Choose a network and verify a wallet you control. A requested claim remains reserved until its USDC transfer is confirmed." : "Move available cashback to your next Pro invoice as a dollar credit. This does not start a subscription. Any sub-cent remainder stays in Rewards.");
  document.getElementById("accountRewardsAmountLabel").hidden = checkout;
  document.getElementById("accountClaimFields").hidden = !claim;
  document.getElementById("accountBillingConsentLabel").hidden = !checkout;
  document.getElementById("accountBillingConsent").checked = false;
  const available = BigInt(state.product.rewards.available_micros), price = BigInt(state.product.policy.pro_monthly_price_usd) * 1000000n;
  const amount = claim ? available : (available < price ? available : price) / 10000n * 10000n;
  const amountInput = document.getElementById("accountRewardsAmount"); amountInput.value = `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, "0")}`; amountInput.disabled = false;
  for (const id of ["accountClaimNetwork", "accountClaimWallet"]) document.getElementById(id).disabled = false;
  const networks = document.getElementById("accountClaimNetwork"); networks.replaceChildren(...state.product.rewards.networks.map(n => { const option = document.createElement("option"); option.value = n.chain; option.textContent = n.chain === "solana" ? "Solana" : n.chain === "base" ? "Base" : "Ethereum"; return option; }));
  if (claim) updateClaimNetwork();
  updateRewardCreditPreview();
  setText("accountClaimVerifiedAddress", ""); setText("accountRewardsDialogStatus", "");
  setText("accountRewardsConfirm", checkout ? "Continue to Stripe" : claim ? "Review claim" : "Apply rewards");
  dialog.showModal();
}
function updateRewardCreditPreview() {
  const preview=document.getElementById("accountRewardCreditPreview");
  if(!preview||!state.product)return;
  preview.hidden=rewardDialogState.mode!=="apply";
  if(preview.hidden)return;
  try {
    const amount=BigInt(parseRewardAmount(document.getElementById("accountRewardsAmount").value));
    const price=BigInt(state.product.policy.pro_monthly_price_usd)*1000000n;
    if(amount>price||amount%10000n!==0n){preview.textContent="Use an amount in whole cents up to one Pro month.";return;}
    preview.textContent=`Pro $${formatRewardMicros(price)} − Rewards $${formatRewardMicros(amount)} = $${formatRewardMicros(price-amount)} before any other invoice credits or adjustments.`;
  } catch {preview.textContent="Enter the amount to see your Pro bill estimate.";}
}
function signatureBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n, encoded = "";
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}
async function verifiedClaimDestination() {
  const chain = document.getElementById("accountClaimNetwork").value;
  const choice = document.getElementById("accountClaimWallet").value;
  if (choice !== "external_connected") return { kind: "privy_embedded", chain, wallet_record_id: choice };
  let provider, address;
  if (chain === "solana") { provider = solanaWalletProvider()?.provider; if (!provider?.signMessage) throw new Error("Connect a Solana wallet that supports message verification."); const connected = await provider.connect(); address = solanaAddress(connected.publicKey || provider.publicKey); }
  else { provider = evmWalletProvider()?.provider; if (!provider) throw new Error("Connect your EVM wallet to verify this destination."); address = String((await provider.request({ method: "eth_requestAccounts" }))?.[0] || "").toLowerCase(); }
  const challenge = await productMutation("/api/v1/pro/rewards/wallet/challenge", { chain, address });
  let signature;
  if (chain === "solana") { const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8"); signature = signatureBase58(signed.signature || signed); }
  else { const bytes = new TextEncoder().encode(challenge.message); const hex = "0x" + Array.from(bytes, n => n.toString(16).padStart(2, "0")).join(""); signature = await provider.request({ method: "personal_sign", params: [hex, address] }); }
  const proof = await productMutation("/api/v1/pro/rewards/wallet/verify", { challenge_id: challenge.challenge_id, signature });
  return { kind: "external_connected", chain, verification_id: proof.verification_id };
}
async function submitRewardsForm(event) {
  event.preventDefault();
  const button = document.getElementById("accountRewardsConfirm"); button.disabled = true;
  setText("accountRewardsDialogStatus", "Checking…");
  try {
    const mode = rewardDialogState.mode;
    if (mode === "checkout") {
      if (!document.getElementById("accountBillingConsent").checked) throw new Error("Choose recurring Pro billing before continuing to Stripe.");
      const result = await productMutation("/api/v1/pro/checkout", { consent: true }, { legal: true }); window.location.assign(result.checkout_url); return;
    }
    const amount = parseRewardAmount(document.getElementById("accountRewardsAmount").value);
    if (mode === "claim" && !rewardDialogState.quote) {
      const destination = await verifiedClaimDestination();
      const quote = await productMutation("/api/v1/pro/rewards/claim/quote", { amount_micros: amount, destination });
      rewardDialogState.quote = quote; rewardDialogState.destination = destination;
      setText("accountClaimVerifiedAddress", `Verified destination: ${quote.destination.wallet_address}`);
      setText("accountClaimEconomics", `You receive ${formatRewardMicros(amount, 6)} canonical USDC on ${quote.destination.chain}. Estimated network cost: ${formatRewardMicros(quote.estimated_network_cost_micros, 6)} USDC, covered by Raven.`);
      for (const id of ["accountRewardsAmount", "accountClaimNetwork", "accountClaimWallet"]) document.getElementById(id).disabled = true;
      setText("accountRewardsConfirm", "Confirm claim"); setText("accountRewardsDialogStatus", "Review the amount, network, and full destination address."); return;
    }
    if (mode === "claim") {
      await productMutation("/api/v1/pro/rewards/claim", { amount_micros: amount, idempotency_key: rewardDialogState.idempotency, destination: rewardDialogState.destination });
      setText("accountRewardsStatus", "Claim requested. Your cashback is reserved until the USDC transfer is confirmed.");
    } else {
      await productMutation("/api/v1/pro/rewards/apply", { amount_micros: amount, idempotency_key: rewardDialogState.idempotency }, { legal: true });
      setText("accountRewardsStatus", `${formatRewardMicros(amount)} USDC applied as Pro invoice credit. A subscription starts only if you choose to subscribe.`);
    }
    document.getElementById("accountRewardsDialog").close(); await loadProductRewards();
  } catch (error) { setText("accountRewardsDialogStatus", error.message || "Please try again."); }
  finally { button.disabled = false; }
}
async function loadFinanceReport() {
  const button=document.getElementById("accountFinanceRefresh");button.disabled=true;
  try {
    const {response,payload}=await getJson(`/api/v1/pro/operations/report?period=${encodeURIComponent(document.getElementById("accountFinancePeriod").value)}`);
    if(!response.ok||!payload.report)throw new Error(payload?.error==="finance_recent_login_required"?"Sign in again to review financial operations.":"Financial reporting is temporarily unavailable.");
    const report=payload.report,root=document.getElementById("accountFinanceReport");root.replaceChildren();
    const summary=document.createElement("div");summary.className="account-referral-metrics";
    for(const [label,key] of [["Outstanding cashback liability","outstanding_liability_micros"],["Available cashback","available_micros"],["Reserved cashback","reserved_micros"],["Pending estimates","pending_micros"],["Cashback claimed","claimed_micros"],["Applied to Pro","applied_to_pro_micros"]]) {
      const card=document.createElement("article"),name=document.createElement("span"),value=document.createElement("strong");name.textContent=label;value.textContent=`${formatRewardMicros(report.reward_balances_as_of_end[key])} USDC`;card.append(name,value);summary.append(card);
    }
    root.append(summary);
    const list=document.createElement("div");list.className="account-affiliate-events";
    for(const row of report.execution_by_source){const line=document.createElement("p");line.textContent=`${row.period} · ${row.chain} · ${row.trade_type} · ${row.entitlement_source} — Customer fee ${formatRewardMicros(row.customer_execution_fees_micros)} / Provider share ${formatRewardMicros(row.provider_share_micros)} / Collector receipt ${formatRewardMicros(row.gross_collected_micros)} / Cashback ${formatRewardMicros(row.cashback_accrued_micros)} / Net ${formatRewardMicros(row.net_execution_revenue_micros)} USDC`;list.append(line);}
    if(!list.childElementCount){const empty=document.createElement("p");empty.textContent="No confirmed, valued execution fees in this period.";list.append(empty);}
    root.append(list);
    setText("accountFinanceStatus","Revenue is grouped by its source chain. Claim destinations are separate. Pending and unvalued receipts are not counted as available cashback. This report does not verify payout funding.");
  } catch(error){setText("accountFinanceStatus",error.message);} finally {button.disabled=false;}
}
function bindRewardsControls() {
  document.getElementById("accountFinanceRefresh")?.addEventListener("click",loadFinanceReport);
  document.getElementById("accountRewardsAmount")?.addEventListener("input",updateRewardCreditPreview);
  document.getElementById("accountRefreshRewards")?.addEventListener("click",loadProductRewards);
  document.getElementById("accountContinuePro")?.addEventListener("click", () => openRewardsDialog("checkout"));
  document.getElementById("accountClaimCashback")?.addEventListener("click", () => openRewardsDialog("claim"));
  document.getElementById("accountApplyCashback")?.addEventListener("click", () => openRewardsDialog("apply"));
  document.getElementById("accountRewardsClose")?.addEventListener("click", () => document.getElementById("accountRewardsDialog").close());
  document.getElementById("accountRewardsForm")?.addEventListener("submit", submitRewardsForm);
  document.getElementById("accountClaimNetwork")?.addEventListener("change", updateClaimNetwork);
  document.getElementById("accountBillingPortal")?.addEventListener("click", async () => { try { const result = await productMutation("/api/v1/pro/portal", {}); window.location.assign(result.portal_url); } catch (error) { setText("accountRewardsStatus", error.message); } });
  document.getElementById("accountStartTrial")?.addEventListener("click", async () => { try { await productMutation("/api/v1/pro/trial/start", {}); await loadProductRewards(); await loadProIntelligenceCapabilities(); } catch (error) { setText("accountRewardsStatus", error.message); } });
  document.getElementById("accountRewardsAutoApply")?.addEventListener("change", async (event) => {
    const input = event.target, wanted = input.checked; input.disabled = true;
    try { await productMutation("/api/v1/pro/rewards/preference", { auto_apply: wanted }, { legal: wanted }); setText("accountRewardsStatus", wanted ? "Auto-apply is on for future Pro renewals. This does not create a subscription." : "Auto-apply is off. Previously applied invoice credits stay on your billing account."); }
    catch (error) { input.checked = !wanted; setText("accountRewardsStatus", error.message); }
    finally { await loadProductRewards(); }
  });
}
bindRewardsControls();

document.getElementById("accountPrivyEcosystem")?.addEventListener("change", updatePrivyCreateLabel);
