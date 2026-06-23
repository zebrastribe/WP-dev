import { isPortOwnedByComposeProject } from "../utils/compose-published-ports.js";
import { isPortFree } from "./port-probe.js";

export async function findFreePort(
  startAt: number,
  projectPorts: Set<number>,
): Promise<number> {
  for (let p = startAt; p <= 65535; p++) {
    if (isPortOwnedByComposeProject(p, projectPorts) || (await isPortFree(p))) return p;
  }
  throw new Error(`Could not find a free local TCP port from ${startAt}..65535`);
}
