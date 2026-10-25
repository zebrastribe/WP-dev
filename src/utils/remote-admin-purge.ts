import { posixShellQuote } from "./shell-quote.js";

/** Marker string present in docs/admin/public/api.php (wp-dev admin UI only). */
export const WPDEV_ADMIN_API_MARKER = "wp-dev admin";

export function remoteWpDevAdminDir(remoteWpPath: string): string {
  return `${remoteWpPath.replace(/\/$/, "")}/admin`;
}

/** Probe: only true when remote admin/api.php is the wp-dev admin API. */
export function buildRemoteWpDevAdminProbeCommand(adminDir: string): string {
  const d = posixShellQuote(adminDir.replace(/\/$/, ""));
  const marker = posixShellQuote(WPDEV_ADMIN_API_MARKER);
  return `if [ -f ${d}/api.php ] && grep -Fq ${marker} ${d}/api.php; then echo WPDEV_ADMIN_UI; fi`;
}

export function remoteLooksLikeWpDevAdmin(probeStdout: string): boolean {
  return /\bWPDEV_ADMIN_UI\b/.test(probeStdout);
}
