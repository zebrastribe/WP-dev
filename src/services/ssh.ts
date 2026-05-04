import { NodeSSH } from "node-ssh";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteEnvConfig } from "../config/schema.js";

export type SshSession = {
  exec(
    command: string,
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
  getFile(remotePath: string, localPath: string): Promise<void>;
  putFile(localPath: string, remotePath: string): Promise<void>;
  dispose(): void;
};

function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function buildBaseConnectOptions(remote: RemoteEnvConfig) {
  const opts: Parameters<NodeSSH["connect"]>[0] = {
    host: remote.host,
    username: remote.user,
    tryKeyboard: false,
  };
  if (remote.port != null) opts.port = remote.port;
  return opts;
}

function discoverIdentityFiles(remote: RemoteEnvConfig): string[] {
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

export async function connectSsh(remote: RemoteEnvConfig): Promise<SshSession> {
  const ssh = new NodeSSH();
  const base = buildBaseConnectOptions(remote);
  const attempts: Array<{
    label: string;
    opts: Parameters<NodeSSH["connect"]>[0];
  }> = [];

  // 1) If an ssh-agent socket exists, try that first (matches how many users run `ssh`).
  const agentSock = process.env.SSH_AUTH_SOCK;
  if (agentSock && agentSock.trim() !== "") {
    attempts.push({
      label: `ssh-agent (${agentSock})`,
      opts: { ...base, agent: agentSock },
    });
  }

  // 2) Explicit identityFile and common ~/.ssh keys as dynamic fallback.
  for (const keyPath of discoverIdentityFiles(remote)) {
    attempts.push({
      label: `key ${keyPath}`,
      opts: { ...base, privateKeyPath: keyPath },
    });
  }

  // 3) Last fallback: plain connection options.
  if (attempts.length === 0) {
    attempts.push({ label: "default auth", opts: base });
  }

  const errors: string[] = [];
  for (const a of attempts) {
    try {
      await ssh.connect(a.opts);
      errors.length = 0;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${a.label}: ${msg}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `SSH connection failed (${remote.user}@${remote.host}). Tried ${attempts.length} auth method(s): ${errors.join(" | ")}`,
    );
  }

  return {
    async exec(command, options) {
      const result = await ssh.execCommand(command, {
        cwd: options?.cwd,
        onStdout: undefined,
        onStderr: undefined,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code ?? null,
      };
    },
    getFile(remotePath, localPath) {
      return ssh.getFile(localPath, remotePath);
    },
    putFile(localPath, remotePath) {
      return ssh.putFile(localPath, remotePath);
    },
    dispose() {
      ssh.dispose();
    },
  };
}
