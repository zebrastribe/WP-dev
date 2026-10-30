/**
 * Shared log sanitization utilities for host-runner + terminal-runner.
 * Exported so tests can verify the real implementation.
 */

import { safeArg } from "./runner-sync-gates.mjs";

/**
 * Strip control characters (0x00-0x1F and 0x7F) to prevent log injection.
 */
export function stripControlChars(s) {
  if (typeof s !== "string") return String(s);
  return s.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Sanitize args object for safe logging.
 */
export function sanitizeArgsForLog(args) {
  if (!args || typeof args !== "object") return "{}";
  const safe = {};
  for (const [k, v] of Object.entries(args)) {
    const safeKey = stripControlChars(k);
    if (typeof v === "string") {
      safe[safeKey] = safeArg(v) || `[unsafe:${v.length}chars]`;
    } else {
      safe[safeKey] = v;
    }
  }
  return JSON.stringify(safe);
}

/**
 * Describe why an action was refused (for logging).
 */
export function describeRefusal(action, args, validEnvs = ["staging", "production"]) {
  const safeAction = safeArg(action);
  const env = safeArg(args?.env);

  if (safeAction === "backup_list" || safeAction === "backup_create" || safeAction === "validate_restore_path") {
    if (!["local", "staging", "production"].includes(env)) {
      return `invalid env for ${safeAction} (got ${env ? env.length : 0} safe chars)`;
    }
    return "invalid args";
  }
  if (!safeAction) return `invalid action (got ${typeof action === "string" ? action.length : 0} chars, none safe)`;
  return `unknown action ${safeAction}`;
}
