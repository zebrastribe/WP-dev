import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, appendFileSync, mkdirSync, existsSync, chownSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  safeArg,
  wpdevPullPushCommand,
  wpdevPushThemeCommand,
  restoreEnvConfirmOk,
} from "./runner-sync-gates.mjs";
import { stripControlChars, sanitizeArgsForLog } from "./runner-log-utils.mjs";
import { readRemoteEnv, sshOptsShell } from "./runner-remote-env.mjs";

const PORT = Number(process.env.WPDEV_TERMINAL_RUNNER_PORT || 7682);
const AUTH = process.env.WPDEV_TERMINAL_AUTH || "wpdev:wpdev";
const RUNNER_TOKEN = process.env.WPDEV_TERMINAL_RUNNER_TOKEN || "";
const ALLOWED_ORIGIN = process.env.WPDEV_TERMINAL_RUNNER_ORIGIN || "";
const WORKDIR = process.env.WPDEV_TERMINAL_WORKDIR || "/workspace";
const MAX_OUTPUT = 64_000;
const JOB_TTL_MS = 35 * 60 * 1000;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

if (AUTH === "wpdev:wpdev") {
  console.error("Refusing to start terminal runner: WPDEV_TERMINAL_AUTH is using insecure default.");
  process.exit(1);
}
if (!RUNNER_TOKEN) {
  console.error("Refusing to start terminal runner: WPDEV_TERMINAL_RUNNER_TOKEN is required.");
  process.exit(1);
}
if (!ALLOWED_ORIGIN) {
  console.error("Refusing to start terminal runner: WPDEV_TERMINAL_RUNNER_ORIGIN is required.");
  process.exit(1);
}

// Log path: logs/wp-dev.log relative to workspace. Must match src/utils/logger.ts constants.
const LOG_PATH = join(WORKDIR, "logs", "wp-dev.log");

function resolveHostOwnership() {
  const envUid = process.env.WPDEV_HOST_UID ? Number(process.env.WPDEV_HOST_UID) : null;
  const envGid = process.env.WPDEV_HOST_GID ? Number(process.env.WPDEV_HOST_GID) : null;
  if (envUid && envGid && envUid > 0 && envGid > 0) {
    return { uid: envUid, gid: envGid };
  }
  try {
    const st = statSync(WORKDIR);
    if (st.uid > 0) return { uid: st.uid, gid: st.gid > 0 ? st.gid : st.uid };
  } catch { /* ignore */ }
  return null;
}

function ensureLogDirWithOwnership() {
  const logDir = join(WORKDIR, "logs");
  const created = !existsSync(logDir);
  if (created) mkdirSync(logDir, { recursive: true });
  const hostOwner = resolveHostOwnership();
  if (hostOwner) {
    const { uid, gid } = hostOwner;
    try {
      if (created) {
        chownSync(logDir, uid, gid);
      } else {
        const dirStat = statSync(logDir);
        if (dirStat.uid === 0) chownSync(logDir, uid, gid);
      }
      if (!existsSync(LOG_PATH)) {
        appendFileSync(LOG_PATH, "");
        chownSync(LOG_PATH, uid, gid);
      } else {
        const fileStat = statSync(LOG_PATH);
        if (fileStat.uid === 0) chownSync(LOG_PATH, uid, gid);
      }
    } catch (err) {
      console.error(`[terminal-runner] chown failed: ${err.message}`);
    }
  }
}

function logRefusal(action, args, reason) {
  const timestamp = new Date().toISOString();
  const sanitizedAction = stripControlChars(safeArg(action) || `[invalid:${typeof action === "string" ? action.length : 0}chars]`);
  const sanitizedArgs = sanitizeArgsForLog(args);
  const sanitizedReason = stripControlChars(reason);
  const line = `${timestamp} [terminal-runner] action refused: ${sanitizedAction} args=${sanitizedArgs} reason=${sanitizedReason}\n`;
  console.error(line.trim());
  try {
    ensureLogDirWithOwnership();
    appendFileSync(LOG_PATH, line);
  } catch {
    // ignore log write failures
  }
}

const jobs = new Map();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.status === "running") continue;
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function json(req, res, status, body) {
  const origin = req.headers.origin || "";
  const allowOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-wp-dev-terminal-token",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function unauthorized(req, res) {
  const origin = req.headers.origin || "";
  const allowOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="wp-dev terminal runner"',
    "access-control-allow-origin": allowOrigin,
  });
  res.end("Unauthorized");
}

function parseAuth(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return null;
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function readProjectId() {
  try {
    const raw = readFileSync(join(WORKDIR, "wp-dev.config.json"), "utf8");
    const p = JSON.parse(raw).project;
    return typeof p === "string" && /^[a-zA-Z0-9._-]+$/.test(p) ? p : "";
  } catch {
    return "";
  }
}

function hasValidRunnerToken(req) {
  return (req.headers["x-wp-dev-terminal-token"] || "") === RUNNER_TOKEN;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin || "";
  return origin === ALLOWED_ORIGIN;
}

function commandForAction(action, args) {
  if (action === "generate_keypair") {
    return 'test -f ~/.ssh/id_ed25519 || ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "$USER@$(hostname)"; ls -la ~/.ssh/id_ed25519*; echo ""; echo "Public key:"; cat ~/.ssh/id_ed25519.pub';
  }
  if (action === "ssh_test") {
    const env = safeArg(args?.env);
    const user = safeArg(args?.user);
    const host = safeArg(args?.host);
    const path = safeArg(args?.path);
    if (!user || !host) return null;
    if (!path) {
      return 'echo "FAIL: WordPress path is required. Set staging.path / production.path to the folder that contains wp-config.php (not a parent of other sites)." >&2; exit 1';
    }
    let sshOpts;
    let configError = null;
    try {
      const remote = readRemoteEnv(env);
      sshOpts = sshOptsShell(remote) + " -o UpdateHostKeys=no";
    } catch (e) {
      configError = e?.message || String(e);
    }
    if (configError) {
      return `echo "FAIL: Could not read SSH config for ${env}: ${configError.replace(/"/g, '\\"')}. Save wp-dev.config.json first." >&2; exit 1`;
    }
    const sshCmd = `ssh ${sshOpts} ${user}@${host}`;
    return (
      `echo "Running: ${sshCmd} ..."; ` +
      `${sshCmd} ` +
      `'set -e; P=${path}; ` +
      `test -d "\$P" || { echo "FAIL: path does not exist: \$P"; exit 1; }; ` +
      `if [ ! -f "\$P/wp-config.php" ] && [ ! -f "\$P/wp-config-sample.php" ]; then ` +
      `echo "FAIL: \$P is not a WordPress root (no wp-config.php). Point path at this site only — not a parent with other sites/logs."; exit 1; fi; ` +
      `if [ -f "\$P/wp-dev.config.json" ] || [ -f "\$P/docker/terminal-runner.mjs" ]; then ` +
      `echo "FAIL: WP-dev tooling found inside \$P. Keep WP-dev on your workstation; path must be the site docroot only."; exit 1; fi; ` +
      `echo "Path OK: \$P (WordPress root)"; ls -la "\$P" | head -n 40; wp --path="\$P" --info'`
    );
  }
  if (action === "wpdev_doctor") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- doctor ${env} --http`;
  }
  if (action === "wpdev_pull") {
    return wpdevPullPushCommand("pull", args?.env, args?.confirm);
  }
  if (action === "wpdev_pull_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- pull ${env} --dry-run`;
  }
  if (action === "wpdev_push") {
    return wpdevPullPushCommand("push", args?.env, args?.confirm);
  }
  if (action === "wpdev_push_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- push ${env} --dry-run`;
  }
  if (action === "wpdev_push_theme") {
    return wpdevPushThemeCommand(args?.env, args?.confirm, safeArg(args?.build));
  }
  if (action === "wpdev_push_theme_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    const build = safeArg(args?.build) === "1" ? " --build" : "";
    return `npm run wp-dev -- push theme ${env} --dry-run${build}`;
  }
  if (action === "wpdev_pull_theme") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- pull theme ${env}`;
  }
  if (action === "wpdev_pull_theme_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- pull theme ${env} --dry-run`;
  }
  if (action === "wpdev_sync_preview") {
    const env = safeArg(args?.env);
    const direction = safeArg(args?.direction);
    if (!["staging", "production"].includes(env)) return null;
    if (!["push", "pull"].includes(direction)) return null;
    return `npm run wp-dev -- sync-preview ${direction} ${env} --json`;
  }
  if (action === "wpdev_sync_scan") {
    return `npm run wp-dev -- sync-scan --json`;
  }
  if (action === "wpdev_update") {
    const admin = safeArg(args?.admin);
    const restart = safeArg(args?.restart);
    const dryRun = safeArg(args?.dry_run);
    const flags = [];
    if (admin === "0") flags.push("--no-admin");
    if (restart === "0") flags.push("--no-restart");
    if (dryRun === "1") flags.push("--dry-run");
    return `npm run wp-dev -- update${flags.length ? ` ${flags.join(" ")}` : ""}`;
  }
  if (action === "wpdev_update_preflight") {
    return `npm run wp-dev -- update --preflight --json`;
  }
  if (action === "wpdev_php_show") {
    const env = safeArg(args?.env) || "local";
    if (!["local", "staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- php show --env ${env} --json`;
  }
  if (action === "wpdev_php_set") {
    const env = safeArg(args?.env) || "local";
    const version = safeArg(args?.version);
    if (!["local", "staging", "production"].includes(env)) return null;
    if (!/^\d+\.\d+$/.test(version)) return null;
    const flags = [`--env ${env}`, "--yes"];
    if (env === "local" && safeArg(args?.restart) === "1") flags.push("--restart");
    return `npm run wp-dev -- php set ${version} ${flags.join(" ")}`;
  }
  if (action === "wpdev_staging_http_auth_enable") {
    return "npm run wp-dev -- staging-http-auth enable";
  }
  if (action === "wpdev_staging_http_auth_disable") {
    return "npm run wp-dev -- staging-http-auth disable";
  }
  if (action === "wpdev_php_rollback") {
    const env = safeArg(args?.env) || "local";
    if (!["local", "staging", "production"].includes(env)) return null;
    const flags = [`--env ${env}`, "--yes"];
    if (env === "local" && safeArg(args?.restart) === "1") flags.push("--restart");
    return `npm run wp-dev -- php rollback ${flags.join(" ")}`;
  }
  if (action === "backup_create") {
    const env = safeArg(args?.env);
    const kindRaw = safeArg(args?.kind);
    const kind =
      kindRaw === "complete" ? "complete" : kindRaw === "full" || kindRaw === "content" ? "full" : "db";
    if (!["local", "staging", "production"].includes(env)) return null;
    // Always use CLI so disk-space preflight and shared backup logic apply.
    if (kind === "complete") return `npm run wp-dev -- backup ${env} --complete`;
    if (kind === "full") return `npm run wp-dev -- backup ${env} --files`;
    return `npm run wp-dev -- backup ${env}`;
  }
  if (action === "backup_list") {
    const env = safeArg(args?.env);
    const kindRaw = safeArg(args?.kind);
    const kind =
      kindRaw === "complete"
        ? "complete"
        : kindRaw === "full" || kindRaw === "content"
          ? "full"
          : kindRaw === "all"
            ? "all"
            : "db";
    const project = readProjectId();
    if (!["local", "staging", "production"].includes(env) || !project) return null;
    const base = `$HOME/.wp-dev/backups/${project}/${env}`;
    if (kind === "complete") {
      return `mkdir -p ${base}; OUT="$(ls -1t ${base}/complete-*.tar.gz 2>/dev/null | head -n 30 || true)"; if [ -z "$OUT" ]; then echo "No complete backups found for ${project}/${env}."; else printf "%s\\n" "$OUT"; fi`;
    }
    if (kind === "full") {
      return `mkdir -p ${base}; OUT="$(ls -1t ${base}/full-*.tar.gz 2>/dev/null | head -n 30 || true)"; if [ -z "$OUT" ]; then echo "No content backups found for ${project}/${env}."; else printf "%s\\n" "$OUT"; fi`;
    }
    if (kind === "all") {
      // Prefer complete + content + db/pre prefixes; avoid *.sql which double-matches those globs.
      return `mkdir -p ${base}; OUT="$(ls -1t ${base}/complete-*.tar.gz ${base}/full-*.tar.gz ${base}/db-*.sql ${base}/pre-*.sql 2>/dev/null | awk '!seen[$0]++' | head -n 40 || true)"; if [ -z "$OUT" ]; then echo "No backups found for ${project}/${env}."; else printf "%s\\n" "$OUT"; fi`;
    }
    return `mkdir -p ${base}; OUT="$(ls -1t ${base}/db-*.sql ${base}/pre-*.sql 2>/dev/null | awk '!seen[$0]++' | head -n 30 || true)"; if [ -z "$OUT" ]; then echo "No database backups found for ${project}/${env}."; else printf "%s\\n" "$OUT"; fi`;
  }
  if (action === "validate_restore_path") {
    const env = safeArg(args?.env);
    const file = safeArg(args?.file);
    const project = readProjectId();
    if (!["local", "staging", "production"].includes(env) || !file || !project) return null;
    if (file.includes("..")) return null;
    return [
      `FILE_REAL="$(realpath -e ${file} 2>/dev/null || true)"`,
      'if [ -z "$FILE_REAL" ]; then echo "INVALID: file not found"; exit 1; fi',
      `case "$FILE_REAL" in "$HOME"/.wp-dev/backups/${project}/${env}/*) echo "VALID: $FILE_REAL";; *) echo "INVALID: must be under ~/.wp-dev/backups/${project}/${env}/"; exit 1;; esac`,
    ].join("; ");
  }
  if (action === "restore_env") {
    const env = safeArg(args?.env);
    const file = safeArg(args?.file);
    const confirm = safeArg(args?.confirm);
    const project = readProjectId();
    if (!["local", "staging", "production"].includes(env) || !file || !project) return null;
    if (file.includes("..")) return null;
    if (!restoreEnvConfirmOk(env, confirm)) return null;
    const backupGuard = [
      `FILE_REAL="$(realpath -e ${file} 2>/dev/null || true)"`,
      'test -n "$FILE_REAL" || { echo "Backup file not found or unreadable."; exit 1; }',
      `case "$FILE_REAL" in "$HOME"/.wp-dev/backups/${project}/${env}/*) ;; *) echo "Restore refused: file must be under ~/.wp-dev/backups/${project}/${env}/"; exit 1;; esac`,
    ].join("; ");
    // All restores go through CLI (DB, content, and complete archives; remote needs confirm).
    if (env === "local") {
      return `${backupGuard}; npm run wp-dev -- restore local "$FILE_REAL"`;
    }
    if (env === "staging") {
      return `${backupGuard}; npm run wp-dev -- restore staging "$FILE_REAL" --yes --confirm-host ${confirm}`;
    }
    return `${backupGuard}; npm run wp-dev -- restore production "$FILE_REAL" --yes`;
  }
  if (action === "git_status") {
    return "git -c safe.directory=/workspace status --short";
  }
  if (action === "git_log") {
    return "git -c safe.directory=/workspace log -n 30 --pretty=format:'%h|%ad|%an|%s' --date=short";
  }
  if (action === "git_show") {
    const commit = safeArg(args?.commit);
    if (!commit) return null;
    return `git -c safe.directory=/workspace show --stat --patch --no-color ${commit}`;
  }
  if (action === "git_rollback_branch") {
    const commit = safeArg(args?.commit);
    if (!commit) return null;
    return `git -c safe.directory=/workspace checkout -b rollback/${Date.now()} ${commit} && git -c safe.directory=/workspace status --short`;
  }
  if (action === "git_reset_hard") {
    const commit = safeArg(args?.commit);
    const confirm = safeArg(args?.confirm);
    if (!commit || confirm !== "HARD_RESET_CONFIRM") return null;
    return `git -c safe.directory=/workspace reset --hard ${commit} && git -c safe.directory=/workspace status --short`;
  }
  return null;
}

function describeRefusal(action, args) {
  const safeAction = safeArg(action);
  const env = safeArg(args?.env);
  const confirm = safeArg(args?.confirm);

  if (safeAction === "wpdev_pull" || safeAction === "wpdev_push") {
    const kind = safeAction === "wpdev_pull" ? "pull" : "push";
    if (!wpdevPullPushCommand(kind, env, confirm)) {
      if (!["staging", "production"].includes(env)) return `invalid env (got ${env ? env.length : 0} safe chars)`;
      if (env === "production" && confirm !== "SYNC_PRODUCTION") return "production sync requires SYNC_PRODUCTION confirm token";
      if (env === "staging" && !confirm) return "staging sync requires --confirm-host";
    }
    return "invalid args";
  }
  if (safeAction === "wpdev_push_theme") {
    if (!wpdevPushThemeCommand(env, confirm, safeArg(args?.build))) {
      if (!["staging", "production"].includes(env)) return `invalid env (got ${env ? env.length : 0} safe chars)`;
      if (env === "production" && confirm !== "SYNC_PRODUCTION") return "production theme push requires SYNC_PRODUCTION confirm token";
      if (env === "staging" && !confirm) return "staging theme push requires --confirm-host";
    }
    return "invalid args";
  }
  if (safeAction === "restore_env") {
    const file = safeArg(args?.file);
    if (!restoreEnvConfirmOk(env, confirm)) {
      if (!["local", "staging", "production"].includes(env)) return `invalid env (got ${env ? env.length : 0} safe chars)`;
      if (env === "production" && confirm !== "RESTORE_PRODUCTION") return "production restore requires RESTORE_PRODUCTION confirm token";
      if (env === "staging" && !confirm) return "staging restore requires confirm host token";
    }
    if (!file) return "missing backup file";
    if (file.includes("..")) return "backup path contains ..";
    return "invalid args";
  }
  if (safeAction === "backup_list" || safeAction === "backup_create" || safeAction === "validate_restore_path") {
    if (!["local", "staging", "production"].includes(env)) return `invalid env for ${safeAction} (got ${env ? env.length : 0} safe chars)`;
    return "invalid args";
  }
  if (!safeAction) return `invalid action (got ${typeof action === "string" ? action.length : 0} chars, none safe)`;
  return `unknown action ${safeAction}`;
}

function startJob(command) {
  const id = randomUUID();
  const job = {
    id,
    status: "running",
    command,
    output: "",
    exitCode: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    child: null,
    timeout: null,
  };
  jobs.set(id, job);
  const child = spawn("bash", ["-lc", command], {
    cwd: WORKDIR,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WPDEV_ASSUME_YES: "1" },
  });
  job.child = child;
  const timeout = setTimeout(() => {
    if (job.status === "running") {
      killJobTree(job);
      job.output = `${job.output}\n[runner] job timeout exceeded\n`.slice(-MAX_OUTPUT);
      job.status = "done";
      job.exitCode = 124;
      job.updatedAt = Date.now();
    }
  }, JOB_TIMEOUT_MS);
  job.timeout = timeout;
  const append = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    job.output = (job.output + text).slice(-MAX_OUTPUT);
    job.updatedAt = Date.now();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const heartbeat = setInterval(() => {
    if (job.status === "running") job.updatedAt = Date.now();
  }, 30_000);
  child.on("close", (code) => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    if (job.status === "running") {
      job.status = "done";
      job.exitCode = typeof code === "number" ? code : 1;
      job.updatedAt = Date.now();
    }
    job.child = null;
    job.timeout = null;
  });
  child.on("error", (err) => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    append(`\n[runner error] ${err?.message || String(err)}\n`);
    if (job.status === "running") {
      job.status = "done";
      job.exitCode = 1;
      job.updatedAt = Date.now();
    }
    job.child = null;
    job.timeout = null;
  });
  return id;
}

function killJobTree(job) {
  const child = job.child;
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    if (job.status !== "running" || !job.child?.pid) return;
    try {
      process.kill(-job.child.pid, "SIGKILL");
    } catch {
      try {
        job.child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 3000);
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  if (job.timeout) clearTimeout(job.timeout);
  killJobTree(job);
  job.output = `${job.output}\n[runner] cancelled by user\n`.slice(-MAX_OUTPUT);
  job.status = "done";
  job.exitCode = 130;
  job.updatedAt = Date.now();
  job.child = null;
  job.timeout = null;
  return true;
}

function jobPublic(job) {
  return {
    id: job.id,
    status: job.status,
    command: job.command,
    output: job.output,
    exitCode: job.exitCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(req)) {
      json(req, res, 403, { ok: false, error: "forbidden_origin" });
      return;
    }
    json(req, res, 200, { ok: true });
    return;
  }
  if (!isAllowedOrigin(req)) {
    json(req, res, 403, { ok: false, error: "forbidden_origin" });
    return;
  }
  if (!hasValidRunnerToken(req)) {
    json(req, res, 403, { ok: false, error: "forbidden_token" });
    return;
  }
  if (parseAuth(req) !== AUTH) {
    unauthorized(req, res);
    return;
  }
  pruneJobs();

  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    json(req, res, 200, { ok: true, runner: "terminal" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/active-job") {
    const running = Array.from(jobs.values()).find((j) => j.status === "running");
    if (!running) {
      json(req, res, 200, { ok: true, activeJob: null });
      return;
    }
    json(req, res, 200, { ok: true, activeJob: jobPublic(running) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", (d) => {
      body += String(d);
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch {
        json(req, res, 400, { ok: false, error: "invalid_json" });
        return;
      }
      const action = typeof data.action === "string" ? data.action : "";
      const command = commandForAction(action, data.args || {});
      if (!command) {
        const reason = describeRefusal(action, data.args || {});
        logRefusal(action, data.args || {}, reason);
        json(req, res, 400, { ok: false, error: "invalid_action_or_args", reason });
        return;
      }
      const jobId = startJob(command);
      json(req, res, 200, { ok: true, jobId, command });
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const id = url.pathname.replace("/status/", "");
    const job = jobs.get(id);
    if (!job) {
      json(req, res, 404, { ok: false, error: "job_not_found" });
      return;
    }
    json(req, res, 200, { ok: true, ...jobPublic(job) });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/cancel/")) {
    const id = url.pathname.replace("/cancel/", "");
    if (!cancelJob(id)) {
      json(req, res, 404, { ok: false, error: "job_not_found_or_not_running" });
      return;
    }
    const job = jobs.get(id);
    json(req, res, 200, { ok: true, ...(job ? jobPublic(job) : {}) });
    return;
  }

  json(req, res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "0.0.0.0");
