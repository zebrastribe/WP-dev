import { posixShellQuote } from "./shell-quote.js";

export type RestoreArchiveKind = "content" | "complete";

/**
 * Remote file sync for archive restore — runs BEFORE db import so a failed
 * rsync leaves the live database untouched (F-018).
 */
export function buildRemoteArchiveRsyncShell(
  kind: RestoreArchiveKind,
  remoteWork: string,
  wpPathQuoted: string,
): string {
  if (kind === "content") {
    return [
      "set -e",
      `mkdir -p ${wpPathQuoted}/wp-content`,
      `rsync -a --delete ${remoteWork}/extract/wp-content/ ${wpPathQuoted}/wp-content/`,
    ].join("; ");
  }
  return [
    "set -e",
    `rsync -a --delete --exclude=wp-config.php --exclude='wp-config-*.php' ${remoteWork}/extract/site/ ${wpPathQuoted}/`,
  ].join("; ");
}

/** Keep pre-restore dump on remote until restore fully succeeds. */
export function remotePreRestoreDumpPath(remoteWork: string): string {
  return `${remoteWork.replace(/\/$/, "")}/pre.sql`;
}

export function remoteExtractDbPath(remoteWork: string): string {
  return `${remoteWork.replace(/\/$/, "")}/extract/db.sql`;
}

export function buildRemoteMkdirWork(remoteWork: string): string {
  return `mkdir -p ${posixShellQuote(remoteWork)}`;
}
