#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config/load.js";
import type { LoadedConfig } from "./config/load.js";
import type { RemoteEnvName } from "./config/schema.js";
import { cmdUp } from "./commands/up.js";
import { cmdDown } from "./commands/down.js";
import { cmdPull } from "./commands/pull.js";
import { cmdPush } from "./commands/push.js";
import { cmdBackup, type BackupTarget } from "./commands/backup.js";
import { cmdRestore, type RestoreTarget } from "./commands/restore.js";
import { cmdLogs } from "./commands/logs.js";
import { cmdInit } from "./commands/init.js";
import { cmdSimplySetupStagingDns, cmdSimplyTest } from "./commands/simply.js";
import { cmdFixPermissions, cmdFixRuntimeWritePermissions } from "./commands/fix-permissions.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdSslDisable, cmdSslEnable } from "./commands/ssl.js";
import { cmdPhpSet, cmdPhpShow, cmdPhpValidate } from "./commands/php.js";
import { cmdImportBuild } from "./commands/import/build.js";
import { cmdImportIngest } from "./commands/import/ingest.js";
import { cmdImportPush } from "./commands/import/push.js";
import { cmdThemeBuild } from "./commands/theme-build.js";
import { cmdPushTheme } from "./commands/push-theme.js";
import { cmdPullTheme } from "./commands/pull-theme.js";
import { ensureWpDevConfigJson } from "./config/load.js";
import { hydrateSimplyApiKeyFromComposeEnv, hydrateStagingDbFromComposeEnv } from "./services/simply.js";
import { initLogger, logError, logInfo } from "./utils/logger.js";

function parseRemoteEnv(s: string): RemoteEnvName {
  if (s === "staging" || s === "production") return s;
  throw new Error(`Invalid environment "${s}". Use staging or production.`);
}

function parseBackupTarget(s: string): BackupTarget {
  if (s === "staging" || s === "production" || s === "local") return s;
  throw new Error(`Invalid target "${s}". Use local, staging, or production.`);
}

function parseRestoreTarget(s: string): RestoreTarget {
  return parseBackupTarget(s);
}

/** Load wp-dev.config.json, init file logger, run command, log outcome (use for all non-init commands). */
async function runWithConfig(
  label: string,
  run: (loaded: LoadedConfig) => Promise<void>,
): Promise<void> {
  const loaded = loadConfig();
  hydrateSimplyApiKeyFromComposeEnv(loaded.configDir, loaded.config);
  hydrateStagingDbFromComposeEnv(loaded.configDir, loaded.config);
  initLogger(loaded.configDir);
  logInfo(`command ${label}`);
  try {
    await run(loaded);
    logInfo(`command ${label} finished ok`);
  } catch (e) {
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    logError(msg);
    throw e;
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("wp-dev")
    .description("WordPress local Docker + pull/push staging & production (wp-dev)")
    .version("0.1.0");

  program
    .command("init")
    .description(
      "Interactively set project id, local URL, staging/production SSH (updates wp-dev.config.json; no pull)",
    )
    .action(async () => {
      try {
        await cmdInit();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          const dir = ensureWpDevConfigJson();
          initLogger(dir);
          logError(`init failed: ${msg}`);
        } catch {
          /* no project root */
        }
        console.error(msg);
        process.exitCode = 1;
      }
    });

  const simply = program
    .command("simply")
    .description(
      "Simply.com REST API (domains/hosting) — https://www.simply.com/en/docs/api/",
    );

  simply
    .command("test")
    .description("Verify API credentials (GET /my/products/)")
    .action(async () => {
      await runWithConfig("simply test", cmdSimplyTest);
    });

  simply
    .command("setup-staging-dns")
    .description(
      "Simply.com: A record <label>.<apex> + update staging URL / SSH hints in wp-dev.config.json",
    )
    .argument("[apex]", "e.g. stri.be — default: hostname from production.url")
    .option(
      "--keep-existing-dns",
      "If that hostname already has DNS at Simply, keep it and only update wp-dev config (no overwrite)",
    )
    .option(
      "--staging-label <name>",
      'DNS label before apex (default: staging). Example: dev → dev.<apex>',
    )
    .action(
      async (
        apex: string | undefined,
        opts: { keepExistingDns?: boolean; stagingLabel?: string },
      ) => {
        const flags = [
          opts.keepExistingDns ? " --keep-existing-dns" : "",
          opts.stagingLabel ? ` --staging-label ${opts.stagingLabel}` : "",
        ].join("");
        const label = `simply setup-staging-dns${apex?.trim() ? ` ${apex.trim()}` : ""}${flags}`;
        await runWithConfig(label, (loaded) =>
          cmdSimplySetupStagingDns(loaded, apex, {
            keepExistingDns: Boolean(opts.keepExistingDns),
            stagingLabel: opts.stagingLabel,
          }),
        );
      },
    );

  program
    .command("up")
    .description("Start local WordPress (docker compose up -d)")
    .action(async () => {
      await runWithConfig("up", cmdUp);
    });

  const ssl = program.command("ssl").description("Manage localhost HTTPS for the local Docker stack");

  ssl
    .command("enable")
    .description("Enable localhost HTTPS using mkcert and update local.url")
    .action(async () => {
      await runWithConfig("ssl enable", cmdSslEnable);
    });

  ssl
    .command("disable")
    .description("Disable localhost HTTPS and switch local.url back to HTTP")
    .action(async () => {
      await runWithConfig("ssl disable", cmdSslDisable);
    });

  const php = program.command("php").description("Manage local PHP runtime version for Docker images");

  php
    .command("show")
    .description("Show current local PHP version and allowed values")
    .action(async () => {
      await runWithConfig("php show", cmdPhpShow);
    });

  php
    .command("validate")
    .description("Validate a PHP version by checking Docker image tags")
    .argument("<version>", "e.g. 7.4, 8.1, 8.2, 8.3, 8.4")
    .action(async (version: string) => {
      await runWithConfig(`php validate ${version}`, (loaded) => cmdPhpValidate(loaded, version));
    });

  php
    .command("set")
    .description("Set local PHP version (runs validation first)")
    .argument("<version>", "e.g. 7.4, 8.1, 8.2, 8.3, 8.4")
    .action(async (version: string) => {
      await runWithConfig(`php set ${version}`, (loaded) => cmdPhpSet(loaded, version));
    });

  program
    .command("down")
    .description(
      "Stop local WordPress (docker compose down) — frees the published WP_PORT for this clone",
    )
    .option(
      "--remove-orphans",
      "Remove containers for this Compose project not defined in the current compose file",
    )
    .action(async (opts: { removeOrphans?: boolean }) => {
      const ro = Boolean(opts.removeOrphans);
      await runWithConfig(`down${ro ? " --remove-orphans" : ""}`, (loaded) =>
        cmdDown(loaded, { removeOrphans: ro }),
      );
    });

  program
    .command("fix-permissions")
    .description(
      "Chown bind-mounted wordpress/ to your host uid:gid, then restore www-data write access on plugins/upgrade/uploads (fixes rsync + wp-admin updates)",
    )
    .option(
      "--no-runtime",
      "Only chown to host user; skip restoring www-data write paths (not recommended)",
    )
    .action(async (opts: { noRuntime?: boolean }) => {
      await runWithConfig("fix-permissions", (loaded) =>
        cmdFixPermissions(loaded, { runtime: !opts.noRuntime }),
      );
    });

  program
    .command("fix-runtime-permissions")
    .description(
      "Restore www-data ownership on wp-content/plugins, upgrade, uploads, and cache (fixes wp-admin plugin updates)",
    )
    .action(async () => {
      await runWithConfig("fix-runtime-permissions", cmdFixRuntimeWritePermissions);
    });

  program
    .command("doctor")
    .description(
      "Check Docker prereq and remote SSH + wp core is-installed (optional rsync pull --dry-run)",
    )
    .argument("[env]", "staging | production (default: both)")
    .option("--rsync", "After WP-CLI check, run rsync pull --dry-run (no DB, no file writes)")
    .option("--http", "Probe remote URL status/redirect chain and verify final host")
    .action(async (env: string | undefined, opts: { rsync?: boolean; http?: boolean }) => {
      const rsync = Boolean(opts.rsync);
      const http = Boolean(opts.http);
      const envTrim = env?.trim();
      const parsedEnv =
        envTrim && envTrim.length > 0 ? parseRemoteEnv(envTrim) : undefined;
      const label = parsedEnv
        ? `doctor ${parsedEnv}${rsync ? " --rsync" : ""}${http ? " --http" : ""}`
        : `doctor${rsync ? " --rsync" : ""}${http ? " --http" : ""}`;
      await runWithConfig(label, (loaded) =>
        cmdDoctor(loaded, {
          env: parsedEnv,
          rsyncDryRun: rsync,
          httpCheck: http,
        }),
      );
    });

  const pullCmd = program
    .command("pull")
    .description("Pull database and files from staging or production");

  pullCmd
    .command("<env>")
    .description("Pull database and files from staging or production")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .option(
      "--no-backup-local",
      "Skip exporting local DB to ~/.wp-dev/backups/<project>/local/ before overwriting it",
    )
    .option(
      "--skip-simply-staging-dns",
      "After pull production, skip auto simply setup-staging-dns when staging is still a placeholder",
    )
    .action(
      async (
        env: string,
        opts: { dryRun?: boolean; backupLocal?: boolean; skipSimplyStagingDns?: boolean },
      ) => {
        const e = parseRemoteEnv(env);
        const dry = Boolean(opts.dryRun);
        const backupLocal = Boolean(opts.backupLocal);
        const skipSimplyStagingDns = Boolean(opts.skipSimplyStagingDns);
        const label = `pull ${e}${dry ? " --dry-run" : ""}${backupLocal ? "" : " --no-backup-local"}${skipSimplyStagingDns ? " --skip-simply-staging-dns" : ""}`;
        await runWithConfig(label, (loaded) =>
          cmdPull(loaded, e, {
            dryRun: dry,
            backupLocal,
            skipSimplyStagingDns,
          }),
        );
      },
    );

  pullCmd
    .command("theme <env>")
    .description("Pull theme files from staging or production (no database)")
    .option("--dry-run", "Show rsync dry-run only")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      await runWithConfig(`pull theme ${e}${dry ? " --dry-run" : ""}`, (loaded) =>
        cmdPullTheme(loaded, e, { dryRun: dry }),
      );
    });

  const pushCmd = program
    .command("push")
    .description("Push to staging or production (full site or theme-only)");

  pushCmd
    .command("<env>")
    .description("Push local database and files (full site — overwrites remote DB)")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      await runWithConfig(`push ${e}${dry ? " --dry-run" : ""}`, (loaded) =>
        cmdPush(loaded, e, { dryRun: dry }),
      );
    });

  pushCmd
    .command("theme <env>")
    .description("Push compiled theme files only (no database or uploads)")
    .option("--dry-run", "Show rsync dry-run only")
    .option("--build", "Run theme build (npm run production) before rsync")
    .option("--skip-build-check", "Deploy even if style.css looks like a dev build")
    .action(async (env: string, opts: { dryRun?: boolean; build?: boolean; skipBuildCheck?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      const build = Boolean(opts.build);
      const skipBuildCheck = Boolean(opts.skipBuildCheck);
      const label = `push theme ${e}${dry ? " --dry-run" : ""}${build ? " --build" : ""}${skipBuildCheck ? " --skip-build-check" : ""}`;
      await runWithConfig(label, (loaded) =>
        cmdPushTheme(loaded, e, { dryRun: dry, build, skipBuildCheck }),
      );
    });

  const themeCmd = program
    .command("theme")
    .description("Theme build and deploy helpers (files only — no database)");

  themeCmd
    .command("build")
    .description("Run npm run production in the configured theme source tree")
    .option("--skip-install", "Skip npm ci before build")
    .action(async (opts: { skipInstall?: boolean }) => {
      await runWithConfig(
        `theme build${opts.skipInstall ? " --skip-install" : ""}`,
        (loaded) => cmdThemeBuild(loaded, { skipInstall: Boolean(opts.skipInstall) }),
      );
    });

  themeCmd
    .command("push <env>")
    .description("Alias for `wp-dev push theme <env>`")
    .option("--dry-run", "Show rsync dry-run only")
    .option("--build", "Run theme build before rsync")
    .option("--skip-build-check", "Deploy even if style.css looks like a dev build")
    .action(async (env: string, opts: { dryRun?: boolean; build?: boolean; skipBuildCheck?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      const build = Boolean(opts.build);
      const skipBuildCheck = Boolean(opts.skipBuildCheck);
      await runWithConfig(`theme push ${e}`, (loaded) =>
        cmdPushTheme(loaded, e, { dryRun: dry, build, skipBuildCheck }),
      );
    });

  themeCmd
    .command("pull <env>")
    .description("Alias for `wp-dev pull theme <env>`")
    .option("--dry-run", "Show rsync dry-run only")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      await runWithConfig(`theme pull ${e}`, (loaded) =>
        cmdPullTheme(loaded, e, { dryRun: Boolean(opts.dryRun) }),
      );
    });

  program
    .command("backup")
    .description("Export database only to ~/.wp-dev/backups/<project>/<env>/")
    .argument("<env>", "local | staging | production")
    .action(async (env: string) => {
      const t = parseBackupTarget(env);
      await runWithConfig(`backup ${t}`, (loaded) => cmdBackup(loaded, t));
    });

  program
    .command("restore")
    .description("Import a SQL backup (overwrites DB on target)")
    .argument("<env>", "local | staging | production")
    .argument("<file>", "Path to .sql backup file")
    .option("--yes", "Skip interactive production confirmation prompt")
    .action(async (env: string, file: string, opts: { yes?: boolean }) => {
      const t = parseRestoreTarget(env);
      await runWithConfig(`restore ${t}`, (loaded) =>
        cmdRestore(loaded, t, file, { yes: Boolean(opts.yes) }),
      );
    });

  const importCmd = program
    .command("import")
    .description("Content Recovery Workspace at /import/ (ingest, build, push)");

  importCmd
    .command("build")
    .description("Build React SPA + copy API to wordpress/import/")
    .action(async () => {
      await runWithConfig("import build", cmdImportBuild);
    });

  importCmd
    .command("ingest")
    .description("Import knowledge-base JSON into SQLite repository")
    .action(async () => {
      await runWithConfig("import ingest", cmdImportIngest);
    });

  importCmd
    .command("push")
    .description("Deploy wordpress/import/ and storage to staging or production")
    .argument("<env>", "staging | production")
    .option("--dry-run", "Show rsync dry-run only")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      await runWithConfig(`import push ${e}${opts.dryRun ? " --dry-run" : ""}`, (loaded) =>
        cmdImportPush(loaded, e, { dryRun: Boolean(opts.dryRun) }),
      );
    });

  program
    .command("logs")
    .description("Print path to wp-dev.log and the last N lines (project logs/)")
    .option("-n, --lines <n>", "number of lines from end of file", "100")
    .action(async (opts: { lines?: string }) => {
      const n = Math.min(5000, Math.max(1, parseInt(String(opts.lines), 10) || 100));
      await runWithConfig(`logs --lines ${n}`, async (loaded) => {
        cmdLogs(loaded, n);
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const loaded = loadConfig();
    initLogger(loaded.configDir);
    logError(`fatal: ${msg}`);
  } catch {
    /* no config — cannot write log file */
  }
  console.error(msg);
  process.exitCode = 1;
});
