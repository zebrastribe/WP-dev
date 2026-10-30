import { execa } from "execa";
import type { RemoteEnvConfig } from "../config/schema.js";
import { SAFE_SYNC_EXCLUDES } from "./sync-excludes.js";
import {
  buildSshRsyncEnv,
  canRetryPullWithRelativePath,
  canRetryPushWithRelativePath,
  pullRsyncFailureHint,
  pushRsyncFailureHint,
  pushRsyncFailureHintAbsolutePath,
} from "../utils/rsync-ssh-env.js";
import {
  runRsyncWithConnectionRetries,
  type RsyncAttemptResult,
} from "../utils/rsync-retry.js";

export type RsyncOptions = {
  dryRun: boolean;
  excludes?: string[];
  /** Override remote.path — use resolved WP install path when it differs from config. */
  remotePath?: string;
};

/** Shared flags: archive/compress, keep partial files for resume after drops. */
const RSYNC_BASE_FLAGS = [
  "-avz",
  "--partial",
  // Idle I/O timeout (seconds) — hung SSH dies so connection retries can resume.
  "--timeout=300",
] as const;

function logRsyncRetry(info: {
  attempt: number;
  maxAttempts: number;
  exitCode: number | null;
  delayMs: number;
}): void {
  const next = info.attempt + 1;
  const waitSec = Math.max(1, Math.round(info.delayMs / 1000));
  process.stderr.write(
    `\n[wp-dev] rsync connection dropped (exit ${info.exitCode ?? "?"}); ` +
      `retry ${next}/${info.maxAttempts} in ${waitSec}s (incremental resume)…\n`,
  );
}

function parseDryRunStats(output: string): { fileCount: number; totalBytes: number } | null {
  const filesMatch = output.match(/Number of regular files transferred:\s*([\d,]+)/i);
  const sizeMatch = output.match(/Total transferred file size:\s*([\d,]+)/i);
  if (!filesMatch && !sizeMatch) return null;
  const fileCount = filesMatch ? parseInt(filesMatch[1].replace(/,/g, ""), 10) : 0;
  const totalBytes = sizeMatch ? parseInt(sizeMatch[1].replace(/,/g, ""), 10) : 0;
  return { fileCount, totalBytes };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function execRsync(
  args: string[],
  options: { dryRun: boolean },
): Promise<RsyncAttemptResult> {
  const envBase = Number(process.env.WPDEV_RSYNC_RETRY_BASE_MS);
  const finalArgs = options.dryRun ? [...args, "--stats"] : args;
  const result = await runRsyncWithConnectionRetries(
    async () => {
      if (options.dryRun) {
        const r = await execa("rsync", finalArgs, {
          reject: false,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (r.stdout) {
          process.stdout.write(r.stdout);
          if (!r.stdout.endsWith("\n")) process.stdout.write("\n");
        }
        return { exitCode: r.exitCode ?? null, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
      } else {
        const r = await execa("rsync", finalArgs, {
          reject: false,
          stdout: "inherit",
          stderr: "pipe",
        });
        return { exitCode: r.exitCode ?? null, stderr: r.stderr ?? "", stdout: "" };
      }
    },
    {
      maxAttempts: options.dryRun ? 2 : 5,
      baseDelayMs: Number.isFinite(envBase) && envBase >= 0 ? envBase : 2_000,
      onRetry: logRsyncRetry,
    },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  if (options.dryRun && result.stdout) {
    const summary = parseDryRunStats(result.stdout);
    if (summary && (summary.fileCount > 0 || summary.totalBytes > 0)) {
      console.error(`\n\n[dry-run summary] ${summary.fileCount} files, ${formatBytes(summary.totalBytes)} total\n`);
    }
  }
  return result;
}

function buildExcludeArgs(excludes: string[]): string[] {
  return excludes.flatMap((e) => ["--exclude", e]);
}

export async function rsyncPull(
  remote: RemoteEnvConfig,
  localDir: string,
  options: RsyncOptions,
): Promise<void> {
  const runPull = async (targetPath: string) => {
    const excludes = options.excludes ?? [...SAFE_SYNC_EXCLUDES];
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
    const args = [
      ...RSYNC_BASE_FLAGS,
      ...buildExcludeArgs(excludes),
      "--no-owner",
      "--no-group",
      "-e",
      buildSshRsyncEnv(remote),
      ...(options.dryRun ? ["--dry-run"] : []),
      remoteUrl,
      localDir.replace(/\/$/, "") + "/",
    ];
    return execRsync(args, { dryRun: options.dryRun });
  };

  const sourcePath = options.remotePath ?? remote.path;
  const first = await runPull(sourcePath);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  if (canRetryPullWithRelativePath(sourcePath, firstErr)) {
    const relPath = sourcePath.replace(/^\/+/, "");
    const retry = await runPull(relPath);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] pull retry succeeded using relative remote path "${relPath}" instead of "${sourcePath}".\n` +
          `Update your config path to "${relPath}" for shared hosting compatibility.\n`,
      );
      return;
    }
    const err = retry.stderr ?? "";
    throw new Error(`rsync pull failed with exit code ${retry.exitCode}${pullRsyncFailureHint(err, remote.identityFile, remote)}`);
  }

  throw new Error(`rsync pull failed with exit code ${first.exitCode}${pullRsyncFailureHint(firstErr, remote.identityFile, remote)}`);
}

export async function rsyncPushToPath(
  remote: RemoteEnvConfig,
  localDir: string,
  remoteTargetPath: string,
  options: RsyncOptions,
): Promise<void> {
  const runPush = async (targetPath: string) => {
    const excludes = options.excludes ?? [...SAFE_SYNC_EXCLUDES];
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
    const args = [
      ...RSYNC_BASE_FLAGS,
      ...buildExcludeArgs(excludes),
      "--no-owner",
      "--no-group",
      "-e",
      buildSshRsyncEnv(remote),
      ...(options.dryRun ? ["--dry-run"] : []),
      localDir.replace(/\/$/, "") + "/",
      remoteUrl,
    ];
    return execRsync(args, { dryRun: options.dryRun });
  };

  const first = await runPush(remoteTargetPath);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  if (canRetryPushWithRelativePath(remoteTargetPath, firstErr)) {
    const relPath = remoteTargetPath.replace(/^\/+/, "");
    const retry = await runPush(relPath);
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
    const excludes = options.excludes ?? [...SAFE_SYNC_EXCLUDES];
    const remoteUrl = `${remote.user}@${remote.host}:${targetPath.replace(/\/$/, "")}/`;
    const args = [
      ...RSYNC_BASE_FLAGS,
      ...buildExcludeArgs(excludes),
      "--no-owner",
      "--no-group",
      "-e",
      buildSshRsyncEnv(remote),
      ...(options.dryRun ? ["--dry-run"] : []),
      localDir.replace(/\/$/, "") + "/",
      remoteUrl,
    ];
    return execRsync(args, { dryRun: options.dryRun });
  };

  const destPath = options.remotePath ?? remote.path;
  const first = await runPush(destPath);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  if (canRetryPushWithRelativePath(destPath, firstErr)) {
    const relPath = destPath.replace(/^\/+/, "");
    const retry = await runPush(relPath);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] push retry succeeded using relative remote path "${relPath}" instead of "${destPath}".\n` +
          `Update your config path to "${relPath}" for shared hosting compatibility.\n`,
      );
      return;
    }
    const err = retry.stderr ?? "";
    throw new Error(
      `rsync push failed with exit code ${retry.exitCode}${pushRsyncFailureHint(err, relPath, remote.identityFile, remote)}`,
    );
  }

  throw new Error(
    `rsync push failed with exit code ${first.exitCode}${pushRsyncFailureHintAbsolutePath(firstErr, destPath, remote.identityFile, remote)}`,
  );
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
    const excludes = options.excludes ?? [...SAFE_SYNC_EXCLUDES];
    const remoteUrl = `${remote.user}@${remote.host}:${sourcePath.replace(/\/$/, "")}/`;
    const args = [
      ...RSYNC_BASE_FLAGS,
      ...buildExcludeArgs(excludes),
      "--no-owner",
      "--no-group",
      "-e",
      buildSshRsyncEnv(remote),
      ...(options.dryRun ? ["--dry-run"] : []),
      remoteUrl,
      localDir.replace(/\/$/, "") + "/",
    ];
    return execRsync(args, { dryRun: options.dryRun });
  };

  const first = await runPull(remoteSourcePath);
  if (first.exitCode === 0) return;

  const firstErr = first.stderr ?? "";
  const canRetryRelative =
    remoteSourcePath.startsWith("/") &&
    /No such file or directory|change_dir .* failed/i.test(firstErr);
  if (canRetryRelative) {
    const relPath = remoteSourcePath.replace(/^\/+/, "");
    const retry = await runPull(relPath);
    if (retry.exitCode === 0) {
      process.stderr.write(
        `\n[wp-dev] pull retry succeeded using relative remote path "${relPath}".\n`,
      );
      return;
    }
    throw new Error(`rsync pull failed with exit code ${retry.exitCode}`);
  }

  const hint = pullRsyncFailureHint(firstErr, remote.identityFile, remote);
  throw new Error(`rsync pull failed with exit code ${first.exitCode}${hint}`);
}
