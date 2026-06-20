import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPushToPath } from "../services/rsync.js";
import {
  checkThemeBuildArtifacts,
  remoteThemePath,
  resolveThemePaths,
} from "../services/theme-path.js";
import { resolveRemoteWpPath } from "../services/wpcli.js";
import { confirmProduction } from "../utils/confirm.js";
import { logInfo } from "../utils/logger.js";
import { cmdThemeBuild } from "./theme-build.js";

export type PushThemeOptions = {
  dryRun: boolean;
  build: boolean;
  skipBuildCheck: boolean;
};

export async function cmdPushTheme(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PushThemeOptions,
): Promise<void> {
  const remote = getRemoteEnv(loaded.config, env);
  const { deployDir, slug } = resolveThemePaths(loaded);

  if (env === "production" && !options.dryRun) {
    const ok = await confirmProduction(
      `You are about to push THEME FILES ONLY to PRODUCTION (${slug}).\n` +
        "The remote database and uploads will NOT be changed.",
    );
    if (!ok) {
      logInfo("push theme production: user aborted");
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.build && !options.dryRun) {
    await cmdThemeBuild(loaded, { quiet: true });
  } else if (!options.skipBuildCheck && !options.dryRun) {
    const check = checkThemeBuildArtifacts(deployDir);
    if (!check.ok) {
      console.error(check.issues.join("\n"));
      console.error(
        "\nRun with --build to compile first, or --skip-build-check to deploy anyway.",
      );
      throw new Error("Theme build check failed");
    }
  }

  if (options.dryRun) {
    logInfo(`push theme ${env} dry-run: rsync only (no database)`);
    console.error(
      `[dry-run] Would rsync ${deployDir} → remote wp-content/themes/${slug}/ (no DB changes).`,
    );
  }

  logInfo(`push theme ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  try {
    const remoteWp = await resolveRemoteWpPath(ssh, remote.path);
    if (!remoteWp.installed || !remoteWp.path) {
      throw new Error(
        `Remote WordPress not found at ${remote.path}. Install WordPress before pushing a theme.`,
      );
    }

    const target = remoteThemePath(remoteWp.path, slug);
    logInfo(`push theme ${env}: rsync ${deployDir} → ${target}`);

    await rsyncPushToPath(remote, deployDir, target, {
      dryRun: options.dryRun,
    });

    if (!options.dryRun) {
      console.error(
        `\nTheme "${slug}" pushed to ${env} (files only — database unchanged).\n` +
          `Verify at ${remote.url} and clear host cache if needed.`,
      );
    }
  } finally {
    ssh.dispose();
  }
}
