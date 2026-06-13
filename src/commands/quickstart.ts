import type { LoadedConfig } from "../config/load.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cmdUp } from "./up.js";
import { cmdStatus } from "./status.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import {
  adminSaveTokenHint,
  isMacOs,
  openBrowserCommand,
  sshKeySetupHint,
} from "../utils/platform-hints.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { assertDockerReady } from "../utils/docker-prereq.js";

/**
 * One-shot first run: verify host tools, start Docker stack, print simple next steps.
 */
export async function cmdQuickstart(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  try {
    assertHostSyncTools();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    throw e;
  }

  const configPath = join(loaded.configDir, "wp-dev.config.json");
  const hasConfig = existsSync(configPath);

  console.error(isMacOs() ? "\nwp-dev quickstart (macOS)\n" : "\nwp-dev quickstart\n");
  console.error("1/3 Starting local WordPress (Docker)…");
  await cmdUp(loaded);

  const { admin } = getPublishedLocalAccess(loaded);
  console.error("\n2/3 Open the setup wizard in your browser:");
  console.error(`    ${admin}`);
  const openCmd = openBrowserCommand(admin);
  if (openCmd) {
    console.error(`    Or run: ${openCmd}`);
  }

  console.error("\n3/3 In the wizard:");
  console.error("    • Choose “Sync from my server (SSH only)”");
  console.error("    • SSH host + user + path → Save → Run pull");
  console.error(`    • ${adminSaveTokenHint()}`);
  if (!hasConfig) {
    console.error("\n    (No wp-dev.config.json yet — the wizard will create it on Save.)");
  }

  console.error("\nSSH key (one-time):");
  console.error(sshKeySetupHint().replace(/\n/g, "\n    "));

  console.error("\n--- status ---");
  await cmdStatus(loaded);
}
