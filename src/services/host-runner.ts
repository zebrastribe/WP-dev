import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

function pidFilePath(configDir: string): string {
  return join(configDir, "logs", "wp-dev-host-runner.pid");
}

function parsePid(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopHostRunner(configDir: string): void {
  const pidPath = pidFilePath(configDir);
  if (!existsSync(pidPath)) return;
  const pid = parsePid(readFileSync(pidPath, "utf8"));
  if (!pid) return;
  if (!isPidAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}

export function startHostRunner(configDir: string, envPath: string): void {
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const auth = readEnvValue(envContent, "WPDEV_TERMINAL_AUTH");
  const token = readEnvValue(envContent, "WPDEV_TERMINAL_RUNNER_TOKEN");
  const origin = readEnvValue(envContent, "WPDEV_TERMINAL_RUNNER_ORIGIN");
  const port = readEnvValue(envContent, "WPDEV_HOST_RUNNER_PORT") || "7683";
  if (!auth || !token || !origin) {
    return;
  }

  const logsDir = join(configDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const pidPath = pidFilePath(configDir);
  if (existsSync(pidPath)) {
    const existingPid = parsePid(readFileSync(pidPath, "utf8"));
    if (existingPid && isPidAlive(existingPid)) return;
  }

  const child = spawn(process.execPath, [join(configDir, "docker", "host-runner.mjs")], {
    cwd: configDir,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WPDEV_HOST_RUNNER_PORT: port,
      WPDEV_TERMINAL_AUTH: auth,
      WPDEV_TERMINAL_RUNNER_TOKEN: token,
      WPDEV_TERMINAL_RUNNER_ORIGIN: origin,
      WPDEV_TERMINAL_WORKDIR: configDir,
    },
  });
  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`, "utf8");
}
