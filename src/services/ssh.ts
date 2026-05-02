import { NodeSSH } from "node-ssh";
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

function buildConnectOptions(remote: RemoteEnvConfig) {
  const opts: Parameters<NodeSSH["connect"]>[0] = {
    host: remote.host,
    username: remote.user,
    tryKeyboard: false,
  };
  if (remote.port != null) opts.port = remote.port;
  if (remote.identityFile) opts.privateKeyPath = remote.identityFile;
  return opts;
}

export async function connectSsh(remote: RemoteEnvConfig): Promise<SshSession> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildConnectOptions(remote));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`SSH connection failed (${remote.user}@${remote.host}): ${msg}`);
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
