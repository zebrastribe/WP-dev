import type { LoadedConfig } from "../config/load.js";
import { writeWpDevConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

function extractBoundPort(message: string): number | null {
  const m = message.match(/:(\d+)\s+failed:\s+port is already allocated/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getComposeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

function getComposeEnvExamplePath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env.example");
}

function ensureComposeEnvExists(loaded: LoadedConfig): string {
  const envPath = getComposeEnvPath(loaded);
  if (existsSync(envPath)) return envPath;
  const example = getComposeEnvExamplePath(loaded);
  if (existsSync(example)) {
    copyFileSync(example, envPath);
    return envPath;
  }
  writeFileSync(envPath, "WP_PORT=8888\n", "utf8");
  return envPath;
}

function setWpPortInEnvFile(path: string, port: number): void {
  const line = `WP_PORT=${port}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^WP_PORT=.*$/m.test(current)) {
    const next = current.replace(/^WP_PORT=.*$/m, line);
    writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return;
  }
  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  writeFileSync(path, `${prefix}${line}\n`, "utf8");
}

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "0.0.0.0", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startAt: number): Promise<number> {
  for (let p = startAt; p <= 65535; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`Could not find a free local TCP port from ${startAt}..65535`);
}

function maybeUpdateLocalUrlPort(
  loaded: LoadedConfig,
  oldPort: number,
  newPort: number,
): void {
  const raw = loaded.config.local.url;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  const currentPort = u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if ((host === "localhost" || host === "127.0.0.1") && currentPort === oldPort) {
    u.port = String(newPort);
    loaded.config.local.url = u.toString().replace(/\/$/, "");
    writeWpDevConfig(loaded.configDir, loaded.config);
  }
}

function printPublishedAccessUrls(loaded: LoadedConfig): void {
  const { site, admin, warnings } = getPublishedLocalAccess(loaded);
  for (const w of warnings) console.error(w);
  console.error(`\nLocal WordPress: ${site}`);
  console.error(`Browser admin:   ${admin}`);
  console.error(
    `\nTo stop this stack and free the published port: npm run wp-dev -- down`,
  );
  console.error(
    `(Each clone has its own Compose project; WP_PORT is in docker/.env.)\n`,
  );
}

async function ensureAdminSaveWriteAccess(loaded: LoadedConfig): Promise<void> {
  try {
    // Best-effort: make bind-mounted admin-write targets writable for Apache/PHP in the container.
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "exec",
        "-T",
        "-u",
        "0",
        "wordpress",
        "sh",
        "-lc",
        [
          "touch /wp-dev-repo/wp-dev.config.json",
          "chmod 666 /wp-dev-repo/wp-dev.config.json",
          "mkdir -p /wp-dev-repo/docker",
          "touch /wp-dev-repo/docker/.env",
          "chmod 777 /wp-dev-repo/docker",
          "chmod 666 /wp-dev-repo/docker/.env",
        ].join(" && "),
      ],
      { stdio: "pipe" },
    );
    logInfo("admin save: ensured config and docker/.env mounts are writable");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`admin save: could not enforce writable mounts (${msg})`);
    console.error(
      "Warning: could not auto-fix admin save permissions. If save fails, run:\n" +
        "  chmod u+rw wp-dev.config.json\n" +
        "  chmod o+w docker docker/.env\n",
    );
  }
}

export async function cmdUp(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  try {
    logInfo("docker compose up -d");
    await compose(loaded.configDir, loaded.config, ["up", "-d"], { stdio: "pipe" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const conflictPort = extractBoundPort(msg);
    if (!conflictPort) throw e;

    const nextPort = await findFreePort(conflictPort + 1);
    const envPath = ensureComposeEnvExists(loaded);
    setWpPortInEnvFile(envPath, nextPort);
    maybeUpdateLocalUrlPort(loaded, conflictPort, nextPort);

    logInfo(
      `Port ${conflictPort} is in use. Updated ${envPath} to WP_PORT=${nextPort} and retrying docker compose up -d`,
    );
    console.error(
      `Port ${conflictPort} is already in use. Switched this clone to WP_PORT=${nextPort} and retrying...`,
    );

    await compose(loaded.configDir, loaded.config, ["up", "-d"], { stdio: "pipe" });
  }

  await ensureAdminSaveWriteAccess(loaded);
  printPublishedAccessUrls(loaded);
}
