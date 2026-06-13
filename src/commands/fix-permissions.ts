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

export type FixRuntimeWritePermissionsOptions = {
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

/**
 * Make runtime-writable WordPress paths owned by www-data for plugin/theme updates and uploads.
 * Kept separate from `cmdFixPermissions` (host ownership) so pull can do:
 * host-writeable before rsync, runtime-writeable after sync.
 */
export async function cmdFixRuntimeWritePermissions(
  loaded: LoadedConfig,
  options: FixRuntimeWritePermissionsOptions = {},
): Promise<void> {
  assertDockerReady();
  logInfo("fix-runtime-write-permissions: chown/chmod wp-content for www-data");
  await compose(
    loaded.configDir,
    loaded.config,
    [
      "run",
      "--rm",
      "--no-deps",
      "--user",
      "0",
      "--entrypoint",
      "sh",
      "wordpress",
      "-lc",
      [
        "mkdir -p /var/www/html/wp-content/mu-plugins",
        "mkdir -p /var/www/html/wp-content/uploads /var/www/html/wp-content/upgrade",
        "mkdir -p /var/www/html/wp-content/plugins /var/www/html/wp-content/themes",
        "mkdir -p /var/www/html/wp-content/cache",
        "chown -R 33:33 /var/www/html/wp-content",
        "find /var/www/html/wp-content -type d -exec chmod 775 {} +",
        "find /var/www/html/wp-content -type f -exec chmod 664 {} +",
      ].join(" && "),
    ],
    { stdio: "pipe" },
  );
  if (!options.quiet) {
    console.error(
      "Updated wp-content ownership/permissions for WordPress runtime writes (uploads/plugins/cache).",
    );
  }
}
