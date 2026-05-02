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
  try {
    console.error(
      [
        "",
        "wp-dev init — writes wp-dev.config.json (no pull/push).",
        "SSH: optional key file path only; empty = OpenSSH defaults.",
        "",
      ].join("\n"),
    );

    draft.project = await ask(rl, "Project id (unique per clone)", draft.project);

    const localUrlRaw = await ask(rl, "Local site URL", draft.local.url);
    draft.local.url = normalizeSiteUrl(localUrlRaw, "http");

    const domainRaw = await askOptional(
      rl,
      "Main site domain (e.g. stri.be) — guesses staging./prod hosts and /var/www/<slug> paths [empty = configure staging & production separately]",
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
          `  production: ssh ${prSug.host}  path ${prSug.path}  url ${prSug.url}\n`,
      );

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
          "Use these guessed hosts/paths/URLs (you can re-run init to change)?",
          true,
        )
      ) {
        draft.staging = applyRemoteGuess(stSug, user, identityFile, sharedPort);
        draft.production = applyRemoteGuess(prSug, user, identityFile, sharedPort);
      } else {
        draft.staging = await promptRemote(rl, "Staging", draft.staging, stSug);
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
      if (!/^S\d+$/i.test(acc)) {
        throw new Error(
          `Invalid Simply account "${acc}". Use your Control Panel account (form S + digits).`,
        );
      }
      draft = { ...draft, simply: { account: acc } };
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
  } finally {
    rl.close();
  }
}
