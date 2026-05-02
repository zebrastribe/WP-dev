# wpflow

Local **WordPress in Docker** (MySQL + Apache) plus a small CLI to **pull** or **push** files and database to **staging** / **production** over SSH (rsync + WP-CLI).

---

## What you need

- **Node.js** 20 or newer  
- **Docker** with Compose v2  
- For **pull** / **push** only: `ssh`, `rsync`, SSH access to the server, **WP-CLI** on the remote WordPress root  

---

## Quick start (follow in order)

### 1. Clone and go into the project

Use any folder you like; this example clones next to your other dev work:

```bash
git clone https://github.com/zebrastribe/WP-dev.git ~/Documents/dev/WP-dev
cd ~/Documents/dev/WP-dev
```

### 2. One command: install, default config, and build

Runs `npm install` (which creates **`wpflow.config.json`** from the example if it is missing), then compiles the CLI to **`dist/`**.

```bash
npm run setup
```

Same effect as:

```bash
npm install && npm run build
```

### 3. Configure remotes (interactive) or edit the file by hand

**Option A — prompts (no pull/push, only writes config):**

```bash
npx wpflow init
```

Asks for **`project`**, **`local.url`**, and (if you choose to update them) **staging** / **production**: SSH host, user, optional **port**, remote WordPress **path**, site **URL**, and optional **private key file path** (path only — never paste key contents). Updates **`wpflow.config.json`** in this repo.

Requires a normal terminal (TTY). Skip any remote block with **n** at the “Update …?” prompt to leave existing values.

**Option B — editor:** open **`wpflow.config.json`** and set the same fields yourself.

| Field | Purpose |
|------|---------|
| **`project`** | Short **unique** name per clone (`docker compose -p`, backups). |
| **`local.url`** | Browser URL (often `http://localhost:8888`). |
| **`staging` / `production`** | `host`, `user`, `path`, `url`; optional `port`, `identityFile`. |

### 4. (Optional) Change the HTTP port

Only if **8888** is already in use:

```bash
cp docker/.env.example docker/.env
```

Edit **`docker/.env`** and set e.g. `WP_PORT=8890`, then set **`local.url`** in `wpflow.config.json` to match (`http://localhost:8890`).

### 5. Start WordPress

```bash
npx wpflow up
```

Site files live in **`wordpress/`** (bind-mounted into the container). The **`wpcli`** service runs WP-CLI; that is the default **`composeService`** in config.

Then either:

- Open **`local.url`** and complete the WordPress installer, or  
- When SSH remotes are correct: **`npx wpflow pull production`** (or `staging`) to copy a live site down.

---

## Commands you will use

| Command | What it does |
|---------|----------------|
| `npx wpflow init` | Interactive **SSH / URL** setup → writes **`wpflow.config.json`** (no sync) |
| `npx wpflow up` | Start Docker (MySQL + WordPress + wpcli) |
| `npx wpflow down` | Stop Docker |
| `npx wpflow pull staging` or `production` | Remote → local (DB + files, then URL replace) |
| `npx wpflow push staging` or `production` | Local → remote (production asks you to type `yes`) |
| `npx wpflow backup local` (or `staging` / `production`) | SQL-only backup under `~/.wpflow/backups/...` |
| `npx wpflow restore <env> <file.sql>` | Import a SQL dump |
| `npx wpflow logs` | Show **`logs/wpflow.log`** path and recent lines (`-n 200` for more) |

Use **`--dry-run`** on **pull** or **push** to preview **rsync** only (no database steps).

---

## Logging

Runs append lines to **`logs/wpflow.log`** next to `wpflow.config.json` (`logs/` is gitignored). Warnings and errors are also printed to the terminal. **`npx wpflow logs`** prints the path and tail of the file.

---

## Tests and CI

```bash
npm test
```

On GitHub, **Actions** runs `npm ci`, `npm test`, and `npm run build` on pushes and pull requests to **`main`**.

---

## Public repo / safety

Safe to share the repo if you **never commit** real secrets. These paths are **gitignored**: `wpflow.config.json`, `docker/.env`, `wordpress/*` (except `.gitkeep`), `logs/`. Use **`wpflow.config.example.json`** as the template only.

**`wp-config.php`** is excluded from rsync so your local Docker DB settings are not overwritten when you pull from a server.

Design notes: **`purpose/dev-envmd`**.
