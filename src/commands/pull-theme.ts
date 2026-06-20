import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPullFromPath } from "../services/rsync.js";
import {
  remoteThemePath,
  resolveThemePaths,
} from "../services/theme-path.js";
import { resolveRemoteWpPath } from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";
import {
  cmdFixPermissions,
  cmdFixRuntimeWritePermissions,
} from "./fix-permissions.js";

export type PullThemeOptions = {
  dryRun: boolean;
};

export async function cmdPullTheme(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PullThemeOptions,
): Promise<void> {
  const remote = getRemoteEnv(loaded.config, env);
  const { deployDir, slug } = resolveThemePaths(loaded);

  if (options.dryRun) {
    logInfo(`pull theme ${env} dry-run: rsync only (no database)`);
    console.error(
      `[dry-run] Would rsync remote wp-content/themes/${slug}/ → ${deployDir} (no DB changes).`,
    );
  }

  if (!options.dryRun) {
    try {
      await cmdFixPermissions(loaded, { quiet: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logInfo(`pull theme ${env}: fix-permissions failed (${msg})`);
    }
  }

  logInfo(`pull theme ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  try {
    const remoteWp = await resolveRemoteWpPath(ssh, remote.path);
    if (!remoteWp.installed || !remoteWp.path) {
      throw new Error(`Remote WordPress not found at ${remote.path}`);
    }

    const source = remoteThemePath(remoteWp.path, slug);
    logInfo(`pull theme ${env}: rsync ${source} → ${deployDir}`);

    await rsyncPullFromPath(remote, source, deployDir, {
      dryRun: options.dryRun,
    });

    if (!options.dryRun) {
      try {
        await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logInfo(`pull theme ${env}: runtime permissions step failed (${msg})`);
      }
      console.error(
        `\nTheme "${slug}" pulled from ${env} into ${deployDir} (database unchanged).`,
      );
    }
  } finally {
    ssh.dispose();
  }
}
