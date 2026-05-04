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
  const r = await execa("rsync", args, {
    reject: false,
    stdout: "inherit",
    stderr: "pipe",
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.exitCode !== 0) {
    const err = r.stderr ?? "";
    let hint = "";
    if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nLikely fix: Docker created files under wordpress/ as www-data, so host rsync cannot write. From the repo root run:\n  npm run wp-dev -- fix-permissions\nThen retry this pull.";
    }
    if (/inflate returned/i.test(err)) {
      hint +=
        "\n\n(If you also see rsync inflate errors, they are often a follow-on after partial writes; retry after fix-permissions.)";
    }
    throw new Error(`rsync pull failed with exit code ${r.exitCode}${hint}`);
  }
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
  const r = await execa("rsync", args, {
    reject: false,
    stdout: "inherit",
    stderr: "pipe",
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.exitCode !== 0) {
    const err = r.stderr ?? "";
    let hint = "";
    if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nLikely fix: host rsync cannot write into wordpress/ (ownership). Run:\n  npm run wp-dev -- fix-permissions\nThen retry.";
    }
    throw new Error(`rsync push failed with exit code ${r.exitCode}${hint}`);
  }
}
