/**
 * Shared confirm gates for host-runner + terminal-runner pull/push/restore.
 * Kept pure so vitest can lock the contract without spinning HTTP servers.
 */

export function safeArg(v) {
  return typeof v === "string" && /^[a-zA-Z0-9._:@~/-]+$/.test(v) ? v : "";
}

/**
 * `npm run wp-dev -- {pull|push} <env> --yes…` or null when confirm is refused.
 * Staging requires --confirm-host <host>; production requires confirm === SYNC_PRODUCTION.
 */
export function wpdevPullPushCommand(kind, env, confirm) {
  if (kind !== "pull" && kind !== "push") return null;
  const e = safeArg(env);
  const c = safeArg(confirm);
  if (!["staging", "production"].includes(e)) return null;
  if (e === "production" && c !== "SYNC_PRODUCTION") return null;
  if (e === "staging" && !c) return null;
  const hostFlag = e === "staging" ? ` --confirm-host ${c}` : "";
  return `npm run wp-dev -- ${kind} ${e} --yes${hostFlag}`;
}

/**
 * Restore confirm gate used by terminal-runner restore_env.
 * Production requires RESTORE_PRODUCTION; staging requires a host token; local always ok.
 */
export function restoreEnvConfirmOk(env, confirm) {
  const e = safeArg(env);
  const c = safeArg(confirm);
  if (!["local", "staging", "production"].includes(e)) return false;
  if (e === "production" && c !== "RESTORE_PRODUCTION") return false;
  if (e === "staging" && !c) return false;
  return true;
}
