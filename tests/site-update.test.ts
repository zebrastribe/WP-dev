import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSshPrivateKey } from "../packages/sync-engine/src/ssh-private-key.js";
import {
  assertSelectionAvailable,
  assertSingleSiteRoot,
  buildPhpProbeScript,
  buildSiteUpdateScript,
  buildUpdateCheckScript,
  evaluatePathSafety,
  parsePhpProbe,
  parseSiteUpdate,
  parseUpdateCheckOutput,
  phpControlFromProbe,
} from "../packages/sync-engine/src/index.js";

describe("site update contract", () => {
  it("builds a one-slug plugin command on the given root only", () => {
    const script = buildSiteUpdateScript("/var/www/live", {
      target: "plugin",
      slug: "akismet",
    });
    expect(script).toBe("wp --path='/var/www/live' plugin update 'akismet'");
    expect(script).not.toContain("/var/www/other");
  });

  it("refuses updating every plugin", () => {
    expect(() => parseSiteUpdate({ target: "plugin", slug: "all" })).toThrow(/not all/);
    expect(() => parseSiteUpdate({ target: "theme", slug: "../other" })).toThrow(/not a single/);
  });

  it("refuses a parent path before any update command", () => {
    const report = evaluatePathSafety({
      hasWpConfig: false,
      childWpConfigCount: 2,
      toolingMarkers: [],
      pathLabel: "/var/www",
      envLabel: "production",
    });
    expect(() => assertSingleSiteRoot(report, "/var/www")).toThrow(/Refusing site update/);
  });

  it("writes PHP only through the selected root’s environment variables", () => {
    const script = buildSiteUpdateScript("/var/www/live", { target: "php", version: "8.3" });
    expect(script.startsWith("WPDEV_UPDATE_PATH='/var/www/live' WPDEV_UPDATE_VERSION='8.3' php -r ")).toBe(
      true,
    );
    expect(script).not.toContain("/var/www/other");
    expect(script).toContain(".php-version");
    expect(script).toContain("hosting panel");
  });

  it("offers a PHP change only when the folder already has a selector", () => {
    const script = buildPhpProbeScript("/var/www/live");
    expect(script).toContain("WPDEV_PHP_BEGIN");
    expect(script).not.toContain("file_put_contents");
    expect(phpControlFromProbe({ reported: "8.2.30", dotFile: true, htaccessHandler: false }).selectable).toBe(true);
    expect(phpControlFromProbe({ reported: "8.1.2", dotFile: false, htaccessHandler: false }).kind).toBe("panel");
    const parsed = parsePhpProbe(
      ["WPDEV_PHP_BEGIN", "8.3.1", "WPDEV_PHP_DOT", "no", "WPDEV_PHP_HT", "yes", "WPDEV_PHP_END"].join("\n"),
    );
    expect(parsed.kind).toBe("selector");
    expect(parsed.version).toBe("8.3");
  });

  it("rejects git as a site update target", () => {
    expect(() => parseSiteUpdate({ target: "git" })).toThrow(/check, php_show, apply, php/);
    expect(parseSiteUpdate({ target: "php_show" })).toEqual({ target: "php_show" });
  });

  it("lists nothing when wp-cli is missing", () => {
    const report = parseUpdateCheckOutput(
      ["WPDEV_UPDATE_SECTION wp", "1", "WPDEV_UPDATE_BODY", "", "WPDEV_UPDATE_SECTION_END"].join(
        "\n",
      ),
    );
    expect(report.possible).toBe(false);
    expect(report.plugins).toEqual([]);
    expect(report.themes).toEqual([]);
    expect(report.core.available).toBeNull();
  });

  it("shows only the components WordPress.org reported", () => {
    const transcript = [
      "WPDEV_UPDATE_SECTION wp",
      "0",
      "WPDEV_UPDATE_BODY",
      "/usr/bin/wp",
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION installed",
      "0",
      "WPDEV_UPDATE_BODY",
      "",
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION version",
      "0",
      "WPDEV_UPDATE_BODY",
      "6.6.2",
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION writable",
      "0",
      "WPDEV_UPDATE_BODY",
      "yes",
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION core",
      "0",
      "WPDEV_UPDATE_BODY",
      '[{"version":"6.7"}]',
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION plugins",
      "0",
      "WPDEV_UPDATE_BODY",
      '[{"name":"akismet","title":"Akismet","version":"5.3","update_version":"5.4"}]',
      "WPDEV_UPDATE_SECTION_END",
      "WPDEV_UPDATE_SECTION themes",
      "0",
      "WPDEV_UPDATE_BODY",
      "[]",
      "WPDEV_UPDATE_SECTION_END",
    ].join("\n");
    const report = parseUpdateCheckOutput(transcript);
    expect(report.possible).toBe(true);
    expect(report.core).toEqual({ current: "6.6.2", available: "6.7" });
    expect(report.plugins.map((row) => row.slug)).toEqual(["akismet"]);
    expect(report.themes).toEqual([]);
    expect(() =>
      assertSelectionAvailable(report, [{ target: "plugin", slug: "hello" }]),
    ).toThrow(/not in the available updates/);
    expect(() => assertSelectionAvailable(report, [{ target: "plugin", slug: "akismet" }])).not.toThrow();
  });

  it("checks only the given WordPress root", () => {
    const script = buildUpdateCheckScript("/var/www/live");
    expect(script).toContain("wp --path='/var/www/live' core check-update");
    expect(script).toContain("plugin list --update=available");
    expect(script).toContain("theme list --update=available");
    expect(script).not.toContain("/var/www/other");
  });

  it("hides available rows when the site cannot write updates", () => {
    const report = parseUpdateCheckOutput(
      [
        "WPDEV_UPDATE_SECTION wp",
        "0",
        "WPDEV_UPDATE_BODY",
        "/usr/bin/wp",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION installed",
        "0",
        "WPDEV_UPDATE_BODY",
        "",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION writable",
        "0",
        "WPDEV_UPDATE_BODY",
        "no",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION plugins",
        "0",
        "WPDEV_UPDATE_BODY",
        '[{"name":"akismet","version":"5.3","update_version":"5.4"}]',
        "WPDEV_UPDATE_SECTION_END",
      ].join("\n"),
    );
    expect(report.possible).toBe(false);
    expect(report.plugins).toEqual([]);
    expect(report.reason).toMatch(/not writable/);
  });

  it("drops an unsafe slug and still lists the real plugin", () => {
    const report = parseUpdateCheckOutput(
      [
        "WPDEV_UPDATE_SECTION wp",
        "0",
        "WPDEV_UPDATE_BODY",
        "/usr/bin/wp",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION installed",
        "0",
        "WPDEV_UPDATE_BODY",
        "",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION writable",
        "0",
        "WPDEV_UPDATE_BODY",
        "yes",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION core",
        "1",
        "WPDEV_UPDATE_BODY",
        "",
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION plugins",
        "0",
        "WPDEV_UPDATE_BODY",
        '[{"name":"all","version":"1","update_version":"2"},{"name":"akismet","version":"5.3","update_version":"5.4"}]',
        "WPDEV_UPDATE_SECTION_END",
        "WPDEV_UPDATE_SECTION themes",
        "0",
        "WPDEV_UPDATE_BODY",
        "[]",
        "WPDEV_UPDATE_SECTION_END",
      ].join("\n"),
    );
    expect(report.possible).toBe(true);
    expect(report.core.available).toBeNull();
    expect(report.plugins.map((row) => row.slug)).toEqual(["akismet"]);
  });

  it("refuses an apply with no selection and a relative path", () => {
    expect(() => parseSiteUpdate({ target: "apply", items: [] })).toThrow(/at least one/);
    expect(() => buildUpdateCheckScript("relative/path")).toThrow(/absolute/);
  });

  it("executes the check script with a fake wp and parses that root only", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-fake-wp-"));
    try {
      const wp = join(dir, "wp");
      writeFileSync(
        wp,
        `#!/bin/bash
args="$*"
case "$args" in
  *"/var/www/other"*) echo "touched sibling" >&2; exit 9 ;;
esac
if [[ "$args" == *"core is-installed"* ]]; then exit 0; fi
if [[ "$args" == *"core version"* ]]; then echo 6.6.2; exit 0; fi
if [[ "$args" == *"is_writable"* ]]; then echo yes; exit 0; fi
if [[ "$args" == *"check-update"* ]]; then echo '[]'; exit 1; fi
if [[ "$args" == *"plugin list"* ]]; then
  echo '[{"name":"akismet","title":"Akismet","version":"5.3","update_version":"5.4"},{"name":"all","version":"1","update_version":"2"}]'
  exit 0
fi
if [[ "$args" == *"theme list"* ]]; then
  echo '[{"name":"twentytwentyfive","title":"Twenty Twenty-Five","version":"1.0","update_version":"1.1"}]'
  exit 0
fi
echo "unexpected $args" >&2
exit 8
`,
      );
      chmodSync(wp, 0o755);
      const stdout = execFileSync("bash", ["-lc", buildUpdateCheckScript("/var/www/live")], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      });
      const report = parseUpdateCheckOutput(stdout);
      expect(report.possible).toBe(true);
      expect(report.core).toEqual({ current: "6.6.2", available: null });
      expect(report.plugins.map((row) => row.slug)).toEqual(["akismet"]);
      expect(report.themes.map((row) => row.slug)).toEqual(["twentytwentyfive"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ssh private key file", () => {
  it("restores the trailing newline OpenSSH needs to load the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-ssh-key-"));
    try {
      const keyPath = join(dir, "id");
      execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-C", "wpdev-test"], {
        stdio: "ignore",
      });
      const raw = readFileSync(keyPath);
      const stripped = raw[raw.length - 1] === 10 ? raw.subarray(0, raw.length - 1) : raw;
      const broken = join(dir, "stripped");
      writeFileSync(broken, stripped, { mode: 0o600 });
      expect(() => execFileSync("ssh-keygen", ["-y", "-f", broken], { stdio: "pipe" })).toThrow(
        /libcrypto/,
      );
      const fixed = join(dir, "fixed");
      writeFileSync(fixed, normalizeSshPrivateKey(stripped), { mode: 0o600 });
      const pub = execFileSync("ssh-keygen", ["-y", "-f", fixed], { encoding: "utf8" });
      expect(pub.startsWith("ssh-ed25519 ")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
