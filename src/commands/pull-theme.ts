import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPullFromPath } from "../services/rsync.js";
import {
  remoteThemePath,
  resolveThemePaths,
} from "../services/theme-path.js";
import { resolveRemoteWpPath } from "../services/wpcli.js";
import { assertRemotePathSafe } from "../services/remote-path-safety.js";
import { logInfo } from "../utils/logger.js";
import {
  reconcileAfterPull,
  reconcileHostWritableForRsync,
} from "../fs/index.js";

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
      // Same as full pull: host-own before rsync so the bind mount is writable.
      await reconcileHostWritableForRsync(loaded);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logInfo(`pull theme ${env}: pre-rsync host ownership failed (${msg})`);
    }
  }

  logInfo(`pull theme ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    const remoteWp = await resolveRemoteWpPath(ssh, remote.path);
    if (!remoteWp.installed || !remoteWp.path) {
      throw new Error(`Remote WordPress not found at ${remote.path}`);
    }

    const source = remoteThemePath(remoteWp.path, slug);
    logInfo(`pull theme ${env}: rsync ${source} → ${deployDir}`);
    // Dispose control SSH before host rsync (idle node-ssh must not crash mid-transfer).
    ssh.dispose();

    await rsyncPullFromPath(remote, source, deployDir, {
      dryRun: options.dryRun,
    });

    if (!options.dryRun) {
      try {
        await reconcileAfterPull(loaded);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logInfo(`pull theme ${env}: post-pull permission reconcile failed (${msg})`);
        console.error(
          "Warning: could not apply WordPress write permissions after theme pull. " +
            "Run: npm run wp-dev -- fix-runtime-permissions",
        );
      }
      console.error(
        `\nTheme "${slug}" pulled from ${env} into ${deployDir} (database unchanged).`,
      );
    }
  } finally {
    ssh.dispose();
  }
}
