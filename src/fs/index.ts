export { writeFileAtomic, writeJsonAtomic, sweepStaleTmpFiles, readTextFile } from "./atomic-write.js";
export { fsAuditLog } from "./audit-log.js";
export {
  assertWithinProjectRoot,
  isWithinProjectRoot,
  normalizeProjectPath,
  projectConfigPath,
  projectDockerEnvPath,
  projectDockerDir,
  projectLogsDir,
  ownershipManifestPath,
  tempRegistryPath,
} from "./path-resolver.js";
export { probePath, probeWritable } from "./permission-probe.js";
export {
  registerTempDir,
  unregisterTempDir,
  sweepTempRegistry,
  detectFilesystemWarnings,
  isWslWindowsMount,
  isLikelyCloudSyncPath,
} from "./temp-registry.js";
export { detectPlatform, assertUnixOwnershipSupport } from "./platform/detect.js";
export {
  reconcileSharedConfig,
  reconcileHostEditable,
  reconcileHostWritableForRsync,
  reconcileContainerRuntime,
  reconcileAllProfiles,
  reconcileAfterPull,
  runLocalWordpressFileMutation,
  buildSharedConfigReconcileShell,
} from "./ownership/reconcile.js";
export type { LocalWordpressFileMutationOptions } from "./ownership/reconcile.js";
export { buildOwnershipManifest, classifyRelativePath } from "./ownership/profiles.js";
export {
  runFilesystemRecovery,
  ensureFilesystemReady,
  autoReconcileOnStartup,
  checkFilesystemHealth,
} from "./recovery.js";
export {
  acquireUpdateLock,
  releaseUpdateLock,
  readUpdateLock,
  updateLockPath,
} from "./update-lock.js";
