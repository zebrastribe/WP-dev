# `@wpdev/sync-engine`

Shared sync **policy** for the public CLI and (later) private hosted workers.

## Phase 1 boundary (§25 P1.2)

- **In package now:** sync lock; SSH host-key pin/verify; URL variants; safe/recommended exclude constants.
- **Still in `src/` (to move next):** rsync, wpcli helpers, full exclude rule builders (config-aware).
- **Never here:** control-api AuthZ, credential vault, Docker-per-job launcher.

Commands stay thin wrappers. Do not fork sync behavior in `WP-dev-cloud`.

## Consume

```ts
import { acquireSyncLock, releaseSyncLock } from "@wpdev/sync-engine";
```

Sibling path (private apps, after extract grows): `"@wpdev/sync-engine": "file:../../WP-dev/packages/sync-engine"`.
