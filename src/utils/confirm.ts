import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { RemoteEnvName } from "../config/schema.js";

export async function confirmProduction(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} Type "yes" to continue: `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

/** Require typing the remote SSH host before push/restore to non-local envs (interactive terminal only). */
export async function confirmRemoteTarget(
  env: RemoteEnvName,
  remote: { host: string; url: string },
  action: "push" | "restore",
): Promise<boolean> {
  // Browser runner / CI: no TTY — auto-approve staging; production needs --yes from caller.
  if (!process.stdin.isTTY) {
    return env === "staging";
  }
  if (env === "production") {
    return confirmProduction(
      `You are about to ${action} PRODUCTION (${remote.url}).`,
    );
  }
  const rl = readline.createInterface({ input, output });
  try {
    const host = remote.host.trim();
    const answer = await rl.question(
      `You are about to ${action} STAGING (${remote.url} via ${host}). Type the SSH host "${host}" to continue: `,
    );
    return answer.trim() === host;
  } finally {
    rl.close();
  }
}
