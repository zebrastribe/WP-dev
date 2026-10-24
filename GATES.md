# Gates: fix P0/P1 bugs + security hardening

OWNS: src/**, tests/**, docs/admin/public/**, docs/admin/src/api.ts, content-recovery-workspace/api/**, GATES.md

Scope: Fix verified P0/P1 sync/port/lock bugs and high-priority localhost security gaps with regression tests.

- [x] G1: SAFE_SYNC_EXCLUDES uses root-anchored /admin, not basename admin
  CHECK: node -e "const m=require('./dist/services/sync-excludes.js'); if(!m.SAFE_SYNC_EXCLUDES.includes('/admin')||m.SAFE_SYNC_EXCLUDES.includes('admin')) process.exit(1); console.log('admin-exclude-anchored')"
  EXPECT: admin-exclude-anchored
  EVIDENCE: met — admin-exclude-anchored (2026-10-24)

- [x] G2: Unit + smoke tests pass after fixes
  CHECK: npm test && npm run test:smoke
  EXPECT: Tests
  EVIDENCE: met — 199 unit + 14 smoke passed (2026-10-24)

- [x] G3: Relocate keeps free ports — regression covered
  CHECK: npx vitest run tests/supervisor-port-manager.test.ts
  EXPECT: passed
  EVIDENCE: met — conflictedPortKeys test passed (2026-10-24)

- [x] G4: GET load requires auth
  CHECK: node -e "const t=require('fs').readFileSync('docs/admin/public/api.php','utf8'); const i=t.indexOf(\"action === 'load'\"); const block=t.slice(i,i+500); if(!block.includes('wpdev_require_admin_token')) process.exit(1); console.log('load-auth-required')"
  EXPECT: load-auth-required
  EVIDENCE: met — load-auth-required (2026-10-24)
