import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";

export async function cmdDown(loaded: LoadedConfig): Promise<void> {
  await compose(loaded.configDir, loaded.config, ["down"]);
}
