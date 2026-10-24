import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { assertRestoreBackupPath } from "../src/utils/restore-path.js";

describe("assertRestoreBackupPath", () => {
  const project = "lock-test-site";
  const env = "staging";
  const root = join(homedir(), ".wp-dev", "backups", project, env);

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
    const prodRoot = join(homedir(), ".wp-dev", "backups", project, "production");
    mkdirSync(prodRoot, { recursive: true });
    const file = join(prodRoot, "db-prod.sql");
    writeFileSync(file, "-- prod\n");
    expect(() => assertRestoreBackupPath(project, "staging", file)).toThrow(
      /Restore refused: file must be under/,
    );
  });
});
