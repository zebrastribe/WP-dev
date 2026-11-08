# `@wpdev/web`

Shared WP-dev web UI for:

- **Public localhost** — `docs/admin/` (thin Vite shell + `LocalAdapter` / `@wpdev/web-host`)
- **Private hosted** — future cloud shell uses a `CloudAdapter` (separate private repo; not in this tree)

## Primary IA (binding)

**Setup · Sync · Backup · Update**

**Advanced** is local-only and sits beside those four tabs. Sync is full site: Staging → Local, Production → Local, and Local → Staging. Preview runs before Start. A whole-site push to Production is not offered. Theme files live under Advanced. See [`docs/guides/browser-admin.md`](../../docs/guides/browser-admin.md).

## Exports

- Adapter types and `LOCAL_SYNC_ROUTES`
- Primary pages: `SetupStagingPage`, `SyncPage`, `BackupPage`, `AdvancedPage`
- `EnvBadges`, `PRIMARY_TABS` (Setup · Sync · Backup · Update), shared button classes

## Host wiring

Pages import runners and local-only panels from **`@wpdev/web-host`**. Localhost maps that alias to [`docs/admin/src/webHost.ts`](../../docs/admin/src/webHost.ts). Hosted control-web supplies a cloud host module (no Terminal / Services in primary).

## Cloud consumer notes

- Do not mount Terminal / Services in hosted primary nav (local-only).
- Staging ↔ Production routes are marked `hostedOnly` until workers exist.
- Never put SSH private keys or runner tokens in the browser.

## Private cloud consumers

`WP-dev-cloud` links this package. It uses `PRIMARY_TABS` for the hosted tab names and keeps its own job panels (login, account, site switcher). It does not render these pages. Full pages stay here for the local admin.
