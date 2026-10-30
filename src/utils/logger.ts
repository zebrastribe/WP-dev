import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load constants from docker/constants.json (single source of truth).
 * Falls back to hardcoded values if file not found (for tests).
 */
function loadConstants(): { log: { dirName: string; fileName: string } } {
  try {
    const constantsPath = join(__dirname, "../../docker/constants.json");
    return JSON.parse(readFileSync(constantsPath, "utf8"));
  } catch {
    // Fallback for test environments where file may not exist
    return { log: { dirName: "logs", fileName: "wp-dev.log" } };
  }
}

const constants = loadConstants();

/**
 * Log directory name relative to config dir.
 * Loaded from docker/constants.json (single source of truth).
 */
export const LOG_DIR_NAME = constants.log.dirName;

/**
 * Log filename.
 * Loaded from docker/constants.json (single source of truth).
 */
export const LOG_FILE_NAME = constants.log.fileName;

let logFilePath: string | null = null;
let logWriteFailedWarned = false;

/**
 * Get the log directory path for a config directory.
 */
export function logDirForConfigDir(configDir: string): string {
  return join(configDir, LOG_DIR_NAME);
}

/**
 * Get the log file path for a config directory.
 * Single source of truth for log path derivation.
 */
export function logPathForConfigDir(configDir: string): string {
  return join(configDir, LOG_DIR_NAME, LOG_FILE_NAME);
}

export function initLogger(configDir: string): void {
  const dir = logDirForConfigDir(configDir);
  mkdirSync(dir, { recursive: true });
  logFilePath = logPathForConfigDir(configDir);
  appendRaw(`[${iso()}] [info] --- session start ---\n`);
}

export function getLogFilePath(): string | null {
  return logFilePath;
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
