/**
 * Prerequisite check for wp-dev (no npm dependencies).
 * Run from: npm run setup | npm run check
 */
import { execSync } from "node:child_process";

function run(label, cmd) {
  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? "";
    console.error(`\nwp-dev: ${label} failed.\nCommand: ${cmd}`);
    if (stderr.trim()) console.error(stderr.trim());
    console.error(
      "\nFix: install Docker Desktop or Docker Engine, start the daemon, and install Docker Compose v2 (plugin: `docker compose`).\nThen run: npm run setup\n",
    );
    process.exit(1);
  }
}

console.error("wp-dev: checking Docker…");
run("Docker CLI / daemon", "docker version");
run("Docker Compose v2", "docker compose version");
console.error("wp-dev: Docker OK.\n");
