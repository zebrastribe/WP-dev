import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = join(import.meta.dirname, "..", "docker", "docker-compose.yml");

describe("docker-compose runner ports", () => {
  it("terminal runner listens on fixed container port 7682 (host port is publish-only)", () => {
    const content = readFileSync(composePath, "utf8");
    expect(content).toContain(
      '${WPDEV_TERMINAL_RUNNER_PORT:-7682}:7682',
    );
    expect(content).toMatch(/WPDEV_TERMINAL_RUNNER_PORT:\s*"7682"/);
  });

  it("wordpress can reach host runner via host.docker.internal", () => {
    const content = readFileSync(composePath, "utf8");
    expect(content).toContain("host.docker.internal:host-gateway");
  });
});
