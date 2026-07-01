import { NodeSSH } from "node-ssh";
import { statSync } from "node:fs";
import type { RemoteEnvConfig } from "../config/schema.js";
import { buildSshConnectAttempts } from "../utils/ssh-helpers.js";

const SSH_READY_TIMEOUT_MS = 20_000;

export type SshSession = {
  exec(
    command: string,
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
  getFile(remotePath: string, localPath: string): Promise<void>;
  putFile(localPath: string, remotePath: string): Promise<void>;
  dispose(): void;
};

export async function connectSsh(remote: RemoteEnvConfig): Promise<SshSession> {
  const ssh = new NodeSSH();
  const attempts = buildSshConnectAttempts(remote);

  const errors: string[] = [];
  for (const a of attempts) {
    try {
      await ssh.connect({ ...a.opts, readyTimeout: SSH_READY_TIMEOUT_MS });
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
      return ssh.getFile(localPath, remotePath).then(() => {
        const stat = statSync(localPath);
        if (!stat.isFile() || stat.size === 0) {
          throw new Error(
            `SSH download failed or empty file: ${remotePath} -> ${localPath}`,
          );
        }
      });
    },
    putFile(localPath, remotePath) {
      return ssh.putFile(localPath, remotePath);
    },
    dispose() {
      ssh.dispose();
    },
  };
}
