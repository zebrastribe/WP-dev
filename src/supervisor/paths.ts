import { join } from "node:path";

export function supervisorLogsDir(configDir: string): string {
  return join(configDir, "logs");
}

export function lockPath(configDir: string): string {
  return join(supervisorLogsDir(configDir), "wp-dev.lock");
}

export function registryPath(configDir: string): string {
  return join(supervisorLogsDir(configDir), "service-registry.json");
}

export function supervisorPidPath(configDir: string): string {
  return join(supervisorLogsDir(configDir), "wp-dev-supervisor.pid");
}

export function lifecycleLogPath(configDir: string): string {
  return join(supervisorLogsDir(configDir), "lifecycle.jsonl");
}

export function hostRunnerPidPath(configDir: string): string {
  return join(supervisorLogsDir(configDir), "wp-dev-host-runner.pid");
}

export function defaultSupervisorPort(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return 17680 + (Math.abs(hash) % 1000);
}
