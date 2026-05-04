import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ZodError } from "zod";
import type { WpDevConfig } from "../config/schema.js";
import {
  ensureWpDevConfigJson,
  loadConfig,
  writeWpDevConfig,
} from "../config/load.js";
import { initLogger, logInfo } from "../utils/logger.js";
import {
  expandUserPath,
  normalizeSiteUrl,
  parseOptionalPort,
  isPrivateKeyFilePath,
} from "../utils/remote-config-helpers.js";
import {
  domainPathSlug,
  parseMainDomain,
  suggestProduction,
  suggestStaging,
  type RemoteGuess,
} from "../utils/domain-defaults.js";
import {
  applySimplyStagingDnsToDraft,
  inferApexFromConfig,
  sanitizeStagingDnsLabel,
  SimplyStagingDnsConflictError,
} from "../services/simply-staging.js";
import { getSimplyApiKey, SIMPLY_API_KEY_ENV } from "../services/simply.js";
import { isPlaceholderRemoteHost } from "../utils/remote-placeholder.js";

/** RFC 2606-style placeholder when the user has no staging server yet (avoids misleading real subdomains). */
const STAGING_PLACEHOLDER_GUESS: RemoteGuess = {
  host: "staging.example.invalid",
  path: "/var/www/staging-not-used",
  url: "https://staging.example.invalid",
};

type PromptRl = ReturnType<typeof readline.createInterface>;

function assertInteractive(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "wp-dev init must be run in an interactive terminal (TTY).",
    );
  }
}

async function ask(
  rl: PromptRl,
  label: string,
  current: string,
): Promise<string> {
  const hint = current ? ` [${current}]` : "";
  const ans = (await rl.question(`${label}${hint}: `)).trim();
  return ans !== "" ? ans : current;
}

async function askOptional(
  rl: PromptRl,
  label: string,
  current: string | undefined,
): Promise<string> {
  const hint =
    current !== undefined && current !== ""
      ? ` [${current}]`
      : " [leave empty to skip]";
  const ans = (await rl.question(`${label}${hint}: `)).trim();
  if (ans !== "") return ans;
  return current ?? "";
}

async function askYes(
  rl: PromptRl,
  message: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const a = (await rl.question(`${message} (${hint}): `)).trim().toLowerCase();
  if (a === "") return defaultYes;
  return a === "y" || a === "yes";
}

async function promptIdentityFile(
  rl: PromptRl,
  label: string,
  current: string | undefined,
): Promise<string | undefined> {
  for (;;) {
    const raw = await askOptional(rl, `${label} (path only; never paste key text)`, current);
    if (!raw.trim()) return undefined;
    const abs = expandUserPath(raw);
    if (isPrivateKeyFilePath(abs)) return abs;
    console.error(`Not a readable file: ${abs}. Try again or leave empty.`);
  }
}

async function promptRemote(
  rl: PromptRl,
  title: string,
  cur: WpDevConfig["staging"],
  suggestions?: RemoteGuess,
): Promise<WpDevConfig["staging"]> {
  console.error(`\n--- ${title} ---`);
  const host = await ask(rl, "SSH hostname", suggestions?.host ?? cur.host);
  const user = await ask(rl, "SSH username", cur.user);
  const portRaw = await askOptional(
    rl,
    "SSH port (empty = omit from config; SSH then uses port 22)",
    cur.port != null ? String(cur.port) : "",
  );
  const pathVal = await ask(rl, "Remote WordPress root path", suggestions?.path ?? cur.path);
  const urlRaw = await ask(rl, "Site URL (https://…)", suggestions?.url ?? cur.url);
  const url = normalizeSiteUrl(urlRaw, "https");

  let port: number | undefined;
  if (portRaw.trim()) {
    port = parseOptionalPort(portRaw);
  } else {
    port = undefined;
  }

  const identityFile = await promptIdentityFile(
    rl,
    "SSH private key file",
    cur.identityFile,
  );

  const out: WpDevConfig["staging"] = {
    host,
    user,
    path: pathVal,
    url,
  };
  if (port !== undefined) out.port = port;
  if (identityFile) out.identityFile = identityFile;
  return out;
}

function applyRemoteGuess(
  guess: RemoteGuess,
  user: string,
  identityFile: string | undefined,
  port?: number,
): WpDevConfig["staging"] {
  const out: WpDevConfig["staging"] = {
    host: guess.host,
    user,
    path: guess.path,
    url: normalizeSiteUrl(guess.url, "https"),
  };
  if (port !== undefined) out.port = port;
  if (identityFile) out.identityFile = identityFile;
  return out;
}

export async function cmdInit(): Promise<void> {
  assertInteractive();
  const configDir = ensureWpDevConfigJson();
  initLogger(configDir);
  logInfo("command init (interactive)");

  const loaded = loadConfig();
  let draft: WpDevConfig = {
    ...loaded.config,
    local: { ...loaded.config.local },
    staging: { ...loaded.config.staging },
    production: { ...loaded.config.production },
  };

  const rl = readline.createInterface({ input, output });
  let wroteStagingPlaceholders = false;
  try {
    console.error(
      [
        "",
        "wp-dev init — writes wp-dev.config.json (no pull/push).",
        "SSH: optional key file path only; empty = OpenSSH defaults.",
        "Only local.url is your Docker site in the browser (e.g. http://localhost:8888). Staging / production are remote pull/push targets — not a second local URL.",
        "Optional: with Simply.com API credentials, init can add a staging DNS A record and fill staging hints — not full hosting setup.",
        "",
      ].join("\n"),
    );

    draft.project = await ask(rl, "Project id (unique per clone)", draft.project);

    const localUrlRaw = await ask(rl, "Local site URL", draft.local.url);
    draft.local.url = normalizeSiteUrl(localUrlRaw, "http");

    const domainRaw = await askOptional(
      rl,
      "Main site domain (e.g. stri.be) — guesses VPS-style staging./prod + /var/www/<slug> [empty = configure staging & production separately; recommended on shared hosting]",
      "",
    );

    if (domainRaw.trim()) {
      const base = parseMainDomain(domainRaw);
      const slug = domainPathSlug(domainRaw);
      const stSug = suggestStaging(base);
      const prSug = suggestProduction(base);

      console.error(
        `\nFrom domain "${base}" → path slug "${slug}" (used under /var/www/…):\n` +
          `  staging:  ssh ${stSug.host}  path ${stSug.path}  url ${stSug.url}\n` +
          `  production: ssh ${prSug.host}  path ${prSug.path}  url ${prSug.url}\n` +
          `\nThese defaults assume a VPS-style layout. Shared hosting (Simply, UnoEuro, …) usually needs a different SSH host and path — see README (Shared hosting).\n` +
          `\nStaging URL (${stSug.url}) needs DNS + hosting before it works in a browser. With Simply.com (later prompt), wp-dev can create the staging A record only — see README (Simply.com staging DNS).\n`,
      );

      const hasStaging = await askYes(
        rl,
        "Do you have a staging server ready (DNS + hosting + SSH) for wp-dev pull/push staging?",
        true,
      );
      const stagingGuess: RemoteGuess = hasStaging ? stSug : STAGING_PLACEHOLDER_GUESS;
      if (!hasStaging) {
        wroteStagingPlaceholders = true;
        console.error(
          `\nStaging will be saved as placeholders (${STAGING_PLACEHOLDER_GUESS.host} / ${STAGING_PLACEHOLDER_GUESS.url}) until you edit wp-dev.config.json. Production still uses the guesses below (or your manual edits).\n`,
        );
      }

      const user = await ask(
        rl,
        "SSH username (same for staging + production unless you edit later)",
        draft.staging.user || draft.production.user,
      );

      const identityHint =
        draft.staging.identityFile ?? draft.production.identityFile;
      const identityFile = await promptIdentityFile(
        rl,
        "SSH private key (shared; leave empty for agent/default keys)",
        identityHint,
      );

      const portHint =
        draft.staging.port != null
          ? String(draft.staging.port)
          : draft.production.port != null
            ? String(draft.production.port)
            : "";
      const portRaw = await askOptional(
        rl,
        "SSH port for both (empty = omit, use port 22)",
        portHint,
      );
      const sharedPort = portRaw.trim()
        ? parseOptionalPort(portRaw)
        : undefined;

      if (
        await askYes(
          rl,
          hasStaging
            ? "Use these guessed hosts/paths/URLs (you can re-run init to change)?"
            : "Use guessed production + placeholder staging (you can re-run init to change)?",
          true,
        )
      ) {
        draft.staging = applyRemoteGuess(stagingGuess, user, identityFile, sharedPort);
        draft.production = applyRemoteGuess(prSug, user, identityFile, sharedPort);
      } else {
        draft.staging = await promptRemote(
          rl,
          hasStaging ? "Staging" : "Staging (optional — defaults are placeholders)",
          draft.staging,
          stagingGuess,
        );
        draft.production = await promptRemote(
          rl,
          "Production",
          draft.production,
          prSug,
        );
      }
    } else {
      if (
        await askYes(rl, "Update staging SSH / path / URL?", true)
      ) {
        draft.staging = await promptRemote(rl, "Staging", draft.staging);
      }
      if (
        await askYes(rl, "Update production SSH / path / URL?", true)
      ) {
        draft.production = await promptRemote(rl, "Production", draft.production);
      }
    }

    if (
      await askYes(
        rl,
        "Configure Simply.com (account in config; API key in WPDEV_SIMPLY_API_KEY)?",
        false,
      )
    ) {
      const acc = (
        await ask(rl, "Simply.com account number", draft.simply?.account ?? "")
      )
        .trim()
        .toUpperCase();
      if (!/^S\d+$/.test(acc)) {
        throw new Error(
          `Invalid Simply account "${acc}". Use your Control Panel account (form S + digits).`,
        );
      }
      draft = { ...draft, simply: { account: acc } };
    }

    const apexForDns = inferApexFromConfig(draft, domainRaw);
    if (draft.simply && getSimplyApiKey() && apexForDns) {
      if (
        await askYes(
          rl,
          `Create Simply DNS (default: A record staging.${apexForDns}) and update staging hints in this config? (uses ${SIMPLY_API_KEY_ENV})`,
          false,
        )
      ) {
        const reportStagingDns = (lines: string[]): void => {
          for (const line of lines) console.error(line);
          if (!isPlaceholderRemoteHost(draft.staging.host)) {
            wroteStagingPlaceholders = false;
          }
        };
        try {
          const lines = await applySimplyStagingDnsToDraft(draft, apexForDns);
          reportStagingDns(lines);
        } catch (e) {
          if (e instanceof SimplyStagingDnsConflictError) {
            console.error(`\n${e.message}\n`);
            if (
              await askYes(
                rl,
                "Keep the existing Simply DNS at that name and only update staging.url / hints here? (no API change)",
                true,
              )
            ) {
              try {
                const lines = await applySimplyStagingDnsToDraft(draft, apexForDns, {
                  onDifferentExistingA: "config-only",
                });
                reportStagingDns(lines);
              } catch (e2) {
                console.error(
                  `Simply staging DNS failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
                );
              }
            } else {
              const alt = await askOptional(
                rl,
                'Alternate DNS label instead of "staging" (e.g. dev → dev.<domain>). Leave empty to skip',
                "",
              );
              if (alt.trim()) {
                try {
                  const label = sanitizeStagingDnsLabel(alt);
                  const lines = await applySimplyStagingDnsToDraft(draft, apexForDns, {
                    stagingLabel: label,
                  });
                  reportStagingDns(lines);
                } catch (e2) {
                  if (e2 instanceof SimplyStagingDnsConflictError) {
                    console.error(`\n${e2.message}\n`);
                    console.error(
                      "That name is also in use at Simply. Edit DNS in the panel or pick another label.\n",
                    );
                  } else {
                    console.error(
                      `Simply staging DNS failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
                    );
                  }
                }
              } else {
                console.error("Skipped Simply staging DNS changes.\n");
              }
            }
          } else {
            console.error(
              `Simply staging DNS failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    } else if (draft.simply && apexForDns && !getSimplyApiKey()) {
      console.error(
        `\nSimply account is in config but ${SIMPLY_API_KEY_ENV} is not set — skipping API staging DNS. Set the key and run: wp-dev simply setup-staging-dns\n`,
      );
    }

    try {
      writeWpDevConfig(configDir, draft);
    } catch (e) {
      if (e instanceof ZodError) {
        const msg = e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("\n");
        throw new Error(`Invalid configuration:\n${msg}`);
      }
      throw e;
    }

    const path = `${configDir}/wp-dev.config.json`.replace(/\\/g, "/");
    logInfo(`init wrote ${path}`);
    console.error(`\nSaved: ${path}\n`);
    if (wroteStagingPlaceholders) {
      console.error(
        "Staging in config is placeholder-only until you set a real host/path/URL. Do not run pull staging / push staging until then — see README (Staging is optional).\n",
      );
    }
  } finally {
    rl.close();
  }
}
