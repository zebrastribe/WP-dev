/**
 * Shared confirm gates for host-runner + terminal-runner pull/push/restore.
 * Kept pure so vitest can lock the contract without spinning HTTP servers.
 */

export function safeArg(v) {
  return typeof v === "string" && /^[a-zA-Z0-9._:@~/-]+$/.test(v) ? v : "";
}

/** A repository address, including an IP or LAN name. Quoted by the caller before it reaches the shell. */
export function safeRepoUrl(v) {
  if (typeof v !== "string" || v.includes("..")) return "";
  return /^https?:\/\/[A-Za-z0-9._:@~\/[\]-]+$/.test(v) ? v : "";
}

/** Child environment for a private repository. Never place this value in the command string. */
export function gitTokenEnv(token) {
  if (typeof token !== "string") return {};
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 500 || /[\r\n\0]/.test(trimmed)) return {};
  return { WPDEV_GIT_TOKEN: trimmed };
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
/** Basename of a backup the admin may upload. .sql or .tar.gz only. */
export function safeBackupImportName(name) {
  if (typeof name !== "string") return "";
  const base = name.split(/[/\\]/).pop() ?? "";
  if (base !== name) return "";
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(base)) return "";
  if (base.startsWith(".")) return "";
  if (base.endsWith(".sql") || base.endsWith(".tar.gz")) return base;
  return "";
}

export function restoreEnvConfirmOk(env, confirm) {
  const e = safeArg(env);
  const c = safeArg(confirm);
  if (!["local", "staging", "production"].includes(e)) return false;
  if (e === "production" && c !== "RESTORE_PRODUCTION") return false;
  if (e === "staging" && !c) return false;
  return true;
}

/**
 * Theme push: production requires confirm === SYNC_PRODUCTION (same bar as full push).
 * Staging needs a non-empty confirm token (host). Returns CLI command or null.
 */
export function wpdevPushThemeCommand(env, confirm, buildFlag) {
  const e = safeArg(env);
  const c = safeArg(confirm);
  if (!["staging", "production"].includes(e)) return null;
  if (e === "production" && c !== "SYNC_PRODUCTION") return null;
  if (e === "staging" && !c) return null;
  const build = buildFlag === "1" || buildFlag === true ? " --build" : "";
  return `npm run wp-dev -- push theme ${e} --yes${build}`;
}
