# Admin UI (browser wizard)

## Layout

- Source: `docs/admin/src/` (React 19 + Vite + Tailwind)
- Build output: `wordpress/admin/` via `npm run build:wp --prefix docs/admin`
- Served at `http://localhost:<WP_PORT>/admin/` (same Apache as WordPress)
- PHP backend: `docs/admin/public/api.php`, `schema-validate.inc.php`

## Key components

- `Wizard.tsx` — setup flow (SSH, staging, production, save)
- `ConfigAssistant.tsx` — config editor with schema validation
- `SyncTab.tsx` — plugin/theme sync rules UI
- `UpdateTab.tsx` — safe wp-dev tool update
- `BackupRestore.tsx` — DB backup/restore UI
- `HistoryRollback.tsx` — pre-pull/pre-push rollback
- `Terminal.tsx` — embedded terminal (ttyd on port 7681)
- `validateConfig.ts` — client-side ajv validation
- `generated/wp-dev.config.schema.json` — generated from Zod (do not hand-edit)

## API contract

- `GET/POST /admin/api.php?action=load|save`
- Auth: `WPDEV_ADMIN_SAVE_TOKEN` header must match `docker/.env`
- Terminal runner: `WPDEV_TERMINAL_RUNNER_TOKEN` + `WPDEV_TERMINAL_RUNNER_ORIGIN`
- Logs: `logs/wp-dev-admin-api.log` (gitignored)

## Dev workflow

- `npm run admin:dev` — Vite dev server proxies API to Docker
- After UI changes: `npm run admin:build:wp` (or full `npm run setup`)
- No Vitest/Playwright for admin yet — manual + typecheck

## Vite configs

- `vite.config.ts` — dev
- `vite.wp.config.ts` — production build into `wordpress/admin/`