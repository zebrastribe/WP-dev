import { lookup } from "node:dns/promises";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPull } from "../services/rsync.js";
import { assertRemoteWpInstalled, isLocalWpInstalled } from "../services/wpcli.js";
import { getSimplyApiKey, SIMPLY_API_KEY_ENV } from "../services/simply.js";
import { inferApexFromConfig } from "../services/simply-staging.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { probeHttpUrl } from "../utils/http-probe.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { loopbackRedirectUsesWrongPort } from "../utils/sync-local-urls.js";
import { verifyLocalSiteUrls } from "../utils/sync-verify.js";
import { isPlaceholderRemoteHost } from "../utils/remote-placeholder.js";
import { logInfo } from "../utils/logger.js";
import { compose } from "../services/docker-compose.js";
import { getRunningSupervisorInfo } from "../supervisor/recovery.js";
import { isLockStale, readLockData } from "../supervisor/project-lock.js";
import { loadRegistry } from "../supervisor/service-registry.js";
import { hostRunnerPidPath } from "../supervisor/paths.js";
import { checkFilesystemHealth } from "../fs/recovery.js";
import { ownershipManifestPath } from "../fs/path-resolver.js";
import { existsSync } from "node:fs";

export type DoctorOptions = {
  env?: RemoteEnvName;
  rsyncDryRun: boolean;
  httpCheck: boolean;
  localHttpCheck: boolean;
  lifecycleCheck?: boolean;
  filesystemCheck?: boolean;
};

function printSimplyStagingDnsHint(loaded: LoadedConfig): void {
  const apex = inferApexFromConfig(loaded.config, "");
  const cmd = apex
    ? `npm run wp-dev -- simply setup-staging-dns ${apex}`
    : `npm run wp-dev -- simply setup-staging-dns`;
  const { config } = loaded;
  if (config.simply?.account && getSimplyApiKey()) {
    console.error(
      `Simply.com (${config.simply.account} + ${SIMPLY_API_KEY_ENV}): run \`${cmd}\` to create the staging A record and refresh staging.{host,path,user,url} from the API.`,
    );
    return;
  }
  if (config.simply?.account && !getSimplyApiKey()) {
    console.error(
      `Simply account "${config.simply.account}" is in config; set ${SIMPLY_API_KEY_ENV} in docker/.env (wp-dev admin wizard Simply step) or export it, then run \`${cmd}\`.`,
    );
    return;
  }
  console.error(
    `Optional: add "simply":{"account":"S…"}, set ${SIMPLY_API_KEY_ENV} (wizard or docker/.env), then \`${cmd}\` — README "Simply.com staging DNS".`,
  );
}

async function tryDns(host: string): Promise<{ ok: true } | { ok: false; err: string }> {
  try {
    await lookup(host);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, err: msg };
  }
}

async function checkLocalRuntimeWrite(loaded: LoadedConfig): Promise<"ok" | "fail"> {
  const marker = `wp-dev-doctor-${process.pid}`;
  const script = [
    `for d in /var/www/html/wp-content/upgrade/${marker} /var/www/html/wp-content/upgrade-temp-backup/${marker}; do`,
    `  mkdir -p "$d" && touch "$d/.write-test" && rm -rf "$d"`,
    `done`,
  ].join("\n");
  try {
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "run",
        "--rm",
        "--no-deps",
        "--user",
        "33:33",
        "--entrypoint",
        "sh",
        "wordpress",
        "-lc",
        script,
      ],
      { stdio: "pipe" },
    );
    console.error(
      "Local runtime write: OK (www-data can write wp-content/upgrade and upgrade-temp-backup)",
    );
    return "ok";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      "Local runtime write: FAIL — www-data cannot write wp-content/upgrade or upgrade-temp-backup",
    );
    console.error(
      "Fix: npm run wp-dev -- fix-runtime-permissions (or fix-permissions, which restores runtime paths automatically)",
    );
    logInfo(`doctor: local runtime write check failed (${msg})`);
    return "fail";
  }
}

async function checkLocalSite(
  loaded: LoadedConfig,
  localHttpCheck: boolean,
): Promise<"ok" | "fail" | "skip"> {
  const { site } = getPublishedLocalAccess(loaded);
  console.error(`\n--- local (${site}) ---`);

  const runtimeWrite = await checkLocalRuntimeWrite(loaded);
  if (runtimeWrite === "fail") return "fail";

  let installed = false;
  try {
    installed = await isLocalWpInstalled(loaded.configDir, loaded.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Local WP: could not check install state (${msg})`);
    return localHttpCheck ? "fail" : "skip";
  }

  if (!installed) {
    console.error("Local WP: not installed — run pull or finish the WordPress installer.");
    return localHttpCheck ? "skip" : "ok";
  }

  const urlCheck = await verifyLocalSiteUrls(loaded.configDir, loaded.config, site);
  if (urlCheck.ok) {
    console.error(`Local DB URLs: OK (home/siteurl = ${site})`);
  } else {
    console.error(
      `Local DB URLs: FAIL — home=${urlCheck.home ?? "?"} siteurl=${urlCheck.siteurl ?? "?"} expected=${site}`,
    );
    console.error("Fix: run `npm run wp-dev -- up` (syncs URLs on startup) or pull again.");
    if (!localHttpCheck) return "fail";
  }

  if (!localHttpCheck) {
    return urlCheck.ok ? "ok" : "fail";
  }

  const probe = await probeHttpUrl(site);
  if (!probe.ok) {
    console.error(
      `Local HTTP: FAIL — ${site} -> status ${probe.status || "n/a"}${probe.error ? ` (${probe.error})` : ""}`,
    );
    if (probe.hops.length > 0) console.error(`Local HTTP hops: ${probe.hops.join(" | ")}`);
    console.error("Hint: run `npm run wp-dev -- up` and ensure Docker is running.");
    return "fail";
  }

  for (const hop of probe.hops) {
    const m = hop.match(/->\s*(https?:\/\/[^\s]+)/);
    if (!m) continue;
    const portIssue = loopbackRedirectUsesWrongPort(site, m[1]);
    if (portIssue.wrong) {
      console.error(
        `Local HTTP: FAIL — redirect to ${m[1]} (port ${portIssue.gotPort}, expected ${portIssue.expectedPort})`,
      );
      console.error(`Local HTTP hops: ${probe.hops.join(" | ")}`);
      console.error(
        "Fix: run `npm run wp-dev -- up` — wp-dev syncs WordPress home/siteurl when WP_PORT changes.",
      );
      return "fail";
    }
  }

  const finalPortIssue = loopbackRedirectUsesWrongPort(site, probe.finalUrl);
  if (finalPortIssue.wrong) {
    console.error(
      `Local HTTP: FAIL — ${site} ends at ${probe.finalUrl} (port ${finalPortIssue.gotPort}, expected ${finalPortIssue.expectedPort})`,
    );
    console.error(`Local HTTP hops: ${probe.hops.join(" | ")}`);
    return "fail";
  }

  console.error(`Local HTTP: OK (${probe.hops.join(" | ")})`);
  return urlCheck.ok ? "ok" : "fail";
}

async function checkOneRemote(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  rsyncDryRun: boolean,
  httpCheck: boolean,
): Promise<"ok" | "skip" | "fail"> {
  const remote = getRemoteEnv(loaded.config, env);
  const label = `${remote.user}@${remote.host}:${remote.path}`;

  console.error(`\n--- ${env} (${label}) ---`);

  if (isPlaceholderRemoteHost(remote.host)) {
    console.error(
      `SKIP: ${remote.host} looks like a placeholder (.invalid). Edit ${env} in wp-dev.config.json before pull ${env} / push ${env}.`,
    );
    if (env === "staging") {
      printSimplyStagingDnsHint(loaded);
    }
    return "skip";
  }

  const dns = await tryDns(remote.host);
  if (!dns.ok) {
    console.error(
      `DNS: hostname "${remote.host}" did not resolve (${dns.err}). Create DNS / use the panel SSH hostname (e.g. linuxNNN.unoeuro.com) — see README (Shared hosting).`,
    );
  } else {
    console.error(`DNS: OK (${remote.host} resolves)`);
  }

  let sshFailed = false;
  try {
    logInfo(`doctor ${env}: ssh connect`);
    const ssh = await connectSsh(remote);
    try {
      await assertRemoteWpInstalled(ssh, remote.path);
      console.error(
        `SSH + WP-CLI: OK (remote WordPress detected at ${remote.path})`,
      );
      if (rsyncDryRun) {
        const localWp = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
        console.error("rsync: running pull --dry-run (no files written)…");
        await rsyncPull(remote, localWp, { dryRun: true });
        console.error("rsync: OK (dry-run completed)");
      }
    } finally {
      ssh.dispose();
    }
  } catch (e) {
    sshFailed = true;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`SSH / WP-CLI: FAIL — ${msg}`);
    console.error(
      "Hints: upload SSH public key in host panel (shared hosting); verify user, path (directory containing wp-config.php), and identityFile — see README (SSH keypair, Shared hosting, Troubleshooting).",
    );
  }

  if (sshFailed) return "fail";
  if (httpCheck) {
    const probe = await probeHttpUrl(remote.url);
    if (!probe.ok) {
      console.error(
        `HTTP: FAIL — ${remote.url} -> status ${probe.status || "n/a"}${probe.error ? ` (${probe.error})` : ""}`,
      );
      if (probe.hops.length > 0) {
        console.error(`HTTP hops: ${probe.hops.join(" | ")}`);
      }
      return "fail";
    }
    const expectedHost = new URL(remote.url).hostname.toLowerCase();
    const finalHost = new URL(probe.finalUrl).hostname.toLowerCase();
    if (expectedHost !== finalHost) {
      console.error(
        `HTTP: FAIL — ${remote.url} ends at ${probe.finalUrl} (host mismatch: expected ${expectedHost}, got ${finalHost})`,
      );
      console.error(`HTTP hops: ${probe.hops.join(" | ")}`);
      return "fail";
    }
    console.error(`HTTP: OK (${probe.hops.join(" | ")})`);
  }
  return "ok";
}

async function checkLifecycle(loaded: LoadedConfig): Promise<"ok" | "fail"> {
  console.error("\n--- lifecycle (service manager) ---");
  let failed = false;

  const lock = readLockData(loaded.configDir);
  const supervisor = getRunningSupervisorInfo(loaded.configDir);
  if (lock && !supervisor) {
    console.error(`FAIL: stale lock file (PID ${lock.pid} not running)`);
    failed = true;
  } else if (supervisor) {
    console.error(`Supervisor: OK (PID ${supervisor.pid}, port ${supervisor.port})`);
  } else {
    console.error("Supervisor: not running (expected after wp-dev down)");
  }

  if (isLockStale(loaded.configDir)) {
    console.error("FAIL: stale wp-dev.lock — run wp-dev up to recover");
    failed = true;
  }

  const registry = loadRegistry(loaded.configDir);
  if (registry) {
    console.error(`Registry: ${registry.services.length} service(s), phase=${registry.shutdownPhase}`);
    if (registry.shutdownPhase !== "none" && registry.shutdownPhase !== "complete") {
      console.error(`FAIL: incomplete shutdown phase "${registry.shutdownPhase}"`);
      failed = true;
    }
  } else {
    console.error("Registry: not found (run wp-dev up)");
  }

  if (existsSync(hostRunnerPidPath(loaded.configDir))) {
    console.error(
      "WARN: legacy host-runner PID file present — will be cleaned on next wp-dev up",
    );
  }

  return failed ? "fail" : "ok";
}

async function checkFilesystem(loaded: LoadedConfig): Promise<"ok" | "fail"> {
  console.error("\n--- filesystem (ownership & permissions) ---");
  const health = checkFilesystemHealth(loaded);
  for (const issue of health.issues) {
    console.error(`FAIL: ${issue}`);
  }
  if (existsSync(ownershipManifestPath(loaded.configDir))) {
    console.error("Ownership manifest: present (logs/ownership-manifest.json)");
  } else {
    console.error("Ownership manifest: missing — run wp-dev up to reconcile");
  }
  if (health.ok) {
    console.error("Filesystem health: OK");
    return "ok";
  }
  console.error(
    "Filesystem health: FAIL — run: npm run wp-dev -- doctor --filesystem (auto-reconciles ownership profiles)",
  );
  return "fail";
}

export async function cmdDoctor(loaded: LoadedConfig, options: DoctorOptions): Promise<void> {
  assertDockerReady();
  if (options.rsyncDryRun) {
    assertHostSyncTools();
  }
  const { config } = loaded;
  console.error("\nwp-dev doctor — read-only checks (no pull/push, no DB import)\n");
  console.error(`project: ${config.project}`);
  console.error(`local.url: ${config.local.url}`);
  console.error(
    "\nLocal stack: run `wp-dev up` then open local.url. This command does not start Docker.\n",
  );

  let failed = 0;
  let skipped = 0;

  const localResult = await checkLocalSite(loaded, options.localHttpCheck);
  if (localResult === "fail") failed += 1;

  if (options.lifecycleCheck) {
    const lc = await checkLifecycle(loaded);
    if (lc === "fail") failed += 1;
  }

  if (options.filesystemCheck) {
    const fs = await checkFilesystem(loaded);
    if (fs === "fail") failed += 1;
  }

  const targets: RemoteEnvName[] = options.env
    ? [options.env]
    : ["staging", "production"];

  const skippedEnvs: RemoteEnvName[] = [];
  for (const env of targets) {
    const r = await checkOneRemote(loaded, env, options.rsyncDryRun, options.httpCheck);
    if (r === "fail") failed += 1;
    if (r === "skip") {
      skipped += 1;
      skippedEnvs.push(env);
    }
  }

  console.error("");
  if (failed > 0) {
    console.error(`doctor finished with ${failed} failure(s). Fix issues above, then retry.`);
    throw new Error(`wp-dev doctor: ${failed} check(s) failed`);
  }
  if (skipped > 0) {
    const skippedList = skippedEnvs.join(", ");
    const checked = targets.length - skipped;
    console.error(
      `doctor: ${checked}/${targets.length} remote checks passed; skipped (${skippedList}) due to placeholder host config.`,
    );
    console.error(
      "Update skipped env(s) in wp-dev.config.json to enable full checks.",
    );
    return;
  }
  console.error("doctor: all checks passed.");
}
