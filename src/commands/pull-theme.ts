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
import { runLocalWordpressFileMutation } from "../fs/index.js";

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

    if (options.dryRun) {
      await rsyncPullFromPath(remote, source, deployDir, { dryRun: true });
      return;
    }

    await runLocalWordpressFileMutation(loaded, { label: `pull theme ${env}` }, async () => {
      await rsyncPullFromPath(remote, source, deployDir, { dryRun: false });
    });

    console.error(
      `\nTheme "${slug}" pulled from ${env} into ${deployDir} (database unchanged).`,
    );
  } finally {
    ssh.dispose();
  }
}
