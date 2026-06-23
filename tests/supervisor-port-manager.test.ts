import { describe, expect, it } from "vitest";
import { formatPortConflicts } from "../src/supervisor/port-manager.js";

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
});
