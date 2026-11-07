import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { cmdRestore } from "./restore.js";
import { cmdUp } from "./up.js";
import { compose } from "../services/docker-compose.js";
import {
  isLocalWpInstalled,
  wpLocalAlignTablePrefixAfterImport,
  wpLocalForceSiteUrls,
  wpLocalGetTablePrefix,
  wpLocalRaw,
  wpLocalSearchReplace,
} from "../services/wpcli.js";
import { publishLocalCompanion } from "../companion/beacon.js";
import {
  persistEnvContent,
  readEnvValue,
  setEnvValueInContent,
} from "../utils/compose-env.js";
import { logInfo } from "../utils/logger.js";
import {
  dockerComposeEnvPath,
  getPublishedLocalAccess,
} from "../utils/published-local-urls.js";
import {
  phpVersionRequiredByWpCli,
  readSqlDumpHints,
} from "../utils/sql-dump-prefix.js";
import { getUrlVariants } from "../utils/url-variants.js";
import { verifyLocalSiteUrls } from "../utils/sync-verify.js";

export { phpVersionRequiredByWpCli };

function phpFixMessage(text: string): string | null {
  const version = phpVersionRequiredByWpCli(text);
  if (!version) return null;
  return (
    `This backup needs PHP ${version} or newer. The WordPress port is left as this project published it. ` +
    `Run: npm run wp-dev -- php set ${version} --restart\n` +
    `Then run setup-from-backup again with the same file.`
  );
}

async function extractArchive(archivePath: string): Promise<{ dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "wpdev-setup-"));
  await execa("tar", ["-xzf", archivePath, "-C", dir], { reject: true });
  if (!existsSync(join(dir, "db.sql"))) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("Local setup archive must contain db.sql plus wp-content/ or site/.");
  }
  return { dir };
}

function assertArchiveShape(dir: string): "content" | "complete" {
  if (existsSync(join(dir, "site"))) return "complete";
  if (existsSync(join(dir, "wp-content"))) return "content";
  throw new Error("Local setup archive must contain db.sql plus wp-content/ or site/.");
}

async function alignPrefix(loaded: LoadedConfig, tablePrefix: string): Promise<void> {
  const envPath = dockerComposeEnvPath(loaded);
  const current = readFileSync(envPath, "utf8");
  const published = readEnvValue(current, "WORDPRESS_TABLE_PREFIX");
  const live = await wpLocalGetTablePrefix(loaded.configDir, loaded.config);
  if (published === tablePrefix && live === tablePrefix) return;
  logInfo(`setup-from-backup: table prefix ${live ?? published ?? "unset"} -> ${tablePrefix}`);
  persistEnvContent(envPath, setEnvValueInContent(current, "WORDPRESS_TABLE_PREFIX", tablePrefix), loaded);
  await compose(
    loaded.configDir,
    loaded.config,
    ["up", "-d", "--no-deps", "--force-recreate", "wordpress"],
    { stdio: "inherit" },
  );
  const after = await wpLocalGetTablePrefix(loaded.configDir, loaded.config);
  if (after !== tablePrefix) {
    await wpLocalAlignTablePrefixAfterImport(loaded.configDir, loaded.config, tablePrefix);
  }
}

async function ensureInstalled(loaded: LoadedConfig, site: string): Promise<void> {
  if (await isLocalWpInstalled(loaded.configDir, loaded.config)) return;
  const password = randomBytes(18).toString("base64url");
  const ran = await wpLocalRaw(loaded.configDir, loaded.config, [
    "core",
    "install",
    `--url=${site}`,
    `--title=${loaded.config.project}`,
    "--admin_user=local",
    `--admin_password=${password}`,
    `--admin_email=local@${loaded.config.project}.invalid`,
    "--skip-email",
  ]);
  if (ran.exitCode !== 0 && !(await isLocalWpInstalled(loaded.configDir, loaded.config))) {
    const text = `${ran.stderr}\n${ran.stdout}`;
    throw new Error(phpFixMessage(text) ?? `Could not install local WordPress before restore: ${text.slice(0, 800)}`);
  }
}

async function rewriteUrls(loaded: LoadedConfig, fromUrl: string | undefined, site: string): Promise<void> {
  const targets = fromUrl ? getUrlVariants(fromUrl) : [];
  const local = site.replace(/\/$/, "");
  for (const from of targets) {
    if (from.replace(/\/$/, "") === local) continue;
    try {
      await wpLocalSearchReplace(loaded.configDir, loaded.config, from, local);
      const escapedFrom = from.replace(/\//g, "\\/");
      const escapedTo = local.replace(/\//g, "\\/");
      if (escapedFrom !== from) {
        await wpLocalSearchReplace(loaded.configDir, loaded.config, escapedFrom, escapedTo);
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const hint = phpFixMessage(text);
      if (hint) throw new Error(hint);
      throw e;
    }
  }
  await wpLocalForceSiteUrls(loaded.configDir, loaded.config, local);
}

/**
 * Start this project's local stack on its own published port, then load a backup archive
 * (db.sql + wp-content/ or site/) and point the site URL at that local address.
 */
export async function cmdSetupFromBackup(loaded: LoadedConfig, archivePath: string): Promise<void> {
  const { dir } = await extractArchive(archivePath);
  try {
    const kind = assertArchiveShape(dir);
    const hints = await readSqlDumpHints(join(dir, "db.sql"));
    const tablePrefix = hints.prefix;
    if (!tablePrefix) {
      throw new Error("Could not read the table prefix from db.sql. Refusing to import.");
    }
    const fromUrl = hints.siteUrl;
    console.error(`Backup is a ${kind} archive. Table prefix ${tablePrefix}.`);
    if (fromUrl) console.error(`Backup site URL: ${fromUrl}`);

    await cmdUp(loaded);
    await alignPrefix(loaded, tablePrefix);
    const access = getPublishedLocalAccess(loaded);
    await ensureInstalled(loaded, access.site);

    const backupDir = join(homedir(), ".wp-dev", "backups", loaded.config.project, "local");
    const dest = join(backupDir, basename(archivePath));
    mkdirSync(backupDir, { recursive: true });
    if (dest !== archivePath) copyFileSync(archivePath, dest);
    await cmdRestore(loaded, "local", dest);
    await rewriteUrls(loaded, fromUrl, access.site);
    const check = await verifyLocalSiteUrls(loaded.configDir, loaded.config, access.site);
    await publishLocalCompanion(loaded);
    console.error(`\nLocal site: ${access.site}`);
    console.error(`Local admin: ${access.admin}`);
    console.error(`home=${check.home ?? "?"} siteurl=${check.siteurl ?? "?"}`);
    if (!check.ok) {
      throw new Error(`Site URL did not settle on ${access.site}.`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
