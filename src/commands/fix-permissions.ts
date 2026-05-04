import { userInfo } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";

/** One-off chown of bind-mounted wordpress/ to the host user so host rsync can write after Docker created files as www-data. */
export async function cmdFixPermissions(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  const { uid, gid } = userInfo();
  if (uid < 0 || gid < 0) {
    throw new Error(
      "fix-permissions needs a real host uid/gid (not supported on this OS).",
    );
  }
  logInfo(`fix-permissions: chown /var/www/html (bind mount) to ${uid}:${gid}`);
  await compose(loaded.configDir, loaded.config, [
    "run",
    "--rm",
    "--user",
    "0",
    "wordpress",
    "chown",
    "-R",
    `${uid}:${gid}`,
    "/var/www/html",
  ]);
  console.error(
    "Updated ownership of wordpress/ for your host user. If Apache cannot write uploads, chown back to www-data inside the container — see README.",
  );
}
