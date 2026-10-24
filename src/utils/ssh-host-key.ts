import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { RemoteEnvConfig } from "../config/schema.js";

function knownHostsTarget(host: string, port?: number): string {
  if (port != null && port !== 22) return `[${host}]:${port}`;
  return host;
}

/** SHA256 fingerprints (OpenSSH base64, no prefix) for host entries in known_hosts. */
export function knownHostSha256Fingerprints(host: string, port?: number): string[] {
  const target = knownHostsTarget(host, port);
  const r = spawnSync("ssh-keygen", ["-F", target, "-l", "-E", "sha256"], {
    encoding: "utf8",
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const found: string[] = [];
  for (const m of out.matchAll(/SHA256:([A-Za-z0-9+/]+=*)/g)) {
    if (m[1]) found.push(m[1]);
  }
  return found;
}

/**
 * Refuse unknown hosts unless WPDEV_SSH_INSECURE=1 (lab only).
 * OpenSSH known_hosts is the pin source; node-ssh hostVerifier must match.
 */
export function assertSshHostPinned(remote: RemoteEnvConfig): void {
  if (process.env.WPDEV_SSH_INSECURE === "1") return;
  const fps = knownHostSha256Fingerprints(remote.host, remote.port);
  if (fps.length === 0) {
    const target = knownHostsTarget(remote.host, remote.port);
    throw new Error(
      `SSH host ${target} is not pinned in ~/.ssh/known_hosts. Connect once with OpenSSH (` +
        `ssh ${remote.user}@${remote.host}) to pin the key, or set WPDEV_SSH_INSECURE=1 for lab only.`,
    );
  }
}

/** ssh2 hostVerifier when hostHash is sha256 (hex digest of raw host key). */
export function createSshHostVerifier(
  remote: RemoteEnvConfig,
): ((hashedKeyHex: string) => boolean) | undefined {
  if (process.env.WPDEV_SSH_INSECURE === "1") return () => true;
  const expected = new Set(knownHostSha256Fingerprints(remote.host, remote.port));
  if (expected.size === 0) return () => false;
  return (hashedKeyHex: string) => {
    const b64 = Buffer.from(hashedKeyHex, "hex").toString("base64").replace(/=+$/, "");
    const b64Pad = Buffer.from(hashedKeyHex, "hex").toString("base64");
    for (const fp of expected) {
      if (fp === b64Pad || fp === b64 || fp.replace(/=+$/, "") === b64) return true;
    }
    // Some ssh2 builds pass already-hex; also try hashing raw if hex decode fails
    return false;
  };
}

/** Debug helper: OpenSSH-style fingerprint of a raw host key buffer. */
export function sha256FingerprintBase64(rawKey: Buffer): string {
  return createHash("sha256").update(rawKey).digest("base64");
}
