import type { DockerEnvPortKey } from "../utils/compose-env.js";

export type ServiceKind = "docker" | "node" | "job";
export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "stopping"
  | "failed";
export type HealthState = "unknown" | "healthy" | "unhealthy";
export type ShutdownPhase =
  | "none"
  | "stop_accepting"
  | "notify_services"
  | "cancel_jobs"
  | "flush_work"
  | "close_sockets"
  | "terminate_children"
  | "compose_down"
  | "release_ports"
  | "remove_pid_files"
  | "remove_lock"
  | "persist_clean"
  | "verify_cleanup"
  | "complete";

export interface ManagedService {
  name: string;
  kind: ServiceKind;
  projectId: string;
  pid?: number;
  containerId?: string;
  parentPid?: number;
  port?: number;
  containerPort?: number;
  status: ServiceStatus;
  health: HealthState;
  startedAt: string;
  lastHeartbeat: string;
  restartCount: number;
  cwd: string;
  logPath: string;
  bindAddress: string;
}

export interface ServiceRegistry {
  version: 1;
  projectId: string;
  configDir: string;
  supervisorPid: number;
  supervisorPort: number;
  shutdownPhase: ShutdownPhase;
  updatedAt: string;
  ports: Record<DockerEnvPortKey, number>;
  services: ManagedService[];
}

export interface ProjectLockData {
  pid: number;
  projectId: string;
  configDir: string;
  supervisorPort: number;
  startedAt: string;
}

export type LifecycleEventType =
  | "lifecycle.start"
  | "lifecycle.ready"
  | "lifecycle.shutdown"
  | "service.register"
  | "service.health_fail"
  | "port.reserve"
  | "port.conflict"
  | "port.reclaim"
  | "recovery.stale_lock"
  | "recovery.orphan_kill"
  | "job.start"
  | "job.timeout";

export interface LifecycleEvent {
  ts: string;
  event: LifecycleEventType;
  project: string;
  [key: string]: unknown;
}

export type PortConflictAction = "reconnect" | "reclaim" | "exit" | "relocate";

export interface PortConflictInfo {
  port: number;
  key: DockerEnvPortKey;
  ownerPid?: number;
  ownerCommand?: string;
  ownedByCompose: boolean;
  ownedByRegistry: boolean;
}
