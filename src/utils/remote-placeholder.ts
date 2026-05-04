import type { WpDevConfig } from "../config/schema.js";

/** Default init path when staging is not a real server yet (matches example config). */
export const STAGING_PLACEHOLDER_SSH_PATH = "/var/www/staging-not-used";

/** RFC 2606 `.invalid` and obvious template hosts — not real remotes for pull/push. */
export function isPlaceholderRemoteHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h.endsWith(".invalid");
}

/** True when staging still uses template host/path (pull staging / push staging not valid yet). */
export function isStagingRemotePlaceholder(config: WpDevConfig): boolean {
  return (
    isPlaceholderRemoteHost(config.staging.host) ||
    config.staging.path === STAGING_PLACEHOLDER_SSH_PATH
  );
}
