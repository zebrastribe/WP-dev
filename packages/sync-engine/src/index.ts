/**
 * @wpdev/sync-engine — Phase 1 extract (plan §25 P1.2).
 *
 * Shared sync policy for the public CLI and (later) private hosted workers.
 * Commands stay thin wrappers. No control-api / vault here.
 */

export {
  acquireSyncLock,
  releaseSyncLock,
  canReclaimSyncLock,
  isLockPidAlive,
  parseSyncLockPayload,
  type SyncLockHandle,
  type SyncLockPayload,
} from "./sync-lock.js";

export {
  assertSshHostPinned,
  createSshHostVerifier,
  knownHostSha256Fingerprints,
  knownHostsTarget,
  sha256FingerprintBase64,
  type SshHostRef,
} from "./ssh-host-key.js";

export { getUrlVariants } from "./url-variants.js";

export { posixShellQuote } from "./shell-quote.js";

export {
  SAFE_SYNC_EXCLUDES,
  RECOMMENDED_PUSH_EXCLUDES,
  KNOWN_DEV_PLUGINS,
} from "./sync-excludes.js";

export {
  assertSingleSiteRoot,
  buildRemotePathSafetyScript,
  evaluatePathSafety,
  parseRemotePathSafetyOutput,
  type PathSafetyIssue,
  type PathSafetyReport,
} from "./path-safety.js";

export { normalizeSshPrivateKey } from "./ssh-private-key.js";

export {
  archiveRequest,
  assertBranchName,
  assertSubdirectory,
  bindingAfterBranchChange,
  bindingFor,
  branchStatus,
  buildRepoInstallScript,
  componentInstallRel,
  componentSlug,
  loadRepoSnapshot,
  formatAuthHeader,
  parseRepositoryUrl,
  redactSecret,
  resolveArchiveRedirect,
  verifyComponentFiles,
  type BranchInfo,
  type BranchStatus,
  type ComponentRepoConfig,
  type EnvBinding,
  type RepoComponentTarget,
  type RepoEnv,
  type RepoProviderId,
  type RepoRef,
  type RepoSnapshot,
} from "./repo-source.js";

export {
  SITE_UPDATE_PHP_VERSIONS,
  assertComponentSlug,
  assertSelectionAvailable,
  buildPhpProbeScript,
  buildSiteUpdateScript,
  buildUpdateCheckScript,
  labPhpView,
  parsePhpProbe,
  parseSiteUpdate,
  parseUpdateCheckOutput,
  phpControlFromProbe,
  phpMajorMinor,
  type AvailableComponent,
  type ComponentUpdate,
  type PhpControlView,
  type SiteUpdatePhpVersion,
  type SiteUpdateRequest,
  type SiteUpdateTarget,
  type UpdateCheckReport,
} from "./site-update.js";
