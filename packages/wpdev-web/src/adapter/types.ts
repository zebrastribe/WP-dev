/** Shared adapter contract for localhost and (later) hosted control-web. */

export type EnvRole = "dev" | "staging" | "production";

/** Runner env args still use local|staging|production. */
export type RunnerEnv = "local" | "staging" | "production";

export type SyncRouteId =
  | "dev_to_staging"
  | "staging_to_dev"
  | "production_to_dev"
  | "staging_to_production"
  | "production_to_staging";

export type SyncScopePreset = "full" | "skip_uploads" | "theme_only";

export type JobResult = { ok: boolean; output: string };

export type SyncRoute = {
  id: SyncRouteId;
  label: string;
  source: EnvRole;
  destination: EnvRole;
  /** Primary nav vs Advanced */
  primary: boolean;
  /** Hosted-only until cloud workers exist */
  hostedOnly?: boolean;
  runnerEnv: RunnerEnv;
  direction: "push" | "pull";
};

export const ENV_LABEL: Record<EnvRole, string> = {
  dev: "Dev",
  staging: "Staging",
  production: "Production",
};

export const RUNNER_ENV_LABEL: Record<RunnerEnv, string> = {
  local: "Dev",
  staging: "Staging",
  production: "Production",
};

/** Localhost-capable routes (plan A/B until companion/cloud). */
export const LOCAL_SYNC_ROUTES: SyncRoute[] = [
  {
    id: "dev_to_staging",
    label: "Dev → Staging",
    source: "dev",
    destination: "staging",
    primary: true,
    runnerEnv: "staging",
    direction: "push",
  },
  {
    id: "staging_to_dev",
    label: "Staging → Dev",
    source: "staging",
    destination: "dev",
    primary: true,
    runnerEnv: "staging",
    direction: "pull",
  },
  {
    id: "production_to_dev",
    label: "Production → Dev",
    source: "production",
    destination: "dev",
    primary: false,
    runnerEnv: "production",
    direction: "pull",
  },
  {
    id: "staging_to_production",
    label: "Staging → Production",
    source: "staging",
    destination: "production",
    primary: false,
    hostedOnly: true,
    runnerEnv: "production",
    direction: "push",
  },
  {
    id: "production_to_staging",
    label: "Production → Staging",
    source: "production",
    destination: "staging",
    primary: false,
    hostedOnly: true,
    runnerEnv: "staging",
    direction: "pull",
  },
];

export type WpdevWebAdapter = {
  kind: "local" | "cloud";
  /** Run a named job; implementations use runners or control-api. */
  runJob: (
    action: string,
    args: Record<string, string> | undefined,
    label: string,
    runnerKind?: "sync" | "terminal",
  ) => Promise<JobResult>;
};

export function roleToRunnerEnv(role: EnvRole): RunnerEnv {
  return role === "dev" ? "local" : role;
}
