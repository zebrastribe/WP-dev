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

/** Require typing the remote SSH host before pull/push/restore (interactive terminal only). */
export async function confirmRemoteTarget(
  env: RemoteEnvName,
  remote: { host: string; url: string },
  action: "pull" | "push" | "restore",
  opts: { yes?: boolean; confirmHost?: string } = {},
): Promise<boolean> {
  const host = remote.host.trim();

  // Non-interactive (admin runner / CI): production needs --yes; staging needs matching --confirm-host.
  if (!process.stdin.isTTY || opts.yes) {
    if (env === "production") {
      return Boolean(opts.yes);
    }
    const provided = (opts.confirmHost ?? "").trim();
    if (!provided || provided !== host) {
      console.error(
        `Staging ${action} refused: pass --confirm-host=${host} (SSH host from config) when using --yes / non-TTY.`,
      );
      return false;
    }
    return true;
  }

  if (env === "production") {
    return confirmProduction(`You are about to ${action} PRODUCTION (${remote.url}).`);
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `You are about to ${action} STAGING (${remote.url} via ${host}). Type the SSH host "${host}" to continue: `,
    );
    return answer.trim() === host;
  } finally {
    rl.close();
  }
}
