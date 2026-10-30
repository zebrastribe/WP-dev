import { NodeSSH } from "node-ssh";
import { statSync } from "node:fs";
import type { RemoteEnvConfig } from "../config/schema.js";
import {
  buildSshConnectAttempts,
  checkSshPreflight,
  formatSshAuthError,
  type SshAttemptError,
} from "../utils/ssh-helpers.js";
import { logInfo } from "../utils/logger.js";

const SSH_READY_TIMEOUT_MS = 20_000;
/** Keep the control channel alive during short gaps; still dispose before long rsync. */
const SSH_KEEPALIVE_INTERVAL_MS = 15_000;
const SSH_KEEPALIVE_COUNT_MAX = 12;

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
  const preflight = checkSshPreflight(remote);
  for (const warn of preflight.warnings) {
    logInfo(`ssh preflight warning: ${warn}`);
  }
  if (!preflight.ok) {
    throw new Error(preflight.errors.join("\n"));
  }

  const ssh = new NodeSSH();
  const attempts = buildSshConnectAttempts(remote);

  const attemptErrors: SshAttemptError[] = [];
  for (const a of attempts) {
    try {
      await ssh.connect({
        ...a.opts,
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      });
      attemptErrors.length = 0;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attemptErrors.push({ label: a.label, message: msg });
    }
  }
  if (attemptErrors.length > 0) {
    throw new Error(formatSshAuthError(remote, attemptErrors));
  }

  // Late resets must not take down the whole CLI (e.g. after we intended to dispose).
  const raw = ssh.connection as { on?: (event: string, fn: (err: Error) => void) => void } | undefined;
  raw?.on?.("error", (err: Error) => {
    logInfo(`ssh: connection error (non-fatal): ${err.message}`);
  });

  let disposed = false;
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
      if (disposed) return;
      disposed = true;
      try {
        ssh.dispose();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logInfo(`ssh: dispose ignored error: ${msg}`);
      }
    },
  };
}
