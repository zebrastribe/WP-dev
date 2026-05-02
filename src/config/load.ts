import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { wpflowConfigSchema, type WpflowConfig } from "./schema.js";

const CONFIG_NAMES = ["wpflow.config.json"];
const EXAMPLE_NAME = "wpflow.config.example.json";

export type LoadedConfig = {
  config: WpflowConfig;
  /** Directory containing wpflow.config.json */
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
      `No wpflow.config.json found in ${resolve(cwd)} or any parent directory.`,
    );
  }
  const path = join(configDir, "wpflow.config.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const config = wpflowConfigSchema.parse(raw);
  return { config, configDir };
}

/** Walk upward from `cwd` for a directory containing `wpflow.config.example.json`. */
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
 * Ensure `wpflow.config.json` exists next to an example file (copy on first run).
 * Returns the directory containing `wpflow.config.json`.
 */
export function ensureWpflowConfigJson(cwd = process.cwd()): string {
  const existing = findConfigDir(cwd);
  if (existing) return existing;
  const withExample = findExampleConfigDir(cwd);
  if (!withExample) {
    throw new Error(
      `No wpflow.config.json or ${EXAMPLE_NAME} found under ${resolve(cwd)}. Run this from the project root.`,
    );
  }
  const target = join(withExample, "wpflow.config.json");
  const examplePath = join(withExample, EXAMPLE_NAME);
  if (!existsSync(target)) {
    copyFileSync(examplePath, target);
    console.error(`Created ${target} from ${EXAMPLE_NAME}.`);
  }
  return withExample;
}

export function writeWpflowConfig(configDir: string, config: WpflowConfig): void {
  const path = join(configDir, "wpflow.config.json");
  const validated = wpflowConfigSchema.parse(config);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

/** Resolve a path from the config file directory */
export function resolveFromConfigDir(
  configDir: string,
  relative: string,
): string {
  return resolve(configDir, relative);
}
