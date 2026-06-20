import { describe, expect, it } from "vitest";
import {
  composePortsMatchEnv,
  isPortOwnedByCompose,
  type ComposePublishedPorts,
} from "../src/utils/compose-published-ports.js";

describe("compose-published-ports", () => {
  const owned: ComposePublishedPorts = {
    wp: 8894,
    terminal: 7698,
    runner: 7699,
    all: new Set([8894, 7698, 7699]),
  };

  it("detects ports owned by this compose project", () => {
    expect(isPortOwnedByCompose(8894, owned)).toBe(true);
    expect(isPortOwnedByCompose(8888, owned)).toBe(false);
  });

  it("matches env when running stack publishes configured ports", () => {
    expect(
      composePortsMatchEnv(owned, {
        WP_PORT: 8894,
        WP_HTTPS_PORT: 8443,
        WPDEV_TERMINAL_PORT: 7698,
        WPDEV_TERMINAL_RUNNER_PORT: 7699,
        WPDEV_HOST_RUNNER_PORT: 7697,
      }),
    ).toBe(true);
  });

  it("does not match when env drifted from running containers", () => {
    expect(
      composePortsMatchEnv(owned, {
        WP_PORT: 8895,
        WP_HTTPS_PORT: 8443,
        WPDEV_TERMINAL_PORT: 7698,
        WPDEV_TERMINAL_RUNNER_PORT: 7699,
        WPDEV_HOST_RUNNER_PORT: 7697,
      }),
    ).toBe(false);
  });
});
