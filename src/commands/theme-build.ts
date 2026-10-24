import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import {
  checkThemeBuildArtifacts,
  resolveThemePaths,
} from "../services/theme-path.js";
import { resolveHostIdentity } from "../utils/host-paths.js";
import { logInfo } from "../utils/logger.js";

export type ThemeBuildOptions = {
  skipInstall?: boolean;
  quiet?: boolean;
};

/** Re-own bind-mounted theme build trees created as root inside the terminal. */
async function chownThemeBuildArtifacts(
  themeSourcePath: string,
  configDir: string,
): Promise<void> {
  const { uid, gid } = resolveHostIdentity(configDir);
  const targets = ["node_modules", "vendor"].map((n) => join(themeSourcePath, n));
  for (const target of targets) {
    if (!existsSync(target)) continue;
    try {
      await execa("chown", ["-R", `${uid}:${gid}`, target], { reject: false });
    } catch {
      /* ignore: non-posix or no permission */
    }
  }
}

/**
 * Run npm run production in the theme source tree (Tailwind/esbuild or similar).
 */
export async function cmdThemeBuild(
  loaded: LoadedConfig,
  options: ThemeBuildOptions = {},
): Promise<void> {
  const { themeSourcePath, deployDir, slug } = resolveThemePaths(loaded);
  const packageJson = join(themeSourcePath, "package.json");

  logInfo(`theme build: source=${themeSourcePath} deploy=${deployDir} slug=${slug}`);

  if (!existsSync(packageJson)) {
    console.error(
      `No package.json in ${themeSourcePath} — skipping npm build. ` +
        `If this theme has no build step, deploy the files in ${deployDir} directly.`,
    );
    const check = checkThemeBuildArtifacts(deployDir);
    if (!check.ok) {
      throw new Error(check.issues.join("\n"));
    }
    return;
  }

  if (!options.skipInstall) {
    logInfo("theme build: npm ci");
    await execa("npm", ["ci"], { cwd: themeSourcePath, stdio: "inherit" });
  }

  logInfo("theme build: npm run production");
  await execa("npm", ["run", "production"], {
    cwd: themeSourcePath,
    stdio: "inherit",
  });

  // Terminal/container builds run as root; re-own node_modules for the host user.
  await chownThemeBuildArtifacts(themeSourcePath, loaded.configDir);

  const check = checkThemeBuildArtifacts(deployDir);
  if (!options.quiet) {
    console.error(
      `Theme build OK — deploy folder: ${deployDir} (${check.styleBytes} bytes style.css)`,
    );
  }
  if (!check.ok) {
    throw new Error(`Theme build finished with issues:\n${check.issues.join("\n")}`);
  }
}
