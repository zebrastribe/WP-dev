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

`WP-dev-cloud` vendors a snapshot under its own `packages/sync-engine` so the private repo works alone.
Edit **here**; refresh cloud with `WP-dev-cloud/scripts/sync-public-packages.sh` when both trees are available.
