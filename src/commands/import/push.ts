import { join } from "node:path";
import type { LoadedConfig } from "../../config/load.js";
import type { RemoteEnvName } from "../../config/schema.js";
import { getRemoteEnv } from "../../config/schema.js";
import { rsyncPushToPath } from "../../services/rsync.js";
import { connectSsh } from "../../services/ssh.js";
import { confirmProduction } from "../../utils/confirm.js";
import { loadImportBasicAuth, writeImportRemoteConfig } from "../../utils/import-basic-auth.js";
import {
  isPlaceholderRemoteHost,
  isStagingRemotePlaceholder,
} from "../../utils/remote-placeholder.js";

export async function cmdImportPush(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: { dryRun?: boolean },
): Promise<void> {
  if (env === "staging" && isStagingRemotePlaceholder(loaded.config)) {
    throw new Error(
      "staging in wp-dev.config.json is still a placeholder (staging.example.invalid).\n\n" +
        "Configure a real staging server before import push staging:\n" +
        "  1. wp-dev simply setup-staging-dns timework.dk   (Simply DNS + config hints)\n" +
        "  2. Or edit staging.host / staging.path / staging.url / identityFile manually\n" +
        "  3. Verify: wp-dev doctor staging\n\n" +
        "See WP-dev/content-recovery-workspace/DEPLOY.md",
    );
  }

  const remote = getRemoteEnv(loaded.config, env);
  if (isPlaceholderRemoteHost(remote.host)) {
    throw new Error(
      `${env}.host is a placeholder (${remote.host}). Edit wp-dev.config.json before import push ${env}.`,
    );
  }
  if (env === "production" && !options.dryRun) {
    const ok = await confirmProduction(
      "You are about to push the import workspace to PRODUCTION.",
    );
    if (!ok) {
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  const dryRun = Boolean(options.dryRun);
  const importDir = join(loaded.configDir, "wordpress", "import");
  const storageDir = join(
    loaded.configDir,
    "content-recovery-workspace",
    "storage",
    loaded.config.project,
  );

  const remoteImport = `${remote.path.replace(/\/$/, "")}/import`;
  const remoteStorage = `${remoteImport}/storage/${loaded.config.project}`;

  const basicAuth = loadImportBasicAuth(loaded.configDir);
  writeImportRemoteConfig(importDir, loaded.config.project, basicAuth);
  if (basicAuth) {
    console.log(
      `[wp-dev] import push ${env}: PHP HTTP Basic Auth enabled for user ${basicAuth.user}`,
    );
  } else if (!dryRun) {
    console.warn(
      "[wp-dev] import push: no import.auth.env — /import/ will be open. Copy import.auth.env.example to import.auth.env",
    );
  }

  console.log(`[wp-dev] import push ${env}: ${importDir} → ${remoteImport}/`);
  await rsyncPushToPath(remote, importDir, remoteImport, { dryRun });

  if (!dryRun) {
    const ssh = await connectSsh(remote);
    try {
      const mkdir = await ssh.exec(`mkdir -p ${shellQuote(remoteStorage)}`);
      if (mkdir.code !== 0) {
        throw new Error(
          `Failed to create remote storage directory ${remoteStorage}: ${mkdir.stderr || mkdir.stdout}`,
        );
      }
    } finally {
      ssh.dispose();
    }
  }

  console.log(`[wp-dev] import push ${env}: storage → ${remoteStorage}/`);
  await rsyncPushToPath(remote, storageDir, remoteStorage, { dryRun });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
