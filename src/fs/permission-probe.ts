import { accessSync, constants, existsSync } from "node:fs";
import type { FilesystemProbeResult } from "./types.js";

export function probePath(path: string): FilesystemProbeResult {
  const issues: string[] = [];
  let readable = false;
  let writable = false;

  if (!existsSync(path)) {
    issues.push("path does not exist");
    return { ok: false, path, readable, writable, issues };
  }

  try {
    accessSync(path, constants.R_OK);
    readable = true;
  } catch {
    issues.push("not readable");
  }

  try {
    accessSync(path, constants.W_OK);
    writable = true;
  } catch {
    issues.push("not writable");
  }

  return { ok: readable && writable, path, readable, writable, issues };
}

export function probeWritable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
