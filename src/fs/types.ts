export type OwnershipProfile =
  | "SHARED_CONFIG"
  | "HOST_EDITABLE"
  | "CONTAINER_RUNTIME"
  | "TOOL_ARTIFACT"
  | "GENERATED";

export type FsAuditEvent =
  | "fs.write"
  | "fs.write_atomic"
  | "fs.read"
  | "fs.delete"
  | "fs.temp_register"
  | "fs.temp_sweep"
  | "fs.reconcile"
  | "fs.recovery"
  | "fs.permission_fail"
  | "fs.stale_tmp_cleanup";

export interface OwnershipManifest {
  version: 1;
  hostUid: number;
  hostGid: number;
  wwwDataUid: number;
  wwwDataGid: number;
  lastReconciled: string;
  profiles: Record<string, OwnershipProfile>;
}

export interface TempRegistryEntry {
  id: string;
  path: string;
  operation: string;
  pid: number;
  createdAt: string;
}

export interface TempRegistry {
  version: 1;
  entries: TempRegistryEntry[];
}

export interface FilesystemProbeResult {
  ok: boolean;
  path: string;
  readable: boolean;
  writable: boolean;
  issues: string[];
}
