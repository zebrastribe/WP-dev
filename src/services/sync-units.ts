import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WpDevConfig } from "../config/schema.js";

export type PluginSyncMode = "sync" | "localOnly";
export type ThemeSyncMode = "all" | "custom" | "localOnly";

export type ThemeUnitConfig = {
  mode: ThemeSyncMode;
  excludeFolders?: string[];
  excludeFiles?: string[];
};

/** Root PHP/assets that should usually ship with a theme. */
export const THEME_DEPLOY_FILES = [
  "style.css",
  "functions.php",
  "theme.json",
  "screenshot.png",
  "index.php",
  "rtl.css",
] as const;

/** Subfolders commonly deployed from built themes. */
export const THEME_DEPLOY_FOLDERS = [
  "dist",
  "assets",
  "templates",
  "template-parts",
  "parts",
  "patterns",
  "inc",
  "includes",
  "blocks",
  "js",
  "css",
  "images",
  "fonts",
  "languages",
  "acf-json",
] as const;

/** Subfolders commonly kept local on push. */
export const THEME_DEV_FOLDERS = [
  "src",
  "node_modules",
  "tests",
  "test",
  "__tests__",
  ".storybook",
  ".vscode",
  ".idea",
  "coverage",
  ".github",
  "vendor",
] as const;

export const THEME_DEV_FILES = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "vite.config.js",
  "vite.config.ts",
  "webpack.config.js",
  "webpack.config.mjs",
  "tsconfig.json",
  ".editorconfig",
  ".eslintrc",
  ".prettierrc",
] as const;

export function listInstalledPluginSlugs(wpRoot: string): string[] {
  const pluginsDir = join(wpRoot, "wp-content/plugins");
  if (!existsSync(pluginsDir)) return [];
  try {
    return readdirSync(pluginsDir).filter((name) => {
      if (name.startsWith(".") || name === "index.php") return false;
      return statSync(join(pluginsDir, name)).isDirectory();
    });
  } catch {
    return [];
  }
}

export function listThemeSlugs(wpRoot: string): string[] {
  const themesDir = join(wpRoot, "wp-content/themes");
  if (!existsSync(themesDir)) return [];
  try {
    return readdirSync(themesDir).filter((name) => {
      if (name.startsWith(".") || name === "index.php") return false;
      return statSync(join(themesDir, name)).isDirectory();
    });
  } catch {
    return [];
  }
}

export function listThemeChildren(wpRoot: string, slug: string): {
  folders: string[];
  files: string[];
} {
  const themeDir = join(wpRoot, "wp-content/themes", slug);
  if (!existsSync(themeDir)) return { folders: [], files: [] };
  const folders: string[] = [];
  const files: string[] = [];
  try {
    for (const name of readdirSync(themeDir)) {
      if (name.startsWith(".")) continue;
      const p = join(themeDir, name);
      if (statSync(p).isDirectory()) folders.push(name);
      else if (statSync(p).isFile()) files.push(name);
    }
  } catch {
    /* ignore */
  }
  return { folders, files };
}

export function isBuildTheme(wpRoot: string, slug: string): boolean {
  const themeDir = join(wpRoot, "wp-content/themes", slug);
  if (!existsSync(join(themeDir, "package.json"))) return false;
  const bundlers = [
    "vite.config.js",
    "vite.config.ts",
    "webpack.config.js",
    "webpack.config.mjs",
  ];
  return bundlers.some((f) => existsSync(join(themeDir, f)));
}

export function getRecommendedThemeExcludes(
  wpRoot: string,
  slug: string,
): { excludeFolders: string[]; excludeFiles: string[] } {
  const { folders, files } = listThemeChildren(wpRoot, slug);
  const folderSet = new Set(folders);
  const fileSet = new Set(files);

  const excludeFolders = THEME_DEV_FOLDERS.filter((f) => folderSet.has(f));
  const hasSrcDist = folderSet.has("src") && folderSet.has("dist");
  if (hasSrcDist && !excludeFolders.includes("src")) excludeFolders.push("src");

  const excludeFiles = THEME_DEV_FILES.filter((f) => fileSet.has(f));
  if (isBuildTheme(wpRoot, slug)) {
    for (const f of THEME_DEV_FILES) {
      if (fileSet.has(f) && !excludeFiles.includes(f)) excludeFiles.push(f);
    }
  }
  return { excludeFolders, excludeFiles };
}

export function getPluginSyncMode(config: WpDevConfig, slug: string): PluginSyncMode {
  const fromMap = config.sync?.plugins?.[slug];
  if (fromMap === "localOnly" || fromMap === "sync") return fromMap;
  const legacy = config.sync?.localOnlyPlugins ?? [];
  if (legacy.includes(slug)) return "localOnly";
  return "sync";
}

export function getThemeUnitConfig(config: WpDevConfig, slug: string): ThemeUnitConfig {
  const t = config.sync?.themes?.[slug];
  if (t?.mode === "localOnly" || t?.mode === "custom" || t?.mode === "all") {
    return {
      mode: t.mode,
      excludeFolders: t.excludeFolders ?? [],
      excludeFiles: t.excludeFiles ?? [],
    };
  }
  return { mode: "all", excludeFolders: [], excludeFiles: [] };
}

export function themeExcludePatterns(slug: string, unit: ThemeUnitConfig): string[] {
  if (unit.mode === "localOnly") {
    return [`wp-content/themes/${slug}`];
  }
  if (unit.mode !== "custom") return [];
  const patterns: string[] = [];
  for (const folder of unit.excludeFolders ?? []) {
    if (!folder || folder.includes("..") || folder.includes("/")) continue;
    patterns.push(`wp-content/themes/${slug}/${folder}`);
  }
  for (const file of unit.excludeFiles ?? []) {
    if (!file || file.includes("..") || file.includes("/")) continue;
    patterns.push(`wp-content/themes/${slug}/${file}`);
  }
  return patterns;
}

export function validateThemeUnit(
  wpRoot: string,
  slug: string,
  unit: ThemeUnitConfig,
): string[] {
  const warnings: string[] = [];
  if (unit.mode !== "custom") return warnings;
  const themeDir = join(wpRoot, "wp-content/themes", slug);
  const excludedFiles = new Set(unit.excludeFiles ?? []);
  for (const required of ["style.css", "functions.php"] as const) {
    if (excludedFiles.has(required) && existsSync(join(themeDir, required))) {
      warnings.push(`Excluding ${required} may break the theme on the remote site.`);
    }
  }
  return warnings;
}

export function buildStaysLocalSummary(
  config: WpDevConfig,
  wpRoot: string,
): { label: string; path: string }[] {
  const items: { label: string; path: string }[] = [];
  for (const slug of listInstalledPluginSlugs(wpRoot)) {
    if (getPluginSyncMode(config, slug) === "localOnly") {
      items.push({ label: slug, path: `wp-content/plugins/${slug}/` });
    }
  }
  for (const slug of listThemeSlugs(wpRoot)) {
    const unit = getThemeUnitConfig(config, slug);
    if (unit.mode === "localOnly") {
      items.push({ label: slug, path: `wp-content/themes/${slug}/` });
      continue;
    }
    if (unit.mode === "custom") {
      for (const f of unit.excludeFolders ?? []) {
        items.push({ label: `${slug}/${f}/`, path: `wp-content/themes/${slug}/${f}/` });
      }
      for (const f of unit.excludeFiles ?? []) {
        items.push({ label: `${slug}/${f}`, path: `wp-content/themes/${slug}/${f}` });
      }
    }
  }
  if (config.sync?.skipUploadsOnPush) {
    items.push({ label: "uploads", path: "wp-content/uploads/" });
  }
  return items;
}

export function themeUiRows(wpRoot: string, slug: string): {
  folders: { name: string; kind: "deploy" | "dev" | "other" }[];
  files: { name: string; kind: "deploy" | "dev" | "other" }[];
} {
  const { folders, files } = listThemeChildren(wpRoot, slug);
  const deployFolderSet = new Set<string>(THEME_DEPLOY_FOLDERS);
  const devFolderSet = new Set<string>(THEME_DEV_FOLDERS);
  const deployFileSet = new Set<string>(THEME_DEPLOY_FILES);
  const devFileSet = new Set<string>(THEME_DEV_FILES);

  const allFolders = new Set([
    ...folders,
    ...THEME_DEPLOY_FOLDERS.filter((f) => folders.includes(f) || f === "dist" || f === "assets"),
    ...THEME_DEV_FOLDERS.filter((f) => folders.includes(f)),
  ]);
  for (const f of folders) allFolders.add(f);

  const folderRows = [...allFolders]
    .filter((f) => folders.includes(f))
    .sort()
    .map((name) => ({
      name,
      kind: deployFolderSet.has(name as (typeof THEME_DEPLOY_FOLDERS)[number])
        ? ("deploy" as const)
        : devFolderSet.has(name as (typeof THEME_DEV_FOLDERS)[number])
          ? ("dev" as const)
          : ("other" as const),
    }));

  const fileRows = [...new Set([...files, ...THEME_DEPLOY_FILES.filter((f) => files.includes(f))])]
    .filter((f) => files.includes(f))
    .sort()
    .map((name) => ({
      name,
      kind: deployFileSet.has(name as (typeof THEME_DEPLOY_FILES)[number])
        ? ("deploy" as const)
        : devFileSet.has(name as (typeof THEME_DEV_FILES)[number])
          ? ("dev" as const)
          : ("other" as const),
    }));

  return { folders: folderRows, files: fileRows };
}
