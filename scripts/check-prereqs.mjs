/**
 * Host prerequisites for wp-dev (Docker + tools used by pull/push).
 * Run from: npm run check | npm run setup
 */
import { execSync } from "node:child_process";
import { platform } from "node:os";

const isMac = platform() === "darwin";

function run(label, cmd) {
  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? "";
    console.error(`\nwp-dev: ${label} failed.\nCommand: ${cmd}`);
    if (stderr.trim()) console.error(stderr.trim());
    return false;
  }
}

function macHint(title, lines) {
  if (!isMac) return;
  console.error(`\nmacOS — ${title}:`);
  for (const line of lines) console.error(`  ${line}`);
}

console.error(`wp-dev: checking prerequisites (${isMac ? "macOS" : platform()})…`);

let ok = true;
if (!run("Docker CLI / daemon", "docker version")) {
  macHint("Docker Desktop", [
    "Install Docker Desktop from https://www.docker.com/products/docker-desktop/",
    "Open Docker Desktop and wait until it says “Running”, then retry.",
  ]);
  ok = false;
}
if (!run("Docker Compose v2", "docker compose version")) {
  macHint("Docker Compose", [
    "Docker Desktop includes Compose v2. Update Docker Desktop if this check fails.",
  ]);
  ok = false;
}
if (!run("SSH client", "ssh -V")) {
  macHint("SSH", ["SSH is built into macOS. If missing, run: xcode-select --install"]);
  ok = false;
}
if (!run("rsync", "rsync --version")) {
  macHint("rsync", ["rsync is included on macOS. If missing, install Xcode Command Line Tools."]);
  ok = false;
}

if (!ok) {
  console.error("\nFix the items above, then run: npm run setup\n");
  process.exit(1);
}

let phpOk = run("PHP CLI (optional, for admin API lint)", "php -v");
if (!phpOk) {
  console.error(
    "\nwp-dev: PHP CLI not found (optional).\n" +
      "  Required for: php -l on docs/admin/public/*.php, local PHP debugging.\n" +
      "  Install: sudo apt install php-cli   (Debian/Ubuntu)\n" +
      "  CI runs PHP lint; core CLI + sync work without PHP.\n",
  );
}

console.error("wp-dev: prerequisites OK.\n");
if (isMac) {
  console.error(
    "macOS tip: keep the project folder under your home directory so Docker Desktop can bind-mount wordpress/.\n",
  );
}
