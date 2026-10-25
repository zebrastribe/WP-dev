# WP-dev

**WordPress on your computer** (Docker) plus **pull / push** to staging or production over SSH.

WP-dev does **not** host your live servers — it syncs with hosts you already control.

This repo is the **localhost CLI** (+ optional `/admin/` UI). Hosted / multi-tenant work is out of scope here — see [project structure](docs/developer/project-structure.md).

---

## Requirements

- **Node.js 20+**, **Docker** Compose v2, **Git**
- For sync: remote **SSH**, **rsync**, **WP-CLI**
- **Linux**, **macOS**, or **Windows via WSL2** (run inside Linux, project on `~/…` not `/mnt/c/…`)

---

## Install

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup          # or: npm run quickstart  (macOS)
npm run check
```

→ [Installation](docs/getting-started/installation.md)

---

## First run

```bash
npm run wp-dev -- up
```

- Site: `http://localhost:8888`
- Admin UI: `http://localhost:8888/admin/` — **Backup · Setup · Sync**  
  Unlock with `WPDEV_ADMIN_SAVE_TOKEN` from `docker/.env` if asked.

Configure SSH (keys, not passwords), then pull if you have a live site:

```bash
ssh user@your-host          # pin the host key once
npm run wp-dev -- init      # or use Setup in /admin/
npm run wp-dev -- doctor production
npm run wp-dev -- pull production
```

→ [First project](docs/getting-started/first-project.md) · [SSH](docs/getting-started/ssh.md)

---

## Important (read once)

| Rule | Why |
|------|-----|
| Keep `/admin/` and runner ports on **localhost** | Never publish them on the public internet |
| Prefer **theme-only** Sync for day-to-day | Full-site replaces files **and** database; no one-click Dev→Production |
| Leave **permissions** to WP-dev | Pull / restore / `up` reconcile ownership automatically — avoid `chmod 777` |
| Pin SSH hosts with OpenSSH first | Unknown hosts are refused unless you connect once (or lab-only insecure flag) |

Details: [permissions](docs/guides/permissions.md) · [syncing](docs/guides/syncing.md) · [browser admin](docs/guides/browser-admin.md)

---

## Update

```bash
npm run wp-dev -- update
```

Updates the **tool** only (`wordpress/` site files stay). After a major update, run `up` again so Docker picks up compose/mount changes.

→ [Update guide](docs/getting-started/update.md)

---

## Common commands

```bash
npm run wp-dev -- <command>
```

| Command | |
|---------|--|
| `up` / `down` / `status` | Local stack |
| `pull production` / `pull staging` | Download site |
| `push staging` | Upload full site |
| `push theme staging --build` | Theme only (safer) |
| `doctor` / `doctor --filesystem` | SSH / permissions checks |
| `backup local` / `restore local <file>` | Backups under `~/.wp-dev/backups/…` |
| `update` | Update WP-dev from git |
| `--help` | Full list |

→ [Command reference](docs/reference/commands.md)

---

## Docs

| | |
|--|--|
| Index | [docs/README.md](docs/README.md) |
| Sync · theme · backups | [syncing](docs/guides/syncing.md) · [theme deploy](docs/guides/theme-deploy.md) · [backups](docs/guides/backups.md) |
| Permissions · ports · shared hosting | [permissions](docs/guides/permissions.md) · [ports](docs/guides/ports.md) · [shared hosting](docs/guides/shared-hosting.md) |
| Troubleshooting · FAQ · config | [troubleshooting](docs/troubleshooting/index.md) · [FAQ](docs/reference/faq.md) · [configuration](docs/reference/configuration.md) |

---

## License

ISC — see [package.json](package.json).
