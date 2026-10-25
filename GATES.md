# Gates: fix P0/P1 bugs + security hardening

OWNS: src/**, tests/**, docs/admin/public/**, docs/admin/src/api.ts, content-recovery-workspace/api/**, docker/**, GATES.md

Scope: Fix verified P0/P1 sync/port/lock bugs and high-priority localhost security gaps with regression tests.

- [x] G1: SAFE_SYNC_EXCLUDES uses root-anchored /admin, not basename admin
  CHECK: node -e "const m=require('./dist/services/sync-excludes.js'); if(!m.SAFE_SYNC_EXCLUDES.includes('/admin')||m.SAFE_SYNC_EXCLUDES.includes('admin')) process.exit(1); console.log('admin-exclude-anchored')"
  EXPECT: admin-exclude-anchored
  EVIDENCE: met — admin-exclude-anchored (2026-10-24)

- [x] G2: Unit + smoke tests pass after fixes
  CHECK: npm test && npm run test:smoke
  EXPECT: Tests
  EVIDENCE: met — 301 unit + 16 smoke passed (2026-10-25, post forensic B0–B5)

- [x] G3: Relocate keeps free ports — regression covered
  CHECK: npx vitest run tests/supervisor-port-manager.test.ts
  EXPECT: passed
  EVIDENCE: met — conflictedPortKeys test passed (2026-10-24)

- [x] G4: GET load requires auth
  CHECK: node -e "const t=require('fs').readFileSync('docs/admin/public/api.php','utf8'); const i=t.indexOf(\"action === 'load'\"); const block=t.slice(i,i+500); if(!block.includes('wpdev_require_admin_token')) process.exit(1); console.log('load-auth-required')"
  EXPECT: load-auth-required
  EVIDENCE: met — load-auth-required (2026-10-24)

- [x] G5: Sync lock reclaim is host/NS-aware (not age-only while PID alive)
  CHECK: npx vitest run tests/sync-lock.test.ts
  EXPECT: passed
  EVIDENCE: met — 14 tests including old-but-alive + foreign-host (2026-10-25)

- [x] G6: WordPress compose does not mount whole docker/ RW or inject admin token env
  CHECK: npx vitest run tests/smoke/cli.smoke.test.ts -t "wordpress service does not mount"
  EXPECT: passed
  EVIDENCE: met — smoke assertion (2026-10-25)

- [x] G7: Remote /admin purge gated on wp-dev api.php marker
  CHECK: npx vitest run tests/remote-admin-purge.test.ts
  EXPECT: passed
  EVIDENCE: met (2026-10-25)

- [x] G8: Table-prefix mismatch fails closed
  CHECK: npx vitest run tests/table-prefix-guard.test.ts
  EXPECT: passed
  EVIDENCE: met (2026-10-25)

- [x] G9: rsync SSH uses StrictHostKeyChecking=yes (not accept-new)
  CHECK: npx vitest run tests/rsync-compose-env.test.ts
  EXPECT: passed
  EVIDENCE: met (2026-10-25)

- [x] G10: Theme push production requires SYNC_PRODUCTION via runner gate
  CHECK: npx vitest run tests/runner-sync-gates.test.ts -t "wpdevPushThemeCommand"
  EXPECT: passed
  EVIDENCE: met (2026-10-25)

- [x] G11: Archive restore rsync runs before DB import (F-018)
  CHECK: npx vitest run tests/restore-archive-order.test.ts
  EXPECT: passed
  EVIDENCE: met (2026-10-25)

## Deferred (B6 — not gated yet)

- First-class file-only / DB-only full sync (product decision)
- Further Docker capability drops / no-new-privileges on terminal
- See [docs/developer/online-migration-plan.md](./docs/developer/online-migration-plan.md) status snapshot
