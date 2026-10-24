# Hosted / multi-tenant web plan — not in this public repo

The detailed **online / multi-tenant / control-plane** migration plan lives only in the **private** repository:

**https://github.com/zebrastribe/WP-dev-cloud** → `docs/online-migration-plan.md`

**This public repository** (`zebrastribe/WP-dev`) is the localhost WordPress Dev→Staging→Production CLI (+ optional local `/admin/` UI only).

- Do **not** expose today’s `/admin/` PHP API or Docker runners on the public internet.
- Day-to-day use: [README.md](../../README.md), [project-structure.md](./project-structure.md), [architecture.md](./architecture.md).
