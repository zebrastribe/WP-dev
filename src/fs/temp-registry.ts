import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { LoadedConfig } from "../config/load.js";
import { writeJsonAtomic } from "./atomic-write.js";
import { fsAuditLog } from "./audit-log.js";
import { tempRegistryPath } from "./path-resolver.js";
import type { TempRegistry, TempRegistryEntry } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function loadTempRegistry(configDir: string): TempRegistry {
  const path = tempRegistryPath(configDir);
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TempRegistry;
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveTempRegistry(configDir: string, registry: TempRegistry): void {
  writeJsonAtomic(tempRegistryPath(configDir), registry);
}

export function registerTempDir(
  loaded: LoadedConfig,
  dirPath: string,
  operation: string,
): string {
  const id = randomUUID();
  const entry: TempRegistryEntry = {
    id,
    path: dirPath,
    operation,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  const reg = loadTempRegistry(loaded.configDir);
  reg.entries.push(entry);
  saveTempRegistry(loaded.configDir, reg);
  fsAuditLog(loaded.configDir, loaded.config.project, "fs.temp_register", {
    id,
    path: dirPath,
    operation,
  });
  return id;
}

export function unregisterTempDir(configDir: string, id: string): void {
  const reg = loadTempRegistry(configDir);
  reg.entries = reg.entries.filter((e) => e.id !== id);
  saveTempRegistry(configDir, reg);
}

export function sweepTempRegistry(
  loaded: LoadedConfig,
  ttlMs = DEFAULT_TTL_MS,
): { removed: number; swept: number } {
  const reg = loadTempRegistry(loaded.configDir);
  const now = Date.now();
  let removed = 0;
  let swept = 0;
  const kept: TempRegistryEntry[] = [];

  for (const entry of reg.entries) {
    const created = Date.parse(entry.createdAt);
    const age = Number.isFinite(created) ? now - created : Number.POSITIVE_INFINITY;
    const exists = existsSync(entry.path);
    if (!exists || age > ttlMs) {
      if (exists) {
        try {
          rmSync(entry.path, { recursive: true, force: true });
          swept += 1;
        } catch {
          kept.push(entry);
          continue;
        }
      }
      removed += 1;
    } else {
      kept.push(entry);
    }
  }

  if (removed > 0) {
    saveTempRegistry(loaded.configDir, { version: 1, entries: kept });
    fsAuditLog(loaded.configDir, loaded.config.project, "fs.temp_sweep", {
      removed,
      swept,
    });
  }

  return { removed, swept };
}

export function isLikelyCloudSyncPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("icloud") ||
    lower.includes("onedrive") ||
    lower.includes("dropbox") ||
    lower.includes("google drive") ||
    lower.includes("mobile documents")
  );
}

export function isWslWindowsMount(path: string): boolean {
  return /^\/mnt\/[a-z]\//i.test(path.replace(/\\/g, "/"));
}

export function detectFilesystemWarnings(configDir: string): string[] {
  const warnings: string[] = [];
  if (isWslWindowsMount(configDir)) {
    warnings.push(
      "Project is on a Windows drive (/mnt/c/...). Move the clone to the WSL home directory (ext4) for reliable Docker bind mounts and permissions.",
    );
  }
  if (isLikelyCloudSyncPath(configDir)) {
    warnings.push(
      "Project path looks cloud-synced (iCloud/OneDrive/Dropbox). This causes permission and file-lock issues — use a local folder instead.",
    );
  }
  return warnings;
}
