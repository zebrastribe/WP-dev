import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { waitForPortFree } from "./port-probe.js";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type TerminateResult = "stopped" | "not_running" | "forced";

export async function terminateProcess(
  pid: number,
  options: {
    label: string;
    configDir: string;
    projectId: string;
    graceMs?: number;
    killMs?: number;
  },
): Promise<TerminateResult> {
  if (!isPidAlive(pid)) return "not_running";

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return "not_running";
  }

  const graceMs = options.graceMs ?? 10_000;
  const killMs = options.killMs ?? 3_000;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      emitLifecycleEvent(options.configDir, options.projectId, "recovery.orphan_kill", {
        pid,
        label: options.label,
        signal: "SIGTERM",
      });
      return "stopped";
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return "not_running";
  }

  await new Promise((r) => setTimeout(r, killMs));
  emitLifecycleEvent(options.configDir, options.projectId, "recovery.orphan_kill", {
    pid,
    label: options.label,
    signal: "SIGKILL",
  });
  return isPidAlive(pid) ? "forced" : "stopped";
}

export function parsePidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function cleanupPidFile(
  pidPath: string,
  configDir: string,
  projectId: string,
  label: string,
): Promise<void> {
  const pid = parsePidFile(pidPath);
  if (!pid) {
    try {
      unlinkSync(pidPath);
    } catch {
      /* ignore */
    }
    return;
  }
  await terminateProcess(pid, { label, configDir, projectId });
  try {
    unlinkSync(pidPath);
  } catch {
    /* ignore */
  }
}

export async function reclaimPortListeners(
  pids: number[],
  configDir: string,
  projectId: string,
): Promise<void> {
  for (const pid of [...new Set(pids)]) {
    if (!pid) continue;
    await terminateProcess(pid, {
      label: "port-listener",
      configDir,
      projectId,
    });
  }
}
