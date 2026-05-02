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

async function withLoadedConfig(
  label: string,
  run: (loaded: LoadedConfig) => Promise<void>,
): Promise<void> {
  const loaded = loadConfig();
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
    .name("wpflow")
    .description("WordPress local Docker + pull/push staging & production")
    .version("0.1.0");

  program
    .command("up")
    .description("Start local WordPress (docker compose up -d)")
    .action(async () => {
      await withLoadedConfig("up", cmdUp);
    });

  program
    .command("down")
    .description("Stop local WordPress (docker compose down)")
    .action(async () => {
      await withLoadedConfig("down", cmdDown);
    });

  program
    .command("pull")
    .description("Pull database and files from staging or production")
    .argument("<env>", "staging | production")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const e = parseRemoteEnv(env);
      const dry = Boolean(opts.dryRun);
      await withLoadedConfig(`pull ${e}${dry ? " --dry-run" : ""}`, (loaded) =>
        cmdPull(loaded, e, { dryRun: dry }),
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
      await withLoadedConfig(`push ${e}${dry ? " --dry-run" : ""}`, (loaded) =>
        cmdPush(loaded, e, { dryRun: dry }),
      );
    });

  program
    .command("backup")
    .description("Export database only to ~/.wpflow/backups/<project>/<env>/")
    .argument("<env>", "local | staging | production")
    .action(async (env: string) => {
      const t = parseBackupTarget(env);
      await withLoadedConfig(`backup ${t}`, (loaded) => cmdBackup(loaded, t));
    });

  program
    .command("restore")
    .description("Import a SQL backup (overwrites DB on target)")
    .argument("<env>", "local | staging | production")
    .argument("<file>", "Path to .sql backup file")
    .action(async (env: string, file: string) => {
      const t = parseRestoreTarget(env);
      await withLoadedConfig(`restore ${t}`, (loaded) =>
        cmdRestore(loaded, t, file),
      );
    });

  program
    .command("logs")
    .description("Print path to wpflow.log and the last N lines (project logs/)")
    .option("-n, --lines <n>", "number of lines from end of file", "100")
    .action(async (opts: { lines?: string }) => {
      const loaded = loadConfig();
      initLogger(loaded.configDir);
      const n = Math.min(5000, Math.max(1, parseInt(String(opts.lines), 10) || 100));
      logInfo(`logs --lines ${n}`);
      cmdLogs(loaded, n);
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
