import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildBaseConnectOptions,
  buildSshConnectAttempts,
  expandHomePath,
} from "../src/utils/ssh-helpers.js";

const connectMock = vi.fn();
const disposeMock = vi.fn();

vi.mock("node-ssh", () => ({
  NodeSSH: class {
    connect = connectMock;
    execCommand = vi.fn();
    getFile = vi.fn();
    putFile = vi.fn();
    dispose = disposeMock;
  },
}));

describe("ssh-helpers", () => {
  const remote = {
    host: "linux.example.com",
    user: "deploy",
    path: "/var/www/html",
    url: "https://linux.example.com",
    port: 22,
    identityFile: "~/custom_key",
  };

  it("expandHomePath expands tilde paths", () => {
    expect(expandHomePath("~/keys/id")).toContain("/keys/id");
    expect(expandHomePath("/abs/path")).toBe("/abs/path");
  });

  it("buildBaseConnectOptions sets host user and port", () => {
    const opts = buildBaseConnectOptions(remote);
    expect(opts.host).toBe("linux.example.com");
    expect(opts.username).toBe("deploy");
    expect(opts.port).toBe(22);
    expect(opts.tryKeyboard).toBe(false);
  });

  it("buildSshConnectAttempts includes agent when SSH_AUTH_SOCK set", () => {
    const prev = process.env.SSH_AUTH_SOCK;
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
    const attempts = buildSshConnectAttempts(remote);
    expect(attempts.some((a) => a.label.includes("ssh-agent"))).toBe(true);
    process.env.SSH_AUTH_SOCK = prev;
  });
});

describe("connectSsh", () => {
  beforeEach(() => {
    connectMock.mockReset();
    connectMock.mockResolvedValue(undefined);
  });

  it("connects on first successful attempt", async () => {
    const { connectSsh } = await import("../src/services/ssh.js");
    const session = await connectSsh({
      host: "h",
      user: "u",
      path: "/p",
      url: "https://h",
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(typeof session.exec).toBe("function");
    session.dispose();
  });

  it("throws aggregated errors when all attempts fail", async () => {
    connectMock.mockRejectedValue(new Error("auth failed"));
    const { connectSsh } = await import("../src/services/ssh.js");
    await expect(
      connectSsh({ host: "h", user: "u", path: "/p", url: "https://h" }),
    ).rejects.toThrow(/SSH connection failed/);
  });
});
