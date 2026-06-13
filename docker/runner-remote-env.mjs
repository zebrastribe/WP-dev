/**
 * Safe remote env reader for terminal-runner shell commands (no eval).
 * Validates SSH-related fields against a strict allowlist before quoting.
 */
import { readFileSync } from "node:fs";

const SAFE = /^[a-zA-Z0-9._:@~/-]+$/;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function readRemoteEnv(envName) {
  if (!["staging", "production"].includes(envName)) {
    throw new Error("invalid_env");
  }
  const raw = readFileSync("/workspace/wp-dev.config.json", "utf8");
  const config = JSON.parse(raw);
  const remote = config[envName];
  if (!remote || typeof remote !== "object") {
    throw new Error("missing_remote");
  }
  const host = String(remote.host ?? "").trim();
  const user = String(remote.user ?? "").trim();
  const path = String(remote.path ?? "").trim();
  if (!host || !user || !path || !SAFE.test(host) || !SAFE.test(user) || !SAFE.test(path)) {
    throw new Error("invalid_remote_fields");
  }
  const port = remote.port != null ? String(remote.port).trim() : "";
  const key = remote.identityFile != null ? String(remote.identityFile).trim() : "";
  if (port && !/^\d+$/.test(port)) throw new Error("invalid_port");
  if (key && !SAFE.test(key)) throw new Error("invalid_identity_file");
  const project = String(config.project ?? "site").replace(/[^a-zA-Z0-9_-]/g, "-");
  return { project, host, user, path, port, key };
}

export function sshOptsShell(remote) {
  const parts = [
    "-o BatchMode=yes",
    "-o ConnectTimeout=15",
    "-o StrictHostKeyChecking=accept-new",
  ];
  if (remote.port) parts.push(`-o Port=${remote.port}`);
  if (remote.key) parts.push(`-i ${shellQuote(remote.key)}`);
  return parts.join(" ");
}

if (process.argv[1]?.endsWith("runner-remote-env.mjs")) {
  const env = process.argv[2];
  try {
    const remote = readRemoteEnv(env);
    process.stdout.write(
      [
        `PROJECT=${shellQuote(remote.project)}`,
        `HOST=${shellQuote(remote.host)}`,
        `USER=${shellQuote(remote.user)}`,
        `REMOTE_PATH=${shellQuote(remote.path)}`,
        `SSH_OPTS=${shellQuote(sshOptsShell(remote))}`,
      ].join("\n"),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}
