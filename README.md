# WP-dev

**WordPress on your computer** (Docker) plus **pull / push** to staging or production over SSH.

WP-dev does **not** host your live servers — it syncs with servers you already have.

This repository is the **public localhost tool** (CLI + optional `/admin/` UI). A future private cloud control plane (if used) is a separate repo — you do not need it for local work. See [docs/developer/project-structure.md](docs/developer/project-structure.md).

---

## Features

- Local WordPress in Docker (MySQL + Apache)
- **Pull / push** database and files via SSH and rsync
- Optional browser UI at `/admin/` — **Backup · Setup staging · Sync** (Advanced for power tools)
- **Theme-only** day-to-day sync (default); full-site after Preview
- **DB backups** before destructive sync when WordPress is already installed
- Staging sync/restore requires **host confirm** (`--confirm-host`); production stays gated
- Restore paths limited to `~/.wp-dev/backups/<project>/<env>/` (symlinks that escape are refused)
- Full backups exclude build junk (`node_modules`, `.git`)
- Bind mounts and `.env` / backup ownership follow the **installing host user** (`WPDEV_HOST_UID`), not a fixed username
- Service + filesystem managers (ports, health, permissions on up/pull)
- macOS and Linux

---

## Requirements

- [ ] **Node.js 20+**
- [ ] **Docker** with Compose v2 (`docker compose version`)
- [ ] **Git**
- [ ] For sync: server with **SSH**, **rsync**, and **WP-CLI**

Works on **macOS** and **Linux**. On Mac, install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and keep the project under your home folder.

---

## Install

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup
```

**macOS (fastest first run):**

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run quickstart
```

Verify:

```bash
npm run check
```

→ [Full installation guide](docs/getting-started/installation.md)

---

## Update

Update the **tool** — your site in `wordpress/` is kept:

```bash
npm run wp-dev -- update
```

Or use **Advanced → Update** in `/admin/`.

→ [Update guide](docs/getting-started/update.md)

---

## Configure SSH

WP-dev uses **SSH keys**, not passwords.

**1. Create a key (once per computer):**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
```

**macOS — remember after reboot:**

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

**2. Upload the public key** to your host (control panel or `authorized_keys`):

```bash
cat ~/.ssh/id_ed25519.pub
```

**3. Test:**

```bash
ssh user@your-ssh-host.example.com
```

**4. Add to WP-dev** — **Setup staging** in `/admin/` or:

```bash
npm run wp-dev -- init
```

→ [SSH setup guide](docs/getting-started/ssh.md)

---

## Create your first project

**1. Start WordPress locally:**

```bash
npm run wp-dev -- up
```

**2. Open the browser admin:**

```
http://localhost:8888/admin/
```

Use **Setup staging** to save SSH/config, then **Sync** or **Backup** as needed. Unlock with the token in `docker/.env` → `WPDEV_ADMIN_SAVE_TOKEN` if prompted.

**3. Open your site:**

```
http://localhost:8888
```

Finish the WordPress installer, or continue to step 4 to copy a live site.

**4. (Optional) Pull an existing site:**

```bash
npm run wp-dev -- doctor production
npm run wp-dev -- pull production
```

→ [First project guide](docs/getting-started/first-project.md)

---

## Browser admin (optional)

| Tab | Purpose |
|-----|---------|
| **Backup** | Snapshot Dev / Staging / Production; restore on the same page |
| **Setup staging** | SSH (or Simply), save config, verify |
| **Sync** | Theme-only (default) or full-site after Preview → Start |
| **Advanced** | Restore points, PHP versions, services, terminal, update, docs |

Header badges: **Dev** = stack online/offline; **Staging / Production** = host saved in config (not “safe to push”).

→ [Browser admin guide](docs/guides/browser-admin.md)

---

## Common commands

Run from the repo root:

```bash
npm run wp-dev -- <command>
```

| Command | What it does |
|---------|----------------|
| `up` | Start local WordPress |
| `down` | Stop local stack |
| `status` | Health check and recent backups |
| `init` | Set up config in the terminal |
| `pull production` | Download site from production |
| `pull staging` | Download site from staging |
| `push staging` | Upload site to staging |
| `push theme staging --build` | Deploy theme only (safer day-to-day) |
| `doctor` | Test SSH and WordPress connections |
| `doctor --filesystem` | Check permissions and paths |
| `update` | Update WP-dev from git |
| `backup local` | Save database backup |
| `backup local --files` | Full archive (DB + wp-content; excludes `node_modules`) |
| `restore local <file>` | Restore a backup under `~/.wp-dev/backups/<project>/local/` |
| `services` | Show ports and service health |
| `logs` | Show recent log lines |
| `--help` | Full command list |

**Port conflicts:**

```bash
npm run wp-dev -- up --relocate-ports
npm run wp-dev -- up --reclaim-ports
```

→ [Command reference](docs/reference/commands.md)

---

## Where to learn more

| Topic | Documentation |
|-------|----------------|
| **All documentation** | [docs/README.md](docs/README.md) |
| Sync pull and push | [guides/syncing.md](docs/guides/syncing.md) |
| Theme deploy | [guides/theme-deploy.md](docs/guides/theme-deploy.md) |
| Backups and restore | [guides/backups.md](docs/guides/backups.md) |
| Browser admin | [guides/browser-admin.md](docs/guides/browser-admin.md) |
| Permissions | [guides/permissions.md](docs/guides/permissions.md) |
| Ports | [guides/ports.md](docs/guides/ports.md) |
| Shared hosting | [guides/shared-hosting.md](docs/guides/shared-hosting.md) |
| Troubleshooting | [troubleshooting/](docs/troubleshooting/index.md) |
| FAQ | [reference/faq.md](docs/reference/faq.md) |
| Configuration | [reference/configuration.md](docs/reference/configuration.md) |
| Environment variables | [reference/environment-variables.md](docs/reference/environment-variables.md) |
| Contribute | [developer/contributing.md](docs/developer/contributing.md) |
| Repo layout (public vs private cloud) | [developer/project-structure.md](docs/developer/project-structure.md) |
| Optional import / content recovery | [content-recovery-workspace/README.md](content-recovery-workspace/README.md) |

---

## License

ISC — see [package.json](package.json).
