import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { resolveHostIdentity } from "../utils/host-paths.js";
import { logInfo } from "../utils/logger.js";
import { posixShellQuote } from "../utils/shell-quote.js";

/**
 * LOCAL DOCKER ONLY.
 * All chown/chmod here run via `docker compose … wordpress` on the bind-mounted
 * `/var/www/html`. They must **never** run over SSH against staging/production.
 * Push uses rsync `--no-owner --no-group` so remote ownership is preserved.
 */

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
 * Paths under /var/www/html owned by www-data so wp-admin uploads/cache/plugin dirs work cleanly.
 * Core (`wp-admin`, `wp-includes`, root PHP) uses host:www-data shared write instead — required for
 * WordPress core updates with FS_METHOD=direct (see buildHostSharedWritePermissionsShell).
 */
export const RUNTIME_WRITE_PATHS = [
  "wp-content/upgrade",
  "wp-content/upgrade-temp-backup",
  "wp-content/plugins",
  "wp-content/uploads",
  "wp-content/cache",
  "wp-content/languages",
  "wp-content/mu-plugins",
  /** All-in-One WP Migration — needs www-data to write .htaccess / index stubs. */
  "wp-content/ai1wm-backups",
] as const;

/**
 * Paths kept host-owned (not reassigned to www-data:www-data) so the IDE can edit them.
 * They still get host:www-data + group write via the shared-tree pass.
 */
export const HOST_SHARED_WRITE_PATHS = ["wp-content/themes"] as const;

/** Shell: www-data owns runtime plugin/upload paths. */
export function buildRuntimeWritePermissionsShell(
  htmlRoot = "/var/www/html",
): string {
  const runtimeAbs = RUNTIME_WRITE_PATHS.map((rel) => `${htmlRoot}/${rel}`);
  const mkdirTargets = [
    ...runtimeAbs,
    ...HOST_SHARED_WRITE_PATHS.map((rel) => `${htmlRoot}/${rel}`),
  ];
  const mkdirCmd = mkdirTargets
    .map((p) => `mkdir -p ${posixShellQuote(p)}`)
    .join(" && ");
  const chownCmd = runtimeAbs
    .map(
      (p) =>
        `chown -R ${WWW_DATA_UID}:${WWW_DATA_GID} ${posixShellQuote(p)} && find ${posixShellQuote(p)} -type d -exec chmod 775 {} + && find ${posixShellQuote(p)} -type f -exec chmod 664 {} +`,
    )
    .join(" && ");
  return `${mkdirCmd} && ${chownCmd}`;
}

/**
 * WordPress FS_METHOD=direct standard for bind mounts: host owns files, www-data is the
 * group with write bit set (dirs 2775 setgid, files 664). Applied to the **entire** tree so
 * core updates can copy into wp-admin / wp-includes / root PHP — not only themes.
 *
 * Call **before** buildRuntimeWritePermissionsShell so runtime paths can then become
 * www-data:www-data without losing shared write on core.
 */
export function buildHostSharedWritePermissionsShell(
  hostUid: number,
  htmlRoot = "/var/www/html",
): string {
  if (!Number.isFinite(hostUid) || hostUid <= 0) {
    throw new Error("buildHostSharedWritePermissionsShell requires a positive hostUid");
  }
  const root = posixShellQuote(htmlRoot);
  return [
    `mkdir -p ${root}`,
    `chown -R ${hostUid}:${WWW_DATA_GID} ${root}`,
    `find ${root} -type d -exec chmod 2775 {} +`,
    `find ${root} -type f -exec chmod 664 {} +`,
  ].join(" && ");
}

/**
 * Probe as www-data: runtime paths, themes, wp-content, and wp-admin (core update).
 */
export function buildLocalRuntimeWriteProbeShell(
  htmlRoot = "/var/www/html",
  marker = "wp-dev-doctor-probe",
): string {
  const dirs = [
    ...RUNTIME_WRITE_PATHS.map((rel) => `${htmlRoot}/${rel}/${marker}`),
    ...HOST_SHARED_WRITE_PATHS.map((rel) => `${htmlRoot}/${rel}/${marker}`),
    `${htmlRoot}/wp-content/${marker}`,
    `${htmlRoot}/wp-admin/${marker}`,
    `${htmlRoot}/wp-includes/${marker}`,
  ];
  const list = dirs.map((d) => posixShellQuote(d)).join(" ");
  return [
    `for d in ${list}; do`,
    `  mkdir -p "$d" && touch "$d/.write-test" && rm -rf "$d" || exit 1`,
    `done`,
    // Core update must be able to overwrite existing files (not only create new dirs).
    `test -w ${posixShellQuote(`${htmlRoot}/wp-admin/includes`)} || exit 1`,
  ].join("\n");
}

/** Short label for CLI/doctor messages (basename of each runtime path). */
export function runtimeWritePathsLabel(): string {
  return RUNTIME_WRITE_PATHS.map((p) => p.replace(/^wp-content\//, "")).join(", ");
}

export function hostSharedWritePathsLabel(): string {
  return "entire tree (host:www-data), themes stay host-editable";
}

/**
 * chown bind-mounted wordpress/ to the host user only (no www-data runtime paths).
 * Use before host-side rsync so uploads/plugins are writable by the host user.
 */
export async function cmdFixHostOwnershipOnly(
  loaded: LoadedConfig,
  options: FixPermissionsOptions = {},
): Promise<void> {
  assertDockerReady();
  const { uid, gid } = resolveHostIdentity(loaded.configDir);
  if (uid <= 0 || gid <= 0) {
    throw new Error(
      "fix-permissions needs a real host uid/gid (set WPDEV_HOST_UID/GID or run from the host).",
    );
  }
  logInfo(
    `fix-permissions: LOCAL only — chown /var/www/html (compose wordpress bind mount) to ${uid}:${gid}`,
  );
  await composeLocalWordpressChown(loaded, `${uid}:${gid}`);
  if (!options.quiet) {
    console.error(
      "Updated ownership of local wordpress/ (Docker bind mount only — not staging/production). " +
        "Run fix-runtime-permissions when Apache needs write access again.",
    );
  }
}

/** Compose-only chown of the local WordPress service bind mount — never SSH. */
async function composeLocalWordpressChown(
  loaded: LoadedConfig,
  uidGid: string,
): Promise<void> {
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
    uidGid,
    "/var/www/html",
  ]);
}

/**
 * Host-own the tree, then shared host:www-data + www-data runtime paths.
 * Do **not** call this immediately before host rsync — use `cmdFixHostOwnershipOnly` first.
 */
export async function cmdFixPermissions(
  loaded: LoadedConfig,
  options: FixPermissionsOptions = {},
): Promise<void> {
  await cmdFixHostOwnershipOnly(loaded, { quiet: true });
  await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
  if (!options.quiet) {
    console.error(
      "Updated WordPress permissions for FS_METHOD=direct: " +
        `tree is host:www-data (core updates + IDE); runtime (${runtimeWritePathsLabel()}) is www-data.`,
    );
  }
}

/**
 * Apply WordPress-standard bind-mount permissions for Apache (www-data):
 * 1) Entire tree host:www-data group-writable (core / theme updates without FTP)
 * 2) Runtime paths www-data:www-data (uploads, plugins, ai1wm-backups, …)
 */
export async function cmdFixRuntimeWritePermissions(
  loaded: LoadedConfig,
  options: FixRuntimeWritePermissionsOptions = {},
): Promise<void> {
  assertDockerReady();
  const { uid } = resolveHostIdentity(loaded.configDir);
  if (uid <= 0) {
    throw new Error(
      "fix-runtime-permissions needs a real host uid (set WPDEV_HOST_UID or run from the host).",
    );
  }
  logInfo(
    "fix-runtime-write-permissions: LOCAL only — host:www-data on tree, then www-data on runtime paths",
  );
  // Shared tree FIRST (incl. wp-admin), then runtime override — required for core updates.
  const shell = [
    buildHostSharedWritePermissionsShell(uid),
    buildRuntimeWritePermissionsShell(),
  ].join(" && ");
  await composeLocalWordpressShell(loaded, shell);
  if (!options.quiet) {
    console.error(
      "Updated local WordPress write access (Docker only — not staging/production): " +
        `entire tree host:www-data; runtime (${runtimeWritePathsLabel()}) www-data. ` +
        "Core/theme/plugin updates should work without FTP.",
    );
  }
}

/** Compose-only shell as root in local wordpress — never SSH. */
async function composeLocalWordpressShell(
  loaded: LoadedConfig,
  shell: string,
): Promise<void> {
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
      shell,
    ],
    { stdio: "pipe" },
  );
}
