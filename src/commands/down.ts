import type { LoadedConfig } from "../config/load.js";
import {
  dockerComposeEnvPath,
  readWpPortFromDockerEnvFile,
} from "../utils/published-local-urls.js";
import { logInfo } from "../utils/logger.js";
import {
  getRunningSupervisorInfo,
  requestSupervisorShutdown,
} from "../supervisor/client.js";
import { runShutdownStateMachine } from "../supervisor/shutdown.js";

export type DownOptions = {
  removeOrphans?: boolean;
};

export async function cmdDown(loaded: LoadedConfig, options: DownOptions = {}): Promise<void> {
  const envPath = dockerComposeEnvPath(loaded);
  const wpPort = readWpPortFromDockerEnvFile(envPath);
  const supervisor = getRunningSupervisorInfo(loaded.configDir);

  if (supervisor) {
    logInfo("down: requesting supervisor shutdown");
    const ok = await requestSupervisorShutdown(supervisor.port, options.removeOrphans);
    if (ok) {
      console.error("\nSupervisor shut down the local stack.");
      if (wpPort != null) {
        console.error(`Published host port ${wpPort} (WP_PORT) should now be free.`);
      }
      return;
    }
    logInfo("down: supervisor HTTP shutdown failed; running inline shutdown");
  }

  await runShutdownStateMachine(loaded, options);

  const portLine =
    wpPort != null
      ? `Published host port ${wpPort} (WP_PORT in docker/.env) should now be free on this machine.`
      : "The stack's published port (WP_PORT in docker/.env) should now be free.";
  console.error(`\n${portLine}`);
  if (options.removeOrphans) {
    console.error("Removed orphan containers for this Compose project.");
  }
  console.error(
    "Service registry: logs/service-registry.json (shutdown complete).\n",
  );
}
