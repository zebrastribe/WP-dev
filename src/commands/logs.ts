import { existsSync, readFileSync } from "node:fs";
import type { LoadedConfig } from "../config/load.js";
import { logPathForConfigDir } from "../utils/logger.js";

export function cmdLogs(loaded: LoadedConfig, lineCount: number): void {
  const path = logPathForConfigDir(loaded.configDir);
  if (!existsSync(path)) {
    console.log(
      `No log file yet.\nExpected: ${path}\nRun any wpflow command (e.g. up) to create it.`,
    );
    return;
  }
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\n/);
  const n = Math.max(1, Math.min(lineCount, lines.length));
  const tail = lines.slice(-n).join("\n");
  console.log(`Log file: ${path}\n--- last ${n} lines ---\n${tail}`);
}
