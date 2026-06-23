# Ports and networking

Each WP-dev clone uses ports from `docker/.env`. Defaults:

| Variable | Default | Service |
|----------|---------|---------|
| `WP_PORT` | 8888 | WordPress (HTTP) |
| `WP_HTTPS_PORT` | 8443 | Local HTTPS (when enabled) |
| `WPDEV_TERMINAL_PORT` | 7681 | Browser terminal |
| `WPDEV_TERMINAL_RUNNER_PORT` | 7682 | Terminal runner API |
| `WPDEV_HOST_RUNNER_PORT` | 7683 | Sync runner (in terminal container) |

## Strict port mode

By default, `wp-dev up` **fails** if a reserved port is busy (instead of silently picking a new one).

```bash
npm run wp-dev -- up --relocate-ports   # auto-pick free ports
npm run wp-dev -- up --reclaim-ports    # stop orphaned wp-dev listeners first
```

## Port conflicts

**Symptom:** `up` fails or bumps `WP_PORT` every time.

**Try:**

1. `npm run wp-dev -- down` in this clone and any other WP-dev clones.
2. `npm run wp-dev -- up --reclaim-ports`
3. Change `WP_PORT` in `docker/.env` and match `local.url`.

## Wrong localhost port in links

After a port change, run `up` again — WP-dev syncs `home`/`siteurl` and sweeps stale localhost URLs in content.

```bash
npm run wp-dev -- doctor --local-http
```

## Localhost binding

WordPress and admin bind to **127.0.0.1** by default — not exposed to your LAN.

## HTTPS locally

```bash
npm run wp-dev -- ssl enable
npm run wp-dev -- down
npm run wp-dev -- up
```

Requires [mkcert](https://github.com/FiloSottile/mkcert). See [Environment variables](../reference/environment-variables.md).

## Related

- [Service manager](../features/service-manager.md)
- [Port troubleshooting](../troubleshooting/ports.md)
