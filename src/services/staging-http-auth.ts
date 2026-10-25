import { randomBytes } from "node:crypto";
import type { WpDevConfig } from "../config/schema.js";
import { getRemoteEnv } from "../config/schema.js";
import { htpasswdLine } from "../utils/import-basic-auth.js";
import { posixShellQuote } from "../utils/shell-quote.js";
import { connectSsh, type SshSession } from "./ssh.js";

export const HTTP_AUTH_BEGIN = "# BEGIN WP-DEV HTTP AUTH";
export const HTTP_AUTH_END = "# END WP-DEV HTTP AUTH";
export const HTPASSWD_BASENAME = ".htpasswd";

export type StagingHttpAuthConfig = {
  enabled: boolean;
  username: string;
  password: string;
};

export function generateStagingHttpPassword(bytes = 18): string {
  // URL-safe, no ambiguous punctuation for typing into browser prompts
  return randomBytes(bytes).toString("base64url");
}

export function defaultStagingHttpAuth(): StagingHttpAuthConfig {
  return {
    enabled: true,
    username: "staging",
    password: generateStagingHttpPassword(),
  };
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, secret.length - 4))}${secret.slice(-4)}`;
}

export function stripHttpAuthHtaccessBlock(content: string): string {
  const re = new RegExp(
    `${HTTP_AUTH_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${HTTP_AUTH_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "g",
  );
  return content.replace(re, "");
}

/** Apache 2.4-style basic auth block; AuthUserFile must be absolute. */
export function buildHttpAuthHtaccessBlock(absoluteHtpasswdPath: string): string {
  return [
    HTTP_AUTH_BEGIN,
    "AuthType Basic",
    'AuthName "Staging"',
    `AuthUserFile ${absoluteHtpasswdPath}`,
    "Require valid-user",
    `<Files "${HTPASSWD_BASENAME}">`,
    "  Require all denied",
    "</Files>",
    HTTP_AUTH_END,
    "",
  ].join("\n");
}

export function applyHttpAuthHtaccessBlock(
  existingHtaccess: string,
  absoluteHtpasswdPath: string,
): string {
  const stripped = stripHttpAuthHtaccessBlock(existingHtaccess).replace(/\s+$/, "");
  const block = buildHttpAuthHtaccessBlock(absoluteHtpasswdPath);
  return (stripped ? stripped + "\n\n" : "") + block;
}

function joinRemotePath(wpPath: string, name: string): string {
  const base = wpPath.replace(/\/+$/, "");
  return `${base}/${name}`;
}

async function remoteReadFile(ssh: SshSession, remotePath: string): Promise<string | null> {
  const q = posixShellQuote(remotePath);
  const r = await ssh.exec(
    `if [ -f ${q} ]; then cat ${q}; else echo "__WPDEV_MISSING__"; fi`,
  );
  if (r.code !== 0) return null;
  const out = r.stdout ?? "";
  if (out.trim() === "__WPDEV_MISSING__") return null;
  return out;
}

async function remoteWriteFile(ssh: SshSession, remotePath: string, content: string): Promise<void> {
  const tmp = `/tmp/wp-dev-http-auth-${Date.now()}.txt`;
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const qTmp = posixShellQuote(tmp);
  const qPath = posixShellQuote(remotePath);
  const wrote = await ssh.exec(
    `printf '%s' ${posixShellQuote(b64)} | base64 -d > ${qTmp} && mv ${qTmp} ${qPath} && chmod 640 ${qPath}`,
  );
  if (wrote.code !== 0) {
    throw new Error(`Failed to write ${remotePath}: ${wrote.stderr || wrote.stdout}`);
  }
}

async function remoteUnlink(ssh: SshSession, remotePath: string): Promise<void> {
  const q = posixShellQuote(remotePath);
  await ssh.exec(`rm -f ${q}`);
}

export type ApplyStagingHttpAuthResult = {
  enabled: boolean;
  username: string;
  htpasswdPath: string;
  htaccessPath: string;
};

/**
 * Write/remove Apache basic auth on the staging WordPress root over SSH.
 * Does not mutate local config — caller persists credentials.
 */
export async function applyStagingHttpAuthOnRemote(
  config: WpDevConfig,
  auth: StagingHttpAuthConfig,
): Promise<ApplyStagingHttpAuthResult> {
  const remote = getRemoteEnv(config, "staging");
  const wpPath = remote.path.replace(/\/+$/, "");
  const htpasswdPath = joinRemotePath(wpPath, HTPASSWD_BASENAME);
  const htaccessPath = joinRemotePath(wpPath, ".htaccess");

  const ssh = await connectSsh(remote);
  try {
    const prev = (await remoteReadFile(ssh, htaccessPath)) ?? "";

    if (!auth.enabled) {
      const stripped = stripHttpAuthHtaccessBlock(prev);
      if (stripped !== prev || prev.includes(HTTP_AUTH_BEGIN)) {
        await remoteWriteFile(ssh, htaccessPath, stripped.replace(/\s+$/, "") + "\n");
      }
      await remoteUnlink(ssh, htpasswdPath);
      return {
        enabled: false,
        username: auth.username,
        htpasswdPath,
        htaccessPath,
      };
    }

    if (!auth.username.trim() || !auth.password) {
      throw new Error("staging.httpAuth requires username and password when enabled");
    }

    const line = await htpasswdLine(auth.username.trim(), auth.password);
    await remoteWriteFile(ssh, htpasswdPath, `${line}\n`);
    const next = applyHttpAuthHtaccessBlock(prev, htpasswdPath);
    await remoteWriteFile(ssh, htaccessPath, next);

    return {
      enabled: true,
      username: auth.username.trim(),
      htpasswdPath,
      htaccessPath,
    };
  } finally {
    ssh.dispose();
  }
}
