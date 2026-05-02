# wp-dev

Local **WordPress in Docker** (MySQL + Apache) plus a small CLI to **pull** or **push** files and database to **staging** / **production** over SSH (rsync + WP-CLI).

---

## What you need

- **Node.js** 20+  
- **Docker** + **Docker Compose v2** (`docker compose`) — checked automatically by **`npm run setup`** and before **`wp-dev up`** / **`down`**.  
- **pull** / **push** only: `ssh`, `rsync`, **WP-CLI** on the remote WordPress root  

### SSH keys and `wp-dev init`

**`init` does not create SSH keys.** It only saves optional **`identityFile`** (path to an existing private key). Leave it empty to use OpenSSH defaults (`~/.ssh/config`, agent, default key names). See **`ssh-keygen`** + **`authorized_keys`** to create keys.

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

### 3. Config (optional)

- **`npx wp-dev init`** — interactive; or edit **`wp-dev.config.json`** (`project`, `local.url`, staging/production SSH).

### 4. Port clash (optional)

If **8888** is busy: `cp docker/.env.example docker/.env`, set **`WP_PORT`**, match **`local.url`**.

### 5. Start WordPress

```bash
npx wp-dev up
```

Open **`local.url`** (installer) or **`npx wp-dev pull production`** when remotes are ready.

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
