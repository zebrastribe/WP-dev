import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { listRecentBackups } from "./backup.js";
import { isLocalWpInstalled } from "../services/wpcli.js";
import { verifyLocalSiteUrls } from "../utils/sync-verify.js";
import { getLocalUrlPortMismatch, getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { openBrowserCommand } from "../utils/platform-hints.js";
import { getComposeProjectDir, getDockerComposeLeadArgs } from "../services/docker-compose.js";

export async function cmdStatus(loaded: LoadedConfig): Promise<void> {
  const { config, configDir } = loaded;
  const wpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
  const { site, admin, warnings } = getPublishedLocalAccess(loaded);
  const portMismatch = getLocalUrlPortMismatch(loaded);

  console.error(`Project:     ${config.project}`);
  console.error(`Local URL:   ${site}`);
  console.error(`Admin UI:    ${admin}`);
  const openCmd = openBrowserCommand(admin);
  if (openCmd) console.error(`Open admin:  ${openCmd}`);
  for (const w of warnings) console.error(`Warning:     ${w}`);
  if (portMismatch) {
    console.error(
      `Warning:     local.url port ${portMismatch.localUrlPort} != WP_PORT ${portMismatch.wpPort}`,
    );
  }

  let stackRunning = false;
  try {
    const projectDir = getComposeProjectDir(configDir, config);
    const r = await execa(
      "docker",
      [...getDockerComposeLeadArgs(config), "ps", "--status", "running"],
      { cwd: projectDir, reject: false },
    );
    stackRunning = r.exitCode === 0 && /wordpress|db/.test(String(r.stdout ?? ""));
  } catch {
    stackRunning = false;
  }
  console.error(`Docker stack: ${stackRunning ? "running" : "not running (run: wp-dev up)"}`);

  const adminBuilt = existsSync(join(wpRoot, "admin", "index.html"));
  console.error(`Admin built:  ${adminBuilt ? "yes" : "no (run: npm run admin:build:wp)"}`);

  if (!stackRunning) {
    console.error("\nRun wp-dev up to start the local stack, then wp-dev status again.");
    return;
  }

  const installed = await isLocalWpInstalled(configDir, config);
  console.error(`WP installed: ${installed ? "yes" : "no"}`);

  if (installed) {
    const urls = await verifyLocalSiteUrls(configDir, config, config.local.url);
    console.error(
      `Site URLs:    home=${urls.home ?? "?"} siteurl=${urls.siteurl ?? "?"} ${urls.ok ? "(OK)" : "(MISMATCH)"}`,
    );
  }

  const recent = listRecentBackups(config.project, "local", 3);
  if (recent.length > 0) {
    console.error("\nRecent local backups:");
    for (const p of recent) console.error(`  ${p}`);
  } else {
    console.error("\nRecent local backups: none");
  }
}
