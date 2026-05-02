import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { logInfo } from "../utils/logger.js";

export async function cmdUp(loaded: LoadedConfig): Promise<void> {
  logInfo("docker compose up -d");
  await compose(loaded.configDir, loaded.config, ["up", "-d"]);
}
