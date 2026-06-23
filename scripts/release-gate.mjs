#!/usr/bin/env node
/**
 * Enterprise release gate — mirrors CI validation locally.
 * Run: npm run release:gate
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function step(label, cmd) {
  process.stderr.write(`\n▶ ${label}\n`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

function lintPhp(file) {
  try {
    execSync("php -v", { cwd: root, stdio: "ignore" });
  } catch {
    process.stderr.write(
      "⚠ Skipping PHP lint (php CLI not installed — install php-cli or rely on CI)\n",
    );
    return;
  }
  execSync(`php -l ${file}`, { cwd: root, stdio: "inherit" });
}

const steps = [
  ["Prerequisites", "npm run check"],
  ["Unit tests", "npm test"],
  ["Coverage", "npm run test:coverage"],
  ["Build", "npm run build"],
  ["CLI executable", "test -x dist/cli.js"],
  ["Smoke tests", "npm run test:smoke"],
];

for (const [label, cmd] of steps) {
  step(label, cmd);
}

step("PHP syntax (api.php)", "echo");
lintPhp("docs/admin/public/api.php");
lintPhp("docs/admin/public/schema-validate.inc.php");

const adminDir = join(root, "docs/admin");
if (existsSync(join(adminDir, "package.json"))) {
  step("Admin install", "npm ci --prefix docs/admin");
  step("Admin typecheck", "npm run typecheck --prefix docs/admin");
  step("Admin tests", "npm run test --prefix docs/admin");
  step("Admin build", "npm run build --prefix docs/admin");
  step("Admin WP build", "npm run build:wp --prefix docs/admin");
}

process.stderr.write("\n✅ Release gate passed.\n");
