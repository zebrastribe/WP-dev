import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteEnvConfig } from "../config/schema.js";
import { resolveIdentityFile, preferTildePath } from "./remote-config-helpers.js";
import { buildSshPinCommand } from "./ssh-host-key.js";

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
  // Ignore bind-mounted ~/.ssh/config: OpenSSH as root rejects a host-owned config
  // ("Bad owner or permissions"). Identity + known_hosts are passed explicitly.
  const knownHosts = join(homedir(), ".ssh", "known_hosts");
  assertSafeSshField("knownHosts", knownHosts);
  const parts = [
    "ssh",
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    // Align with node-ssh assertSshHostPinned: refuse unknown/changed keys (no TOFU).
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${shellQuote(knownHosts)}`,
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
    // Prevent OpenSSH from offering other default keys before the configured one
    parts.push("-o", "IdentitiesOnly=yes");
  }
  return parts.join(" ");
}

export type RsyncDirection = "pull" | "push";

export function classifyRsyncSshError(
  stderr: string,
  direction: RsyncDirection = "pull",
): "unprotected_key" | "publickey_denied" | "host_not_pinned" | "local_permission" | "remote_permission" | "unknown" {
  if (/UNPROTECTED PRIVATE KEY FILE|Permissions .* are too open/i.test(stderr)) {
    return "unprotected_key";
  }
  if (/Permission denied \(publickey|All configured authentication methods failed/i.test(stderr)) {
    return "publickey_denied";
  }
  if (/Host key verification failed|not pinned|No .* host key is known/i.test(stderr)) {
    return "host_not_pinned";
  }
  if (/mkstemp.*Permission denied|Operation not permitted.*wordpress/i.test(stderr)) {
    return "local_permission";
  }
  if (/mkdir.*failed.*Permission denied|recv_generator.*Permission denied/i.test(stderr)) {
    return direction === "pull" ? "local_permission" : "remote_permission";
  }
  return "unknown";
}

export function formatRsyncSshErrorHint(
  errorType: ReturnType<typeof classifyRsyncSshError>,
  identityFile?: string,
  remote?: RemoteEnvConfig,
  remotePath?: string,
): string {
  const keyPath = identityFile
    ? preferTildePath(resolveIdentityFile(identityFile) ?? identityFile)
    : "~/.ssh/id_ed25519";

  switch (errorType) {
    case "unprotected_key":
      return (
        `\n\nSSH key has insecure permissions. Run:\n  chmod 600 ${keyPath}\n` +
        "OpenSSH refuses keys readable by other users."
      );
    case "publickey_denied":
      return (
        `\n\nSSH key was rejected by the server.\n` +
        `Ensure the public key is authorized on the remote host:\n` +
        `  cat ${keyPath}.pub\n` +
        "Add this to the hosting panel's SSH keys, or to ~/.ssh/authorized_keys on the server."
      );
    case "host_not_pinned": {
      const pinCmd = remote ? buildSshPinCommand(remote) : "ssh <user>@<host>";
      return (
        "\n\nSSH host key is not pinned. Connect once with OpenSSH to verify and pin:\n" +
        `  ${pinCmd}\n` +
        "Accept the fingerprint when prompted."
      );
    }
    case "local_permission":
      return (
        "\n\nLocal permission error (Docker ownership). Run:\n" +
        "  npm run wp-dev -- fix-permissions\n" +
        "Then retry."
      );
    case "remote_permission": {
      const pathInfo = remotePath ? `Remote path is not writable: ${remotePath}\n` : "";
      return (
        `\n\n${pathInfo}` +
        "Check staging.path/production.path and ensure the SSH user has write access."
      );
    }
    default:
      return "";
  }
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

export function pullRsyncFailureHint(stderr: string, identityFile?: string, remote?: RemoteEnvConfig): string {
  const errorType = classifyRsyncSshError(stderr, "pull");
  const hint = formatRsyncSshErrorHint(errorType, identityFile, remote);
  if (hint) return hint;

  if (/Permission denied|mkstemp|Operation not permitted/i.test(stderr)) {
    return (
      "\n\nLikely fix: Docker created files under wordpress/ as www-data, so host rsync cannot write. From the repo root run:\n" +
      "  npm run wp-dev -- fix-permissions\nThen retry this pull."
    );
  }
  if (/inflate returned/i.test(stderr)) {
    return "\n\n(Rsync inflate errors are often a follow-on after partial writes; retry after fix-permissions.)";
  }
  return "";
}

export function pushRsyncFailureHint(stderr: string, remotePath: string, identityFile?: string, remote?: RemoteEnvConfig): string {
  const errorType = classifyRsyncSshError(stderr, "push");
  const hint = formatRsyncSshErrorHint(errorType, identityFile, remote, remotePath);
  if (hint) return hint;

  if (/Permission denied|mkstemp|Operation not permitted/i.test(stderr)) {
    return (
      "\n\nRsync hit a permission error during push. Verify remote directory permissions first. " +
      "If the error clearly references local wordpress/ ownership, run:\n  npm run wp-dev -- fix-permissions\nThen retry."
    );
  }
  return "";
}

export function pushRsyncFailureHintAbsolutePath(stderr: string, remotePath: string, identityFile?: string, remote?: RemoteEnvConfig): string {
  const hint = pushRsyncFailureHint(stderr, remotePath, identityFile, remote);
  if (hint) return hint;

  if (remotePath.startsWith("/") && /Permission denied/i.test(stderr)) {
    return (
      `\n\nRemote path is not writable: ${remotePath}\n` +
      "On shared hosting this is often a relative subdomain folder (e.g. /staging) inside your account, not a system root path."
    );
  }
  return "";
}
