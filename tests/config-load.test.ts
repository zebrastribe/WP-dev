import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectUnknownConfigKeys, formatConfigFileError, loadConfig } from "../src/config/load.js";
import { wpDevConfigSchema } from "../src/config/schema.js";
import { ZodError } from "zod";

const minimalValid = {
  project: "demo",
  local: {
    url: "http://localhost:8894",
    path: "./docker",
    wpRoot: "./wordpress",
  },
  staging: {
    host: "staging.example.com",
    user: "deploy",
    path: "/var/www/staging",
    url: "https://staging.example.com",
  },
  production: {
    host: "example.com",
    user: "deploy",
    path: "/var/www/html",
    url: "https://example.com",
  },
};

describe("loadConfig errors", () => {
  it("names the file for truncated JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-cfg-"));
    const path = join(dir, "wp-dev.config.json");
    writeFileSync(path, '{"project":"demo"');
    expect(() => loadConfig(dir)).toThrow(/Invalid JSON in .*wp-dev\.config\.json/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("formats zod issues instead of a raw array", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-cfg-"));
    const path = join(dir, "wp-dev.config.json");
    writeFileSync(path, JSON.stringify({ ...minimalValid, staging: { ...minimalValid.staging, host: "" } }));
    expect(() => loadConfig(dir)).toThrow(/Invalid config in .*wp-dev\.config\.json/);
    expect(() => loadConfig(dir)).toThrow(/staging\.host/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects staging.host with spaces or shell metacharacters", () => {
    expect(() =>
      wpDevConfigSchema.parse({
        ...minimalValid,
        staging: { ...minimalValid.staging, host: "bad host;rm" },
      }),
    ).toThrow(/hostname.*alphanumeric|whitespace|metacharacters/i);
    expect(() =>
      wpDevConfigSchema.parse({
        ...minimalValid,
        staging: { ...minimalValid.staging, host: "ok.example.com" },
      }),
    ).not.toThrow();
  });

  it("formatConfigFileError includes path for SyntaxError", () => {
    const err = formatConfigFileError("/tmp/wp-dev.config.json", new SyntaxError("Unexpected end"));
    expect(err.message).toContain("/tmp/wp-dev.config.json");
    expect(err.message).toContain("Invalid JSON");
  });

  it("formatConfigFileError formats ZodError paths", () => {
    let zodErr: ZodError | undefined;
    try {
      wpDevConfigSchema.parse({});
    } catch (e) {
      zodErr = e as ZodError;
    }
    expect(zodErr).toBeInstanceOf(ZodError);
    const err = formatConfigFileError("/x/wp-dev.config.json", zodErr!);
    expect(err.message).toContain("Invalid config in /x/wp-dev.config.json");
    expect(err.message).toMatch(/project:/);
  });
});

describe("detectUnknownConfigKeys", () => {
  it("detects unknown top-level keys", () => {
    const unknown = detectUnknownConfigKeys({ project: "x", unknownKey: "y" });
    expect(unknown).toContain("unknownKey");
  });

  it("allows $schema at top level", () => {
    const unknown = detectUnknownConfigKeys({ "$schema": "./schema.json", project: "x" });
    expect(unknown).not.toContain("$schema");
  });

  it("detects unknown nested keys in staging", () => {
    const unknown = detectUnknownConfigKeys({
      project: "x",
      staging: { host: "s", identityfile: "~/.ssh/id" }, // lowercase typo
    });
    expect(unknown).toContain("staging.identityfile");
  });

  it("detects unknown nested keys in production.db", () => {
    const unknown = detectUnknownConfigKeys({
      project: "x",
      production: {
        host: "p",
        db: { host: "localhost", nme: "wp" }, // typo: nme instead of name
      },
    });
    expect(unknown).toContain("production.db.nme");
  });

  it("warns about unknown keys when loading config", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-cfg-unknown-"));
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writeFileSync(
        join(dir, "wp-dev.config.json"),
        JSON.stringify({
          ...minimalValid,
          typoKey: "value",
          staging: { ...minimalValid.staging, identityfile: "~/.ssh/id" },
        }),
      );
      loadConfig(dir);
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("typoKey");
      expect(output).toContain("staging.identityfile");
      expect(output).toContain("possible typo");
    } finally {
      stderrSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
