import { lookup } from "node:dns/promises";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { compose } from "../services/docker-compose.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPull } from "../services/rsync.js";
import { assertRemoteWpInstalled } from "../services/wpcli.js";
import { getSimplyApiKey, SIMPLY_API_KEY_ENV } from "../services/simply.js";
import { inferApexFromConfig } from "../services/simply-staging.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { isPlaceholderRemoteHost } from "../utils/remote-placeholder.js";
import { logInfo } from "../utils/logger.js";
import {
  checkThemeBuildArtifacts,
  resolveThemePaths,
} from "../services/theme-path.js";

export type DoctorOptions = {
  env?: RemoteEnvName;
  rsyncDryRun: boolean;
  httpCheck: boolean;
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

type HttpProbe = {
  ok: boolean;
  status: number;
  finalUrl: string;
  hops: string[];
  error?: string;
};

async function probeHttpUrl(url: string): Promise<HttpProbe> {
  const hops: string[] = [];
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", redirect: "manual" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        status: 0,
        finalUrl: current,
        hops,
        error: msg,
      };
    }
    const status = res.status;
    const loc = res.headers.get("location");
    if (loc && status >= 300 && status < 400) {
      const next = new URL(loc, current).toString();
      hops.push(`${status} -> ${next}`);
      current = next;
      continue;
    }
    hops.push(`${status} @ ${current}`);
    return {
      ok: status >= 200 && status < 400,
      status,
      finalUrl: current,
      hops,
    };
  }
  return {
    ok: false,
    status: 0,
    finalUrl: current,
    hops,
    error: "too_many_redirects",
  };
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

async function checkLocalRuntimeWritePermissions(loaded: LoadedConfig): Promise<"ok" | "fail"> {
  console.error("\n--- local (wp-content runtime writes) ---");
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
        "test -w /var/www/html/wp-content/upgrade && touch /var/www/html/wp-content/upgrade/.wp-dev-write-test && rm -f /var/www/html/wp-content/upgrade/.wp-dev-write-test",
      ],
      { stdio: "pipe" },
    );
    console.error(
      "Local runtime writes: OK (www-data can write wp-content/upgrade — plugin updates should work)",
    );
    return "ok";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `Local runtime writes: FAIL — www-data cannot write wp-content/upgrade (${msg})`,
    );
    console.error(
      "Fix: from WP-dev repo root run `npm run wp-dev -- fix-runtime-permissions` (or `fix-permissions`, which restores runtime paths automatically).",
    );
    return "fail";
  }
}

function checkLocalTheme(loaded: LoadedConfig): "ok" | "warn" | "skip" {
  try {
    const { themeSourcePath, deployDir, slug } = resolveThemePaths(loaded);
    const check = checkThemeBuildArtifacts(deployDir);
    console.error(`\n--- local theme (${slug}) ---`);
    console.error(`source: ${themeSourcePath}`);
    console.error(`deploy: ${deployDir}`);
    if (check.ok) {
      console.error(`Theme build: OK (${check.styleBytes} bytes style.css)`);
      return "ok";
    }
    console.error("Theme build: WARN — production deploy may fail or ship dev assets:");
    for (const issue of check.issues) {
      console.error(`  - ${issue}`);
    }
    console.error("Fix: `npm run wp-dev -- theme build` before `push theme production`.");
    return "warn";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n--- local theme ---`);
    console.error(`SKIP: ${msg}`);
    return "skip";
  }
}

export async function cmdDoctor(loaded: LoadedConfig, options: DoctorOptions): Promise<void> {
  assertDockerReady();
  const { config } = loaded;
  console.error("\nwp-dev doctor — read-only remote checks (no pull/push, no DB import)\n");
  console.error(`project: ${config.project}`);
  console.error(`local.url: ${config.local.url}`);
  console.error(
    "\nLocal stack: run `wp-dev up` then open local.url. This command does not start Docker.\n",
  );

  let failed = 0;
  if ((await checkLocalRuntimeWritePermissions(loaded)) === "fail") {
    failed += 1;
  }
  const themeResult = checkLocalTheme(loaded);
  if (themeResult === "warn") {
    // Non-fatal — theme may not exist on every wp-dev project
    logInfo("doctor: local theme build check warned");
  }

  const targets: RemoteEnvName[] = options.env
    ? [options.env]
    : ["staging", "production"];

  let skipped = 0;
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
  console.error("doctor: all checked remotes passed.");
}
