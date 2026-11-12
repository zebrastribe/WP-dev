import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  archiveRequest,
  buildRepoInstallScript,
  explainRepoReachError,
  loadRepoSnapshot,
  parseRepositoryUrl,
  repoRefFromBinding,
  resolveArchiveRedirect,
} from "@wpdev/sync-engine";
import type { LoadedConfig } from "../config/load.js";
import type { RemoteEnvName } from "../config/schema.js";
import { componentFromFields, findLocalComponent, planLocalDeploy, readDeployedShas, writeDeployedSha } from "../services/deploy-plan.js";
import { connectSsh } from "../services/ssh.js";
import { assertRemoteConfigured } from "../utils/remote-placeholder.js";
import { logInfo } from "../utils/logger.js";

const ARCHIVE_LIMIT = 200 * 1024 * 1024;

async function downloadArchive(url: string, headers: Record<string, string>): Promise<Buffer> {
  let current = url;
  let hdrs = { ...headers };
  for (let hop = 0; hop < 3; hop += 1) {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(current, { headers: hdrs, redirect: "manual" });
    } catch (err) {
      const explained = explainRepoReachError(err);
      if (explained) throw explained;
      throw err;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("The repository host did not return the archive.");
      const next = resolveArchiveRedirect(current, location);
      current = next.url;
      if (next.stripAuthorization) {
        delete hdrs.Authorization;
        hdrs = { ...hdrs };
      }
      continue;
    }
    if (!res.ok) throw new Error("Could not download the repository archive.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > ARCHIVE_LIMIT) throw new Error("The archive is larger than 200 MB.");
    return buf;
  }
  throw new Error("The repository host redirected too many times.");
}

function headerRel(target: "core" | "plugin" | "theme", slug: string): string | undefined {
  if (target === "theme") return `wp-content/themes/${slug}/style.css`;
  if (target === "core") return "wp-includes/version.php";
  return undefined;
}

export async function cmdDeployRepo(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  opts: {
    target: "core" | "plugin" | "theme";
    slug: string;
    sha?: string;
    promote?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    url?: string;
    branch?: string;
    subdirectory?: string;
  },
): Promise<void> {
  const component = opts.url
    ? componentFromFields({
        url: opts.url,
        branch: opts.branch ?? "",
        target: opts.target,
        slug: opts.slug,
        subdirectory: opts.subdirectory,
      })
    : findLocalComponent(loaded.config, opts.target, opts.slug);
  const remote = loaded.config[env];
  assertRemoteConfigured(env, remote.host);
  if (!opts.dryRun && !opts.yes) {
    throw new Error(`Pass --yes to deploy this repository to ${env}.`);
  }
  const recorded = readDeployedShas(loaded.configDir, component.target, component.slug);
  const ref = opts.url ? parseRepositoryUrl(opts.url) : repoRefFromBinding(component);
  let branchTip: string | null = null;
  if (!opts.promote && !opts.sha) {
    const token = process.env.WPDEV_GIT_TOKEN?.trim() || undefined;
    const snapshot = await loadRepoSnapshot(ref, token, fetch);
    branchTip = snapshot.branches.find((row) => row.name === component.branch)?.sha ?? null;
    if (!branchTip) throw new Error("That branch is no longer on the repository.");
  }
  const plan = planLocalDeploy({
    component,
    role: env,
    promote: Boolean(opts.promote),
    resolvedSha: opts.sha,
    branchTip,
    recorded,
  });
  logInfo(`repository deploy ${component.target} ${component.slug} ${env} ${plan.sha.slice(0, 12)}`);
  if (opts.dryRun) {
    console.log(
      JSON.stringify({
        source: plan.source,
        environment: env,
        target: component.target,
        slug: component.slug,
        sha: plan.sha,
        branch: component.branch,
      }),
    );
    return;
  }

  const token = process.env.WPDEV_GIT_TOKEN?.trim() || undefined;
  const archive = archiveRequest(ref, plan.sha, token);
  const bytes = await downloadArchive(archive.url, archive.headers);
  const dir = mkdtempSync(join(tmpdir(), "wpdev-repo-"));
  const localZip = join(dir, "archive.zip");
  const remoteZip = `/tmp/wpdev-repo-${randomBytes(8).toString("hex")}.zip`;
  writeFileSync(localZip, bytes, { mode: 0o600 });
  const ssh = await connectSsh(remote);
  try {
    await ssh.putFile(localZip, remoteZip);
    const script = buildRepoInstallScript({
      wpPath: remote.path,
      zipPath: remoteZip,
      target: component.target,
      slug: component.slug,
      subdirectory: component.subdirectory,
      headerRel: headerRel(component.target, component.slug),
    });
    const ran = await ssh.exec(script);
    const output = `${ran.stdout}\n${ran.stderr}`;
    if (ran.code !== 0 || !ran.stdout.includes("WPDEV_REPO_INSTALL_OK")) {
      throw new Error(output.trim().slice(-2000) || "The update did not finish on the site.");
    }
    writeDeployedSha(loaded.configDir, component.target, component.slug, env, plan.sha);
    console.log(`Deployed ${plan.sha.slice(0, 12)} to ${env}.`);
  } finally {
    try {
      await ssh.exec(`rm -f '${remoteZip}'`);
    } catch {
      /* the zip name is a random tmp path */
    }
    ssh.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}
