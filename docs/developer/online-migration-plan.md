# Hosted / multi-tenant web plan — not in this public repo

The detailed hosted / multi-tenant plan lives only in the **private** repository:

**https://github.com/zebrastribe/WP-dev-cloud** → `docs/online-migration-plan.md`

**This public repository** (`zebrastribe/WP-dev`) is the localhost WordPress Dev→Staging→Production CLI (+ optional local `/admin/` UI only).

- Do **not** expose today’s `/admin/` PHP API or Docker runners on the public internet.
- Do **not** publish hosted design, providers, costs, or control-plane internals here.
- Day-to-day use: [README.md](../../README.md), [project-structure.md](./project-structure.md), [architecture.md](./architecture.md).

## Status snapshot (2026-10-31)

| Item | Status |
|------|--------|
| Plan document (private) | **COMPLETE** — see private repo only |
| Public integrity baseline | **Done** on public `main` |
| SaaS / hosted build hold | **OFF** — G2 lifted 2026-10-31 |
| Phase 1 (sync-engine / lab) | **COMPLETE** on this public repo (P1.1–P1.9; no SaaS) |
| Phase 2 (control plane) | **IN PROGRESS** in private repo (loopback API/web/worker; IDOR/grants suite green; no public listen) |
| Product launch | **Not ready** — no hosted control plane in this repo |

Gate 0 still applies: never publish today’s local admin API or runners. Hosted control-plane apps (when built) live in the private repo only. Follow the private plan for Phase 1+ details.
