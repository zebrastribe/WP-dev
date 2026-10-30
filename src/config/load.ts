import {
  readFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ZodError } from "zod";
import { wpDevConfigSchema, type WpDevConfig } from "./schema.js";
import { writeFileAtomic } from "../fs/atomic-write.js";

/** Human-readable errors for corrupt or invalid wp-dev.config.json (include file path). */
export function formatConfigFileError(path: string, err: unknown): Error {
  if (err instanceof SyntaxError) {
    return new Error(`Invalid JSON in ${path}: ${err.message}`);
  }
  if (err instanceof ZodError) {
    const lines = err.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${where}: ${issue.message}`;
    });
    return new Error(`Invalid config in ${path}:\n${lines.join("\n")}`);
  }
  if (err instanceof Error) {
    return new Error(`${path}: ${err.message}`);
  }
  return new Error(`${path}: ${String(err)}`);
}

/** Known keys at each level of the config schema. */
const KNOWN_KEYS: Record<string, Set<string>> = {
  "": new Set(["$schema", "project", "local", "staging", "production", "simply", "sync", "importWorkspace"]),
  local: new Set(["url", "path", "composeFile", "composeProjectName", "composeService", "wpRoot", "themePath", "themeSlug"]),
  staging: new Set(["host", "user", "path", "url", "port", "identityFile", "db", "httpAuth"]),
  production: new Set(["host", "user", "path", "url", "port", "identityFile", "db"]),
  simply: new Set(["account"]),
  sync: new Set(["plugins", "localOnlyPlugins", "themes", "disabledRecommended", "extraPushExcludes", "extraPullExcludes", "skipUploadsOnPush", "recommendationsDismissed"]),
  importWorkspace: new Set(["enabled", "localUrl", "storagePath", "knowledgeBasePath", "deployPath", "tokenEnvVar"]),
  "staging.db": new Set(["host", "name", "user", "password", "prefix"]),
  "production.db": new Set(["host", "name", "user", "password", "prefix"]),
  "staging.httpAuth": new Set(["enabled", "username", "password"]),
};

/** Detect unknown keys at all levels (potential typos). Returns array of "path.key" strings. */
export function detectUnknownConfigKeys(raw: unknown, path = ""): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const unknown: string[] = [];
  const knownAtLevel = KNOWN_KEYS[path] ?? new Set<string>();
  for (const key of Object.keys(raw)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (!knownAtLevel.has(key)) {
      unknown.push(fullPath);
    }
    // Recurse into nested objects (but not into record types like sync.plugins or sync.themes)
    const val = (raw as Record<string, unknown>)[key];
    if (val && typeof val === "object" && !Array.isArray(val) && KNOWN_KEYS[fullPath]) {
      unknown.push(...detectUnknownConfigKeys(val, fullPath));
    }
  }
  return unknown;
}

const CONFIG_NAMES = ["wp-dev.config.json"];
const EXAMPLE_NAME = "wp-dev.config.example.json";

export type LoadedConfig = {
  config: WpDevConfig;
  /** Directory containing wp-dev.config.json */
  configDir: string;
};

function findConfigDir(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve("/");
  while (dir !== root) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

export function loadConfig(cwd = process.cwd()): LoadedConfig {
  const configDir = findConfigDir(cwd);
  if (!configDir) {
    throw new Error(
      `No wp-dev.config.json found in ${resolve(cwd)} or any parent directory.`,
    );
  }
  const path = join(configDir, "wp-dev.config.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw formatConfigFileError(path, e);
  }
  // Warn about unknown keys (typos) before validation
  const unknownKeys = detectUnknownConfigKeys(raw);
  if (unknownKeys.length > 0) {
    console.error(
      `[wp-dev] Warning: unknown keys in ${path}: ${unknownKeys.join(", ")} (possible typo)`,
    );
  }
  try {
    const config = wpDevConfigSchema.parse(raw);
    return { config, configDir };
  } catch (e) {
    throw formatConfigFileError(path, e);
  }
}

/** Walk upward from `cwd` for a directory containing `wp-dev.config.example.json`. */
export function findExampleConfigDir(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, EXAMPLE_NAME))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Ensure `wp-dev.config.json` exists next to an example file (copy on first run).
 * Returns the directory containing `wp-dev.config.json`.
 */
export function ensureWpDevConfigJson(cwd = process.cwd()): string {
  const existing = findConfigDir(cwd);
  if (existing) return existing;
  const withExample = findExampleConfigDir(cwd);
  if (!withExample) {
    throw new Error(
      `No wp-dev.config.json or ${EXAMPLE_NAME} found under ${resolve(cwd)}. Run this from the project root.`,
    );
  }
  const target = join(withExample, "wp-dev.config.json");
  const examplePath = join(withExample, EXAMPLE_NAME);
  if (!existsSync(target)) {
    copyFileSync(examplePath, target);
    console.error(`Created ${target} from ${EXAMPLE_NAME}.`);
  }
  return withExample;
}

export function writeWpDevConfig(configDir: string, config: WpDevConfig): void {
  const path = join(configDir, "wp-dev.config.json");
  const validated = wpDevConfigSchema.parse(config);
  writeFileAtomic(path, `${JSON.stringify(validated, null, 2)}\n`, {
    configDir,
    projectId: validated.project,
    backup: true,
    mode: 0o664,
  });
}

/** Resolve a path from the config file directory */
export function resolveFromConfigDir(
  configDir: string,
  relative: string,
): string {
  return resolve(configDir, relative);
}
