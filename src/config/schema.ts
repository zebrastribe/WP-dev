import { z } from "zod";

const remoteDbSchema = z.object({
  host: z.string().min(1),
  name: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  prefix: z.string().min(1).optional(),
});

/**
 * Hostname / IP — the regex exports to JSON Schema so PHP/ajv validate too.
 * Allows hostnames, IPv4, and IPv6 localhost (::1).
 * Friendly messages live in superRefine (not exported to schema).
 */
const sshHostSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^(::1|[a-zA-Z0-9]([a-zA-Z0-9._:-]*[a-zA-Z0-9])?)$/,
    "must be a valid hostname (letters, digits, . _ : - only; start/end with alphanumeric) or ::1",
  )
  .superRefine((s, ctx) => {
    if (/\s/.test(s)) {
      ctx.addIssue({ code: "custom", message: "must not contain whitespace" });
    }
    if (/^https?:\/\//i.test(s)) {
      ctx.addIssue({ code: "custom", message: "must be a hostname, not a URL (remove http:// or https://)" });
    }
    if (/[;|&`$(){}[\]<>\\'"!#%^*~?\n\r]/.test(s)) {
      ctx.addIssue({ code: "custom", message: "must not contain shell metacharacters" });
    }
    if (s !== "::1" && s.includes("/")) {
      ctx.addIssue({ code: "custom", message: "must be a hostname only (no path component)" });
    }
  });

const remoteEnvSchema = z.object({
  host: sshHostSchema,
  user: z.string().min(1),
  path: z.string().min(1),
  url: z.string().url(),
  port: z.coerce.number().int().positive().optional(),
  identityFile: z.string().optional(),
  db: remoteDbSchema.optional(),
});

/** Apache/nginx-panel HTTP basic auth for the staging site (browser gate). Staging only. */
const stagingHttpAuthSchema = z.object({
  enabled: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const stagingEnvSchema = remoteEnvSchema.extend({
  httpAuth: stagingHttpAuthSchema.optional(),
});

/** Optional [Simply.com REST API](https://www.simply.com/en/docs/api/) — use for DNS/hosting automation; API key via `WPDEV_SIMPLY_API_KEY`. */
const simplySchema = z.object({
  account: z
    .string()
    .regex(/^(S|UE)\d+$/, "Simply.com account must look like S123456 or UE12345"),
});

const importWorkspaceSchema = z.object({
  enabled: z.boolean().optional(),
  localUrl: z.string().url().optional(),
  storagePath: z.string().optional(),
  knowledgeBasePath: z.string().optional(),
  deployPath: z.string().default("import"),
  tokenEnvVar: z.string().default("WPDEV_IMPORT_TOKEN"),
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
  /**
   * Theme source directory (contains package.json and/or theme/ subfolder).
   * Default: <wpRoot>/wp-content/themes/agency-starter
   */
  themePath: z.string().min(1).optional(),
  /** WordPress theme slug (folder name under wp-content/themes). Default: from style.css Text Domain. */
  themeSlug: z.string().min(1).optional(),
});

const themeUnitSchema = z.object({
  mode: z.enum(["all", "custom", "localOnly"]),
  excludeFolders: z.array(z.string().min(1)).optional(),
  excludeFiles: z.array(z.string().min(1)).optional(),
});

const syncSchema = z
  .object({
    /** Per-plugin push mode (slug → sync | localOnly). */
    plugins: z.record(z.enum(["sync", "localOnly"])).optional(),
    /** @deprecated use sync.plugins — migrated automatically when reading. */
    localOnlyPlugins: z.array(z.string().min(1)).optional(),
    /** Per-theme deployment units. */
    themes: z.record(themeUnitSchema).optional(),
    /** Keys from RECOMMENDED_PUSH_EXCLUDES the user turned off. */
    disabledRecommended: z.array(z.string().min(1)).optional(),
    extraPushExcludes: z.array(z.string().min(1)).optional(),
    extraPullExcludes: z.array(z.string().min(1)).optional(),
    /** When true, wp-content/uploads is excluded on push. */
    skipUploadsOnPush: z.boolean().optional(),
    recommendationsDismissed: z.boolean().optional(),
  })
  .optional();

export const wpDevConfigSchema = z.object({
  /** Used for backup paths and (unless overridden) Docker Compose project isolation. */
  project: z.string().min(1),
  local: localSchema,
  staging: stagingEnvSchema,
  production: remoteEnvSchema,
  simply: simplySchema.optional(),
  sync: syncSchema,
  importWorkspace: importWorkspaceSchema.optional(),
});

export type WpDevConfig = z.infer<typeof wpDevConfigSchema>;
export type RemoteEnvName = "staging" | "production";
export type RemoteEnvConfig = z.infer<typeof remoteEnvSchema>;
export type StagingEnvConfig = z.infer<typeof stagingEnvSchema>;
export type StagingHttpAuth = z.infer<typeof stagingHttpAuthSchema>;

const syncInnerShape = syncSchema?.unwrap?.()?.shape;
if (!syncInnerShape || typeof syncInnerShape !== "object") {
  throw new Error("schema.ts: cannot derive syncInner shape from syncSchema — zod structure changed");
}

export const schemaShapes = {
  root: wpDevConfigSchema.shape,
  local: localSchema.shape,
  staging: stagingEnvSchema.shape,
  production: remoteEnvSchema.shape,
  simply: simplySchema.shape,
  syncInner: syncInnerShape,
  importWorkspace: importWorkspaceSchema.shape,
  stagingDb: remoteDbSchema.shape,
  productionDb: remoteDbSchema.shape,
  stagingHttpAuth: stagingHttpAuthSchema.shape,
};

export function getRemoteEnv(
  config: WpDevConfig,
  name: RemoteEnvName,
): RemoteEnvConfig {
  return config[name];
}
