# Environments

WP-dev knows three environment names: **local**, **staging**, and **production**.

## Local

- Runs in Docker on your machine.
- URL: `local.url` in `wp-dev.config.json` (for example `http://localhost:8888`).
- Files: `wordpress/` folder in the repo.
- Start with `wp-dev up`, stop with `wp-dev down`.

## Staging and production

- **Remotes** for `pull` and `push` only.
- WP-dev does **not** create or host these servers.
- Config fields: `host`, `user`, `path`, `url` under `staging` or `production` in config.
- Placeholder values in the example config (like `staging.example.invalid`) are intentional until you set real servers.

## Second local site

Run another **clone** of WP-dev with a different:

- `project` id in config
- `WP_PORT` in `docker/.env`
- `local.url`

Each clone is an isolated Docker Compose project.

## Staging vs production URL in config

`staging.url` and `production.url` are used for database search-replace during sync. They must match the URLs stored in that environment’s WordPress database.

## Optional remote database settings

For first-time remote bootstrap via `push staging`, you can set:

```json
"staging.db": {
  "host": "…",
  "name": "…",
  "user": "…",
  "password": "…",
  "prefix": "wp_"
}
```

Keep staging and production databases separate.

## Related

- [Configuration reference](../reference/configuration.md)
- [Syncing](./syncing.md)
