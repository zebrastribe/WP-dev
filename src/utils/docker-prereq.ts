import { execaSync } from "execa";

/** Ensures Docker engine and Compose v2 are available (same rules as `npm run check`). */
export function assertDockerReady(): void {
  try {
    execaSync("docker", ["version"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "Docker is not installed or the daemon is not running. Start Docker, then run `wp-dev up` again.",
    );
  }
  try {
    execaSync("docker", ["compose", "version"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "Docker Compose v2 is required. Install the `docker compose` plugin and try again.",
    );
  }
}
