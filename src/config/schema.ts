import { z } from "zod";

const remoteEnvSchema = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  path: z.string().min(1),
  url: z.string().url(),
  port: z.coerce.number().int().positive().optional(),
  identityFile: z.string().optional(),
});

const localSchema = z.object({
  url: z.string().url(),
  path: z.string().min(1),
  composeFile: z.string().default("docker-compose.yml"),
  /** If set, used as `docker compose -p` name; otherwise derived from top-level `project`. */
  composeProjectName: z.string().min(1).max(64).optional(),
  /** Compose service that runs WP-CLI (`wordpress:cli` image), not the Apache container. */
  composeService: z.string().default("wpcli"),
  /** Host folder for WordPress files (bind-mounted at /var/www/html in the container). */
  wpRoot: z.string().min(1),
});

export const wpflowConfigSchema = z.object({
  /** Used for backup paths and (unless overridden) Docker Compose project isolation. */
  project: z.string().min(1),
  local: localSchema,
  staging: remoteEnvSchema,
  production: remoteEnvSchema,
});

export type WpflowConfig = z.infer<typeof wpflowConfigSchema>;
export type RemoteEnvName = "staging" | "production";
export type RemoteEnvConfig = z.infer<typeof remoteEnvSchema>;

export function getRemoteEnv(
  config: WpflowConfig,
  name: RemoteEnvName,
): RemoteEnvConfig {
  return config[name];
}
