import { execa } from "execa";

/** Cross-platform check that a CLI exists on PATH (macOS, Linux, Windows). */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execa("where", [cmd], { stdio: "pipe" });
    } else {
      await execa("which", [cmd], { stdio: "pipe" });
    }
    return true;
  } catch {
    try {
      await execa(cmd, ["--version"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}
