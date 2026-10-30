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

/** Result of attempting to read and parse the config file. */
export type ConfigReadResult =
  | { status: "ok"; raw: unknown; path: string }
  | { status: "not_found"; path: string }
  | { status: "parse_error"; path: string; error: string }
  | { status: "validation_error"; path: string; error: string };

/** Read and parse config without throwing - for UI to show specific errors. */
export function readConfigFile(configDir: string): ConfigReadResult {
  const path = join(configDir, "wp-dev.config.json");
  if (!existsSync(path)) {
    return { status: "not_found", path };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    const msg = e instanceof SyntaxError ? e.message : String(e);
    return { status: "parse_error", path, error: `Invalid JSON: ${msg}` };
  }
  try {
    wpDevConfigSchema.parse(raw);
    return { status: "ok", raw, path };
  } catch (e) {
    if (e instanceof ZodError) {
      const lines = e.issues.map((issue) => {
        const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${where}: ${issue.message}`;
      });
      return { status: "validation_error", path, error: lines.join("; ") };
    }
    return { status: "validation_error", path, error: String(e) };
  }
}

/** Check if the config file can be parsed as valid JSON. */
export function isConfigFileReadable(configDir: string): boolean {
  const path = join(configDir, "wp-dev.config.json");
  if (!existsSync(path)) return false;
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/** Known top-level keys in the config schema. */
const KNOWN_CONFIG_KEYS = new Set([
  "project",
  "local",
  "staging",
  "production",
  "simply",
  "sync",
  "importWorkspace",
]);

/** Detect unknown top-level keys (potential typos). */
export function detectUnknownConfigKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const unknown: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      unknown.push(key);
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
