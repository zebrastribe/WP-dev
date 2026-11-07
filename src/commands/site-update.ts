import { execa } from "execa";
import {
  assertComponentSlug,
  buildSiteUpdateScript,
  buildUpdateCheckScript,
  parseUpdateCheckOutput,
  type ComponentUpdate,
} from "@wpdev/sync-engine";
import type { LoadedConfig } from "../config/load.js";
import {
  buildComposeEnv,
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "../services/docker-compose.js";

const LOCAL_WP = "/var/www/html";

async function runInWpCli(loaded: LoadedConfig, script: string) {
  const projectDir = getComposeProjectDir(loaded.configDir, loaded.config);
  const result = await execa(
    "docker",
    [
      ...getDockerComposeLeadArgs(loaded.config),
      "run",
      "--rm",
      "-T",
      "--entrypoint",
      "bash",
      loaded.config.local.composeService,
      "-lc",
      script,
    ],
    {
      cwd: projectDir,
      env: buildComposeEnv(projectDir),
      reject: false,
      all: false,
    },
  );
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 1,
  };
}

export async function cmdSiteUpdateCheck(loaded: LoadedConfig): Promise<void> {
  const ran = await runInWpCli(loaded, buildUpdateCheckScript(LOCAL_WP));
  if (!ran.stdout.includes("WPDEV_UPDATE_SECTION")) {
    throw new Error(ran.stderr.trim() || ran.stdout.trim() || "Update check did not run.");
  }
  process.stdout.write(`${JSON.stringify(parseUpdateCheckOutput(ran.stdout))}\n`);
}

export async function cmdSiteUpdateApply(
  loaded: LoadedConfig,
  item: ComponentUpdate,
): Promise<void> {
  if (item.target !== "core") assertComponentSlug(item.slug);
  const ran = await runInWpCli(loaded, buildSiteUpdateScript(LOCAL_WP, item));
  if (ran.stdout) process.stdout.write(ran.stdout.endsWith("\n") ? ran.stdout : `${ran.stdout}\n`);
  if (ran.exitCode !== 0) {
    throw new Error(ran.stderr.trim() || "The update did not finish.");
  }
}
