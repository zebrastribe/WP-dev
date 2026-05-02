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
): Promise<WpDevConfig["staging"]> {
  console.error(`\n--- ${title} ---`);
  const host = await ask(rl, "SSH hostname", cur.host);
  const user = await ask(rl, "SSH username", cur.user);
  const portRaw = await askOptional(
    rl,
    "SSH port (empty = omit from config; SSH then uses port 22)",
    cur.port != null ? String(cur.port) : "",
  );
  const pathVal = await ask(rl, "Remote WordPress root path", cur.path);
  const urlRaw = await ask(rl, "Site URL (https://…)", cur.url);
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
        "wp-dev init — updates wp-dev.config.json (no pull/push).",
        "",
        "SSH keys: init does NOT create keys. It only saves an optional identityFile path to an existing private key file.",
        "  • Leave identity file empty → OpenSSH defaults (~/.ssh/config, ssh-agent, default key names).",
        "  • Or enter a path, e.g. ~/.ssh/id_ed25519 (never paste the key contents here).",
        "  Create a key with: ssh-keygen -t ed25519; add the .pub line to the server authorized_keys.",
        "",
        "Simply.com: optional account number here; API key only via env WPDEV_SIMPLY_API_KEY (never stored in this file).",
        "",
      ].join("\n"),
    );

    draft.project = await ask(rl, "Project id (unique per clone)", draft.project);

    const localUrlRaw = await ask(rl, "Local site URL", draft.local.url);
    draft.local.url = normalizeSiteUrl(localUrlRaw, "http");

    if (
      await askYes(
        rl,
        "Update staging SSH / path / URL in wp-dev.config.json?",
        true,
      )
    ) {
      draft.staging = await promptRemote(rl, "Staging", draft.staging);
    }

    if (
      await askYes(
        rl,
        "Update production SSH / path / URL in wp-dev.config.json?",
        true,
      )
    ) {
      draft.production = await promptRemote(rl, "Production", draft.production);
    }

    if (
      await askYes(
        rl,
        "Configure Simply.com API (save account S-number in config; API key only via WPDEV_SIMPLY_API_KEY)?",
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
