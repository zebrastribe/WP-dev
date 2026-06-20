import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  loadImportBasicAuth,
  writeImportRemoteConfig,
} from "../src/utils/import-basic-auth.js";

describe("import-basic-auth", () => {
  it("loadImportBasicAuth reads credentials from import.auth.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-import-auth-"));
    try {
      writeFileSync(
        join(dir, "import.auth.env"),
        "IMPORT_BASIC_AUTH_USER=editor\nIMPORT_BASIC_AUTH_PASSWORD=secret\n",
      );
      expect(loadImportBasicAuth(dir)).toEqual({ user: "editor", password: "secret" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadImportBasicAuth returns null when file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-import-auth-"));
    try {
      expect(loadImportBasicAuth(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeImportRemoteConfig writes htaccess and project env", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-import-dir-"));
    try {
      mkdirSync(join(dir, "api"), { recursive: true });
      writeImportRemoteConfig(dir, "timework", { user: "u", password: "p" });
      expect(readFileSync(join(dir, ".htaccess"), "utf8")).toContain("RewriteEngine On");
      expect(readFileSync(join(dir, "project.env"), "utf8")).toContain("WPDEV_PROJECT=timework");
      expect(readFileSync(join(dir, "api", "import.auth.env"), "utf8")).toContain(
        "IMPORT_BASIC_AUTH_USER=u",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
