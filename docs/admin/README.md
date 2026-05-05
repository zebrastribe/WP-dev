# wp-dev — browser wizard & docs

Vite + React + Tailwind app served from your **local WordPress URL** at **`/admin/`** (e.g. `http://localhost:8888/admin/`) after you build into **`wordpress/admin/`**.

## What it does

| Area | Description |
|------|--------------|
| **Setup wizard** | Multi-step host-agnostic form: project, local URL, Production Host, Staging Host, optional Provider integration — **saves `wp-dev.config.json`** in the repo root via **`api.php`** (same port as WordPress). |
| **Documentation** | In-app copy of the main workflows; per-section **notes** in `localStorage`. |
| **Config assistant** | Tab under Documentation: form + raw JSON for power users. |

Wizard utilities:
- SSH key setup guide + copyable SSH test command buttons in Production/Staging steps.
- Staging domain check button (DNS + HTTPS + HTTP redirect + final host match).

## Build & open

From the **repository root** (after `npm run setup` or at least `npm ci --prefix docs/admin`):

```bash
npm run admin:build:wp
wp-dev up
# Browser: http://localhost:<WP_PORT>/admin/   (WP_PORT in docker/.env, default 8888)
```

Dev UI against live API (Docker on 8888):

```bash
npm run admin:dev
# Opens Vite; /admin/api.php is proxied to http://127.0.0.1:8888
```

## How save works

`docker-compose.yml` bind-mounts **`wp-dev.config.json`** and **`logs/`** at **`/wp-dev-repo/`** in the **`wordpress`** service. `wordpress/admin/api.php` (from this package’s `public/api.php`) writes **`/wp-dev-repo/wp-dev.config.json`** and appends API lines to **`/wp-dev-repo/logs/`**. Config shape is validated against **`wp-dev.config.schema.json`** (generated from the same Zod schema as the CLI via **`npm run generate:config-artifacts`** at the repo root).

Optional **`WPDEV_ADMIN_SAVE_TOKEN`** in **`docker/.env`** — if set, POST must send header **`X-WP-DEV-Admin-Token`** with the same value (wizard last step).

## Layout note

Dashboard chrome is inspired by the open [TailAdmin](https://tailadmin.com/) style (Tailwind admin). This folder does not ship TailAdmin’s commercial template assets.
