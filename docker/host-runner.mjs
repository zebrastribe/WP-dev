import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.WPDEV_HOST_RUNNER_PORT || 7683);
const HOST = process.env.WPDEV_HOST_RUNNER_HOST || "0.0.0.0";
const AUTH = process.env.WPDEV_TERMINAL_AUTH || "";
const RUNNER_TOKEN = process.env.WPDEV_TERMINAL_RUNNER_TOKEN || "";
const ALLOWED_ORIGIN = process.env.WPDEV_TERMINAL_RUNNER_ORIGIN || "";
const WORKDIR = process.env.WPDEV_TERMINAL_WORKDIR || process.cwd();
const MAX_OUTPUT = 64_000;
const JOB_TTL_MS = 10 * 60 * 1000;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

if (!AUTH || AUTH === "wpdev:wpdev") {
  console.error("Refusing to start host runner: WPDEV_TERMINAL_AUTH is missing/insecure.");
  process.exit(1);
}
if (!RUNNER_TOKEN) {
  console.error("Refusing to start host runner: WPDEV_TERMINAL_RUNNER_TOKEN is required.");
  process.exit(1);
}
if (!ALLOWED_ORIGIN) {
  console.error("Refusing to start host runner: WPDEV_TERMINAL_RUNNER_ORIGIN is required.");
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
    "www-authenticate": 'Basic realm="wp-dev host runner"',
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
    return `npm run wp-dev -- push ${env} --yes`;
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
      job.output = `${job.output}\n[host-runner] job timeout exceeded\n`.slice(-MAX_OUTPUT);
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
  child.on("close", (code) => {
    clearTimeout(timeout);
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
    append(`\n[host-runner error] ${err?.message || String(err)}\n`);
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
  job.output = `${job.output}\n[host-runner] cancelled by user\n`.slice(-MAX_OUTPUT);
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
    json(req, res, 200, { ok: true, runner: "host" });
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

server.listen(PORT, HOST);
