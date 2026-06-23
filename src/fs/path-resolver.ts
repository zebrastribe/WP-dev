import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export function normalizeProjectPath(configDir: string, relativeOrAbsolute: string): string {
  const abs = resolve(configDir, relativeOrAbsolute);
  return abs;
}

/** True when `target` resolves inside `configDir` (prevents path traversal). */
export function isWithinProjectRoot(configDir: string, target: string): boolean {
  const root = resolve(configDir);
  const resolved = resolve(target);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return resolved === root || resolved.startsWith(rootWithSep);
}

export function assertWithinProjectRoot(configDir: string, target: string): string {
  const resolved = resolve(target);
  if (!isWithinProjectRoot(configDir, resolved)) {
    throw new Error(`Path escapes project root: ${target}`);
  }
  return resolved;
}

export function resolveExistingPath(path: string): string {
  if (!existsSync(path)) return resolve(path);
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function projectConfigPath(configDir: string): string {
  return join(configDir, "wp-dev.config.json");
}

export function projectDockerEnvPath(configDir: string, localPath = "docker"): string {
  return join(configDir, localPath, ".env");
}

export function projectDockerDir(configDir: string, localPath = "docker"): string {
  return join(configDir, localPath);
}

export function projectLogsDir(configDir: string): string {
  return join(configDir, "logs");
}

export function ownershipManifestPath(configDir: string): string {
  return join(projectLogsDir(configDir), "ownership-manifest.json");
}

export function tempRegistryPath(configDir: string): string {
  return join(projectLogsDir(configDir), "temp-registry.json");
}
