import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let logFilePath: string | null = null;
let logWriteFailedWarned = false;

export function initLogger(configDir: string): void {
  const dir = join(configDir, "logs");
  mkdirSync(dir, { recursive: true });
  logFilePath = join(dir, "wp-dev.log");
  appendRaw(`[${iso()}] [info] --- session start ---\n`);
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

export function logPathForConfigDir(configDir: string): string {
  return join(configDir, "logs", "wp-dev.log");
}

function iso(): string {
  return new Date().toISOString();
}

function appendRaw(line: string): void {
  if (!logFilePath) return;
  try {
    appendFileSync(logFilePath, line, "utf8");
  } catch (err) {
    if (!logWriteFailedWarned) {
      logWriteFailedWarned = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[wp-dev] Warning: log write failed (${logFilePath}): ${msg}`);
    }
  }
}

function write(level: string, message: string, mirrorStderr: boolean): void {
  const line = `[${iso()}] [${level}] ${message}\n`;
  appendRaw(line);
  if (mirrorStderr) console.error(message);
}

export function logInfo(message: string): void {
  write("info", message, false);
}

export function logWarn(message: string): void {
  write("warn", message, true);
}

export function logError(message: string): void {
  write("error", message, true);
}
