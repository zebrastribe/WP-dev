import { existsSync } from "node:fs";
import { platform, release, userInfo } from "node:os";

export type PlatformKind = "darwin" | "linux" | "win32" | "other";

export type PlatformInfo = {
  kind: PlatformKind;
  isWsl: boolean;
  isMacOs: boolean;
  isLinux: boolean;
  release: string;
  hostUid: number;
  hostGid: number;
};

export function detectPlatform(): PlatformInfo {
  const kind = platform() as PlatformKind;
  const { uid, gid } = userInfo();
  const rel = release();
  const isWsl =
    kind === "linux" &&
    (rel.toLowerCase().includes("microsoft") || existsWslInterop());
  return {
    kind,
    isWsl,
    isMacOs: kind === "darwin",
    isLinux: kind === "linux",
    release: rel,
    hostUid: uid,
    hostGid: gid,
  };
}

function existsWslInterop(): boolean {
  try {
    return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
  } catch {
    return false;
  }
}

export function assertUnixOwnershipSupport(info: PlatformInfo): void {
  if (info.hostUid < 0 || info.hostGid < 0) {
    throw new Error(
      "Host uid/gid are not available on this OS. Use WSL2 (Linux filesystem) or macOS/Linux for wp-dev.",
    );
  }
}
