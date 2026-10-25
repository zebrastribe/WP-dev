# Hosted / multi-tenant web plan — not in this public repo

The detailed hosted / multi-tenant plan lives only in the **private** repository:

**https://github.com/zebrastribe/WP-dev-cloud** → `docs/online-migration-plan.md`

**This public repository** (`zebrastribe/WP-dev`) is the localhost WordPress Dev→Staging→Production CLI (+ optional local `/admin/` UI only).

- Do **not** expose today’s `/admin/` PHP API or Docker runners on the public internet.
- Do **not** publish hosted design, providers, costs, or control-plane internals here.
- Day-to-day use: [README.md](../../README.md), [project-structure.md](./project-structure.md), [architecture.md](./architecture.md).

## Status snapshot (2026-10-25)

| Item | Status |
|------|--------|
| Plan document (private) | **COMPLETE** — see private repo only |
| Public integrity baseline | **Done** on public `main` |
| SaaS / hosted build hold | **ON** — lift only via explicit owner instruction in the private plan |
| Product launch | **Not ready** — no hosted control plane in this repo |

Nothing in this public file authorizes a hosted build or deploy. Follow the private plan when the hold is lifted.
