import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  resolveHostHome,
  resolveHostIdentity,
  resolveHostProjectRoot,
} from "../src/utils/host-paths.js";

describe("host-paths", () => {
  it("resolveHostProjectRoot uses configDir on the host", () => {
    const dir = resolve("/home/dev/projects/example");
    expect(resolveHostProjectRoot(dir)).toBe(dir);
  });

  it("resolveHostProjectRoot prefers WPDEV_HOST_PROJECT_ROOT", () => {
    const prev = process.env.WPDEV_HOST_PROJECT_ROOT;
    process.env.WPDEV_HOST_PROJECT_ROOT = "/host/project";
    try {
      expect(resolveHostProjectRoot("/workspace")).toBe("/host/project");
    } finally {
      if (prev === undefined) delete process.env.WPDEV_HOST_PROJECT_ROOT;
      else process.env.WPDEV_HOST_PROJECT_ROOT = prev;
    }
  });

  it("resolveHostHome prefers WPDEV_HOST_HOME", () => {
    const prev = process.env.WPDEV_HOST_HOME;
    process.env.WPDEV_HOST_HOME = "/home/dev";
    try {
      expect(resolveHostHome()).toBe("/home/dev");
    } finally {
      if (prev === undefined) delete process.env.WPDEV_HOST_HOME;
      else process.env.WPDEV_HOST_HOME = prev;
    }
  });

  it("resolveHostIdentity prefers WPDEV_HOST_UID over process uid", () => {
    const prevU = process.env.WPDEV_HOST_UID;
    const prevG = process.env.WPDEV_HOST_GID;
    process.env.WPDEV_HOST_UID = "1000";
    process.env.WPDEV_HOST_GID = "1000";
    try {
      expect(resolveHostIdentity("/workspace")).toEqual({ uid: 1000, gid: 1000 });
    } finally {
      if (prevU === undefined) delete process.env.WPDEV_HOST_UID;
      else process.env.WPDEV_HOST_UID = prevU;
      if (prevG === undefined) delete process.env.WPDEV_HOST_GID;
      else process.env.WPDEV_HOST_GID = prevG;
    }
  });
});
