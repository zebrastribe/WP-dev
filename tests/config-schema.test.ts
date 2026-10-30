import { describe, expect, it } from "vitest";
import { wpDevConfigSchema } from "../src/config/schema.js";

describe("wpDevConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const parsed = wpDevConfigSchema.parse({
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

  it("accepts optional simply block", () => {
    const parsed = wpDevConfigSchema.parse({
      project: "x",
      local: {
        url: "http://localhost:8888",
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
      simply: { account: "S999999" },
    });
    expect(parsed.simply?.account).toBe("S999999");
  });

  it("accepts optional simply block with UE account format", () => {
    const parsed = wpDevConfigSchema.parse({
      project: "x",
      local: {
        url: "http://localhost:8888",
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
      simply: { account: "UE12345" },
    });
    expect(parsed.simply?.account).toBe("UE12345");
  });

  it("accepts optional local themePath and themeSlug", () => {
    const parsed = wpDevConfigSchema.parse({
      project: "x",
      local: {
        url: "http://localhost:8888",
        path: "./docker",
        wpRoot: "./wordpress",
        themePath: "./wordpress/wp-content/themes/my-theme",
        themeSlug: "my-theme",
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
    });
    expect(parsed.local.themePath).toBe("./wordpress/wp-content/themes/my-theme");
    expect(parsed.local.themeSlug).toBe("my-theme");
  });

  it("rejects invalid local url", () => {
    expect(() =>
      wpDevConfigSchema.parse({
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

  it("rejects shell metacharacters in staging.host", () => {
    const badHosts = ["evil;id", "$(id)", "a b", "-oX", "host/path", "https://x.com"];
    for (const badHost of badHosts) {
      expect(() =>
        wpDevConfigSchema.parse({
          project: "x",
          local: { url: "http://localhost:8888", path: "./docker", wpRoot: "./wordpress" },
          staging: { host: badHost, user: "u", path: "/p", url: "https://s" },
          production: { host: "p.test", user: "u", path: "/p", url: "https://p" },
        }),
      ).toThrow();
    }
  });

  it("rejects shell metacharacters in production.host", () => {
    const badHosts = ["evil;id", "$(id)", "a b", "-oX", "host/path", "https://x.com"];
    for (const badHost of badHosts) {
      expect(() =>
        wpDevConfigSchema.parse({
          project: "x",
          local: { url: "http://localhost:8888", path: "./docker", wpRoot: "./wordpress" },
          staging: { host: "s.test", user: "u", path: "/p", url: "https://s" },
          production: { host: badHost, user: "u", path: "/p", url: "https://p" },
        }),
      ).toThrow();
    }
  });
});

describe("generated JSON schema host pattern", () => {
  it("schema pattern rejects injection canaries", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "docs/admin/public/wp-dev.config.schema.json"), "utf8"),
    );
    const hostPattern = schema.definitions?.WpDevConfig?.properties?.staging?.properties?.host?.pattern;
    expect(hostPattern).toBeDefined();
    const re = new RegExp(hostPattern);
    expect(re.test("evil;id")).toBe(false);
    expect(re.test("$(id)")).toBe(false);
    expect(re.test("a b")).toBe(false);
    expect(re.test("-oX")).toBe(false);
    expect(re.test("host/path")).toBe(false);
    expect(re.test("valid-host.example.com")).toBe(true);
    expect(re.test("192.168.1.1")).toBe(true);
    expect(re.test("server01")).toBe(true);
  });
});
