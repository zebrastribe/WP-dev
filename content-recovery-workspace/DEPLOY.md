# Deploy `/import/` to a Public Host

The import workspace deploys **separately** from WordPress theme/content (`wp-dev push`).

## Recommended: Staging first

```
https://staging.timework.dk/import/     ← editorial workspace
https://staging.timework.dk/            ← WordPress QA site
```

Do **not** leave `/import/` open on production after content is imported.

---

## Step 1 — Build locally

```bash
cd WP-dev
npm run import:build:wp
npm run wp-dev -- import ingest
```

This produces:

- `wordpress/import/` — SPA + PHP API
- `content-recovery-workspace/storage/timework/` — SQLite + exports

---

## Step 2 — Configure staging in `wp-dev.config.json`

```json
{
  "staging": {
    "host": "staging.timework.dk",
    "user": "timework.dk",
    "path": "/var/www/staging.timework.dk/public_html",
    "url": "https://staging.timework.dk",
    "identityFile": "/home/you/.ssh/timework-simply.pem"
  }
}
```

Use Simply DNS (`wp-dev simply setup-staging-dns`) if staging subdomain is not ready.

---

## Step 3 — Push workspace only

```bash
npm run wp-dev -- import push staging
```

This rsyncs:

| Local | Remote |
|-------|--------|
| `wordpress/import/` | `{staging.path}/import/` |
| `content-recovery-workspace/storage/timework/` | `{staging.path}/import/storage/timework/` |

Dry run first:

```bash
npm run wp-dev -- import push staging --dry-run
```

---

## Step 4 — Set auth token on server

On the host, add to Apache/PHP environment or a small `import/api/.user.ini`:

```
WPDEV_IMPORT_TOKEN=your-long-random-secret
```

For Docker local dev, set in `WP-dev/docker/.env`:

```
WPDEV_IMPORT_TOKEN=your-long-random-secret
```

In the browser workspace, paste the same token on first connect.

**Extra protection on public hosts:**

HTTP Basic Auth is applied via **PHP** on `import push` when `WP-dev/import.auth.env` exists (Simply blocks Apache `AuthType` in `.htaccess`):

```bash
cp import.auth.env.example import.auth.env
# edit IMPORT_BASIC_AUTH_USER and IMPORT_BASIC_AUTH_PASSWORD
```

`import push` writes `api/import.auth.env` + `project.env` before rsync. Local Docker (`import build`) stays open — no password prompt on localhost.

Also consider:

- IP allowlist
- `robots.txt`: `Disallow: /import/`

---

## Step 5 — Verify

```bash
curl -s "https://staging.timework.dk/import/api/index.php?path=health"
```

Open `https://staging.timework.dk/import/` and enter token if configured.

---

## Production

Only deploy if editors need remote access before launch:

```bash
npm run wp-dev -- import push production
```

Remove or lock `/import/` when migration is complete.

---

## What `wp-dev push` does NOT deploy

| Deployed by `wp-dev push` | Deployed by `import push` |
|---------------------------|---------------------------|
| WordPress core + theme | `/import/` SPA |
| Plugins, uploads | SQLite storage |
| Database | |

Always use **`import push`** for the workspace.
