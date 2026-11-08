import type { WpDevConfig } from "../config/schema.js";

/** Default init path when staging is not a real server yet (matches example config). */
export const STAGING_PLACEHOLDER_SSH_PATH = "/var/www/staging-not-used";

/** RFC 2606 `.invalid` and obvious template hosts — not real remotes for pull/push. */
export function isPlaceholderRemoteHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h.endsWith(".invalid");
}

/** Stop pull/push before SSH when the saved host is still the template. */
export function assertRemoteConfigured(env: "staging" | "production", host: string): void {
  if (!isPlaceholderRemoteHost(host)) return;
  const label = env === "staging" ? "Staging" : "Production";
  throw new Error(
    `${label} is not set up yet (${host}). Save a real server on Setup, then try again.`,
  );
}

/** True when staging still uses template host/path (pull staging / push staging not valid yet). */
export function isStagingRemotePlaceholder(config: WpDevConfig): boolean {
  return (
    isPlaceholderRemoteHost(config.staging.host) ||
    config.staging.path === STAGING_PLACEHOLDER_SSH_PATH
  );
}
