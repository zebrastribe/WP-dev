import { describe, expect, it } from "vitest";
import {
  conflictedPortKeys,
  formatPortConflicts,
} from "../src/supervisor/port-manager.js";

describe("port-manager", () => {
  it("formatPortConflicts includes strict mode guidance", () => {
    const msg = formatPortConflicts([
      {
        port: 8888,
        key: "WP_PORT",
        ownerPid: 42,
        ownerCommand: "docker-proxy",
        ownedByCompose: false,
        ownedByRegistry: false,
      },
    ]);
    expect(msg).toContain("strict mode");
    expect(msg).toContain("WP_PORT=8888");
    expect(msg).toContain("--reclaim-ports");
    expect(msg).toContain("--relocate-ports");
  });

  it("conflictedPortKeys only lists conflicted keys (relocate keeps free ports)", () => {
    const keys = conflictedPortKeys([
      {
        port: 8888,
        key: "WP_PORT",
        ownerPid: 42,
        ownedByCompose: false,
        ownedByRegistry: false,
      },
    ]);
    expect(keys.has("WP_PORT")).toBe(true);
    expect(keys.has("WP_HTTPS_PORT")).toBe(false);
    expect(keys.has("WPDEV_TERMINAL_PORT")).toBe(false);
    expect(keys.size).toBe(1);
  });
});
