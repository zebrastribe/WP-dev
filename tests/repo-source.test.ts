import { describe, expect, it } from "vitest";
import {
  archiveRequest,
  bindingAfterBranchChange,
  branchStatus,
  buildRepoInstallScript,
  formatAuthHeader,
  loadRepoSnapshot,
  parseRepositoryUrl,
  redactSecret,
  resolveArchiveRedirect,
  verifyComponentFiles,
  type EnvBinding,
} from "../packages/sync-engine/src/index.js";

function jsonResponse(body: unknown, status = 200, link: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "link" ? link : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("repository source", () => {
  it("reads GitHub and Bitbucket addresses and refuses other hosts", () => {
    expect(parseRepositoryUrl("https://github.com/acme/plugin.git")).toEqual({
      provider: "github",
      owner: "acme",
      name: "plugin",
    });
    expect(parseRepositoryUrl("git@bitbucket.org:acme/theme.git")).toEqual({
      provider: "bitbucket",
      owner: "acme",
      name: "theme",
    });
    expect(() => parseRepositoryUrl("https://gitlab.com/acme/plugin")).toThrow(/GitHub and Bitbucket/);
    expect(() => parseRepositoryUrl("https://user:token@github.com/acme/plugin")).toThrow(/token/);
    expect(() => parseRepositoryUrl("http://github.com/acme/plugin")).toThrow(/https/);
    expect(() => parseRepositoryUrl("https://github.com/acme/plugin/tree/main")).toThrow(/not a file or branch/);
  });

  it("discovers whatever branches the repository returns", async () => {
    const calls: string[] = [];
    const snapshot = await loadRepoSnapshot(
      { provider: "github", owner: "acme", name: "plugin" },
      "secret-token-value",
      async (url) => {
        calls.push(url);
        if (url.endsWith("/repos/acme/plugin")) {
          return jsonResponse({ default_branch: "release-2026", private: true });
        }
        return jsonResponse([
          { name: "release-2026", commit: { sha: "a".repeat(40) } },
          { name: "customer-beta", commit: { sha: "b".repeat(40) } },
        ]);
      },
    );
    expect(snapshot.defaultBranch).toBe("release-2026");
    expect(snapshot.branches.map((row) => row.name)).toEqual(["release-2026", "customer-beta"]);
    expect(snapshot.isPrivate).toBe(true);
    expect(calls.every((url) => url.startsWith("https://api.github.com/"))).toBe(true);
  });

  it("follows a GitHub page when the owner casing differs", async () => {
    const seen: string[] = [];
    const snapshot = await loadRepoSnapshot(
      { provider: "github", owner: "Acme", name: "Plugin" },
      "user:app-password",
      async (url, init) => {
        seen.push(url);
        expect(init?.headers?.Authorization).toBe(
          `Basic ${Buffer.from("user:app-password").toString("base64")}`,
        );
        if (!url.includes("/branches")) {
          return jsonResponse({ default_branch: "main", private: true });
        }
        if (url.includes("page=2")) {
          return jsonResponse([{ name: "develop", commit: { sha: "b".repeat(40) } }]);
        }
        return jsonResponse(
          [{ name: "main", commit: { sha: "a".repeat(40) } }],
          200,
          '<https://api.github.com/repos/ACME/PLUGIN/branches?page=2>; rel="next"',
        );
      },
    );
    expect(seen.some((url) => url.includes("page=2"))).toBe(true);
    expect(snapshot.branches.map((row) => row.name)).toEqual(["main", "develop"]);
  });

  it("allows Bitbucket's archive bucket and keeps the GitHub token on codeload", () => {
    const s3 = resolveArchiveRedirect(
      "https://bitbucket.org/acme/theme/get/abc.zip",
      "https://bb-tarballs.s3.amazonaws.com/acme/theme?X-Amz-Signature=abc",
    );
    expect(s3.stripAuthorization).toBe(true);
    expect(s3.url).toContain("bb-tarballs.s3.amazonaws.com");
    const regional = resolveArchiveRedirect(
      "https://api.bitbucket.org/2.0/repositories/acme/theme/src",
      "https://bb-tarballs.s3.eu-central-1.amazonaws.com/file.zip",
    );
    expect(regional.stripAuthorization).toBe(true);
    const github = resolveArchiveRedirect(
      "https://api.github.com/repos/acme/plugin/zipball/abc",
      "https://codeload.github.com/acme/plugin/legacy.zip/abc",
    );
    expect(github.stripAuthorization).toBe(false);
    expect(() =>
      resolveArchiveRedirect("https://bitbucket.org/acme/theme/get/abc.zip", "https://evil.amazonaws.com/file.zip"),
    ).toThrow(/cannot be used/);
    expect(() =>
      resolveArchiveRedirect("https://api.github.com/repos/acme/plugin/zipball/abc", "https://bb-tarballs.s3.amazonaws.com/file.zip"),
    ).toThrow(/cannot be used/);
  });

  it("clears the deployed commit when the branch changes", () => {
    const previous: EnvBinding = {
      provider: "github",
      owner: "acme",
      name: "plugin",
      branch: "main",
      subdirectory: "",
      deployedSha: "a".repeat(40),
    };
    expect(bindingAfterBranchChange(previous, { ...previous, branch: "develop" }).deployedSha).toBeNull();
    expect(bindingAfterBranchChange(previous, { ...previous }).deployedSha).toBe("a".repeat(40));
  });

  it("reads Bitbucket pages and refuses a next link on another host", async () => {
    await expect(
      loadRepoSnapshot({ provider: "bitbucket", owner: "acme", name: "theme" }, undefined, async (url) => {
        if (url.includes("/refs/branches")) {
          return jsonResponse({
            values: [{ name: "live", target: { hash: "c".repeat(40) } }],
            next: "https://evil.example/steal",
          });
        }
        return jsonResponse({ is_private: false, mainbranch: { name: "live" } });
      }),
    ).rejects.toThrow(/cannot be used/);
  });

  it("does not put the token in an authentication error", async () => {
    const token = "github_pat_secret_value";
    await expect(
      loadRepoSnapshot({ provider: "github", owner: "acme", name: "missing" }, token, async () =>
        jsonResponse({ message: token }, 404),
      ),
    ).rejects.toThrow(/Repository not found/);
  });

  it("compares one environment without assuming the others", () => {
    const branches = [
      { name: "feature-a", sha: "a".repeat(40) },
      { name: "stable", sha: "b".repeat(40) },
    ];
    const dev: EnvBinding = {
      provider: "github",
      owner: "acme",
      name: "plugin",
      branch: "feature-a",
      subdirectory: "plugins/acme",
      deployedSha: "c".repeat(40),
    };
    const production: EnvBinding = { ...dev, branch: "stable", deployedSha: "b".repeat(40) };
    expect(branchStatus(dev, branches).state).toBe("update_available");
    expect(branchStatus(production, branches).state).toBe("up_to_date");
    expect(branchStatus({ ...dev, branch: "renamed" }, branches).state).toBe("branch_gone");
    expect(branchStatus(undefined, branches).state).toBe("not_configured");
  });

  it("checks plugin, theme, and core identity", () => {
    expect(
      verifyComponentFiles(
        { "plugins/acme/acme.php": "<?php\nPlugin Name: Acme\n" },
        "plugin",
        "acme",
        "plugins/acme",
      ).ok,
    ).toBe(true);
    expect(
      verifyComponentFiles({ "style.css": "/*\nTheme Name: Other\n*/" }, "plugin", "acme", "").ok,
    ).toBe(false);
    expect(
      verifyComponentFiles({ "style.css": "/*\nTheme Name: Acme\n*/" }, "theme", "acme", "").ok,
    ).toBe(true);
    expect(
      verifyComponentFiles(
        { "wp-includes/version.php": "<?php\n$wp_version = '7.1';\n" },
        "core",
        "",
        "",
      ).ok,
    ).toBe(true);
    expect(verifyComponentFiles({ "readme.txt": "hello" }, "core", "", "").ok).toBe(false);
  });

  it("builds an archive request and an install script without the token or other plugins", () => {
    const token = "bitbucket-secret-token";
    const archive = archiveRequest(
      { provider: "bitbucket", owner: "acme", name: "theme" },
      "d".repeat(40),
      token,
    );
    expect(archive.url.startsWith("https://bitbucket.org/acme/theme/get/")).toBe(true);
    expect(archive.headers.Authorization).toBe(`Bearer ${token}`);
    expect(formatAuthHeader("jane@example.com:app-password")).toBe(
      `Basic ${Buffer.from("jane@example.com:app-password").toString("base64")}`,
    );
    expect(formatAuthHeader("workspace-token")).toBe("Bearer workspace-token");
    expect(archiveRequest(
      { provider: "github", owner: "acme", name: "plugin" },
      "a".repeat(40),
      "ghp_private_token",
    ).headers.Authorization).toBe("Bearer ghp_private_token");
    const script = buildRepoInstallScript({
      wpPath: "/var/www/stri.be/public_html",
      zipPath: "/tmp/wpdev-repo-abc.zip",
      target: "plugin",
      slug: "acme",
      subdirectory: "plugins/acme",
    });
    expect(script).toContain("wp-content/plugins/acme");
    expect(script).not.toContain("wp-content/plugins/other");
    expect(script).not.toContain(token);
    expect(script).toContain("WPDEV_REPO_INSTALL_OK");
    const backup = script.indexOf(
      'cp -a "$WP/wp-content/plugins/acme" "$WORK/previous/component"',
    );
    const wipe = script.indexOf('find "$WP/wp-content/plugins/acme" -mindepth 1');
    expect(backup).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(backup);
    expect(redactSecret(`failed ${token}`, token)).toBe("failed [redacted]");
    expect(() =>
      buildRepoInstallScript({
        wpPath: "/var/www/html",
        zipPath: "/tmp/evil.zip",
        target: "theme",
        slug: "acme",
        subdirectory: "../outside",
      }),
    ).toThrow(/inside the repository|temporary file/);
  });
});
