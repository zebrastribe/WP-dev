# wpflow

Small CLI for a **self-contained WordPress dev setup**: Docker (MySQL + WordPress on your machine), plus optional **pull** / **push** of files and database to staging or production over SSH (rsync + WP-CLI).

## Should you put this on GitHub?

Yes, if you want a reusable template or team workflow. Do **not** commit secrets: this repo ignores `wpflow.config.json` and `docker/.env`; each developer creates their own from the examples.

## Prerequisites

- **Node.js** 20+
- **Docker** (with Compose v2)
- For **pull** / **push**: `ssh`, `rsync`, SSH key access to the server, **WP-CLI** on the remote WordPress root

## New dev environment (from a clone)

1. **Clone** the repository to a folder of your choice (each clone has its own `wordpress/` tree and Docker project name).

2. **Install dependencies and build**

   ```bash
   cd /path/to/WP-dev
   npm install
   npm run build
   ```

   `npm install` creates `wpflow.config.json` from `wpflow.config.example.json` if it does not exist yet.

3. **Configure the project**

   Edit `wpflow.config.json`:

   - Set **`project`** to something **unique** per clone (used for `docker compose -p` and for `~/.wpflow/backups/<project>/`).
   - Set **`local.url`** to match how you will open the site (default port is in `docker/.env` or compose; example uses `http://localhost:8888`).
   - Set **`staging`** / **`production`** (`host`, `user`, `path`, `url`). Optional: `port`, `identityFile` for SSH.

4. **Optional: Docker env**

   ```bash
   cp docker/.env.example docker/.env
   ```

   Adjust `WP_PORT` if the default port is already in use (running two clones at once needs different ports).

5. **Start WordPress**

   ```bash
   npx wpflow up
   ```

   WordPress files live in **`wordpress/`** in the repo root (bind-mounted into the **wordpress** web container). WP-CLI runs in a separate **wpcli** service (`wordpress:cli-php8.2`), which is what `composeService` in config refers to by default.

6. **First content**

   - **Greenfield:** open `local.url` in a browser and run the WordPress installer.
   - **Copy an existing site:** after SSH and paths are correct, run e.g. `npx wpflow pull production` (see `npx wpflow --help` and `pull` / `push` help).

## Useful commands

| Command | Purpose |
|--------|---------|
| `npx wpflow up` | Start local stack |
| `npx wpflow down` | Stop local stack |
| `npx wpflow pull staging` \| `production` | Sync remote files + DB into local; URLs rewritten to `local.url` |
| `npx wpflow push staging` \| `production` | Sync local to remote (production asks for typing `yes`) |
| `npx wpflow backup <env>` | DB-only export under `~/.wpflow/backups/...` |
| `npx wpflow restore <env> <file.sql>` | Import a SQL backup |

Add **`--dry-run`** on `pull` or `push` to preview rsync only (no database steps).

## Notes

- **`wp-config.php`** is excluded from rsync so local Docker DB settings are not overwritten by remote config; adjust if your workflow differs.
- Global spec / design notes: `purpose/dev-envmd`.
