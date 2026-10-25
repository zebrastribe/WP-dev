# Browser admin (optional UI)

The optional browser UI lives at **`http://localhost:<WP_PORT>/admin/`** — same host and port as WordPress.

CLI remains fully usable without this UI (`wp-dev pull|push|backup|doctor|…`).

**Localhost only.** Do not expose `/admin/`, Docker runners, or the terminal on the public internet. Hosted control plane lives in the private [WP-dev-cloud](https://github.com/zebrastribe/WP-dev-cloud) plan.

## Open admin

After `wp-dev up`:

```
http://localhost:8888/admin/
```

(Port comes from `WP_PORT` in `docker/.env`.) Unlock once if prompted (token in `docker/.env`).

## Primary navigation

| Nav | Purpose |
|-----|---------|
| **Backup** | Snapshot Dev / Staging / Production; restore **on the same page** (database for Staging/Production; full DB+files for Dev) |
| **Setup** | Live SSH (production.*), optional staging, save config, verify, first backup |
| **Sync** | Day-to-day: **theme only** (configured theme folder). Full-site push/pull after Preview. |
| **Advanced** | Restore points list, copy config JSON, PHP versions, services/ports, terminal, update wp-dev, docs |

Header badges: **Dev** = stack online/offline; **Staging / Production** = “host saved” (config hostname), not “safe to push.”

### Sync (what to use when)

| Lane | Use for | CLI |
|------|---------|-----|
| **Theme only** (default) | Live theme files; does **not** touch DB or uploads | `push theme` / `pull theme` |
| **Full site** | Migrations / reseeding after Preview | `push` / `pull` |
| Full-site **Dev → Production** | Not offered in Sync primary (use CLI if you truly mean it) | `push production` |
| Staging ↔ Production | Hosted later (not faked on localhost) | — |

Full-site excludes (plugins, `node_modules`, etc.) are under Sync → “Full-site excludes” — they do **not** apply to Theme only.

### Backup / restore

- Staging/Production backups in the UI default to **database only** (those `.sql` files restore in the browser).
- Backup types: **Database**, **Content** (`backup --files`), and **Complete** (`backup --complete`) for Dev, Staging, and Production. Complete is best before updates; restore keeps live `wp-config.php`.
- **Advanced → Restore points** is the longer list / timeline for the same backup store.

## Security (localhost)

Set in `docker/.env` (auto-generated on first `up`):

| Variable | Purpose |
|----------|---------|
| `WPDEV_ADMIN_SAVE_TOKEN` | Unlock admin / save config (session cookie after unlock) |
| `WPDEV_TERMINAL_AUTH` | Interactive terminal login (`user:password`) — open terminal prompts in the browser; password is not put in the page URL |
| `WPDEV_TERMINAL_RUNNER_TOKEN` | Server-side runners only (PHP proxy; **not** sent to the browser) |

Other localhost hardening (dogfood):

- Auto-unlock requires a same-origin browser request (not in-container curl alone).
- Interactive terminal runs without Docker CLI access; sync runners keep `docker.sock` for pull/push.
- `docker/.env` is kept owner+www-data readable (`660`), not world-readable.

## Rebuild after UI changes

```bash
npm run admin:build:wp
```

Dev hot reload:

```bash
npm run admin:dev
```

## Local acceptance checklist

When dogfooding the browser UI:

- Env badges read **Dev / Staging / Production** (not “local” as the user-facing label)
- Sync default is theme-only; full-site needs Preview → Start; Dev → Production is not a primary button
- Backup Staging/Production → Backup now produces a DB dump you can restore on the same page
- Advanced → Terminal has doctor / key / backups — **not** one-click full-site production push
- Advanced → Update is Preview steps first, then Update (confirm if Docker restart is checked)
- Every UI action still maps to an existing CLI command (`push` / `pull` / `backup` / `doctor` / …)

## Shared package

Primary pages + adapter types live in [`packages/wpdev-web`](../../packages/wpdev-web/README.md) (`@wpdev/web`). `docs/admin` is a thin Vite shell: auth, theme, and `@wpdev/web-host` → `LocalAdapter` / runners. Hosted control-web will import the same pages with a cloud host module.
