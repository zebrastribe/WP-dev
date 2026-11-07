import { createReadStream } from "node:fs";

/**
 * Best-effort table prefix from a mysqldump (first `*_options` table).
 */
export function detectTablePrefixFromSqlDump(sql: string): string | undefined {
  const m = sql.match(/CREATE TABLE(?: IF NOT EXISTS)? `([^`]+_options)`/i);
  if (!m) return undefined;
  const tableName = m[1];
  if (!tableName.endsWith("_options")) return undefined;
  return tableName.slice(0, -"options".length);
}

/** Best-effort home URL from a mysqldump options row. */
export function detectSiteUrlFromSqlDump(sql: string): string | undefined {
  const m = sql.match(/'siteurl'\s*,\s*'((?:https?:\\?\/\\?\/)[^'\\]+)'/i);
  if (!m) return undefined;
  const url = m[1].replace(/\\\//g, "/");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Find the table prefix and site URL without loading a multi-gigabyte dump into one string.
 * Stops once both are known. Keeps only a sliding window in memory.
 */
export async function readSqlDumpHints(path: string): Promise<{
  prefix?: string;
  siteUrl?: string;
}> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 });
  let window = "";
  let prefix: string | undefined;
  let siteUrl: string | undefined;
  try {
    for await (const chunk of stream) {
      window += chunk;
      if (!prefix) prefix = detectTablePrefixFromSqlDump(window);
      if (!siteUrl) siteUrl = detectSiteUrlFromSqlDump(window);
      if (prefix && siteUrl) {
        stream.destroy();
        break;
      }
      if (window.length > 1024 * 1024) window = window.slice(-8192);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ERR_STREAM_PREMATURE_CLOSE" && prefix && siteUrl) {
      return { prefix, siteUrl };
    }
    if (code === "ENOENT") {
      throw new Error("Local setup archive must contain db.sql plus wp-content/ or site/.");
    }
    throw err;
  }
  return { prefix, siteUrl };
}

/** WP-CLI fatal when a restored plugin needs a newer PHP than the local image. */
export function phpVersionRequiredByWpCli(text: string): string | undefined {
  const m = text.match(/PHP version ">=\s*([0-9]+\.[0-9]+)/);
  return m?.[1];
}
