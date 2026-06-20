import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteEnvConfig } from "../src/config/schema.js";

const execaMock = vi.hoisted(() => vi.fn());

vi.mock("execa", () => ({
  execa: execaMock,
}));

import { rsyncPullFromPath, rsyncPushToPath } from "../src/services/rsync.js";

const remote: RemoteEnvConfig = {
  host: "example.com",
  user: "deploy",
  path: "/var/www/html",
  url: "https://example.com",
  port: 22,
  identityFile: "/home/me/.ssh/id_ed25519",
};

describe("rsync theme path helpers", () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it("rsyncPushToPath succeeds on first attempt", async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stderr: "" });
    await rsyncPushToPath(remote, "/local/theme", "/var/www/html/wp-content/themes/slug", {
      dryRun: true,
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    const [, args] = execaMock.mock.calls[0] as [string, string[]];
    expect(args).toContain("--dry-run");
    expect(args.some((a) => a.includes("deploy@example.com"))).toBe(true);
  });

  it("rsyncPushToPath retries with relative path on permission denied", async () => {
    execaMock
      .mockResolvedValueOnce({
        exitCode: 23,
        stderr: "recv_generator: mkdir foo failed: Permission denied",
      })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    await rsyncPushToPath(remote, "/local/theme", "/staging/wp-content/themes/slug", {
      dryRun: false,
    });
    expect(execaMock).toHaveBeenCalledTimes(2);
  });

  it("rsyncPullFromPath succeeds on first attempt", async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stderr: "" });
    await rsyncPullFromPath(remote, "/var/www/html/wp-content/themes/slug", "/local/theme", {
      dryRun: false,
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    const [, args] = execaMock.mock.calls[0] as [string, string[]];
    expect(args.at(-1)).toMatch(/\/local\/theme\/$/);
  });

  it("rsyncPullFromPath throws with hint on hard failure", async () => {
    execaMock.mockResolvedValue({ exitCode: 23, stderr: "Permission denied" });
    await expect(
      rsyncPullFromPath(remote, "/missing/theme", "/local/theme", { dryRun: false }),
    ).rejects.toThrow(/fix-permissions/);
  });
});
