import { userInfo } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";

export type FixPermissionsOptions = {
  /**
   * When true, skip the success message on stderr (used when pull runs this automatically).
   */
  quiet?: boolean;
};

/**
 * chown bind-mounted wordpress/ to the host user so host rsync can write after Docker
 * created files as www-data.
 *
 * Uses `--entrypoint chown` so the WordPress image entrypoint does not reset ownership
 * to www-data before our command runs. Uses `--no-deps` so MySQL does not need to be up.
 */
export async function cmdFixPermissions(
  loaded: LoadedConfig,
  options: FixPermissionsOptions = {},
): Promise<void> {
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
    "--no-deps",
    "--user",
    "0",
    "--entrypoint",
    "chown",
    "wordpress",
    "-R",
    `${uid}:${gid}`,
    "/var/www/html",
  ]);
  if (!options.quiet) {
    console.error(
      "Updated ownership of wordpress/ for your host user. If Apache cannot write uploads, chown back to www-data inside the container — see README.",
    );
  }
}
