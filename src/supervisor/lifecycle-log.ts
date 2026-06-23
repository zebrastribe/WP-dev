import { appendFileSync, mkdirSync } from "node:fs";
import { lifecycleLogPath, supervisorLogsDir } from "./paths.js";
import type { LifecycleEvent, LifecycleEventType } from "./types.js";

export function emitLifecycleEvent(
  configDir: string,
  projectId: string,
  event: LifecycleEventType,
  extra: Record<string, unknown> = {},
): void {
  const dir = supervisorLogsDir(configDir);
  mkdirSync(dir, { recursive: true });
  const payload: LifecycleEvent = {
    ts: new Date().toISOString(),
    event,
    project: projectId,
    ...extra,
  };
  appendFileSync(lifecycleLogPath(configDir), `${JSON.stringify(payload)}\n`, "utf8");
}
