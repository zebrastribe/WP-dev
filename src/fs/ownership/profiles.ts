import {
  RUNTIME_WRITE_PATHS,
  WWW_DATA_GID,
  WWW_DATA_UID,
  buildRuntimeWritePermissionsShell,
} from "../../commands/fix-permissions.js";
import type { OwnershipProfile, OwnershipManifest } from "../types.js";

export const SHARED_CONFIG_PATHS = [
  "wp-dev.config.json",
  "docker/.env",
] as const;

export const SHARED_CONFIG_DIRS = ["docker", "logs"] as const;

export function classifyRelativePath(relative: string): OwnershipProfile {
  const norm = relative.replace(/\\/g, "/");
  if (norm === "wp-dev.config.json" || norm === "docker/.env" || norm.startsWith("logs/")) {
    return norm.startsWith("logs/") ? "TOOL_ARTIFACT" : "SHARED_CONFIG";
  }
  if (norm.startsWith("wordpress/wp-content/themes/")) return "HOST_EDITABLE";
  if (norm === "wordpress/admin" || norm.startsWith("wordpress/admin/")) return "GENERATED";
  for (const p of RUNTIME_WRITE_PATHS) {
    if (norm === `wordpress/${p}` || norm.startsWith(`wordpress/${p}/`)) {
      return "CONTAINER_RUNTIME";
    }
  }
  if (norm.startsWith("wordpress/")) return "HOST_EDITABLE";
  return "HOST_EDITABLE";
}

export function buildOwnershipManifest(hostUid: number, hostGid: number): OwnershipManifest {
  const profiles: Record<string, OwnershipProfile> = {};
  for (const p of SHARED_CONFIG_PATHS) profiles[p] = "SHARED_CONFIG";
  for (const d of SHARED_CONFIG_DIRS) profiles[d] = "SHARED_CONFIG";
  for (const p of RUNTIME_WRITE_PATHS) {
    profiles[`wordpress/${p}`] = "CONTAINER_RUNTIME";
  }
  profiles["wordpress/wp-content/themes"] = "HOST_EDITABLE";
  return {
    version: 1,
    hostUid,
    hostGid,
    wwwDataUid: WWW_DATA_UID,
    wwwDataGid: WWW_DATA_GID,
    lastReconciled: new Date().toISOString(),
    profiles,
  };
}

export { buildRuntimeWritePermissionsShell, RUNTIME_WRITE_PATHS, WWW_DATA_UID, WWW_DATA_GID };
