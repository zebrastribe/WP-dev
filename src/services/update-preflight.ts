import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

/** Gitignored paths users should back up before risky git operations. */
export const UPDATE_BACKUP_HINTS = [
  "wp-dev.config.json",
  "docker/.env",
  "wordpress/ (themes, plugins, uploads — preserved by update, but back up before pull/merge)",
];

export type UpdatePreflight = {
  isGitRepo: boolean;
  upstream: string | null;
  dirtyCount: number;
  untrackedCount: number;
  commitsAhead: number | null;
  commitsBehind: number | null;
  forkWorkflowRecommended: boolean;
  warnings: string[];
};

async function gitQuiet(
  configDir: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  const r = await execa("git", ["-c", `safe.directory=${configDir}`, ...args], {
    cwd: configDir,
    reject: false,
  });
  return { ok: r.exitCode === 0, stdout: (r.stdout || "").trim() };
}

export async function collectUpdatePreflight(configDir: string): Promise<UpdatePreflight> {
  const warnings: string[] = [];

  if (!existsSync(join(configDir, ".git"))) {
    return {
      isGitRepo: false,
      upstream: null,
      dirtyCount: 0,
      untrackedCount: 0,
      commitsAhead: null,
      commitsBehind: null,
      forkWorkflowRecommended: false,
      warnings: ["Not a git repository — git pull will fail unless you use --skip-pull."],
    };
  }

  let dirtyCount = 0;
  let untrackedCount = 0;
  const status = await gitQuiet(configDir, ["status", "--porcelain"]);
  if (status.ok) {
    for (const line of status.stdout.split("\n").filter(Boolean)) {
      if (line.startsWith("??")) untrackedCount += 1;
      else dirtyCount += 1;
    }
  }

  const upstreamResult = await gitQuiet(configDir, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const upstream = upstreamResult.ok && upstreamResult.stdout ? upstreamResult.stdout : null;

  let commitsAhead: number | null = null;
  let commitsBehind: number | null = null;

  if (upstream) {
    const ahead = await gitQuiet(configDir, ["rev-list", "--count", `${upstream}..HEAD`]);
    const behind = await gitQuiet(configDir, ["rev-list", "--count", `HEAD..${upstream}`]);
    if (ahead.ok) commitsAhead = Number(ahead.stdout) || 0;
    if (behind.ok) commitsBehind = Number(behind.stdout) || 0;
  } else {
    warnings.push(
      "No upstream tracking branch — run: git fetch origin && git branch -u origin/main",
    );
  }

  if (dirtyCount > 0) {
    warnings.push(
      `${dirtyCount} tracked file(s) have local changes. --autostash helps, but forks should commit to a safety branch first.`,
    );
  }
  if (untrackedCount > 0) {
    warnings.push(
      `${untrackedCount} untracked file(s). Never run git clean -fd during an update — it deletes gitignored secrets.`,
    );
  }
  if (commitsAhead != null && commitsAhead > 0) {
    warnings.push(
      `${commitsAhead} commit(s) ahead of ${upstream ?? "upstream"} — wp-dev update does not merge fork commits. See README “Fork updates”.`,
    );
  }
  if (commitsBehind != null && commitsBehind > 0) {
    warnings.push(`${commitsBehind} commit(s) behind ${upstream ?? "upstream"} — update will pull these.`);
  }

  const forkWorkflowRecommended =
    (commitsAhead != null && commitsAhead > 0) || dirtyCount > 0;

  return {
    isGitRepo: true,
    upstream,
    dirtyCount,
    untrackedCount,
    commitsAhead,
    commitsBehind,
    forkWorkflowRecommended,
    warnings,
  };
}

export function formatUpdatePreflight(preflight: UpdatePreflight): string {
  const lines: string[] = ["Pre-flight check:"];
  if (!preflight.isGitRepo) {
    lines.push("  • Not a git repository");
  } else {
    lines.push(`  • Upstream: ${preflight.upstream ?? "(none set)"}`);
    if (preflight.commitsBehind != null) {
      lines.push(`  • Behind upstream: ${preflight.commitsBehind} commit(s)`);
    }
    if (preflight.commitsAhead != null) {
      lines.push(`  • Ahead of upstream: ${preflight.commitsAhead} commit(s)`);
    }
    lines.push(`  • Dirty tracked files: ${preflight.dirtyCount}`);
    lines.push(`  • Untracked files: ${preflight.untrackedCount}`);
  }
  if (preflight.forkWorkflowRecommended) {
    lines.push("");
    lines.push(
      "  Fork detected — use a safety branch + merge (README “Fork updates”), not update alone.",
    );
  }
  if (preflight.warnings.length > 0) {
    lines.push("");
    for (const w of preflight.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }
  lines.push("");
  lines.push(`  Back up: ${UPDATE_BACKUP_HINTS.join("; ")}.`);
  return lines.join("\n");
}
