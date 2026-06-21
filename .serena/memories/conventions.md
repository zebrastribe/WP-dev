# Code conventions

## TypeScript / ESM

- Source in `src/`, output `dist/` with `.js` extensions in imports (`./foo.js` from `./foo.ts`)
- Strict TS; no implicit any
- Zod schemas in `src/config/schema.ts` are source of truth; run `generate:config-artifacts` after schema changes
- Commands stay thin: load config via `runWithConfig`, call services, log via `utils/logger`

## Naming

- Commands: `cmdXxx` exported from `src/commands/`, registered in `cli.ts`
- Remote env type: `RemoteEnvName = "staging" | "production"`
- Docker compose helpers in `services/docker-compose.ts`; project id via `dockerComposeProjectId()`

## Sync engine

- Exclude rules: `buildPushExcludeRules` / `buildPullExcludeRules` in `sync-excludes.ts`
- Per-plugin `sync.plugins[slug]` = `sync` | `localOnly`; per-theme units with `mode: all|custom|localOnly`
- Safety warnings via `collectSyncSafetyWarnings`; preview via dry-run rsync + `sync-preview-parse.ts`

## WP-CLI split

- Local WP-CLI: docker compose run wpcli service (`services/wpcli.ts`)
- Remote WP-CLI: SSH exec on remote path (`resolveRemoteWpPath` handles shared-hosting quirks)
- Always `assertLocalWpInstalled` / `assertRemoteWpInstalled` before DB ops

## Admin UI

- React functional components, Tailwind utility classes
- Config validated client-side (ajv) and server-side (PHP)
- API: `GET/POST /admin/api.php?action=load|save`; token in `WPDEV_ADMIN_SAVE_TOKEN`

## Tests

- Fixtures: `tests/helpers/fixtures.ts`
- Temp dirs: `mkdtempSync` + `rmSync` in `afterEach`
- Smoke tests only in `tests/smoke/`; require built `dist/cli.js`
- Fake timers for timestamped backup filenames

## Docs placement

- User docs → `README.md`
- Upstream design → `purpose/`
- Fork-specific notes → `docs/` (not duplicate RFCs in `purpose/`)