import type { LoadedConfig } from "../config/load.js";
import { cmdSupervisorStatus } from "./supervisor.js";

/** List managed services from the service registry. */
export async function cmdServices(loaded: LoadedConfig): Promise<void> {
  await cmdSupervisorStatus(loaded);
}
