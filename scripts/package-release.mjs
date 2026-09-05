import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const allowDirty = args.has("--allow-dirty");
const replace = args.has("--replace");
const release = JSON.parse(readFileSync(join(repoRoot, ".deploy-public/ravenos_release.json"), "utf8"));
const deploy = JSON.parse(readFileSync(join(repoRoot, ".deploy-public/ravenos_deploy_manifest.json"), "utf8"));
const baseWrangler = JSON.parse(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"));
const releaseConfig = JSON.parse(readFileSync(join(repoRoot, "config/release.json"), "utf8"));
const customerSecurity = JSON.parse(readFileSync(join(repoRoot, "config/customer_security.json"), "utf8"));
const publicHolderListsActive = customerSecurity.public_holder_lists?.production_activation_completed === true;
const publicEvmHolderListsActive = customerSecurity.public_holder_lists?.evm_candidate_ready_for_activation === true
  && customerSecurity.public_holder_lists?.evm_release_activation_enabled === true;
const communityActive = customerSecurity.community?.release_activation_enabled === true;
const referralsActive = customerSecurity.referrals?.release_activation_enabled === true;
const entitlementResolutionActive = customerSecurity.entitlement_foundation?.resolution_release_enabled === true;
const walletIntelligenceActive = customerSecurity.wallet_copy?.read_only_intelligence_release_enabled === true;
const walletScreenerActive = walletIntelligenceActive
  && customerSecurity.wallet_copy?.read_only_screener_release_enabled === true;
const evmWalletLookupActive = walletIntelligenceActive
  && customerSecurity.wallet_copy?.bounded_on_demand_evm_lookup_release_enabled === true;
const walletObserverActive = walletIntelligenceActive
  && customerSecurity.wallet_copy?.continuous_observer_active === true;
const walletRpcPollActive = walletObserverActive
  && customerSecurity.wallet_copy?.continuous_observer_transport === "bounded_rpc_poll";
const walletCopyabilityActive = walletObserverActive
  && customerSecurity.wallet_copy?.shared_prospective_copyability_matrix_active === true;
const walletCopyabilityCheckpointsActive = walletCopyabilityActive
  && customerSecurity.wallet_copy?.shared_prospective_follower_outcome_checkpoints_active === true;
const walletBackfillActive = walletIntelligenceActive
  && customerSecurity.wallet_copy?.deep_history_backfill_active === true;
const privyJwksBootstrapActive = customerSecurity.privy_wallets?.public_jwks_bootstrap_release_enabled === true;
const privyEvmWalletCanaryActive = privyJwksBootstrapActive
  && customerSecurity.privy_wallets?.dashboard_jwt_configuration_saved === true
  && customerSecurity.privy_wallets?.dashboard_identity_token_return_enabled === true
  && customerSecurity.privy_wallets?.owner_evm_wallet_canary_release_enabled === true
  && customerSecurity.privy_wallets?.owner_evm_wallet_provisioning_enabled === true
  && customerSecurity.privy_wallets?.manual_signing_enabled === false
  && customerSecurity.privy_wallets?.delegated_signing_enabled === false;
const customerLiveExecutionCodeReady = customerSecurity.customer_live_execution_canary?.implementation_status === "owner_canary_code_ready";
const solanaLiveReleaseReady = customerLiveExecutionCodeReady
  && customerSecurity.customer_live_execution_canary?.solana_live_release_activation_ready === true;
const evmLiveReleaseReady = customerLiveExecutionCodeReady
  && customerSecurity.customer_live_execution_canary?.evm_live_release_activation_ready === true;
const releasesRoot = join(repoRoot, ".releases");
const bundleRoot = join(releasesRoot, release.release_id);
const archivePath = join(releasesRoot, `${release.release_id}.tar.gz`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shaFile(path) {
  return sha256(readFileSync(path));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function listFiles(root, prefix = "") {
  const current = prefix ? join(root, prefix) : root;
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const head = git(["rev-parse", "HEAD"]);
const status = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
if (head !== release.source_commit) {
  throw new Error(`Release source commit ${release.source_commit} does not match HEAD ${head}; regenerate first.`);
}
if (status && !allowDirty) {
  throw new Error("Refusing to package a dirty source tree. Commit the release source, regenerate, and retry.");
}
if (release.source_tree_state !== "clean" && !allowDirty) {
  throw new Error(`Refusing release manifest with source_tree_state=${release.source_tree_state}.`);
}
if (existsSync(bundleRoot) && !replace) {
  throw new Error(`Release bundle already exists: ${bundleRoot}. Pass --replace only for an unpromoted local bundle.`);
}
if (existsSync(bundleRoot)) rmSync(bundleRoot, { recursive: true, force: true });
if (existsSync(archivePath) && replace) rmSync(archivePath, { force: true });
mkdirSync(bundleRoot, { recursive: true });

cpSync(join(repoRoot, ".deploy-public"), join(bundleRoot, "assets"), { recursive: true });
cpSync(join(repoRoot, "worker.mjs"), join(bundleRoot, "worker.mjs"));
cpSync(join(repoRoot, "ravenos-chart-data-plane.js"), join(bundleRoot, "ravenos-chart-data-plane.js"));
cpSync(join(repoRoot, "ravenos-discover-intelligence.js"), join(bundleRoot, "ravenos-discover-intelligence.js"));
cpSync(join(repoRoot, "lib"), join(bundleRoot, "lib"), { recursive: true });

const chartProviderConfig = releaseConfig.onchain_chart_provider || {};
const productionChartProvider = chartProviderConfig.production_promotion_eligible === true;
const runtimeChartProvider = productionChartProvider ? chartProviderConfig.production_provider : chartProviderConfig.preview_provider;
const runtimeChartPlan = productionChartProvider ? chartProviderConfig.production_provider_plan : chartProviderConfig.preview_provider_plan;
const runtimeChartCommercial = productionChartProvider ? chartProviderConfig.production_provider_commercial : chartProviderConfig.preview_provider_commercial;
const dexchProviderConfig = releaseConfig.dexch_discovery_provider || {};
const productionDexchProvider = dexchProviderConfig.production_promotion_eligible === true
  && dexchProviderConfig.production_enabled === true
  && dexchProviderConfig.commercial_use_acknowledged === true;

const releaseWrangler = {
  name: baseWrangler.name,
  main: "worker.mjs",
  compatibility_date: baseWrangler.compatibility_date,
  preview_urls: true,
  keep_vars: true,
  observability: baseWrangler.observability,
  assets: {
    binding: "ASSETS",
    directory: "assets",
    run_worker_first: true,
  },
  version_metadata: {
    binding: "CF_VERSION_METADATA",
  },
  triggers: baseWrangler.triggers || {},
  d1_databases: baseWrangler.d1_databases || [],
  routes: baseWrangler.routes,
  compatibility_flags: baseWrangler.compatibility_flags,
  vars: {
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_RELEASE_ID: release.release_id,
    RAVENOS_SOURCE_COMMIT: release.source_commit,
    RAVENOS_STATIC_ASSET_MANIFEST_SHA256: release.static_asset_manifest_sha256,
    RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION: release.public_origin_contract_version,
    RAVENOS_PUBLIC_ORIGIN_URL: releaseConfig.public_origin.base_url,
    RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS: String(releaseConfig.public_origin.request_timeout_ms),
    RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: (chartProviderConfig.evaluation_provider_order || []).join(","),
    RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER: chartProviderConfig.production_provider || "",
    RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED: productionChartProvider ? "1" : "0",
    ONCHAIN_CHART_PROVIDER: runtimeChartProvider || "",
    ONCHAIN_CHART_PROVIDER_PLAN: runtimeChartPlan || "",
    ONCHAIN_CHART_PROVIDER_COMMERCIAL: String(runtimeChartCommercial === true),
    RAVENOS_DEXCH_DISCOVERY_ENABLED: productionDexchProvider ? "1" : "0",
    RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: productionDexchProvider ? "1" : "0",
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: customerSecurity.customer_capabilities_enabled === true ? "1" : "0",
    RAVENOS_COMMUNITY_ENABLED: communityActive ? "1" : "0",
    RAVENOS_REFERRALS_ENABLED: referralsActive ? "1" : "0",
    RAVENOS_REFERRAL_BILLING_RECONCILIATION_ENABLED: "0",
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: entitlementResolutionActive ? "1" : "0",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: walletIntelligenceActive ? "1" : "0",
    RAVENOS_WALLET_COPY_ROUTES_ENABLED: walletIntelligenceActive ? "1" : "0",
    RAVENOS_WALLET_SCREENER_ENABLED: walletScreenerActive ? "1" : "0",
    RAVENOS_SHADOW_COPY_ENABLED: customerSecurity.wallet_copy?.shadow_copy_release_enabled === true ? "1" : "0",
    RAVENOS_WALLET_OBSERVER_ENABLED: walletObserverActive ? "1" : "0",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: walletObserverActive ? "1" : "0",
    RAVENOS_WALLET_RPC_POLL_ENABLED: walletRpcPollActive ? "1" : "0",
    RAVENOS_WALLET_RPC_POLL_MAXIMUM_WALLETS: String(customerSecurity.wallet_copy?.continuous_observer_maximum_wallets_per_run || 50),
    RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED: walletCopyabilityActive ? "1" : "0",
    RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED: walletCopyabilityCheckpointsActive ? "1" : "0",
    RAVENOS_WALLET_BACKFILL_ENABLED: walletBackfillActive ? "1" : "0",
    RAVENOS_EVM_WALLET_LOOKUP_ENABLED: evmWalletLookupActive ? "1" : "0",
    RAVENOS_LIVE_COPY_ENABLED: "0",
    RAVENOS_COPY_FEE_COLLECTION_ENABLED: "0",
    RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: publicHolderListsActive ? "1" : "0",
    RAVENOS_PUBLIC_EVM_HOLDERS_ENABLED: publicEvmHolderListsActive ? "1" : "0",
    RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED: baseWrangler.vars?.RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED === "1" ? "1" : "0",
    RAVENOS_SHADOW_LEDGER_ENABLED: baseWrangler.vars?.RAVENOS_SHADOW_LEDGER_ENABLED === "1" ? "1" : "0",
    RAVENOS_AUTH_ORIGIN: customerSecurity.origins?.authenticated_candidate || "https://app.ravenos.xyz",
    RAVENOS_AUTH_REDIRECT_URI: `${customerSecurity.origins?.authenticated_candidate || "https://app.ravenos.xyz"}/api/v1/auth/callback`,
    RAVENOS_PRIVY_ENABLED: privyEvmWalletCanaryActive ? "1" : "0",
    RAVENOS_PRIVY_WALLETS_ENABLED: privyEvmWalletCanaryActive ? "1" : "0",
    RAVENOS_PRIVY_EVM_ENABLED: privyEvmWalletCanaryActive ? "1" : "0",
    RAVENOS_PRIVY_SOLANA_ENABLED: "0",
    RAVENOS_PRIVY_MANUAL_SIGNING_ENABLED: "0",
    RAVENOS_PRIVY_DELEGATED_SIGNING_ENABLED: "0",
    RAVENOS_PRIVY_DEFAULT_WALLET_ONBOARDING: "0",
  },
};
writeFileSync(join(bundleRoot, "wrangler.release.jsonc"), `${JSON.stringify(releaseWrangler, null, 2)}\n`, "utf8");

const packagedFiles = listFiles(bundleRoot).sort();
const fileHashes = Object.fromEntries(packagedFiles.map((file) => [file, shaFile(join(bundleRoot, file))]));
const packageContentSha256 = sha256(JSON.stringify(stableObject(fileHashes)));
const packageManifest = {
  schema_version: "ravenos.release_package.v1",
  release_id: release.release_id,
  source_commit: release.source_commit,
  source_tree_state: status ? "dirty" : "clean",
  packaged_at: new Date().toISOString(),
  package_content_sha256: packageContentSha256,
  static_asset_manifest_sha256: release.static_asset_manifest_sha256,
  artifact_content_sha256: deploy.artifact_content_sha256,
  public_origin_contract_version: release.public_origin_contract_version,
  onchain_chart_provider: releaseConfig.onchain_chart_provider,
  dexch_discovery_provider: releaseConfig.dexch_discovery_provider,
  public_evm_holder_lists_enabled: publicEvmHolderListsActive,
  evm_wallet_lookup_enabled: evmWalletLookupActive,
  privy_jwks_bootstrap_enabled: privyJwksBootstrapActive,
  privy_evm_wallet_canary_enabled: privyEvmWalletCanaryActive,
  worker_name: baseWrangler.name,
  cron_schedules: Array.isArray(baseWrangler.triggers?.crons) ? baseWrangler.triggers.crons : [],
  required_server_secret_bindings: [
    "RAVENOS_PUBLIC_ORIGIN_TOKEN",
    "RAVENOS_SPOT_CHART_ORIGIN_TOKEN",
    chartProviderConfig.provider_secret_binding || "ONCHAIN_CHART_PROVIDER_SECRET",
    "JUPITER_API_KEY",
    ...(publicHolderListsActive ? ["RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL"] : []),
    ...(publicEvmHolderListsActive || evmWalletLookupActive ? ["BLOCKSCOUT_API_KEY"] : []),
    ...(customerSecurity.customer_capabilities_enabled === true
      ? ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "RAVENOS_AUTH_HASH_PEPPER"]
      : []),
    ...(privyEvmWalletCanaryActive
      ? [
          "RAVENOS_PRIVY_APP_ID",
          "RAVENOS_PRIVY_CLIENT_ID",
          "RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK",
          "RAVENOS_PRIVY_CUSTOM_AUTH_PRIVATE_JWK",
          "RAVENOS_PRIVY_IDENTITY_JWKS",
          "RAVENOS_PRIVY_WALLET_USERS",
        ]
      : privyJwksBootstrapActive ? ["RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK"] : []),
    ...(evmLiveReleaseReady
      ? [
          "RAVENOS_CUSTOMER_TRADE_ROBINHOOD_LIVE_ENABLE",
          "RAVENOS_CUSTOMER_TRADE_BSC_LIVE_ENABLE",
          "RAVENOS_CUSTOMER_TRADE_BASE_LIVE_ENABLE",
          "RAVENOS_CUSTOMER_TRADE_ETHEREUM_LIVE_ENABLE",
          "RAVENOS_EVM_FEE_COLLECTOR_ADDRESS",
          "RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENABLE",
          "RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE",
          "RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT",
          "RAVENOS_BSC_ZEROX_QUOTE_ENABLE",
          "RAVENOS_BSC_ZEROX_FEE_ENABLE",
          "RAVENOS_BSC_ZEROX_FEE_RECIPIENT",
          "RAVENOS_BSC_RPC_URL",
          "RAVENOS_BSC_RPC_FALLBACK_URL",
          "RAVENOS_BASE_ZEROX_QUOTE_ENABLE",
          "RAVENOS_BASE_ZEROX_FEE_ENABLE",
          "RAVENOS_BASE_ZEROX_FEE_RECIPIENT",
          "RAVENOS_BASE_RPC_URL",
          "RAVENOS_BASE_RPC_FALLBACK_URL",
          "RAVENOS_ETHEREUM_ZEROX_QUOTE_ENABLE",
          "RAVENOS_ETHEREUM_ZEROX_FEE_ENABLE",
          "RAVENOS_ETHEREUM_ZEROX_FEE_RECIPIENT",
          "RAVENOS_ETHEREUM_RPC_URL",
          "RAVENOS_ETHEREUM_RPC_FALLBACK_URL",
          "RAVENOS_ZEROX_API_KEY",
        ]
      : []),
    ...(solanaLiveReleaseReady
      ? [
          "RAVENOS_CUSTOMER_TRADE_SOLANA_LIVE_ENABLE",
          "RAVENOS_SOLANA_FEE_COLLECTOR_ADDRESS",
          "RAVENOS_SOLANA_JUPITER_REFERRAL_ACCOUNT",
          "RAVENOS_SOLANA_JUPITER_FEE_ENABLE",
        ]
      : []),
  ],
  promotion_requires_explicit_authorization: true,
  rebuild_after_staging_permitted: false,
  files: fileHashes,
};
writeFileSync(join(bundleRoot, "release-package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");

const checksumFiles = [...listFiles(bundleRoot).sort()];
const checksums = checksumFiles.map((file) => `${shaFile(join(bundleRoot, file))}  ${file}`).join("\n") + "\n";
writeFileSync(join(bundleRoot, "SHA256SUMS"), checksums, "utf8");

mkdirSync(dirname(archivePath), { recursive: true });
const archive = spawnSync("tar", ["-czf", archivePath, "-C", releasesRoot, release.release_id], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (archive.status !== 0) throw new Error(`Release archive failed: ${archive.stderr || archive.stdout}`);

console.log(JSON.stringify({
  ok: true,
  release_id: release.release_id,
  source_commit: release.source_commit,
  source_tree_state: packageManifest.source_tree_state,
  bundle: relative(repoRoot, bundleRoot),
  archive: relative(repoRoot, archivePath),
  archive_sha256: shaFile(archivePath),
  package_content_sha256: packageContentSha256,
}, null, 2));
