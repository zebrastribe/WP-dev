import { describe, expect, it } from "vitest";
import {
  posixShellArg,
  posixShellQuote,
  remoteRmFile,
} from "../src/utils/shell-quote.js";
import { sanitizeCliError } from "../src/utils/sanitize-cli-error.js";
import { assertValidSqlDump } from "../src/utils/sql-dump-validate.js";
import { pickChildEnv } from "../src/utils/child-env.js";

describe("posixShellQuote", () => {
  it("quotes paths with spaces and single quotes", () => {
    expect(posixShellQuote("/tmp/a b")).toBe("'/tmp/a b'");
    expect(posixShellQuote("/tmp/o'reilly")).toBe("'/tmp/o'\\''reilly'");
  });

  it("posixShellArg quotes values with shell metacharacters", () => {
    expect(posixShellArg("--dbpass=secret")).toBe("'--dbpass=secret'");
    expect(posixShellArg("plain")).toBe("plain");
  });

  it("remoteRmFile uses quoted paths", () => {
    expect(remoteRmFile("/tmp/foo bar")).toBe("rm -f '/tmp/foo bar'");
  });
});

describe("sanitizeCliError", () => {
  it("redacts db credentials from error text", () => {
    const raw = "Error: wp config create --dbpass=s3cret! --dbuser=admin failed";
    expect(sanitizeCliError(raw)).not.toContain("s3cret");
    expect(sanitizeCliError(raw)).toContain("[redacted]");
  });
});

describe("assertValidSqlDump", () => {
  const validDump =
    "-- MySQL dump 10.13\n" +
    "CREATE TABLE `wp_options` (\n`option_id` bigint\n);\n" +
    "INSERT INTO `wp_options` VALUES (1,'siteurl','http://localhost');\n".repeat(8);

  it("accepts a normal mysqldump export", () => {
    expect(() => assertValidSqlDump(validDump)).not.toThrow();
  });

  it("rejects tiny dumps", () => {
    expect(() => assertValidSqlDump("CREATE TABLE x;")).toThrow(/too small/i);
  });
});

describe("pickChildEnv", () => {
  it("passes PATH and custom keys without spreading full process.env", () => {
    const prev = process.env.PATH;
    process.env.PATH = "/bin";
    process.env.WPDEV_SECRET_SHOULD_NOT_LEAK = "nope";
    try {
      const env = pickChildEnv({ WPDEV_PROJECT: "demo" });
      expect(env.PATH).toBe("/bin");
      expect(env.WPDEV_PROJECT).toBe("demo");
      expect(env.WPDEV_SECRET_SHOULD_NOT_LEAK).toBeUndefined();
    } finally {
      process.env.PATH = prev;
      delete process.env.WPDEV_SECRET_SHOULD_NOT_LEAK;
    }
  });
});
