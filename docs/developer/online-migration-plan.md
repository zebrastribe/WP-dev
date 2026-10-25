# Hosted / multi-tenant web plan — not in this public repo

The detailed **online / multi-tenant / control-plane** migration plan lives only in the **private** repository:

**https://github.com/zebrastribe/WP-dev-cloud** → `docs/online-migration-plan.md`

**This public repository** (`zebrastribe/WP-dev`) is the localhost WordPress Dev→Staging→Production CLI (+ optional local `/admin/` UI only).

- Do **not** expose today’s `/admin/` PHP API or Docker runners on the public internet.
- Day-to-day use: [README.md](../../README.md), [project-structure.md](./project-structure.md), [architecture.md](./architecture.md).

## Status snapshot (2026-10-25)

| Item | Status |
|------|--------|
| Plan document (private) | **COMPLETE** — amendments via dated §27 notes only |
| G1 (merge integrity PR #1) | **Done** on public `main` |
| `feat/admin-plan-ia` (PR #2) | **Merged** to public `main` (`c4536b2`) |
| G2 (lift SaaS build hold) | **ON** — owner must lift explicitly before Phase 1 coding |
| Product launch | **Not ready** — no hosted control plane |
| Localhost dogfood (Sync/Backup/Restore) | **Verified** on staging/Dev — see private plan §27 Amendments **N** and **O** (O supersedes parts of N) |

**Next owner step:** when ready, lift G2 hold explicitly → execute Phase 1 checklist in the private plan (§25).
