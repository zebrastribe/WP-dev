# `@wpdev/web`

Shared WP-dev web UI for:

- **Public localhost** — `docs/admin/` (thin Vite shell + `LocalAdapter` / `@wpdev/web-host`)
- **Private hosted** — future cloud shell uses a `CloudAdapter` (separate private repo; not in this tree)

## Primary IA (binding)

**Backup · Setup · Sync** (+ **Advanced** for power tools)

Localhost Sync defaults to **theme only**; full-site is Preview → Start. Backup restores on the Backup page (DB for remote envs). See [`docs/guides/browser-admin.md`](../../docs/guides/browser-admin.md).

## Exports

- Adapter types and `LOCAL_SYNC_ROUTES`
- Primary pages: `BackupPage`, `SetupStagingPage`, `SyncPage`, `AdvancedPage`
- `EnvBadges`, `PRIMARY_TABS` (Backup · Setup · Sync · Advanced), shared button classes

## Host wiring

Pages import runners and local-only panels from **`@wpdev/web-host`**. Localhost maps that alias to [`docs/admin/src/webHost.ts`](../../docs/admin/src/webHost.ts). Hosted control-web supplies a cloud host module (no Terminal / Services in primary).

## Cloud consumer notes

- Do not mount Terminal / Services in hosted primary nav (local-only).
- Staging ↔ Production routes are marked `hostedOnly` until workers exist.
- Never put SSH private keys or runner tokens in the browser.

## Private cloud consumers

`WP-dev-cloud` vendors **shell only** (`@wpdev/web/shell` / `PRIMARY_TABS`) under its `packages/wpdev-web`.
Full pages stay here for local admin. Refresh cloud shell via `WP-dev-cloud/scripts/sync-public-packages.sh`.
