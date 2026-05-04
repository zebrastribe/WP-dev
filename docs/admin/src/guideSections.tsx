import type { FC, ReactNode } from "react";
import { ConfigAssistant } from "./ConfigAssistant";

function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="prose-docs max-w-none space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
      {children}
    </div>
  );
}

export const Overview: FC = () => (
  <Prose>
    <p className="text-base text-slate-600 dark:text-slate-400">
      Prefer a guided form? Open{" "}
      <strong>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
          http://localhost:{'<WP_PORT from docker/.env>'}/admin/
        </code>
      </strong>{" "}
      after <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev up</code> and{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run admin:build:wp</code> — use the{" "}
      <strong>Setup wizard</strong> tab first, then read the rest here.
    </p>
    <p className="text-base text-slate-600 dark:text-slate-400">
      <strong className="text-slate-900 dark:text-white">wp-dev</strong> is a CLI: local WordPress in Docker,
      plus <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">pull</code> /{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">push</code> of files and database to{" "}
      <strong>staging</strong> and <strong>production</strong> over SSH (rsync + WP-CLI). This page summarizes
      what you can do; the repo README is the full reference.
    </p>
    <ul className="list-inside list-disc space-y-1">
      <li>
        <strong>Project root</strong> — always run commands from the folder that contains{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">package.json</code> and{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code>.
      </li>
      <li>
        <strong>Local</strong> — <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev up</code>{" "}
        then open <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">local.url</code> in the browser.
      </li>
      <li>
        <strong>Staging / production</strong> — remotes for sync; they are not created automatically except
        optional Simply.com DNS helpers (see Simply tab).
      </li>
    </ul>
  </Prose>
);

export const SetupFlow: FC = () => (
  <Prose>
    <ol className="list-inside list-decimal space-y-2">
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run setup</code> — Docker check, install,
        build CLI.
      </li>
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev init</code> — interactive{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code> (no pull).
      </li>
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev up</code> /{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">down</code> — Docker Compose stack.
      </li>
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev doctor</code> — optional{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">--rsync</code> dry-run against remote.
      </li>
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev pull staging|production</code> — copy
        remote → local (default local DB pre-backup; <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">--no-backup-local</code> to skip).
      </li>
      <li>
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev push staging|production</code> — copy
        local → remote (pre-push remote DB dump saved under{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">~/.wp-dev/backups/</code>).
      </li>
    </ol>
  </Prose>
);

export const Environments: FC = () => (
  <Prose>
    <p>
      <strong>local</strong> — Docker only. <strong>staging</strong> / <strong>production</strong> — SSH targets in
      config (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">host</code>,{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">user</code>,{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">path</code>,{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">url</code>).{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">url</code> must match{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">siteurl</code> /{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">home</code> on that environment for
      search-replace.
    </p>
    <p>
      Placeholder staging (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.invalid</code>) means do
      not run <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">pull staging</code> until you replace
      with real SSH details.
    </p>
  </Prose>
);

export const Commands: FC = () => (
  <Prose>
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
        <thead className="bg-slate-100 dark:bg-slate-800/80">
          <tr>
            <th className="border-b border-slate-200 p-2 dark:border-slate-700">Command</th>
            <th className="border-b border-slate-200 p-2 dark:border-slate-700">Purpose</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[11px]">
          {[
            ["init", "Interactive config"],
            ["up / down", "Docker stack"],
            ["doctor [--rsync]", "Checks + optional rsync dry-run"],
            ["pull <env> [--dry-run] [--no-backup-local]", "Remote → local"],
            ["push <env> [--dry-run]", "Local → remote"],
            ["backup <env>", "DB dump to ~/.wp-dev/backups/…"],
            ["restore <env> <file.sql>", "Import DB (destructive)"],
            ["fix-permissions", "chown wordpress/ for rsync"],
            ["logs", "Tail project log file"],
            ["simply test", "Simply API GET /my/products/"],
            [
              "simply setup-staging-dns [apex]",
              "Simply DNS + staging hints; --keep-existing-dns, --staging-label",
            ],
          ].map(([cmd, desc], i) => (
            <tr key={`${i}-${cmd}`} className="border-b border-slate-100 dark:border-slate-800/80">
              <td className="p-2 align-top text-brand-700 dark:text-brand-400">{cmd}</td>
              <td className="p-2 text-slate-600 dark:text-slate-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Prose>
);

export const PullPush: FC = () => (
  <Prose>
    <ul className="list-inside list-disc space-y-2">
      <li>
        <strong>pull --dry-run</strong> — rsync preview only; no DB import.
      </li>
      <li>
        <strong>pull</strong> — by default exports local DB to{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">pre-pull-*.sql</code> before overwriting (skip
        on first install). Use <strong>--no-backup-local</strong> to skip.
      </li>
      <li>
        <strong>push</strong> — saves remote DB to <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">pre-push-*.sql</code> before replacing remote DB.
      </li>
      <li>
        SSH is key-based only; shared hosts often need the panel SSH hostname (not the public domain).
      </li>
    </ul>
  </Prose>
);

export const Backups: FC = () => (
  <Prose>
    <p>
      Database backups: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev backup local|staging|production</code>{" "}
      → <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">~/.wp-dev/backups/&lt;project&gt;/&lt;env&gt;/</code>.
    </p>
    <p>
      Restore: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev restore &lt;env&gt; &lt;file.sql&gt;</code>{" "}
      (overwrites DB on target; production asks for confirmation).
    </p>
    <p>
      Files and WordPress core are <strong>not</strong> snapshotted by wp-dev — use Git, hosting backups, or archives.
    </p>
  </Prose>
);

export const SimplyDns: FC = () => (
  <Prose>
    <p>
      Optional <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">simply.account</code> in config + env{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_SIMPLY_API_KEY</code>.{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">simply setup-staging-dns</code> can add an{" "}
      <strong>A</strong> record for <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">&lt;label&gt;.&lt;apex&gt;</code>{" "}
      (default label <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">staging</code>) and patch staging URL / hints.
    </p>
    <ul className="list-inside list-disc space-y-1">
      <li>
        <strong>Conflict</strong> (existing A to another IP, or CNAME, etc.): wp-dev does <strong>not</strong> overwrite. Use{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">--keep-existing-dns</code> (config only) or{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">--staging-label dev</code> for another hostname.
      </li>
      <li>
        <strong>init</strong> — after Simply account, if the API key is set, you may be prompted for the same choices interactively.
      </li>
    </ul>
    <p className="text-xs text-slate-500">
      API reference:{" "}
      <a
        href="https://www.simply.com/en/docs/api/"
        className="text-brand-600 underline dark:text-brand-400"
        target="_blank"
        rel="noreferrer"
      >
        simply.com/docs/api
      </a>
    </p>
  </Prose>
);

export const Updating: FC = () => (
  <Prose>
    <p>
      From the project clone root: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">git pull</code>, then{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm install</code> and{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run build</code> (or{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run setup</code>). Ignored paths (config,{" "}
      <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wordpress/</code>, <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code>) are not touched by git.
    </p>
  </Prose>
);

export type NavId =
  | "overview"
  | "setup"
  | "environments"
  | "commands"
  | "pullpush"
  | "backups"
  | "simply"
  | "updating"
  | "config";

export const NAV_ITEMS: { id: NavId; label: string; Component: FC }[] = [
  { id: "overview", label: "Overview", Component: Overview },
  { id: "setup", label: "Setup flow", Component: SetupFlow },
  { id: "environments", label: "Environments", Component: Environments },
  { id: "commands", label: "Commands", Component: Commands },
  { id: "pullpush", label: "Pull & push", Component: PullPush },
  { id: "backups", label: "Backups", Component: Backups },
  { id: "simply", label: "Simply.com DNS", Component: SimplyDns },
  { id: "updating", label: "Updating wp-dev", Component: Updating },
  { id: "config", label: "Config assistant", Component: ConfigAssistant },
];
