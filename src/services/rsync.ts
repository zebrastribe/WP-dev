import { execa } from "execa";
import type { RemoteEnvConfig } from "../config/schema.js";

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "wp-content/cache",
  "wp-content/uploads/cache",
  ".DS_Store",
  /** Keep environment-specific installs working (Docker DB vs remote DB). */
  "wp-config.php",
];

function buildSshRsyncEnv(remote: RemoteEnvConfig): string {
  const parts = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (remote.port != null) {
    parts.push("-p", String(remote.port));
  }
  if (remote.identityFile) {
    parts.push("-i", remote.identityFile);
  }
  return parts.join(" ");
}

export type RsyncOptions = {
  dryRun: boolean;
  excludes?: string[];
};

export async function rsyncPull(
  remote: RemoteEnvConfig,
  localDir: string,
  options: RsyncOptions,
): Promise<void> {
  const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
  const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
  const remoteUrl = `${remote.user}@${remote.host}:${remote.path.replace(/\/$/, "")}/`;
  const args = [
    "-avz",
    ...excludeArgs,
    "--no-owner",
    "--no-group",
    "-e",
    buildSshRsyncEnv(remote),
    ...(options.dryRun ? ["--dry-run"] : []),
    remoteUrl,
    localDir.replace(/\/$/, "") + "/",
  ];
  await execa("rsync", args, { stdio: "inherit", reject: false }).then((r) => {
    if (r.exitCode !== 0) {
      throw new Error(`rsync pull failed with exit code ${r.exitCode}`);
    }
  });
}

export async function rsyncPush(
  remote: RemoteEnvConfig,
  localDir: string,
  options: RsyncOptions,
): Promise<void> {
  const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
  const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
  const remoteUrl = `${remote.user}@${remote.host}:${remote.path.replace(/\/$/, "")}/`;
  const args = [
    "-avz",
    ...excludeArgs,
    "--no-owner",
    "--no-group",
    "-e",
    buildSshRsyncEnv(remote),
    ...(options.dryRun ? ["--dry-run"] : []),
    localDir.replace(/\/$/, "") + "/",
    remoteUrl,
  ];
  await execa("rsync", args, { stdio: "inherit", reject: false }).then((r) => {
    if (r.exitCode !== 0) {
      throw new Error(`rsync push failed with exit code ${r.exitCode}`);
    }
  });
}
