import http from "node:http";
import type { LoadedConfig } from "../config/load.js";
import { loadConfig } from "../config/load.js";
import { hydrateSimplyApiKeyFromComposeEnv, hydrateStagingDbFromComposeEnv } from "../services/simply.js";
import { initLogger, logInfo } from "../utils/logger.js";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { defaultSupervisorPort } from "./paths.js";
import { ProjectLock } from "./project-lock.js";
import {
  loadRegistry,
  saveRegistry,
  touchServiceHeartbeat,
} from "./service-registry.js";
import { runShutdownStateMachine, releaseProjectLock } from "./shutdown.js";
import type { ProjectLockData, ServiceRegistry } from "./types.js";
import { getComposePublishedHostPorts } from "../utils/compose-published-ports.js";
import { execa } from "execa";
import { getDockerComposeLeadArgs, getComposeProjectDir } from "../services/docker-compose.js";

export type SupervisorDaemonOptions = {
  port?: number;
  healthIntervalMs?: number;
};

export class SupervisorDaemon {
  private server: http.Server | null = null;
  private lock: ProjectLock | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private registry: ServiceRegistry;
  private shuttingDown = false;

  constructor(
    private readonly loaded: LoadedConfig,
    private readonly port: number,
    registry: ServiceRegistry,
  ) {
    this.registry = registry;
  }

  static async create(loaded: LoadedConfig, port?: number): Promise<SupervisorDaemon> {
    const p = port ?? defaultSupervisorPort(loaded.config.project);
    const { createInitialRegistry } = await import("./startup.js");
    const registry = createInitialRegistry(loaded, process.pid, p);
    return new SupervisorDaemon(loaded, p, registry);
  }

  async start(): Promise<void> {
    const lockData: ProjectLockData = {
      pid: process.pid,
      projectId: this.loaded.config.project,
      configDir: this.loaded.configDir,
      supervisorPort: this.port,
      startedAt: new Date().toISOString(),
    };

    this.lock = new ProjectLock(this.loaded.configDir);
    if (!this.lock.tryAcquire(lockData)) {
      throw new Error(
        `Another wp-dev supervisor is already running for this project. Run: npm run wp-dev -- supervisor status`,
      );
    }

    this.registry = { ...this.registry, supervisorPid: process.pid, supervisorPort: this.port };
    saveRegistry(this.loaded.configDir, this.registry);
    emitLifecycleEvent(this.loaded.configDir, this.loaded.config.project, "service.register", {
      name: "supervisor",
      port: this.port,
    });

    await new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => resolve());
    });

    this.healthTimer = setInterval(() => {
      void this.healthCheck();
    }, 10_000);

    const onSignal = () => {
      void this.stop();
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/health" && req.method === "GET") {
      json(200, { ok: true, pid: process.pid, project: this.loaded.config.project });
      return;
    }

    if (url.pathname === "/services" && req.method === "GET") {
      const reg = loadRegistry(this.loaded.configDir) ?? this.registry;
      json(200, { ok: true, registry: reg });
      return;
    }

    if (url.pathname === "/ready" && req.method === "GET") {
      const reg = loadRegistry(this.loaded.configDir);
      const ready = Boolean(reg && reg.services.some((s) => s.name === "wordpress"));
      json(ready ? 200 : 503, { ok: ready });
      return;
    }

    if (url.pathname === "/shutdown" && req.method === "POST") {
      if (this.shuttingDown) {
        json(409, { ok: false, error: "already_shutting_down" });
        return;
      }
      this.shuttingDown = true;
      const removeOrphans = url.searchParams.get("removeOrphans") === "1";
      await runShutdownStateMachine(this.loaded, { removeOrphans });
      await this.stop();
      json(200, { ok: true });
      process.exit(0);
      return;
    }

    json(404, { ok: false, error: "not_found" });
  }

  private async healthCheck(): Promise<void> {
    let reg = loadRegistry(this.loaded.configDir) ?? this.registry;
    try {
      const projectDir = getComposeProjectDir(this.loaded.configDir, this.loaded.config);
      const r = await execa(
        "docker",
        [...getDockerComposeLeadArgs(this.loaded.config), "ps", "--status", "running", "--format", "json"],
        { cwd: projectDir, reject: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      const running = r.exitCode === 0 && String(r.stdout ?? "").includes("wordpress");
      reg = touchServiceHeartbeat(
        reg,
        "wordpress",
        running ? "healthy" : "unhealthy",
      );
      if (!running) {
        emitLifecycleEvent(this.loaded.configDir, this.loaded.config.project, "service.health_fail", {
          service: "wordpress",
        });
      }
    } catch {
      reg = touchServiceHeartbeat(reg, "wordpress", "unhealthy");
    }

    const ports = await getComposePublishedHostPorts(this.loaded.configDir, this.loaded.config);
    for (const s of reg.services) {
      if (s.port && ports.has(s.port)) {
        reg = touchServiceHeartbeat(reg, s.name, "healthy");
      }
    }

    this.registry = reg;
    saveRegistry(this.loaded.configDir, reg);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    releaseProjectLock(this.lock);
    this.lock = null;
  }

  getPort(): number {
    return this.port;
  }
}

export async function runSupervisorDaemon(options: { configDir?: string; port?: number } = {}): Promise<void> {
  const loaded = options.configDir
    ? (() => {
        process.chdir(options.configDir);
        return loadConfig();
      })()
    : loadConfig();
  hydrateSimplyApiKeyFromComposeEnv(loaded.configDir, loaded.config);
  hydrateStagingDbFromComposeEnv(loaded.configDir, loaded.config);
  initLogger(loaded.configDir);
  logInfo("supervisor: starting daemon");

  const daemon = await SupervisorDaemon.create(loaded, options.port);
  await daemon.start();
  logInfo(`supervisor: listening on 127.0.0.1:${daemon.getPort()}`);
}
