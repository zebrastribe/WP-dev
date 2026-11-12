import { describe, expect, it } from "vitest";
import { SHOW_HOST_PUBKEY } from "../docker/show-host-pubkey.mjs";

describe("show host public key", () => {
  it("reads the public key and does not create one", () => {
    expect(SHOW_HOST_PUBKEY).toContain('cat "$HOME/.ssh/id_ed25519.pub"');
    expect(SHOW_HOST_PUBKEY).not.toContain("ssh-keygen -q");
    const keygenLines = SHOW_HOST_PUBKEY.split("\n").filter((line) => line.includes("ssh-keygen"));
    expect(keygenLines.length).toBeGreaterThan(0);
    expect(keygenLines.every((line) => line.includes("echo"))).toBe(true);
    expect(SHOW_HOST_PUBKEY).toContain("exit 1");
  });
});
