import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FsAuditEvent } from "./types.js";

export function fsAuditLog(
  configDir: string,
  projectId: string,
  event: FsAuditEvent,
  extra: Record<string, unknown> = {},
): void {
  const logsDir = join(configDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const payload = {
    ts: new Date().toISOString(),
    event,
    project: projectId,
    ...extra,
  };
  appendFileSync(join(logsDir, "lifecycle.jsonl"), `${JSON.stringify(payload)}\n`, "utf8");
}
