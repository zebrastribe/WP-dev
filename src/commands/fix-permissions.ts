import { userInfo } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";

/** Paths WordPress (www-data) must write at runtime — not theme dev trees. */
export const RUNTIME_WRITE_PATHS = [
  "/var/www/html/wp-content/uploads",
  "/var/www/html/wp-content/upgrade",
  "/var/www/html/wp-content/cache",
  "/var/www/html/wp-content/plugins",
  "/var/www/html/wp-content/upgrade-temp-backup",
  "/var/www/html/wp-content/languages",
] as const;

export type FixPermissionsOptions = {
  /**
   * When true, skip the success message on stderr (used when pull runs this automatically).
   */
  quiet?: boolean;
  /**
   * When false, skip restoring www-data write access on runtime paths after host chown.
   */
  runtime?: boolean;
};

export type FixRuntimeWritePermissionsOptions = {
  quiet?: boolean;
};

function runtimeWriteShell(): string {
  const mkdirs = RUNTIME_WRITE_PATHS.map((p) => `mkdir -p ${p}`).join(" && ");
  const chowns = RUNTIME_WRITE_PATHS.map((p) => `chown -R 33:33 ${p}`).join(" && ");
  const chmodDirs = RUNTIME_WRITE_PATHS.map(
    (p) => `find ${p} -type d -exec chmod 775 {} +`,
  ).join(" && ");
  const chmodFiles = RUNTIME_WRITE_PATHS.map(
    (p) => `find ${p} -type f -exec chmod 664 {} +`,
  ).join(" && ");
  return [mkdirs, chowns, chmodDirs, chmodFiles].join(" && ");
}

/**
 * chown bind-mounted wordpress/ to the host user so host rsync can write after Docker
 * created files as www-data.
 *
 * By default also restores www-data ownership on runtime paths (plugins, upgrade, uploads)
 * so WordPress admin updates keep working while wp-content/themes stays host-editable.
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
  const restoreRuntime = options.runtime !== false;

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

  if (restoreRuntime) {
    await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
  }

  if (!options.quiet) {
    if (restoreRuntime) {
      console.error(
        "Updated ownership of wordpress/ for your host user and restored www-data write access on wp-content/plugins, upgrade, uploads, and cache.",
      );
      console.error(
        "Theme files under wp-content/themes remain host-editable. Plugin/theme updates from wp-admin should work.",
      );
    } else {
      console.error(
        "Updated ownership of wordpress/ for your host user. Run `wp-dev fix-runtime-permissions` before plugin updates in wp-admin.",
      );
    }
  }
}

/**
 * Make runtime-writable WordPress paths owned by www-data for plugin/theme updates and uploads.
 * Does not change ownership of wp-content/themes (host dev editing).
 */
export async function cmdFixRuntimeWritePermissions(
  loaded: LoadedConfig,
  options: FixRuntimeWritePermissionsOptions = {},
): Promise<void> {
  assertDockerReady();
  logInfo("fix-runtime-write-permissions: chown/chmod runtime wp-content paths for www-data");
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
      runtimeWriteShell(),
    ],
    { stdio: "pipe" },
  );
  if (!options.quiet) {
    console.error(
      "Updated www-data ownership on wp-content/plugins, upgrade, uploads, cache, and languages.",
    );
  }
}
