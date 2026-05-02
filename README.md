# wp-dev

Local **WordPress in Docker** (MySQL + Apache) plus a small CLI to **pull** or **push** files and database to **staging** / **production** over SSH (rsync + WP-CLI).

---

## What you need

- **Node.js** 20+  
- **Docker** + **Docker Compose v2** (`docker compose`) — checked automatically by **`npm run setup`** and before **`wp-dev up`** / **`down`**.  
- **pull** / **push** only: `ssh`, `rsync`, **WP-CLI** on the remote WordPress root  

### SSH keys (summary)

**`wp-dev` never runs `ssh-keygen`.** You create keys yourself, put the **public** key on the server, then **`init`** can store the **private** key path (or leave it empty). Step-by-step: **[New site → SSH keypair](#ssh-keypair-not-created-by-wp-dev)** below.

### Simply.com API (optional)

Optional [Simply.com API](https://www.simply.com/en/docs/api/): add **`simply.account`** to `wp-dev.config.json`, set **`WPDEV_SIMPLY_API_KEY`**, then **`npx wp-dev simply test`**. WordPress sync stays **`pull`** / **`push`** over SSH.

---

## Quick start (minimal steps)

### 1. Clone and enter the repo

```bash
git clone https://github.com/zebrastribe/WP-dev.git ~/Documents/dev/WP-dev
cd ~/Documents/dev/WP-dev
```

### 2. One command: Docker check + install + build

```bash
npm run setup
```

This runs **`npm run check`** first (`docker version` + `docker compose version`), then **`npm install`** (creates **`wp-dev.config.json`** from the example if missing), then **`npm run build`**.

If Docker fails: install/start [Docker](https://docs.docker.com/get-docker/), ensure **Compose v2** works (`docker compose version`), then run **`npm run setup`** again.

Re-check Docker anytime: **`npm run check`**.

---

## New site: where you are, and when pull runs

The **cloned folder is the project** (it contains `package.json`, `docker/`, `src/`). You **`cd` into that folder** — there is no separate inner “wp-dev” directory to enter.

| Step | Command | What happens |
|------|---------|----------------|
| 1 | `git clone … <folder>` then `cd <folder>` | You have the **wp-dev** tooling repo on disk. |
| 2 | **`npm run setup`** | Checks **Docker**, **`npm install`**, creates **`wp-dev.config.json`** if missing, **`npm run build`**. **Does not** download WordPress from a remote. |
| 3 | **`npx wp-dev init`** (optional) | Writes SSH/URLs into **`wp-dev.config.json`**. Still **no** `pull`. |
| 4 | **`npx wp-dev up`** | Starts **local** MySQL + WordPress in Docker. |
| After that | **Either path below** | See **A** (new install) or **B** (copy from server). |

### A) Brand-new site (no remote to copy)

You **do not** run **`pull`**.

1. After **`wp-dev up`**, open **`local.url`** in the browser and complete the **WordPress installer**.
2. Use **`push`** later only when you want to send this local site to staging/production.

### B) Copy an existing site from staging or production

**`pull` is when** the remote database and files are downloaded and imported locally (and URLs rewritten to your **`local.url`**).

Typical order:

1. **SSH keypair** ready and **public key** on the server (see next section).
2. **`npx wp-dev init`** — correct **SSH host**, **user**, **path**, **URLs** (or use domain guesses).
3. **`npx wp-dev up`** — local Docker running so **WP-CLI** can import the DB.
4. **`npx wp-dev pull staging`** or **`npx wp-dev pull production`** — **this step** does the sync.

You can use **`--dry-run`** on `pull` first to preview **rsync** only.

### SSH keypair (not created by wp-dev)

Do this **before** your first successful **`pull`** / **`push`** (once per machine, or reuse an existing key).

1. Generate a key (example path):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "your@email"
   ```

   (Passphrase optional; empty is fine for dev if you accept the risk.)

2. Show the **public** key and install it on the **server** for the SSH user you put in `wp-dev.config.json`:

   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```

   Append that single line to **`~/.ssh/authorized_keys`** on the server (or use your host’s “SSH keys” UI).

3. Test login:

   ```bash
   ssh -i ~/.ssh/id_ed25519 YOUR_USER@YOUR_HOST
   ```

4. In **`wp-dev init`**, either:
   - leave **identity file** empty if OpenSSH already picks this key, or  
   - enter **`~/.ssh/id_ed25519`** so `wp-dev` passes **`identityFile`** to SSH explicitly.

---

### 3. Config (optional)

- **`npx wp-dev init`** — asks for **`project`**, **`local.url`**, then optionally a **main domain** (e.g. `stri.be`). From that it suggests **`staging.<domain>`**, **`/var/www/<slug>`** (dots → hyphens, e.g. `stri-be`), and **`https://staging.<domain>`** / production equivalents; one shared SSH user + optional key; or leave the domain empty to set staging and production separately.
- Or edit **`wp-dev.config.json`** by hand.

### 4. Port clash (optional)

If **8888** is busy: `cp docker/.env.example docker/.env`, set **`WP_PORT`**, match **`local.url`**.

### 5. Start WordPress

```bash
npx wp-dev up
```

Then follow **[New site](#new-site-where-you-are-and-when-pull-runs)** → **A** (browser install, no pull) or **B** (pull after SSH + init are correct).

---

## Commands you will use

| Command | What it does |
|---------|----------------|
| `npm run check` | Verify Docker + Compose only (no install) |
| `npx wp-dev init` | Interactive config → **`wp-dev.config.json`** |
| `npx wp-dev up` / `down` | Start / stop Docker stack (checks Docker first) |
| `npx wp-dev pull` / `push` | Sync with staging or production |
| `npx wp-dev backup` / `restore` | DB export / import |
| `npx wp-dev logs` | Tail **`logs/wp-dev.log`** |
| `npx wp-dev simply test` | [Simply.com](https://www.simply.com/en/docs/api/) API check |

**`--dry-run`** on **pull** / **push** previews rsync only.

---

## Logging

**`logs/wp-dev.log`** next to `wp-dev.config.json` (gitignored). **`npx wp-dev logs`** shows the path and recent lines.

---

## Tests and CI

```bash
npm test
```

CI runs **`npm run check`**, **`npm ci`**, **`npm test`**, **`npm run build`** on **`main`**.

---

## Public repo / safety

Gitignored: **`wp-dev.config.json`**, **`docker/.env`**, **`wordpress/*`**, **`logs/`**. Template: **`wp-dev.config.example.json`**.

Old **`wpflow.config.json`** → rename to **`wp-dev.config.json`** or re-run **`npm install`**.

Design notes: **`purpose/dev-envmd`**.
