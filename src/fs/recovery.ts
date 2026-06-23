import type { LoadedConfig } from "../config/load.js";
import { sweepStaleTmpFiles } from "./atomic-write.js";
import { fsAuditLog } from "./audit-log.js";
import { probePath } from "./permission-probe.js";
import { projectLogsDir } from "./path-resolver.js";
import {
  detectFilesystemWarnings,
  sweepTempRegistry,
} from "./temp-registry.js";
import {
  getManagedPathsForProbe,
  reconcileAllProfiles,
} from "./ownership/reconcile.js";

export async function runFilesystemRecovery(loaded: LoadedConfig): Promise<void> {
  const logsDir = projectLogsDir(loaded.configDir);
  const staleTmp = sweepStaleTmpFiles(logsDir);
  const staleDockerTmp = sweepStaleTmpFiles(
    `${loaded.configDir}/${loaded.config.local.path}`,
  );
  if (staleTmp + staleDockerTmp > 0) {
    fsAuditLog(loaded.configDir, loaded.config.project, "fs.stale_tmp_cleanup", {
      count: staleTmp + staleDockerTmp,
    });
  }
  sweepTempRegistry(loaded);
}

export async function ensureFilesystemReady(loaded: LoadedConfig): Promise<void> {
  await runFilesystemRecovery(loaded);
  const warnings = detectFilesystemWarnings(loaded.configDir);
  for (const w of warnings) {
    console.error(`Warning: ${w}`);
  }
}

export async function autoReconcileOnStartup(loaded: LoadedConfig): Promise<void> {
  await ensureFilesystemReady(loaded);
  try {
    await reconcileAllProfiles(loaded);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fsAuditLog(loaded.configDir, loaded.config.project, "fs.recovery", {
      phase: "startup_reconcile_failed",
      error: msg,
    });
  }
}

export type FilesystemCheckResult = {
  ok: boolean;
  issues: string[];
};

export function checkFilesystemHealth(loaded: LoadedConfig): FilesystemCheckResult {
  const issues: string[] = [];
  for (const w of detectFilesystemWarnings(loaded.configDir)) {
    issues.push(w);
  }
  for (const p of getManagedPathsForProbe(loaded)) {
    const probe = probePath(p);
    if (!probe.writable && probe.issues.length > 0) {
      issues.push(`${p}: ${probe.issues.join(", ")}`);
    }
  }
  return { ok: issues.length === 0, issues };
}
