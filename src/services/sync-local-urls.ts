import type { LoadedConfig } from "../config/load.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { logInfo } from "../utils/logger.js";
import {
  isLocalWpInstalled,
  wpLocalForceSiteUrls,
  wpLocalRaw,
  wpLocalSearchReplace,
  wpLocalSearchReplaceRegex,
} from "./wpcli.js";

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Normalizes loopback site URLs for comparison (localhost, no trailing slash). */
export function normalizeLoopbackSiteUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (!isLoopbackHost(u.hostname)) return undefined;
  u.hostname = "localhost";
  u.hash = "";
  u.search = "";
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  return u.toString().replace(/\/$/, "");
}

export function shouldSyncLocalWordPressUrl(current: string, target: string): boolean {
  const normCurrent = normalizeLoopbackSiteUrl(current);
  const normTarget = normalizeLoopbackSiteUrl(target);
  if (!normCurrent || !normTarget) return false;
  return normCurrent !== normTarget;
}

/** Distinct loopback URL strings suitable for wp search-replace (with and without trailing slash). */
export function collectLoopbackUrlVariants(...urls: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    if (!raw?.trim()) continue;
    let u: URL;
    try {
      u = new URL(raw.trim());
    } catch {
      continue;
    }
    if (!isLoopbackHost(u.hostname)) continue;
    u.hostname = "localhost";
    const base = u.toString().replace(/\/$/, "");
    out.add(base);
    out.add(`${base}/`);
  }
  return [...out];
}

export type SyncLocalUrlsResult = {
  changed: boolean;
  from?: string;
  to: string;
  dbReplacements: number;
  warnings: string[];
};

async function wpLocalGetOption(
  configDir: string,
  config: LoadedConfig["config"],
  key: string,
): Promise<string | undefined> {
  const r = await wpLocalRaw(configDir, config, ["option", "get", key]);
  if (r.exitCode !== 0) return undefined;
  const v = (r.stdout || "").trim();
  return v !== "" ? v : undefined;
}

/** Rewrite any loopback origin with a stale port to the published local URL. */
export async function replaceStaleLoopbackOriginsInDb(
  configDir: string,
  config: LoadedConfig["config"],
  targetUrl: string,
): Promise<number> {
  let u: URL;
  try {
    u = new URL(targetUrl);
  } catch {
    return 0;
  }
  if (!isLoopbackHost(u.hostname)) return 0;

  const httpTarget = normalizeLoopbackSiteUrl(targetUrl);
  if (!httpTarget) return 0;

  let httpsTarget: string | undefined;
  if (u.protocol === "https:") {
    httpsTarget = httpTarget.replace(/^http:/, "https:");
  }

  let total = 0;
  const jobs: Array<[string, string]> = [
    ["#http://localhost:[0-9]+#", httpTarget],
    ["#http://127\\.0\\.0\\.1:[0-9]+#", httpTarget.replace("localhost", "127.0.0.1")],
  ];
  if (httpsTarget) {
    jobs.push(["#https://localhost:[0-9]+#", httpsTarget]);
    jobs.push(["#https://127\\.0\\.0\\.1:[0-9]+#", httpsTarget.replace("localhost", "127.0.0.1")]);
  }

  for (const [pattern, replacement] of jobs) {
    try {
      total += await wpLocalSearchReplaceRegex(configDir, config, pattern, replacement);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logInfo(`replaceStaleLoopbackOriginsInDb: ${pattern} skipped: ${msg}`);
    }
  }

  return total;
}

/**
 * After `wp-dev up`, align WordPress `home` / `siteurl` and DB content with the published local URL.
 */
export async function syncLocalWordPressUrls(loaded: LoadedConfig): Promise<SyncLocalUrlsResult> {
  const { site: targetUrl, warnings: publishWarnings } = getPublishedLocalAccess(loaded);
  const warnings = [...publishWarnings];

  if (!normalizeLoopbackSiteUrl(targetUrl)) {
    return { changed: false, to: targetUrl, dbReplacements: 0, warnings };
  }

  const { configDir, config } = loaded;
  if (!(await isLocalWpInstalled(configDir, config))) {
    return { changed: false, to: targetUrl, dbReplacements: 0, warnings };
  }

  const home = await wpLocalGetOption(configDir, config, "home");
  const siteurl = await wpLocalGetOption(configDir, config, "siteurl");
  const targetBase = targetUrl.replace(/\/$/, "");
  const normTarget = normalizeLoopbackSiteUrl(targetUrl)!;

  const optionsNeedSync =
    (home != null && shouldSyncLocalWordPressUrl(home, targetUrl)) ||
    (siteurl != null && shouldSyncLocalWordPressUrl(siteurl, targetUrl));

  const oldPrimary = home ?? siteurl;
  let changed = false;
  let dbReplacements = 0;

  try {
    if (optionsNeedSync) {
      await wpLocalForceSiteUrls(configDir, config, targetBase);
      changed = true;

      for (const old of collectLoopbackUrlVariants(home, siteurl)) {
        const normOld = normalizeLoopbackSiteUrl(old);
        if (!normOld || normOld === normTarget) continue;
        try {
          await wpLocalSearchReplace(configDir, config, old.replace(/\/$/, ""), targetBase);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          warnings.push(`search-replace ${old} -> ${targetBase} skipped: ${msg}`);
          logInfo(`syncLocalWordPressUrls: ${msg}`);
        }
      }
    }

    dbReplacements = await replaceStaleLoopbackOriginsInDb(configDir, config, targetUrl);
    if (dbReplacements > 0) {
      changed = true;
    }

    if (changed) {
      const flush = await wpLocalRaw(configDir, config, ["cache", "flush"]);
      if (flush.exitCode !== 0) {
        logInfo(`syncLocalWordPressUrls: cache flush skipped: ${flush.stderr || flush.stdout}`);
      }
      logInfo(
        `syncLocalWordPressUrls: target ${targetBase}` +
          (optionsNeedSync && oldPrimary ? ` (options were ${oldPrimary})` : "") +
          (dbReplacements > 0 ? `; ${dbReplacements} DB URL replacements` : ""),
      );
    }

    return {
      changed,
      from: optionsNeedSync ? oldPrimary : undefined,
      to: targetBase,
      dbReplacements,
      warnings,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(msg);
    return { changed: false, to: targetBase, dbReplacements, warnings };
  }
}
