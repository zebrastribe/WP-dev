import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { wpflowConfigSchema, type WpflowConfig } from "./schema.js";

const CONFIG_NAMES = ["wpflow.config.json"];

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

/** Resolve a path from the config file directory */
export function resolveFromConfigDir(
  configDir: string,
  relative: string,
): string {
  return resolve(configDir, relative);
}
