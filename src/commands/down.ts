import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { logInfo } from "../utils/logger.js";

export async function cmdDown(loaded: LoadedConfig): Promise<void> {
  logInfo("docker compose down");
  await compose(loaded.configDir, loaded.config, ["down"]);
}
