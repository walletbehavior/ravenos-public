const state = {
  session: null,
  csrf: "",
  ownProfile: null,
  following: new Set(),
};

const BOARD_LABELS = Object.freeze({
  most_consistent: "Most consistent",
  lowest_drawdown: "Lowest drawdown",
  most_copyable: "Most copyable",
  evidence_complete: "Evidence complete",
  most_followed: "Most followed",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value, { digits = 1, suffix = "" } = {}) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(parsed)}${suffix}` : "Unavailable";
}

function percent(value, { signed = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Unavailable";
  return `${signed && parsed > 0 ? "+" : ""}${number(parsed, { digits: 1 })}%`;
}

function shortDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

async function getJson(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function onAuthenticatedApp() {
  return ["app.ravenos.xyz", "localhost", "127.0.0.1"].includes(location.hostname);
}

function emptyMarkup(title, detail = "") {
  return `<div class="community-empty"><strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}

function classificationLabel(value) {
  return ({
    raven_observed: "Raven observed",
    connected_account_observed: "Connected account",
    historically_reconstructed: "Historical reconstruction",
    prospective: "Prospective",
    simulated: "Simulated",
    user_reported: "User reported",
  })[value] || "Unclassified";
}

function boardMetrics(row, boardId) {
  const evidence = row.evidence;
  if (!evidence) {
    return [
      ["Followers", number(row.followers_count, { digits: 0 })],
      ["Useful", number(row.useful_count, { digits: 0 })],
      ["Rank basis", "Popularity only"],
      ["Performance", "Not ranked"],
    ];
  }
  const primary = boardId === "most_consistent"
    ? ["Profitable periods", percent(evidence.profitable_period_share_pct)]
    : boardId === "lowest_drawdown"
      ? ["Max drawdown", percent(evidence.maximum_drawdown_pct)]
      : boardId === "most_copyable"
        ? ["Copyability", number(evidence.copyability_score)]
        : ["Confidence", percent(evidence.evidence_confidence_pct)];
  return [
    primary,
    ["90D return", percent(evidence.return_pct, { signed: true })],
    ["Sample", number(evidence.sample_count, { digits: 0 })],
    ["Evidence", percent(evidence.evidence_confidence_pct)],
  ];
}

function renderBoardRows(payload) {
  const root = document.getElementById("communityBoardRows");
  const gate = document.getElementById("communityBoardGate");
  if (!root || !gate) return;
  if (!payload?.ok) {
    const disabled = payload?.error === "community_disabled";
    gate.textContent = disabled ? "Community is staged, not public yet" : "Board unavailable";
    root.innerHTML = emptyMarkup(disabled ? "Community is forming" : "Board unavailable", disabled ? "Profiles remain private until launch." : "Try again shortly.");
    return;
  }
  const board = payload.board || {};
  gate.textContent = board.id === "most_followed"
    ? "Popularity is separate from performance ranking"
    : `Minimum ${number(board.minimum_sample_count, { digits: 0 })} observations · ${number(board.minimum_confidence_pct, { digits: 0 })}% confidence · ${board.period?.toUpperCase() || "qualified history"}`;
  if (!payload.rows?.length) {
    root.innerHTML = emptyMarkup("Insufficient evidence", "No public profile clears this board yet.");
    return;
  }
  root.innerHTML = payload.rows.map((row) => {
    const metrics = boardMetrics(row, board.id);
    const url = `/@${encodeURIComponent(row.username)}`;
    return `<article class="community-row">
      <div class="community-rank">${String(row.rank).padStart(2, "0")}</div>
      <a class="community-person" href="${url}"><strong>@${escapeHtml(row.username)}</strong><small>Since ${escapeHtml(shortDate(row.member_since))}</small></a>
      ${metrics.map(([label, value], index) => `<div class="community-metric${index > 1 ? " optional" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      <a class="community-row-link" href="${url}">Profile →</a>
    </article>`;
  }).join("");
}

async function loadBoard() {
  const select = document.getElementById("communityBoardSelect");
  if (!select) return;
  const board = BOARD_LABELS[select.value] ? select.value : "most_consistent";
  const root = document.getElementById("communityBoardRows");
  if (root) root.innerHTML = emptyMarkup("Loading board");
  try {
    const { payload } = await getJson(`/api/v1/community/boards?board=${encodeURIComponent(board)}&limit=30`);
    renderBoardRows(payload);
  } catch {
    renderBoardRows(null);
  }
}

async function loadSession() {
  if (!onAuthenticatedApp()) return null;
  try {
    const { response, payload } = await getJson("/api/v1/auth/session");
    if (!response.ok || !payload?.authenticated) return null;
    state.session = payload;
    state.csrf = String(payload.csrf_token || "");
    return payload;
  } catch {
    return null;
  }
}

function showPanel(name) {
  for (const button of document.querySelectorAll("[data-community-view]")) button.classList.toggle("active", button.dataset.communityView === name);
  for (const panel of document.querySelectorAll("[data-community-panel]")) {
    const active = panel.dataset.communityPanel === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }
  if (name === "following") loadFollowing();
  if (name === "profile") loadOwnProfile();
}

function settingsFromForm(form) {
  const checked = (name) => Boolean(form.elements.namedItem(name)?.checked);
  return {
    public_profile_enabled: checked("public_profile_enabled"),
    performance_visible: checked("performance_visible"),
    positions_visible: checked("positions_visible"),
    trade_history_visible: checked("trade_history_visible"),
    strategy_breakdown_visible: checked("strategy_breakdown_visible"),
    wallet_addresses_visible: checked("wallet_addresses_visible"),
    followers_visibility: checked("followers_visible") ? "public" : "private",
    allow_following: checked("allow_following"),
    allow_shadowing: checked("allow_shadowing"),
    allow_raven_copy: checked("allow_raven_copy"),
    referral_link_public: checked("referral_link_public"),
  };
}

function populateSettings(profile) {
  const form = document.getElementById("communitySettingsForm");
  if (!form || !profile) return;
  const settings = profile.settings || {};
  for (const field of [
    "public_profile_enabled", "performance_visible", "positions_visible", "trade_history_visible",
    "strategy_breakdown_visible", "wallet_addresses_visible", "allow_following", "allow_shadowing",
    "allow_raven_copy", "referral_link_public",
  ]) form.elements.namedItem(field).checked = settings[field] === true;
  form.elements.namedItem("followers_visible").checked = settings.followers_visibility === "public";
  form.hidden = false;
  const link = document.getElementById("communityPublicProfileLink");
  if (link) {
    link.hidden = !profile.profile_url;
    if (profile.profile_url) link.href = profile.profile_url;
  }
}

async function loadOwnProfile() {
  const accountState = document.getElementById("communityAccountState");
  if (!accountState) return;
  if (!state.session) await loadSession();
  if (!state.session) {
    accountState.innerHTML = `<strong>Sign in to opt in</strong><a href="https://app.ravenos.xyz/account/">Open account →</a>`;
    return;
  }
  try {
    const { response, payload } = await getJson("/api/v1/community/me");
    if (!response.ok || !payload?.profile) throw new Error("unavailable");
    state.ownProfile = payload.profile;
    if (payload.profile.username_required) {
      accountState.innerHTML = `<strong>Choose a username first</strong><a href="/account/">Open account →</a>`;
      return;
    }
    accountState.hidden = true;
    populateSettings(payload.profile);
  } catch {
    accountState.innerHTML = `<strong>Profile controls unavailable</strong><span>Try again shortly.</span>`;
  }
}

async function saveOwnProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("communitySettingsSave");
  const status = document.getElementById("communitySettingsStatus");
  button.disabled = true;
  status.textContent = "Saving";
  try {
    const { response, payload } = await getJson("/api/v1/community/me", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: JSON.stringify({ settings: settingsFromForm(form), expected_revision: state.ownProfile?.profile_revision ?? 0 }),
    });
    if (!response.ok || !payload?.profile) throw new Error(payload?.error || "unavailable");
    state.ownProfile = payload.profile;
    populateSettings(payload.profile);
    status.textContent = payload.profile.settings.public_profile_enabled ? "Profile public" : "Profile private";
  } catch (error) {
    status.textContent = error.message === "community_profile_revision_conflict" ? "Reload and try again" : "Could not save";
  } finally {
    button.disabled = false;
  }
}

function followingRow(row) {
  const profile = row.profile || {};
  return `<article class="community-row">
    <div class="community-rank">•</div>
    <a class="community-person" href="/@${encodeURIComponent(profile.username)}"><strong>@${escapeHtml(profile.username)}</strong><small>${escapeHtml(row.notification_level === "meaningful" ? "Meaningful updates" : "Alerts off")}</small></a>
    <div class="community-metric"><span>Followers</span><strong>${escapeHtml(number(profile.followers_count, { digits: 0 }))}</strong></div>
    <div class="community-metric"><span>Useful</span><strong>${escapeHtml(number(profile.useful_count, { digits: 0 }))}</strong></div>
    <div class="community-metric optional"><span>Since</span><strong>${escapeHtml(shortDate(row.followed_at))}</strong></div>
    <div class="community-metric optional"><span>Performance</span><strong>${profile.public_disclosures?.performance ? "Public" : "Private"}</strong></div>
    <a class="community-row-link" href="/@${encodeURIComponent(profile.username)}">Profile →</a>
  </article>`;
}

async function loadFollowing() {
  const root = document.getElementById("communityFollowingRows");
  if (!state.session) await loadSession();
  if (!state.session) {
    if (root) root.innerHTML = `<div class="community-empty"><strong>Sign in to follow traders</strong><a href="https://app.ravenos.xyz/account/">Open account →</a></div>`;
    return;
  }
  try {
    const { response, payload } = await getJson("/api/v1/community/following");
    if (!response.ok) throw new Error("unavailable");
    state.following = new Set((payload.rows || []).map((row) => row.profile?.username).filter(Boolean));
    if (root) root.innerHTML = payload.rows?.length ? payload.rows.map(followingRow).join("") : emptyMarkup("No profiles followed", "Qualified profiles will appear here.");
  } catch {
    if (root) root.innerHTML = emptyMarkup("Following unavailable", "Try again shortly.");
  }
}

function profileUsername() {
  const path = decodeURIComponent(location.pathname);
  const direct = path.match(/^\/@([a-z][a-z0-9_]{2,23})\/?$/i);
  const query = new URLSearchParams(location.search).get("username") || "";
  return String(direct?.[1] || query).replace(/^@/, "").toLowerCase();
}

function metric(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function performanceCard(evidence) {
  return `<article class="community-period-card">
    <header><span>${escapeHtml(evidence.period)}</span><small>${escapeHtml(classificationLabel(evidence.classification))}</small></header>
    <div class="community-period-metrics">
      ${metric("Return", percent(evidence.return_pct, { signed: true }))}
      ${metric("Max drawdown", percent(evidence.maximum_drawdown_pct))}
      ${metric("Profit factor", number(evidence.profit_factor, { digits: 2 }))}
      ${metric("Consistency", percent(evidence.profitable_period_share_pct))}
      ${metric("Copyability", number(evidence.copyability_score))}
      ${metric("Confidence", percent(evidence.evidence_confidence_pct))}
    </div>
    <div class="community-period-source">${escapeHtml(evidence.provenance?.source_contract_id || "Source unavailable")} · ${escapeHtml(evidence.evidence_state)}</div>
  </article>`;
}

async function setProfileAction(username, action, enabled, button) {
  button.disabled = true;
  try {
    const path = action === "follow"
      ? `/api/v1/community/profiles/${encodeURIComponent(username)}/follow`
      : `/api/v1/community/profiles/${encodeURIComponent(username)}/recognitions/useful`;
    const { response } = await getJson(path, {
      method: enabled ? "PUT" : "DELETE",
      headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
      body: "{}",
    });
    if (!response.ok) throw new Error("unavailable");
    if (action === "follow") {
      if (enabled) state.following.add(username); else state.following.delete(username);
      button.textContent = enabled ? "Following" : "Follow";
      button.dataset.enabled = String(enabled);
    } else {
      button.textContent = "Useful ✓";
      button.dataset.enabled = "true";
    }
  } catch {
    button.textContent = "Try again";
  } finally {
    button.disabled = false;
  }
}

async function loadPublicProfile() {
  const root = document.getElementById("communityPublicProfile");
  if (!root) return;
  const username = profileUsername();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
    root.innerHTML = emptyMarkup("Profile not found");
    return;
  }
  try {
    const { response, payload } = await getJson(`/api/v1/community/profiles/${encodeURIComponent(username)}`);
    if (!response.ok || !payload?.profile) throw new Error("not_found");
    const profile = payload.profile;
    await loadSession();
    if (state.session) await loadFollowing();
    const signedInApp = Boolean(state.session && onAuthenticatedApp());
    const profileAppUrl = `https://app.ravenos.xyz/community/profile/?username=${encodeURIComponent(username)}`;
    const actions = signedInApp
      ? `<button class="primary" type="button" data-profile-action="follow" data-enabled="${state.following.has(username)}" ${profile.availability.following ? "" : "disabled"}>${state.following.has(username) ? "Following" : profile.availability.following ? "Follow" : "Following closed"}</button><button type="button" data-profile-action="useful">Useful</button>`
      : `<a class="primary" href="${profileAppUrl}">Sign in to follow</a>`;
    root.innerHTML = `<header class="community-profile-header">
      <div><span class="community-profile-eyebrow">Public Raven profile</span><h1>@${escapeHtml(profile.username)}</h1><p>Member since ${escapeHtml(shortDate(profile.member_since))}</p></div>
      <div class="community-profile-actions">${actions}</div>
    </header>
    <div class="community-profile-strip">
      ${metric("Evidence", profile.performance?.length ? "Qualified" : "Insufficient")}
      ${metric("Followers", profile.followers_count === null ? "Private" : number(profile.followers_count, { digits: 0 }))}
      ${metric("Useful", number(profile.useful_count, { digits: 0 }))}
      ${metric("Raven Copy", profile.availability.raven_copy ? "Available" : "Off")}
    </div>
    <section class="community-performance"><h2>Public performance</h2><div class="community-period-grid">${profile.performance?.length ? profile.performance.map(performanceCard).join("") : emptyMarkup("Insufficient evidence", "No qualified public performance yet.")}</div></section>`;
    if (signedInApp) {
      const follow = root.querySelector('[data-profile-action="follow"]');
      if (follow && !follow.disabled) follow.addEventListener("click", () => setProfileAction(username, "follow", follow.dataset.enabled !== "true", follow));
      const useful = root.querySelector('[data-profile-action="useful"]');
      if (useful) useful.addEventListener("click", () => setProfileAction(username, "useful", true, useful));
    }
  } catch {
    root.innerHTML = emptyMarkup("Profile not found", "It may be private or unavailable.");
  }
}

function initCommunityWorkspace() {
  const select = document.getElementById("communityBoardSelect");
  if (!select) return;
  select.addEventListener("change", loadBoard);
  for (const button of document.querySelectorAll("[data-community-view]")) button.addEventListener("click", () => showPanel(button.dataset.communityView));
  document.getElementById("communitySettingsForm")?.addEventListener("submit", saveOwnProfile);
  loadBoard();
  loadSession();
}

initCommunityWorkspace();
loadPublicProfile();
