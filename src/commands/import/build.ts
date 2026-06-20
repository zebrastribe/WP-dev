import { execa } from "execa";
import { join } from "node:path";
import type { LoadedConfig } from "../../config/load.js";

export async function cmdImportBuild(loaded: LoadedConfig): Promise<void> {
  const appDir = join(loaded.configDir, "content-recovery-workspace", "app");
  await execa("npm", ["run", "build:wp"], { cwd: appDir, stdio: "inherit" });
  console.log("\n[wp-dev] Import workspace built to wordpress/import/");
  console.log(`Open: ${loaded.config.local.url.replace(/\/$/, "")}/import/\n`);
}
