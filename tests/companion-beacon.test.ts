import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPANION_BEACON_PORT,
  listLiveCompanions,
  startCompanionBeacon,
  writeCompanionRecord,
  type CompanionRecord,
} from "../src/companion/beacon.js";

const dirs: string[] = [];

function useTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wpdev-companion-"));
  dirs.push(dir);
  process.env.WPDEV_COMPANION_DIR = dir;
  process.env.WPDEV_COMPANION_BEACON = "off";
  return dir;
}

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

afterEach(() => {
  delete process.env.WPDEV_COMPANION_DIR;
  delete process.env.WPDEV_COMPANION_BEACON_PORT;
});

describe("companion beacon", () => {
  it("keeps the cloud beacon port stable", () => {
    expect(COMPANION_BEACON_PORT).toBe(8870);
  });

  it("lists a project only while its WordPress port answers", async () => {
    useTempDir();
    const listener = await listen();
    const record: CompanionRecord = {
      project: "local-evi",
      configDir: "/tmp/local-evi",
      site: `http://127.0.0.1:${listener.port}`,
      admin: `http://127.0.0.1:${listener.port}/admin/`,
      wpPort: listener.port,
      updatedAt: "2026-11-05T00:00:00.000Z",
    };
    writeCompanionRecord(record);
    const live = await listLiveCompanions();
    expect(live.map((row) => row.project)).toEqual(["local-evi"]);
    await listener.close();
    expect(await listLiveCompanions()).toEqual([]);
  });

  it("serves live companions on a loopback beacon", async () => {
    useTempDir();
    const listener = await listen();
    writeCompanionRecord({
      project: "local-evi",
      configDir: "/tmp/local-evi",
      site: `http://127.0.0.1:${listener.port}`,
      admin: `http://127.0.0.1:${listener.port}/admin/`,
      wpPort: listener.port,
      updatedAt: "2026-11-05T00:00:00.000Z",
    });
    const server = await startCompanionBeacon(0);
    const address = server.address();
    const beaconPort = address && typeof address === "object" ? address.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${beaconPort}/health`);
      const body = (await res.json()) as { product: string; companions: CompanionRecord[] };
      expect(body.product).toBe("wp-dev");
      expect(body.companions).toHaveLength(1);
      expect(body.companions[0]?.admin).toBe(`http://127.0.0.1:${listener.port}/admin/`);
      expect(body.companions[0]).not.toHaveProperty("configDir");
      const denied = await fetch(`http://127.0.0.1:${beaconPort}/health`, {
        headers: { origin: "https://evil.example" },
      });
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
      const allowed = await fetch(`http://127.0.0.1:${beaconPort}/health`, {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:5174",
          "access-control-request-private-network": "true",
        },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5174");
      expect(allowed.headers.get("access-control-allow-private-network")).toBe("true");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await listener.close();
    }
  });
});
