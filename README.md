# wp-dev

Local **WordPress in Docker** (MySQL + Apache) plus a small CLI to **pull** or **push** files and database to **staging** / **production** over SSH (rsync + WP-CLI).

---

## What you need

- **Node.js** 20 or newer  
- **Docker** with Compose v2  
- For **pull** / **push** only: `ssh`, `rsync`, SSH access to the server, **WP-CLI** on the remote WordPress root  

### SSH keys and `wp-dev init`

**`init` does not create or install SSH keys.** It only saves what you type into `wp-dev.config.json`:

- **`identityFile` (optional):** path to an **existing** private key file (for example `~/.ssh/id_ed25519`). Only the **path** is stored; never paste the private key into the terminal.
- **If you leave that empty:** the CLI uses normal OpenSSH behavior (`~/.ssh/config`, **ssh-agent**, default key filenames like `id_ed25519` / `id_rsa`).

To set up keys from scratch: run `ssh-keygen -t ed25519 -C "you@example"` on your machine, then add the **`.pub`** line to the server user’s `~/.ssh/authorized_keys`.

### Simply.com API (optional hosting automation)

Official docs: **[Simply.com API](https://www.simply.com/en/docs/api/)** — REST JSON at `https://api.simply.com/2/`, **HTTP Basic** auth (username = account number `S…`, password = API key from the Simply control panel).

**In this project:**

1. Add **`simply.account`** (e.g. `"S123456"`) to `wp-dev.config.json`, or run **`wp-dev init`** and accept the Simply step.
2. Set the API key **only in the environment** (not in the JSON file):  
   `export WPDEV_SIMPLY_API_KEY='your-api-key'`
3. Run **`npx wp-dev simply test`** — calls **`GET /my/products/`** to verify credentials.

That checks connectivity to Simply’s API. **Deploying WordPress files/DB** to staging/production is still done with **`pull`** / **`push`** over SSH; you can use the Simply API separately for DNS, products, or other endpoints listed in their [OpenAPI doc](https://api.simply.com/2/doc/).

---

## Quick start (follow in order)

### 1. Clone and go into the project

Use any folder you like; this example clones next to your other dev work:

```bash
git clone https://github.com/zebrastribe/WP-dev.git ~/Documents/dev/WP-dev
cd ~/Documents/dev/WP-dev
```

### 2. One command: install, default config, and build

Runs `npm install` (which creates **`wp-dev.config.json`** from the example if it is missing), then compiles the CLI to **`dist/`**.

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
npx wp-dev init
```

Asks for **`project`**, **`local.url`**, and (if you choose to update them) **staging** / **production**: SSH host, user, optional **port**, remote WordPress **path**, site **URL**, and optional **private key file path** (path only — never paste key contents). Updates **`wp-dev.config.json`** in this repo.

Requires a normal terminal (TTY). Skip any remote block with **n** at the “Update …?” prompt to leave existing values.

**Option B — editor:** open **`wp-dev.config.json`** and set the same fields yourself.

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

Edit **`docker/.env`** and set e.g. `WP_PORT=8890`, then set **`local.url`** in `wp-dev.config.json` to match (`http://localhost:8890`).

### 5. Start WordPress

```bash
npx wp-dev up
```

Site files live in **`wordpress/`** (bind-mounted into the container). The **`wpcli`** service runs WP-CLI; that is the default **`composeService`** in config.

Then either:

- Open **`local.url`** and complete the WordPress installer, or  
- When SSH remotes are correct: **`npx wp-dev pull production`** (or `staging`) to copy a live site down.

---

## Commands you will use

| Command | What it does |
|---------|----------------|
| `npx wp-dev init` | Interactive **SSH / URL** setup → writes **`wp-dev.config.json`** (no sync) |
| `npx wp-dev up` | Start Docker (MySQL + WordPress + wpcli) |
| `npx wp-dev down` | Stop Docker |
| `npx wp-dev pull staging` or `production` | Remote → local (DB + files, then URL replace) |
| `npx wp-dev push staging` or `production` | Local → remote (production asks you to type `yes`) |
| `npx wp-dev backup local` (or `staging` / `production`) | SQL-only backup under `~/.wp-dev/backups/...` |
| `npx wp-dev restore <env> <file.sql>` | Import a SQL dump |
| `npx wp-dev logs` | Show **`logs/wp-dev.log`** path and recent lines (`-n 200` for more) |
| `npx wp-dev simply test` | Check [Simply.com API](https://www.simply.com/en/docs/api/) credentials (`WPDEV_SIMPLY_API_KEY` + `simply.account` in config) |

Use **`--dry-run`** on **pull** or **push** to preview **rsync** only (no database steps).

---

## Logging

Runs append lines to **`logs/wp-dev.log`** next to `wp-dev.config.json` (`logs/` is gitignored). Warnings and errors are also printed to the terminal. **`npx wp-dev logs`** prints the path and tail of the file.

---

## Tests and CI

```bash
npm test
```

On GitHub, **Actions** runs `npm ci`, `npm test`, and `npm run build` on pushes and pull requests to **`main`**.

---

## Public repo / safety

Safe to share the repo if you **never commit** real secrets. These paths are **gitignored**: `wp-dev.config.json`, `docker/.env`, `wordpress/*` (except `.gitkeep`), `logs/`. Use **`wp-dev.config.example.json`** as the template only.

If you still have an old **`wpflow.config.json`**, rename it to **`wp-dev.config.json`** (or delete it and run **`npm install`** so the example is copied again).

**`wp-config.php`** is excluded from rsync so your local Docker DB settings are not overwritten when you pull from a server.

Design notes: **`purpose/dev-envmd`**.
