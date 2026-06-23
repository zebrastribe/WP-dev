import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { hostRunnerPidPath } from "../supervisor/paths.js";
import { terminateProcess } from "../supervisor/process-manager.js";

function parsePid(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Cleans up legacy host-runner processes from before sync-runner moved into Docker. */
export async function cleanupLegacyHostRunner(configDir: string): Promise<void> {
  const pidPath = hostRunnerPidPath(configDir);
  if (!existsSync(pidPath)) return;
  const pid = parsePid(readFileSync(pidPath, "utf8"));
  if (!pid) {
    try {
      unlinkSync(pidPath);
    } catch {
      /* ignore */
    }
    return;
  }
  await terminateProcess(pid, {
    label: "legacy-host-runner",
    configDir,
    projectId: "wp-dev",
  });
  try {
    unlinkSync(pidPath);
  } catch {
    /* ignore */
  }
}

/** @deprecated Use cleanupLegacyHostRunner — kept for call-site compatibility. */
export function stopHostRunner(configDir: string): void {
  void cleanupLegacyHostRunner(configDir);
}

/** @deprecated Sync runner runs inside the terminal Docker container. */
export function startHostRunner(_configDir: string, _envPath: string): void {
  /* no-op — sync-runner is started by docker compose */
}
