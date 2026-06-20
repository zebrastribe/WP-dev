import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../../config/load.js";
import { dockerComposeProjectId } from "../../services/docker-compose.js";

export async function cmdImportIngest(loaded: LoadedConfig): Promise<void> {
  const apiDir = join(loaded.configDir, "content-recovery-workspace", "api");
  const script = join(apiDir, "cli-ingest.php");
  const kbPath =
    loaded.config.importWorkspace?.knowledgeBasePath ??
    join(loaded.configDir, "..", "knowledge-base");

  const env = {
    ...process.env,
    WPDEV_PROJECT: loaded.config.project,
    WPDEV_KNOWLEDGE_BASE: kbPath,
  };

  if (existsSync("/.dockerenv") || (await commandExists("php"))) {
    const php = existsSync("/.dockerenv") ? "php" : "php";
    if (await commandExists("php")) {
      const { stdout } = await execa(php, [script], { cwd: apiDir, env, reject: true });
      process.stdout.write(stdout);
      return;
    }
  }

  const project = dockerComposeProjectId(loaded.config);
  const composeFile = join(loaded.configDir, loaded.config.local.path, loaded.config.local.composeFile);
  console.log("[wp-dev] import ingest: running via Docker (php not on host)…");
  const { stdout } = await execa(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "-p",
      project,
      "exec",
      "-u",
      "www-data",
      "wordpress",
      "php",
      "/var/www/html/import/api/cli-ingest.php",
    ],
    { cwd: join(loaded.configDir, loaded.config.local.path), env, reject: true },
  );
  process.stdout.write(stdout);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execa("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}
