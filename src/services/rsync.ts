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
  const runPull = async (targetPath: string) => {
    const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
    const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
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
    return execa("rsync", args, {
      reject: false,
      stdout: "inherit",
      stderr: "pipe",
    });
  };

  const first = await runPull(remote.path);
  if (first.stderr) process.stderr.write(first.stderr);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  const canRetryRelative =
    remote.path.startsWith("/") &&
    /No such file or directory|change_dir .* failed/i.test(firstErr);
  if (canRetryRelative) {
    const relPath = remote.path.replace(/^\/+/, "");
    const retry = await runPull(relPath);
    if (retry.stderr) process.stderr.write(retry.stderr);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] pull retry succeeded using relative remote path "${relPath}" instead of "${remote.path}".\n` +
          `Update your config path to "${relPath}" for shared hosting compatibility.\n`,
      );
      return;
    }
    const err = retry.stderr ?? "";
    let hint = "";
    if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nLikely fix: Docker created files under wordpress/ as www-data, so host rsync cannot write. From the repo root run:\n  npm run wp-dev -- fix-permissions\nThen retry this pull.";
    }
    if (/inflate returned/i.test(err)) {
      hint +=
        "\n\n(If you also see rsync inflate errors, they are often a follow-on after partial writes; retry after fix-permissions.)";
    }
    throw new Error(`rsync pull failed with exit code ${retry.exitCode}${hint}`);
  }

  {
    const err = firstErr;
    let hint = "";
    if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nLikely fix: Docker created files under wordpress/ as www-data, so host rsync cannot write. From the repo root run:\n  npm run wp-dev -- fix-permissions\nThen retry this pull.";
    }
    if (/inflate returned/i.test(err)) {
      hint +=
        "\n\n(If you also see rsync inflate errors, they are often a follow-on after partial writes; retry after fix-permissions.)";
    }
    throw new Error(`rsync pull failed with exit code ${first.exitCode}${hint}`);
  }
}

export async function rsyncPushToPath(
  remote: RemoteEnvConfig,
  localDir: string,
  remoteTargetPath: string,
  options: RsyncOptions,
): Promise<void> {
  const runPush = async (targetPath: string) => {
    const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
    const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
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
    return execa("rsync", args, {
      reject: false,
      stdout: "inherit",
      stderr: "pipe",
    });
  };

  const first = await runPush(remoteTargetPath);
  if (first.stderr) process.stderr.write(first.stderr);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  const canRetryRelative =
    remoteTargetPath.startsWith("/") &&
    /mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(firstErr);
  if (canRetryRelative) {
    const relPath = remoteTargetPath.replace(/^\/+/, "");
    const retry = await runPush(relPath);
    if (retry.stderr) process.stderr.write(retry.stderr);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] rsync retry succeeded using relative remote path "${relPath}".\n`,
      );
      return;
    }
    throw new Error(`rsync push failed with exit code ${retry.exitCode}`);
  }
  throw new Error(`rsync push failed with exit code ${first.exitCode}`);
}

export async function rsyncPush(
  remote: RemoteEnvConfig,
  localDir: string,
  options: RsyncOptions,
): Promise<void> {
  const runPush = async (targetPath: string) => {
    const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
    const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
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
    return execa("rsync", args, {
      reject: false,
      stdout: "inherit",
      stderr: "pipe",
    });
  };

  const first = await runPush(remote.path);
  if (first.stderr) process.stderr.write(first.stderr);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  const canRetryRelative =
    remote.path.startsWith("/") &&
    /mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(firstErr);
  if (canRetryRelative) {
    const relPath = remote.path.replace(/^\/+/, "");
    const retry = await runPush(relPath);
    if (retry.stderr) process.stderr.write(retry.stderr);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] push retry succeeded using relative remote path "${relPath}" instead of "${remote.path}".\n` +
          `Update your config path to "${relPath}" for shared hosting compatibility.\n`,
      );
      return;
    }
    const err = retry.stderr ?? "";
    let hint = "";
    if (/mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(err)) {
      hint =
        `\n\nRemote path is not writable: ${relPath}\n` +
        "Check staging.path/production.path and ensure the SSH user can create/write files there.";
    } else if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nRsync hit a permission error during push. Verify remote directory permissions first. " +
        "If the error clearly references local wordpress/ ownership, run:\n  npm run wp-dev -- fix-permissions\nThen retry.";
    }
    throw new Error(`rsync push failed with exit code ${retry.exitCode}${hint}`);
  }

  {
    const err = firstErr;
    let hint = "";
    if (/mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(err)) {
      hint =
        `\n\nRemote path is not writable: ${remote.path}\n` +
        "Check staging.path/production.path and ensure the SSH user can create/write files there. " +
        "On shared hosting this is often a relative subdomain folder (e.g. /staging) inside your account, not a system root path.";
    } else if (/Permission denied|mkstemp|Operation not permitted/i.test(err)) {
      hint =
        "\n\nRsync hit a permission error during push. Verify remote directory permissions first. " +
        "If the error clearly references local wordpress/ ownership, run:\n  npm run wp-dev -- fix-permissions\nThen retry.";
    }
    throw new Error(`rsync push failed with exit code ${first.exitCode}${hint}`);
  }
}

/**
 * Pull a subdirectory from the remote host (e.g. wp-content/themes/my-theme).
 */
export async function rsyncPullFromPath(
  remote: RemoteEnvConfig,
  remoteSourcePath: string,
  localDir: string,
  options: RsyncOptions,
): Promise<void> {
  const runPull = async (sourcePath: string) => {
    const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
    const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
    const remoteUrl = `${remote.user}@${remote.host}:${sourcePath.replace(/\/$/, "")}/`;
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
    return execa("rsync", args, {
      reject: false,
      stdout: "inherit",
      stderr: "pipe",
    });
  };

  const first = await runPull(remoteSourcePath);
  if (first.stderr) process.stderr.write(first.stderr);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  const canRetryRelative =
    remoteSourcePath.startsWith("/") &&
    /No such file or directory|change_dir .* failed/i.test(firstErr);
  if (canRetryRelative) {
    const relPath = remoteSourcePath.replace(/^\/+/, "");
    const retry = await runPull(relPath);
    if (retry.stderr) process.stderr.write(retry.stderr);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] pull retry succeeded using relative remote path "${relPath}".\n`,
      );
      return;
    }
    throw new Error(`rsync pull failed with exit code ${retry.exitCode}`);
  }

  let hint = "";
  if (/Permission denied|mkstemp|Operation not permitted/i.test(firstErr)) {
    hint =
      "\n\nLikely fix: run `npm run wp-dev -- fix-permissions` then retry pull theme.";
  }
  throw new Error(`rsync pull failed with exit code ${first.exitCode}${hint}`);
}
