import type { LoadedConfig } from "../config/load.js";
import { writeWpDevConfig } from "../config/load.js";
import {
  isLocalWpInstalled,
  wpLocalForceSiteUrls,
  wpLocalRaw,
  wpLocalSearchReplace,
} from "../services/wpcli.js";
import { getLocalUrlPortMismatch, getPublishedLocalAccess } from "./published-local-urls.js";
import { getUrlVariants } from "./url-variants.js";
import {
  siteUrlsMatchExpected,
  verifyLocalSiteUrls,
  wpLocalGetOption,
} from "./sync-verify.js";
import { logInfo } from "./logger.js";

export function isLoopbackHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

export function urlPort(u: URL): number {
  if (u.port.length > 0) return Number.parseInt(u.port, 10);
  return u.protocol === "https:" ? 443 : 80;
}

/** Strip trailing slash for stable comparisons. */
export function normalizeSiteUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function tryParseUrl(raw: string | null | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Loopback home/siteurl values that differ from the published local URL (e.g. stale port).
 */
export function collectStaleLoopbackUrls(
  home: string | null,
  siteurl: string | null,
  expectedUrl: string,
): string[] {
  const expected = normalizeSiteUrl(expectedUrl);
  const expectedParsed = tryParseUrl(expected);
  if (!expectedParsed || !isLoopbackHostname(expectedParsed.hostname)) {
    return [];
  }

  const out = new Set<string>();
  for (const raw of [home, siteurl]) {
    const u = tryParseUrl(raw);
    if (!u || !isLoopbackHostname(u.hostname)) continue;
    const norm = normalizeSiteUrl(u.toString());
    if (norm === expected) continue;
    out.add(norm);
  }
  return [...out];
}

/** URL strings to search-replace when fixing stale loopback URLs (localhost ↔ 127.0.0.1, http/https). */
export function getLoopbackReplaceCandidates(url: string): string[] {
  const out = new Set(getUrlVariants(url));
  const u = tryParseUrl(url);
  if (!u || !isLoopbackHostname(u.hostname)) {
    return [...out];
  }
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const protocol of ["http:", "https:"]) {
      const copy = new URL(u.toString());
      copy.hostname = host;
      copy.protocol = protocol;
      out.add(normalizeSiteUrl(copy.toString()));
    }
  }
  return [...out];
}

/** True when a redirect target is loopback but uses a different port than expected. */
export function loopbackRedirectUsesWrongPort(
  expectedUrl: string,
  redirectUrl: string,
): { wrong: true; expectedPort: number; gotPort: number } | { wrong: false } {
  const expected = tryParseUrl(expectedUrl);
  const redirect = tryParseUrl(redirectUrl);
  if (!expected || !redirect) return { wrong: false };
  if (!isLoopbackHostname(redirect.hostname)) return { wrong: false };
  const expectedPort = urlPort(expected);
  const gotPort = urlPort(redirect);
  if (expectedPort === gotPort) return { wrong: false };
  return { wrong: true, expectedPort, gotPort };
}

export type SyncLocalUrlsResult = {
  skipped: boolean;
  skipReason?: "not_installed" | "not_loopback";
  synced: boolean;
  expectedUrl: string;
  previousHome?: string | null;
  previousSiteurl?: string | null;
  replacedFrom?: string[];
};

/** Align wp-dev.config.json local.url with docker/.env WP_PORT when loopback ports drift. */
export function alignLocalUrlConfigToPublishedPort(loaded: LoadedConfig): boolean {
  const mismatch = getLocalUrlPortMismatch(loaded);
  if (!mismatch) return false;
  const { site } = getPublishedLocalAccess(loaded);
  if (normalizeSiteUrl(loaded.config.local.url) === normalizeSiteUrl(site)) return false;
  loaded.config.local.url = site;
  writeWpDevConfig(loaded.configDir, loaded.config);
  logInfo(`sync-local-urls: updated local.url -> ${site} (WP_PORT=${mismatch.wpPort})`);
  return true;
}

async function wpLocalCacheFlushBestEffort(
  configDir: string,
  config: LoadedConfig["config"],
): Promise<void> {
  const r = await wpLocalRaw(configDir, config, ["cache", "flush"]);
  if (r.exitCode === 0) {
    logInfo("sync-local-urls: wp cache flush OK");
  }
}

export async function syncLocalWordPressUrls(loaded: LoadedConfig): Promise<SyncLocalUrlsResult> {
  alignLocalUrlConfigToPublishedPort(loaded);

  const { site: expectedUrl } = getPublishedLocalAccess(loaded);
  const expectedParsed = tryParseUrl(expectedUrl);
  if (!expectedParsed || !isLoopbackHostname(expectedParsed.hostname)) {
    return { skipped: true, skipReason: "not_loopback", synced: false, expectedUrl };
  }

  const { configDir, config } = loaded;
  const installed = await isLocalWpInstalled(configDir, config);
  if (!installed) {
    return { skipped: true, skipReason: "not_installed", synced: false, expectedUrl };
  }

  const before = await verifyLocalSiteUrls(configDir, config, expectedUrl);
  if (before.ok) {
    return { skipped: false, synced: false, expectedUrl };
  }

  const previousHome = before.home;
  const previousSiteurl = before.siteurl;
  const staleUrls = collectStaleLoopbackUrls(previousHome, previousSiteurl, expectedUrl);
  const replacedFrom: string[] = [];

  for (const stale of staleUrls) {
    const candidates = getLoopbackReplaceCandidates(stale).filter(
      (c) => normalizeSiteUrl(c) !== normalizeSiteUrl(expectedUrl),
    );
    for (const fromUrl of candidates) {
      logInfo(`sync-local-urls: search-replace ${fromUrl} -> ${expectedUrl}`);
      await wpLocalSearchReplace(configDir, config, fromUrl, expectedUrl);
      replacedFrom.push(fromUrl);
    }
  }

  logInfo(`sync-local-urls: force option home/siteurl -> ${expectedUrl}`);
  await wpLocalForceSiteUrls(configDir, config, expectedUrl);

  try {
    await wpLocalCacheFlushBestEffort(configDir, config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`sync-local-urls: cache flush skipped (${msg})`);
  }

  const afterHome = await wpLocalGetOption(configDir, config, "home");
  const afterSiteurl = await wpLocalGetOption(configDir, config, "siteurl");
  const ok = siteUrlsMatchExpected(afterHome, afterSiteurl, expectedUrl);

  return {
    skipped: false,
    synced: ok,
    expectedUrl,
    previousHome,
    previousSiteurl,
    replacedFrom: replacedFrom.length > 0 ? [...new Set(replacedFrom)] : undefined,
  };
}
