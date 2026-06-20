# Content Recovery Workspace

Normalization and approval layer between Wayback recovery (`knowledge-base/`) and WordPress import.

**URL:** `http://localhost:<WP_PORT>/import/`

## Quick start

```bash
cd WP-dev

# Build SPA + API into wordpress/import/
npm run import:build:wp

# Ensure Docker stack is up (applies /import-storage mount)
npm run wp-dev -- up

# Ingest knowledge-base into SQLite
npm run wp-dev -- import ingest

# Open workspace
open http://localhost:8889/import/
```

## CLI commands

| Command | Description |
|---------|-------------|
| `wp-dev import build` | Build React app to `wordpress/import/` |
| `wp-dev import ingest` | Import `knowledge-base/` → SQLite |
| `wp-dev import push staging` | Deploy `/import/` + storage to remote |

**Public/staging deploy:** see [DEPLOY.md](./DEPLOY.md)

## Known scrape issues (fixed on ingest)

| Issue | Cause | Fix |
|-------|-------|-----|
| Title = `Loader` | Wayback captured page before Divi rendered | Ingest uses H1 / inventory purpose |
| Missing H3–H6 | Old scraper only stored h1 + h2s | Ingest parses body HTML; re-scrape gets full headings |
| Empty header/footer | Not in page JSON | Built from `navigation.json` on ingest |
| Services look empty | Grouping layer, not pages | Shows linked page slugs in editor |

## Storage

SQLite database per project:

```
content-recovery-workspace/storage/{project}/repository.sqlite
```

Mounted in Docker at `/import-storage/{project}/`.

**Note:** Run ingest as `www-data` in Docker (CLI does this automatically) so Apache can read/write the database.

## Architecture docs

See `/content-recovery-workspace/` in the parent timework repo for full architecture documentation.
