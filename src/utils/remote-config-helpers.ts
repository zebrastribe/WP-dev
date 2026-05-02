import { homedir } from "node:os";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

/** Expand `~` / `~/…` for SSH identity paths. */
export function expandUserPath(input: string): string {
  const p = input.trim();
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

/** Add `http://` or `https://` when the user omitted a scheme. */
export function normalizeSiteUrl(
  input: string,
  defaultScheme: "http" | "https",
): string {
  const t = input.trim();
  if (!t) return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  return `${defaultScheme}://${t}`;
}

/** Parse SSH port; empty string → undefined (use SSH default 22). */
export function parseOptionalPort(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return n;
}

/** True if path exists and is a regular file (never accept directories as keys). */
export function isPrivateKeyFilePath(absPath: string): boolean {
  try {
    if (!existsSync(absPath)) return false;
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}
