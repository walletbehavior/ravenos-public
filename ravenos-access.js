(function () {
  const RANK = { disconnected: -1, free: 0, pro: 1, founder: 2, atlas: 3 };
  const STORAGE_KEY = "ravenos_wallet_access_v1";
  const state = {
    status: "disconnected",
    publicKey: "",
    provider: "",
    tier: "free",
    reason: "Free",
    balance: 0,
    subscription: null,
    entitlements: ["free"],
    thresholds: { pro: 1000000, founder: 10000000, stage: "early" },
    tokenAccessConfigured: false,
    tokenAccessStatus: "not_configured",
    checking: false,
    error: "",
  };
  const subscribers = new Set();

  function shortKey(key) {
    return key && key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key || "";
  }

  function tokenCount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        publicKey: state.publicKey,
        provider: state.provider,
      }));
    } catch (_) {}
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.publicKey) {
        state.publicKey = String(saved.publicKey);
        state.provider = String(saved.provider || "");
        state.status = "connected";
      }
    } catch (_) {}
  }

  function emit() {
    renderWalletState();
    applyFeatureGates();
    window.RavenOSFeatures?.applyFeatureGates?.(document, { ...state });
    subscribers.forEach((fn) => {
      try { fn({ ...state }); } catch (_) {}
    });
    window.dispatchEvent(new CustomEvent("ravenos:access", { detail: { ...state } }));
  }

  function providerFor(name) {
    const wanted = String(name || "").toLowerCase();
    if (wanted === "phantom") return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    if (wanted === "solflare") return window.solflare || (window.solana?.isSolflare ? window.solana : null);
    if (wanted === "backpack") return window.backpack?.solana || (window.xnft?.solana?.isBackpack ? window.xnft.solana : null);
    return null;
  }

  function bytesToBase58(bytes) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i += 1) {
        carry += digits[i] << 8;
        digits[i] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    for (const byte of bytes) {
      if (byte === 0) digits.push(0);
      else break;
    }
    return digits.reverse().map((digit) => alphabet[digit]).join("");
  }

  function walletAuthMessage(wallet) {
    return `RavenOS account access\nWallet: ${wallet}\nOrigin: ${window.location.origin}`;
  }

  async function signedWalletPayload() {
    if (!state.publicKey) await connect("Phantom");
    const provider = providerFor(state.provider) || providerFor("Phantom") || providerFor("Solflare") || providerFor("Backpack");
    if (!provider || typeof provider.signMessage !== "function") throw new Error("wallet_signing_unavailable");
    const message = walletAuthMessage(state.publicKey);
    const encoded = new TextEncoder().encode(message);
    const result = await provider.signMessage(encoded, "utf8");
    const signatureBytes = result?.signature || result;
    return {
      wallet: state.publicKey,
      message,
      signature: bytesToBase58(signatureBytes),
    };
  }

  async function connect(name) {
    const provider = providerFor(name);
    if (!provider || typeof provider.connect !== "function") {
      state.error = `${name} wallet not detected`;
      emit();
      return { ...state };
    }
    state.checking = true;
    state.error = "";
    emit();
    try {
      const result = await provider.connect();
      const key = String(result?.publicKey || provider.publicKey || "");
      if (!key) throw new Error("wallet_public_key_missing");
      state.publicKey = key;
      state.provider = name;
      state.status = "connected";
      save();
      await checkAccess(key);
    } catch (error) {
      state.checking = false;
      state.error = error instanceof Error ? error.message : "wallet_connection_failed";
      emit();
    }
    return { ...state };
  }

  function disconnect() {
    const provider = providerFor(state.provider);
    try { provider?.disconnect?.(); } catch (_) {}
    state.status = "disconnected";
    state.publicKey = "";
    state.provider = "";
    state.tier = "free";
    state.reason = "Free";
    state.balance = 0;
    state.subscription = null;
    state.entitlements = ["free"];
    state.error = "";
    state.checking = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    emit();
  }

  async function checkAccess(publicKey = state.publicKey) {
    if (!publicKey) {
      state.status = "disconnected";
      state.tier = "free";
      emit();
      return { ...state };
    }
    state.checking = true;
    state.error = "";
    emit();
    try {
      const response = await fetch(`/api/access?wallet=${encodeURIComponent(publicKey)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "access_check_failed");
      state.publicKey = String(payload.wallet || publicKey);
      state.status = "connected";
      state.tier = String(payload.tier || "free");
      state.reason = String(payload.reason || (state.tier === "atlas" ? "Atlas Subscription" : state.tier === "founder" ? "Founder" : state.tier === "pro" ? "Token Holder" : "Free"));
      state.balance = Number(payload.balance || 0);
      state.subscription = payload.subscription || null;
      state.entitlements = Array.isArray(payload.entitlements) && payload.entitlements.length ? payload.entitlements : [state.tier || "free"];
      state.thresholds = payload.thresholds || state.thresholds;
      state.tokenAccessConfigured = Boolean(payload.tokenAccessConfigured);
      state.tokenAccessStatus = String(payload.tokenAccessStatus || (state.tokenAccessConfigured ? "configured" : "not_configured"));
      state.checking = false;
      state.error = "";
      save();
    } catch (error) {
      state.status = "connected";
      state.tier = "free";
      state.reason = "Free";
      state.balance = 0;
      state.subscription = null;
      state.entitlements = ["free"];
      state.checking = false;
      state.error = "API unavailable. Subscription and future token access checks are temporarily unavailable.";
    }
    emit();
    return { ...state };
  }

  function hasTier(required) {
    const need = RANK[String(required || "free")] ?? 0;
    const have = state.status === "connected" ? (RANK[state.tier] ?? 0) : -1;
    return have >= need;
  }

  function renderWalletState() {
    const label = state.status === "disconnected" ? "disconnected" : `connected/${state.tier}`;
    const stateEl = document.getElementById("walletState");
    const detailEl = document.getElementById("walletAccessDetail");
    const keyEl = document.getElementById("walletPublicKey");
    const proEl = document.getElementById("proRequiredBalance");
    const founderEl = document.getElementById("founderRequiredBalance");
    const balanceEl = document.getElementById("walletBalance");
    const tierEl = document.getElementById("resolvedTier");
    const reasonEl = document.getElementById("accessReason");
    const subscriptionEl = document.getElementById("subscriptionStatus");
    const planEl = document.getElementById("planType");
    const renewalEl = document.getElementById("renewalDate");
    const tokenStatusEl = document.getElementById("tokenAccessStatus");
    const stageEl = document.getElementById("marketCapStage");
    if (stateEl) stateEl.textContent = state.checking ? "checking access" : label;
    if (keyEl) keyEl.textContent = state.publicKey ? `${shortKey(state.publicKey)} · ${state.provider || "wallet"}` : "";
    if (detailEl) {
      if (state.status === "disconnected") detailEl.textContent = state.tokenAccessConfigured
        ? "Connect a Solana wallet to resolve product access."
        : "Token-holder access is not active yet. Stripe Pro access is available.";
      else if (state.error) detailEl.textContent = state.error;
      else if (!state.tokenAccessConfigured) detailEl.textContent = "Token-holder access is not active yet. No RavenOS token exists at this time.";
      else detailEl.textContent = `${tokenCount(state.balance)} access tokens detected.`;
    }
    if (proEl) proEl.textContent = tokenCount(state.thresholds.pro);
    if (founderEl) founderEl.textContent = tokenCount(state.thresholds.founder);
    if (balanceEl) balanceEl.textContent = state.status === "connected" ? tokenCount(state.balance) : "not connected";
    if (tierEl) tierEl.textContent = state.status === "connected" ? state.tier : "disconnected";
    document.querySelectorAll("[data-entitlements]").forEach((el) => { el.textContent = state.entitlements.join(", "); });
    if (reasonEl) reasonEl.textContent = state.status === "connected" ? state.reason : "not connected";
    if (subscriptionEl) subscriptionEl.textContent = state.subscription?.status || "not active";
    if (planEl) planEl.textContent = state.subscription?.plan_type || "none";
    if (tokenStatusEl) tokenStatusEl.textContent = state.tokenAccessConfigured ? state.tokenAccessStatus : "not active";
    if (stageEl) stageEl.textContent = state.thresholds.stage || "early";
    if (renewalEl) {
      const ts = Number(state.subscription?.current_period_end || 0);
      renewalEl.textContent = ts ? new Date(ts * 1000).toLocaleDateString() : "none";
    }
    document.body.dataset.accessTier = state.status === "connected" ? state.tier : "disconnected";
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "request_failed");
    return payload;
  }

  async function startCheckout(extra = {}) {
    if (!state.publicKey) await connect("Phantom");
    if (!state.publicKey) throw new Error("wallet_connection_required");
    const payload = await postJson("/api/stripe/checkout", { wallet: state.publicKey, ...extra });
    if (payload.url) window.location.href = payload.url;
    return payload;
  }

  async function openPortal() {
    const signed = await signedWalletPayload();
    const payload = await postJson("/api/stripe/portal", signed);
    if (payload.url) window.location.href = payload.url;
    return payload;
  }

  function applyFeatureGates(root = document) {
    root.querySelectorAll("[data-requires-tier]").forEach((el) => {
      const required = el.getAttribute("data-requires-tier") || "free";
      const unlocked = hasTier(required);
      el.classList.toggle("access-locked", !unlocked);
      el.classList.toggle("access-unlocked", unlocked);
      el.setAttribute("aria-disabled", unlocked ? "false" : "true");
      let note = el.querySelector(":scope > .gate-note");
      if (!note) {
        note = document.createElement("div");
        note.className = "gate-note";
        el.appendChild(note);
      }
      note.textContent = unlocked
        ? (state.tier === "atlas" ? "Atlas access active." : state.tier === "founder" ? "Founder access active." : "Pro access active.")
        : `${required.toUpperCase()} access required. Connect wallet or upgrade.`;
    });
  }

  function bindWalletControls() {
    document.getElementById("connectPhantom")?.addEventListener("click", () => connect("Phantom"));
    document.getElementById("connectSolflare")?.addEventListener("click", () => connect("Solflare"));
    document.getElementById("connectBackpack")?.addEventListener("click", () => connect("Backpack"));
    document.querySelectorAll("[data-wallet-connect]").forEach((button) => {
      button.addEventListener("click", () => connect(button.getAttribute("data-wallet-connect") || "Phantom"));
    });
    document.getElementById("disconnectWallet")?.addEventListener("click", () => disconnect());
    document.querySelectorAll("[data-access-check]").forEach((button) => {
      button.addEventListener("click", () => state.publicKey ? checkAccess() : connect("Phantom"));
    });
    document.querySelectorAll("[data-stripe-checkout]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await startCheckout({ plan: button.getAttribute("data-stripe-checkout") || "monthly" }); } catch (error) { state.error = error instanceof Error ? error.message : "checkout_failed"; emit(); }
        finally { button.disabled = false; }
      });
    });
    document.querySelectorAll("[data-stripe-portal]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await openPortal(); } catch (error) { state.error = error instanceof Error ? error.message : "portal_failed"; emit(); }
        finally { button.disabled = false; }
      });
    });
  }

  function subscribe(fn) {
    subscribers.add(fn);
    fn({ ...state });
    return () => subscribers.delete(fn);
  }

  window.RavenOSAccess = {
    connect,
    disconnect,
    checkAccess,
    hasTier,
    startCheckout,
    openPortal,
    subscribe,
    applyFeatureGates,
    getState: () => ({ ...state }),
  };

  document.addEventListener("DOMContentLoaded", () => {
    load();
    bindWalletControls();
    renderWalletState();
    applyFeatureGates();
    if (state.publicKey) checkAccess(state.publicKey);
  });
})();
