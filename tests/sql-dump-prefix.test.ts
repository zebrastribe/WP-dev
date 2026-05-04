import { describe, expect, it } from "vitest";
import { detectTablePrefixFromSqlDump } from "../src/utils/sql-dump-prefix.js";

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
