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

/** Apache / wpcli user in official wordpress:* images. */
export const WWW_DATA_UID = 33;
export const WWW_DATA_GID = 33;

/**
 * Paths under /var/www/html owned by www-data so wp-admin updates, uploads, and cache work.
 * Themes are intentionally excluded so the host user can edit wp-content/themes/.
 */
export const RUNTIME_WRITE_PATHS = [
  "wp-content/upgrade",
  "wp-content/upgrade-temp-backup",
  "wp-content/plugins",
  "wp-content/uploads",
  "wp-content/cache",
  "wp-content/languages",
  "wp-content/mu-plugins",
] as const;

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** Shell script run inside the wordpress container (root) to fix runtime write ownership. */
export function buildRuntimeWritePermissionsShell(
  htmlRoot = "/var/www/html",
): string {
  const runtimeAbs = RUNTIME_WRITE_PATHS.map((rel) => `${htmlRoot}/${rel}`);
  const mkdirTargets = [
    ...runtimeAbs,
    `${htmlRoot}/wp-content/themes`,
  ];
  const mkdirCmd = mkdirTargets
    .map((p) => `mkdir -p ${shellQuote(p)}`)
    .join(" && ");
  const chownCmd = runtimeAbs
    .map(
      (p) =>
        `chown -R ${WWW_DATA_UID}:${WWW_DATA_GID} ${shellQuote(p)} && find ${shellQuote(p)} -type d -exec chmod 775 {} + && find ${shellQuote(p)} -type f -exec chmod 664 {} +`,
    )
    .join(" && ");
  return `${mkdirCmd} && ${chownCmd}`;
}

/**
 * chown bind-mounted wordpress/ to the host user so host rsync can write after Docker
 * created files as www-data, then restore www-data ownership on runtime-only paths.
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
  await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
  if (!options.quiet) {
    console.error(
      "Updated ownership of wordpress/ for your host user (themes, core). " +
        "Runtime paths (upgrade, upgrade-temp-backup, plugins, uploads, cache) are www-data for wp-admin updates.",
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
      buildRuntimeWritePermissionsShell(),
    ],
    { stdio: "pipe" },
  );
  if (!options.quiet) {
    console.error(
      "Updated wp-content runtime paths for WordPress writes (upgrade, upgrade-temp-backup, plugins, uploads, cache). " +
        "Themes remain host-owned for local editing.",
    );
  }
}
