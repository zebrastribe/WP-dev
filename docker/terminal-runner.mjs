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
  if (action === "backup_create") {
    const env = safeArg(args?.env);
    if (!["local", "staging", "production"].includes(env)) return null;
    return `npm run wp-dev -- backup ${env}`;
  }
  if (action === "backup_list") {
    const env = safeArg(args?.env);
    if (!["local", "staging", "production"].includes(env)) return null;
    return `mkdir -p ~/.wp-dev/backups; ls -1t ~/.wp-dev/backups/*/${env}/*.sql 2>/dev/null | head -n 30 || true`;
  }
  if (action === "restore_env") {
    const env = safeArg(args?.env);
    const file = safeArg(args?.file);
    const confirm = safeArg(args?.confirm);
    if (!["local", "staging", "production"].includes(env) || !file) return null;
    if (env === "production" && confirm !== "RESTORE_PRODUCTION") return null;
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
