import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { cmdDown } from "./down.js";
import { cmdUp } from "./up.js";
import { logInfo } from "../utils/logger.js";
import {
  collectUpdatePreflight,
  formatUpdatePreflight,
} from "../services/update-preflight.js";
import { acquireUpdateLock, releaseUpdateLock } from "../fs/update-lock.js";
import { acquireSyncLock, releaseSyncLock, type SyncLockHandle } from "@wpdev/sync-engine";

export const UPDATE_WORDPRESS_SAFETY =
  "This updates the wp-dev tool only. Your wordpress/ site (themes, plugins, uploads, database) is not replaced.";

export type UpdateOptions = {
  dryRun?: boolean;
  noAdmin?: boolean;
  noRestart?: boolean;
  skipPull?: boolean;
  preflightOnly?: boolean;
  json?: boolean;
};

export type UpdateStep = {
  label: string;
  shell: string;
};

export function buildUpdateSteps(options: UpdateOptions = {}): UpdateStep[] {
  const steps: UpdateStep[] = [];
  if (!options.skipPull) {
    steps.push({
      label: "Pull latest wp-dev from git",
      shell: "git -c safe.directory=. pull --rebase --autostash",
    });
  }
  steps.push({ label: "Install npm dependencies", shell: "npm install" });
  steps.push({ label: "Build CLI", shell: "npm run build" });
  if (!options.noAdmin) {
    steps.push({
      label: "Rebuild admin UI (wordpress/admin/ only)",
      shell: "npm ci --prefix docs/admin && npm run build:wp --prefix docs/admin",
    });
  }
  if (!options.noRestart) {
    steps.push({
      label: "Restart local Docker stack",
      shell: "npm run wp-dev -- down && npm run wp-dev -- up",
    });
  }
  return steps;
}

function assertGitRepository(configDir: string): void {
  if (!existsSync(join(configDir, ".git"))) {
    throw new Error(
      "Not a git repository. Clone wp-dev from GitHub first, or run update steps manually from your clone root.",
    );
  }
}

async function runShellStep(configDir: string, shell: string): Promise<void> {
  await execa("bash", ["-lc", shell], { cwd: configDir, stdio: "inherit" });
}

/** Record HEAD before mutating the tool tree (§25 P1.9 / §27 F). */
export async function readGitHeadSha(configDir: string): Promise<string | null> {
  if (!existsSync(join(configDir, ".git"))) return null;
  const r = await execa("git", ["-c", "safe.directory=.", "rev-parse", "HEAD"], {
    cwd: configDir,
  });
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/** Restore tool sources to snapshot SHA and rebuild CLI (never touches site DB/content). */
export async function rollbackWpDevTool(configDir: string, sha: string): Promise<void> {
  await execa("git", ["-c", "safe.directory=.", "reset", "--hard", sha], {
    cwd: configDir,
    stdio: "inherit",
  });
  await execa("bash", ["-lc", "npm install && npm run build"], {
    cwd: configDir,
    stdio: "inherit",
  });
}

/** Post-update smoke: CLI must start and print help. */
export async function verifyWpDevCli(configDir: string): Promise<void> {
  const cli = join(configDir, "dist", "cli.js");
  if (!existsSync(cli)) {
    throw new Error(`Update verify failed: missing ${cli}`);
  }
  await execa("node", [cli, "--help"], { cwd: configDir });
}

export async function cmdUpdate(loaded: LoadedConfig, options: UpdateOptions = {}): Promise<void> {
  const { configDir, config } = loaded;
  const preflight = await collectUpdatePreflight(configDir, loaded);

  if (options.preflightOnly && options.json) {
    console.log(JSON.stringify({ preflight, wordpressSafe: true }, null, 2));
    return;
  }

  if (options.preflightOnly) {
    console.error(formatUpdatePreflight(preflight));
    return;
  }

  const steps = buildUpdateSteps(options);

  if (!options.json) {
    console.error(`\nwp-dev update — ${UPDATE_WORDPRESS_SAFETY}\n`);
    console.error(formatUpdatePreflight(preflight));
    console.error("\nPreserved on disk:");
    console.error("  • wordpress/ (except wordpress/admin/ when admin rebuild runs)");
    console.error("  • wp-dev.config.json, docker/.env, logs/\n");
  }

  if (options.dryRun) {
    const payload = { preflight, steps, wordpressSafe: true };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.error("Dry run — would run:\n");
    for (const [i, step] of steps.entries()) {
      console.error(`${i + 1}. ${step.label}`);
      console.error(`   ${step.shell}\n`);
    }
    return;
  }

  if (!options.skipPull) {
    assertGitRepository(configDir);
  }

  if (!options.dryRun && !options.preflightOnly) {
    if (!acquireUpdateLock(configDir)) {
      throw new Error("Another wp-dev update is in progress (logs/wp-dev-update.lock).");
    }
  }

  const snapshotSha = await readGitHeadSha(configDir);
  if (snapshotSha) {
    console.error(`Snapshot: tool HEAD ${snapshotSha} (rollback target if update fails)\n`);
  } else {
    console.error(
      "Warning: no git HEAD snapshot — automatic tool rollback unavailable for this tree.\n",
    );
  }

  let syncLock: SyncLockHandle | null = null;
  let failedStep: string | undefined;
  try {
    try {
      for (const step of steps) {
        failedStep = step.label;
        logInfo(`update: ${step.label}`);
        console.error(`→ ${step.label}`);

        if (step.shell.startsWith("npm run wp-dev -- down")) {
          // Serialize with pull/push/restore so stack restart cannot race a sync.
          syncLock = acquireSyncLock(config.project, "update:restart");
          try {
            await cmdDown(loaded);
            await cmdUp(loaded);
          } finally {
            releaseSyncLock(syncLock);
            syncLock = null;
          }
          continue;
        }

        await runShellStep(configDir, step.shell);
      }

      failedStep = "Verify CLI";
      console.error("→ Verify CLI (--help)");
      await verifyWpDevCli(configDir);

      console.error("\nwp-dev update finished successfully.\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (snapshotSha) {
        console.error(
          `\nUpdate failed at: ${failedStep ?? "unknown"}. Rolling back tool to ${snapshotSha}…`,
        );
        try {
          await rollbackWpDevTool(configDir, snapshotSha);
          console.error(
            `Rolled back to ${snapshotSha}. WordPress site files and database were not modified.\n` +
              `Next: fix the failure (${msg}), then re-run: npm run wp-dev -- update`,
          );
        } catch (rbErr) {
          const rb = rbErr instanceof Error ? rbErr.message : String(rbErr);
          console.error(
            `Warning: tool rollback also failed (${rb}). Snapshot SHA was ${snapshotSha}. ` +
              `Site wordpress/ content and DB were still not touched by update.`,
          );
        }
      } else {
        console.error(
          `\nUpdate failed at: ${failedStep ?? "unknown"} (${msg}). No git snapshot — manual tool restore required.`,
        );
      }
      throw err;
    }
  } finally {
    releaseSyncLock(syncLock);
    if (!options.dryRun && !options.preflightOnly) {
      releaseUpdateLock(configDir);
    }
  }
}
