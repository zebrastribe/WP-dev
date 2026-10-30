import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertRestoreBackupPath } from "../src/utils/restore-path.js";

describe("assertRestoreBackupPath", () => {
  const project = "lock-test-site";
  const env = "staging";
  let tempHome: string;
  let originalHome: string | undefined;
  let root: string;

  beforeAll(() => {
    // Use temp dir to avoid writing to real $HOME/.wp-dev
    tempHome = mkdtempSync(join(tmpdir(), "wp-dev-restore-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    root = join(tempHome, ".wp-dev", "backups", project, env);
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("accepts a file under ~/.wp-dev/backups/<project>/<env>/", () => {
    mkdirSync(root, { recursive: true });
    const file = join(root, "db-allowlisted.sql");
    writeFileSync(file, "-- ok\n");
    expect(assertRestoreBackupPath(project, env, file)).toBe(file);
  });

  it("refuses a file outside the project/env backup tree", () => {
    const other = mkdtempSync(join(tmpdir(), "wp-dev-restore-outside-"));
    try {
      const file = join(other, "sneaky.sql");
      writeFileSync(file, "-- no\n");
      expect(() => assertRestoreBackupPath(project, env, file)).toThrow(
        /Restore refused: file must be under/,
      );
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("refuses a backup for a different env under the same project", () => {
    const prodRoot = join(tempHome, ".wp-dev", "backups", project, "production");
    mkdirSync(prodRoot, { recursive: true });
    const file = join(prodRoot, "db-prod.sql");
    writeFileSync(file, "-- prod\n");
    expect(() => assertRestoreBackupPath(project, "staging", file)).toThrow(
      /Restore refused: file must be under/,
    );
  });

  it("refuses an in-tree symlink whose target is outside the backup tree", () => {
    mkdirSync(root, { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "wp-dev-restore-symlink-"));
    const target = join(outside, "outside.sql");
    const link = join(root, "zz-symlink-test.sql");
    try {
      writeFileSync(target, "-- outside\n");
      rmSync(link, { force: true });
      symlinkSync(target, link);
      expect(() => assertRestoreBackupPath(project, env, link)).toThrow(
        /Restore refused: file must be under/,
      );
    } finally {
      rmSync(link, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses an empty backup file", () => {
    mkdirSync(root, { recursive: true });
    const file = join(root, "db-empty.sql");
    writeFileSync(file, "");
    expect(() => assertRestoreBackupPath(project, env, file)).toThrow(
      /Restore refused: backup file is empty/,
    );
  });
});
