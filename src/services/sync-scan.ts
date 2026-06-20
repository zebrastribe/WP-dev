import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import {
  KNOWN_DEV_PLUGINS,
  detectSuggestedLocalOnlyPlugins,
} from "./sync-excludes.js";
import {
  getPluginSyncMode,
  getRecommendedThemeExcludes,
  getThemeUnitConfig,
  isBuildTheme,
  listInstalledPluginSlugs,
  listThemeChildren,
  listThemeSlugs,
  themeUiRows,
} from "./sync-units.js";
import { isLocalWpInstalled } from "./wpcli.js";
import { wpLocalGetOption } from "../utils/sync-verify.js";

export type SyncScanPlugin = {
  slug: string;
  label: string;
  mode: "sync" | "localOnly";
  isDev: boolean;
  installed: true;
};

export type SyncScanTheme = {
  slug: string;
  active: boolean;
  mode: "all" | "custom" | "localOnly";
  buildTheme: boolean;
  excludeFolders: string[];
  excludeFiles: string[];
  folders: string[];
  files: string[];
  recommendedExcludeFolders: string[];
  recommendedExcludeFiles: string[];
};

export type SyncScanResult = {
  activeTheme: string | null;
  plugins: SyncScanPlugin[];
  themes: SyncScanTheme[];
  suggestions: {
    devPlugins: string[];
    buildThemes: { slug: string; excludeFolders: string[]; excludeFiles: string[] }[];
  };
};

async function resolveActiveTheme(
  loaded: LoadedConfig,
  wpRoot: string,
): Promise<string | null> {
  try {
    if (await isLocalWpInstalled(loaded.configDir, loaded.config)) {
      const stylesheet = await wpLocalGetOption(
        loaded.configDir,
        loaded.config,
        "stylesheet",
      );
      if (stylesheet && listThemeSlugs(wpRoot).includes(stylesheet)) {
        return stylesheet;
      }
    }
  } catch {
    /* fall through */
  }
  return listThemeSlugs(wpRoot)[0] ?? null;
}

export async function runSyncScan(loaded: LoadedConfig): Promise<SyncScanResult> {
  const wpRoot = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
  const { config } = loaded;
  const activeTheme = await resolveActiveTheme(loaded, wpRoot);

  const plugins: SyncScanPlugin[] = listInstalledPluginSlugs(wpRoot)
    .sort()
    .map((slug) => ({
      slug,
      label: KNOWN_DEV_PLUGINS[slug]?.label ?? slug,
      mode: getPluginSyncMode(config, slug),
      isDev: slug in KNOWN_DEV_PLUGINS,
      installed: true as const,
    }));

  const themes: SyncScanTheme[] = listThemeSlugs(wpRoot)
    .sort()
    .map((slug) => {
      const unit = getThemeUnitConfig(config, slug);
      const rec = getRecommendedThemeExcludes(wpRoot, slug);
      const children = listThemeChildren(wpRoot, slug);
      return {
        slug,
        active: slug === activeTheme,
        mode: unit.mode,
        buildTheme: isBuildTheme(wpRoot, slug),
        excludeFolders: unit.excludeFolders ?? [],
        excludeFiles: unit.excludeFiles ?? [],
        folders: children.folders,
        files: children.files,
        recommendedExcludeFolders: rec.excludeFolders,
        recommendedExcludeFiles: rec.excludeFiles,
      };
    });

  const devPlugins = detectSuggestedLocalOnlyPlugins(wpRoot, config);
  const buildThemes = themes
    .filter((t) => t.buildTheme || t.recommendedExcludeFolders.length > 0)
    .map((t) => ({
      slug: t.slug,
      excludeFolders: t.recommendedExcludeFolders,
      excludeFiles: t.recommendedExcludeFiles,
    }));

  return {
    activeTheme,
    plugins,
    themes,
    suggestions: { devPlugins, buildThemes },
  };
}

export function applySyncRecommendations(
  config: LoadedConfig["config"],
  scan: SyncScanResult,
): LoadedConfig["config"] {
  const sync = { ...(config.sync ?? {}) };
  const plugins = { ...(sync.plugins ?? {}) };
  for (const slug of scan.suggestions.devPlugins) {
    plugins[slug] = "localOnly";
  }
  const themes = { ...(sync.themes ?? {}) };
  for (const t of scan.suggestions.buildThemes) {
    if (themes[t.slug]?.mode === "custom" || themes[t.slug]?.mode === "localOnly") continue;
    themes[t.slug] = {
      mode: "custom",
      excludeFolders: t.excludeFolders,
      excludeFiles: t.excludeFiles,
    };
  }
  sync.plugins = plugins;
  sync.themes = themes;
  sync.recommendationsDismissed = true;
  return { ...config, sync };
}

/** Rows for UI checkbox grid on a theme. */
export function themeDeployRowsForScan(
  wpRoot: string,
  slug: string,
  unit: ReturnType<typeof getThemeUnitConfig>,
): { name: string; type: "folder" | "file"; synced: boolean }[] {
  const ui = themeUiRows(wpRoot, slug);
  const exF = new Set(unit.excludeFolders ?? []);
  const exFiles = new Set(unit.excludeFiles ?? []);
  if (unit.mode === "all") {
    return [
      ...ui.folders.map((f) => ({ name: f.name, type: "folder" as const, synced: true })),
      ...ui.files.map((f) => ({ name: f.name, type: "file" as const, synced: true })),
    ];
  }
  if (unit.mode === "localOnly") {
    return [
      ...ui.folders.map((f) => ({ name: f.name, type: "folder" as const, synced: false })),
      ...ui.files.map((f) => ({ name: f.name, type: "file" as const, synced: false })),
    ];
  }
  return [
    ...ui.folders.map((f) => ({
      name: f.name,
      type: "folder" as const,
      synced: !exF.has(f.name),
    })),
    ...ui.files.map((f) => ({
      name: f.name,
      type: "file" as const,
      synced: !exFiles.has(f.name),
    })),
  ];
}
