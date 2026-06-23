import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { getRunningSupervisorInfo } from "./recovery.js";

export { getRunningSupervisorInfo };
import { defaultSupervisorPort } from "./paths.js";
import { supervisorPidPath } from "./paths.js";
import type { ServiceRegistry } from "./types.js";

export async function supervisorHealth(port: number): Promise<boolean> {
  try {
    const r = await execa(
      "curl",
      ["-sf", `http://127.0.0.1:${port}/health`],
      { reject: false, stdio: "pipe" },
    );
    return r.exitCode === 0;
  } catch {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export async function waitForSupervisorReady(
  port: number,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function fetchSupervisorServices(port: number): Promise<ServiceRegistry | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/services`);
    if (!res.ok) return null;
    const data = (await res.json()) as { registry?: ServiceRegistry };
    return data.registry ?? null;
  } catch {
    return null;
  }
}

export async function requestSupervisorShutdown(
  port: number,
  removeOrphans = false,
): Promise<boolean> {
  try {
    const url = `http://127.0.0.1:${port}/shutdown${removeOrphans ? "?removeOrphans=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export function resolveSupervisorPort(loaded: LoadedConfig): number {
  const running = getRunningSupervisorInfo(loaded.configDir);
  if (running) return running.port;
  return defaultSupervisorPort(loaded.config.project);
}

export async function ensureSupervisorRunning(loaded: LoadedConfig): Promise<number> {
  const port = resolveSupervisorPort(loaded);
  if (await supervisorHealth(port)) return port;

  const cliPath = join(loaded.configDir, "dist", "cli.js");
  const entry = existsSync(cliPath) ? cliPath : process.argv[1];
  mkdirSync(join(loaded.configDir, "logs"), { recursive: true });
  const child = spawn(process.execPath, [entry, "supervisor", "run"], {
    cwd: loaded.configDir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WPDEV_SUPERVISOR_PORT: String(port) },
  });
  child.unref();
  writeFileSync(supervisorPidPath(loaded.configDir), `${child.pid}\n`, "utf8");

  for (let i = 0; i < 30; i++) {
    if (await supervisorHealth(port)) return port;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Supervisor failed to start. Check logs/wp-dev.log");
}

export function readSupervisorPortFromEnv(): number | undefined {
  const raw = process.env.WPDEV_SUPERVISOR_PORT;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function isSupervisorAlreadyRunning(loaded: LoadedConfig): boolean {
  const info = getRunningSupervisorInfo(loaded.configDir);
  return info !== null;
}

export function formatDuplicateInstanceMessage(loaded: LoadedConfig): string {
  const info = getRunningSupervisorInfo(loaded.configDir);
  if (!info) return "";
  return (
    `wp-dev supervisor already running (PID ${info.pid}, port ${info.port}).\n` +
    `  Reconnect: npm run wp-dev -- supervisor status\n` +
    `  Stop:      npm run wp-dev -- down\n`
  );
}
