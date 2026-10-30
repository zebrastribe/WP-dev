import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Minimal host identity for pin / verify (no CLI config types). */
export type SshHostRef = {
  host: string;
  port?: number;
};

export function knownHostsTarget(host: string, port?: number): string {
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
export function assertSshHostPinned(remote: SshHostRef, pinCommandHint?: string): void {
  if (process.env.WPDEV_SSH_INSECURE === "1") return;
  const fps = knownHostSha256Fingerprints(remote.host, remote.port);
  if (fps.length === 0) {
    const target = knownHostsTarget(remote.host, remote.port);
    const hint =
      pinCommandHint ??
      `ssh${remote.port != null && remote.port !== 22 ? ` -p ${remote.port}` : ""} ${remote.host}`;
    throw new Error(
      `SSH host ${target} is not pinned in ~/.ssh/known_hosts.\n` +
        `Connect once with OpenSSH to verify the fingerprint and pin the key:\n  ${hint}\n` +
        `Or set WPDEV_SSH_INSECURE=1 for lab environments only.`,
    );
  }
}

/** ssh2 hostVerifier when hostHash is sha256 (hex digest of raw host key). */
export function createSshHostVerifier(
  remote: SshHostRef,
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
    return false;
  };
}

/** Debug helper: OpenSSH-style fingerprint of a raw host key buffer. */
export function sha256FingerprintBase64(rawKey: Buffer): string {
  return createHash("sha256").update(rawKey).digest("base64");
}
