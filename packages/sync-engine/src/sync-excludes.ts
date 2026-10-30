/** Always excluded on push and pull — not user-disableable. */
export const SAFE_SYNC_EXCLUDES = [
  "wp-config.php",
  ".git",
  "/admin",
  "wp-content/cache",
  "wp-content/uploads/cache",
  ".DS_Store",
  ".htpasswd",
] as const;

/** On by default for push; user can disable via sync.disabledRecommended. */
export const RECOMMENDED_PUSH_EXCLUDES: Readonly<
  Record<string, { pattern: string; label: string }>
> = {
  "node-modules": { pattern: "**/node_modules", label: "node_modules (theme/build)" },
  "debug-log": { pattern: "wp-content/debug.log", label: "Debug log" },
  "upgrade-temp": { pattern: "wp-content/upgrade", label: "Upgrade temp folder" },
  htpasswd: { pattern: ".htpasswd", label: "HTTP auth password file (staging)" },
};

/** Common dev-only plugins — offered as toggles when installed locally. */
export const KNOWN_DEV_PLUGINS: Readonly<Record<string, { label: string }>> = {
  "query-monitor": { label: "Query Monitor" },
  "debug-bar": { label: "Debug Bar" },
  fakerpress: { label: "FakerPress" },
  "wp-crontrol": { label: "WP Crontrol" },
  "user-switching": { label: "User Switching" },
};
