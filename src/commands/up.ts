import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";
import {
  listSecurityEnvPlaceholderKeys,
  readEnvValue,
} from "../utils/compose-env.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoReconcileOnStartup,
  probeWritable,
  reconcileContainerRuntime,
  reconcileSharedConfig,
} from "../fs/index.js";
import {
  ensureComposePrerequisites,
  getComposeEnvPath,
} from "../utils/compose-prerequisites.js";
import { recoverStaleState } from "../supervisor/recovery.js";
import {
  ensureSupervisorRunning,
  formatDuplicateInstanceMessage,
  isSupervisorAlreadyRunning,
  resolveSupervisorPort,
} from "../supervisor/client.js";
import {
  createInitialRegistry,
  printStartupSummary,
  runStartupStateMachine,
} from "../supervisor/startup.js";
import { saveRegistry } from "../supervisor/service-registry.js";

export type UpOptions = {
  relocatePorts?: boolean;
  reclaimPorts?: boolean;
  strictPorts?: boolean;
};

function warnIfSecurityEnvPlaceholders(envPath: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const missingOrPlaceholder = listSecurityEnvPlaceholderKeys(current);
  if (missingOrPlaceholder.length === 0) return;
  console.error(
    "Security setup required in docker/.env before using admin terminal/save features:\n" +
      missingOrPlaceholder.map((k) => `  - ${k}`).join("\n") +
      "\nSet strong values, then run: npm run wp-dev -- down && npm run wp-dev -- up\n",
  );
}

function ensureWordPressSetupAssetsOnHost(loaded: LoadedConfig): boolean {
  const wpRoot = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
  const src = join(loaded.configDir, "docker/assets/mu-plugins/wp-dev-setup.php");
  if (!existsSync(src)) return true;

  const destDir = join(wpRoot, "wp-content/mu-plugins");
  const destFile = join(destDir, "wp-dev-setup.php");
  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, destFile);
    logInfo("up: ensured wp-dev setup mu-plugin in wordpress/wp-content/mu-plugins/");
    return true;
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "EACCES" || code === "EPERM") {
      logInfo(
        "up: wp-content not writable on host (www-data); will install setup mu-plugin via Docker after stack starts",
      );
      return false;
    }
    throw e;
  }
}

async function ensureWordPressSetupAssetsViaDocker(loaded: LoadedConfig): Promise<void> {
  const src = join(loaded.configDir, "docker/assets/mu-plugins/wp-dev-setup.php");
  if (!existsSync(src)) return;
  try {
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "run",
        "--rm",
        "--no-deps",
        "--user",
        "0",
        "--entrypoint",
        "sh",
        "wordpress",
        "-lc",
        [
          "mkdir -p /var/www/html/wp-content/mu-plugins",
          "cp /wp-dev-repo/docker/assets/mu-plugins/wp-dev-setup.php /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
          "chown 33:33 /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
          "chmod 664 /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
        ].join(" && "),
      ],
      { stdio: "pipe" },
    );
    logInfo("up: ensured wp-dev setup mu-plugin via Docker");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: could not install setup mu-plugin via Docker (${msg})`);
  }
}

async function applyRuntimeWritePermissionsWithRetry(
  loaded: LoadedConfig,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await reconcileContainerRuntime(loaded);
      return;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  logInfo(`up: could not apply WordPress write permissions (${msg})`);
  console.error(
    "Warning: could not apply WordPress write permissions. Core/theme/plugin updates may fail or ask for FTP.",
  );
  console.error("Try: npm run wp-dev -- fix-runtime-permissions");
}

async function ensureDockerEnvWritableBeforeUp(
  loaded: LoadedConfig,
  envPath: string,
): Promise<void> {
  if (probeWritable(envPath)) return;
  try {
    await reconcileSharedConfig(loaded);
    logInfo("up: restored writable docker/.env via filesystem manager");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `docker/.env is not writable (${msg}). Run: npm run wp-dev -- doctor --filesystem`,
    );
  }
  if (!probeWritable(envPath)) {
    throw new Error(
      "docker/.env is still not writable after filesystem recovery. Run: npm run wp-dev -- doctor --filesystem",
    );
  }
}

async function ensureAdminSaveWriteAccess(loaded: LoadedConfig): Promise<void> {
  try {
    await reconcileSharedConfig(loaded);
    logInfo("admin save: ensured shared config paths are writable");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`admin save: could not enforce shared config permissions (${msg})`);
    console.error(
      "Warning: could not auto-fix admin save permissions. Run: npm run wp-dev -- doctor --filesystem",
    );
  }
}

export async function cmdUp(loaded: LoadedConfig, options: UpOptions = {}): Promise<void> {
  assertDockerReady();

  // CRITICAL: Ensure all compose prerequisites are ready BEFORE any compose call.
  // This allocates the network subnet, writes security env values, and creates
  // generated bind-mount files (remoteip.conf). Without this, compose would:
  // 1. Create the network with fallback subnet from compose file (bypassing allocator)
  // 2. Create bind-mount sources as directories (breaking file writes)
  const prereqResult = ensureComposePrerequisites(loaded);
  const envPath = prereqResult.envPath;

  if (prereqResult.changed && prereqResult.changedKeys.length > 0) {
    console.error(
      `Auto-updated docker/.env: ${prereqResult.changedKeys.join(", ")}\n` +
        "Run this stack restart to apply if already running: npm run wp-dev -- down && npm run wp-dev -- up\n",
    );
  }

  // Now it's safe to call compose (via recoverStaleState, autoReconcileOnStartup, etc.)
  await recoverStaleState(loaded);
  await autoReconcileOnStartup(loaded);

  if (isSupervisorAlreadyRunning(loaded)) {
    console.error(formatDuplicateInstanceMessage(loaded));
    console.error("Stack may already be running. Showing status URLs:");
    printStartupSummary(loaded);
    return;
  }

  const muPluginOnHost = ensureWordPressSetupAssetsOnHost(loaded);

  const registry = createInitialRegistry(loaded, process.pid, resolveSupervisorPort(loaded));
  saveRegistry(loaded.configDir, registry);

  const sslEnabled = /^(1|true|yes)$/i.test(
    readEnvValue(existsSync(envPath) ? readFileSync(envPath, "utf8") : "", "WPDEV_LOCAL_HTTPS"),
  );

  const { wpInstalled } = await runStartupStateMachine(
    loaded,
    envPath,
    registry,
    {
      strictPorts: options.strictPorts !== false && !options.relocatePorts,
      relocatePorts: options.relocatePorts,
      reclaimPorts: options.reclaimPorts,
      sslEnabled,
    },
    {
      ensureSecurityEnv: () => {
        // Prerequisites already handled by ensureComposePrerequisites above.
        // This hook now just warns about placeholders.
        warnIfSecurityEnvPlaceholders(envPath);
      },
      ensureDockerEnvWritable: () => ensureDockerEnvWritableBeforeUp(loaded, envPath),
      ensureComposeEnv: () => {
        // Already handled by ensureComposePrerequisites
      },
      postStack: async () => {
        await ensureAdminSaveWriteAccess(loaded);
        await applyRuntimeWritePermissionsWithRetry(loaded);
        if (!muPluginOnHost) {
          await ensureWordPressSetupAssetsViaDocker(loaded);
        }
      },
    },
  );

  try {
    await ensureSupervisorRunning(loaded);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: supervisor watch daemon skipped (${msg})`);
  }

  printStartupSummary(loaded, wpInstalled);
}
