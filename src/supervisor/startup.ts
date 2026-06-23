import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { cleanupLegacyHostRunner } from "../services/host-runner.js";
import {
  extractBoundPort,
  maybeUpdateLocalUrlPort,
  maybeUpdateRunnerOriginPort,
  parseDockerEnvPorts,
  readEnvValue,
  resolveConflictPortKey,
  setPortInEnvFile,
} from "../utils/compose-env.js";
import { getComposePublishedHostPorts } from "../utils/compose-published-ports.js";
import { logInfo } from "../utils/logger.js";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { findFreePort } from "./port-helpers.js";
import { formatPortConflicts, validateReservedPorts } from "./port-manager.js";
import { recoverStaleState, reclaimPortConflicts } from "./recovery.js";
import { runFilesystemRecovery } from "../fs/recovery.js";
import {
  emptyRegistry,
  loadRegistry,
  saveRegistry,
  upsertService,
} from "./service-registry.js";
import type { ManagedService, ServiceRegistry } from "./types.js";
import { isLocalWpInstalled, waitForLocalMysqlReady } from "../services/wpcli.js";
import { syncLocalWordPressUrls } from "../utils/sync-local-urls.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { openBrowserCommand } from "../utils/platform-hints.js";

export type StartupOptions = {
  strictPorts?: boolean;
  relocatePorts?: boolean;
  reclaimPorts?: boolean;
  sslEnabled?: boolean;
};

function dockerService(
  registry: ServiceRegistry,
  name: string,
  port: number | undefined,
  containerPort: number | undefined,
): ManagedService {
  const now = new Date().toISOString();
  return {
    name,
    kind: "docker",
    projectId: registry.projectId,
    port,
    containerPort,
    status: "running",
    health: "healthy",
    startedAt: now,
    lastHeartbeat: now,
    restartCount: 0,
    cwd: registry.configDir,
    logPath: join(registry.configDir, "logs", "wp-dev.log"),
    bindAddress: "127.0.0.1",
  };
}

export async function runStartupStateMachine(
  loaded: LoadedConfig,
  envPath: string,
  registry: ServiceRegistry,
  options: StartupOptions,
  hooks: {
    ensureSecurityEnv: () => void;
    ensureDockerEnvWritable: () => Promise<void>;
    ensureComposeEnv: () => void;
    postStack: () => Promise<void>;
  },
): Promise<{ registry: ServiceRegistry; wpInstalled?: boolean }> {
  emitLifecycleEvent(loaded.configDir, loaded.config.project, "lifecycle.start", {});

  await recoverStaleState(loaded);
  await runFilesystemRecovery(loaded);

  let portResult = await validateReservedPorts(loaded, envPath, {
    strict: options.strictPorts !== false,
    relocate: Boolean(options.relocatePorts),
  });

  if (!portResult.ok && options.reclaimPorts) {
    await reclaimPortConflicts(loaded, portResult.conflicts);
    portResult = await validateReservedPorts(loaded, envPath, {
      strict: true,
      relocate: false,
    });
  }

  if (!portResult.ok) {
    throw new Error(formatPortConflicts(portResult.conflicts));
  }

  registry = { ...registry, ports: portResult.ports };
  saveRegistry(loaded.configDir, registry);

  await hooks.ensureDockerEnvWritable();
  hooks.ensureComposeEnv();
  hooks.ensureSecurityEnv();

  const sslEnabled =
    options.sslEnabled ??
    /^(1|true|yes)$/i.test(
      readEnvValue(existsSync(envPath) ? readFileSync(envPath, "utf8") : "", "WPDEV_LOCAL_HTTPS"),
    );

  logInfo(`docker compose ${sslEnabled ? "--profile ssl " : ""}up -d`);
  await composeUp(loaded, envPath, sslEnabled);

  await cleanupLegacyHostRunner(loaded.configDir);

  const ports = parseDockerEnvPorts(existsSync(envPath) ? readFileSync(envPath, "utf8") : "");
  let next = loadRegistry(loaded.configDir) ?? registry;
  next = upsertService(next, dockerService(next, "db", undefined, 3306));
  next = upsertService(next, dockerService(next, "wordpress", ports.WP_PORT, 80));
  next = upsertService(next, dockerService(next, "terminal", ports.WPDEV_TERMINAL_PORT, 7681));
  next = upsertService(
    next,
    dockerService(next, "terminal-runner", ports.WPDEV_TERMINAL_RUNNER_PORT, 7682),
  );
  next = upsertService(
    next,
    dockerService(next, "sync-runner", ports.WPDEV_HOST_RUNNER_PORT, 7683),
  );
  if (sslEnabled) {
    next = upsertService(next, dockerService(next, "local_ssl_proxy", ports.WP_HTTPS_PORT, 443));
  }
  saveRegistry(loaded.configDir, next);

  try {
    await waitForLocalMysqlReady(loaded.configDir, loaded.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`startup: mysql readiness wait skipped (${msg})`);
  }

  await hooks.postStack();

  let wpInstalled: boolean | undefined;
  try {
    wpInstalled = await isLocalWpInstalled(loaded.configDir, loaded.config);
  } catch {
    wpInstalled = undefined;
  }

  try {
    const sync = await syncLocalWordPressUrls(loaded);
    if (sync.synced) {
      const parts: string[] = [];
      if (sync.replacedFrom && sync.replacedFrom.length > 0) {
        parts.push(`options: ${sync.replacedFrom.join(", ")}`);
      }
      if ((sync.contentReplacements ?? 0) > 0) {
        parts.push(`${sync.contentReplacements} content URL replacement(s)`);
      }
      const detail = parts.length > 0 ? ` (${parts.join("; ")})` : "";
      console.error(
        `Synced WordPress URLs to ${sync.expectedUrl}${detail}. ` +
          `Previous: home=${sync.previousHome ?? "?"} siteurl=${sync.previousSiteurl ?? "?"}`,
      );
    }
  } catch {
    /* non-fatal */
  }

  emitLifecycleEvent(loaded.configDir, loaded.config.project, "lifecycle.ready", {
    ports,
  });

  return { registry: next, wpInstalled };
}

export function printStartupSummary(loaded: LoadedConfig, wpInstalled?: boolean): void {
  const { site, admin, warnings } = getPublishedLocalAccess(loaded);
  for (const w of warnings) console.error(w);
  if (wpInstalled === false) {
    console.error(`\n*** Start here (setup wizard): ${admin}`);
    console.error(`Local WordPress: ${site} (opens installer after you pull or finish sync)`);
  } else {
    console.error(`\nLocal WordPress: ${site}`);
    console.error(`Browser admin:   ${admin}`);
  }
  const openCmd = openBrowserCommand(wpInstalled === false ? admin : admin);
  if (openCmd) console.error(`Open in browser: ${openCmd}`);
  console.error(`\nTo stop: npm run wp-dev -- down`);
  console.error(`Service registry: logs/service-registry.json\n`);
}

export function createInitialRegistry(
  loaded: LoadedConfig,
  supervisorPid: number,
  supervisorPort: number,
): ServiceRegistry {
  const existing = loadRegistry(loaded.configDir);
  const envPath = join(loaded.configDir, loaded.config.local.path, ".env");
  const ports = existsSync(envPath)
    ? parseDockerEnvPorts(readFileSync(envPath, "utf8"))
    : undefined;
  return emptyRegistry(
    loaded.config.project,
    loaded.configDir,
    supervisorPid,
    supervisorPort,
    ports,
  );
}

export { maybeUpdateLocalUrlPort, maybeUpdateRunnerOriginPort };

async function composeUp(
  loaded: LoadedConfig,
  envPath: string,
  sslEnabled: boolean,
): Promise<void> {
  const args = sslEnabled ? ["--profile", "ssl", "up", "-d"] : ["up", "-d"];
  try {
    await compose(loaded.configDir, loaded.config, args, { stdio: "pipe" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const conflictPort = extractBoundPort(msg);
    if (!conflictPort) throw e;

    const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const ports = parseDockerEnvPorts(envContent);
    const key = resolveConflictPortKey(conflictPort, ports);
    const nextPort = await findFreePort(
      conflictPort + 1,
      await getComposePublishedHostPorts(loaded.configDir, loaded.config),
    );
    setPortInEnvFile(envPath, key, nextPort, {
      configDir: loaded.configDir,
      projectId: loaded.config.project,
    });
    if (key === "WP_PORT") {
      maybeUpdateLocalUrlPort(loaded, nextPort);
      maybeUpdateRunnerOriginPort(envPath, nextPort, {
        configDir: loaded.configDir,
        projectId: loaded.config.project,
      });
    }

    logInfo(`Port ${conflictPort} in use during compose bind; ${key}=${nextPort}, retrying`);
    console.error(
      `Port ${conflictPort} is in use during compose bind. Switched ${key} to ${nextPort} and retrying...`,
    );
    await compose(loaded.configDir, loaded.config, args, { stdio: "pipe" });
  }
}
