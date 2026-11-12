import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  assertDeletionsConfirmed,
  backupIsDue,
  buildBackupManifest,
  buildRepoInstallScript,
  confirmedDeleteCommand,
  contentProfileSql,
  deployAllowed,
  driftReport,
  headerMatches,
  headerShaFromOutput,
  idempotencyDecision,
  pinnedSha,
  promotionSha,
  restoreParts,
  rsyncArgsForSync,
  scopeFingerprint,
  searchReplaceShell,
  searchReplaceWpArgs,
  updateSources,
  type ComponentRepoConfig,
} from "../packages/sync-engine/src/index.js";

const binding = {
  provider: "github" as const,
  owner: "acme",
  name: "plugin",
  branch: "release",
  subdirectory: "",
  deployedSha: "a".repeat(40),
};

const config: ComponentRepoConfig = {
  target: "plugin",
  slug: "acme",
  staging: binding,
  production: { ...binding, branch: "live", deployedSha: "b".repeat(40) },
};

describe("operation plan", () => {
  it("offers a repository update only when a repository is connected", () => {
    expect(updateSources(false)).toEqual(["package", "files"]);
    expect(updateSources(true)).toEqual(["package", "files", "repository"]);
  });

  it("builds the precise prefixed search-replace command", () => {
    expect(searchReplaceWpArgs("https://old.test", "https://new.test")).toEqual([
      "search-replace",
      "https://old.test",
      "https://new.test",
      "--precise",
      "--all-tables-with-prefix",
      "--skip-columns=guid",
    ]);
    expect(searchReplaceShell("/var/www/html", "https://old.test", "https://new.test")).toBe(
      "wp --path='/var/www/html' 'search-replace' 'https://old.test' 'https://new.test' '--precise' '--all-tables-with-prefix' '--skip-columns=guid'",
    );
  });

  it("deletes files only when the confirmed list covers the live preview", () => {
    const quiet = rsyncArgsForSync({ gitOwnedPaths: ["wp-content/plugins/acme"] });
    expect(quiet).not.toContain("--delete");
    expect(quiet).toContain("wp-content/plugins/acme");
    const copying = rsyncArgsForSync({ copyGitPaths: true, gitOwnedPaths: ["wp-content/plugins/acme"] });
    expect(copying).not.toContain("wp-content/plugins/acme");
    expect(confirmedDeleteCommand("/var/www/html", ["wp-content/uploads/old.jpg"])).toBe(
      "rm -f -- '/var/www/html/wp-content/uploads/old.jpg'",
    );
    expect(confirmedDeleteCommand("/var/www/html", ["../etc/passwd"])).toBeNull();
    expect(() => assertDeletionsConfirmed(["wp-content/uploads/old.jpg", "wp-content/uploads/extra.jpg"], ["wp-content/uploads/old.jpg"])).toThrow(
      /extra\.jpg/,
    );
    expect(() => assertDeletionsConfirmed(["wp-content/uploads/old.jpg"], ["wp-content/uploads/old.jpg"])).not.toThrow();
  });

  it("promotes the recorded staging commit and ignores the production branch tip", () => {
    expect(promotionSha(config)).toBe("a".repeat(40));
    expect(() => promotionSha({ ...config, staging: { ...binding, deployedSha: null } })).toThrow(/no recorded commit/);
  });

  it("deploys the pinned commit when the branch has moved", () => {
    expect(pinnedSha({ resolvedSha: "c".repeat(40), branchTip: "d".repeat(40) })).toBe("c".repeat(40));
    expect(pinnedSha({ branchTip: "d".repeat(40) })).toBe("d".repeat(40));
  });

  it("rejects a reused idempotency key when the plan changed", () => {
    const hash = scopeFingerprint({ b: 1, a: "x" });
    expect(hash).toBe("cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246");
    expect(scopeFingerprint({ a: "x", b: 1 })).toBe(hash);
    expect(idempotencyDecision(null, hash)).toBe("reuse");
    expect(idempotencyDecision(hash, hash)).toBe("reuse");
    expect(idempotencyDecision("f".repeat(64), hash)).toBe("conflict");
  });

  it("refuses a full restore when the backup has only a database", () => {
    const manifest = buildBackupManifest({
      environment: "staging",
      createdAt: "2026-11-12T12:00:00.000Z",
      parts: [{ kind: "database", sha256: "ab", bytes: 200 }],
    });
    expect(restoreParts(manifest, "database")).toEqual([{ kind: "database", sha256: "ab", bytes: 200 }]);
    expect(() => restoreParts(manifest, "full")).toThrow(/both the database and the files/);
  });

  it("reports drift without changing anything", () => {
    expect(driftReport({ recordedSha: "aa", tipSha: "bb", installedHash: null, expectedHash: null })).toEqual({
      commit: "behind",
      files: "unknown",
    });
    expect(headerMatches("ABC", "abc")).toBe(true);
    expect(headerShaFromOutput("ok\nWPDEV_REPO_HEADER_SHA " + "ab".repeat(32) + "\n")).toBe("ab".repeat(32));
  });

  it("keeps the content cleanup off the full database profile", () => {
    expect(contentProfileSql("wp_")).toContain("session_tokens");
    expect(contentProfileSql("wp_")).toContain("DELETE FROM wp_options");
    expect(() => contentProfileSql("wp;drop")).toThrow(/prefix/);
  });

  it("allows deploy through job.create until the environment permission exists", () => {
    expect(deployAllowed({ envPermExists: false, hasEnvPerm: false, hasJobCreate: true })).toBe(true);
    expect(deployAllowed({ envPermExists: true, hasEnvPerm: false, hasJobCreate: true })).toBe(false);
    expect(deployAllowed({ envPermExists: true, hasEnvPerm: true, hasJobCreate: false })).toBe(true);
  });

  it("waits for a different person when production approval is on", () => {
    expect(approvalDecision({ required: true, destination: "production", actorId: "a", approverId: null })).toBe("waiting");
    expect(approvalDecision({ required: true, destination: "production", actorId: "a", approverId: "a" })).toBe("self");
    expect(approvalDecision({ required: true, destination: "production", actorId: "a", approverId: "b" })).toBe("ready");
    expect(approvalDecision({ required: true, destination: "staging", actorId: "a", approverId: null })).toBe("ready");
    expect(backupIsDue(null, 24, Date.parse("2026-11-12T12:00:00.000Z"))).toBe(true);
    expect(backupIsDue("2026-11-12T11:00:00.000Z", 24, Date.parse("2026-11-12T12:00:00.000Z"))).toBe(false);
    expect(backupIsDue(null, null, 0)).toBe(false);
  });

  it("prints a header hash after the files are copied", () => {
    const script = buildRepoInstallScript({
      wpPath: "/var/www/html",
      zipPath: "/tmp/wpdev-repo-abc.zip",
      target: "theme",
      slug: "acme",
      subdirectory: "",
      headerRel: "wp-content/themes/acme/style.css",
    });
    expect(script).toContain('"$WP/wp-content/themes/acme/style.css"');
    expect(script.indexOf("WPDEV_REPO_HEADER_SHA")).toBeLessThan(script.indexOf("WPDEV_REPO_INSTALL_OK"));
  });
});
