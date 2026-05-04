import { writeWpDevConfig, type LoadedConfig } from "../config/load.js";
import { simplyGet } from "../services/simply.js";
import type { ApplySimplyStagingDnsOptions } from "../services/simply-staging.js";
import {
  applySimplyStagingDnsToDraft,
  inferApexFromConfig,
  sanitizeStagingDnsLabel,
  SimplyStagingDnsConflictError,
} from "../services/simply-staging.js";
import { parseMainDomain } from "../utils/domain-defaults.js";
import { logInfo } from "../utils/logger.js";

export async function cmdSimplyTest(loaded: LoadedConfig): Promise<void> {
  logInfo("simply test: GET /my/products/");
  const { status, body } = await simplyGet(loaded.config, "/my/products/");
  if (status < 200 || status >= 300) {
    throw new Error(
      `Simply.com API returned HTTP ${status}. Body (truncated): ${body.slice(0, 500)}`,
    );
  }
  console.error(`Simply.com API OK (HTTP ${status}). Response starts with:\n${body.slice(0, 400)}${body.length > 400 ? "…" : ""}`);
}

export type SimplySetupStagingDnsCliOpts = {
  keepExistingDns?: boolean;
  stagingLabel?: string;
};

/** DNS A record `<label>.<apex>` + staging hints in wp-dev.config.json (Simply API). */
export async function cmdSimplySetupStagingDns(
  loaded: LoadedConfig,
  apexArg?: string,
  cliOpts?: SimplySetupStagingDnsCliOpts,
): Promise<void> {
  const label = apexArg?.trim() ? apexArg.trim() : "(from production.url)";
  logInfo(`simply setup-staging-dns ${label}`);
  const apex = apexArg?.trim() ? parseMainDomain(apexArg) : inferApexFromConfig(loaded.config, "");
  if (!apex) {
    throw new Error(
      "Could not determine apex domain: pass it as an argument (e.g. stri.be) or set production.url in wp-dev.config.json.",
    );
  }

  const opts: ApplySimplyStagingDnsOptions = {};
  if (cliOpts?.stagingLabel?.trim()) {
    opts.stagingLabel = sanitizeStagingDnsLabel(cliOpts.stagingLabel);
  }
  if (cliOpts?.keepExistingDns) {
    opts.onDifferentExistingA = "config-only";
  }

  try {
    const lines = await applySimplyStagingDnsToDraft(loaded.config, apex, opts);
    for (const line of lines) console.error(line);
  } catch (e) {
    if (e instanceof SimplyStagingDnsConflictError) {
      console.error(`${e.message}`);
      console.error(
        "Re-run with --keep-existing-dns (config only) or --staging-label <name> (e.g. dev) for a different hostname.",
      );
      throw e;
    }
    throw e;
  }
  writeWpDevConfig(loaded.configDir, loaded.config);
  console.error("Saved staging fields to wp-dev.config.json");
}
