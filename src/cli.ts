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
import { cmdFixPermissions } from "./commands/fix-permissions.js";
import { cmdDoctor } from "./commands/doctor.js";
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
      "Chown bind-mounted wordpress/ to your host uid:gid (fixes rsync after Docker created files as www-data)",
    )
    .action(async () => {
      await runWithConfig("fix-permissions", cmdFixPermissions);
    });

  program
    .command("doctor")
    .description(
      "Check Docker prereq and remote SSH + wp core is-installed (optional rsync pull --dry-run)",
    )
    .argument("[env]", "staging | production (default: both)")
    .option("--rsync", "After WP-CLI check, run rsync pull --dry-run (no DB, no file writes)")
    .action(async (env: string | undefined, opts: { rsync?: boolean }) => {
      const rsync = Boolean(opts.rsync);
      const envTrim = env?.trim();
      const parsedEnv =
        envTrim && envTrim.length > 0 ? parseRemoteEnv(envTrim) : undefined;
      const label = parsedEnv
        ? `doctor ${parsedEnv}${rsync ? " --rsync" : ""}`
        : `doctor${rsync ? " --rsync" : ""}`;
      await runWithConfig(label, (loaded) =>
        cmdDoctor(loaded, {
          env: parsedEnv,
          rsyncDryRun: rsync,
        }),
      );
    });

  program
    .command("pull")
    .description("Pull database and files from staging or production")
    .argument("<env>", "staging | production")
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
    });

  program
    .command("push")
    .description("Push local database and files to staging or production")
    .argument("<env>", "staging | production")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      await runWithConfig(`push ${e}${dry ? " --dry-run" : ""}`, (loaded) =>
        cmdPush(loaded, e, { dryRun: dry }),
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
    .action(async (env: string, file: string) => {
      const t = parseRestoreTarget(env);
      await runWithConfig(`restore ${t}`, (loaded) =>
        cmdRestore(loaded, t, file),
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
