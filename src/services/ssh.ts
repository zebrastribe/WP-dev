import { NodeSSH } from "node-ssh";
import type { RemoteEnvConfig } from "../config/schema.js";
import { buildSshConnectAttempts } from "../utils/ssh-helpers.js";

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
