import { existsSync } from "node:fs";
import type { RemoteEnvConfig } from "../config/schema.js";
import {
  assertSshHostPinned as assertPinned,
  createSshHostVerifier as createVerifier,
  knownHostSha256Fingerprints,
  knownHostsTarget,
  sha256FingerprintBase64,
} from "@wpdev/sync-engine";
import { resolveIdentityFile } from "./remote-config-helpers.js";
import { resolveSshConfigAlias } from "./ssh-helpers.js";

export {
  knownHostSha256Fingerprints,
  knownHostsTarget,
  sha256FingerprintBase64,
};

/** Build an SSH command string suitable for pinning the host key. */
export function buildSshPinCommand(remote: RemoteEnvConfig): string {
  const aliasCheck = resolveSshConfigAlias(remote.host);
  const effectiveHost = aliasCheck?.isAlias ? aliasCheck.hostname : remote.host;
  const effectivePort = remote.port ?? aliasCheck?.port;

  const parts = ["ssh"];
  if (effectivePort != null && effectivePort !== 22) {
    parts.push("-p", String(effectivePort));
  }
  const key = resolveIdentityFile(remote.identityFile);
  if (key && existsSync(key)) {
    parts.push("-i", key);
  }
  parts.push(`${remote.user}@${effectiveHost}`);
  return parts.join(" ");
}

export function assertSshHostPinned(remote: RemoteEnvConfig): void {
  assertPinned(remote, buildSshPinCommand(remote));
}

export function createSshHostVerifier(
  remote: RemoteEnvConfig,
): ((hashedKeyHex: string) => boolean) | undefined {
  return createVerifier(remote);
}
