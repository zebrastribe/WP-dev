import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WpDevConfig } from "../config/schema.js";
import {
  getPluginSyncMode,
  getThemeUnitConfig,
  listInstalledPluginSlugs,
  listThemeSlugs,
  themeExcludePatterns,
  validateThemeUnit,
} from "./sync-units.js";

/** Always excluded on push and pull — not user-disableable. */
export const SAFE_SYNC_EXCLUDES = [
  "wp-config.php",
  ".git",
  "wp-content/cache",
  "wp-content/uploads/cache",
  ".DS_Store",
] as const;

/** On by default for push; user can disable via sync.disabledRecommended. */
export const RECOMMENDED_PUSH_EXCLUDES: Readonly<
  Record<string, { pattern: string; label: string }>
> = {
  "node-modules": { pattern: "**/node_modules", label: "node_modules (theme/build)" },
  "debug-log": { pattern: "wp-content/debug.log", label: "Debug log" },
  "upgrade-temp": { pattern: "wp-content/upgrade", label: "Upgrade temp folder" },
};

/** Common dev-only plugins — offered as toggles when installed locally. */
export const KNOWN_DEV_PLUGINS: Readonly<Record<string, { label: string }>> = {
  "query-monitor": { label: "Query Monitor" },
  "debug-bar": { label: "Debug Bar" },
  fakerpress: { label: "FakerPress" },
  "wp-crontrol": { label: "WP Crontrol" },
  "user-switching": { label: "User Switching" },
};

export type SyncExcludeRule = {
  pattern: string;
  reason: string;
  category: "safe" | "recommended" | "localOnly" | "theme" | "custom" | "file";
};

export type SyncConfig = NonNullable<WpDevConfig["sync"]>;

const SYNC_EXCLUDES_FILE = ".wp-dev/sync-excludes";

function readExtraPatternsFromFile(configDir: string): string[] {
  const path = join(configDir, SYNC_EXCLUDES_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function compileUnitExcludes(
  config: WpDevConfig,
  wpRoot: string,
): SyncExcludeRule[] {
  const rules: SyncExcludeRule[] = [];

  for (const slug of listInstalledPluginSlugs(wpRoot)) {
    if (getPluginSyncMode(config, slug) === "localOnly") {
      rules.push({
        pattern: `wp-content/plugins/${slug}`,
        reason: `${KNOWN_DEV_PLUGINS[slug]?.label ?? slug} (local only)`,
        category: "localOnly",
      });
    }
  }

  for (const slug of listThemeSlugs(wpRoot)) {
    const unit = getThemeUnitConfig(config, slug);
    if (unit.mode === "localOnly") {
      rules.push({
        pattern: `wp-content/themes/${slug}`,
        reason: `${slug} theme (local only)`,
        category: "theme",
      });
      continue;
    }
    for (const pattern of themeExcludePatterns(slug, unit)) {
      rules.push({
        pattern,
        reason: `${slug} custom deployment`,
        category: "theme",
      });
    }
  }

  if (config.sync?.skipUploadsOnPush) {
    rules.push({
      pattern: "wp-content/uploads",
      reason: "Uploads skipped on push",
      category: "custom",
    });
  }

  return rules;
}

/** Legacy localOnlyPlugins → sync.plugins for callers that save config. */
export function normalizeSyncConfig(config: WpDevConfig): WpDevConfig {
  const sync = config.sync ?? {};
  const plugins = { ...(sync.plugins ?? {}) };
  for (const slug of sync.localOnlyPlugins ?? []) {
    if (!plugins[slug]) plugins[slug] = "localOnly";
  }
  return {
    ...config,
    sync: {
      ...sync,
      plugins: Object.keys(plugins).length > 0 ? plugins : sync.plugins,
    },
  };
}

export function buildPushExcludeRules(
  configDir: string,
  config: WpDevConfig,
  wpRoot?: string,
): SyncExcludeRule[] {
  const sync = config.sync ?? {};
  const disabled = new Set(sync.disabledRecommended ?? []);
  const rules: SyncExcludeRule[] = [];

  for (const pattern of SAFE_SYNC_EXCLUDES) {
    rules.push({ pattern, reason: "Always excluded (safe default)", category: "safe" });
  }

  for (const [key, meta] of Object.entries(RECOMMENDED_PUSH_EXCLUDES)) {
    if (disabled.has(key)) continue;
    rules.push({
      pattern: meta.pattern,
      reason: meta.label,
      category: "recommended",
    });
  }

  if (wpRoot) {
    rules.push(...compileUnitExcludes(config, wpRoot));
  } else {
    const pluginSlugs = new Set<string>();
    for (const slug of sync.localOnlyPlugins ?? []) pluginSlugs.add(slug);
    for (const [slug, mode] of Object.entries(sync.plugins ?? {})) {
      if (mode === "localOnly") pluginSlugs.add(slug);
    }
    for (const slug of pluginSlugs) {
      if (!/^[a-z0-9-]+$/i.test(slug)) continue;
      rules.push({
        pattern: `wp-content/plugins/${slug}`,
        reason: `${KNOWN_DEV_PLUGINS[slug]?.label ?? slug} (local only)`,
        category: "localOnly",
      });
    }
    for (const [slug, unit] of Object.entries(sync.themes ?? {})) {
      if (unit.mode === "localOnly") {
        rules.push({
          pattern: `wp-content/themes/${slug}`,
          reason: `${slug} theme (local only)`,
          category: "theme",
        });
      } else if (unit.mode === "custom") {
        for (const pattern of themeExcludePatterns(slug, unit)) {
          rules.push({ pattern, reason: `${slug} custom deployment`, category: "theme" });
        }
      }
    }
    if (sync.skipUploadsOnPush) {
      rules.push({
        pattern: "wp-content/uploads",
        reason: "Uploads skipped on push",
        category: "custom",
      });
    }
  }

  for (const pattern of sync.extraPushExcludes ?? []) {
    if (!pattern.trim()) continue;
    rules.push({ pattern: pattern.trim(), reason: "Custom pattern", category: "custom" });
  }

  for (const pattern of readExtraPatternsFromFile(configDir)) {
    rules.push({ pattern, reason: `.wp-dev/sync-excludes`, category: "file" });
  }

  return rules;
}

export function buildPullExcludeRules(
  configDir: string,
  config: WpDevConfig,
): SyncExcludeRule[] {
  const sync = config.sync ?? {};
  const rules: SyncExcludeRule[] = [];

  for (const pattern of SAFE_SYNC_EXCLUDES) {
    rules.push({ pattern, reason: "Always excluded (safe default)", category: "safe" });
  }

  for (const pattern of sync.extraPullExcludes ?? []) {
    if (!pattern.trim()) continue;
    rules.push({ pattern: pattern.trim(), reason: "Custom pull exclude", category: "custom" });
  }

  for (const pattern of readExtraPatternsFromFile(configDir)) {
    rules.push({ pattern, reason: `.wp-dev/sync-excludes`, category: "file" });
  }

  return rules;
}

export function pushExcludePatterns(
  configDir: string,
  config: WpDevConfig,
  wpRoot?: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of buildPushExcludeRules(configDir, config, wpRoot)) {
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    out.push(rule.pattern);
  }
  return out;
}

export function pullExcludePatterns(configDir: string, config: WpDevConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of buildPullExcludeRules(configDir, config)) {
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    out.push(rule.pattern);
  }
  return out;
}

export function collectSyncSafetyWarnings(
  config: WpDevConfig,
  wpRoot: string,
): string[] {
  const warnings: string[] = [];
  for (const slug of listThemeSlugs(wpRoot)) {
    warnings.push(...validateThemeUnit(wpRoot, slug, getThemeUnitConfig(config, slug)));
  }
  return warnings;
}

export function detectSuggestedLocalOnlyPlugins(
  wpRoot: string,
  config: WpDevConfig,
): string[] {
  const installed = new Set(listInstalledPluginSlugs(wpRoot));
  return Object.keys(KNOWN_DEV_PLUGINS).filter(
    (slug) => installed.has(slug) && getPluginSyncMode(config, slug) !== "localOnly",
  );
}

export { listInstalledPluginSlugs };
