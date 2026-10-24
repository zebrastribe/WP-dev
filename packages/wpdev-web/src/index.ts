/**
 * @wpdev/web — shared product UI for localhost admin and hosted control-web.
 *
 * Host apps must alias `@wpdev/web-host` to a module that exports runner hooks,
 * Wizard, SyncTab, etc. (see docs/admin/src/webHost.ts).
 */
export {
  ENV_LABEL,
  LOCAL_SYNC_ROUTES,
  RUNNER_ENV_LABEL,
  roleToRunnerEnv,
  type EnvRole,
  type JobResult,
  type RunnerEnv,
  type SyncRoute,
  type SyncRouteId,
  type SyncScopePreset,
  type WpdevWebAdapter,
} from "./adapter/types";

export { EnvBadges } from "./EnvBadges";
export { LockedGate } from "./LockedGate";
export { AdvancedPage } from "./pages/AdvancedPage";
export { BackupPage } from "./pages/BackupPage";
export { RestorePanel } from "./pages/RestorePanel";
export { SetupStagingPage } from "./pages/SetupStagingPage";
export { SyncPage } from "./pages/SyncPage";
export { PRIMARY_TABS, type PrimaryTab } from "./shell/primaryTabs";
export {
  outlineButtonClass,
  secondaryAccentButtonClass,
  toggleButtonClass,
} from "./uiClasses";
