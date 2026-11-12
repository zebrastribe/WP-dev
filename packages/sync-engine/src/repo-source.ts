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
  /** Set for a Bitbucket server. Absent for github.com and bitbucket.org. */
  origin?: string;
};

export type EnvBinding = {
  provider: RepoProviderId;
  owner: string;
  name: string;
  branch: string;
  subdirectory: string;
  deployedSha: string | null;
  /** Set when this binding is a Bitbucket server on an IP or DNS name. */
  origin?: string;
};

export type ComponentRepoConfig = {
  target: RepoComponentTarget;
  slug: string;
  dev?: EnvBinding;
  staging?: EnvBinding;
  production?: EnvBinding;
};

export type BranchInfo = { name: string; sha: string; subject?: string };

export type RepoSnapshot = {
  ref: RepoRef;
  isPrivate: boolean;
  defaultBranch: string;
  /** True when more branches exist than the 1000 that were read. */
  truncated: boolean;
  branches: BranchInfo[];
};

export type BranchStatus =
  | { state: "not_configured" }
  | { state: "branch_gone"; branch: string }
  | { state: "up_to_date"; branch: string; sha: string; subject?: string }
  | { state: "update_available"; branch: string; from: string | null; to: string; subject?: string }
  | { state: "unknown_remote" };

export type CommitSummary = { sha: string; subject: string };

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

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateIpv4(host: string): boolean {
  if (!isIpv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLocalIpv6(host: string): boolean {
  const value = host.toLowerCase();
  return value === "::1" || value.startsWith("fe80:") || /^f[cd][0-9a-f]{0,2}:/.test(value);
}

/** A name that resolves only on this computer's network, including a VPN DNS name with a local suffix. */
function isLocalDns(host: string): boolean {
  const value = host.toLowerCase().replace(/\.$/, "");
  if (value === "localhost" || !value.includes(".")) return true;
  return [".local", ".lan", ".internal", ".home", ".intranet", ".localdomain"].some((suffix) => value.endsWith(suffix));
}

function isLocalNetworkHost(host: string): boolean {
  return isPrivateIpv4(host) || isLocalIpv6(host) || isLocalDns(host);
}

function isHostName(host: string): boolean {
  if (isIpv4(host) || host.includes(":")) return true;
  const value = host.toLowerCase().replace(/\.$/, "");
  if (value.length === 0 || value.length > 253) return false;
  return value.split(".").every((label) => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label));
}

function serverProject(value: string): string {
  const project = value.trim();
  if (!/^(?:~)?[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(project)) {
    throw new Error("That project name cannot be used.");
  }
  return project;
}

function serverRepo(value: string): string {
  const name = value.trim().replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new Error("That repository name cannot be used.");
  }
  return name;
}

/** Bitbucket Server addresses: /scm/PROJECT/repo.git, /projects/PROJECT/repos/repo, /users/NAME/repos/repo. */
function bitbucketServerParts(pathname: string): { owner: string; name: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0]!.toLowerCase() === "scm") {
    return { owner: serverProject(parts[1]!), name: serverRepo(parts[2]!) };
  }
  const browse = parts.length === 5 && parts[4]!.toLowerCase() === "browse";
  const body = browse ? parts.slice(0, 4) : parts;
  if (body.length !== 4 || body[2]!.toLowerCase() !== "repos") return null;
  if (body[0]!.toLowerCase() === "projects") return { owner: serverProject(body[1]!), name: serverRepo(body[3]!) };
  if (body[0]!.toLowerCase() === "users") return { owner: serverProject(`~${body[1]}`), name: serverRepo(body[3]!) };
  return null;
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
  const host = url.hostname.toLowerCase();
  const cloud =
    host === "github.com" || host === "www.github.com"
      ? "github"
      : host === "bitbucket.org" || host === "www.bitbucket.org"
        ? "bitbucket"
        : null;
  if (cloud) {
    if (url.protocol !== "https:") throw new Error("Use the https address of the repository.");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) throw new Error("Use the repository address, not a file or branch link.");
    const name = parts[1]!.replace(/\.git$/i, "");
    return { provider: cloud, owner: assertRepoName(parts[0]!, "Account"), name: assertRepoName(name, "Repository") };
  }
  const server = bitbucketServerParts(url.pathname);
  if (!server) throw new Error("Only GitHub and Bitbucket repositories can be connected.");
  if (!isHostName(host)) throw new Error("That server address cannot be used.");
  if (url.protocol === "http:") {
    if (!isLocalNetworkHost(host)) throw new Error("Use https for that server, or an address on this network.");
  } else if (url.protocol !== "https:") {
    throw new Error("Use the https address of the repository.");
  }
  return { provider: "bitbucket", owner: server.owner, name: server.name, origin: url.origin };
}

/** The repository a saved binding points at, including a Bitbucket server when one was saved. */
export function repoRefFromBinding(binding: Pick<EnvBinding, "provider" | "owner" | "name" | "origin">): RepoRef {
  if (!binding.origin) return { provider: binding.provider, owner: binding.owner, name: binding.name };
  const origin = new URL(binding.origin);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("That server address cannot be used.");
  }
  if (origin.protocol === "http:" && !isLocalNetworkHost(origin.hostname.toLowerCase())) {
    throw new Error("Use https for that server, or an address on this network.");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("Use the https address of the repository.");
  }
  return { provider: binding.provider, owner: binding.owner, name: binding.name, origin: origin.origin };
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

function commitSubject(value: string | undefined): string | undefined {
  const line = value?.split("\n")[0]?.trim() ?? "";
  if (!line) return undefined;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function branchStatus(
  binding: EnvBinding | undefined,
  branches: BranchInfo[],
  options?: { truncated?: boolean },
): BranchStatus {
  if (!binding?.branch) return { state: "not_configured" };
  const branch = assertBranchName(binding.branch);
  const found = branches.find((row) => row.name === branch);
  if (!found) {
    if (options?.truncated) return { state: "unknown_remote" };
    return { state: "branch_gone", branch };
  }
  const to = assertCommitSha(found.sha);
  const from = binding.deployedSha ? assertCommitSha(binding.deployedSha) : null;
  const subject = commitSubject(found.subject);
  if (from && from === to) return { state: "up_to_date", branch, sha: to, subject };
  return { state: "update_available", branch, from, to, subject };
}

export function formatBranchStatus(status: BranchStatus): string {
  if (status.state === "up_to_date") {
    const sha = status.sha.slice(0, 7);
    return status.subject ? `Up to date (${sha}) — ${status.subject}` : `Up to date (${sha})`;
  }
  if (status.state === "update_available") {
    const from = status.from ? status.from.slice(0, 7) : "not deployed";
    const to = status.to.slice(0, 7);
    const subject = status.subject ? ` — ${status.subject}` : "";
    return `Update available ${from} → ${to}${subject}`;
  }
  if (status.state === "branch_gone") return "That branch is no longer on the repository";
  if (status.state === "unknown_remote") {
    return "The branch list was cut off, so this branch could not be confirmed.";
  }
  if (status.state === "not_configured") return "Choose a branch";
  return "";
}

/**
 * Write the deployed commit only when that environment still points at the same repository and branch.
 * A branch switch during the deploy must not be overwritten.
 */
export function configAfterDeploy(
  config: ComponentRepoConfig,
  role: "staging" | "production",
  deployed: Pick<EnvBinding, "provider" | "owner" | "name" | "branch" | "origin">,
  sha: string,
): ComponentRepoConfig | null {
  const current = config[role];
  if (!current) return null;
  if (
    current.provider !== deployed.provider ||
    current.owner !== deployed.owner ||
    current.name !== deployed.name ||
    current.branch !== deployed.branch ||
    (current.origin ?? "") !== (deployed.origin ?? "")
  ) {
    return null;
  }
  return { ...config, [role]: { ...current, deployedSha: assertCommitSha(sha) } };
}

export function repoDeployLockKey(parts: { orgId: string; siteId: string; target: string; slug: string }): string {
  return `wpdev-repo:${parts.orgId}:${parts.siteId}:${parts.target}:${parts.slug}`;
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join("[redacted]");
}

/** Keep the recorded commit only when the same repository and branch stay selected. */
export function bindingAfterBranchChange(previous: EnvBinding | undefined, next: Omit<EnvBinding, "deployedSha">): EnvBinding {
  const same =
    previous &&
    previous.provider === next.provider &&
    previous.owner === next.owner &&
    previous.name === next.name &&
    previous.branch === next.branch &&
    (previous.origin ?? "") === (next.origin ?? "");
  return { ...next, deployedSha: same ? previous.deployedSha : null };
}

export function formatAuthHeader(token: string): string {
  const trimmed = token.trim();
  if (/^(Bearer|Basic)\s+\S/.test(trimmed)) return trimmed;
  if (trimmed.includes(":")) return `Basic ${Buffer.from(trimmed).toString("base64")}`;
  return `Bearer ${trimmed}`;
}

const ARCHIVE_HOSTS = new Set([
  "api.github.com",
  "codeload.github.com",
  "github.com",
  "bitbucket.org",
  "api.bitbucket.org",
]);

function bitbucketTarballHost(hostname: string): boolean {
  return (
    hostname === "bb-tarballs.s3.amazonaws.com" ||
    /^bb-tarballs\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname)
  );
}

/**
 * Follow one archive redirect. Bitbucket's zip moves to its own S3 bucket.
 * The GitHub token stays on codeload. The S3 hop must not receive Authorization.
 */
export function resolveArchiveRedirect(current: string, location: string): { url: string; stripAuthorization: boolean } {
  let next: URL;
  let from = "";
  try {
    next = new URL(location, current);
    from = new URL(current).hostname.toLowerCase();
  } catch {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  const host = next.hostname.toLowerCase();
  const currentUrl = new URL(current);
  const sameServer =
    next.protocol === currentUrl.protocol &&
    host === currentUrl.hostname.toLowerCase() &&
    next.port === currentUrl.port;
  if (sameServer && next.protocol === "http:" && isLocalNetworkHost(host)) {
    return { url: next.toString(), stripAuthorization: false };
  }
  if (next.protocol !== "https:") {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  const fromBitbucket = from === "bitbucket.org" || from === "api.bitbucket.org";
  const tarball = bitbucketTarballHost(host) && fromBitbucket;
  if (sameServer && !ARCHIVE_HOSTS.has(host)) {
    return { url: next.toString(), stripAuthorization: false };
  }
  if (!ARCHIVE_HOSTS.has(host) && !tarball) {
    throw new Error("The repository host returned an address that cannot be used.");
  }
  return { url: next.toString(), stripAuthorization: tarball };
}

/** A certificate or network failure, explained for the person who typed the server. */
export function explainRepoReachError(err: unknown): Error | null {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") parts.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  const text = parts.join(" ");
  if (/CERT|certificate|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(text)) {
    return new Error("This computer does not trust the certificate on that server.");
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|bad port|fetch failed/i.test(text)) {
    return new Error("Could not reach that server. Connect to the network that can see it, then try again.");
  }
  return null;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function reaching(fetchImpl: FetchLike): FetchLike {
  return async (url, init) => {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      const explained = explainRepoReachError(err);
      if (explained) throw explained;
      throw err;
    }
  };
}

function serverRoot(ref: RepoRef): string {
  const parsed = repoRefFromBinding(ref);
  if (!parsed.origin) throw new Error("That server address cannot be used.");
  return `${parsed.origin}/rest/api/1.0/projects/${encodeURIComponent(ref.owner)}/repos/${encodeURIComponent(ref.name)}`;
}

function authHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "wp-dev",
  };
  if (token) headers.Authorization = formatAuthHeader(token);
  return headers;
}

function plainFailure(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error("Could not open this repository. Check the access token.");
  }
  if (status === 404) return new Error("Repository not found.");
  if (status === 429) return new Error("The repository host asked us to wait. Try again in a minute.");
  if (status >= 500 && status <= 599) {
    return new Error(`The repository host had a problem (${status}). Try again in a minute.`);
  }
  if (status === 0) return new Error("Could not reach the repository host.");
  return new Error(`Could not reach the repository (${status}).`);
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
  const path = parsed.pathname.toLowerCase();
  if (provider === "github") {
    const prefix = `/repos/${owner.toLowerCase()}/${name.toLowerCase()}/`;
    if (host !== "api.github.com" || !path.startsWith(prefix)) {
      throw new Error("The repository host returned an address that cannot be used.");
    }
    return parsed;
  }
  const prefix = `/2.0/repositories/${owner.toLowerCase()}/${name.toLowerCase()}/`;
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

async function loadBitbucketServerSnapshot(
  ref: RepoRef,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<RepoSnapshot> {
  const root = serverRoot(ref);
  const headers = authHeaders(token);
  headers.Accept = "application/json";
  const repoRes = await fetchImpl(root, { headers });
  if (!repoRes.ok) throw plainFailure(repoRes.status);
  const repo = (await repoRes.json()) as { public?: unknown };
  const defaultRes = await fetchImpl(`${root}/branches/default`, { headers });
  if (!defaultRes.ok) throw plainFailure(defaultRes.status);
  const fallback = (await defaultRes.json()) as { displayId?: unknown };
  if (typeof fallback.displayId !== "string" || fallback.displayId.trim() === "") {
    throw new Error("This repository has no default branch.");
  }
  const defaultBranch = assertBranchName(fallback.displayId);
  const branches: BranchInfo[] = [];
  let start = 0;
  let truncated = false;
  for (let page = 0; page < 10; page += 1) {
    const res = await fetchImpl(`${root}/branches?limit=100&start=${start}`, { headers });
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as {
      isLastPage?: unknown;
      nextPageStart?: unknown;
      values?: { displayId?: unknown; latestCommit?: unknown }[];
    };
    for (const row of body.values ?? []) {
      if (typeof row.displayId !== "string" || typeof row.latestCommit !== "string") continue;
      branches.push({ name: assertBranchName(row.displayId), sha: assertCommitSha(row.latestCommit) });
    }
    if (body.isLastPage !== false || typeof body.nextPageStart !== "number") break;
    start = body.nextPageStart;
    truncated = page === 9;
  }
  return { ref, isPrivate: repo.public !== true, defaultBranch, truncated, branches };
}

export async function loadRepoSnapshot(
  ref: RepoRef,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<RepoSnapshot> {
  fetchImpl = reaching(fetchImpl);
  if (ref.origin) return loadBitbucketServerSnapshot(ref, token, fetchImpl);
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
      truncated: next !== null,
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
    truncated: next !== null,
    branches,
  };
}

export async function loadBranch(
  ref: RepoRef,
  name: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<BranchInfo | null> {
  const branch = assertBranchName(name);
  fetchImpl = reaching(fetchImpl);
  const headers = authHeaders(token);
  if (ref.origin) {
    headers.Accept = "application/json";
    const url = `${serverRoot(ref)}/commits?until=${encodeURIComponent(`refs/heads/${branch}`)}&limit=1`;
    const res = await fetchImpl(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as { values?: { id?: unknown; displayId?: unknown }[] };
    const row = body.values?.[0];
    if (!row || typeof row.id !== "string") return null;
    return { name: branch, sha: assertCommitSha(row.id) };
  }
  if (ref.provider === "github") {
    const url = `https://api.github.com/repos/${ref.owner}/${ref.name}/branches/${encodeURIComponent(branch)}`;
    const res = await fetchImpl(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as { name?: unknown; commit?: { sha?: unknown } };
    if (typeof body.name !== "string" || typeof body.commit?.sha !== "string") {
      throw new Error("Could not read that branch.");
    }
    return { name: assertBranchName(body.name), sha: assertCommitSha(body.commit.sha) };
  }
  headers.Accept = "application/json";
  const url = `https://api.bitbucket.org/2.0/repositories/${ref.owner}/${ref.name}/refs/branches/${encodeURIComponent(branch)}`;
  const res = await fetchImpl(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw plainFailure(res.status);
  const body = (await res.json()) as { name?: unknown; target?: { hash?: unknown } };
  if (typeof body.name !== "string" || typeof body.target?.hash !== "string") {
    throw new Error("Could not read that branch.");
  }
  return { name: assertBranchName(body.name), sha: assertCommitSha(body.target.hash) };
}

export async function loadCommitSummary(
  ref: RepoRef,
  sha: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<CommitSummary> {
  const commit = assertCommitSha(sha);
  fetchImpl = reaching(fetchImpl);
  const headers = authHeaders(token);
  if (ref.origin) {
    headers.Accept = "application/json";
    const res = await fetchImpl(`${serverRoot(ref)}/commits/${commit}`, { headers });
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as { message?: unknown };
    const subject = commitSubject(typeof body.message === "string" ? body.message : undefined);
    if (!subject) throw new Error("The repository did not return a commit message.");
    return { sha: commit, subject };
  }
  if (ref.provider === "github") {
    const url = `https://api.github.com/repos/${ref.owner}/${ref.name}/commits/${commit}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw plainFailure(res.status);
    const body = (await res.json()) as { commit?: { message?: unknown } };
    const subject = commitSubject(typeof body.commit?.message === "string" ? body.commit.message : undefined);
    if (!subject) throw new Error("The repository did not return a commit message.");
    return { sha: commit, subject };
  }
  headers.Accept = "application/json";
  const url = `https://api.bitbucket.org/2.0/repositories/${ref.owner}/${ref.name}/commit/${commit}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw plainFailure(res.status);
  const body = (await res.json()) as { message?: unknown };
  const subject = commitSubject(typeof body.message === "string" ? body.message : undefined);
  if (!subject) throw new Error("The repository did not return a commit message.");
  return { sha: commit, subject };
}

export function archiveRequest(ref: RepoRef, sha: string, token: string | undefined): {
  url: string;
  headers: Record<string, string>;
} {
  const commit = assertCommitSha(sha);
  const headers = authHeaders(token);
  if (ref.origin) {
    headers.Accept = "application/zip";
    return { url: `${serverRoot(ref)}/archive?at=${commit}&format=zip`, headers };
  }
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
  /** Installed path, relative to WordPress, hashed after the copy. */
  headerRel?: string;
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
  if (
    input.headerRel &&
    !input.headerRel.startsWith("/") &&
    !input.headerRel.includes("..") &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.headerRel)
  ) {
    const installed = `"$WP/${input.headerRel}"`;
    lines.push(
      `if [ -f ${installed} ]; then php -r 'echo "WPDEV_REPO_HEADER_SHA ".hash_file("sha256",$argv[1]),"\\n";' ${installed}; fi`,
    );
  }
  lines.push("DONE=1", "echo WPDEV_REPO_INSTALL_OK");
  return lines.join("\n");
}
