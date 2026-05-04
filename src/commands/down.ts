import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import {
  dockerComposeEnvPath,
  readWpPortFromDockerEnvFile,
} from "../utils/published-local-urls.js";
import { logInfo } from "../utils/logger.js";

export type DownOptions = {
  removeOrphans?: boolean;
};

export async function cmdDown(loaded: LoadedConfig, options: DownOptions = {}): Promise<void> {
  assertDockerReady();
  const envPath = dockerComposeEnvPath(loaded);
  const wpPort = readWpPortFromDockerEnvFile(envPath);
  const args = ["down", ...(options.removeOrphans ? ["--remove-orphans"] : [])];
  logInfo(`docker compose ${args.join(" ")}`);
  await compose(loaded.configDir, loaded.config, args);
  const portLine =
    wpPort != null
      ? `Published host port ${wpPort} (WP_PORT in docker/.env) should now be free on this machine.`
      : "The stack’s published port (WP_PORT in docker/.env) should now be free.";
  console.error(`\n${portLine}`);
  if (options.removeOrphans) {
    console.error("Removed orphan containers for this Compose project.");
  }
  console.error(
    "If something still listens on that port, another process or clone is using it — check with ss or lsof, or run down in other WP-dev clones.\n",
  );
}
