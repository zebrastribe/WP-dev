import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import {
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "../services/docker-compose.js";

export type ComposePublishedPorts = {
  wp?: number;
  https?: number;
  terminal?: number;
  runner?: number;
  all: Set<number>;
};

type ComposePsRow = {
  Service?: string;
  Publishers?: Array<{ PublishedPort?: number; TargetPort?: number }>;
};

/** Host TCP ports currently published by this clone's running Compose stack. */
export async function getComposePublishedPorts(
  loaded: LoadedConfig,
): Promise<ComposePublishedPorts> {
  const projectDir = getComposeProjectDir(loaded.configDir, loaded.config);
  const r = await execa(
    "docker",
    [...getDockerComposeLeadArgs(loaded.config), "ps", "--format", "json"],
    { cwd: projectDir, reject: false },
  );

  const all = new Set<number>();
  const out: ComposePublishedPorts = { all };

  if (r.exitCode !== 0) {
    return out;
  }

  for (const line of (r.stdout || "").trim().split("\n").filter(Boolean)) {
    let row: ComposePsRow;
    try {
      row = JSON.parse(line) as ComposePsRow;
    } catch {
      continue;
    }

    for (const pub of row.Publishers ?? []) {
      const published = pub.PublishedPort;
      if (!published || published <= 0) continue;
      all.add(published);

      if (row.Service === "wordpress" && pub.TargetPort === 80) {
        out.wp = published;
      }
      if (row.Service === "local_ssl_proxy" && pub.TargetPort === 443) {
        out.https = published;
      }
      if (row.Service === "terminal" && pub.TargetPort === 7681) {
        out.terminal = published;
      }
      if (row.Service === "terminal" && pub.TargetPort === 7682) {
        out.runner = published;
      }
    }
  }

  return out;
}

export function isPortOwnedByCompose(port: number, owned: ComposePublishedPorts): boolean {
  return owned.all.has(port);
}

export type EnvPublishedPorts = {
  WP_PORT: number;
  WP_HTTPS_PORT: number;
  WPDEV_TERMINAL_PORT: number;
  WPDEV_TERMINAL_RUNNER_PORT: number;
  WPDEV_HOST_RUNNER_PORT: number;
};

/** True when running containers already publish the ports stored in docker/.env. */
export function composePortsMatchEnv(
  owned: ComposePublishedPorts,
  env: EnvPublishedPorts,
): boolean {
  if (owned.all.size === 0) return false;
  if (owned.wp != null && owned.wp !== env.WP_PORT) return false;
  if (owned.terminal != null && owned.terminal !== env.WPDEV_TERMINAL_PORT) return false;
  if (owned.runner != null && owned.runner !== env.WPDEV_TERMINAL_RUNNER_PORT) return false;
  if (owned.https != null && owned.https !== env.WP_HTTPS_PORT) return false;
  return owned.wp != null;
}
