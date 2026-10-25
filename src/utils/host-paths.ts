import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";

/**
 * When Compose runs inside the terminal container (docker.sock), relative bind
 * sources like `../wordpress` become `/workspace/wordpress` and the *host*
 * Docker daemon creates that path on the host — not the real project tree.
 * Always pass absolute *host* paths via WPDEV_HOST_PROJECT_ROOT / WPDEV_HOST_HOME.
 */

/** Bind source for a mount point from /proc/self/mountinfo (field 4), if present. */
export function readHostBindSource(mountPoint: string): string | null {
  try {
    const text = readFileSync("/proc/self/mountinfo", "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      const parts = line.split(" ");
      const dash = parts.indexOf("-");
      if (dash < 6) continue;
      const root = parts[3];
      const mnt = parts[4];
      if (mnt === mountPoint && root.startsWith("/") && !root.startsWith("/workspace")) {
        return root;
      }
    }
  } catch {
    /* not Linux / unreadable */
  }
  return null;
}

function readEnvFileValue(envPath: string, key: string): string {
  if (!existsSync(envPath)) return "";
  try {
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}=(.*)$`, "m");
    const m = readFileSync(envPath, "utf8").match(re);
    return m?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * Absolute path of the project on the Docker host (bind-mount source).
 * Prefers env → docker/.env → mountinfo for /workspace → configDir.
 */
export function resolveHostProjectRoot(configDir: string, composeEnvPath?: string): string {
  const fromEnv = process.env.WPDEV_HOST_PROJECT_ROOT?.trim();
  if (fromEnv && fromEnv.startsWith("/") && fromEnv !== "/workspace") {
    return fromEnv;
  }
  if (composeEnvPath) {
    const fromFile = readEnvFileValue(composeEnvPath, "WPDEV_HOST_PROJECT_ROOT");
    if (fromFile && fromFile.startsWith("/") && fromFile !== "/workspace") {
      return fromFile;
    }
  }
  const resolved = resolve(configDir);
  if (resolved === "/workspace" || resolved.startsWith("/workspace/")) {
    const bind = readHostBindSource("/workspace");
    if (bind) return bind;
  }
  return resolved;
}

/** Host home for ~/.ssh and ~/.wp-dev binds (not the container's /root). */
export function resolveHostHome(composeEnvPath?: string): string {
  const fromEnv = process.env.WPDEV_HOST_HOME?.trim();
  if (fromEnv && fromEnv.startsWith("/") && fromEnv !== "/root") {
    return fromEnv;
  }
  if (composeEnvPath) {
    const fromFile = readEnvFileValue(composeEnvPath, "WPDEV_HOST_HOME");
    if (fromFile && fromFile.startsWith("/") && fromFile !== "/root") {
      return fromFile;
    }
  }
  const home = homedir();
  if (home === "/root" || home === "/") {
    const bind = readHostBindSource("/root/.wp-dev") ?? readHostBindSource("/root/.ssh");
    if (bind) {
      // e.g. `/home/<installer>/.wp-dev` → `/home/<installer>`
      const idx = bind.lastIndexOf("/.wp-dev");
      if (idx > 0) return bind.slice(0, idx);
      const idxSsh = bind.lastIndexOf("/.ssh");
      if (idxSsh > 0) return bind.slice(0, idxSsh);
    }
  }
  return home;
}

/**
 * Installing host user's uid/gid for chown of bind-mounted files.
 * Never a fixed username — set by `wp-dev up` as WPDEV_HOST_UID/GID from the
 * account that owns the project. Inside the terminal the process is often root
 * (uid 0); prefer those env values, then project-dir ownership, then userInfo.
 * Last resort 1000:1000 is a numeric Linux default, not a named account.
 */
export function resolveHostIdentity(configDir: string): { uid: number; gid: number } {
  const envUid = process.env.WPDEV_HOST_UID?.trim();
  const envGid = process.env.WPDEV_HOST_GID?.trim();
  if (envUid && /^\d+$/.test(envUid) && Number(envUid) > 0) {
    const uid = Number(envUid);
    const gid =
      envGid && /^\d+$/.test(envGid) && Number(envGid) > 0 ? Number(envGid) : uid;
    return { uid, gid };
  }
  try {
    const st = statSync(resolve(configDir));
    if (typeof st.uid === "number" && st.uid > 0) {
      return { uid: st.uid, gid: st.gid > 0 ? st.gid : st.uid };
    }
  } catch {
    /* ignore */
  }
  try {
    const u = userInfo();
    if (u.uid > 0) {
      return { uid: u.uid, gid: u.gid > 0 ? u.gid : u.uid };
    }
  } catch {
    /* ignore */
  }
  return { uid: 1000, gid: 1000 };
}
