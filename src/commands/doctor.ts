import { lookup } from "node:dns/promises";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPull } from "../services/rsync.js";
import { assertRemoteWpInstalled } from "../services/wpcli.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { isPlaceholderRemoteHost } from "../utils/remote-placeholder.js";
import { logInfo } from "../utils/logger.js";

export type DoctorOptions = {
  env?: RemoteEnvName;
  rsyncDryRun: boolean;
};

async function tryDns(host: string): Promise<{ ok: true } | { ok: false; err: string }> {
  try {
    await lookup(host);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, err: msg };
  }
}

async function checkOneRemote(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  rsyncDryRun: boolean,
): Promise<"ok" | "skip" | "fail"> {
  const remote = getRemoteEnv(loaded.config, env);
  const label = `${remote.user}@${remote.host}:${remote.path}`;

  console.error(`\n--- ${env} (${label}) ---`);

  if (isPlaceholderRemoteHost(remote.host)) {
    console.error(
      `SKIP: ${remote.host} looks like a placeholder (.invalid). Edit ${env} in wp-dev.config.json before pull ${env} / push ${env}.`,
    );
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
  return "ok";
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

  const targets: RemoteEnvName[] = options.env
    ? [options.env]
    : ["staging", "production"];

  let failed = 0;
  let skipped = 0;
  for (const env of targets) {
    const r = await checkOneRemote(loaded, env, options.rsyncDryRun);
    if (r === "fail") failed += 1;
    if (r === "skip") skipped += 1;
  }

  console.error("");
  if (failed > 0) {
    console.error(`doctor finished with ${failed} failure(s). Fix SSH/WP-CLI above, then retry.`);
    throw new Error(`wp-dev doctor: ${failed} remote check(s) failed`);
  }
  console.error(
    skipped > 0
      ? "doctor: all checked remotes passed or were skipped (staging placeholder)."
      : "doctor: all checked remotes passed.",
  );
}
