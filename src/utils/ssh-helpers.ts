import { existsSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { NodeSSH } from "node-ssh";
import type { RemoteEnvConfig } from "../config/schema.js";
import { resolveIdentityFile, preferTildePath } from "./remote-config-helpers.js";
import { assertSshHostPinned, createSshHostVerifier, buildSshPinCommand } from "./ssh-host-key.js";

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export type SshConfigResolution = {
  hostname: string;
  user?: string;
  port?: number;
  identityFile?: string;
  isAlias: boolean;
};

const sshConfigCache = new Map<string, SshConfigResolution | null>();

export function resolveSshConfigAlias(host: string): SshConfigResolution | null {
  if (sshConfigCache.has(host)) {
    return sshConfigCache.get(host)!;
  }

  let result: SshConfigResolution | null = null;
  try {
    const spawnResult = spawnSync("ssh", ["-G", host], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (spawnResult.status === 0) {
      const output = spawnResult.stdout ?? "";
      const lines = output.split("\n");
      const values: Record<string, string> = {};
      for (const line of lines) {
        const [key, ...rest] = line.split(" ");
        if (key && rest.length > 0) {
          values[key.toLowerCase()] = rest.join(" ");
        }
      }

      const hostname = values.hostname || host;
      const user = values.user || undefined;
      const port = values.port ? parseInt(values.port, 10) : undefined;
      const identityFile = values.identityfile || undefined;

      result = {
        hostname,
        user,
        port: port && port !== 22 ? port : undefined,
        identityFile,
        isAlias: hostname.toLowerCase() !== host.toLowerCase(),
      };
    }
  } catch {
    result = null;
  }

  sshConfigCache.set(host, result);
  return result;
}

export function detectPassphraseProtectedKey(keyPath: string): boolean {
  try {
    if (!existsSync(keyPath)) return false;
    const result = spawnSync("ssh-keygen", ["-y", "-P", "", "-f", keyPath], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return false;
    }
    const stderr = result.stderr ?? "";
    if (/incorrect passphrase|bad passphrase/i.test(stderr)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type SshPreflightResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  keyPath?: string;
  keyExists: boolean;
  keyPermissions?: string;
};

export function checkSshPreflight(remote: RemoteEnvConfig): SshPreflightResult {
  const result: SshPreflightResult = {
    ok: true,
    warnings: [],
    errors: [],
    keyExists: false,
  };

  if (remote.identityFile) {
    const resolved = resolveIdentityFile(remote.identityFile);
    result.keyPath = resolved ?? remote.identityFile;
    if (resolved && existsSync(resolved)) {
      result.keyExists = true;
      try {
        const stat = statSync(resolved);
        const mode = stat.mode & 0o777;
        result.keyPermissions = mode.toString(8).padStart(3, "0");
        if (mode & 0o077) {
          result.warnings.push(
            `SSH key ${preferTildePath(resolved)} has permissions ${result.keyPermissions}. ` +
              `OpenSSH may refuse it. Run: chmod 600 ${preferTildePath(resolved)}`,
          );
        }
      } catch {
        // Ignore stat errors
      }

      if (detectPassphraseProtectedKey(resolved)) {
        const hasAgent = process.env.SSH_AUTH_SOCK && process.env.SSH_AUTH_SOCK.trim() !== "";
        if (hasAgent) {
          result.warnings.push(
            `SSH key ${preferTildePath(resolved)} is passphrase-protected. ` +
              `Load it with: ssh-add ${preferTildePath(resolved)}`,
          );
        } else {
          result.warnings.push(
            `SSH key ${preferTildePath(resolved)} is passphrase-protected but no ssh-agent is running. ` +
              `Either start an agent and run ssh-add, or use a key without a passphrase.`,
          );
        }
      }
    } else {
      const hasAgent = process.env.SSH_AUTH_SOCK && process.env.SSH_AUTH_SOCK.trim() !== "";
      const msg = `Configured SSH key not found: ${preferTildePath(result.keyPath)}. ` +
        `Create it or update identityFile in wp-dev.config.json.`;
      if (hasAgent) {
        result.warnings.push(msg + " Falling back to ssh-agent.");
      } else {
        result.errors.push(msg);
        result.ok = false;
      }
    }
  }

  const aliasCheck = resolveSshConfigAlias(remote.host);
  if (aliasCheck?.isAlias) {
    result.warnings.push(
      `"${remote.host}" appears to be an SSH config alias for "${aliasCheck.hostname}". ` +
        `WP-dev ignores ~/.ssh/config. Use the real hostname "${aliasCheck.hostname}" in wp-dev.config.json, ` +
        `or set port/identityFile explicitly.`,
    );
  }

  const discovered = discoverIdentityFiles(remote);
  const hasAgent = process.env.SSH_AUTH_SOCK && process.env.SSH_AUTH_SOCK.trim() !== "";
  const configuredKeyMissing = remote.identityFile && !result.keyExists;
  if (discovered.length === 0 && !hasAgent && !configuredKeyMissing && !result.keyExists) {
    result.warnings.push(
      "No SSH keys found and no ssh-agent running. " +
        "Create a key: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519",
    );
  }

  return result;
}

export function buildBaseConnectOptions(
  remote: RemoteEnvConfig,
): Parameters<NodeSSH["connect"]>[0] {
  assertSshHostPinned(remote);
  const opts: Parameters<NodeSSH["connect"]>[0] = {
    host: remote.host,
    username: remote.user,
    tryKeyboard: false,
    hostHash: "sha256",
    hostVerifier: createSshHostVerifier(remote),
  };
  if (remote.port != null) opts.port = remote.port;
  return opts;
}

export function discoverIdentityFiles(remote: RemoteEnvConfig): string[] {
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (!p) return;
    const resolved = expandHomePath(p);
    if (existsSync(resolved) && !out.includes(resolved)) out.push(resolved);
  };
  add(resolveIdentityFile(remote.identityFile));
  const sshDir = join(homedir(), ".ssh");
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"]) {
    add(join(sshDir, name));
  }
  return out;
}

export function buildSshConnectAttempts(
  remote: RemoteEnvConfig,
): Array<{ label: string; opts: Parameters<NodeSSH["connect"]>[0] }> {
  const base = buildBaseConnectOptions(remote);
  const attempts: Array<{ label: string; opts: Parameters<NodeSSH["connect"]>[0] }> = [];

  const agentSock = process.env.SSH_AUTH_SOCK;
  if (agentSock && agentSock.trim() !== "") {
    attempts.push({
      label: `ssh-agent (${agentSock})`,
      opts: { ...base, agent: agentSock },
    });
  }

  for (const keyPath of discoverIdentityFiles(remote)) {
    attempts.push({
      label: `key ${preferTildePath(keyPath)}`,
      opts: { ...base, privateKeyPath: keyPath },
    });
  }

  if (attempts.length === 0) {
    attempts.push({ label: "default auth", opts: base });
  }

  return attempts;
}

export type SshAttemptError = {
  label: string;
  message: string;
};

export function formatSshAuthError(
  remote: RemoteEnvConfig,
  attemptErrors: SshAttemptError[],
): string {
  const target = remote.port != null && remote.port !== 22
    ? `${remote.user}@${remote.host}:${remote.port}`
    : `${remote.user}@${remote.host}`;

  const keyPath = resolveIdentityFile(remote.identityFile);
  const keyExists = keyPath ? existsSync(keyPath) : false;
  const lines: string[] = [`SSH authentication failed (${target}).`];

  if (keyPath && !keyExists) {
    lines.push("");
    lines.push(`Configured key not found: ${preferTildePath(keyPath)}`);
    lines.push("Create this key or update identityFile in wp-dev.config.json.");
  }

  if (attemptErrors.length > 0) {
    lines.push("");
    lines.push("Tried:");
    for (const e of attemptErrors) {
      const cleanMsg = cleanSshErrorMessage(e.message);
      lines.push(`  - ${e.label}: ${cleanMsg}`);
    }
  }

  const hasAuthFailed = attemptErrors.some(
    (e) =>
      /All configured authentication methods failed|publickey/i.test(e.message),
  );

  if (hasAuthFailed && keyPath && keyExists) {
    lines.push("");
    lines.push(`Key exists but server rejected it: ${preferTildePath(keyPath)}`);
    lines.push(`Add the public key to the remote host: cat ${preferTildePath(keyPath)}.pub`);
    lines.push("Then paste into ~/.ssh/authorized_keys on the server or the hosting panel.");
  } else if (hasAuthFailed) {
    lines.push("");
    lines.push("Next steps:");
    lines.push("1. Ensure your public key is added to the remote host's authorized_keys");
    const configKey = remote.identityFile
      ? preferTildePath(resolveIdentityFile(remote.identityFile) ?? remote.identityFile)
      : "~/.ssh/id_ed25519";
    lines.push(`2. Verify the key exists: ls -la ${configKey}`);
    lines.push(`3. Copy public key: cat ${configKey}.pub`);
  }

  const pinCmd = buildSshPinCommand(remote);
  lines.push("");
  lines.push(`Test connection manually: ${pinCmd}`);

  return lines.join("\n");
}

function cleanSshErrorMessage(msg: string): string {
  const cleaned = msg
    .replace(/Error:\s*/gi, "")
    .replace(/at\s+\S+\s+\([^)]+\)/g, "")
    .replace(/\n\s+at\s+.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > 120) {
    return cleaned.slice(0, 117) + "...";
  }
  return cleaned;
}
