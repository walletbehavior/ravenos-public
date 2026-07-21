export const RAVENOS_RELEASE_SCHEMA = "ravenos.release.v1";
export const RAVENOS_STATIC_ASSET_SCHEMA = "ravenos.static_assets.v1";
export const RAVENOS_DEPLOY_MANIFEST_SCHEMA = "ravenos.deploy.v2";

function text(value) {
  return String(value ?? "").trim();
}

function workerVersion(value = {}) {
  return {
    id: text(value?.id),
    tag: text(value?.tag),
    timestamp: text(value?.timestamp),
  };
}
export function expectedReleaseFromEnv(env = {}) {
  return {
    enforced: text(env.RAVENOS_RELEASE_ENFORCE) === "1",
    release_id: text(env.RAVENOS_RELEASE_ID),
    source_commit: text(env.RAVENOS_SOURCE_COMMIT),
    static_asset_manifest_sha256: text(env.RAVENOS_STATIC_ASSET_MANIFEST_SHA256),
    public_origin_contract_version: text(env.RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION),
  };
}

export function evaluateReleaseCohesion({
  expected = {},
  release = null,
  build = null,
  deploy = null,
  version = null,
} = {}) {
  const normalizedExpected = {
    enforced: Boolean(expected?.enforced),
    release_id: text(expected?.release_id),
    source_commit: text(expected?.source_commit),
    static_asset_manifest_sha256: text(expected?.static_asset_manifest_sha256),
    public_origin_contract_version: text(expected?.public_origin_contract_version),
  };
  const normalizedVersion = workerVersion(version);
  const reasons = [];

  if (!normalizedExpected.enforced) {
    return {
      ok: true,
      enforced: false,
      state: "not_enforced",
      reasons,
      expected: normalizedExpected,
      worker_version: normalizedVersion,
    };
  }

  for (const field of [
    "release_id",
    "source_commit",
    "static_asset_manifest_sha256",
    "public_origin_contract_version",
  ]) {
    if (!normalizedExpected[field]) reasons.push(`expected_${field}_missing`);
  }
  if (!release || typeof release !== "object") reasons.push("release_manifest_missing");
  if (!build || typeof build !== "object") reasons.push("build_manifest_missing");
  if (!deploy || typeof deploy !== "object") reasons.push("deploy_manifest_missing");
  if (!normalizedVersion.id) reasons.push("worker_version_id_missing");

  if (release && typeof release === "object") {
    if (release.schema_version !== RAVENOS_RELEASE_SCHEMA) reasons.push("release_schema_mismatch");
    if (text(release.release_id) !== normalizedExpected.release_id) reasons.push("release_id_mismatch");
    if (text(release.source_commit) !== normalizedExpected.source_commit) reasons.push("release_source_commit_mismatch");
    if (text(release.static_asset_manifest_sha256) !== normalizedExpected.static_asset_manifest_sha256) {
      reasons.push("release_asset_manifest_mismatch");
    }
    if (text(release.public_origin_contract_version) !== normalizedExpected.public_origin_contract_version) {
      reasons.push("release_public_origin_contract_mismatch");
    }
  }

  if (build && typeof build === "object") {
    if (text(build.release_id) !== normalizedExpected.release_id) reasons.push("build_release_id_mismatch");
    if (text(build.source_commit) !== normalizedExpected.source_commit) reasons.push("build_source_commit_mismatch");
    if (text(build.static_asset_manifest_sha256) !== normalizedExpected.static_asset_manifest_sha256) {
      reasons.push("build_asset_manifest_mismatch");
    }
  }

  if (deploy && typeof deploy === "object") {
    if (deploy.schema_version !== RAVENOS_DEPLOY_MANIFEST_SCHEMA) reasons.push("deploy_schema_mismatch");
    if (text(deploy.release_id) !== normalizedExpected.release_id) reasons.push("deploy_release_id_mismatch");
    if (text(deploy.source_commit) !== normalizedExpected.source_commit) reasons.push("deploy_source_commit_mismatch");
    if (text(deploy.static_asset_manifest_sha256) !== normalizedExpected.static_asset_manifest_sha256) {
      reasons.push("deploy_asset_manifest_mismatch");
    }
  }

  if (normalizedVersion.tag && normalizedVersion.tag !== normalizedExpected.release_id) {
    reasons.push("worker_version_tag_mismatch");
  }

  return {
    ok: reasons.length === 0,
    enforced: true,
    state: reasons.length === 0 ? "coherent" : "incoherent",
    reasons: [...new Set(reasons)],
    expected: normalizedExpected,
    worker_version: normalizedVersion,
    worker_version_tag_visibility: normalizedVersion.tag ? "runtime_available" : "external_verification_required",
  };
}
