/**
 * @wpdev/sync-engine — Phase 1 extract (plan §25 P1.2).
 *
 * Seed surface: per-project sync lock (P1.3).
 * Next moves (same package, no policy rewrite): rsync/wpcli helpers, excludes,
 * known-hosts pin API (already in src/utils/ssh-host-key.ts — re-home here).
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
