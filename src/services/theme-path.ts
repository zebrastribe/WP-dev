import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";

export type ResolvedThemePaths = {
  /** Repo / source folder (may contain package.json, tailwind/, etc.). */
  themeSourcePath: string;
  /** Folder synced to wp-content/themes/<slug>/ (compiled theme root). */
  deployDir: string;
  slug: string;
};

const DEFAULT_THEME_REL = "wp-content/themes/agency-starter";

/**
 * Optional local.themePath in wp-dev.config.json; else wpRoot/wp-content/themes/agency-starter.
 */
export function resolveThemeSourcePath(loaded: LoadedConfig): string {
  const { config, configDir } = loaded;
  const configured = config.local.themePath?.trim();
  if (configured) {
    return resolveFromConfigDir(configDir, configured);
  }
  const wpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
  return join(wpRoot, DEFAULT_THEME_REL);
}

/**
 * _tw-style themes use `<source>/theme/style.css`; flat themes use `<source>/style.css`.
 */
export function resolveThemeDeployDir(themeSourcePath: string): string {
  const nestedStyle = join(themeSourcePath, "theme", "style.css");
  const flatStyle = join(themeSourcePath, "style.css");

  if (existsSync(nestedStyle)) {
    return join(themeSourcePath, "theme");
  }
  if (existsSync(flatStyle)) {
    return themeSourcePath;
  }

  throw new Error(
    `No theme style.css found under ${themeSourcePath} (expected ${nestedStyle} or ${flatStyle}). ` +
      `Set local.themePath in wp-dev.config.json to your theme source directory.`,
  );
}

function readSlugFromStyleCss(stylePath: string): string | null {
  const header = readFileSync(stylePath, "utf8").slice(0, 8192);
  const match = header.match(/^[\s*]*Text Domain:\s*(.+)$/im);
  if (match?.[1]) {
    return match[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  }
  const themeMatch = header.match(/^[\s*]*Theme Name:\s*(.+)$/im);
  if (themeMatch?.[1]) {
    return themeMatch[1]
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }
  return null;
}

export function resolveThemeSlug(
  loaded: LoadedConfig,
  themeSourcePath: string,
  deployDir: string,
): string {
  if (loaded.config.local.themeSlug?.trim()) {
    return loaded.config.local.themeSlug.trim();
  }

  const fromStyle = readSlugFromStyleCss(join(deployDir, "style.css"));
  if (fromStyle) {
    return fromStyle;
  }

  return basename(themeSourcePath);
}

export function resolveThemePaths(loaded: LoadedConfig): ResolvedThemePaths {
  const themeSourcePath = resolveThemeSourcePath(loaded);
  const deployDir = resolveThemeDeployDir(themeSourcePath);
  const slug = resolveThemeSlug(loaded, themeSourcePath, deployDir);

  return { themeSourcePath, deployDir, slug };
}

export function remoteThemePath(remoteWpPath: string, slug: string): string {
  const base = remoteWpPath.replace(/\/$/, "");
  return `${base}/wp-content/themes/${slug}`;
}

export type ThemeBuildCheck = {
  ok: boolean;
  deployDir: string;
  stylePath: string;
  styleBytes: number;
  issues: string[];
};

/** Heuristic: production CSS is usually smaller and often one long line. */
export function checkThemeBuildArtifacts(deployDir: string): ThemeBuildCheck {
  const stylePath = join(deployDir, "style.css");
  const issues: string[] = [];

  if (!existsSync(stylePath)) {
    return {
      ok: false,
      deployDir,
      stylePath,
      styleBytes: 0,
      issues: ["Missing theme/style.css — run: npm run wp-dev -- theme build"],
    };
  }

  const styleBytes = statSync(stylePath).size;
  const sample = readFileSync(stylePath, "utf8").slice(0, 4000);

  if (styleBytes > 120_000) {
    issues.push(
      `style.css is ${styleBytes} bytes — likely a dev build. Run: npm run wp-dev -- theme build`,
    );
  }
  if (sample.includes("sourceMappingURL")) {
    issues.push("style.css contains source maps — use production build before deploy");
  }
  if (!existsSync(join(deployDir, "functions.php"))) {
    issues.push("Missing functions.php in deploy directory");
  }

  return {
    ok: issues.length === 0,
    deployDir,
    stylePath,
    styleBytes,
    issues,
  };
}
