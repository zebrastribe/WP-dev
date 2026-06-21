import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NodeSSH } from "node-ssh";
import type { RemoteEnvConfig } from "../config/schema.js";

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function buildBaseConnectOptions(
  remote: RemoteEnvConfig,
): Parameters<NodeSSH["connect"]>[0] {
  const opts: Parameters<NodeSSH["connect"]>[0] = {
    host: remote.host,
    username: remote.user,
    tryKeyboard: false,
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
  add(remote.identityFile);
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
      label: `key ${keyPath}`,
      opts: { ...base, privateKeyPath: keyPath },
    });
  }

  if (attempts.length === 0) {
    attempts.push({ label: "default auth", opts: base });
  }

  return attempts;
}
