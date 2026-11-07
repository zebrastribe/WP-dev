import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectSiteUrlFromSqlDump,
  detectTablePrefixFromSqlDump,
  phpVersionRequiredByWpCli,
  readSqlDumpHints,
} from "../src/utils/sql-dump-prefix.js";

describe("detectTablePrefixFromSqlDump", () => {
  it("reads default wp_ prefix", () => {
    const sql = "CREATE TABLE `wp_options` (\n  `option_id` bigint\n);";
    expect(detectTablePrefixFromSqlDump(sql)).toBe("wp_");
  });

  it("reads custom prefix", () => {
    const sql =
      "CREATE TABLE IF NOT EXISTS `clk1dac7b42cf_options` (\n`option_id` bigint\n);";
    expect(detectTablePrefixFromSqlDump(sql)).toBe("clk1dac7b42cf_");
  });

  it("returns undefined when no options table", () => {
    expect(detectTablePrefixFromSqlDump("SELECT 1;")).toBeUndefined();
  });
});

describe("detectSiteUrlFromSqlDump", () => {
  it("reads a plain siteurl", () => {
    const sql = "INSERT INTO `wp_options` VALUES (2,'siteurl','https://stri.be','on');";
    expect(detectSiteUrlFromSqlDump(sql)).toBe("https://stri.be");
  });

  it("unescapes dumped slashes", () => {
    const sql = "INSERT INTO `wp_options` VALUES (2,'siteurl','https:\\/\\/stri.be','on');";
    expect(detectSiteUrlFromSqlDump(sql)).toBe("https://stri.be");
  });

  it("returns undefined when siteurl is missing", () => {
    expect(detectSiteUrlFromSqlDump("CREATE TABLE `wp_options` (id int);")).toBeUndefined();
  });
});

describe("phpVersionRequiredByWpCli", () => {
  it("reads the composer platform requirement", () => {
    const text =
      'Composer dependencies require a PHP version ">= 8.3.0". You are running 8.2.35.';
    expect(phpVersionRequiredByWpCli(text)).toBe("8.3");
  });

  it("returns undefined for other failures", () => {
    expect(phpVersionRequiredByWpCli("connection refused")).toBeUndefined();
  });
});

describe("readSqlDumpHints", () => {
  it("reads prefix and site URL from the start of a large dump", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-sql-"));
    const path = join(dir, "db.sql");
    const head = "CREATE TABLE `wp_options` (id int);\nINSERT INTO `wp_options` VALUES (2,'siteurl','https://stri.be','on');\n";
    writeFileSync(path, head + "x".repeat(2_000_000));
    await expect(readSqlDumpHints(path)).resolves.toEqual({
      prefix: "wp_",
      siteUrl: "https://stri.be",
    });
  });
});
