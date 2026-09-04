import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
  normalizeRavenUsername,
  randomOpaqueId,
  sha256,
} from "./customer_identity.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
} from "./customer_trade/terminal_runtime.mjs";

export const CUSTOMER_COMMUNITY_ROUTE = "/api/v1/community";
export const CUSTOMER_COMMUNITY_SCHEMA = "ravenos.community.v1";
export const COMMUNITY_PROFILE_SCHEMA = "ravenos.community_profile.v1";
export const COMMUNITY_PERFORMANCE_SCHEMA = "ravenos.community_performance_evidence.v1";

export const CommunityLimits = Object.freeze({
  maximum_request_bytes: 4 * 1024,
  maximum_response_bytes: 96 * 1024,
  maximum_following_rows: 100,
  maximum_board_rows: 50,
  mutation_requests_per_15_minutes: 80,
  board_requests_per_15_minutes: 120,
});

export const CommunityBoardDefinitions = Object.freeze({
  most_consistent: Object.freeze({
    id: "most_consistent",
    label: "Most consistent",
    period: "90d",
    minimum_sample_count: 20,
    minimum_active_periods: 4,
    minimum_confidence_pct: 80,
    ranking_basis: "profitable_period_share",
  }),
  lowest_drawdown: Object.freeze({
    id: "lowest_drawdown",
    label: "Lowest drawdown",
    period: "90d",
    minimum_sample_count: 20,
    minimum_active_periods: 4,
    minimum_confidence_pct: 80,
    ranking_basis: "maximum_drawdown_pct_ascending",
  }),
  most_copyable: Object.freeze({
    id: "most_copyable",
    label: "Most copyable",
    period: "90d",
    minimum_sample_count: 20,
    minimum_active_periods: 0,
    minimum_confidence_pct: 80,
    ranking_basis: "prospective_copyability",
  }),
  evidence_complete: Object.freeze({
    id: "evidence_complete",
    label: "Evidence complete",
    period: "90d",
    minimum_sample_count: 20,
    minimum_active_periods: 0,
    minimum_confidence_pct: 85,
    ranking_basis: "evidence_confidence",
  }),
  most_followed: Object.freeze({
    id: "most_followed",
    label: "Most followed",
    period: null,
    minimum_sample_count: 0,
    minimum_active_periods: 0,
    minimum_confidence_pct: 0,
    ranking_basis: "followers",
  }),
});

const PROFILE_SETTING_FIELDS = Object.freeze([
  "public_profile_enabled",
  "performance_visible",
  "positions_visible",
  "trade_history_visible",
  "strategy_breakdown_visible",
  "wallet_addresses_visible",
  "followers_visibility",
  "allow_following",
  "allow_shadowing",
  "allow_raven_copy",
  "referral_link_public",
]);
const PROFILE_SETTING_SET = new Set(PROFILE_SETTING_FIELDS);
const OBSERVATION_TYPES = new Set([
  "raven_observed",
  "connected_account_observed",
  "user_reported",
  "historically_reconstructed",
  "prospective",
  "simulated",
]);
const EVIDENCE_STATES = new Set(["available", "partial", "insufficient_evidence"]);
const PERIODS = new Set(["30d", "90d", "1y", "all_available"]);

function text(value, maximum = 160) {
  return String(value ?? "").trim().slice(0, maximum);
}

function finite(value, field, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new CommunityError(`${field}_invalid`);
  return number;
}

function integer(value, field, limits = {}) {
  const number = finite(value, field, limits);
  if (number !== null && !Number.isSafeInteger(number)) throw new CommunityError(`${field}_invalid`);
  return number;
}

function boolean(value, field) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new CommunityError(`${field}_invalid`);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CommunityError(code);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new CommunityError(code);
  return value;
}

function cleanDigest(value, field) {
  const digest = text(value, 160);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(digest)) throw new CommunityError(`${field}_invalid`);
  return digest;
}

function cleanContract(value) {
  const contract = text(value, 160).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/.test(contract)) throw new CommunityError("source_contract_id_invalid");
  return contract;
}

function communityUsername(value) {
  try {
    return normalizeRavenUsername(decodeURIComponent(String(value || "")));
  } catch {
    throw new CommunityError("community_username_invalid");
  }
}

function iso(seconds) {
  const value = Number(seconds);
  return Number.isSafeInteger(value) && value >= 0 ? new Date(value * 1_000).toISOString() : null;
}

function asBool(value) {
  return Number(value) === 1;
}

function json(payload, { status = 200, cache = "no-store", headers = {} } = {}) {
  const extraHeaders = {};
  if (headers instanceof Headers) headers.forEach((value, key) => { extraHeaders[key] = value; });
  else Object.assign(extraHeaders, headers || {});
  return boundedJsonResponse(payload, {
    status,
    headers: {
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  }, {
    max_bytes: CommunityLimits.maximum_response_bytes,
    terminal_security: true,
  });
}

export class CommunityError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "CommunityError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeCommunitySettings(input = {}) {
  const source = exactObject(input, PROFILE_SETTING_SET, "community_settings_invalid");
  const settings = {};
  for (const field of PROFILE_SETTING_FIELDS) {
    if (field === "followers_visibility") {
      const visibility = text(source[field] ?? "private", 20).toLowerCase();
      if (!new Set(["private", "public"]).has(visibility)) throw new CommunityError("followers_visibility_invalid");
      settings[field] = visibility;
    } else {
      settings[field] = boolean(source[field] ?? false, field);
    }
  }
  return Object.freeze(settings);
}

export function defaultCommunitySettings() {
  return normalizeCommunitySettings({});
}

export function communitySettingsDigestPayload(settings) {
  const normalized = normalizeCommunitySettings(settings);
  return JSON.stringify(Object.fromEntries(PROFILE_SETTING_FIELDS.map((field) => [field, normalized[field]])));
}

export function resolveCommunityRuntime(env = {}, deps = {}) {
  const storeAvailable = Boolean(deps.store || env.RAVENOS_CUSTOMER_DB?.prepare);
  const enabled = env.RAVENOS_COMMUNITY_ENABLED === "1";
  return Object.freeze({
    enabled: enabled && storeAvailable,
    state: !enabled ? "disabled" : storeAvailable ? "available" : "database_unavailable",
    reason: !enabled ? "community_disabled" : storeAvailable ? null : "community_database_unavailable",
  });
}

function ownProfile(row) {
  if (!row) return null;
  const username = text(row.username, 24).toLowerCase() || null;
  const exists = row.profile_revision !== null && row.profile_revision !== undefined;
  const settings = exists
    ? normalizeCommunitySettings(Object.fromEntries(PROFILE_SETTING_FIELDS.map((field) => [field, field === "followers_visibility" ? row[field] : asBool(row[field])])))
    : defaultCommunitySettings();
  return Object.freeze({
    schema_version: COMMUNITY_PROFILE_SCHEMA,
    username,
    username_required: !username,
    profile_url: username && settings.public_profile_enabled ? `https://ravenos.xyz/@${username}` : null,
    settings,
    profile_revision: exists ? Number(row.profile_revision) : 0,
    settings_digest: exists ? text(row.settings_digest, 180) : null,
    created_at: exists ? iso(row.profile_created_at) : null,
    updated_at: exists ? iso(row.profile_updated_at) : null,
  });
}

function publicEvidence(row) {
  if (!row) return null;
  const activePeriods = row.active_periods === null || row.active_periods === undefined ? null : Number(row.active_periods);
  const profitablePeriods = row.profitable_periods === null || row.profitable_periods === undefined ? null : Number(row.profitable_periods);
  return Object.freeze({
    schema_version: COMMUNITY_PERFORMANCE_SCHEMA,
    period: row.period,
    classification: row.observation_type,
    evidence_state: row.evidence_state,
    observed_from: iso(row.observed_from),
    observed_through: iso(row.observed_through),
    sample_count: Number(row.sample_count),
    evidence_confidence_pct: Number(row.evidence_confidence_pct),
    return_pct: row.return_pct === null ? null : Number(row.return_pct),
    maximum_drawdown_pct: row.maximum_drawdown_pct === null ? null : Number(row.maximum_drawdown_pct),
    profit_factor: row.profit_factor === null ? null : Number(row.profit_factor),
    profitable_periods: profitablePeriods,
    active_periods: activePeriods,
    profitable_period_share_pct: activePeriods > 0 && profitablePeriods !== null
      ? Number(((profitablePeriods / activePeriods) * 100).toFixed(2))
      : null,
    top_1_profit_concentration_pct: row.top_1_profit_concentration_pct === null ? null : Number(row.top_1_profit_concentration_pct),
    copyability_score: row.copyability_score === null ? null : Number(row.copyability_score),
    follower_capture_pct: row.follower_capture_pct === null ? null : Number(row.follower_capture_pct),
    provenance: Object.freeze({
      source_contract_id: row.source_contract_id,
      source_reference_digest: row.source_reference_digest,
      record_digest: row.record_digest,
    }),
  });
}

function publicProfile(row, evidenceRows = []) {
  if (!row) return null;
  const followersVisible = row.followers_visibility === "public";
  const performanceVisible = asBool(row.performance_visible);
  return Object.freeze({
    schema_version: COMMUNITY_PROFILE_SCHEMA,
    username: text(row.username, 24).toLowerCase(),
    profile_url: `https://ravenos.xyz/@${text(row.username, 24).toLowerCase()}`,
    member_since: iso(row.member_since),
    public_disclosures: Object.freeze({
      performance: performanceVisible,
      positions: asBool(row.positions_visible),
      trade_history: asBool(row.trade_history_visible),
      strategy_breakdown: asBool(row.strategy_breakdown_visible),
      wallet_addresses: asBool(row.wallet_addresses_visible),
      followers: followersVisible,
    }),
    availability: Object.freeze({
      following: asBool(row.allow_following),
      shadowing: asBool(row.allow_shadowing),
      raven_copy: asBool(row.allow_raven_copy),
      public_referral_link: asBool(row.referral_link_public),
    }),
    followers_count: followersVisible ? Number(row.followers_count || 0) : null,
    useful_count: Number(row.useful_count || 0),
    performance: performanceVisible ? evidenceRows.map(publicEvidence) : [],
    boundaries: Object.freeze({
      account_balance_public: false,
      connected_account_identifiers_public: false,
      email_public: false,
      legal_name_public: false,
      wallet_addresses_default_public: false,
      popularity_affects_performance_rank: false,
    }),
  });
}

export async function createCommunityPerformanceEvidence(input = {}, { now = Math.floor(Date.now() / 1_000) } = {}) {
  const allowed = new Set([
    "evidence_id", "user_id", "period", "observation_type", "evidence_state", "source_contract_id",
    "source_reference_digest", "observed_from", "observed_through", "sample_count", "evidence_confidence_pct",
    "return_pct", "maximum_drawdown_pct", "profit_factor", "profitable_periods", "active_periods",
    "top_1_profit_concentration_pct", "copyability_score", "follower_capture_pct", "supersedes_evidence_id",
  ]);
  const source = exactObject(input, allowed, "community_performance_evidence_invalid");
  const period = text(source.period, 24).toLowerCase();
  const observationType = text(source.observation_type, 48).toLowerCase();
  const evidenceState = text(source.evidence_state, 40).toLowerCase();
  if (!PERIODS.has(period)) throw new CommunityError("period_invalid");
  if (!OBSERVATION_TYPES.has(observationType)) throw new CommunityError("observation_type_invalid");
  if (!EVIDENCE_STATES.has(evidenceState)) throw new CommunityError("evidence_state_invalid");
  const observedFrom = integer(source.observed_from, "observed_from", { minimum: 0, maximum: 8_640_000_000_000 });
  const observedThrough = integer(source.observed_through, "observed_through", { minimum: observedFrom, maximum: 8_640_000_000_000 });
  const profitablePeriods = integer(source.profitable_periods, "profitable_periods", { minimum: 0, maximum: 1_000_000, nullable: true });
  const activePeriods = integer(source.active_periods, "active_periods", { minimum: 0, maximum: 1_000_000, nullable: true });
  if (activePeriods !== null && profitablePeriods !== null && profitablePeriods > activePeriods) throw new CommunityError("profitable_periods_invalid");
  const record = {
    schema_version: COMMUNITY_PERFORMANCE_SCHEMA,
    evidence_id: text(source.evidence_id, 100) || randomOpaqueId("cpe_", 18),
    user_id: text(source.user_id, 100),
    period,
    observation_type: observationType,
    evidence_state: evidenceState,
    source_contract_id: cleanContract(source.source_contract_id),
    source_reference_digest: cleanDigest(source.source_reference_digest, "source_reference_digest"),
    observed_from: observedFrom,
    observed_through: observedThrough,
    sample_count: integer(source.sample_count, "sample_count", { minimum: 0, maximum: 100_000_000 }),
    evidence_confidence_pct: finite(source.evidence_confidence_pct, "evidence_confidence_pct", { minimum: 0, maximum: 100 }),
    return_pct: finite(source.return_pct, "return_pct", { minimum: -1_000_000_000, maximum: 1_000_000_000, nullable: true }),
    maximum_drawdown_pct: finite(source.maximum_drawdown_pct, "maximum_drawdown_pct", { minimum: 0, maximum: 1_000_000_000, nullable: true }),
    profit_factor: finite(source.profit_factor, "profit_factor", { minimum: 0, maximum: 1_000_000_000, nullable: true }),
    profitable_periods: profitablePeriods,
    active_periods: activePeriods,
    top_1_profit_concentration_pct: finite(source.top_1_profit_concentration_pct, "top_1_profit_concentration_pct", { minimum: 0, maximum: 100, nullable: true }),
    copyability_score: finite(source.copyability_score, "copyability_score", { minimum: 0, maximum: 100, nullable: true }),
    follower_capture_pct: finite(source.follower_capture_pct, "follower_capture_pct", { minimum: -1_000_000_000, maximum: 1_000_000_000, nullable: true }),
    supersedes_evidence_id: text(source.supersedes_evidence_id, 100) || null,
    created_at: integer(now, "created_at", { minimum: 0, maximum: 8_640_000_000_000 }),
  };
  if (!record.user_id) throw new CommunityError("user_id_invalid");
  if (!/^cpe_[A-Za-z0-9_-]{12,96}$/.test(record.evidence_id)) throw new CommunityError("evidence_id_invalid");
  if (record.supersedes_evidence_id && !/^cpe_[A-Za-z0-9_-]{12,96}$/.test(record.supersedes_evidence_id)) throw new CommunityError("supersedes_evidence_id_invalid");
  const digestPayload = JSON.stringify(record);
  return Object.freeze({ ...record, record_digest: await sha256(digestPayload) });
}

export function createD1CustomerCommunityStore(db) {
  return {
    async getOwnProfile(userId) {
      return db.prepare(`
        SELECT u.username, u.created_at AS member_since,
               p.public_profile_enabled, p.performance_visible, p.positions_visible, p.trade_history_visible,
               p.strategy_breakdown_visible, p.wallet_addresses_visible, p.followers_visibility,
               p.allow_following, p.allow_shadowing, p.allow_raven_copy, p.referral_link_public,
               p.profile_revision, p.settings_digest, p.created_at AS profile_created_at, p.updated_at AS profile_updated_at
        FROM ravenos_users u
        LEFT JOIN ravenos_community_profiles p ON p.user_id = u.user_id
        WHERE u.user_id = ? AND u.state = 'active' LIMIT 1
      `).bind(userId).first();
    },

    async saveOwnProfile({ user_id: userId, settings, settings_digest: digest, expected_revision: expectedRevision, now }) {
      const values = PROFILE_SETTING_FIELDS.map((field) => field === "followers_visibility" ? settings[field] : Number(settings[field]));
      const result = await db.prepare(`
        INSERT INTO ravenos_community_profiles (
          user_id, public_profile_enabled, performance_visible, positions_visible, trade_history_visible,
          strategy_breakdown_visible, wallet_addresses_visible, followers_visibility, allow_following,
          allow_shadowing, allow_raven_copy, referral_link_public, profile_revision, settings_digest, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
        FROM ravenos_users
        WHERE user_id = ? AND state = 'active' AND username IS NOT NULL
          AND (? IS NULL OR ? = 0)
        ON CONFLICT(user_id) DO UPDATE SET
          public_profile_enabled = excluded.public_profile_enabled,
          performance_visible = excluded.performance_visible,
          positions_visible = excluded.positions_visible,
          trade_history_visible = excluded.trade_history_visible,
          strategy_breakdown_visible = excluded.strategy_breakdown_visible,
          wallet_addresses_visible = excluded.wallet_addresses_visible,
          followers_visibility = excluded.followers_visibility,
          allow_following = excluded.allow_following,
          allow_shadowing = excluded.allow_shadowing,
          allow_raven_copy = excluded.allow_raven_copy,
          referral_link_public = excluded.referral_link_public,
          profile_revision = ravenos_community_profiles.profile_revision + 1,
          settings_digest = excluded.settings_digest,
          updated_at = excluded.updated_at
        WHERE ? IS NULL OR ravenos_community_profiles.profile_revision = ?
        RETURNING *
      `).bind(
        userId, ...values, digest, now, now, userId,
        expectedRevision, expectedRevision,
        expectedRevision, expectedRevision,
      ).first();
      if (!result) {
        const identity = await db.prepare("SELECT username FROM ravenos_users WHERE user_id = ? AND state = 'active' LIMIT 1").bind(userId).first();
        if (!identity?.username) throw new CommunityError("username_required", 409);
        throw new CommunityError("community_profile_revision_conflict", 409);
      }
      return this.getOwnProfile(userId);
    },

    async getPublicProfile(username) {
      return db.prepare(`
        SELECT u.user_id, u.username, u.created_at AS member_since, p.*,
          (SELECT COUNT(*) FROM ravenos_community_follows f WHERE f.followed_user_id = u.user_id) AS followers_count,
          (SELECT COUNT(*) FROM ravenos_community_recognitions r WHERE r.recognized_user_id = u.user_id AND r.recognition_kind = 'useful') AS useful_count
        FROM ravenos_users u
        JOIN ravenos_community_profiles p ON p.user_id = u.user_id
        WHERE lower(u.username) = lower(?) AND u.state = 'active' AND p.public_profile_enabled = 1
        LIMIT 1
      `).bind(username).first();
    },

    async listCurrentEvidence(userId) {
      const result = await db.prepare(`
        SELECT e.* FROM ravenos_community_performance_evidence e
        WHERE e.user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_community_performance_evidence newer
            WHERE newer.user_id = e.user_id AND newer.period = e.period
              AND newer.observation_type = e.observation_type
              AND (newer.created_at > e.created_at OR (newer.created_at = e.created_at AND newer.evidence_id > e.evidence_id))
          )
        ORDER BY CASE e.period WHEN '30d' THEN 1 WHEN '90d' THEN 2 WHEN '1y' THEN 3 ELSE 4 END,
          CASE e.observation_type
            WHEN 'raven_observed' THEN 1
            WHEN 'connected_account_observed' THEN 2
            WHEN 'historically_reconstructed' THEN 3
            WHEN 'prospective' THEN 4
            WHEN 'simulated' THEN 5
            ELSE 6
          END
      `).bind(userId).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async listFollowing(userId, limit) {
      const result = await db.prepare(`
        SELECT u.username, u.created_at AS member_since, p.*,
          (SELECT COUNT(*) FROM ravenos_community_follows count_followers WHERE count_followers.followed_user_id = u.user_id) AS followers_count,
          (SELECT COUNT(*) FROM ravenos_community_recognitions r WHERE r.recognized_user_id = u.user_id AND r.recognition_kind = 'useful') AS useful_count,
          f.notification_level, f.created_at AS followed_at
        FROM ravenos_community_follows f
        JOIN ravenos_users u ON u.user_id = f.followed_user_id
        JOIN ravenos_community_profiles p ON p.user_id = u.user_id
        WHERE f.follower_user_id = ? AND u.state = 'active' AND p.public_profile_enabled = 1
        ORDER BY f.updated_at DESC, lower(u.username) ASC LIMIT ?
      `).bind(userId, limit).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async resolveTarget(username) {
      return db.prepare(`
        SELECT u.user_id, u.username, p.public_profile_enabled, p.allow_following
        FROM ravenos_users u JOIN ravenos_community_profiles p ON p.user_id = u.user_id
        WHERE lower(u.username) = lower(?) AND u.state = 'active' LIMIT 1
      `).bind(username).first();
    },

    async setFollow({ actor_user_id: actorUserId, target_user_id: targetUserId, enabled, now }) {
      if (enabled) {
        await db.prepare(`
          INSERT INTO ravenos_community_follows (follower_user_id, followed_user_id, notification_level, created_at, updated_at)
          VALUES (?, ?, 'meaningful', ?, ?)
          ON CONFLICT(follower_user_id, followed_user_id) DO UPDATE SET updated_at = excluded.updated_at
        `).bind(actorUserId, targetUserId, now, now).run();
        return true;
      }
      const result = await db.prepare("DELETE FROM ravenos_community_follows WHERE follower_user_id = ? AND followed_user_id = ?")
        .bind(actorUserId, targetUserId).run();
      return Number(result?.meta?.changes || 0) > 0;
    },

    async setRecognition({ actor_user_id: actorUserId, target_user_id: targetUserId, enabled, now }) {
      if (enabled) {
        await db.prepare(`
          INSERT INTO ravenos_community_recognitions (actor_user_id, recognized_user_id, recognition_kind, created_at)
          VALUES (?, ?, 'useful', ?)
          ON CONFLICT(actor_user_id, recognized_user_id, recognition_kind) DO NOTHING
        `).bind(actorUserId, targetUserId, now).run();
        return true;
      }
      const result = await db.prepare(`
        DELETE FROM ravenos_community_recognitions
        WHERE actor_user_id = ? AND recognized_user_id = ? AND recognition_kind = 'useful'
      `).bind(actorUserId, targetUserId).run();
      return Number(result?.meta?.changes || 0) > 0;
    },

    async listBoard(board, limit) {
      if (board.id === "most_followed") {
        const result = await db.prepare(`
          SELECT u.username, u.created_at AS member_since, p.*,
            COUNT(f.follower_user_id) AS followers_count,
            (SELECT COUNT(*) FROM ravenos_community_recognitions r WHERE r.recognized_user_id = u.user_id AND r.recognition_kind = 'useful') AS useful_count
          FROM ravenos_users u
          JOIN ravenos_community_profiles p ON p.user_id = u.user_id
          LEFT JOIN ravenos_community_follows f ON f.followed_user_id = u.user_id
          WHERE u.state = 'active' AND p.public_profile_enabled = 1 AND p.followers_visibility = 'public'
          GROUP BY u.user_id
          ORDER BY followers_count DESC, lower(u.username) ASC LIMIT ?
        `).bind(limit).all();
        return Array.isArray(result?.results) ? result.results : [];
      }

      const sort = board.id === "most_consistent"
        ? "CAST(e.profitable_periods AS REAL) / NULLIF(e.active_periods, 0) DESC, e.evidence_confidence_pct DESC, e.sample_count DESC"
        : board.id === "lowest_drawdown"
          ? "e.maximum_drawdown_pct ASC, e.evidence_confidence_pct DESC, e.sample_count DESC"
          : board.id === "most_copyable"
            ? "e.copyability_score DESC, e.evidence_confidence_pct DESC, e.sample_count DESC"
            : "e.evidence_confidence_pct DESC, e.sample_count DESC";
      const requiredMetric = board.id === "most_consistent" ? "AND e.active_periods >= ? AND e.profitable_periods IS NOT NULL"
        : board.id === "lowest_drawdown" ? "AND e.active_periods >= ? AND e.maximum_drawdown_pct IS NOT NULL"
          : board.id === "most_copyable" ? "AND e.copyability_score IS NOT NULL AND e.observation_type = 'prospective'"
            : "";
      const eligibleTypes = board.id === "most_copyable"
        ? "e.observation_type = 'prospective'"
        : "e.observation_type IN ('raven_observed', 'connected_account_observed', 'historically_reconstructed')";
      const bindings = [board.period, board.minimum_sample_count, board.minimum_confidence_pct];
      if (board.id === "most_consistent" || board.id === "lowest_drawdown") bindings.push(board.minimum_active_periods);
      bindings.push(limit);
      const result = await db.prepare(`
        WITH current_evidence AS (
          SELECT e.*,
            ROW_NUMBER() OVER (
              PARTITION BY e.user_id
              ORDER BY CASE e.observation_type
                WHEN 'raven_observed' THEN 1
                WHEN 'connected_account_observed' THEN 2
                WHEN 'historically_reconstructed' THEN 3
                WHEN 'prospective' THEN 4
                ELSE 5
              END,
              e.created_at DESC,
              e.evidence_id DESC
            ) AS user_rank
          FROM ravenos_community_performance_evidence e
          WHERE e.period = ? AND e.evidence_state = 'available'
            AND ${eligibleTypes}
            AND e.sample_count >= ? AND e.evidence_confidence_pct >= ?
            ${requiredMetric}
            AND NOT EXISTS (
              SELECT 1 FROM ravenos_community_performance_evidence newer
              WHERE newer.user_id = e.user_id AND newer.period = e.period
                AND newer.observation_type = e.observation_type
                AND (newer.created_at > e.created_at OR (newer.created_at = e.created_at AND newer.evidence_id > e.evidence_id))
            )
        )
        SELECT u.username, u.created_at AS member_since, p.*,
          (SELECT COUNT(*) FROM ravenos_community_follows f WHERE f.followed_user_id = u.user_id) AS followers_count,
          (SELECT COUNT(*) FROM ravenos_community_recognitions r WHERE r.recognized_user_id = u.user_id AND r.recognition_kind = 'useful') AS useful_count,
          e.*
        FROM current_evidence e
        JOIN ravenos_users u ON u.user_id = e.user_id
        JOIN ravenos_community_profiles p ON p.user_id = u.user_id
        WHERE e.user_rank = 1
          AND p.public_profile_enabled = 1 AND p.performance_visible = 1 AND u.state = 'active'
        ORDER BY ${sort}, lower(u.username) ASC LIMIT ?
      `).bind(...bindings).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async insertEvidence(record) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_community_performance_evidence (
          evidence_id, user_id, period, observation_type, evidence_state, source_contract_id,
          source_reference_digest, observed_from, observed_through, sample_count, evidence_confidence_pct,
          return_pct, maximum_drawdown_pct, profit_factor, profitable_periods, active_periods,
          top_1_profit_concentration_pct, copyability_score, follower_capture_pct, supersedes_evidence_id,
          record_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.evidence_id, record.user_id, record.period, record.observation_type, record.evidence_state,
        record.source_contract_id, record.source_reference_digest, record.observed_from, record.observed_through,
        record.sample_count, record.evidence_confidence_pct, record.return_pct, record.maximum_drawdown_pct,
        record.profit_factor, record.profitable_periods, record.active_periods, record.top_1_profit_concentration_pct,
        record.copyability_score, record.follower_capture_pct, record.supersedes_evidence_id, record.record_digest,
        record.created_at,
      ).run();
      return Number(result?.meta?.changes || 0) === 1;
    },

    async recordAudit(event) {
      await db.prepare(`
        INSERT INTO ravenos_community_audit_events (
          event_id, user_id, event_type, subject_user_id, prior_settings_digest,
          current_settings_digest, reason_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        randomOpaqueId("cae_", 18), event.user_id, event.event_type, event.subject_user_id || null,
        event.prior_settings_digest || null, event.current_settings_digest || null, event.reason_code, event.created_at,
      ).run();
    },
  };
}

function routeMatch(pathname) {
  if (pathname === `${CUSTOMER_COMMUNITY_ROUTE}/me`) return { kind: "me" };
  if (pathname === `${CUSTOMER_COMMUNITY_ROUTE}/following`) return { kind: "following" };
  if (pathname === `${CUSTOMER_COMMUNITY_ROUTE}/boards`) return { kind: "boards" };
  const profile = pathname.match(/^\/api\/v1\/community\/profiles\/([^/]+)$/);
  if (profile) return { kind: "profile", username: profile[1] };
  const follow = pathname.match(/^\/api\/v1\/community\/profiles\/([^/]+)\/follow$/);
  if (follow) return { kind: "follow", username: follow[1] };
  const recognition = pathname.match(/^\/api\/v1\/community\/profiles\/([^/]+)\/recognitions\/useful$/);
  if (recognition) return { kind: "recognition", username: recognition[1] };
  return null;
}

function allowedMethod(route, method) {
  if (route.kind === "me") return new Set(["GET", "PUT"]).has(method);
  if (route.kind === "following" || route.kind === "boards" || route.kind === "profile") return method === "GET";
  return new Set(["PUT", "DELETE"]).has(method);
}

async function body(request) {
  try {
    return await parseBoundedJsonBody(request, { max_bytes: CommunityLimits.maximum_request_bytes });
  } catch (error) {
    if (error?.code === "request_too_large") throw new CommunityError("community_request_too_large", 413);
    throw new CommunityError("community_request_invalid");
  }
}

async function authorize(request, env, deps, mutation) {
  const fn = deps.authorizeRequest || authorizeCustomerApiRequest;
  return fn(request, env, deps, { require_csrf: mutation });
}

async function rateLimit(authorization, env, request, action) {
  return consumeCustomerRateLimit({
    store: authorization.store,
    env,
    request,
    action: `community_${action}`,
    scope: "user",
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: 15 * 60,
    limit: CommunityLimits.mutation_requests_per_15_minutes,
  });
}

function storeFor(env, deps) {
  return deps.store || createD1CustomerCommunityStore(env.RAVENOS_CUSTOMER_DB);
}

function errorResponse(error, authorization = null) {
  const code = error instanceof CommunityError ? error.code : "community_unavailable";
  const status = error instanceof CommunityError ? error.status : 503;
  return json({ ok: false, schema_version: CUSTOMER_COMMUNITY_SCHEMA, error: code }, {
    status,
    headers: authorization?.response_headers || {},
  });
}

function boardEntry(row, rank, board) {
  return Object.freeze({
    rank,
    username: text(row.username, 24).toLowerCase(),
    profile_url: `https://ravenos.xyz/@${text(row.username, 24).toLowerCase()}`,
    member_since: iso(row.member_since),
    followers_count: row.followers_visibility === "public" ? Number(row.followers_count || 0) : null,
    useful_count: Number(row.useful_count || 0),
    evidence: board.id === "most_followed" ? null : publicEvidence(row),
    ranking_basis: board.ranking_basis,
  });
}

export async function routeCustomerCommunity(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const route = routeMatch(url.pathname);
  if (!route) return null;
  if (!allowedMethod(route, request.method)) return json({ ok: false, schema_version: CUSTOMER_COMMUNITY_SCHEMA, error: "method_not_allowed" }, { status: 405 });
  const runtime = resolveCommunityRuntime(env, deps);
  if (!runtime.enabled) return json({ ok: false, schema_version: CUSTOMER_COMMUNITY_SCHEMA, error: runtime.reason, state: runtime.state }, { status: 503 });
  const store = storeFor(env, deps);
  let authorization = null;
  try {
    if (route.kind === "profile") {
      const username = communityUsername(route.username);
      const row = await store.getPublicProfile(username);
      if (!row) throw new CommunityError("community_profile_not_found", 404);
      const evidence = asBool(row.performance_visible) ? await store.listCurrentEvidence(row.user_id) : [];
      return json({ ok: true, schema_version: CUSTOMER_COMMUNITY_SCHEMA, profile: publicProfile(row, evidence) }, {
        cache: "public, max-age=30, stale-while-revalidate=60",
      });
    }

    if (route.kind === "boards") {
      const boardId = text(url.searchParams.get("board") || "most_consistent", 40).toLowerCase();
      const board = CommunityBoardDefinitions[boardId];
      if (!board) throw new CommunityError("community_board_invalid");
      const limit = integer(url.searchParams.get("limit") || 20, "limit", { minimum: 1, maximum: CommunityLimits.maximum_board_rows });
      const rows = await store.listBoard(board, limit);
      return json({
        ok: true,
        schema_version: CUSTOMER_COMMUNITY_SCHEMA,
        board,
        state: rows.length ? "available" : "insufficient_evidence",
        rows: rows.map((row, index) => boardEntry(row, index + 1, board)),
        boundaries: {
          popularity_affects_performance_rank: false,
          user_reported_eligible: false,
          public_balance_used: false,
          deterministic_tie_breaker: "username_ascending",
        },
      }, { cache: "public, max-age=30, stale-while-revalidate=60" });
    }

    const mutation = request.method !== "GET";
    authorization = await authorize(request, env, deps, mutation);
    if (authorization.response) return authorization.response;
    const userId = authorization.principal.user_id;

    if (route.kind === "me" && request.method === "GET") {
      return json({ ok: true, schema_version: CUSTOMER_COMMUNITY_SCHEMA, profile: ownProfile(await store.getOwnProfile(userId)) }, {
        headers: authorization.response_headers,
      });
    }

    if (route.kind === "me" && request.method === "PUT") {
      const limited = await rateLimit(authorization, env, request, "profile_update");
      if (!limited.allowed) throw new CommunityError("community_rate_limited", 429);
      const payload = exactObject(await body(request), new Set(["settings", "expected_revision"]), "community_profile_request_invalid");
      const settings = normalizeCommunitySettings(payload.settings);
      const expectedRevision = payload.expected_revision === null || payload.expected_revision === undefined
        ? null
        : integer(payload.expected_revision, "expected_revision", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
      const prior = ownProfile(await store.getOwnProfile(userId));
      const digest = await sha256(communitySettingsDigestPayload(settings));
      const saved = ownProfile(await store.saveOwnProfile({ user_id: userId, settings, settings_digest: digest, expected_revision: expectedRevision, now: authorization.now }));
      await store.recordAudit({
        user_id: userId,
        event_type: "community_profile_settings_updated",
        prior_settings_digest: prior?.settings_digest,
        current_settings_digest: saved.settings_digest,
        reason_code: saved.settings.public_profile_enabled ? "user_opted_in" : "user_private",
        created_at: authorization.now,
      });
      return json({ ok: true, schema_version: CUSTOMER_COMMUNITY_SCHEMA, profile: saved }, { headers: authorization.response_headers });
    }

    if (route.kind === "following") {
      const rows = await store.listFollowing(userId, CommunityLimits.maximum_following_rows);
      return json({
        ok: true,
        schema_version: CUSTOMER_COMMUNITY_SCHEMA,
        state: rows.length ? "available" : "empty",
        rows: rows.map((row) => ({
          profile: publicProfile(row, []),
          notification_level: row.notification_level,
          followed_at: iso(row.followed_at),
        })),
      }, { headers: authorization.response_headers });
    }

    const limited = await rateLimit(authorization, env, request, route.kind);
    if (!limited.allowed) throw new CommunityError("community_rate_limited", 429);
    const username = communityUsername(route.username);
    const target = await store.resolveTarget(username);
    if (!target || !asBool(target.public_profile_enabled)) throw new CommunityError("community_profile_not_found", 404);
    if (target.user_id === userId) throw new CommunityError("community_self_action_not_allowed", 409);

    if (route.kind === "follow") {
      if (request.method === "PUT" && !asBool(target.allow_following)) throw new CommunityError("community_following_unavailable", 409);
      const changed = await store.setFollow({ actor_user_id: userId, target_user_id: target.user_id, enabled: request.method === "PUT", now: authorization.now });
      await store.recordAudit({ user_id: userId, event_type: request.method === "PUT" ? "community_profile_followed" : "community_profile_unfollowed", subject_user_id: target.user_id, reason_code: changed ? "user_action" : "idempotent", created_at: authorization.now });
      return json({ ok: true, schema_version: CUSTOMER_COMMUNITY_SCHEMA, username, following: request.method === "PUT" }, { headers: authorization.response_headers });
    }

    const changed = await store.setRecognition({ actor_user_id: userId, target_user_id: target.user_id, enabled: request.method === "PUT", now: authorization.now });
    await store.recordAudit({ user_id: userId, event_type: request.method === "PUT" ? "community_profile_recognized" : "community_profile_recognition_removed", subject_user_id: target.user_id, reason_code: changed ? "user_action" : "idempotent", created_at: authorization.now });
    return json({ ok: true, schema_version: CUSTOMER_COMMUNITY_SCHEMA, username, recognition: request.method === "PUT" ? "useful" : null }, { headers: authorization.response_headers });
  } catch (error) {
    return errorResponse(error, authorization);
  }
}

export const CustomerCommunityContract = Object.freeze({
  schema_version: CUSTOMER_COMMUNITY_SCHEMA,
  route: CUSTOMER_COMMUNITY_ROUTE,
  public_identity: "raven_username",
  public_profile_default: false,
  disclosures_default: "private",
  positive_recognition: "useful",
  comments: false,
  direct_messages: false,
  public_account_balance: false,
  public_wallet_addresses_default: false,
  user_reported_performance_board_eligible: false,
  popularity_affects_performance_rank: false,
  execution_authority: false,
});
