#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config/load.js";
import type { RemoteEnvName } from "./config/schema.js";
import { cmdUp } from "./commands/up.js";
import { cmdDown } from "./commands/down.js";
import { cmdPull } from "./commands/pull.js";
import { cmdPush } from "./commands/push.js";
import { cmdBackup, type BackupTarget } from "./commands/backup.js";
import { cmdRestore, type RestoreTarget } from "./commands/restore.js";

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
      const loaded = loadConfig();
      await cmdUp(loaded);
    });

  program
    .command("down")
    .description("Stop local WordPress (docker compose down)")
    .action(async () => {
      const loaded = loadConfig();
      await cmdDown(loaded);
    });

  program
    .command("pull")
    .description("Pull database and files from staging or production")
    .argument("<env>", "staging | production")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const loaded = loadConfig();
      await cmdPull(loaded, parseRemoteEnv(env), { dryRun: Boolean(opts.dryRun) });
    });

  program
    .command("push")
    .description("Push local database and files to staging or production")
    .argument("<env>", "staging | production")
    .option("--dry-run", "Show rsync dry-run only; skip database steps")
    .action(async (env: string, opts: { dryRun?: boolean }) => {
      const loaded = loadConfig();
      await cmdPush(loaded, parseRemoteEnv(env), { dryRun: Boolean(opts.dryRun) });
    });

  program
    .command("backup")
    .description("Export database only to ~/.wpflow/backups/<project>/<env>/")
    .argument("<env>", "local | staging | production")
    .action(async (env: string) => {
      const loaded = loadConfig();
      await cmdBackup(loaded, parseBackupTarget(env));
    });

  program
    .command("restore")
    .description("Import a SQL backup (overwrites DB on target)")
    .argument("<env>", "local | staging | production")
    .argument("<file>", "Path to .sql backup file")
    .action(async (env: string, file: string) => {
      const loaded = loadConfig();
      await cmdRestore(loaded, parseRestoreTarget(env), file);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
