import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.WPDEV_TERMINAL_RUNNER_PORT || 7682);
const AUTH = process.env.WPDEV_TERMINAL_AUTH || "wpdev:wpdev";
const RUNNER_TOKEN = process.env.WPDEV_TERMINAL_RUNNER_TOKEN || "";
const ALLOWED_ORIGIN = process.env.WPDEV_TERMINAL_RUNNER_ORIGIN || "";
const WORKDIR = process.env.WPDEV_TERMINAL_WORKDIR || "/workspace";
const MAX_OUTPUT = 64_000;
const JOB_TTL_MS = 10 * 60 * 1000;
const JOB_TIMEOUT_MS = 8 * 60 * 1000;

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

const jobs = new Map();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
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

function safeArg(v) {
  return typeof v === "string" && /^[a-zA-Z0-9._:@~/-]+$/.test(v) ? v : "";
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
    const user = safeArg(args?.user);
    const host = safeArg(args?.host);
    if (!user || !host) return null;
    return `ssh -o BatchMode=yes -o ConnectTimeout=10 -o UpdateHostKeys=no ${user}@${host} "pwd && ls -la && wp --info"`;
  }
  if (action === "wpdev_doctor") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- doctor ${env} --http`;
  }
  if (action === "wpdev_pull") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- pull ${env}`;
  }
  if (action === "wpdev_pull_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- pull ${env} --dry-run`;
  }
  if (action === "wpdev_push") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- push ${env}`;
  }
  if (action === "wpdev_push_dry") {
    const env = safeArg(args?.env);
    if (!["staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- push ${env} --dry-run`;
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
  if (action === "backup_create") {
    const env = safeArg(args?.env);
    const kindRaw = safeArg(args?.kind);
    const kind = kindRaw === "full" ? "full" : "db";
    if (!["local", "staging", "production"].includes(env)) return null;
    if (env === "local") {
      if (kind === "full") {
        return [
          'PROJECT="$(node -e \'try{const c=require("/workspace/wp-dev.config.json");process.stdout.write(String(c.project||"site").replace(/[^a-zA-Z0-9_-]/g,"-"))}catch{process.stdout.write("site")}\')"',
          'STAMP="$(date +%F-%H-%M-%S)"',
          'OUT="$HOME/.wp-dev/backups/$PROJECT/local/full-$STAMP.tar.gz"',
          'TMPDIR="$(mktemp -d)"',
          'DBTMP="$TMPDIR/db.sql"',
          'mkdir -p "$(dirname "$OUT")"',
          'test -n "$MYSQL_DATABASE" || { echo "Missing MYSQL_DATABASE in terminal environment."; rm -rf "$TMPDIR"; exit 1; }',
          'test -n "$MYSQL_USER" || { echo "Missing MYSQL_USER in terminal environment."; rm -rf "$TMPDIR"; exit 1; }',
          'test -n "$MYSQL_PASSWORD" || { echo "Missing MYSQL_PASSWORD in terminal environment."; rm -rf "$TMPDIR"; exit 1; }',
          'test -d "/workspace/wordpress/wp-content" || { echo "Missing /workspace/wordpress/wp-content directory."; rm -rf "$TMPDIR"; exit 1; }',
          'mysqldump --no-tablespaces -h db -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" > "$DBTMP" || { rm -rf "$TMPDIR"; exit 1; }',
          'tar -czf "$OUT" -C /workspace/wordpress wp-content -C "$TMPDIR" db.sql || { rm -f "$OUT"; rm -rf "$TMPDIR"; exit 1; }',
          'rm -rf "$TMPDIR"',
          'echo "Local full backup written to $OUT"',
        ].join("; ");
      }
      return [
        'PROJECT="$(node -e \'try{const c=require("/workspace/wp-dev.config.json");process.stdout.write(String(c.project||"site").replace(/[^a-zA-Z0-9_-]/g,"-"))}catch{process.stdout.write("site")}\')"',
        'STAMP="$(date +%F-%H-%M-%S)"',
        'OUT="$HOME/.wp-dev/backups/$PROJECT/local/db-$STAMP.sql"',
        'TMP="$OUT.tmp"',
        'mkdir -p "$(dirname "$OUT")"',
        'test -n "$MYSQL_DATABASE" || { echo "Missing MYSQL_DATABASE in terminal environment."; exit 1; }',
        'test -n "$MYSQL_USER" || { echo "Missing MYSQL_USER in terminal environment."; exit 1; }',
        'test -n "$MYSQL_PASSWORD" || { echo "Missing MYSQL_PASSWORD in terminal environment."; exit 1; }',
        'mysqldump --no-tablespaces -h db -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" > "$TMP" || { rm -f "$TMP"; exit 1; }',
        'mv "$TMP" "$OUT"',
        'echo "Local database backup written to $OUT"',
      ].join("; ");
    }
    if (kind === "full") {
      return [
        "set -e",
        `eval "$(node /workspace/docker/runner-remote-env.mjs ${env})"`,
        `test -n "$HOST" && test -n "$USER" && test -n "$REMOTE_PATH" || { echo "Missing ${env} SSH settings in wp-dev.config.json"; exit 1; }`,
        'STAMP="$(date +%F-%H-%M-%S)"',
        `OUT="$HOME/.wp-dev/backups/$PROJECT/${env}/full-$STAMP.tar.gz"`,
        'mkdir -p "$(dirname "$OUT")"',
        `REMOTE_DIR="/tmp/wp-dev-full-${env}-$STAMP"`,
        `ssh $SSH_OPTS "$USER@$HOST" "set -e; mkdir -p \\"$REMOTE_DIR\\"; cd \\"$REMOTE_PATH\\"; wp db export \\"$REMOTE_DIR/db.sql\\" --allow-root >/dev/null; tar -czf \\"$REMOTE_DIR/full.tar.gz\\" -C \\"$REMOTE_PATH\\" wp-content -C \\"$REMOTE_DIR\\" db.sql"`,
        `scp $SSH_OPTS "$USER@$HOST:$REMOTE_DIR/full.tar.gz" "$OUT"`,
        `ssh $SSH_OPTS "$USER@$HOST" "rm -rf \\"$REMOTE_DIR\\""`,
        `echo "${env} full backup written to $OUT"`,
      ].join("; ");
    }
    return `npm run wp-dev -- backup ${env}`;
  }
  if (action === "backup_list") {
    const env = safeArg(args?.env);
    const kindRaw = safeArg(args?.kind);
    const kind = kindRaw === "full" ? "full" : "db";
    if (!["local", "staging", "production"].includes(env)) return null;
    if (kind === "full") {
      return `mkdir -p ~/.wp-dev/backups; OUT="$(ls -1t ~/.wp-dev/backups/*/${env}/full-*.tar.gz 2>/dev/null | head -n 30 || true)"; if [ -z "$OUT" ]; then echo "No full backups found for ${env}."; else printf "%s\\n" "$OUT"; fi`;
    }
    return `mkdir -p ~/.wp-dev/backups; OUT="$(ls -1t ~/.wp-dev/backups/*/${env}/db-*.sql ~/.wp-dev/backups/*/${env}/*.sql 2>/dev/null | head -n 30 || true)"; if [ -z "$OUT" ]; then echo "No database backups found for ${env}."; else printf "%s\\n" "$OUT"; fi`;
  }
  if (action === "restore_env") {
    const env = safeArg(args?.env);
    const file = safeArg(args?.file);
    const confirm = safeArg(args?.confirm);
    if (!["local", "staging", "production"].includes(env) || !file) return null;
    if (env === "production" && confirm !== "RESTORE_PRODUCTION") return null;
    if (env === "local") {
      return [
        `test -f ${file} || { echo "Backup file not found: ${file}"; exit 1; }`,
        'test -n "$MYSQL_DATABASE" || { echo "Missing MYSQL_DATABASE in terminal environment."; exit 1; }',
        'test -n "$MYSQL_USER" || { echo "Missing MYSQL_USER in terminal environment."; exit 1; }',
        'test -n "$MYSQL_PASSWORD" || { echo "Missing MYSQL_PASSWORD in terminal environment."; exit 1; }',
        `case ${file} in *.tar.gz) TMPDIR="$(mktemp -d)"; tar -xzf ${file} -C "$TMPDIR" || { rm -rf "$TMPDIR"; exit 1; }; test -f "$TMPDIR/db.sql" || { echo "Invalid full backup archive: missing db.sql"; rm -rf "$TMPDIR"; exit 1; }; test -d "$TMPDIR/wp-content" || { echo "Invalid full backup archive: missing wp-content"; rm -rf "$TMPDIR"; exit 1; }; mysql -h db -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < "$TMPDIR/db.sql" || { rm -rf "$TMPDIR"; exit 1; }; mkdir -p /workspace/wordpress/wp-content; rsync -a --delete "$TMPDIR/wp-content/" /workspace/wordpress/wp-content/ || { rm -rf "$TMPDIR"; exit 1; }; rm -rf "$TMPDIR"; echo "Local full restore completed (database + wp-content).";; *) mysql -h db -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < ${file} && echo "Local database restore completed.";; esac`,
      ].join("; ");
    }
    if (safeArg(file).endsWith(".tar.gz")) {
      return [
        "set -e",
        `eval "$(node /workspace/docker/runner-remote-env.mjs ${env})"`,
        `test -n "$HOST" && test -n "$USER" && test -n "$REMOTE_PATH" || { echo "Missing ${env} SSH settings in wp-dev.config.json"; exit 1; }`,
        `test -f ${file} || { echo "Backup file not found: ${file}"; exit 1; }`,
        `STAMP="$(date +%s)"`,
        `REMOTE_DIR="/tmp/wp-dev-restore-full-${env}-$STAMP"`,
        `ssh $SSH_OPTS "$USER@$HOST" "mkdir -p \\"$REMOTE_DIR\\""`,
        `scp $SSH_OPTS ${file} "$USER@$HOST:$REMOTE_DIR/full.tar.gz"`,
        `ssh $SSH_OPTS "$USER@$HOST" "set -e; tar -xzf \\"$REMOTE_DIR/full.tar.gz\\" -C \\"$REMOTE_DIR\\"; test -f \\"$REMOTE_DIR/db.sql\\"; test -d \\"$REMOTE_DIR/wp-content\\"; cd \\"$REMOTE_PATH\\"; wp db import \\"$REMOTE_DIR/db.sql\\" --allow-root >/dev/null; mkdir -p \\"$REMOTE_PATH/wp-content\\"; rsync -a --delete \\"$REMOTE_DIR/wp-content/\\" \\"$REMOTE_PATH/wp-content/\\""`,
        `ssh $SSH_OPTS "$USER@$HOST" "rm -rf \\"$REMOTE_DIR\\""`,
        `echo "${env} full restore completed (database + wp-content)."`,
      ].join("; ");
    }
    const yesFlag = env === "production" ? " --yes" : "";
    return `test -f ${file} || { echo "Backup file not found: ${file}"; exit 1; }; npm run wp-dev -- restore ${env} ${file}${yesFlag}`;
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
  };
  jobs.set(id, job);
  const child = spawn("bash", ["-lc", command], { cwd: WORKDIR });
  const timeout = setTimeout(() => {
    if (job.status === "running") {
      child.kill("SIGKILL");
      job.output = `${job.output}\n[runner] job timeout exceeded\n`.slice(-MAX_OUTPUT);
      job.status = "done";
      job.exitCode = 124;
      job.updatedAt = Date.now();
    }
  }, JOB_TIMEOUT_MS);
  const append = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    job.output = (job.output + text).slice(-MAX_OUTPUT);
    job.updatedAt = Date.now();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => {
    clearTimeout(timeout);
    job.status = "done";
    job.exitCode = typeof code === "number" ? code : 1;
    job.updatedAt = Date.now();
  });
  child.on("error", (err) => {
    clearTimeout(timeout);
    append(`\n[runner error] ${err?.message || String(err)}\n`);
    job.status = "done";
    job.exitCode = 1;
    job.updatedAt = Date.now();
  });
  return id;
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
        json(req, res, 400, { ok: false, error: "invalid_action_or_args" });
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
    json(req, res, 200, { ok: true, ...job });
    return;
  }

  json(req, res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "0.0.0.0");
