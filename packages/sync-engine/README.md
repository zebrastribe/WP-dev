# `@wpdev/sync-engine`

Shared sync **policy** for the public CLI and (later) private hosted workers.

## Phase 1 boundary (§25 P1.2)

- **In package now:** sync lock; SSH host-key pin/verify; URL variants; safe/recommended exclude constants.
- **Still in `src/` (to move next):** rsync, wpcli helpers, full exclude rule builders (config-aware).
- **Never here:** control-api AuthZ, credential vault, Docker-per-job launcher.

Commands stay thin wrappers. Do not fork sync **policy** (locks, host-key helpers, excludes) in `WP-dev-cloud`.

Cloud **lab doctor / backup / restore** job runners are a different surface (SSH into a fixture + Docker-per-job) — they import helpers from this package where shared, but are not forced to call CLI pull/push entrypoints.

## Consume

```ts
import { acquireSyncLock, releaseSyncLock } from "@wpdev/sync-engine";
```

Sibling path (private apps, after extract grows): `"@wpdev/sync-engine": "file:../../WP-dev/packages/sync-engine"`.

## Private cloud consumers

`WP-dev-cloud` does not keep a second copy. `npm install` there links `.public/sync-engine` at this package. Edit here, then rebuild with `npm run build` in this folder so the cloud typecheck sees `dist/`.
