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

export {
  SAFE_SYNC_EXCLUDES,
  RECOMMENDED_PUSH_EXCLUDES,
  KNOWN_DEV_PLUGINS,
} from "./sync-excludes.js";
