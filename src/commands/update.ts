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

export async function cmdUpdate(loaded: LoadedConfig, options: UpdateOptions = {}): Promise<void> {
  const { configDir } = loaded;
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

  try {
  for (const step of steps) {
    logInfo(`update: ${step.label}`);
    console.error(`→ ${step.label}`);

    if (step.shell.startsWith("npm run wp-dev -- down")) {
      await cmdDown(loaded);
      await cmdUp(loaded);
      continue;
    }

    await runShellStep(configDir, step.shell);
  }

  console.error("\nwp-dev update finished successfully.\n");
  } finally {
    if (!options.dryRun && !options.preflightOnly) {
      releaseUpdateLock(configDir);
    }
  }
}
