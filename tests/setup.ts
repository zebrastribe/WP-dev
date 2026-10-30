import { mkdtempSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll } from "vitest";

let testHome: string;
const originalHome = process.env.HOME;

beforeAll(() => {
  const rawTemp = mkdtempSync(join(tmpdir(), "wp-dev-test-home-"));
  testHome = realpathSync(rawTemp);
  mkdirSync(join(testHome, ".ssh"), { recursive: true });
  mkdirSync(join(testHome, ".wp-dev", "backups"), { recursive: true });
  mkdirSync(join(testHome, ".wp-dev", "locks"), { recursive: true });
  process.env.HOME = testHome;
});

afterAll(() => {
  process.env.HOME = originalHome;
  if (testHome) {
    rmSync(testHome, { recursive: true, force: true });
  }
});

export { testHome };
