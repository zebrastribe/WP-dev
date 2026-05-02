import { describe, expect, it } from "vitest";
import { wpflowConfigSchema } from "../src/config/schema.js";

describe("wpflowConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const parsed = wpflowConfigSchema.parse({
      project: "test",
      local: {
        url: "http://localhost:8888",
        path: "./docker",
        wpRoot: "./wordpress",
      },
      staging: {
        host: "s.test",
        user: "deploy",
        path: "/var/www/html",
        url: "https://s.test",
      },
      production: {
        host: "p.test",
        user: "deploy",
        path: "/var/www/html",
        url: "https://p.test",
      },
    });
    expect(parsed.local.composeService).toBe("wpcli");
    expect(parsed.local.composeFile).toBe("docker-compose.yml");
  });

  it("rejects invalid local url", () => {
    expect(() =>
      wpflowConfigSchema.parse({
        project: "x",
        local: {
          url: "not-a-url",
          path: "./docker",
          wpRoot: "./wordpress",
        },
        staging: {
          host: "s",
          user: "u",
          path: "/p",
          url: "https://s",
        },
        production: {
          host: "p",
          user: "u",
          path: "/p",
          url: "https://p",
        },
      }),
    ).toThrow();
  });
});
