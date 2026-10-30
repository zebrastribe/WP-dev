/**
 * Compatibility shim — implementation lives in `@wpdev/sync-engine` (Phase 1 extract).
 * Prefer importing from `@wpdev/sync-engine` in new code.
 */
export {
  acquireSyncLock,
  releaseSyncLock,
  canReclaimSyncLock,
  isLockPidAlive,
  parseSyncLockPayload,
  type SyncLockHandle,
  type SyncLockPayload,
} from "@wpdev/sync-engine";
