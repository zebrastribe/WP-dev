import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { logInfo } from "../utils/logger.js";
import {
  getPublishedLocalAccess,
  readWpPortFromDockerEnvFile,
  dockerComposeEnvPath,
} from "../utils/published-local-urls.js";

/**
 * The only port WP-dev cloud is allowed to know.
 * WordPress, HTTPS, and the terminal runners stay on whatever port each project published.
 * Do not change this without the same change in WP-dev-cloud `apps/control-web/src/localProbe.ts`.
 */
export const COMPANION_BEACON_PORT = 8870;

export type CompanionRecord = {
  project: string;
  configDir: string;
  site: string;
  admin: string;
  wpPort: number;
  updatedAt: string;
};

export function companionDir(): string {
  return process.env.WPDEV_COMPANION_DIR ?? join(homedir(), ".wp-dev", "companions");
}

export function companionBeaconPort(): number {
  const raw = process.env.WPDEV_COMPANION_BEACON_PORT;
  if (!raw) return COMPANION_BEACON_PORT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : COMPANION_BEACON_PORT;
}

function fileNameForProject(project: string): string {
  const safe = project.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "wp-dev-site"}.json`;
}

function readRecord(path: string): CompanionRecord | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<CompanionRecord>;
    if (!data.project || !data.site || !data.admin || !data.configDir) return null;
    if (!Number.isFinite(data.wpPort) || (data.wpPort ?? 0) <= 0) return null;
    return data as CompanionRecord;
  } catch {
    return null;
  }
}

function portAnswers(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Companions whose WordPress port still accepts a connection. */
export async function listLiveCompanions(): Promise<CompanionRecord[]> {
  let names: string[] = [];
  try {
    names = readdirSync(companionDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const records = names
    .map((name) => readRecord(join(companionDir(), name)))
    .filter((row): row is CompanionRecord => row !== null);
  const live: CompanionRecord[] = [];
  for (const row of records) {
    if (await portAnswers(row.wpPort)) live.push(row);
  }
  return live.sort((a, b) => a.project.localeCompare(b.project));
}

export function writeCompanionRecord(record: CompanionRecord): void {
  const dir = companionDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, fileNameForProject(record.project));
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, dest);
}

export function removeCompanionRecord(project: string): void {
  const dest = join(companionDir(), fileNameForProject(project));
  rmSync(dest, { force: true });
}

export async function readBeaconHealth(port = companionBeaconPort()): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return false;
    const body = (await res.json()) as { product?: string };
    return body.product === "wp-dev";
  } catch {
    return false;
  }
}

function allowedBeaconOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const extra = (process.env.WPDEV_COMPANION_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return origin;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
  return null;
}

/** Loopback JSON only. WordPress ports are never chosen here. */
export function startCompanionBeacon(port = companionBeaconPort()): Promise<Server> {
  const server = createServer((req, res) => {
    const origin = allowedBeaconOrigin(req.headers.origin);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(origin ? 204 : 403);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }
    void listLiveCompanions().then((companions) => {
      const body = {
        ok: true,
        product: "wp-dev",
        beaconPort: port,
        companions: companions.map(({ configDir: _configDir, ...row }) => row),
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

async function ensureBeaconProcess(): Promise<void> {
  if (process.env.WPDEV_COMPANION_BEACON === "off") return;
  const port = companionBeaconPort();
  if (await readBeaconHealth(port)) return;
  const entry = process.argv[1];
  if (!entry) {
    console.error(`Companion beacon is not running on 127.0.0.1:${port}.`);
    return;
  }
  const child = spawn(process.execPath, [entry, "companion", "serve"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    if (await readBeaconHealth(port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(
    `Companion beacon did not answer on 127.0.0.1:${port}. ` +
      `The local site can still run. WP-dev cloud finds local sites only through that beacon.`,
  );
}

export async function publishLocalCompanion(loaded: LoadedConfig): Promise<void> {
  const access = getPublishedLocalAccess(loaded);
  const wpPort = readWpPortFromDockerEnvFile(dockerComposeEnvPath(loaded));
  if (wpPort == null) {
    logInfo("companion: skipped publish, docker/.env has no WP_PORT");
    return;
  }
  writeCompanionRecord({
    project: loaded.config.project,
    configDir: loaded.configDir,
    site: access.site,
    admin: access.admin,
    wpPort,
    updatedAt: new Date().toISOString(),
  });
  await ensureBeaconProcess();
  logInfo(`companion: published ${loaded.config.project} on port ${wpPort}`);
}

export function withdrawLocalCompanion(project: string): void {
  removeCompanionRecord(project);
  logInfo(`companion: withdrew ${project}`);
}
