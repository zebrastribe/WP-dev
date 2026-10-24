/**
 * Localhost host surface for `@wpdev/web` pages.
 * Hosted control-web will supply an equivalent module (CloudAdapter, no Terminal/Services).
 */
export { ActivityLog } from "./ActivityLog";
export { useAdminAuth } from "./AdminAuthProvider";
export { logAdmin } from "./adminLog";
export { loadLocalStatus, loadWpDevConfig } from "./api";
// loadWpDevConfig also used by SyncPage for theme slug display
export { BackupRestore } from "./BackupRestore";
export { ConfigAssistant } from "./ConfigAssistant";
export {
  createLocalAdapter,
  syncActionsForRoute,
  themeActionsForRoute,
} from "./adapter/localAdapter";
export { NAV_ITEMS, type NavId } from "./guideSections";
export { HistoryRollback } from "./HistoryRollback";
export { JobProgressPanel } from "./JobProgressPanel";
export { PhpVersionsPanel } from "./PhpVersionsPanel";
export { ServicesTab } from "./ServicesTab";
export { SyncTab } from "./SyncTab";
export { TerminalTab } from "./Terminal";
export { UpdateTab } from "./UpdateTab";
export { outlineButtonClass, secondaryAccentButtonClass } from "./uiClasses";
export { useRunnerJob } from "./useRunnerJob";
export { useRunnerSecrets } from "./useRunnerSecrets";
export { Wizard } from "./Wizard";
