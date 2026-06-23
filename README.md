# WP-dev

Run **WordPress on your computer** with Docker, then **pull** and **push** your site to staging or production over SSH.

WP-dev does **not** host your live servers — it only syncs with servers you already have.

---

## Features

- Local WordPress in Docker (MySQL + Apache)
- **Pull** / **push** database and files via SSH and rsync
- Browser **setup wizard** at `/admin/`
- Automatic **backups** before sync
- **Theme-only** deploy (without overwriting production database)
- **Service manager** — ports, health, lifecycle
- **Filesystem manager** — permissions fixed automatically on up/pull
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

Or use the **Update** tab in `/admin/`.

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

**4. Add to WP-dev** — wizard at `/admin/` or:

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

**2. Open the setup wizard:**

```
http://localhost:8888/admin/
```

Follow the steps and click **Save** (token is in `docker/.env` → `WPDEV_ADMIN_SAVE_TOKEN` if prompted).

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
| `push theme production --build` | Deploy theme only (safer for production) |
| `doctor` | Test SSH and WordPress connections |
| `doctor --filesystem` | Check permissions and paths |
| `update` | Update WP-dev from git |
| `backup local` | Save database backup |
| `restore local <file>` | Restore a backup |
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
| Backups and restore | [guides/backups.md](docs/guides/backups.md) |
| Browser wizard | [guides/browser-admin.md](docs/guides/browser-admin.md) |
| Permissions | [guides/permissions.md](docs/guides/permissions.md) |
| Ports | [guides/ports.md](docs/guides/ports.md) |
| Shared hosting | [guides/shared-hosting.md](docs/guides/shared-hosting.md) |
| Troubleshooting | [troubleshooting/](docs/troubleshooting/index.md) |
| FAQ | [reference/faq.md](docs/reference/faq.md) |
| Configuration | [reference/configuration.md](docs/reference/configuration.md) |
| Environment variables | [reference/environment-variables.md](docs/reference/environment-variables.md) |
| Contribute | [developer/contributing.md](docs/developer/contributing.md) |

---

## License

ISC — see [package.json](package.json).
