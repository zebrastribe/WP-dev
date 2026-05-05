import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.WPDEV_TERMINAL_RUNNER_PORT || 7682);
const AUTH = process.env.WPDEV_TERMINAL_AUTH || "wpdev:wpdev";
const WORKDIR = process.env.WPDEV_TERMINAL_WORKDIR || "/workspace";
const MAX_OUTPUT = 64_000;
const JOB_TTL_MS = 10 * 60 * 1000;

const jobs = new Map();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function unauthorized(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="wp-dev terminal runner"',
    "access-control-allow-origin": "*",
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
  return typeof v === "string" && /^[a-zA-Z0-9._:@/-]+$/.test(v) ? v : "";
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
  if (action === "pull_production") return "npm run wp-dev -- pull production";
  if (action === "pull_staging") return "npm run wp-dev -- pull staging";
  if (action === "push_staging") return "npm run wp-dev -- push staging";
  if (action === "push_production") return "npm run wp-dev -- push production";
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
  const append = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    job.output = (job.output + text).slice(-MAX_OUTPUT);
    job.updatedAt = Date.now();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => {
    job.status = "done";
    job.exitCode = typeof code === "number" ? code : 1;
    job.updatedAt = Date.now();
  });
  child.on("error", (err) => {
    append(`\n[runner error] ${err?.message || String(err)}\n`);
    job.status = "done";
    job.exitCode = 1;
    job.updatedAt = Date.now();
  });
  return id;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 200, { ok: true });
    return;
  }
  if (parseAuth(req) !== AUTH) {
    unauthorized(res);
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
        json(res, 400, { ok: false, error: "invalid_json" });
        return;
      }
      const action = typeof data.action === "string" ? data.action : "";
      const command = commandForAction(action, data.args || {});
      if (!command) {
        json(res, 400, { ok: false, error: "invalid_action_or_args" });
        return;
      }
      const jobId = startJob(command);
      json(res, 200, { ok: true, jobId, command });
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const id = url.pathname.replace("/status/", "");
    const job = jobs.get(id);
    if (!job) {
      json(res, 404, { ok: false, error: "job_not_found" });
      return;
    }
    json(res, 200, { ok: true, ...job });
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "0.0.0.0");
