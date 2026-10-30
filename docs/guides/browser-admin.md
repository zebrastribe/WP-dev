# Browser admin (optional UI)

The optional browser UI lives at **`http://localhost:<WP_PORT>/admin/`** — same host and port as WordPress.

CLI remains fully usable without this UI (`wp-dev pull|push|backup|doctor|…`).

**Localhost only.** Do not expose `/admin/`, Docker runners, or the terminal on the public internet.

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

**The admin must never be exposed beyond localhost (Gate 0).** It provides access to staging DB secrets, the terminal, backup/restore runners, and config/.env writes.

### Gate 0: Network-level protection

The admin API enforces two-layer localhost verification:

1. **Host header check** — Must be `localhost`, `127.0.0.1`, or `[::1]`. Blocks DNS rebinding attacks where an attacker's domain resolves to 127.0.0.1.

2. **REMOTE_ADDR check** — The client's actual network address must be:
   - Loopback (`127.0.0.1`, `::1`), or
   - The trusted Docker network gateway (`172.28.0.1` from the fixed compose network)

   This blocks attackers who spoof `Host: localhost` headers from a different network position.

3. **Defense-in-depth for auto-unlock** — Additionally requires `WPDEV_WP_BIND_LOCAL=1`, confirming the WordPress port is published on `127.0.0.1` only. Catches edge cases where Docker relays LAN traffic through the gateway (rootless Docker, Docker Desktop, hairpin NAT).

The same checks are enforced at the Apache level (`.htaccess` with `mod_authz_host`).

### Security environment variables

Set in `docker/.env` (auto-generated on first `wp-dev up`):

| Variable | Purpose |
|----------|---------|
| `WPDEV_ADMIN_SAVE_TOKEN` | Unlock admin / save config (session cookie after unlock) |
| `WPDEV_TERMINAL_AUTH` | Interactive terminal login (`user:password`) — open terminal prompts in the browser; password is not put in the page URL |
| `WPDEV_TERMINAL_RUNNER_TOKEN` | Server-side runners only (PHP proxy; **not** sent to the browser) |
| `WPDEV_ADMIN_TRUSTED_GATEWAY` | Trusted Docker gateway IP for REMOTE_ADDR checks (fixed to `172.28.0.1`) |
| `WPDEV_WP_BIND_LOCAL` | `1` if WP port is bound to 127.0.0.1 only (required for auto-unlock) |

### Other localhost hardening

- Auto-unlock requires a same-origin browser request (not in-container curl alone).
- Auto-unlock requires a prior challenge cookie from GET auth-status (blocks one-shot header spoofs).
- Interactive terminal runs without Docker CLI access; sync runners keep `docker.sock` for pull/push.
- Terminal uses origin checking (`-O` flag) for CSRF protection.
- `docker/.env` is kept owner+www-data readable (`660`), not world-readable.

### If you must expose locally (not recommended)

If you need to access the admin from another machine on your LAN (e.g., testing from a phone), you would need to:

1. Change the port binding from `127.0.0.1:${WP_PORT}:80` to `0.0.0.0:${WP_PORT}:80`
2. Set `WPDEV_WP_BIND_LOCAL=0` (auto-unlock will be disabled)
3. Manually unlock using the token from `docker/.env`

**Do not do this on untrusted networks.** The admin has no additional authentication beyond the initial token unlock.

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
