import type { RemoteEnvConfig } from "../config/schema.js";
import { resolveIdentityFile } from "./remote-config-helpers.js";

/** Allowlist aligned with docker/runner-remote-env.mjs SAFE. */
const SAFE_SSH_FIELD = /^[a-zA-Z0-9._:@~/-]+$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafeSshField(label: string, value: string): void {
  if (!SAFE_SSH_FIELD.test(value)) {
    throw new Error(`Unsafe SSH ${label} for rsync -e (disallowed characters): ${value}`);
  }
}

/** SSH options passed to rsync via `-e` (BatchMode, identity file, port). */
export function buildSshRsyncEnv(remote: RemoteEnvConfig): string {
  assertSafeSshField("host", remote.host);
  assertSafeSshField("user", remote.user);
  assertSafeSshField("path", remote.path);
  // Keepalive helps long transfers on shared hosting / flaky links (rsync uses this SSH).
  const parts = [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    // Align with node-ssh assertSshHostPinned: refuse unknown/changed keys (no TOFU).
    "StrictHostKeyChecking=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=10",
    "-o",
    "TCPKeepAlive=yes",
  ];
  if (remote.port != null) {
    parts.push("-p", String(remote.port));
  }
  const key = resolveIdentityFile(remote.identityFile);
  if (key) {
    assertSafeSshField("identityFile", key);
    parts.push("-i", shellQuote(key));
  }
  return parts.join(" ");
}

export function canRetryPullWithRelativePath(remotePath: string, stderr: string): boolean {
  return (
    remotePath.startsWith("/") &&
    /No such file or directory|change_dir .* failed/i.test(stderr)
  );
}

/**
 * Only retry absolute→relative when the *destination root* itself cannot be created.
 * Mid-tree mkdir failures must not strip leading `/` (files could land under $HOME).
 */
export function canRetryPushWithRelativePath(remotePath: string, stderr: string): boolean {
  if (!remotePath.startsWith("/")) return false;
  const normalized = remotePath.replace(/\/$/, "");
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootMkdir = new RegExp(
    `(?:recv_generator:\\s*)?mkdir\\s+["']?${escaped}["']?\\s+failed:\\s*Permission denied`,
    "i",
  );
  return rootMkdir.test(stderr);
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
