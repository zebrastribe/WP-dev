import type { RemoteEnvConfig } from "../config/schema.js";

/** SSH options passed to rsync via `-e` (BatchMode, identity file, port). */
export function buildSshRsyncEnv(remote: RemoteEnvConfig): string {
  const parts = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (remote.port != null) {
    parts.push("-p", String(remote.port));
  }
  if (remote.identityFile) {
    parts.push("-i", remote.identityFile);
  }
  return parts.join(" ");
}

export function canRetryPullWithRelativePath(remotePath: string, stderr: string): boolean {
  return (
    remotePath.startsWith("/") &&
    /No such file or directory|change_dir .* failed/i.test(stderr)
  );
}

export function canRetryPushWithRelativePath(remotePath: string, stderr: string): boolean {
  return (
    remotePath.startsWith("/") &&
    /mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(
      stderr,
    )
  );
}

export function pullRsyncFailureHint(stderr: string): string {
  let hint = "";
  if (/Permission denied|mkstemp|Operation not permitted/i.test(stderr)) {
    hint =
      "\n\nLikely fix: Docker created files under wordpress/ as www-data, so host rsync cannot write. From the repo root run:\n  npm run wp-dev -- fix-permissions\nThen retry this pull.";
  }
  if (/inflate returned/i.test(stderr)) {
    hint +=
      "\n\n(If you also see rsync inflate errors, they are often a follow-on after partial writes; retry after fix-permissions.)";
  }
  return hint;
}

export function pushRsyncFailureHint(stderr: string, remotePath: string): string {
  let hint = "";
  if (/mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(stderr)) {
    hint =
      `\n\nRemote path is not writable: ${remotePath}\n` +
      "Check staging.path/production.path and ensure the SSH user can create/write files there.";
  } else if (/Permission denied|mkstemp|Operation not permitted/i.test(stderr)) {
    hint =
      "\n\nRsync hit a permission error during push. Verify remote directory permissions first. " +
      "If the error clearly references local wordpress/ ownership, run:\n  npm run wp-dev -- fix-permissions\nThen retry.";
  }
  return hint;
}

export function pushRsyncFailureHintAbsolutePath(stderr: string, remotePath: string): string {
  let hint = pushRsyncFailureHint(stderr, remotePath);
  if (
    !hint &&
    /mkdir .* failed: Permission denied|recv_generator: mkdir .* failed: Permission denied/i.test(stderr)
  ) {
    hint =
      `\n\nRemote path is not writable: ${remotePath}\n` +
      "Check staging.path/production.path and ensure the SSH user can create/write files there. " +
      "On shared hosting this is often a relative subdomain folder (e.g. /staging) inside your account, not a system root path.";
  }
  return hint;
}
