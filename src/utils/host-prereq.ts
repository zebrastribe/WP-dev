import { execaSync } from "execa";
import { isMacOs } from "./platform-hints.js";

function tryCommand(cmd: string, args: string[]): boolean {
  try {
    execaSync(cmd, args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Ensures host tools required for pull/push (SSH + rsync) are available. */
export function assertHostSyncTools(): void {
  const missing: string[] = [];
  if (!tryCommand("ssh", ["-V"])) missing.push("ssh");
  if (!tryCommand("rsync", ["--version"])) missing.push("rsync");

  if (missing.length === 0) return;

  const mac =
    isMacOs() &&
    "\nmacOS: install Xcode Command Line Tools if needed: xcode-select --install";
  throw new Error(
    `Missing required tools for sync: ${missing.join(", ")}.${mac ?? ""}`,
  );
}
