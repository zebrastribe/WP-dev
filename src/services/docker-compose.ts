import { execa } from "execa";
import { join } from "node:path";
import type { WpDevConfig } from "../config/schema.js";
import { resolveFromConfigDir } from "../config/load.js";

/** Stable Docker Compose project id so each clone gets its own containers/volumes. */
export function dockerComposeProjectId(config: WpDevConfig): string {
  const raw = config.local.composeProjectName ?? config.project;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.length > 0 ? s : "wp-dev-site";
}

/** Prefix: `docker compose -p <id> -f <composeFile>`. */
export function getDockerComposeLeadArgs(config: WpDevConfig): string[] {
  return [
    "compose",
    "-p",
    dockerComposeProjectId(config),
    "-f",
    config.local.composeFile,
  ];
}

export function getComposeProjectDir(
  configDir: string,
  config: WpDevConfig,
): string {
  return resolveFromConfigDir(configDir, config.local.path);
}

export function getComposeFilePath(
  configDir: string,
  config: WpDevConfig,
): string {
  return join(getComposeProjectDir(configDir, config), config.local.composeFile);
}

export async function compose(
  configDir: string,
  config: WpDevConfig,
  composeArgs: string[],
  options: { stdio?: "inherit" | "pipe" } = {},
): Promise<void> {
  const projectDir = getComposeProjectDir(configDir, config);
  await execa(
    "docker",
    [...getDockerComposeLeadArgs(config), ...composeArgs],
    {
      cwd: projectDir,
      stdio: options.stdio ?? "inherit",
      reject: false,
    },
  ).then((r) => {
    if (r.exitCode !== 0) {
      throw new Error(`docker compose failed with exit code ${r.exitCode}`);
    }
  });
}
