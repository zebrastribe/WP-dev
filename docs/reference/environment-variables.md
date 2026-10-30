# Environment variables

File: **`docker/.env`** (gitignored). Copy from **`docker/.env.example`**.

WP-dev auto-generates security tokens on first `wp-dev up`.

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `MYSQL_DATABASE` | wordpress | Database name |
| `MYSQL_USER` | wordpress | Database user |
| `MYSQL_PASSWORD` | wordpress | Database password |
| `MYSQL_ROOT_PASSWORD` | root | Root password |
| `WORDPRESS_TABLE_PREFIX` | wp_ | Must match imported DB prefix |

## Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `WP_PORT` | 8888 | WordPress HTTP |
| `WP_HTTPS_PORT` | 8443 | Local HTTPS |
| `WPDEV_TERMINAL_PORT` | 7681 | Browser terminal |
| `WPDEV_TERMINAL_RUNNER_PORT` | 7682 | Terminal runner |
| `WPDEV_HOST_RUNNER_PORT` | 7683 | Sync runner |

## PHP version

| Variable | Default | Description |
|----------|---------|-------------|
| `WPDEV_PHP_VERSION` | 8.2 | Docker image tag (`7.4`–`8.5`; see [PHP versions](../guides/php-versions.md)) |

```bash
npm run wp-dev -- php show --env local
npm run wp-dev -- php set 8.3 --env local --restart   # saves rollback snapshot
npm run wp-dev -- php rollback --env local --restart  # if something breaks

npm run wp-dev -- php show --env staging
npm run wp-dev -- php set 8.2 --env staging           # only if host supports .php-version / htaccess
npm run wp-dev -- php rollback --env staging
```

Local uses Docker image tags. Staging/production only when the host honors `.php-version` or AddHandler in `.htaccess`; otherwise change PHP in the panel.

## HTTPS

| Variable | Default | Description |
|----------|---------|-------------|
| `WPDEV_LOCAL_HTTPS` | 0 | Set `1` when SSL enabled |
| | | Use `wp-dev ssl enable` |

## Network configuration

Auto-configured by `wp-dev up`. Override only if needed for advanced setups.

| Variable | Default | Description |
|----------|---------|-------------|
| `WP_BIND` | `127.0.0.1` | Bind address for WP port (`127.0.0.1` = localhost only, `0.0.0.0` = all interfaces). `localhost` is normalized to `127.0.0.1`. |
| `WPDEV_NETWORK_SUBNET` | (auto) | Docker network subnet (e.g. `172.28.1.0/24`) |
| `WPDEV_NETWORK_GATEWAY` | (auto) | Docker network gateway (e.g. `172.28.1.1`) |
| `WPDEV_SSL_PROXY_IP` | (auto) | Fixed IP for SSL proxy container |

**Subnet pool override:** Set `WPDEV_SUBNET_POOL=172.29` in your **shell environment** (not docker/.env) before running `wp-dev up` to use a different prefix. This is shell-only because subnet allocation happens before reading docker/.env.

**Two stacks on one host** get unique subnets automatically:
- `wp-dev up` scans existing Docker networks to find an available /24 subnet
- If a saved subnet collides with another stack (e.g., stack A saves .1, goes down, stack C takes .1), the next `wp-dev up` detects the collision and reallocates

**Compose fallbacks:** The docker-compose.yml has fallback defaults (`172.28.0.0/24`, `172.28.0.1`) for `docker compose down` to work without `wp-dev up`. These are migration-only; normal usage always runs `wp-dev up` first.

## Security (Gate 0)

These variables protect the browser admin API from spoofed requests. Auto-configured by `wp-dev up`.

| Variable | Default | Description |
|----------|---------|-------------|
| `WPDEV_ADMIN_TRUSTED_GATEWAY` | (gateway) | Docker gateway IP(s) allowed to reach admin API |
| `WPDEV_WP_BIND_LOCAL` | (derived) | `1` if WP_BIND is localhost, `0` otherwise |

**How it works:** The admin API checks `REMOTE_ADDR` against loopback (`127.0.0.1`, `::1`) and the trusted gateway. Header spoofing (Host, Origin, X-Forwarded-For) is blocked because `REMOTE_ADDR` reveals the true caller position. Auto-unlock features also require `WPDEV_WP_BIND_LOCAL=1` to prevent attacks when the port is exposed to LAN.

## Browser admin and terminal

| Variable | Description |
|----------|-------------|
| `WPDEV_ADMIN_SAVE_TOKEN` | **Required** for wizard Save |
| `WPDEV_TERMINAL_AUTH` | Terminal login `user:password` |
| `WPDEV_TERMINAL_RUNNER_TOKEN` | Runner API secret |
| `WPDEV_TERMINAL_RUNNER_ORIGIN` | Allowed origin (e.g. `http://localhost:8888`) |
| `WPDEV_TERMINAL_WORKDIR` | Default cwd in terminal (`/workspace`) |

## Optional

| Variable | Description |
|----------|-------------|
| `WPDEV_SIMPLY_API_KEY` | Simply.com API key for DNS helpers |
| `WPDEV_IMPORT_TOKEN` | Content Recovery Workspace API |

## Related

- [Ports guide](../guides/ports.md)
- [Browser admin](../guides/browser-admin.md)
- [Configuration](./configuration.md)
