/**
 * Repository source for one WordPress component.
 * WordPress.org updates stay in site-update.ts. This module never runs git
 * and never treats a branch name as universal.
 */

export type RepoProviderId = "github" | "bitbucket";
export type RepoEnv = "dev" | "staging" | "production";
export type RepoComponentTarget = "core" | "plugin" | "theme";

export type RepoRef = {
  provider: RepoProviderId;
  owner: string;
  name: string;
};

export type EnvBinding = {
  provider: RepoProviderId;
  owner: string;
  name: string;
  branch: string;
  subdirectory: string;
  deployedSha: string | null;
};

export type ComponentRepoConfig = {
  target: RepoComponentTarget;
  slug: string;
  dev?: EnvBinding;
  staging?: EnvBinding;
  production?: EnvBinding;
};

export type BranchInfo = { name: string; sha: string };

export type RepoSnapshot = {
  ref: RepoRef;
  isPrivate: boolean;
  defaultBranch: string;
  branches: BranchInfo[];
};

export type BranchStatus =
  | { state: "not_configured" }
  | { state: "branch_gone"; branch: string }
  | { state: "up_to_date"; branch: string; sha: string }
  | { state: "update_available"; branch: string; from: string | null; to: string }
  | { state: "unknown_remote" };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA = /^[0-9a-f]{7,40}$/i;

export function assertRepoName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!NAME.test(trimmed)) {
    throw new Error(`${label} is not a repository name.`);
  }
  return trimmed;
}

export function assertBranchName(value: string): string {
  const branch = value.trim();
  if (
    branch.length < 1 ||
    branch.length > 250 ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.includes("//") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
  ) {
    throw new Error("That branch name cannot be used.");
  }
  return branch;
}

/** Empty string means the repository root. */
export function assertSubdirectory(value: string): string {
  const path = value.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (path === "" || path === ".") return "";
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("The component folder must stay inside the repository.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)) {
    throw new Error("The component folder contains characters that cannot be used.");
  }
  return path;
}

export function assertCommitSha(value: string): string {
  const sha = value.trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error("The repository did not return a commit id.");
  return sha;
}

export function parseRepositoryUrl(input: string): RepoRef {
  const raw = input.trim();
  if (!raw || /[\s"'`<>]/.test(raw)) {
    throw new Error("Enter the repository address from GitHub or Bitbucket.");
  }
  const scp = /^(?:git@)?(github\.com|bitbucket\.org):([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(raw);
  if (scp) {
    const provider = scp[1]!.toLowerCase() === "github.com" ? "github" : "bitbucket";
    return {
      provider,
      owner: assertRepoName(scp[2]!, "Account"),
      name: assertRepoName(scp[3]!, "Repository"),
    };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter the repository address from GitHub or Bitbucket.");
  }
  if (url.username || url.password) {
    throw new Error("Don't put a token in the repository address.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Use the https address of the repository.");
  }
  const host = url.hostname.toLowerCase();
  const provider: RepoProviderId | null =
    host === "github.com" || host === "www.github.com"
      ? "github"
      : host === "bitbucket.org" || host === "www.bitbucket.org"
        ? "bitbucket"
        : null;
  if (!provider) {
    throw new Error("Only GitHub and Bitbucket repositories can be connected.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("Use the repository address, not a file or branch link.");
  }
  const name = parts[1]!.replace(/\.git$/i, "");
  return {
    provider,
    owner: assertRepoName(parts[0]!, "Account"),
    name: assertRepoName(name, "Repository"),
  };
}

export function componentSlug(target: RepoComponentTarget, slug: string): string {
  if (target === "core") return "";
  const trimmed = slug.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(trimmed) || trimmed.toLowerCase() === "all") {
    throw new Error("Choose one plugin or theme.");
  }
  return trimmed;
}

export function componentInstallRel(target: RepoComponentTarget, slug: string): string {
  const name = componentSlug(target, slug);
  if (target === "plugin") return `wp-content/plugins/${name}`;
  if (target === "theme") return `wp-content/themes/${name}`;
  return "";
}

export function bindingFor(config: ComponentRepoConfig, env: RepoEnv): EnvBinding | undefined {
  return config[env];
}

export function branchStatus(binding: EnvBinding | undefined, branches: BranchInfo[]): BranchStatus {
  if (!binding?.branch) return { state: "not_configured" };
  const branch = assertBranchName(binding.branch);
  const found = branches.find((row) => row.name === branch);
  if (!found) return { state: "branch_gone", branch };
  const to = assertCommitSha(found.sha);
  const from = binding.deployedSha ? assertCommitSha(binding.deployedSha) : null;
  if (from && from === to) return { state: "up_to_date", branch, sha: to };
  return { state: "update_available", branch, from, to };
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join("[redacted]");
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function authHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "wp-dev",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function plainFailure(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error("Could not open this repository. Check the access token.");
  }
  if (status === 404) return new Error("Repository not found.");
  if (status === 429) return new Error("The repository host asked us to wait. Try again in a minute.");
  return new Error("Could not reach the repository.");
}

function assertAllowedApi(url: string, provider: RepoProviderId, owner: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (provider === "github") {
    const prefix = `/repos/${owner}/${name}/`;
    if (host !== "api.github.com" || !path.startsWith(prefix)) {
      throw new Error("The repository host returned an address that cannot be used.");
    }
    return parsed;
  }
  const prefix = `/2.0/repositories/${owner}/${name}/`;
  if (host !== "api.bitbucket.org" || !path.startsWith(prefix)) {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  return parsed;
}

function githubNext(link: string | null, owner: string, name: string): string | null {
  if (!link) return null;
  const part = link.split(",").map((item) => item.trim()).find((item) => item.endsWith('rel="next"'));
  const match = part ? /^<([^>]+)>/.exec(part) : null;
  if (!match) return null;
  return assertAllowedApi(match[1]!, "github", owner, name).toString();
}

export async function loadRepoSnapshot(
  ref: RepoRef,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<RepoSnapshot> {
  const headers = authHeaders(token);
  if (ref.provider === "bitbucket") headers.Accept = "application/json";
  if (ref.provider === "github") {
    const repoUrl = `https://api.github.com/repos/${ref.owner}/${ref.name}`;
    const repoRes = await fetchImpl(repoUrl, { headers });
    if (!repoRes.ok) throw plainFailure(repoRes.status);
    const repo = (await repoRes.json()) as { default_branch?: unknown; private?: unknown };
    if (typeof repo.default_branch !== "string" || repo.default_branch.trim() === "") {
      throw new Error("This repository has no default branch.");
    }
    const defaultBranch = assertBranchName(repo.default_branch);
    const branches: BranchInfo[] = [];
    let next: string | null = `https://api.github.com/repos/${ref.owner}/${ref.name}/branches?per_page=100`;
    for (let page = 0; page < 10 && next; page += 1) {
      const res = await fetchImpl(next, { headers });
      if (!res.ok) throw plainFailure(res.status);
      const body = (await res.json()) as { name?: unknown; commit?: { sha?: unknown } }[];
      if (!Array.isArray(body)) throw new Error("Could not read branches.");
      for (const row of body) {
        if (typeof row.name !== "string" || typeof row.commit?.sha !== "string") continue;
        branches.push({ name: assertBranchName(row.name), sha: assertCommitSha(row.commit.sha) });
      }
      next = githubNext(res.headers.get("link"), ref.owner, ref.name);
    }
    return {
      ref,
      isPrivate: repo.private === true,
      defaultBranch,
      branches,
    };
  }

  const repoUrl = `https://api.bitbucket.org/2.0/repositories/${ref.owner}/${ref.name}`;
  const repoRes = await fetchImpl(repoUrl, { headers });
  if (!repoRes.ok) throw plainFailure(repoRes.status);
  const repo = (await repoRes.json()) as {
    is_private?: unknown;
    mainbranch?: { name?: unknown };
  };
  if (typeof repo.mainbranch?.name !== "string" || repo.mainbranch.name.trim() === "") {
    throw new Error("This repository has no default branch.");
  }
  const defaultBranch = assertBranchName(repo.mainbranch.name);
  const branches: BranchInfo[] = [];
  let next: string | null =
    `https://api.bitbucket.org/2.0/repositories/${ref.owner}/${ref.name}/refs/branches?pagelen=100`;
  for (let page = 0; page < 10 && next; page += 1) {
    const res = await fetchImpl(next, { headers });
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as {
      next?: unknown;
      values?: { name?: unknown; target?: { hash?: unknown } }[];
    };
    for (const row of body.values ?? []) {
      if (typeof row.name !== "string" || typeof row.target?.hash !== "string") continue;
      branches.push({ name: assertBranchName(row.name), sha: assertCommitSha(row.target.hash) });
    }
    next = typeof body.next === "string" && body.next
      ? assertAllowedApi(body.next, "bitbucket", ref.owner, ref.name).toString()
      : null;
  }
  return {
    ref,
    isPrivate: repo.is_private === true,
    defaultBranch,
    branches,
  };
}

export function archiveRequest(ref: RepoRef, sha: string, token: string | undefined): {
  url: string;
  headers: Record<string, string>;
} {
  const commit = assertCommitSha(sha);
  const headers = authHeaders(token);
  if (ref.provider === "github") {
    return {
      url: `https://api.github.com/repos/${ref.owner}/${ref.name}/zipball/${commit}`,
      headers,
    };
  }
  headers.Accept = "application/json";
  return {
    url: `https://bitbucket.org/${ref.owner}/${ref.name}/get/${commit}.zip`,
    headers,
  };
}

function headerValue(source: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "im").exec(source);
  return match ? match[1]!.trim() : null;
}

function under(subdirectory: string, relative: string): boolean {
  if (!subdirectory) return !relative.includes("..");
  return relative === subdirectory || relative.startsWith(`${subdirectory}/`);
}

function relativeToComponent(subdirectory: string, relative: string): string {
  if (!subdirectory) return relative;
  return relative.slice(subdirectory.length + 1);
}

/**
 * Confirm the archive actually contains the plugin, theme, or core being deployed.
 * `files` keys are paths relative to the archive root.
 */
export function verifyComponentFiles(
  files: Record<string, string>,
  target: RepoComponentTarget,
  slug: string,
  subdirectory: string,
): { ok: true; label: string } | { ok: false; reason: string } {
  const folder = assertSubdirectory(subdirectory);
  const entries = Object.entries(files).filter(([path]) => under(folder, path.replace(/\\/g, "/")));
  if (entries.length === 0) {
    return { ok: false, reason: "The selected folder is not in this repository." };
  }
  if (target === "plugin") {
    const name = componentSlug("plugin", slug);
    const php = entries.filter(([path]) => {
      const rel = relativeToComponent(folder, path);
      return rel === `${name}.php` || (rel.endsWith(".php") && !rel.includes("/"));
    });
    for (const [, source] of php) {
      const label = headerValue(source, "Plugin Name");
      if (label) return { ok: true, label };
    }
    return { ok: false, reason: "That folder is not a WordPress plugin." };
  }
  if (target === "theme") {
    const style = entries.find(([path]) => relativeToComponent(folder, path) === "style.css");
    const label = style ? headerValue(style[1], "Theme Name") : null;
    if (!label) return { ok: false, reason: "That folder is not a WordPress theme." };
    return { ok: true, label };
  }
  const version = entries.find(([path]) => relativeToComponent(folder, path) === "wp-includes/version.php");
  if (!version || !version[1].includes("$wp_version")) {
    return { ok: false, reason: "That folder is not a WordPress core tree." };
  }
  return { ok: true, label: "WordPress" };
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Install a zip that is already on the server. The script has no URL and no token.
 * Core replaces wp-admin, wp-includes, and root PHP files, and leaves wp-config.php
 * and wp-content untouched.
 */
export function buildRepoInstallScript(input: {
  wpPath: string;
  zipPath: string;
  target: RepoComponentTarget;
  slug: string;
  subdirectory: string;
}): string {
  const wp = input.wpPath.replace(/\/$/, "");
  if (!wp.startsWith("/") || wp.includes("..")) {
    throw new Error("Refusing repository deploy: WordPress path must be absolute.");
  }
  if (!input.zipPath.startsWith("/tmp/wpdev-repo-") || input.zipPath.includes("..")) {
    throw new Error("Refusing repository deploy: archive path is not a temporary file.");
  }
  const folder = assertSubdirectory(input.subdirectory);
  const install = componentInstallRel(input.target, input.slug);
  const lines = [
    "set -euo pipefail",
    `WP=${posixQuote(wp)}`,
    `ZIP=${posixQuote(input.zipPath)}`,
    'test -f "$ZIP"',
    'WORK=$(mktemp -d /tmp/wpdev-repo-work-XXXXXX)',
    'trap \'rm -rf "$WORK"\' EXIT',
    'unzip -q "$ZIP" -d "$WORK/raw"',
    'TOP=$(find "$WORK/raw" -mindepth 1 -maxdepth 1 -type d | head -n 1)',
    'test -n "$TOP"',
    'mkdir -p "$WORK/extracted"',
    'cp -a "$TOP"/. "$WORK/extracted"/',
    `SRC="$WORK/extracted${folder ? `/${folder}` : ""}"`,
    "DONE=0",
    'mkdir -p "$WORK/previous"',
    "restore_previous() {",
    '  if [ "$DONE" = 1 ]; then rm -rf "$WORK"; return; fi',
  ];
  if (input.target === "core") {
    lines.push(
      '  if [ -d "$WORK/previous/wp-admin" ]; then rm -rf "$WP/wp-admin"; cp -a "$WORK/previous/wp-admin" "$WP/wp-admin"; fi',
      '  if [ -d "$WORK/previous/wp-includes" ]; then rm -rf "$WP/wp-includes"; cp -a "$WORK/previous/wp-includes" "$WP/wp-includes"; fi',
    );
  } else {
    lines.push(
      `  if [ -d "$WORK/previous/component" ]; then rm -rf "$WP/${install}"; mkdir -p "$WP/${install}"; cp -a "$WORK/previous/component"/. "$WP/${install}/"; fi`,
    );
  }
  lines.push(
    '  rm -rf "$WORK"',
    "}",
    "trap restore_previous EXIT",
  );
  if (input.target === "core") {
    lines.push(
      'test -f "$SRC/wp-includes/version.php"',
      'mkdir -p "$WP"',
      'if [ -d "$WP/wp-admin" ]; then cp -a "$WP/wp-admin" "$WORK/previous/wp-admin"; fi',
      'if [ -d "$WP/wp-includes" ]; then cp -a "$WP/wp-includes" "$WORK/previous/wp-includes"; fi',
      'rm -rf "$WP/wp-admin" "$WP/wp-includes"',
      'cp -a "$SRC/wp-admin" "$WP/wp-admin"',
      'cp -a "$SRC/wp-includes" "$WP/wp-includes"',
      `find "$SRC" -maxdepth 1 -type f -name '*.php' ! -name 'wp-config.php' -exec cp -a {} "$WP/" \\;`,
    );
  } else {
    const marker = input.target === "plugin" ? "*.php" : "style.css";
    lines.push(
      'test -d "$SRC"',
      `find "$SRC" -maxdepth 1 -name ${posixQuote(marker)} | grep -q .`,
      `mkdir -p "$WP/${install}"`,
      `if [ -d "$WP/${install}" ]; then cp -a "$WP/${install}" "$WORK/previous/component"; fi`,
      `find "$WP/${install}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      `cp -a "$SRC"/. "$WP/${install}/"`,
      `test -d "$WP/${install}"`,
    );
  }
  lines.push("DONE=1", "echo WPDEV_REPO_INSTALL_OK");
  return lines.join("\n");
}
